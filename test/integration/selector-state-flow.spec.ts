import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PrismaClient } from '../../src/generated/client';
import { SelectorStateService } from '../../src/services/SelectorStateService';
import { SelectorVerificationJob } from '../../src/services/SelectorVerificationJob';
import { SocketEvents } from '../../src/enums/SocketEvents';

const STRATEGY = 'xpath';
const SELECTOR = 'login-btn';
const API_KEY_ID = 'ak-test';

/**
 * Full backend flow: markFixed → verifier → SELECTOR_RESOLVED, and
 * resolved → onHealRecorded → SELECTOR_REGRESSED.
 *
 * Uses a fresh on-disk SQLite file (created via `prisma migrate deploy`) so
 * the verifier's raw SQL exercises real schema, FKs, and indexes — not stubs.
 * Process-level DATABASE_URL is intentionally left untouched: the default
 * `src/prisma.ts` client memoizes its connection on first use, and mutating
 * the env here would leak this test DB into any sibling spec that imports it.
 */
describe('Selector state full flow (integration)', function () {
  this.timeout(60_000);
  let prisma: PrismaClient;
  let socketStub: { emitToDashboard: sinon.SinonStub };
  let stateService: SelectorStateService;
  let verifier: SelectorVerificationJob;
  let dbPath: string;

  function makeSession(id: string, opts: { build_id?: string | null; created?: Date } = {}) {
    const created = opts.created ?? new Date();
    return {
      id,
      build_id: opts.build_id ?? null,
      name: `s-${id}`,
      status: 'finished',
      desired_capabilities: '{}',
      session_capabilities: '{}',
      node_id: 'node-test',
      has_live_video: false,
      video_recording_enabled: false,
      device_udid: 'udid-test',
      device_platform: 'android',
      device_version: '13',
      device_name: 'pixel-test',
      startTime: created,
    };
  }

  before(async () => {
    dbPath = path.join(
      os.tmpdir(),
      `xenon-test-selector-state-${Date.now()}-${process.pid}.db`,
    );
    const url = `file:${dbPath}`;

    execSync('npx prisma migrate deploy', {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });

    prisma = new PrismaClient({ datasources: { db: { url } } });
    socketStub = { emitToDashboard: sinon.stub() };
    stateService = new SelectorStateService(prisma as any, socketStub);
    verifier = new SelectorVerificationJob(prisma as any, socketStub);
  });

  after(async () => {
    if (prisma) await prisma.$disconnect();
    if (dbPath && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  beforeEach(async () => {
    socketStub.emitToDashboard.resetHistory();
    // SessionLog → Session → Build — delete children before parents.
    await prisma.sessionLog.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.build.deleteMany({});
    await prisma.selectorState.deleteMany({});
  });

  it('markFixed → 3 clean CI builds → verifier promotes to Resolved', async () => {
    // 14 prior heals on the tuple, simulating the history that earned this
    // selector its place in the maintainer queue before the user fixed it.
    const preSession = await prisma.session.create({
      data: makeSession('s-pre', { created: new Date('2026-04-20T00:00:00Z') }),
    });
    for (let i = 0; i < 14; i++) {
      await prisma.sessionLog.create({
        data: {
          session_id: preSession.id,
          command_name: 'findElement',
          url: '/findElement',
          method: 'POST',
          title: 'Find',
          response: '{}',
          body: '["xpath","login-btn"]',
          is_healed: true,
          original_strategy: STRATEGY,
          original_selector: SELECTOR,
          healed_strategy: 'accessibility id',
          healed_selector: 'login-btn',
          healing_confidence: 0.9,
          healing_tier: 'LLM',
        },
      });
    }

    const fixed = await stateService.markFixed({
      strategy: STRATEGY,
      selector: SELECTOR,
      apiKeyId: API_KEY_ID,
    });
    expect(fixed.status).to.equal('pending');
    expect(fixed.fixed_at).to.be.instanceOf(Date);
    expect(socketStub.emitToDashboard.lastCall.args[0]).to.equal(SocketEvents.SELECTOR_FIXED);

    // Three distinct CI builds, each with one un-healed findElement on the tuple.
    for (const buildId of ['b-1', 'b-2', 'b-3']) {
      const sid = `s-${buildId}`;
      await prisma.build.create({ data: { id: buildId, name: buildId } });
      await prisma.session.create({ data: makeSession(sid, { build_id: buildId }) });
      await prisma.sessionLog.create({
        data: {
          session_id: sid,
          command_name: 'findElement',
          url: '/findElement',
          method: 'POST',
          title: 'Find',
          response: '{}',
          body: '["xpath","login-btn"]',
          is_healed: false,
          original_strategy: STRATEGY,
          original_selector: SELECTOR,
        },
      });
    }

    await verifier.run();

    const final = await prisma.selectorState.findUnique({
      where: {
        original_strategy_original_selector: {
          original_strategy: STRATEGY,
          original_selector: SELECTOR,
        },
      },
    });
    expect(final, 'state row exists').to.not.be.null;
    expect(final!.status).to.equal('resolved');
    expect(final!.clean_builds_count).to.equal(3);
    expect(final!.resolved_at).to.be.instanceOf(Date);

    const resolvedEmits = socketStub.emitToDashboard
      .getCalls()
      .filter((c) => c.args[0] === SocketEvents.SELECTOR_RESOLVED);
    expect(resolvedEmits.length).to.equal(1);
  });

  it('Resolved → onHealRecorded → reverts to Active with regression_count=1', async () => {
    await prisma.selectorState.create({
      data: {
        original_strategy: STRATEGY,
        original_selector: SELECTOR,
        status: 'resolved',
        fixed_at: new Date('2026-04-20T00:00:00Z'),
        fixed_by_api_key: API_KEY_ID,
        resolved_at: new Date('2026-04-22T00:00:00Z'),
        clean_builds_count: 3,
        regression_count: 0,
      },
    });

    await stateService.onHealRecorded({
      strategy: STRATEGY,
      selector: SELECTOR,
      sessionId: 's-regression',
    });

    const after = await prisma.selectorState.findUnique({
      where: {
        original_strategy_original_selector: {
          original_strategy: STRATEGY,
          original_selector: SELECTOR,
        },
      },
    });
    expect(after, 'state row still exists').to.not.be.null;
    expect(after!.status).to.equal('active');
    expect(after!.regression_count).to.equal(1);
    expect(after!.resolved_at).to.be.null;
    expect(after!.fixed_at).to.be.null;
    expect(socketStub.emitToDashboard.lastCall.args[0]).to.equal(SocketEvents.SELECTOR_REGRESSED);
  });
});
