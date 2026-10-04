import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { OmniVisionService } from '../../src/services/omni-vision/OmniVisionService';
import { AI_SERVICE } from '../../src/services/AIService';

/**
 * `xenon: analyzeScreen` (and device control's Omni-Scan) sent the screenshot's
 * base64 where a file path was expected. The AI step found no such file and
 * asked the provider without an image, under a "why did this test fail"
 * prompt, so `ai_insights` was generic text about no screen at all.
 *
 * Now the screenshot goes to the provider with a prompt about the screen, and
 * when there is no AI answer `ai_insights_error` says why.
 */
describe('xenon: analyzeScreen', () => {
  const SCREEN = 'c2NyZWVuc2hvdA==';
  let service: OmniVisionService;
  const driver = { sessionId: 'session-1', getScreenshot: async () => SCREEN };

  beforeEach(() => {
    service = new OmniVisionService();
    sinon.stub(service as any, 'performOcr').resolves({
      text: 'Sign in',
      words: [{ text: 'Sign', confidence: 95, bbox: { x0: 10, y0: 10, x1: 50, y1: 30 } }],
    });
    sinon.stub(AI_SERVICE as any, 'initializeProvider');
  });
  afterEach(() => sinon.restore());

  it('sends the screenshot to the AI provider and asks about the screen', async () => {
    sinon.stub(AI_SERVICE as any, 'provider').value({ analyze: async () => '' });
    const call = sinon
      .stub(AI_SERVICE as any, 'callProvider')
      .resolves('A sign-in screen with an email field.');

    const analysis = await service.analyzeScreen(driver);

    expect(call.calledOnce).to.equal(true);
    const [prompt, image] = call.firstCall.args;
    expect(image).to.equal(SCREEN);
    expect(prompt).to.match(/screen/i);
    expect(prompt).to.not.match(/root cause|failed/i);
    expect(analysis.ai_insights).to.equal('A sign-in screen with an email field.');
    expect(analysis).to.not.have.property('ai_insights_error');
    expect(analysis.ocr.text).to.equal('Sign in');
  });

  it('says why there are no AI insights when no provider is configured', async () => {
    sinon.stub(AI_SERVICE as any, 'provider').value(null);
    const analysis = await service.analyzeScreen(driver);
    expect(analysis.ai_insights).to.equal(null);
    expect(analysis.ai_insights_error).to.match(/No AI provider is configured/);
    expect(analysis.ocr.text).to.equal('Sign in');
  });

  it('says why there are no AI insights when the provider fails', async () => {
    sinon.stub(AI_SERVICE as any, 'provider').value({ analyze: async () => '' });
    sinon.stub(AI_SERVICE as any, 'callProvider').rejects(new Error('429 quota exceeded'));
    const analysis = await service.analyzeScreen(driver);
    expect(analysis.ai_insights).to.equal(null);
    expect(analysis.ai_insights_error).to.match(/429 quota exceeded/);
    expect(analysis.ocr.text).to.equal('Sign in');
  });
});
