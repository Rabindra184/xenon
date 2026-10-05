import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { OcrHealingProvider } from '../../src/services/healing/OcrHealingProvider';
import { OmniVisionService } from '../../src/services/omni-vision/OmniVisionService';
import { VisualAiHealingProvider } from '../../src/services/healing/VisualAiHealingProvider';
import { AI_SERVICE } from '../../src/services/AIService';

/**
 * Self-healing's OCR tier took the first word OCR read that contained the
 * text, or was part of it: for `Sign in` that was any lone "in" or "Sign" on
 * the screen, and for `Login` a "Log". It now matches as Omni-Vision's
 * `-custom:ai-text` does (ocrTextMatch.ts): the text across neighbouring words
 * on one line, the first match in reading order.
 *
 * OCR is stubbed with the words it would read, in screenshot pixels: no
 * Tesseract runs. ocr-healing-tier-real-ocr.spec.ts runs the tier on a real
 * screenshot, which a stub can't stand in for: tesseract.js's own output is
 * what hid the tier's never healing.
 */
describe('The OCR healing tier matches text as Omni-Vision does', () => {
  const word = (text: string, x0: number, y0: number, x1: number, y1: number) => ({
    text,
    confidence: 90,
    bbox: { x0, y0, x1, y1 },
  });
  // A heading with "Log" and a lone "in" read first; then "Sign in", far
  // from "Help" on its line; then "Login".
  const WORDS = [
    word('Log', 40, 60, 90, 84),
    word('in', 300, 60, 320, 84),
    word('Sign', 100, 200, 150, 224),
    word('in', 158, 200, 180, 224),
    word('Help', 600, 200, 650, 224),
    word('Login', 100, 400, 180, 424),
  ];

  let driver: any;

  beforeEach(() => {
    // OCR reads these words: the tier asks Omni-Vision's OCR.
    sinon
      .stub(Container.get(OmniVisionService) as any, 'performOcr')
      .resolves({ text: '', words: WORDS });
    // Android: no element is found by an iOS predicate, so the tier answers
    // with where the text is.
    driver = { findElement: sinon.stub().rejects(new Error('unsupported locator strategy')) };
  });
  afterEach(() => sinon.restore());

  const heal = (selector: string) =>
    new OcrHealingProvider().heal({
      sessionId: 'ocr-session',
      driver,
      strategy: 'xpath',
      selector,
      screenshotBase64: 'aGVsbG8=',
    });

  it('finds a two-word text across its words, not a lone word of it', async () => {
    const healed = await heal("//*[@text='Sign in']");

    expect(healed, 'healed').to.not.equal(null);
    expect(healed!.recommendedSelector).to.equal('ocr:text="Sign in"');
    expect(healed!.rect).to.deep.equal({ x: 100, y: 200, width: 80, height: 24 });
  });

  it('hands on the text it read, for getText on the element it returns', async () => {
    const healed = await heal("//*[@text='sign IN']");

    expect(healed!.text).to.equal('Sign in');
    expect(healed!.message).to.not.equal(healed!.text);
  });

  it('does not take a word that is only part of the text', async () => {
    const healed = await heal("//*[@text='Login']");

    expect(healed, 'healed').to.not.equal(null);
    expect(healed!.recommendedSelector).to.equal('ocr:text="Login"');
    expect(healed!.rect).to.deep.equal({ x: 100, y: 400, width: 80, height: 24 });
  });

  it('finds nothing when the text is not on the screen', async () => {
    expect(await heal("//*[@text='Sign up']")).to.equal(null);
  });
});

/**
 * A healed element's id names it in the server's memory of virtual elements,
 * which every session shares. `healed_ocr_<ms>` was the same for two heals in
 * one millisecond, so the second overwrote the first.
 */
describe('Elements healed by OCR or Visual AI', () => {
  afterEach(() => sinon.restore());

  const context = {
    sessionId: 'ids-session',
    driver: { findElement: async () => Promise.reject(new Error('no predicate')) },
    strategy: 'xpath',
    selector: "//*[@text='Login']",
    screenshotBase64: 'aGVsbG8=',
  };

  it('get ids of their own when healed in the same millisecond', async () => {
    sinon.stub(Date, 'now').returns(1_700_000_000_000);
    sinon.stub(Container.get(OmniVisionService) as any, 'performOcr').resolves({
      text: '',
      words: [{ text: 'Login', confidence: 90, bbox: { x0: 1, y0: 1, x1: 50, y1: 20 } }],
    });
    sinon.stub(AI_SERVICE, 'isEnabled').returns(true);
    sinon.stub(AI_SERVICE, 'visualFind').resolves({ x: 100, y: 100 } as any);

    const ids = [
      (await new OcrHealingProvider().heal(context))?.id,
      (await new OcrHealingProvider().heal(context))?.id,
      (await new VisualAiHealingProvider().heal(context))?.id,
      (await new VisualAiHealingProvider().heal(context))?.id,
    ];

    expect(ids.every(Boolean), String(ids)).to.equal(true);
    expect(new Set(ids).size, String(ids)).to.equal(4);
  });
});
