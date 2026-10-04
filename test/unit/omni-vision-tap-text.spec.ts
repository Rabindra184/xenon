import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { OmniVisionService } from '../../src/services/omni-vision/OmniVisionService';
import { AI_SERVICE } from '../../src/services/AIService';

/**
 * `xenon: smartTap { text }` (and `omniClick`) compared the text with one OCR
 * word at a time, so any text with a space in it ("Sign in", "Forgot
 * password?") never matched: the answer was `clicked: false`. The
 * `-custom:ai-text` locator had the same rule. Now the text is looked for
 * across neighbouring words on one line, and the tap goes to the middle of
 * the words it covers.
 */
describe('Omni-Vision text taps match phrases', () => {
  // Tesseract's words, in screenshot pixels. One line holds "Sign in" and,
  // far to the right, "Help"; "Sign" and "in" also appear on two lines.
  const word = (text: string, x0: number, y0: number, x1: number, y1: number) => ({
    text,
    confidence: 90,
    bbox: { x0, y0, x1, y1 },
  });
  const WORDS = [
    word('Sign', 100, 200, 150, 224),
    word('in', 158, 200, 180, 224),
    word('Help', 600, 200, 650, 224),
    word('Forgot', 100, 300, 170, 324),
    word('password?', 178, 300, 290, 324),
    word('Sign', 100, 400, 150, 424),
    word('in', 100, 440, 120, 464),
  ];

  let service: OmniVisionService;
  let driver: any;

  beforeEach(() => {
    service = new OmniVisionService();
    sinon.stub(service as any, 'performOcr').resolves({ text: '', words: WORDS });
    driver = {
      sessionId: 'session-1',
      // An Android driver: its W3C coordinates are the screenshot's pixels.
      caps: { platformName: 'Android' },
      getScreenshot: sinon.stub().resolves('aGVsbG8='),
      performActions: sinon.stub().resolves(),
      releaseActions: sinon.stub().resolves(),
    };
  });
  afterEach(() => sinon.restore());

  const tappedAt = () => {
    const move = driver.performActions.firstCall.args[0][0].actions[0];
    return { x: move.x, y: move.y };
  };

  it('taps the middle of a two-word text', async () => {
    const result = await service.omniClickByText(driver, { text: 'Sign in' });
    expect(result.clicked, result.message).to.equal(true);
    expect(result.target).to.deep.include({
      text: 'Sign in',
      x: 140,
      y: 212,
      rect: { x: 100, y: 200, width: 80, height: 24 },
    });
    expect(tappedAt()).to.deep.equal({ x: 140, y: 212 });
  });

  it('matches a phrase whatever its case, and part of a word at either end', async () => {
    const result = await service.omniClickByText(driver, { text: 'forgot PASSWORD' });
    expect(result.clicked, result.message).to.equal(true);
    expect(result.target?.text).to.equal('Forgot password?');
    expect(tappedAt()).to.deep.equal({ x: 195, y: 312 });
  });

  it('does not join words on different lines, or far apart on one line', async () => {
    for (const text of ['in Help', 'Sign in Help', 'password? Sign']) {
      const result = await service.omniClickByText(driver, { text });
      expect(result.clicked, text).to.equal(false);
    }
    expect(driver.performActions.called).to.equal(false);
  });

  it('still matches a single word, as before', async () => {
    const result = await service.omniClickByText(driver, { text: 'help' });
    expect(result.clicked, result.message).to.equal(true);
    expect(tappedAt()).to.deep.equal({ x: 625, y: 212 });
  });

  it('finds a phrase with the -custom:ai-text locator too', async () => {
    const found = await service.findByText(driver, 'Sign in');
    expect(found).to.have.lengthOf(1);
    expect(found[0].text).to.equal('Sign in');
    expect(found[0].rect).to.deep.equal({ x: 100, y: 200, width: 80, height: 24 });
  });
});

/**
 * `xenon: smartTap { icon }` / `visualTap` answered `clicked: false`, "No visual
 * match found", when it never looked: no AI provider, or the AI call failed.
 * It now fails with the reason; `clicked: false` means the AI looked and found
 * nothing.
 */
describe('Omni-Vision icon taps that cannot look', () => {
  const driver = {
    sessionId: 'session-1',
    caps: { platformName: 'Android' },
    getScreenshot: async () => 'aGVsbG8=',
    performActions: sinon.stub().resolves(),
  };
  beforeEach(() => {
    sinon.stub(AI_SERVICE as any, 'initializeProvider');
  });
  afterEach(() => sinon.restore());

  it('fails when no AI provider is configured', async () => {
    sinon.stub(AI_SERVICE as any, 'provider').value(null);
    const err = await new OmniVisionService().omniClickByIcon(driver, { icon: 'the gear' }).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).to.match(/No AI provider is configured/);
  });

  it('answers clicked: false when the AI looked and found nothing', async () => {
    sinon.stub(AI_SERVICE, 'visualFind').resolves(null);
    const result = await new OmniVisionService().omniClickByIcon(driver, { icon: 'the gear' });
    expect(result.clicked).to.equal(false);
    expect(result.message).to.match(/No visual match/);
  });
});
