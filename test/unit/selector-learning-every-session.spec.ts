import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { CommandInterceptor } from '../../src/interceptors/CommandInterceptor';
import { HealEtalonService } from '../../src/services/healing/HealEtalonService';
import { SelfHealingSwitch } from '../../src/services/settings/SelfHealingSwitch';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { DefaultPluginArgs, IPluginArgs } from '../../src/interfaces/IPluginArgs';
import { waitFor } from '../../src/services/autowait/waitFor';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * After a findElement finds its element, Xenon learns the selector's
 * fingerprint (the element's attributes, position and path), which the
 * Resilio and Fuzzy XML tiers heal it with later, on the server, without
 * calling the AI provider.
 *
 * Through 2.14 it learnt only behind the dashboard's per-command record
 * (`isHub && enableDashboard && SESSION_MANAGER.isValidSession`): never with
 * `enableDashboard` off (the default), and never on a node. Those servers
 * healed without fingerprints, so a broken selector went on to OCR, Visual AI
 * and the LLM. Learning now follows the self-healing switch alone, on every
 * session this server drives. The record itself is unchanged.
 */
describe('selector learning, on every session this server drives', () => {
  useScratchDatabase();
  let restoreContainer: () => void;
  let etalons: { getSignature: sinon.SinonStub; saveSignature: sinon.SinonStub };
  let learn: sinon.SinonSpy;
  let record: sinon.SinonStub;

  beforeEach(() => {
    restoreContainer = saveRegistrations(HealEtalonService, SelfHealingSwitch);
    // The switch as at boot with nothing saved: it follows the options.
    Container.set(SelfHealingSwitch, new SelfHealingSwitch());
    etalons = {
      getSignature: sinon.stub().resolves(null),
      saveSignature: sinon.stub().resolves(),
    };
    Container.set(HealEtalonService, etalons as unknown as HealEtalonService);
    learn = sinon.spy(CommandInterceptor.prototype as any, 'triggerLearning');
    record = sinon.stub(DASHBORD_EVENT_MANAGER, 'afterSessionCommand').resolves();
  });

  afterEach(() => {
    sinon.restore();
    restoreContainer();
  });

  const options = (over: Partial<IPluginArgs> = {}): IPluginArgs => ({
    ...DefaultPluginArgs,
    enableDashboard: false,
    ...over,
  });

  let sessions = 0;
  /** A session's driver, with what learning reads from a found element. */
  function sessionDriver(caps: Record<string, unknown> = {}) {
    sessions += 1;
    return {
      sessionId: `learn-${sessions}-${Date.now()}`,
      caps: { platformName: 'Android', ...caps },
      // As UiAutomator2 answers: String(value), so "null" for an unset one.
      getAttribute: async (name: string, _id: string) =>
        String(({ 'resource-id': 'com.shop:id/pay', text: 'Pay now' } as any)[name] ?? null),
      getElementRect: async () => ({ x: 40, y: 900, width: 300, height: 96 }),
      getName: async () => 'android.widget.Button',
      getPageSource: async () =>
        '<hierarchy><android.widget.Button text="Pay now" resource-id="com.shop:id/pay"/></hierarchy>',
    };
  }

  const PAY = ['id', 'com.shop:id/pay'];
  const FOUND = { ELEMENT: 'el-1', 'element-6066-11e4-a52e-4f735466cecf': 'el-1' };

  /** A findElement the driver answers with its element. */
  async function find(
    driver: ReturnType<typeof sessionDriver>,
    pluginArgs: IPluginArgs,
    { isHub, command = 'findElement' }: { isHub: boolean; command?: string },
  ) {
    const response = command === 'findElements' ? [FOUND] : FOUND;
    return Container.get(CommandInterceptor).handle(
      async () => response,
      driver,
      command,
      [...PAY, driver.sessionId],
      pluginArgs,
      isHub,
    );
  }

  /** Learning runs in the background, after the find has answered. */
  async function learnt() {
    const result = await waitFor(async () => (etalons.saveSignature.called ? true : null), {
      timeoutMs: 2000,
      intervalMs: 5,
    });
    return 'value' in result;
  }

  for (const [where, isHub] of [
    ['a standalone server', true],
    ["a node running its hub's session", false],
  ] as const) {
    it(`learns a found selector on ${where} with enableDashboard off`, async () => {
      const driver = sessionDriver();
      // The case: nothing registers it, as nothing registered it before.
      expect(SESSION_MANAGER.isValidSession(driver.sessionId)).to.equal(false);

      const answer = await find(driver, options(), { isHub });

      expect(answer).to.deep.equal(FOUND);
      expect(learn.calledOnce, 'learning started').to.equal(true);
      expect(await learnt(), 'a fingerprint was saved').to.equal(true);
      expect(etalons.saveSignature.firstCall.args.slice(0, 2)).to.deep.equal(PAY);
      // A fingerprint that says which element it is, which Fuzzy XML can use.
      expect(etalons.saveSignature.firstCall.args[2].attributes).to.deep.include({
        name: 'resource-id',
        value: 'com.shop:id/pay',
      });
      // The dashboard's record is still the dashboard's: nothing was recorded.
      expect(record.called).to.equal(false);
    });
  }

  it('learns a selector autowait found', async () => {
    const driver = sessionDriver();
    const pluginArgs = options({
      autowait: {
        enabled: true,
        timeoutMs: 500,
        intervalBetweenAttemptsMs: 10,
        excludeEnabledCheck: [],
      },
    });

    await find(driver, pluginArgs, { isHub: true });

    expect(learn.calledOnce).to.equal(true);
    expect(await learnt()).to.equal(true);
  });

  it('learns once, and still records, where the dashboard records the session', async () => {
    const driver = sessionDriver();
    sinon.stub(SESSION_MANAGER, 'isValidSession').returns(true);

    await find(driver, options({ enableDashboard: true }), { isHub: true });

    expect(record.calledOnce).to.equal(true);
    expect(learn.calledOnce).to.equal(true);
    expect(await learnt()).to.equal(true);
  });

  it('learns nothing with self-healing off', async () => {
    await find(sessionDriver(), options({ enableSelfHealing: false }), { isHub: true });

    expect(learn.called).to.equal(false);
  });

  it('learns nothing from a session that turned its own healing off', async () => {
    const driver = sessionDriver({ 'xe:options': { healingTiers: [] } });

    await find(driver, options(), { isHub: true });

    expect(learn.called).to.equal(false);
  });

  it('still learns from a session that limits its tiers', async () => {
    const driver = sessionDriver({ 'xe:options': { healingTiers: [3] } });

    await find(driver, options(), { isHub: true });

    expect(learn.calledOnce).to.equal(true);
  });

  it('learns nothing from findElements, as before', async () => {
    await find(sessionDriver(), options(), { isHub: true, command: 'findElements' });

    expect(learn.called).to.equal(false);
  });

  it('answers the find even when deciding whether to learn throws', async () => {
    sinon.stub(SelfHealingSwitch.prototype, 'isEnabled').throws(new Error('switch unreadable'));

    const answer = await find(sessionDriver(), options(), { isHub: true });

    expect(answer).to.deep.equal(FOUND);
    expect(learn.called).to.equal(false);
  });

  it('answers the find even when learning fails', async () => {
    etalons.getSignature.rejects(new Error('database is locked'));
    const driver = sessionDriver();

    const answer = await find(driver, options(), { isHub: true });

    expect(answer).to.deep.equal(FOUND);
    // The background pass ends, and the session may learn again.
    const settled = await waitFor(
      async () =>
        (Container.get(CommandInterceptor) as any).learningSessions.has(driver.sessionId)
          ? null
          : true,
      { timeoutMs: 2000, intervalMs: 5 },
    );
    expect('value' in settled).to.equal(true);
    expect(etalons.saveSignature.called).to.equal(false);
  });
});
