import 'reflect-metadata';
import { expect } from 'chai';
import request from 'supertest';
import { Container } from 'typedi';
import { CleanupService } from '../../src/services/CleanupService';
import { SelectorVerificationJob } from '../../src/services/SelectorVerificationJob';
import { ScratchDatabase, useScratchDatabase } from '../helpers/scratch-database';
import {
  ADMIN,
  MEMBER_A,
  SEL,
  seedSelectorHealth,
  selectorHealthApp,
} from '../helpers/selector-health-fixture';

/** The SQL statements `run` makes. */
async function sqlOf(db: ScratchDatabase, run: () => Promise<unknown>) {
  db.queries.length = 0;
  await run();
  return db.queries.slice();
}

/** How SQLite reads `table` in these statements: one line per step. */
async function stepsOn(db: ScratchDatabase, table: string, queries: ScratchDatabase['queries']) {
  const steps: string[] = [];
  for (const q of queries) {
    // Prisma's own SQL quotes names with backticks; a raw query's, with ".
    if (!q.query.includes(`\`${table}\``) && !q.query.includes(`"${table}"`)) continue;
    // SQLite plans without looking at the values, and Prisma's logged
    // parameters aren't JSON, so every placeholder gets null.
    const placeholders = (q.query.match(/\?/g) ?? []).length;
    const plan = await db.db.$queryRawUnsafe<Array<{ detail: string }>>(
      `EXPLAIN QUERY PLAN ${q.query}`,
      ...new Array(placeholders).fill(null),
    );
    // A raw query may name the table by an alias (`"SessionLog" sl`), which
    // is what SQLite's plan then says.
    const alias = q.query.match(new RegExp(`"${table}"\\s+(?:AS\\s+)?(\\w+)`, 'i'))?.[1];
    for (const { detail } of plan) {
      const named = alias ? detail.replace(new RegExp(`\\b${alias}\\b`), table) : detail;
      if (new RegExp(`\\b${table}\\b`).test(named)) steps.push(named);
    }
  }
  return steps;
}

/** The steps that walk the whole table, or a whole index of it. */
const scansOf = (table: string, steps: string[]) =>
  steps.filter((s) => new RegExp(`^SCAN (main\\.)?${table}\\b`).test(s));

const getAs = (auth: Record<string, unknown>, path: string) => async () => {
  const res = await request(selectorHealthApp(auth)).get(path);
  expect(res.status, `${path}: ${res.text}`).to.equal(200);
};

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

  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['the summary', ADMIN, '/healing/summary?windowDays=365&tz=330'],
    ["a member's summary", MEMBER_A, '/healing/summary?windowDays=30'],
    ['"To fix"', ADMIN, '/healing/selectors?tab=fix&days=365'],
    ['"To fix" with a search', ADMIN, '/healing/selectors?tab=fix&days=30&q=confirm'],
    ['"To fix" on one platform', ADMIN, '/healing/selectors?tab=fix&days=30&platform=android'],
    ['a member\'s "To fix"', MEMBER_A, '/healing/selectors?tab=fix&days=30'],
    ['"Fixed"', ADMIN, '/healing/selectors?tab=fixed&days=30'],
    ['a member\'s "Fixed"', MEMBER_A, '/healing/selectors?tab=fixed&days=30'],
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
      const steps = await stepsOn(scratch, 'SessionLog', await sqlOf(scratch, getAs(auth, path)));
      expect(steps, 'no SessionLog statement was captured').to.not.be.empty;
      expect(scansOf('SessionLog', steps), steps.join('\n')).to.deep.equal([]);
    });
  }
});

/**
 * A session's device logs (hundreds of lines a session) and the profiling
 * rows sessions wrote before 2.10 are read by session on every session page,
 * and deleted by session in cleanup. Neither table had an index on it.
 */
describe("A session's logs and profiling are read through an index", function () {
  this.timeout(30_000);
  const scratch = useScratchDatabase({ captureQueries: true });

  before(async () => {
    await scratch.db.build.create({ data: { id: 'ix-build', name: 'ix' } });
    await scratch.db.session.create({
      data: {
        id: 'ix-session',
        build_id: 'ix-build',
        device_udid: 'ix-phone',
        device_platform: 'android',
        device_version: '14',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'localhost',
        has_live_video: false,
      },
    });
    await scratch.db.log.createMany({
      data: [
        { session_id: 'ix-session', log_type: 'DEVICE', message: 'I/ActivityManager: start' },
        { session_id: 'ix-session', log_type: 'DEBUG', message: 'step 1' },
      ],
    });
    await scratch.db.profiling.create({
      data: { session_id: 'ix-session', cpu: '12', memory: '200', timestamp: new Date() },
    });
  });

  const reads: Array<[string, string, string]> = [
    ['device logs', 'Log', '/session/ix-session/logs/device'],
    ['debug logs', 'Log', '/session/ix-session/logs/debug'],
    ['profiling', 'Profiling', '/session/ix-session/profiling'],
  ];

  for (const [name, table, path] of reads) {
    it(`reads a session's ${name} without a scan`, async () => {
      const steps = await stepsOn(scratch, table, await sqlOf(scratch, getAs(ADMIN, path)));
      expect(steps, `no ${table} statement was captured`).to.not.be.empty;
      expect(scansOf(table, steps), steps.join('\n')).to.deep.equal([]);
    });
  }

  it("deletes a session's commands, logs and profiling without a scan", async () => {
    const ran = await sqlOf(scratch, () =>
      Container.get(CleanupService).purgeBuild('ix-build', false),
    );
    for (const table of ['SessionLog', 'Log', 'Profiling']) {
      const steps = await stepsOn(scratch, table, ran);
      expect(steps, `no ${table} statement was captured`).to.not.be.empty;
      expect(scansOf(table, steps), `${table}:\n${steps.join('\n')}`).to.deep.equal([]);
    }
  });
});

/**
 * The selector verification reads every find of a selector being verified
 * since it was marked fixed (SelectorVerificationJob), every 15 minutes, by
 * the selector's own index.
 */
describe('The selector verification reads SessionLog through an index', function () {
  this.timeout(30_000);
  const scratch = useScratchDatabase({ captureQueries: true });

  before(async () => {
    await scratch.db.build.create({ data: { id: 'sv-build', name: 'sv' } });
    await scratch.db.session.create({
      data: {
        id: 'sv-session',
        build_id: 'sv-build',
        device_udid: 'sv-phone',
        device_platform: 'android',
        device_version: '14',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'localhost',
        has_live_video: false,
      },
    });
    await scratch.db.sessionLog.create({
      data: {
        session_id: 'sv-session',
        command_name: 'findElement',
        url: '/findElement',
        method: 'POST',
        title: 'Find element',
        response: '{"value":{"ELEMENT":"e-1"}}',
        original_strategy: 'xpath',
        original_selector: '//sv',
      },
    });
    await scratch.db.selectorState.create({
      data: {
        original_strategy: 'xpath',
        original_selector: '//sv',
        status: 'pending',
        fixed_at: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
  });

  it("reads a selector's finds without a scan", async () => {
    const socket = { emitToDashboard: () => undefined };
    const ran = await sqlOf(scratch, () =>
      new SelectorVerificationJob(scratch.db as never, socket).run(),
    );
    const steps = await stepsOn(scratch, 'SessionLog', ran);
    expect(steps, 'no SessionLog statement was captured').to.not.be.empty;
    expect(scansOf('SessionLog', steps), steps.join('\n')).to.deep.equal([]);
  });
});
