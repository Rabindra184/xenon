import 'reflect-metadata';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { swaggerSpec } from '../../src/app/swagger';
import {
  ANALYSIS_CATEGORIES,
  FAILURE_RULES,
  HUB_RESTART_CATEGORY,
  RETIRED_CATEGORIES,
} from '../../src/dashboard/services/failureCategories';

/**
 * A Session's `failure_category` is written in two places: the failure
 * analysis (one of ANALYSIS_CATEGORIES) and a restart's recovery
 * (HUB_RESTART). Both write upper case. Sessions filed through 2.15 may also
 * hold a category no longer written (RETIRED_CATEGORIES).
 *
 * The API reference showed `element_not_found`, a value the server never
 * writes, and the dashboard had a runbook for "Infrastructure", a category
 * nothing ever assigns. These hold both to what the server writes.
 */

const WRITTEN = [...new Set([...ANALYSIS_CATEGORIES, HUB_RESTART_CATEGORY])];
/** Every value a session's row can hold. */
const STORED = [...WRITTEN, ...RETIRED_CATEGORIES];

/**
 * The dashboard's runbooks. web/ is an ES module package, so its .ts can't be
 * required from here; the file imports nothing, so it is compiled and run.
 */
function loadRunbooks(): {
  RUNBOOKS: Record<string, { title: string; markdown: string }>;
  runbookKey: (category: string) => string;
} {
  const file = path.resolve(__dirname, '../../web/src/components/runbooks/runbook-content.ts');
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  });
  const mod = { exports: {} as any };
  new Function('module', 'exports', outputText)(mod, mod.exports);
  return mod.exports;
}

const { RUNBOOKS, runbookKey } = loadRunbooks();

/** Every value found under a key named `key`, at any depth. */
function valuesUnder(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    node.forEach((n) => valuesUnder(n, key, out));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === key) out.push(v);
      valuesUnder(v, key, out);
    }
  }
  return out;
}

/** The `failure_category` column of every CSV example (a string with that header). */
function csvExampleCategories(): string[] {
  const out: string[] = [];
  for (const example of valuesUnder(swaggerSpec, 'example')) {
    if (typeof example !== 'string') continue;
    const [header, ...rows] = example.trim().split('\n');
    const column = header.split(',').indexOf('failure_category');
    if (column < 0) continue;
    for (const row of rows) out.push(row.split(',')[column]);
  }
  return out;
}

describe('failure categories', () => {
  it('are written upper case, as the API reference and the dashboard read them', () => {
    expect(ANALYSIS_CATEGORIES).to.include('UNKNOWN');
    for (const category of WRITTEN) expect(category).to.match(/^[A-Z_]+$/);
  });

  describe('in the API reference', () => {
    it('every example shows one the server writes, as it writes it', () => {
      const shown = [
        ...valuesUnder(swaggerSpec, 'failure_category').filter((v) => typeof v === 'string'),
        ...csvExampleCategories(),
      ];
      // The session list's example and the build export's CSV.
      expect(shown).to.have.length.of.at.least(2);
      for (const value of shown) expect(WRITTEN, String(value)).to.include(value);
    });

    it("the session record's description names every category a row can hold, and no other", () => {
      const described = valuesUnder(swaggerSpec, 'failure_category')
        .filter((v): v is { description: string } => !!(v as any)?.description)
        .map((v) => v.description);
      expect(described).to.have.length(1);
      const named = Array.from(described[0].matchAll(/`([A-Z_]+)`/g), (m) => m[1]);
      expect([...named].sort()).to.deep.equal([...STORED].sort());
    });
  });

  describe("in the dashboard's runbooks", () => {
    it('every category a session can hold has a runbook of its own, the retired ones included', () => {
      for (const category of STORED) {
        expect(Object.keys(RUNBOOKS), category).to.include(runbookKey(category));
      }
    });

    it("each quotes a text that files a failure under its category, not just the category's name", () => {
      // A category's name can mislead (a tester's "app crash" on Android is
      // mostly filed Element not found), so a runbook has to say what really
      // files a failure there: it must quote one of its rule's codes or
      // phrases. Only quoted text in the body counts: the title and the prose
      // around a quote would pass anything.
      for (const { category, codes, phrases } of FAILURE_RULES) {
        const { markdown } = RUNBOOKS[runbookKey(category)];
        const body = markdown.split('\n').slice(1).join(' ').replace(/\s+/g, ' ');
        const quoted = Array.from(body.matchAll(/"([^"]+)"/g), (m) => m[1].toLowerCase());
        const texts = [...codes, ...phrases];
        expect(
          texts.some((t) => quoted.some((q) => q.includes(t.toLowerCase()))),
          `the ${category} runbook quotes none of ${JSON.stringify(texts)}`,
        ).to.equal(true);
      }
    });

    it('every runbook is for a category a session can hold', () => {
      const stored = STORED.map(runbookKey);
      for (const key of Object.keys(RUNBOOKS)) {
        expect(stored, `runbook "${key}"`).to.include(key);
      }
    });

    it('a stored category opens its own runbook from the "Why it failed" card', () => {
      // failure-summary.tsx links /runbooks/<the category, lower case>.
      const linked = (category: string) => RUNBOOKS[runbookKey(category.toLowerCase())];
      expect(linked(HUB_RESTART_CATEGORY)?.title).to.equal('Hub restart');
      expect(linked('TIMEOUT')?.title).to.equal('Timeout');
      expect(linked('UNKNOWN')).to.equal(RUNBOOKS.unknown);
    });
  });
});
