import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import * as deviceService from '../../src/data-service/device-service';
import { CommandInterceptor } from '../../src/interceptors/CommandInterceptor';
import { AICommandService } from '../../src/services/AICommandService';
import { AutowaitService } from '../../src/services/autowait/AutowaitService';
import { DefaultPluginArgs, IPluginArgs } from '../../src/interfaces/IPluginArgs';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * `xenon:` / `xe:` execute scripts for a session on this server's own phone,
 * through the plugin's command interceptor (as Appium calls it).
 */
describe('xenon: execute scripts on this server', () => {
  const scratch = useScratchDatabase();
  const SESSION = 'local-session-1';
  const pluginArgs = { ...DefaultPluginArgs, enableDashboard: false } as IPluginArgs;
  let interceptor: CommandInterceptor;
  let next: sinon.SinonStub;
  let restoreContainer: () => void;
  const driver = { sessionId: SESSION, caps: { udid: 'phone-1' } };

  beforeEach(async () => {
    await scratch.db.session.deleteMany({});
    restoreContainer = saveRegistrations(AICommandService);
    sinon.stub(deviceService, 'updateCmdExecutedTime').resolves();
    interceptor = new CommandInterceptor();
    next = sinon.stub().resolves('from the driver');
  });
  afterEach(() => {
    Container.get(AutowaitService).clearSession(SESSION);
    sinon.restore();
    restoreContainer();
  });

  /** driver.execute(script, ...args), as Appium hands it to the plugin. */
  const execute = (script: string, ...scriptArgs: unknown[]) =>
    interceptor.handle(next, driver, 'execute', [script, scriptArgs, SESSION], pluginArgs, true);

  const failureOf = (p: Promise<unknown>) =>
    p.then(
      (value) => {
        throw new Error(`expected a failure, got ${JSON.stringify(value)}`);
      },
      (e: Error) => e,
    );

  it('assertVisualState takes its condition as a plain string, as well as { instruction }', async () => {
    const ai = new AICommandService();
    Container.set(AICommandService, ai);
    const assert = sinon.stub(ai, 'assertVisualState').resolves({ result: true, message: 'ok' });

    await execute('xenon: assertVisualState', 'The cart is empty');
    await execute('xe: assertVisualState', { instruction: 'The cart has 2 items' });

    expect(assert.firstCall.args[1]).to.equal('The cart is empty');
    expect(assert.secondCall.args[1]).to.equal('The cart has 2 items');
    expect(next.called).to.equal(false);
  });

  it('a session-details command answers that nothing was recorded when the session has no record', async () => {
    // The dashboard is off: no Session row. This used to fail the command (P2025).
    const answer: any = await execute('xenon: setSessionName', 'Checkout');
    expect(answer).to.include({ recorded: false });
    expect(answer.message).to.match(/no record/i);
    expect(next.called).to.equal(false);
  });

  it('a session-details command answers with what it did, not null', async () => {
    await scratch.db.session.create({
      data: {
        id: SESSION,
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'node-1',
        has_live_video: false,
        device_udid: 'phone-1',
        device_platform: 'android',
        device_version: '14',
      },
    });
    expect(await execute('xenon: setSessionName', 'Checkout')).to.deep.equal({ recorded: true });
    expect((await scratch.db.session.findUnique({ where: { id: SESSION } }))?.name).to.equal(
      'Checkout',
    );
  });

  it('a xenon: script Xenon does not have fails, instead of answering null', async () => {
    const err: any = await failureOf(execute('xenon: setSesionName', 'Checkout'));
    expect(err.message).to.match(/Unknown Xenon command "xenon: setSesionName"/);
    expect(err.message).to.match(/setSessionName/);
    expect(err.error).to.equal('unknown command');
    expect(next.called).to.equal(false);
  });

  it("another plugin's or the driver's script still goes to the driver", async () => {
    expect(await execute('mobile: shell', { command: 'echo' })).to.equal('from the driver');
    expect(next.calledOnce).to.equal(true);
  });

  it('Xenon’s own scripts are still answered here', async () => {
    const answer: any = await execute('xe: setAutowaitProperties', { timeout: 1234 });
    expect(answer).to.include({ timeoutMs: 1234 });
    expect(next.called).to.equal(false);
  });
});
