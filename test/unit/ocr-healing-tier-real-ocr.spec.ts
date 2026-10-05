import 'reflect-metadata';
import { expect } from 'chai';
import sharp from 'sharp';
import { Container } from 'typedi';
import { OcrHealingProvider } from '../../src/services/healing/OcrHealingProvider';
import { OmniVisionService } from '../../src/services/omni-vision/OmniVisionService';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * The OCR healing tier, on a real screenshot read by a real Tesseract worker
 * (the language data the plugin ships), with nothing stubbed between them.
 *
 * Through 2.14 the tier read `result.data.words` from tesseract.js, which
 * since tesseract.js 6 returns text only unless asked: `words` was undefined,
 * and the tier healed nothing, ever. Its tests stubbed the OCR with words, so
 * none of them could see it. ocr-healing-tier.spec.ts covers the matching
 * rules on stubbed words; this checks the whole tier reads a screen.
 */
describe('The OCR healing tier, reading a real screenshot', () => {
  let restoreContainer: () => void;
  let screenshot: string;

  // A phone-like screen: four lines, 200 px apart, each at x 60. "Log out"
  // and "Check in" come first, so a tier that took a lone "Log" for "Login",
  // or a lone "in" for "Sign in", answers with the wrong line.
  const WIDTH = 720;
  const LINES = { 'Log out': 150, 'Check in': 350, 'Sign in': 550, Login: 750 };
  const FONT_SIZE = 56;

  /** Where a line's text is: from its cap height above the baseline to just below it. */
  const band = (line: keyof typeof LINES) => ({
    top: LINES[line] - FONT_SIZE,
    bottom: LINES[line] + FONT_SIZE / 4,
  });

  before(async () => {
    const text = Object.entries(LINES)
      .map(
        ([words, y]) =>
          `<text x="60" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${FONT_SIZE}" fill="#111">${words}</text>`,
      )
      .join('');
    const png = await sharp({
      create: { width: WIDTH, height: 900, channels: 3, background: '#ffffff' },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="900">${text}</svg>`,
          ),
        },
      ])
      .png()
      .toBuffer();
    screenshot = png.toString('base64');

    // An Omni-Vision of its own, whose worker this suite starts and ends.
    restoreContainer = saveRegistrations(OmniVisionService);
    Container.set(OmniVisionService, new OmniVisionService());
  });

  after(async () => {
    const worker = (Container.get(OmniVisionService) as any).sharedWorker;
    await worker?.terminate();
    restoreContainer();
  });

  /** An Android driver: no element answers an iOS predicate, so the tier says where the text is. */
  const android = { findElement: async () => Promise.reject(new Error('unsupported locator')) };

  const heal = (selector: string) =>
    new OcrHealingProvider().heal({
      sessionId: 'real-ocr-session',
      driver: android,
      strategy: 'xpath',
      selector,
      screenshotBase64: screenshot,
    });

  /** The healed element's box lies on `line`, starting where its text starts. */
  const expectOnLine = (rect: any, line: keyof typeof LINES) => {
    const { top, bottom } = band(line);
    expect(rect, 'rect').to.be.an('object');
    expect(rect.y, `top of the box, on "${line}"`).to.be.within(top, bottom);
    expect(rect.y + rect.height, `bottom of the box, on "${line}"`).to.be.within(top, bottom);
    expect(rect.x, 'left of the box').to.be.within(40, 80);
  };

  it('finds a two-word text on its line, not a lone word of it read earlier', async () => {
    const healed = await heal("//*[@text='Sign in']");

    expect(healed, 'healed').to.not.equal(null);
    expect(healed!.id).to.match(/^healed_ocr_/);
    expect(healed!.recommendedSelector).to.equal('ocr:text="Sign in"');
    expect(healed!.text).to.equal('Sign in');
    expectOnLine(healed!.rect, 'Sign in');
    // Both words: wider than "Sign" alone at this size.
    expect(healed!.rect!.width).to.be.above(150);
    expect(healed!.confidence).to.be.within(0.6, 1);
  });

  it('does not take a word that is only part of the text', async () => {
    const healed = await heal("//*[@text='Login']");

    expect(healed, 'healed').to.not.equal(null);
    expect(healed!.text).to.equal('Login');
    expectOnLine(healed!.rect, 'Login');
  });

  it('reads the text from the attribute the selector names, whatever its case', async () => {
    const healed = await heal("//android.widget.Button[@content-desc='check IN']");

    expect(healed, 'healed').to.not.equal(null);
    expect(healed!.text).to.equal('Check in');
    expectOnLine(healed!.rect, 'Check in');
  });

  it('heals nothing when the text is not on the screen', async () => {
    expect(await heal("//*[@text='Sign up']")).to.equal(null);
  });
});
