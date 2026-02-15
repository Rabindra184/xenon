import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { OmniVisionService } from '../../src/services/omni-vision/OmniVisionService';
import Tesseract from 'tesseract.js';
import { AI_SERVICE } from '../../src/services/AIService';

describe('OmniVisionService Unit Tests', () => {
  let omniService: OmniVisionService;
  let mockDriver: any;

  beforeEach(() => {
    // Reset container to ensure clean state
    Container.reset();
    omniService = Container.get(OmniVisionService);
    mockDriver = {
      getScreenshot: sinon.stub().resolves('mock_screenshot_base64'),
      sessionId: 'test_session',
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('findByText should return matched elements via OCR', async () => {
    const mockOcrResult = {
      data: {
        words: [
          { text: 'Login', confidence: 90, bbox: { x0: 10, y0: 10, x1: 50, y1: 30 } },
          { text: 'Cancel', confidence: 80, bbox: { x0: 60, y0: 10, x1: 100, y1: 30 } },
        ],
      },
    };
    sinon.stub(Tesseract, 'recognize').resolves(mockOcrResult as any);

    const results = await omniService.findByText(mockDriver, 'Login');

    expect(results).to.have.lengthOf(1);
    expect(results[0].text).to.equal('Login');
    expect(results[0].id).to.contain('omni_ocr_');
    expect(results[0].rect).to.deep.equal({ x: 10, y: 10, width: 40, height: 20 });
  });

  it('findByIcon should return matched element via Vision AI', async () => {
    // Mock the Vision AI response
    sinon.stub(AI_SERVICE, 'visualFind').resolves({ x: 50, y: 50 } as any);

    const result = await omniService.findByIcon(mockDriver, 'cart');

    expect(result).to.not.be.null;
    expect(result?.id).to.contain('omni_ai_');
    expect(result?.rect).to.deep.equal({ x: 30, y: 30, width: 40, height: 40 });
  });

  it('getVirtualElement should retrieve stored elements', async () => {
    sinon.stub(AI_SERVICE, 'visualFind').resolves({ x: 50, y: 50 } as any);
    const created = await omniService.findByIcon(mockDriver, 'back');

    if (created) {
      const retrieved = omniService.getVirtualElement(created.id);
      expect(retrieved).to.deep.equal(created);
    } else {
      throw new Error('Failed to create mock virtual element');
    }
  });

  it('analyzeScreen should combine OCR and AI insights', async () => {
    const mockOcrResult = {
      data: {
        text: 'Screen Text',
        words: [{ text: 'Screen', confidence: 90, bbox: {} }],
      },
    };
    sinon.stub(Tesseract, 'recognize').resolves(mockOcrResult as any);
    sinon.stub(AI_SERVICE, 'analyzeFailure').resolves('AI Insights text');

    const analysis = await omniService.analyzeScreen(mockDriver);

    expect(analysis.ocr.text).to.equal('Screen Text');
    expect(analysis.ai_insights).to.equal('AI Insights text');
    expect(analysis.timestamp).to.exist;
  });
});
