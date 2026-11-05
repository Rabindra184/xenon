import 'reflect-metadata';
import vm from 'vm';
import express from 'express';
import { expect } from 'chai';
import request from '../helpers/loopbackRequest';
import { setupSwagger, swaggerSpec } from '../../src/app/swagger';
import { API_DOCS_THEME_SCRIPT } from '../../src/app/apiDocsTheme';

/**
 * The page at /xenon/api-docs came up blank in 2.17: its swagger-ui-init.js
 * was a syntax error. swagger-ui-express put the spec into that script with
 * String.prototype.replace, which reads `$\`` in the replacement as "the text
 * before the match". The Shell tab's description in control.yaml lists
 * "`$`, backticks", so the script's own first lines were pasted into the
 * middle of a JSON string. The page now loads the spec from
 * /xenon/api-docs.json, so no text in the spec can break the script.
 */
describe('API reference page (/xenon/api-docs)', () => {
  const app = express();
  const router = express.Router();
  setupSwagger(router, '/xenon');
  app.use('/xenon', router);

  it('serves a swagger-ui-init.js that is valid JavaScript', async () => {
    const res = await request(app).get('/xenon/api-docs/swagger-ui-init.js');
    expect(res.status).to.equal(200);
    expect(() => new vm.Script(res.text)).not.to.throw();
  });

  it('loads the spec from /xenon/api-docs.json rather than pasting it into the script', async () => {
    const res = await request(app).get('/xenon/api-docs/swagger-ui-init.js');
    expect(res.text).to.include('"swaggerUrl": "/xenon/api-docs.json"');
    expect(res.text).not.to.include('"openapi"');
  });

  it('serves the spec it points at, whatever its text holds', async () => {
    const res = await request(app).get('/xenon/api-docs.json');
    expect(res.status).to.equal(200);
    expect(res.body.openapi).to.equal((swaggerSpec as { openapi: string }).openapi);
    // The text that broke the page is still there, and harmless now.
    expect(res.text).to.include('`$`, backticks');
  });

  describe('colours', () => {
    it("follows the dashboard's theme: the saved choice, else dark", async () => {
      const res = await request(app).get('/xenon/api-docs/');
      expect(res.status).to.equal(200);
      expect(res.text).to.include("localStorage.getItem('xenon.theme')");
      expect(res.text).to.include("setAttribute('data-theme'");
      expect(res.text).to.include('(prefers-color-scheme: light)');
    });

    // The script runs as the page is parsed; Swagger UI draws on window.onload.
    const themeFor = (saved: string | null | Error, osLight = false) => {
      const attrs: Record<string, string> = {};
      const listeners: Array<() => void> = [];
      vm.runInNewContext(API_DOCS_THEME_SCRIPT, {
        document: {
          documentElement: {
            setAttribute: (k: string, v: string) => (attrs[k] = v),
            classList: { contains: () => false, remove: () => undefined },
          },
        },
        localStorage: {
          getItem: () => {
            if (saved instanceof Error) throw saved;
            return saved;
          },
        },
        window: {
          matchMedia: () => ({
            matches: osLight,
            addEventListener: (_: string, fn: () => void) => listeners.push(fn),
          }),
          addEventListener: () => undefined,
        },
      });
      return attrs['data-theme'];
    };

    it('picks the theme the dashboard would', () => {
      expect(themeFor('light')).to.equal('light');
      expect(themeFor('dark', true)).to.equal('dark');
      expect(themeFor('system', true)).to.equal('light');
      expect(themeFor('system', false)).to.equal('dark');
      expect(themeFor(null, true)).to.equal('dark'); // nothing saved: dark, the default
      expect(themeFor('nonsense')).to.equal('dark');
      expect(themeFor(new Error('storage blocked'), true)).to.equal('dark');
    });

    it("keeps Swagger UI's own dark-mode class off, so only this theme decides", () => {
      const classes = new Set(['dark-mode']);
      let observer: (() => void) | undefined;
      vm.runInNewContext(API_DOCS_THEME_SCRIPT, {
        document: {
          documentElement: {
            setAttribute: () => undefined,
            classList: {
              contains: (c: string) => classes.has(c),
              remove: (c: string) => classes.delete(c),
            },
          },
        },
        localStorage: { getItem: () => 'light' },
        window: { matchMedia: () => ({ matches: false }), addEventListener: () => undefined },
        MutationObserver: class {
          constructor(fn: () => void) {
            observer = fn;
          }
          observe() {}
        },
      });
      expect(classes.has('dark-mode')).to.equal(false);
      // Swagger UI's top bar adds it again once it mounts, on a dark OS.
      classes.add('dark-mode');
      observer?.();
      expect(classes.has('dark-mode')).to.equal(false);
    });

    it("uses the dashboard's dark and light palettes, with no glows", async () => {
      const html = (await request(app).get('/xenon/api-docs/')).text;
      expect(html).to.include("[data-theme='light']");
      expect(html).to.include('#0e1013'); // the dashboard's dark --bg
      expect(html).to.include('#f6f7f9'); // the dashboard's light --bg
      expect(html).not.to.include('#020617'); // the old navy
      expect(html).not.to.match(/box-shadow:\s*0 0 \d+px/); // neon glows
      expect(html).not.to.include('-webkit-text-fill-color: transparent'); // gradient title
    });
  });
});
