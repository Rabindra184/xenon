import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { XenonPlugin } from '../../src/plugin';
import NodeDevices from '../../src/device-managers/NodeDevices';
import * as DeviceService from '../../src/data-service/device-service';
import * as ActiveLeases from '../../src/services/lease/activeLeases';
import { releaseBlockedDevices } from '../../src/device-utils';
import { CommandInterceptor } from '../../src/interceptors/CommandInterceptor';
import { HealingOrchestrator } from '../../src/services/healing/HealingOrchestrator';
import { HealingTier } from '../../src/services/healing/types';
import { OmniVisionService, OmniElement } from '../../src/services/omni-vision/OmniVisionService';
import { AutowaitService } from '../../src/services/autowait/AutowaitService';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { OrphanSweeper } from '../../src/services/OrphanSweeper';
import { PhoneNetworkRestore } from '../../src/services/network/PhoneNetworkRestore';
import { SelfHealingSwitch } from '../../src/services/settings/SelfHealingSwitch';
import { AI_SERVICE } from '../../src/services/AIService';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * An element Xenon finds in a screenshot (a `-custom:ai-*` find, or an OCR or
 * Visual AI heal) is a box on the screen it remembers by id. Through 2.14 it
 * remembered every one, from every session, until the server restarted:
 * device control's locator test and an icon `smartTap` added one per call
 * that nothing ever read, and any session could act on another's. Now an
 * element belongs to the session that found it and goes when that session
 * ends, and the store has a size limit.
 *
 * OCR, the AI provider and the drivers are stubbed: no Tesseract, no AI call,
 * no phone.
 */

const W3C = 'element-6066-11e4-a52e-4f735466cecf';
const WORDS = [
  { text: 'Sign', confidence: 90, bbox: { x0: 100, y0: 200, x1: 150, y1: 224 } },
  { text: 'in', confidence: 90, bbox: { x0: 158, y0: 200, x1: 180, y1: 224 } },
];

const box = (id: string): OmniElement => ({
  id,
  rect: { x: 0, y: 0, width: 10, height: 10 },
  confidence: 0.9,
});

