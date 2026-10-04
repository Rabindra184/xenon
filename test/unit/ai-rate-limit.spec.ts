import 'reflect-metadata';
import { expect } from 'chai';
import { AIService } from '../../src/services/AIService';
import { CIRCUIT_BREAKERS } from '../../src/services/CircuitBreaker';
import { PROVIDERS, useFakeAiProviders } from '../helpers/fake-ai-provider';

/**
 * A rate-limited provider (HTTP 429) is a failed call, whichever provider it
 * is.
 *
 * Gemini's provider answered a 429 with the string
 * 'CONNECTION_OK_RATE_LIMITED' instead of failing, so a failed session's AI
 * analysis was saved as that string and shown on the session page, in the
 * copied report and in bug reports. The circuit breaker counted it as a
 * success, so it never stopped calling a provider that kept refusing. Only the
 * visual assertion and the screen description checked for the string.
 */
describe('AI provider rate limits', () => {
  const ai = useFakeAiProviders();
  const FAILURE = {
    sessionId: 'sess-rate-limit',
    failureReason: 'An element could not be located on the page',
    commandLogs: [],
    deviceLogs: [],
  };
  const SCREEN = 'c2NyZWVuc2hvdA==';

  const failureOf = (p: Promise<unknown>) =>
    p.then(
      (value) => {
        throw new Error(`expected a failure, got ${JSON.stringify(value)}`);
      },
      (e: Error) => e,
    );

  for (const provider of PROVIDERS) {
    describe(provider, () => {
      let service: AIService;
      let model: string;

      beforeEach(() => {
        ({ model } = ai.use(provider));
        ai.answer({ status: 429 });
        service = new AIService();
      });

      it('gives no failure analysis', async () => {
        expect(await service.analyzeFailure(FAILURE)).to.equal(null);
        expect(ai.calls).to.have.length(1);
      });

      it('counts against the circuit breaker, which stops calling after five', async () => {
        for (let i = 0; i < 6; i++) await service.analyzeFailure(FAILURE);

        expect(ai.calls).to.have.length(5);
        const breaker = CIRCUIT_BREAKERS.snapshot().find(
          (b) => b.key === `ai:${provider}:${model}`,
        );
        expect(breaker?.state).to.equal('open');
      });

      it('fails a visual assertion, saying the provider is rate-limited', async () => {
        const err = await failureOf(service.assertVisual(SCREEN, 'The cart is empty'));
        expect(err.message).to.match(/rate-limited/);
        expect(err.message).to.match(/not checked/);
      });

      it('gives no screen description, saying the provider is rate-limited', async () => {
        const err = await failureOf(service.describeScreen(SCREEN));
        expect(err.message).to.match(/rate-limited/);
      });

      it('fails a locator test, saying the provider is rate-limited', async () => {
        const err = await failureOf(
          service.visualFind(SCREEN, 'the cart icon', { throwOnError: true }),
        );
        expect(err.message).to.match(/rate-limited/);
      });

      it('finds nothing for a healing or an ai-icon search', async () => {
        expect(await service.visualFind(SCREEN, 'the cart icon')).to.equal(null);
        expect(
          await service.healLocator({ selector: '//x', strategy: 'xpath', xml: '<hierarchy/>' }),
        ).to.equal(null);
      });

      it('fails the connection test, saying the provider is rate-limited', async () => {
        const result = await service.testConnection({});
        expect(result.success).to.equal(false);
        expect(result.message).to.match(/rate-limited or out of quota/);
      });
    });
  }

  it("still gives a provider's real answer", async () => {
    ai.use('gemini');
    ai.answer({ text: 'Root Cause: the Login button was covered by a dialog.' });
    expect(await new AIService().analyzeFailure(FAILURE)).to.equal(
      'Root Cause: the Login button was covered by a dialog.',
    );
  });
});
