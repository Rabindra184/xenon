import 'reflect-metadata';
import vm from 'vm';
import express from 'express';
import { expect } from 'chai';
import request from '../helpers/loopbackRequest';
import { setupSwagger, swaggerSpec } from '../../src/app/swagger';

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
});