describe('Elements found in a screenshot belong to their session', () => {
  useScratchDatabase();
  let restoreContainer: () => void;
  let omni: OmniVisionService;

  const driverFor = (sessionId: string) => ({
    sessionId,
    caps: { platformName: 'Android' },
    getScreenshot: sinon.stub().resolves('aGVsbG8='),
    performActions: sinon.stub().resolves(),
    releaseActions: sinon.stub().resolves(),
  });

  beforeEach(() => {
    restoreContainer = saveRegistrations(OmniVisionService, HealingOrchestrator, SelfHealingSwitch);
    Container.set(OmniVisionService, new OmniVisionService());
    Container.set(SelfHealingSwitch, new SelfHealingSwitch());
    omni = Container.get(OmniVisionService);
    sinon.stub(omni as any, 'performOcr').resolves({ text: '', words: WORDS });
    sinon.stub(DASHBORD_EVENT_MANAGER, 'afterSessionCommand').resolves();
  });

  afterEach(() => {
    restoreContainer();
    sinon.restore();
  });

  const run = (driver: any, command: string, args: unknown[], next: () => unknown = () => null) =>
    Container.get(CommandInterceptor).handle(
      async () => next(),
      driver,
      command,
      [...args, driver.sessionId],
      { ...DefaultPluginArgs },
      false,
    );

  const failure = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (err) {
      return err as any;
    }
    throw new Error('expected the command to fail');
  };

  const held = () => (omni as any).elements.size as number;

  it("answers another session's command on it with no such element", async () => {
    const a = driverFor('sess-a');
    const b = driverFor('sess-b');
    const found: any = await run(a, 'findElement', ['-custom:ai-text', 'Sign in']);

    const err = await failure(run(b, 'click', [found[W3C]]));

    expect(err.error).to.equal('no such element');
    expect(b.performActions.called, "tapped on the other session's phone").to.equal(false);
    await run(a, 'click', [found[W3C]]);
    expect(a.performActions.calledOnce).to.equal(true);
  });

  it('keeps a healed element for the session it healed in', async () => {
    const attemptHealing = sinon.stub().resolves({
      id: 'healed_ocr_1_abc',
      tier: HealingTier.TIER_3_LOCAL_OCR,
      confidence: 0.9,
      originalSelector: "//*[@text='Sign in']",
      originalStrategy: 'xpath',
      recommendedSelector: 'ocr:text="Sign in"',
      recommendedStrategy: 'xenon:visual',
      text: 'Sign in',
      rect: { x: 100, y: 200, width: 80, height: 24 },
    });
    Container.set(HealingOrchestrator, { attemptHealing } as unknown as HealingOrchestrator);
    const a = driverFor('sess-a');
    await run(a, 'findElement', ['xpath', "//*[@text='Sign in']"], () => {
      throw Object.assign(new Error('NoSuchElement'), { name: 'NoSuchElementError' });
    });

    expect(await run(a, 'getText', ['healed_ocr_1_abc'])).to.equal('Sign in');
    const err = await failure(run(driverFor('sess-b'), 'getText', ['healed_ocr_1_abc']));
    expect(err.error).to.equal('no such element');
  });

  it("keeps nothing for device control's locator test", async () => {
    // As POST /control/<udid>/test-locator calls it: the ids are only shown.
    const manual = { sessionId: 'manual_R5CT', getScreenshot: sinon.stub().resolves('aGVsbG8=') };

    const found = await omni.findByText(manual, 'Sign in', { throwOnError: true });

    expect(found).to.have.length(1);
    expect(held()).to.equal(0);
  });

  it('keeps nothing for an icon smartTap, which taps at once', async () => {
    sinon.stub(AI_SERVICE, 'visualFind').resolves({ x: 50, y: 50 } as any);

    const result = await omni.omniClickByIcon(driverFor('sess-a'), { icon: 'the cart' });

    expect(result.clicked).to.equal(true);
    expect(held()).to.equal(0);
  });

  it('keeps the newest 1,000 for a session', () => {
    for (let i = 0; i < 1_001; i++) omni.remember('sess-a', box(`omni_ocr_${i}`));

    expect(omni.getVirtualElement('omni_ocr_0', 'sess-a')).to.equal(undefined);
    expect(omni.getVirtualElement('omni_ocr_1', 'sess-a')).to.not.equal(undefined);
    expect(omni.getVirtualElement('omni_ocr_1000', 'sess-a')).to.not.equal(undefined);
  });

  it('keeps the newest 10,000 in all', () => {
    for (let s = 0; s < 11; s++) {
      for (let i = 0; i < 1_000; i++) omni.remember(`sess-${s}`, box(`omni_ocr_${s}_${i}`));
    }

    expect(held()).to.equal(10_000);
    expect(omni.getVirtualElement('omni_ocr_0_999', 'sess-0')).to.equal(undefined);
    expect(omni.getVirtualElement('omni_ocr_1_0', 'sess-1')).to.not.equal(undefined);
  });

  it('gives icon matches ids of their own, as text matches have', async () => {
    sinon.stub(Date, 'now').returns(1_700_000_000_000);
    sinon.stub(AI_SERVICE, 'visualFind').resolves({ x: 50, y: 50 } as any);
    const a = driverFor('sess-a');

    const first = await omni.findByIcon(a, 'the cart');
    const second = await omni.findByIcon(a, 'the cart');

    expect(first?.id).to.not.equal(second?.id);
  });
});

/**
 * Everything a session leaves in this server's memory for its commands goes
 * when the session ends, however it ends: its virtual elements, and its
 * autowait settings (`xenon: setAutowaitProperties`). Those were meant to be
 * cleared by the interceptor on `deleteSession`, but XenonPlugin answers
 * `deleteSession` itself, so Appium never hands that command to the
 * interceptor: they were kept for good.
 */
