import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { BaseDriver } from '@appium/base-driver';
import { CommandInterceptor } from '../../src/interceptors/CommandInterceptor';
import { HealingOrchestrator } from '../../src/services/healing/HealingOrchestrator';
import { HealEtalonService } from '../../src/services/healing/HealEtalonService';
import { AI_SERVICE } from '../../src/services/AIService';
import { SelfHealingSwitch } from '../../src/services/settings/SelfHealingSwitch';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { DefaultPluginArgs, IPluginArgs } from '../../src/interfaces/IPluginArgs';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

type AnyDriver = BaseDriver<any>;

/**
 * A session's `xe:options.healingTiers` keeps its screen away from the AI
 * provider: with `[1, 2, 3]`, Visual AI (4) and the LLM (5) never run, so the
 * screenshot and page source never leave the server.
 *
 * Through 2.14 the interceptor read the tiers from SESSION_MANAGER, which holds
 * a local session only with the dashboard on or a video recorded. A session
 * with `record_video: false` on a server with the dashboard off (the default),
 * a node's for its hub included, wasn't there: the interceptor found no
 * capabilities and ran every tier. The tiers are now read from the session's
 * own driver, which Appium hands the plugin with every command. These sessions
 * are registered nowhere, as such a session isn't.
 */
describe("a session's healing tiers, on a session the dashboard doesn't track", () => {
  useScratchDatabase();
  let restoreContainer: () => void;
  let dispatched: string[];
  let visualFind: sinon.SinonStub;
  let healLocator: sinon.SinonStub;
  const drivers: AnyDriver[] = [];

  const pluginArgs: IPluginArgs = { ...DefaultPluginArgs, enableDashboard: false };

  beforeEach(() => {
    restoreContainer = saveRegistrations(HealingOrchestrator, SelfHealingSwitch);
    // The switch as at boot with nothing saved: healing on.
    Container.set(SelfHealingSwitch, new SelfHealingSwitch());

    const etalons = {
      getSignature: async () => null,
      saveSignature: async () => {},
    } as unknown as HealEtalonService;
    const orchestrator = new HealingOrchestrator(etalons);
    dispatched = [];
    const providers = (orchestrator as any).providers as Array<{ name: string; heal: any }>;
    // The three local tiers are only recorded. Visual AI and the LLM run as
    // they are, up to the AI service, which is stubbed: what reaches it is
    // what would have gone to the provider.
    for (const provider of providers.slice(0, 3)) {
      provider.heal = async () => {
        dispatched.push(provider.name);
        return null;
      };
    }
    for (const provider of providers.slice(3)) {
      const heal = provider.heal.bind(provider);
      provider.heal = async (context: unknown) => {
        dispatched.push(provider.name);
        return heal(context);
      };
    }
    Container.set(HealingOrchestrator, orchestrator);

    sinon.stub(AI_SERVICE, 'isEnabled').returns(true);
    visualFind = sinon.stub(AI_SERVICE, 'visualFind').resolves(null as any);
    healLocator = sinon.stub(AI_SERVICE, 'healLocator').resolves(null as any);
  });

  afterEach(async () => {
    sinon.restore();
    restoreContainer();
    for (const driver of drivers.splice(0)) await driver.deleteSession();
  });

  /**
   * The driver Appium hands the plugin for a session's commands: a session
   * created from the capabilities the client sent, as Appium creates it.
   */
  async function sessionWith(xenonOptions: Record<string, unknown> | null) {
    const driver: AnyDriver = new BaseDriver({} as any);
    // Every driver warns that it doesn't know `xe:options`; not this spec's business.
    sinon.stub(driver.log, 'warn');
    const alwaysMatch: Record<string, unknown> = {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
    };
    if (xenonOptions) Object.assign(alwaysMatch, xenonOptions);
    await driver.createSession({ alwaysMatch, firstMatch: [{}] } as any);
    drivers.push(driver);
    Object.assign(driver, {
      getPageSource: async () => '<hierarchy><node text="Pay now"/></hierarchy>',
      getScreenshot: async () => 'iVBORw0KGgo=',
      findElements: async () => [],
    });
    return driver;
  }

  /** A findElement the driver answers with NoSuchElement, as a broken selector does. */
  async function findMissing(driver: AnyDriver, { isHub }: { isHub: boolean }) {
    const sessionId = driver.sessionId as string;
    return Container.get(CommandInterceptor)
      .handle(
        async () => {
          throw Object.assign(new Error('NoSuchElement: An element could not be located'), {
            name: 'NoSuchElementError',
          });
        },
        driver,
        'findElement',
        ['xpath', '//android.widget.Button[@text="Pay"]', sessionId],
        pluginArgs,
        isHub,
      )
      .then(
        () => undefined,
        (err) => err,
      );
  }

  for (const [where, isHub] of [
    ['on a standalone server', true],
    ["on a node running its hub's session", false],
  ] as const) {
    describe(where, () => {
      it('never calls the AI provider for a session that allows tiers 1, 2 and 3', async () => {
        const driver = await sessionWith({ 'xe:options': { healingTiers: [1, 2, 3] } });
        // The case: with the dashboard off and no video, nothing registers it.
        expect(SESSION_MANAGER.getSession(driver.sessionId as string)).to.equal(undefined);

        const thrown = await findMissing(driver, { isHub });

        expect(visualFind.called, 'Visual AI sent the screenshot').to.equal(false);
        expect(healLocator.called, 'the LLM was sent the page source').to.equal(false);
        expect(dispatched).to.deep.equal([
          'ResilioTree Provider',
          'Fuzzy XML Provider',
          'OCR Text Provider',
        ]);
        // Nothing healed it, so the test sees its own failure.
        expect(thrown?.name).to.equal('NoSuchElementError');
      });

      it('reads the xenon:options alias the same way', async () => {
        const driver = await sessionWith({ 'xenon:options': { healingTiers: [2] } });

        await findMissing(driver, { isHub });

        expect(visualFind.called).to.equal(false);
        expect(healLocator.called).to.equal(false);
        expect(dispatched).to.deep.equal(['Fuzzy XML Provider']);
      });

      it('still runs every tier for a session that asks for none in particular', async () => {
        const driver = await sessionWith(null);

        await findMissing(driver, { isHub });

        expect(dispatched).to.deep.equal([
          'ResilioTree Provider',
          'Fuzzy XML Provider',
          'OCR Text Provider',
          'Visual AI Provider',
          'LLM Reasoning Provider',
        ]);
        expect(visualFind.calledOnce).to.equal(true);
        expect(healLocator.calledOnce).to.equal(true);
      });
    });
  }

  describe('a value that is not a list of tier numbers', () => {
    for (const [label, value] of [
      ['a string', '1,2,3'],
      ['numbers as strings', ['1', '2']],
      ['a list with a string in it', [4, 'llm']],
      ['a number that is no tier', [1, 6]],
      ['a lone number', 4],
      ['an object', { visualAi: false }],
    ] as const) {
      it(`runs only the tiers that stay on the server: ${label}`, async () => {
        const driver = await sessionWith({ 'xe:options': { healingTiers: value } });

        await findMissing(driver, { isHub: true });

        expect(visualFind.called).to.equal(false);
        expect(healLocator.called).to.equal(false);
        expect(dispatched).to.deep.equal([
          'ResilioTree Provider',
          'Fuzzy XML Provider',
          'OCR Text Provider',
        ]);
      });
    }

    it('runs only the tiers that stay on the server when xe:options is not an object', async () => {
      const driver = await sessionWith({ 'xe:options': '{"healingTiers":[1,2,3]}' });

      await findMissing(driver, { isHub: true });

      expect(visualFind.called).to.equal(false);
      expect(healLocator.called).to.equal(false);
      expect(dispatched).to.deep.equal([
        'ResilioTree Provider',
        'Fuzzy XML Provider',
        'OCR Text Provider',
      ]);
    });

    it('says so in the log, once per session', async () => {
      const warn = sinon.stub((Container.get(CommandInterceptor) as any).log, 'warn');
      const driver = await sessionWith({ 'xe:options': { healingTiers: ['1', '2'] } });

      await findMissing(driver, { isHub: true });
      await findMissing(driver, { isHub: true });

      const said = warn.getCalls().filter((c) => /healingTiers/.test(String(c.args[0])));
      expect(said).to.have.length(1);
      expect(String(said[0].args[0])).to.contain('["1","2"]');
    });
  });

  it('heals with no tier, and takes no screenshot, for a session that lists none', async () => {
    const driver = await sessionWith({ 'xe:options': { healingTiers: [] } });
    const screenshot = sinon.spy(driver as any, 'getScreenshot');
    const source = sinon.spy(driver as any, 'getPageSource');

    const thrown = await findMissing(driver, { isHub: true });

    expect(dispatched).to.deep.equal([]);
    expect(screenshot.called).to.equal(false);
    expect(source.called).to.equal(false);
    expect(thrown?.name).to.equal('NoSuchElementError');
  });
});
