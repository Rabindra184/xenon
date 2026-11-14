import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';

import { SelectorVerificationJob } from '../../src/services/SelectorVerificationJob';

/**
 * Verifier-job unit tests.
 *
 * The job's only public method is `run()`, which:
 *   1. Loads every SelectorState row with status='pending'
 *   2. For each row, runs a $queryRaw aggregating per-build_id heal status
 *      since fixed_at
 *   3. If 3+ distinct clean build_ids → promote to Resolved + emit
 *      SELECTOR_RESOLVED
 *   4. Else if clean_builds_count changed → emit SELECTOR_PROGRESS
 *
 * Constructor accepts injected (prisma, socket) for testability — same
 * pattern as SelectorStateService.
 */
describe('SelectorVerificationJob.run', () => {
  let prismaStub: any;
  let socketStub: any;
  let job: SelectorVerificationJob;

  beforeEach(() => {
    prismaStub = {
      selectorState: {
        findMany: sinon.stub(),
        // Writes are conditional on the row being as the run read it; the
        // row written is read back for the event.
        updateMany: sinon.stub().resolves({ count: 1 }),
        findUnique: sinon.stub().resolves({}),
      },
      selectorEvent: { create: sinon.stub().resolves({}) },
      // No heal since any selector was marked fixed: see
      // selector-verification-missed-regression.spec.ts for one.
      sessionLog: { findFirst: sinon.stub().resolves(null) },
      $queryRaw: sinon.stub(),
    };
    prismaStub.$transaction = sinon
      .stub()
      .callsFake((fn: (tx: unknown) => Promise<unknown>) => fn(prismaStub));
    socketStub = { emitToDashboardForSelector: sinon.stub().resolves() };
    job = new SelectorVerificationJob(prismaStub, socketStub);
  });

  afterEach(() => sinon.restore());

  it('promotes a Pending row to Resolved when 3 distinct clean build_ids exist', async () => {
    prismaStub.selectorState.findMany.resolves([
      {
        id: 'r-1',
        original_strategy: 'xpath',
        original_selector: '//x',
        status: 'pending',
        fixed_at: new Date('2026-04-20T00:00:00Z'),
        clean_builds_count: 0,
      },
    ]);
    prismaStub.$queryRaw.resolves([
      { build_id: 'b-1', healed: 0, found: 1 },
      { build_id: 'b-2', healed: 0, found: 1 },
      { build_id: 'b-3', healed: 0, found: 1 },
    ]);
    prismaStub.selectorState.findUnique.resolves({
      id: 'r-1',
      original_strategy: 'xpath',
      original_selector: '//x',
      status: 'resolved',
      clean_builds_count: 3,
      resolved_at: new Date(),
    });

    await job.run();

    expect(prismaStub.selectorState.updateMany.calledOnce).to.be.true;
    const updateArg = prismaStub.selectorState.updateMany.firstCall.args[0];
    // Only while it is still pending under the fix the run read.
    expect(updateArg.where).to.deep.equal({
      id: 'r-1',
      status: 'pending',
      fixed_at: new Date('2026-04-20T00:00:00Z'),
    });
    expect(updateArg.data.status).to.equal('resolved');
    expect(updateArg.data.resolved_at).to.be.instanceOf(Date);
    expect(updateArg.data.clean_builds_count).to.equal(3);
    expect(socketStub.emitToDashboardForSelector.calledOnce).to.be.true;
    expect(socketStub.emitToDashboardForSelector.firstCall.args[0]).to.equal('selector_resolved');
    // Named, so only the dashboards that may see the selector get it.
    expect(socketStub.emitToDashboardForSelector.firstCall.args[2]).to.deep.equal({
      strategy: 'xpath',
      selector: '//x',
    });
  });

  it('updates clean_builds_count and emits PROGRESS when below 3 and value changed', async () => {
    prismaStub.selectorState.findMany.resolves([
      {
        id: 'r-1',
        original_strategy: 'xpath',
        original_selector: '//x',
        status: 'pending',
        fixed_at: new Date('2026-04-20T00:00:00Z'),
        clean_builds_count: 0,
      },
    ]);
    prismaStub.$queryRaw.resolves([
      { build_id: 'b-1', healed: 0, found: 1 },
      { build_id: 'b-2', healed: 1, found: 1 }, // not clean
    ]);
    prismaStub.selectorState.findUnique.resolves({
      id: 'r-1',
      status: 'pending',
      clean_builds_count: 1,
    });

    await job.run();

    const updateArg = prismaStub.selectorState.updateMany.firstCall.args[0];
    expect(updateArg.data.status).to.be.undefined;
    expect(updateArg.data.clean_builds_count).to.equal(1);
    expect(socketStub.emitToDashboardForSelector.firstCall.args[0]).to.equal('selector_progress');
    expect(socketStub.emitToDashboardForSelector.firstCall.args[2]).to.deep.equal({
      strategy: 'xpath',
      selector: '//x',
    });
  });

  it('records and sends nothing when the row changed during the run', async () => {
    prismaStub.selectorState.findMany.resolves([
      {
        id: 'r-1',
        original_strategy: 'xpath',
        original_selector: '//x',
        status: 'pending',
        fixed_at: new Date('2026-04-20T00:00:00Z'),
        clean_builds_count: 0,
      },
    ]);
    prismaStub.$queryRaw.resolves([
      { build_id: 'b-1', healed: 0, found: 1 },
      { build_id: 'b-2', healed: 0, found: 1 },
      { build_id: 'b-3', healed: 0, found: 1 },
    ]);
    prismaStub.selectorState.updateMany.resolves({ count: 0 });

    await job.run();

    expect(prismaStub.selectorState.updateMany.calledOnce).to.be.true;
    expect(prismaStub.selectorEvent.create.called).to.be.false;
    expect(socketStub.emitToDashboardForSelector.called).to.be.false;
  });

  it('does not write or emit when clean_builds_count is unchanged and not promoting', async () => {
    prismaStub.selectorState.findMany.resolves([
      {
        id: 'r-1',
        original_strategy: 'xpath',
        original_selector: '//x',
        status: 'pending',
        fixed_at: new Date('2026-04-20T00:00:00Z'),
        clean_builds_count: 1,
      },
    ]);
    prismaStub.$queryRaw.resolves([
      { build_id: 'b-1', healed: 0, found: 1 },
      { build_id: 'b-2', healed: 1, found: 1 },
    ]);

    await job.run();

    expect(prismaStub.selectorState.updateMany.called).to.be.false;
    expect(socketStub.emitToDashboardForSelector.called).to.be.false;
  });

  it('SQL filters out builds with NULL build_id and only counts findElement(s) commands', async () => {
    prismaStub.selectorState.findMany.resolves([
      {
        id: 'r-1',
        original_strategy: 'xpath',
        original_selector: '//x',
        status: 'pending',
        fixed_at: new Date('2026-04-20T00:00:00Z'),
        clean_builds_count: 0,
      },
    ]);
    let capturedSql = '';
    prismaStub.$queryRaw.callsFake((tpl: any) => {
      capturedSql = Array.isArray(tpl) ? tpl.join('?') : String(tpl);
      return Promise.resolve([]);
    });

    await job.run();

    expect(prismaStub.$queryRaw.calledOnce).to.be.true;
    expect(capturedSql).to.match(/build_id/i);
    expect(capturedSql).to.match(/IS\s+NOT\s+NULL/i);
    expect(capturedSql).to.match(/findElement/);
    expect(capturedSql).to.match(/findElements/);
  });

  it('skips processing when no rows are pending', async () => {
    prismaStub.selectorState.findMany.resolves([]);

    await job.run();

    expect(prismaStub.$queryRaw.called).to.be.false;
    expect(prismaStub.selectorState.updateMany.called).to.be.false;
    expect(socketStub.emitToDashboardForSelector.called).to.be.false;
  });

  it('continues processing remaining rows if one fails', async () => {
    prismaStub.selectorState.findMany.resolves([
      {
        id: 'r-1',
        original_strategy: 'xpath',
        original_selector: '//a',
        status: 'pending',
        fixed_at: new Date('2026-04-20T00:00:00Z'),
        clean_builds_count: 0,
      },
      {
        id: 'r-2',
        original_strategy: 'xpath',
        original_selector: '//b',
        status: 'pending',
        fixed_at: new Date('2026-04-20T00:00:00Z'),
        clean_builds_count: 0,
      },
    ]);
    prismaStub.$queryRaw.onFirstCall().rejects(new Error('boom'));
    prismaStub.$queryRaw.onSecondCall().resolves([
      { build_id: 'b-1', healed: 0, found: 1 },
      { build_id: 'b-2', healed: 0, found: 1 },
      { build_id: 'b-3', healed: 0, found: 1 },
    ]);
    prismaStub.selectorState.findUnique.resolves({
      id: 'r-2',
      status: 'resolved',
      clean_builds_count: 3,
    });

    await job.run();

    expect(prismaStub.selectorState.updateMany.calledOnce).to.be.true;
    expect(prismaStub.selectorState.updateMany.firstCall.args[0].where.id).to.equal('r-2');
  });

  it('skips rows missing fixed_at (defensive)', async () => {
    prismaStub.selectorState.findMany.resolves([
      {
        id: 'r-1',
        original_strategy: 'xpath',
        original_selector: '//x',
        status: 'pending',
        fixed_at: null,
        clean_builds_count: 0,
      },
    ]);

    await job.run();

    expect(prismaStub.$queryRaw.called).to.be.false;
  });

  // The cron starts a run every 15 minutes whether or not the last one has
  // finished. Through 2.36 a slow run overlapped the next, and both promoted
  // and counted the same rows.
  it('runs once at a time: a run asked for during one starts nothing of its own', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    prismaStub.selectorState.findMany.onFirstCall().callsFake(async () => {
      await gate;
      return [];
    });
    prismaStub.selectorState.findMany.resolves([]);

    const first = job.run();
    const second = job.run();
    release();
    await Promise.all([first, second]);
    // One run reads the pending rows, then the resolved ones.
    expect(prismaStub.selectorState.findMany.callCount).to.equal(2);

    // Once it has finished, the next run runs.
    await job.run();
    expect(prismaStub.selectorState.findMany.callCount).to.equal(4);
  });

  it('runs again after a run that failed', async () => {
    prismaStub.selectorState.findMany.onFirstCall().rejects(new Error('database gone'));
    prismaStub.selectorState.findMany.resolves([]);

    let thrown: unknown;
    await job.run().catch((err) => (thrown = err));
    expect((thrown as Error)?.message).to.equal('database gone');

    await job.run();
    expect(prismaStub.selectorState.findMany.callCount).to.equal(3);
  });

  it('records the verification, with nobody as its person', async () => {
    prismaStub.selectorState.findMany.resolves([
      {
        id: 'r-1',
        original_strategy: 'xpath',
        original_selector: '//x',
        status: 'pending',
        fixed_at: new Date('2026-04-20T00:00:00Z'),
        clean_builds_count: 2,
      },
    ]);
    prismaStub.$queryRaw.resolves([
      { build_id: 'b-1', healed: 0, found: 1 },
      { build_id: 'b-2', healed: 0, found: 1 },
      { build_id: 'b-3', healed: 0, found: 1 },
    ]);
    prismaStub.selectorState.findUnique.resolves({
      id: 'r-1',
      original_strategy: 'xpath',
      original_selector: '//x',
      status: 'resolved',
      clean_builds_count: 3,
      resolved_at: new Date(),
    });

    await job.run();

    expect(prismaStub.selectorEvent.create.calledOnce).to.equal(true);
    expect(prismaStub.selectorEvent.create.firstCall.args[0].data).to.deep.equal({
      original_strategy: 'xpath',
      original_selector: '//x',
      action: 'verified',
      user_id: null,
      reason: null,
    });
  });
});
