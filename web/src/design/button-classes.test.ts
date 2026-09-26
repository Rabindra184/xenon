import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { globalButtonSelectors } from './button-classes';

const WEB = path.resolve(__dirname, '../..');

function stylesheets(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) stylesheets(p, out);
    else if (e.name.endsWith('.css')) out.push(p);
  }
  return out;
}

describe('globalButtonSelectors', () => {
  it('flags a rule that starts with a Button class', () => {
    expect(globalButtonSelectors('.btn-secondary { padding: 10px 20px; }')).toEqual([
      '.btn-secondary',
    ]);
    expect(globalButtonSelectors('.btn-premium,\n.btn-secondary { font-weight: 700; }')).toEqual([
      '.btn-secondary',
    ]);
    expect(globalButtonSelectors('.btn-secondary.is-recording svg { fill: red; }')).toEqual([
      '.btn-secondary.is-recording svg',
    ]);
    expect(globalButtonSelectors('.btn-secondary:hover:not(:disabled) { color: red; }')).toEqual([
      '.btn-secondary:hover:not(:disabled)',
    ]);
  });

  it('still flags one behind a page or theme prefix, or inside @media', () => {
    expect(globalButtonSelectors(":root[data-theme='light'] .btn-ghost { color: red; }")).toEqual([
      ":root[data-theme='light'] .btn-ghost",
    ]);
    expect(
      globalButtonSelectors(':root:not([data-theme="light"]) .btn-base { color: red; }'),
    ).toEqual([':root:not([data-theme="light"]) .btn-base']);
    expect(
      globalButtonSelectors('@media (min-width: 1024px) { .btn-size-sm { height: 30px; } }'),
    ).toEqual(['.btn-size-sm']);
  });

  it('allows a rule scoped to a container, and look-alike class names', () => {
    expect(globalButtonSelectors('.de2-result .btn-base.btn-size-icon { width: 28px; }')).toEqual(
      [],
    );
    expect(globalButtonSelectors('.icon-btn-secondary, .dc-btn-secondary { color: red; }')).toEqual(
      [],
    );
    expect(globalButtonSelectors('.btn-secondary-x { color: red; }')).toEqual([]);
    expect(globalButtonSelectors('/* .btn-secondary { } */ .card { color: red; }')).toEqual([]);
  });
});

describe('shared Button classes', () => {
  it('are styled globally only by ui/button.css', () => {
    const offenders: string[] = [];
    for (const f of stylesheets(path.join(WEB, 'src'))) {
      const rel = path.relative(WEB, f).split(path.sep).join('/');
      if (rel === 'src/components/ui/button.css') continue;
      for (const s of globalButtonSelectors(fs.readFileSync(f, 'utf8'))) {
        offenders.push(`${rel}: ${s} — scope it to a container, or use a class of your own`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
