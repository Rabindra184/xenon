import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { useScratchDatabase } from '../helpers/scratch-database';
import { SelectorVerificationJob } from '../../src/services/SelectorVerificationJob';

/**
 * A heal that broke a selector again is one recorded after it was marked
 * fixed. The job compared with `createdAt >= fixed_at`, so a heal recorded in
 * the same millisecond as the fix (the heal that made someone mark it fixed,
 * written just before) counted as breaking it again, and the selector went
 * back to "To fix" with its three clean builds. Seen as a flaky
 * selector-state-flow spec: it records its heals, then marks the selector
 * fixed, often within one millisecond.
 */
describe('The verification job and a heal at the moment of the fix', function () {
  this.timeout(60_000);
  const scratch = useScratchDatabase();
  const STRATEGY = 'xpath';
  const SELECTOR = '//boundary-btn';
  const fixedAt = new Date(Date.now() - 60_000);

  beforeEach(async () => {
    await scratch.db.selectorEvent.deleteMany();
    await scratch.db.selectorState.deleteMany();
    await scratch.db.sessionLog.deleteMany();
    await scratch.db.session.deleteMany();
    await scratch.db.session.create({
      data: {
        id: 'vb-s',
        device_udid: 'vb-phone',
        device_platform: 'android',
        device_version: '14',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'localhost',
        has_live_video: false,
      },
    });
    await scratch.db.selectorState.create({
      data: {
        original_strategy: STRATEGY,
        original_selector: SELECTOR,
        status: 'pending',
        fixed_at: fixedAt,
        clean_builds_count: 0,
        regression_count: 0,
        last_event_at: fixedAt,
      },
    });
  });

  const heal = (createdAt: Date) =>
    scratch.db.sessionLog.create({
      data: {
        session_id: 'vb-s',
        command_name: 'findElement',
        url: '/element',
        method: 'POST',
        title: 'Find element',
        response: '{}',
        is_healed: true,
        original_strategy: STRATEGY,
        original_selector: SELECTOR,
        healing_tier: 'LLM',
        createdAt,
      },
    });

  const run = () =>
    new SelectorVerificationJob(
      scratch.db as never,
      {
        emitToDashboardForSelector: sinon.stub().resolves(),
      } as never,
    ).run();

  const status = async () =>
    (
      await scratch.db.selectorState.findFirst({
        where: { original_strategy: STRATEGY, original_selector: SELECTOR },
      })
    )?.status;

  it('a heal recorded in the same millisecond as the fix is not breaking it again', async () => {
    await heal(new Date(fixedAt.getTime()));
    await run();
    expect(await status()).to.equal('pending');
  });

  it('a heal recorded after the fix still sends it back to To fix', async () => {
    await heal(new Date(fixedAt.getTime() + 1));
    await run();
    expect(await status()).to.equal('active');
  });
});
