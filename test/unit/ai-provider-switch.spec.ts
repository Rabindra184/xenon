import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { config } from '../../src/config';
import { AIService, AI_SERVICE } from '../../src/services/AIService';
import { LlmHealingProvider } from '../../src/services/healing/LlmHealingProvider';
import { VisualAiHealingProvider } from '../../src/services/healing/VisualAiHealingProvider';
import { useFakeAiProviders } from '../helpers/fake-ai-provider';

/**
 * The AI engine page changes the provider while the server runs (`POST
 * /config` writes `config.aiProvider` and the models). The AI service set its
 * provider up when it was created, and again only inside its own calls, while
 * failure analysis and the LLM and visual healing tiers first asked
 * `isEnabled()`, which read what was set up last. A server started with a
 * provider that had no key never turned those on when a configured one was
 * chosen; one started with a configured provider kept using it after a
 * provider with no key was chosen.
 */
describe('AI provider chosen while the server runs', () => {
  const ai = useFakeAiProviders();
  const SCREEN = 'c2NyZWVuc2hvdA==';
  const FAILURE = {
    sessionId: 'sess-switch',
    failureReason: 'An element could not be located on the page',
    commandLogs: [],
    deviceLogs: [],
  };

  afterEach(() => sinon.restore());

  it('turns on when a provider with a key is chosen after one without', () => {
    ai.use('gemini', { key: false });
    const service = new AIService();
    expect(service.isEnabled()).to.equal(false);

    ai.use('anthropic');
    expect(service.isEnabled()).to.equal(true);
  });

  it('turns off when a provider without a key is chosen, and stops asking the old one', async () => {
    ai.use('openai');
    ai.answer({ text: 'Root Cause: from OpenAI' });
    const service = new AIService();
    expect(service.isEnabled()).to.equal(true);

    ai.use('anthropic', { key: false });
    expect(service.isEnabled()).to.equal(false);
    expect(await service.analyzeFailure(FAILURE)).to.equal(null);
    expect(ai.calls).to.have.length(0);
  });

  it('asks the model chosen last', async () => {
    ai.use('openai');
    ai.answer({ text: 'Root Cause: x' });
    const service = new AIService();
    await service.analyzeFailure(FAILURE);

    config.openaiModel = 'test-openai-chosen-later';
    await service.analyzeFailure(FAILURE);

    expect(JSON.parse(ai.calls[1].body).model).to.equal('test-openai-chosen-later');
  });

  describe('the healing tiers', () => {
    beforeEach(() => {
      // The server started with a provider that has no key.
      ai.use('gemini', { key: false });
      expect(AI_SERVICE.isEnabled()).to.equal(false);
      // Then a configured one is chosen on the AI engine page.
      ai.use('anthropic');
    });

    it('the LLM tier asks the provider chosen on the AI engine page', async () => {
      ai.answer({
        text: '{"recommendedXpath": "//button[@text=\'Log in\']", "reason": "same text"}',
      });
      const driver = { findElement: sinon.stub().resolves({ ELEMENT: 'el-1' }) };

      const healed = await new LlmHealingProvider().heal({
        sessionId: 'sess-switch',
        driver,
        strategy: 'id',
        selector: 'login',
        pageSource: '<hierarchy/>',
        screenshotBase64: SCREEN,
      });

      expect(ai.calls).to.have.length(1);
      expect(healed?.id).to.equal('el-1');
      expect(driver.findElement.firstCall.args).to.deep.equal([
        'xpath',
        "//button[@text='Log in']",
      ]);
    });

    it('the visual tier asks the provider chosen on the AI engine page', async () => {
      ai.answer({ text: '{"x": 120, "y": 340}' });

      const healed = await new VisualAiHealingProvider().heal({
        sessionId: 'sess-switch',
        driver: {},
        strategy: 'id',
        selector: 'login',
        screenshotBase64: SCREEN,
      });

      expect(ai.calls).to.have.length(1);
      expect(healed?.rect).to.deep.equal({ x: 100, y: 320, width: 40, height: 40 });
    });
  });
});
