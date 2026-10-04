import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { useScratchDatabase } from '../helpers/scratch-database';
import { SelectorVerificationJob } from '../../src/services/SelectorVerificationJob';

const HOUR = 60 * 60 * 1000;
const ELEMENT = '{"value":{"element-6066-11e4-a52e-4f735466cecf":"e-1"},"sessionId":"s"}';
const ELEMENTS = '{"value":[{"element-6066-11e4-a52e-4f735466cecf":"e-1"}],"sessionId":"s"}';
const EMPTY_LIST = '{"value":[],"sessionId":"s"}';
const NOT_FOUND =
  '{"value":{"error":"An element could not be located on the page"},"sessionId":"s"}';

/**
 * A clean build is one where the selector was found without healing. Through
 * 2.14 it was any build with a find of the selector that didn't heal, so a
 * selector whose find failed outright in three builds was verified as fixed.
 * The rows are the ones the dashboard writes (event-manager.afterSessionCommand):
 * a failed find has `is_error` and an error body, an empty findElements has
 * `{"value":[]}`, and the real SQL runs against a scratch database.
 */
describe('SelectorVerificationJob counts only builds where the selector was found', function () {
  this.timeout(90_000);
  const scratch = useScratchDatabase();
  let socket: { emitToDashboard: sinon.SinonStub };

  const now = Date.now();
  const fixedAt = new Date(now - 48 * HOUR);
  const builds = ['cb-b1', 'cb-b2', 'cb-b3'];

  before(async () => {
    for (const b of builds) {
      await scratch.db.build.create({ data: { id: b, name: b } });
      await scratch.db.session.create({
        data: {
          id: `cb-s-${b}`,
          build_id: b,
          device_udid: 'cb-phone',
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
    socket = { emitToDashboard: sinon.stub() };
    await scratch.db.selectorState.create({
      data: {
        original_strategy: 'xpath',
        original_selector: '//login',
        status: 'pending',
        fixed_at: fixedAt,
        clean_builds_count: 0,
      },
    });
  });

  const find = (
    build: string,
    command: 'findElement' | 'findElements',
    response: string,
    isError = false,
  ) =>
    scratch.db.sessionLog.create({
      data: {
        session_id: `cb-s-${build}`,
        command_name: command,
        url: command === 'findElement' ? '/findElement' : '/findElements',
        method: 'POST',
        title: 'Find element',
        response,
        is_success: !isError,
        is_error: isError,
        is_healed: false,
        original_strategy: 'xpath',
        original_selector: '//login',
        createdAt: new Date(now - HOUR),
      },
    });

  const run = () => new SelectorVerificationJob(scratch.db as never, socket).run();
  const row = () =>
    scratch.db.selectorState.findUniqueOrThrow({
      where: {
        original_strategy_original_selector: {
          original_strategy: 'xpath',
          original_selector: '//login',
        },
      },
    });

  it('does not count builds where the find failed outright', async () => {
    for (const b of builds) await find(b, 'findElement', NOT_FOUND, true);

    await run();

    const state = await row();
    expect(state.status).to.equal('pending');
    expect(state.clean_builds_count).to.equal(0);
  });

  it('does not count builds where findElements found nothing', async () => {
    for (const b of builds) await find(b, 'findElements', EMPTY_LIST);

    await run();

    const state = await row();
    expect(state.status).to.equal('pending');
    expect(state.clean_builds_count).to.equal(0);
  });

  it('verifies the selector after three builds that found it', async () => {
    await find('cb-b1', 'findElement', ELEMENT);
    await find('cb-b2', 'findElements', ELEMENTS);
    await find('cb-b3', 'findElement', ELEMENT);

    await run();

    expect((await row()).status).to.equal('resolved');
  });

  it('counts a build that found it once, even if another find of it failed', async () => {
    await find('cb-b1', 'findElement', NOT_FOUND, true);
    await find('cb-b1', 'findElement', ELEMENT);
    await find('cb-b2', 'findElement', NOT_FOUND, true);

    await run();

    const state = await row();
    expect(state.status).to.equal('pending');
    expect(state.clean_builds_count).to.equal(1);
  });
});
