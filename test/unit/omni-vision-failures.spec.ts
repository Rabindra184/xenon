import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { OmniVisionService } from '../../src/services/omni-vision/OmniVisionService';
import { AI_SERVICE } from '../../src/services/AIService';

/**
 * Device control's "Test locator" answered 200 with no matches when OCR or
 * the AI call failed, which reads as "the locator finds nothing". The search
 * now fails for a caller that asks it to (`throwOnError`). An Appium
 * findElement still gets an empty result, which it turns into
 * NoSuchElement, as before.
 */
describe('OmniVisionService search failures', () => {
  const driver = { sessionId: 'manual_x', getScreenshot: sinon.stub() };
  let service: OmniVisionService;

  beforeEach(() => {
    service = new OmniVisionService();
    driver.getScreenshot = sinon.stub().resolves('aGVsbG8=');
  });
  afterEach(() => sinon.restore());

  describe('findByText', () => {
    beforeEach(() => {
      sinon.stub(service as any, 'performOcr').rejects(new Error('OCR worker crashed'));
    });

    it('keeps answering an empty list for Appium', async () => {
      expect(await service.findByText(driver, 'Login')).to.deep.equal([]);
    });

    it('fails when asked to', async () => {
      const err = await service.findByText(driver, 'Login', { throwOnError: true }).then(
        () => null,
        (e: Error) => e,
      );
      expect(err?.message).to.equal('OCR worker crashed');
    });
  });

  describe('findByIcon', () => {
    beforeEach(() => {
      sinon.stub(AI_SERVICE, 'visualFind').rejects(new Error('AI provider timed out'));
    });

    it('keeps answering null for Appium', async () => {
      expect(await service.findByIcon(driver, 'gear icon')).to.equal(null);
    });

    it('fails when asked to', async () => {
      const err = await service.findByIcon(driver, 'gear icon', { throwOnError: true }).then(
        () => null,
        (e: Error) => e,
      );
      expect(err?.message).to.equal('AI provider timed out');
    });

    it('still answers null, without failing, when nothing matches', async () => {
      (AI_SERVICE.visualFind as sinon.SinonStub).resolves(null);
      expect(await service.findByIcon(driver, 'gear icon', { throwOnError: true })).to.equal(null);
    });
  });

  describe('AIService.visualFind', () => {
    beforeEach(() => {
      sinon.stub(AI_SERVICE as any, 'initializeProvider');
    });

    it('answers null without a provider, or fails when asked to', async () => {
      sinon.stub(AI_SERVICE as any, 'isEnabled').returns(false);
      expect(await AI_SERVICE.visualFind('aGVsbG8=', 'gear icon')).to.equal(null);
      const err = await AI_SERVICE.visualFind('aGVsbG8=', 'gear icon', { throwOnError: true }).then(
        () => null,
        (e: Error) => e,
      );
      expect(err?.message).to.equal('No AI provider is configured');
    });

    it('answers null when the provider fails, or fails when asked to', async () => {
      sinon.stub(AI_SERVICE as any, 'isEnabled').returns(true);
      sinon.stub(AI_SERVICE as any, 'callProvider').rejects(new Error('429 quota exceeded'));
      expect(await AI_SERVICE.visualFind('aGVsbG8=', 'gear icon')).to.equal(null);
      const err = await AI_SERVICE.visualFind('aGVsbG8=', 'gear icon', { throwOnError: true }).then(
        () => null,
        (e: Error) => e,
      );
      expect(err?.message).to.equal('429 quota exceeded');
    });
  });
});
