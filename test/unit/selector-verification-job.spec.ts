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
        update: sinon.stub().resolves({}),
      },
      $queryRaw: sinon.stub(),
    };
    socketStub = { emitToDashboard: sinon.stub() };
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
      { build_id: 'b-1', healed: 0 },
      { build_id: 'b-2', healed: 0 },
      { build_id: 'b-3', healed: 0 },
    ]);
    prismaStub.selectorState.update.resolves({
      id: 'r-1',
      original_strategy: 'xpath',
      original_selector: '//x',
      status: 'resolved',
      clean_builds_count: 3,
      resolved_at: new Date(),
    });

    await job.run();

    expect(prismaStub.selectorState.update.calledOnce).to.be.true;
    const updateArg = prismaStub.selectorState.update.firstCall.args[0];
    expect(updateArg.where).to.deep.equal({ id: 'r-1' });
    expect(updateArg.data.status).to.equal('resolved');
    expect(updateArg.data.resolved_at).to.be.instanceOf(Date);
    expect(updateArg.data.clean_builds_count).to.equal(3);
    expect(socketStub.emitToDashboard.calledOnce).to.be.true;
    expect(socketStub.emitToDashboard.firstCall.args[0]).to.equal('selector_resolved');
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
      { build_id: 'b-1', healed: 0 },
      { build_id: 'b-2', healed: 1 }, // not clean
    ]);
    prismaStub.selectorState.update.resolves({
      id: 'r-1',
      status: 'pending',
      clean_builds_count: 1,
    });

    await job.run();

    const updateArg = prismaStub.selectorState.update.firstCall.args[0];
    expect(updateArg.data.status).to.be.undefined;
    expect(updateArg.data.clean_builds_count).to.equal(1);
    expect(socketStub.emitToDashboard.firstCall.args[0]).to.equal('selector_progress');
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
      { build_id: 'b-1', healed: 0 },
      { build_id: 'b-2', healed: 1 },
    ]);

    await job.run();

    expect(prismaStub.selectorState.update.called).to.be.false;
    expect(socketStub.emitToDashboard.called).to.be.false;
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
    expect(prismaStub.selectorState.update.called).to.be.false;
    expect(socketStub.emitToDashboard.called).to.be.false;
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
      { build_id: 'b-1', healed: 0 },
      { build_id: 'b-2', healed: 0 },
      { build_id: 'b-3', healed: 0 },
    ]);
    prismaStub.selectorState.update.resolves({
      id: 'r-2',
      status: 'resolved',
      clean_builds_count: 3,
    });

    await job.run();

    expect(prismaStub.selectorState.update.calledOnce).to.be.true;
    expect(prismaStub.selectorState.update.firstCall.args[0].where.id).to.equal('r-2');
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
});
