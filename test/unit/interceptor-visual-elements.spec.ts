import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { CommandInterceptor } from '../../src/interceptors/CommandInterceptor';
import { HealingOrchestrator } from '../../src/services/healing/HealingOrchestrator';
import { HealingTier } from '../../src/services/healing/types';
import { OmniVisionService } from '../../src/services/omni-vision/OmniVisionService';
import { SelfHealingSwitch } from '../../src/services/settings/SelfHealingSwitch';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { DefaultPluginArgs, IPluginArgs } from '../../src/interfaces/IPluginArgs';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * Elements Xenon found in a screenshot (Omni-Vision's `-custom:ai-*` locators,
 * and self-healing's OCR and Visual AI tiers) are boxes on the screen with an
 * id of Xenon's own (`omni_*`, `healed_ocr*`, `healed_visual*`). The
 * interceptor answers their commands itself. Through 2.14:
 *
 * - a `-custom:ai-*` findElement that matched nothing answered `unknown error`
 *   ("NoSuchElement: AI Vision failed…"), and self-healing then ran on it;
 * - a healed OCR or Visual AI element was tapped during the find, and the
 *   test's own click tapped it again;
 * - `getText` on a healed element answered Xenon's note about the match;
 * - `setValue` never reached the element: Appium passes it (text, elementId),
 *   and the interceptor read the text as the element id.
 *
 * No AI provider, OCR or phone: healing, OCR and the driver are stubbed.
 */
describe('Elements Xenon found in a screenshot', () => {
  useScratchDatabase();
  const SESSION = 'visual-session';
  let pluginArgs: IPluginArgs;
  let restoreContainer: () => void;
  let attemptHealing: sinon.SinonStub;
  let driver: any;
  let omni: OmniVisionService;

  beforeEach(() => {
    pluginArgs = { ...DefaultPluginArgs };
    restoreContainer = saveRegistrations(HealingOrchestrator, SelfHealingSwitch);
    Container.set(SelfHealingSwitch, new SelfHealingSwitch());
    attemptHealing = sinon.stub().resolves(null);
    Container.set(HealingOrchestrator, { attemptHealing } as unknown as HealingOrchestrator);
    sinon.stub(DASHBORD_EVENT_MANAGER, 'afterSessionCommand').resolves();
    omni = Container.get(OmniVisionService);
    driver = {
      sessionId: SESSION,
      caps: { platformName: 'Android' },
      performActions: sinon.stub().resolves(),
      releaseActions: sinon.stub().resolves(),
      findElement: sinon.stub().rejects(new Error('unexpected find')),
      active: sinon.stub().resolves({ 'element-6066-11e4-a52e-4f735466cecf': 'field-1' }),
      setValue: sinon.stub().resolves(null),
      elementEnabled: sinon.stub().resolves(true),
    };
  });

  afterEach(() => {
    restoreContainer();
    sinon.restore();
  });

  const run = (command: string, args: unknown[], next: () => unknown = () => undefined) =>
    Container.get(CommandInterceptor).handle(
      async () => next(),
      driver,
      command,
      [...args, SESSION],
      pluginArgs,
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

  const tapsAt = () =>
    driver.performActions.getCalls().map((c: sinon.SinonSpyCall) => {
      const move = c.args[0][0].actions[0];
      return { x: move.x, y: move.y };
    });

  describe('a -custom:ai-* find that matches nothing', () => {
    it('fails with the standard "no such element" error for ai-text', async () => {
      sinon.stub(omni, 'findByText').resolves([]);

      const err = await failure(run('findElement', ['-custom:ai-text', 'Checkout']));

      expect(err.error).to.equal('no such element');
      expect(err.w3cStatus).to.equal(404);
    });

    it('fails with the standard "no such element" error for ai-icon', async () => {
      sinon.stub(omni, 'findByIcon').resolves(null);

      const err = await failure(run('findElement', ['-custom:ai-icon', 'a cart icon']));

      expect(err.error).to.equal('no such element');
    });

    it('is not handed to self-healing', async () => {
      sinon.stub(omni, 'findByText').resolves([]);

      await failure(run('findElement', ['-custom:ai-text', 'Checkout']));

      expect(attemptHealing.called).to.equal(false);
    });

    it('still answers an empty list to findElements', async () => {
      sinon.stub(omni, 'findByText').resolves([]);
      expect(await run('findElements', ['-custom:ai-text', 'Checkout'])).to.deep.equal([]);
    });
  });

  describe('a healed OCR or Visual AI element', () => {
    const healedBy = (id: string, tier: HealingTier, text?: string) => ({
      id,
      tier,
      confidence: 0.9,
      originalSelector: "//*[@text='Login']",
      originalStrategy: 'xpath',
      recommendedSelector: 'ocr:text="Login"',
      recommendedStrategy: 'xenon:visual',
      message: 'Found text "Login" via local OCR (90% confidence)',
      rect: { x: 100, y: 400, width: 80, height: 24 },
      ...(text !== undefined ? { text } : {}),
    });

    const findHealed = async (healed: ReturnType<typeof healedBy>) => {
      attemptHealing.resolves(healed);
      return run('findElement', ['xpath', "//*[@text='Login']"], () => {
        throw Object.assign(new Error('NoSuchElement: gone'), { name: 'NoSuchElementError' });
      });
    };

    it('is not tapped during the find', async () => {
      const found = await findHealed(healedBy('healed_ocr_1', HealingTier.TIER_3_LOCAL_OCR, 'Login'));

      expect(found).to.deep.include({ 'element-6066-11e4-a52e-4f735466cecf': 'healed_ocr_1' });
      expect(driver.performActions.called, 'tapped during the find').to.equal(false);
    });

    it('is tapped once, by the test\'s own click', async () => {
      await findHealed(healedBy('healed_visual_1', HealingTier.TIER_4_VISUAL_AI));

      await run('click', ['healed_visual_1']);

      expect(tapsAt()).to.deep.equal([{ x: 140, y: 412 }]);
    });

    it('answers getText with the text OCR read, not a note about the match', async () => {
      await findHealed(healedBy('healed_ocr_2', HealingTier.TIER_3_LOCAL_OCR, 'Login'));

      expect(await run('getText', ['healed_ocr_2'])).to.equal('Login');
    });

    it('refuses getText when Visual AI found it, since no text was read', async () => {
      await findHealed(healedBy('healed_visual_2', HealingTier.TIER_4_VISUAL_AI));

      const err = await failure(run('getText', ['healed_visual_2']));

      expect(err.error).to.equal('unsupported operation');
      expect(err.message).to.match(/text/i);
    });
  });

  describe('setValue on an element found in a screenshot', () => {
    beforeEach(() => {
      omni.addVirtualElement({
        id: 'omni_ocr_field',
        text: 'Email',
        rect: { x: 10, y: 20, width: 100, height: 40 },
        confidence: 0.9,
      });
    });

    it('taps it, then types into the field that has the keyboard focus', async () => {
      await run('setValue', ['me@example.com', 'omni_ocr_field']);

      expect(tapsAt()).to.deep.equal([{ x: 60, y: 40 }]);
      expect(driver.active.calledAfter(driver.performActions)).to.equal(true);
      expect(driver.setValue.firstCall.args.slice(0, 2)).to.deep.equal([
        'me@example.com',
        'field-1',
      ]);
    });

    it('refuses before tapping when the driver cannot tell which field has the focus', async () => {
      delete driver.active;

      const err = await failure(run('setValue', ['me@example.com', 'omni_ocr_field']));

      expect(err.error).to.equal('unsupported operation');
      expect(driver.performActions.called, 'tapped').to.equal(false);
    });

    it('says so when no field took the focus after the tap', async () => {
      driver.active.rejects(new Error('no element has focus'));

      const err = await failure(run('setValue', ['me@example.com', 'omni_ocr_field']));

      expect(err.error).to.equal('element not interactable');
      expect(driver.setValue.called).to.equal(false);
    });
  });

  describe('other commands on an element found in a screenshot', () => {
    it('refuses them clearly instead of sending Xenon\'s id to the driver', async () => {
      omni.addVirtualElement({
        id: 'omni_ai_cart',
        rect: { x: 0, y: 0, width: 40, height: 40 },
        confidence: 0.85,
      });
      const next = sinon.stub();

      const err = await failure(run('getAttribute', ['content-desc', 'omni_ai_cart'], next));

      expect(err.error).to.equal('unsupported operation');
      expect(next.called, 'sent to the driver').to.equal(false);
    });
  });

  describe('autowait before setValue on a real element', () => {
    it('waits for the element, not for an element named after the text', async () => {
      pluginArgs = { ...DefaultPluginArgs, autowait: { ...DefaultPluginArgs.autowait, enabled: true } };

      await run('setValue', ['hello', 'el-1']);

      expect(driver.elementEnabled.firstCall.args[0]).to.equal('el-1');
    });
  });
});