describe("A session's virtual elements and autowait settings go when it ends", function () {
  this.timeout(30_000);
  const scratch = useScratchDatabase();
  let restoreRegs: () => void;
  let omni: OmniVisionService;

  const seed = (sessionId: string) => {
    omni.remember(sessionId, box(`omni_ocr_${sessionId}`));
    Container.get(AutowaitService).setProps(sessionId, { timeoutMs: 1_234 });
  };
  const expectForgotten = (sessionId: string) => {
    expect(omni.getVirtualElement(`omni_ocr_${sessionId}`, sessionId), 'element').to.equal(
      undefined,
    );
    expect(
      Container.get(AutowaitService).getProps(sessionId, { ...DefaultPluginArgs }).timeoutMs,
      'autowait timeout',
    ).to.equal(DefaultPluginArgs.autowait!.timeoutMs);
  };

  beforeEach(() => {
    restoreRegs = saveRegistrations(
      OmniVisionService,
      AutowaitService,
      PhoneNetworkRestore,
      SessionMetricsService,
    );
    Container.set(OmniVisionService, new OmniVisionService());
    Container.set(AutowaitService, new AutowaitService());
    omni = Container.get(OmniVisionService);
    Container.set(PhoneNetworkRestore, {
      restoreSession: sinon.stub().resolves(),
      restoreAll: sinon.stub().resolves(),
    } as any);
    Container.set(SessionMetricsService, { stop: sinon.stub().resolves() } as any);
    sinon.stub(DeviceService, 'releaseSessionDevices').resolves();
    sinon.stub(DASHBORD_EVENT_MANAGER, 'onSessionStopped').resolves();
  });

  afterEach(() => {
    sinon.restore();
    restoreRegs();
  });

  it('when the test deletes the session', async () => {
    seed('s-deleted');
    await Container.get(SessionLifecycleService).deleteSession(async () => null, 's-deleted');
    expectForgotten('s-deleted');
  });

  it('when Appium ends the session itself (new-command timeout)', async () => {
    seed('s-timeout');
    const plugin = { pluginArgs: {}, xenonLog: { withSession: () => ({ info() {} }) } };
    await XenonPlugin.prototype.onUnexpectedShutdown.call(
      plugin as any,
      { sessionId: 's-timeout', caps: { udid: 'R5CT' } },
      new Error('New command timeout'),
    );
    expectForgotten('s-timeout');
  });

  it('when Appium ends the session on a node', async () => {
    seed('s-node');
    sinon.stub(NodeDevices.prototype, 'unblockDevice').resolves(undefined as any);
    const plugin = { pluginArgs: { hub: 'http://hub:4723' } };
    await XenonPlugin.prototype.onUnexpectedShutdown.call(
      plugin as any,
      { sessionId: 's-node', caps: {} },
      null,
    );
    expectForgotten('s-node');
  });

  it("when Xenon's idle check releases the phone", async () => {
    seed('s-idle');
    const idle = {
      udid: 'R5CT',
      host: 'http://127.0.0.1:4723',
      busy: true,
      userBlocked: false,
      session_id: 's-idle',
      claimSessionId: 's-idle',
      lastCmdExecutedAt: Date.now() - 10 * 60 * 1000,
    };
    sinon.stub(DeviceService, 'getAllDevices').resolves([idle as any]);
    sinon.stub(ActiveLeases, 'activeLeasesByDevice').resolves(new Map());
    sinon.stub(DeviceService, 'releaseSessionDevice').resolves(true);

    await releaseBlockedDevices(60);

    expectForgotten('s-idle');
  });

  it('when a graceful shutdown drains the session', async () => {
    seed('s-down');
    await Container.get(SessionLifecycleService).stopSessionForShutdown('s-down', 'shutdown');
    expectForgotten('s-down');
  });

  it("when the session's heartbeat goes stale", async () => {
    seed('s-stale');
    await scratch.db.session.deleteMany({});
    await scratch.db.session.create({
      data: {
        id: 's-stale',
        status: 'running',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'n',
        has_live_video: false,
        device_udid: 'R5CT',
        device_platform: 'android',
        device_version: '14',
        last_heartbeat_at: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    await new OrphanSweeper().sweep({ heartbeatIntervalMs: 1_000 });

    expectForgotten('s-stale');
  });

  it("leaves other sessions' elements alone", async () => {
    seed('s-ends');
    seed('s-stays');
    await Container.get(SessionLifecycleService).deleteSession(async () => null, 's-ends');
    expect(omni.getVirtualElement('omni_ocr_s-stays', 's-stays')).to.not.equal(undefined);
  });
});
