import 'reflect-metadata';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { swaggerSpec } from '../../src/app/swagger';
import {
  ANALYSIS_CATEGORIES,
  ERROR_PATTERNS,
} from '../../src/dashboard/services/failure-analysis-service';
import { HUB_RESTART_CATEGORY } from '../../src/sessions/SessionManager';

/**
 * A Session's `failure_category` is written in two places: the failure
 * analysis (one of ANALYSIS_CATEGORIES) and a restart's recovery
 * (HUB_RESTART). Both write upper case.
 *
 * The API reference showed `element_not_found`, a value the server never
 * writes, and the dashboard had a runbook for "Infrastructure", a category
 * nothing ever assigns. These hold both to what the server writes.
 */

const WRITTEN = [...ANALYSIS_CATEGORIES, HUB_RESTART_CATEGORY];

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

    it("the session record's description names every category, and no other", () => {
      const described = valuesUnder(swaggerSpec, 'failure_category')
        .filter((v): v is { description: string } => !!(v as any)?.description)
        .map((v) => v.description);
      expect(described).to.have.length(1);
      const named = Array.from(described[0].matchAll(/`([A-Z_]+)`/g), (m) => m[1]);
      expect([...named].sort()).to.deep.equal([...WRITTEN].sort());
    });
  });

  describe("in the dashboard's runbooks", () => {
    it('every category the server writes has a runbook of its own', () => {
      for (const category of WRITTEN) {
        expect(Object.keys(RUNBOOKS), category).to.include(runbookKey(category));
      }
    });

    it("each quotes a text that files a failure under its category, not just the category's name", () => {
      // The names mislead: "Xenon command failure" is a "command failed"
      // message, rarely Xenon's, and few real crashes are worded the way App
      // crash's patterns expect. A runbook has to say what really files a
      // failure there, so it must quote one of its category's texts. Only
      // quoted text in the body counts: the title ("# WDA failure") and the
      // prose around a quote ("says a command failed") would pass anything.
      for (const { category, patterns } of ERROR_PATTERNS) {
        const { markdown } = RUNBOOKS[runbookKey(category)];
        const body = markdown.split('\n').slice(1).join(' ').replace(/\s+/g, ' ');
        const quoted = Array.from(body.matchAll(/"([^"]+)"/g), (m) => m[1]);
        expect(
          patterns.some((p) => quoted.some((q) => new RegExp(p, 'i').test(q))),
          `the ${category} runbook quotes none of ${JSON.stringify(patterns)}`,
        ).to.equal(true);
      }
    });

    it('every runbook is for a category the server writes', () => {
      const written = WRITTEN.map(runbookKey);
      for (const key of Object.keys(RUNBOOKS)) {
        expect(written, `runbook "${key}"`).to.include(key);
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
