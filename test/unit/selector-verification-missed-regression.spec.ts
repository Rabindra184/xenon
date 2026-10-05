import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { useScratchDatabase } from '../helpers/scratch-database';
import { SelectorVerificationJob } from '../../src/services/SelectorVerificationJob';

const HOUR = 60 * 60 * 1000;

/**
 * A heal of a selector someone marked fixed turns it back to "To fix" at once
 * (SelectorStateService.onHealRecorded, called after the heal is written). That
 * call can fail, say on a busy database, and nothing tried again: the selector
 * stayed "being verified", and was even promoted to fixed once three other
 * builds ran clean. The verification job now catches such a heal.
 */
describe('SelectorVerificationJob catches a heal the live check missed', function () {
  this.timeout(90_000);
  const scratch = useScratchDatabase();
  let socket: { emitToDashboardForSelector: sinon.SinonStub };

  const now = Date.now();
  const fixedAt = new Date(now - 48 * HOUR);

  before(async () => {
    for (const b of ['mr-b1', 'mr-b2', 'mr-b3', 'mr-b4']) {
      await scratch.db.build.create({ data: { id: b, name: b } });
      await scratch.db.session.create({
        data: {
          id: `mr-s-${b}`,
          build_id: b,
          device_udid: 'mr-phone',
          device_platform: 'android',
          device_version: '14',
          desired_capabilities: '{}',
          session_capabilities: '{}',
          node_id: 'localhost',
          has_live_video: false,
        },
      });
    }
  });

  beforeEach(async () => {
    await scratch.db.selectorEvent.deleteMany();
    await scratch.db.selectorState.deleteMany();
    await scratch.db.sessionLog.deleteMany();
    socket = { emitToDashboardForSelector: sinon.stub().resolves() };
  });

  const find = (build: string, selector: string, healed: boolean, at: number) =>
    scratch.db.sessionLog.create({
      data: {
        session_id: `mr-s-${build}`,
        command_name: 'findElement',
        url: '/element',
        method: 'POST',
        title: 'Find element',
        response: '{}',
        is_healed: healed,
        original_strategy: 'xpath',
        original_selector: selector,
        createdAt: new Date(at),
      },
    });

  const state = (selector: string, status: 'pending' | 'resolved') =>
    scratch.db.selectorState.create({
      data: {
        original_strategy: 'xpath',
        original_selector: selector,
        status,
        fixed_at: fixedAt,
        resolved_at: status === 'resolved' ? new Date(now - 24 * HOUR) : null,
        clean_builds_count: status === 'resolved' ? 3 : 0,
      },
    });

  const run = () => new SelectorVerificationJob(scratch.db as never, socket).run();

  const rowOf = (selector: string) =>
    scratch.db.selectorState.findUniqueOrThrow({
      where: {
        original_strategy_original_selector: {
          original_strategy: 'xpath',
          original_selector: selector,
        },
      },
    });

  const actionsOf = async (selector: string) =>
    (
      await scratch.db.selectorEvent.findMany({
        where: { original_selector: selector },
        orderBy: { createdAt: 'asc' },
      })
    ).map((e) => e.action);

  it('sends a selector being verified back to fix, rather than promoting it', async () => {
    await state('//pending/broke', 'pending');
    // Three clean builds since it was marked fixed, and one that healed.
    for (const b of ['mr-b1', 'mr-b2', 'mr-b3'])
      await find(b, '//pending/broke', false, now - HOUR);
    await find('mr-b4', '//pending/broke', true, now - 2 * HOUR);

    await run();

    const row = await rowOf('//pending/broke');
    expect(row).to.include({ status: 'active', regression_count: 1, clean_builds_count: 0 });
    expect(row.fixed_at).to.equal(null);
    expect(await actionsOf('//pending/broke')).to.deep.equal(['broke_again']);
    expect(socket.emitToDashboardForSelector.firstCall.args[0]).to.equal('selector_regressed');
  });

  it('sends a fixed selector back to fix', async () => {
    await state('//resolved/broke', 'resolved');
    await find('mr-b1', '//resolved/broke', true, now - HOUR);

    await run();

    const row = await rowOf('//resolved/broke');
    expect(row).to.include({ status: 'active', regression_count: 1 });
    expect(row.resolved_at).to.equal(null);
    expect(await actionsOf('//resolved/broke')).to.deep.equal(['broke_again']);
  });

  it('leaves alone a selector that healed only before it was marked fixed', async () => {
    await state('//pending/clean', 'pending');
    await state('//resolved/clean', 'resolved');
    await find('mr-b1', '//pending/clean', true, fixedAt.getTime() - HOUR);
    await find('mr-b1', '//resolved/clean', true, fixedAt.getTime() - HOUR);
    for (const b of ['mr-b1', 'mr-b2', 'mr-b3'])
      await find(b, '//pending/clean', false, now - HOUR);

    await run();

    expect((await rowOf('//pending/clean')).status).to.equal('resolved');
    expect((await rowOf('//resolved/clean')).status).to.equal('resolved');
    expect(await actionsOf('//pending/clean')).to.deep.equal(['verified']);
    expect(await actionsOf('//resolved/clean')).to.deep.equal([]);
  });
});
