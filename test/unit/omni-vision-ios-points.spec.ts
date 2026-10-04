import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import sharp from 'sharp';
import { OmniVisionService } from '../../src/services/omni-vision/OmniVisionService';
import { AI_SERVICE } from '../../src/services/AIService';
import { HealingOrchestrator } from '../../src/services/healing/HealingOrchestrator';
import { HealingTier } from '../../src/services/healing/types';
import { screenScaleOf } from '../../src/services/omni-vision/screenScale';

/**
 * OCR and the AI find a target in screenshot pixels. An iPhone's screenshot is
 * 2x or 3x its screen in points, and XCUITest's W3C actions and element rects
 * are in points, so a tap at the pixel position landed 2-3 times too far right
 * and down. Nothing converted: not smartTap/visualTap, not the virtual
 * elements the -custom:ai-* locators return, not the healing tiers' tap.
 *
 * Positions found in a screenshot are now converted to the driver's
 * coordinates on iOS (screenshot size over window size). Android's W3C
 * coordinates are the screenshot's pixels, so nothing changes there.
 */
describe('Omni-Vision taps in points on iOS', () => {
  // A 3x screen: 30 x 60 pixels for a 10 x 20 point window.
  let png3x: string;
  before(async () => {
    const image = await sharp({
      create: { width: 30, height: 60, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();
    png3x = image.toString('base64');
  });

  // "OK" at pixels 12..18 x 30..36: its middle is (15, 33) px, (5, 11) pt.
  const OK_WORD = { text: 'OK', confidence: 90, bbox: { x0: 12, y0: 30, x1: 18, y1: 36 } };

  let service: OmniVisionService;
  let ios: any;
  let android: any;

  function driverFor(platformName: string) {
    return {
      sessionId: `session-${platformName}`,
      caps: { platformName },
      getScreenshot: sinon.stub().resolves(png3x),
      getWindowRect: sinon.stub().resolves({ x: 0, y: 0, width: 10, height: 20 }),
      performActions: sinon.stub().resolves(),
      releaseActions: sinon.stub().resolves(),
    };
  }

  beforeEach(() => {
    service = new OmniVisionService();
    sinon.stub(service as any, 'performOcr').resolves({ text: 'OK', words: [OK_WORD] });
    ios = driverFor('iOS');
    android = driverFor('Android');
  });
  afterEach(() => sinon.restore());

  const tappedAt = (driver: any) => {
    const move = driver.performActions.firstCall.args[0][0].actions[0];
    return { x: move.x, y: move.y };
  };

  it('smartTap by text taps in points on iOS', async () => {
    const result = await service.omniClickByText(ios, { text: 'OK' });
    expect(result.clicked, result.message).to.equal(true);
    expect(tappedAt(ios)).to.deep.equal({ x: 5, y: 11 });
    expect(result.target).to.deep.include({
      x: 5,
      y: 11,
      rect: { x: 4, y: 10, width: 2, height: 2 },
    });
  });

  it('smartTap by text taps in pixels on Android, without asking for the window', async () => {
    const result = await service.omniClickByText(android, { text: 'OK' });
    expect(result.clicked, result.message).to.equal(true);
    expect(tappedAt(android)).to.deep.equal({ x: 15, y: 33 });
    expect(android.getWindowRect.called).to.equal(false);
  });

  it('visualTap taps in points on iOS', async () => {
    sinon.stub(AI_SERVICE, 'visualFind').resolves({ x: 15, y: 33 });
    const result = await service.omniClickByIcon(ios, { icon: 'the gear icon' });
    expect(result.clicked, result.message).to.equal(true);
    expect(tappedAt(ios)).to.deep.equal({ x: 5, y: 11 });
  });

  it('gives the -custom:ai-text locator an element in points on iOS', async () => {
    const [found] = await service.findByText(ios, 'OK');
    expect(found.rect).to.deep.equal({ x: 4, y: 10, width: 2, height: 2 });
    expect(service.getVirtualElement(found.id)?.rect).to.deep.equal(found.rect);
  });

  it("doesn't tap on iOS when the window size can't be read", async () => {
    ios.getWindowRect.rejects(new Error('WDA is not running'));
    const err = await service.omniClickByText(ios, { text: 'OK' }).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).to.match(/WDA is not running/);
    expect(ios.performActions.called).to.equal(false);
  });

  it('reads the window from getWindowSize when there is no getWindowRect', async () => {
    const driver = {
      caps: { platformName: 'iOS' },
      getWindowSize: async () => ({ width: 15, height: 30 }),
    };
    expect(await screenScaleOf(driver, png3x)).to.deep.equal({ x: 2, y: 2 });
  });

  it("keeps pixels for a driver that isn't iOS, or can't be placed", async () => {
    expect(await screenScaleOf({}, 'not an image')).to.deep.equal({ x: 1, y: 1 });
    expect(await screenScaleOf({ caps: { platformName: 'Android' } }, 'x')).to.deep.equal({
      x: 1,
      y: 1,
    });
  });

  it('converts the OCR and Visual AI healing tiers’ rect to points on iOS', async () => {
    const orchestrator = new HealingOrchestrator({
      getSignature: async () => null,
      saveSignature: async () => undefined,
    } as any);
    const ocr = (orchestrator as any).providers.find(
      (p: any) => p.tier === HealingTier.TIER_3_LOCAL_OCR,
    );
    sinon.stub(ocr, 'heal').resolves({
      id: 'healed_ocr_1',
      tier: HealingTier.TIER_3_LOCAL_OCR,
      confidence: 0.9,
      originalSelector: '//*[@label="OK"]',
      recommendedSelector: 'ocr:text="OK"',
      rect: { x: 12, y: 30, width: 6, height: 6 },
    });
    ios.getPageSource = sinon.stub().resolves('<AppiumAUT/>');
    const healed = await orchestrator.attemptHealing('s1', ios, 'xpath', '//*[@label="OK"]', [3]);
    expect(healed?.rect).to.deep.equal({ x: 4, y: 10, width: 2, height: 2 });
  });
  it("drops a healed virtual element whose position on an iPhone can't be worked out", async () => {
    const orchestrator = new HealingOrchestrator({
      getSignature: async () => null,
      saveSignature: async () => undefined,
    } as any);
    const ocr = (orchestrator as any).providers.find(
      (p: any) => p.tier === HealingTier.TIER_3_LOCAL_OCR,
    );
    const found = {
      tier: HealingTier.TIER_3_LOCAL_OCR,
      confidence: 0.9,
      originalSelector: '//*[@label="OK"]',
      recommendedSelector: 'ocr:text="OK"',
      rect: { x: 12, y: 30, width: 6, height: 6 },
    };
    const heal = sinon.stub(ocr, 'heal').resolves({ ...found, id: 'healed_ocr_1' });
    ios.getPageSource = sinon.stub().resolves('<AppiumAUT/>');
    ios.getWindowRect.rejects(new Error('WDA is not running'));
    expect(await orchestrator.attemptHealing('s1', ios, 'xpath', '//x', [3])).to.equal(null);

    // A real element the tier resolved is kept, without the rect.
    heal.resolves({ ...found, id: 'real-element-1' });
    const healed = await orchestrator.attemptHealing('s1', ios, 'xpath', '//x', [3]);
    expect(healed?.id).to.equal('real-element-1');
    expect(healed?.rect).to.equal(undefined);
  });
});
