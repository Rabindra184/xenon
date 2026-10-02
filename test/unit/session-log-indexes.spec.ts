import 'reflect-metadata';
import { expect } from 'chai';
import request from 'supertest';
import { ScratchDatabase, useScratchDatabase } from '../helpers/scratch-database';
import {
  ADMIN,
  MEMBER_A,
  SEL,
  seedSelectorHealth,
  selectorHealthApp,
} from '../helpers/selector-health-fixture';

/**
 * SessionLog holds every command of every session, so a read that scans it
 * costs as much as the lab's whole history: on a million commands, the
 * "To fix" list took 2.5 s and a session's own commands 80 ms. Each read
 * these pages make must find its rows through an index.
 */
describe('SessionLog is read through an index', function () {
  this.timeout(30_000);
  const scratch = useScratchDatabase({ captureQueries: true });

  before(async () => {
    await seedSelectorHealth(scratch.db);
  });

  /** How SQLite reads SessionLog in each statement `run` makes: one line per step. */
  async function sessionLogSteps(db: ScratchDatabase, run: () => Promise<unknown>) {
    db.queries.length = 0;
    await run();
    const steps: string[] = [];
    for (const q of db.queries.slice()) {
      if (!q.query.includes('`SessionLog`')) continue;
      // SQLite plans without looking at the values, and Prisma's logged
      // parameters aren't JSON, so every placeholder gets null.
      const placeholders = (q.query.match(/\?/g) ?? []).length;
      const plan = await db.db.$queryRawUnsafe<Array<{ detail: string }>>(
        `EXPLAIN QUERY PLAN ${q.query}`,
        ...new Array(placeholders).fill(null),
      );
      steps.push(...plan.map((p) => p.detail).filter((d) => /\bSessionLog\b/.test(d)));
    }
    return steps;
  }

  /** A step that walks the whole table, or a whole index of it. */
  const scans = (steps: string[]) => steps.filter((s) => /^SCAN (main\.)?SessionLog\b/.test(s));

  const get = (auth: Record<string, unknown>, path: string) => async () => {
    const res = await request(selectorHealthApp(auth)).get(path);
    expect(res.status, `${path}: ${res.text}`).to.equal(200);
  };

  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['the summary', ADMIN, '/healing/summary?windowDays=365&tz=330'],
    ["a member's summary", MEMBER_A, '/healing/summary?windowDays=30'],
    ['"To fix"', ADMIN, '/healing/selectors?tab=fix&days=365'],
    ['"To fix" with a search', ADMIN, '/healing/selectors?tab=fix&days=30&q=confirm'],
    ['"To fix" on one platform', ADMIN, '/healing/selectors?tab=fix&days=30&platform=android'],
    ["a member's \"To fix\"", MEMBER_A, '/healing/selectors?tab=fix&days=30'],
    ['"Fixed"', ADMIN, '/healing/selectors?tab=fixed&days=30'],
    ["a member's \"Fixed\"", MEMBER_A, '/healing/selectors?tab=fixed&days=30'],
    [
      'the panel',
      ADMIN,
      `/healing/selectors/detail?strategy=xpath&selector=${encodeURIComponent(SEL.hot)}&days=365`,
    ],
    [
      "a member's panel",
      MEMBER_A,
      `/healing/selectors/detail?strategy=xpath&selector=${encodeURIComponent(SEL.hot)}&days=30`,
    ],
    ["a session's commands", ADMIN, '/session/sh-s-shared-1/session_log'],
  ];

  for (const [name, auth, path] of cases) {
    it(`reads ${name} without a scan`, async () => {
      const steps = await sessionLogSteps(scratch, get(auth, path));
      expect(steps, 'no SessionLog statement was captured').to.not.be.empty;
      if (process.env.SHOW_PLANS) console.log(name, steps);
      expect(scans(steps), steps.join('\n')).to.deep.equal([]);
    });
  }
});
