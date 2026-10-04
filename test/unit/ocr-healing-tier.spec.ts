import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import Tesseract from 'tesseract.js';
import { OcrHealingProvider } from '../../src/services/healing/OcrHealingProvider';
import { OmniVisionService } from '../../src/services/omni-vision/OmniVisionService';

/**
 * Self-healing's OCR tier took the first word OCR read that contained the
 * text, or was part of it: for `Sign in` that was any lone "in" or "Sign" on
 * the screen, and for `Login` a "Log". It now matches as Omni-Vision's
 * `-custom:ai-text` does (ocrTextMatch.ts): the text across neighbouring words
 * on one line, the first match in reading order.
 *
 * OCR is stubbed with the words it would read, in screenshot pixels: no
 * Tesseract runs.
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
    // The tier used to call Tesseract itself, and now asks Omni-Vision's OCR:
    // both read the same words.
    sinon.stub(Tesseract, 'recognize').resolves({ data: { words: WORDS } } as any);
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
