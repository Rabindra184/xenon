import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { AIService, AI_CALL_TIMEOUT_MS } from '../../src/services/AIService';
import { CIRCUIT_BREAKERS } from '../../src/services/CircuitBreaker';
import { HealingOrchestrator } from '../../src/services/healing/HealingOrchestrator';
import { useFakeAiProviders } from '../helpers/fake-ai-provider';

/**
 * An AI call made while a test command runs has a time limit.
 *
 * The LLM and visual healing tiers run inside a failing findElement, the
 * visual assertion and the screen description inside an execute script, and
 * an ai-icon find inside findElement or device control's Test locator. Only
 * Ollama had a time limit (30 s). The OpenAI and Anthropic SDKs wait up to 10
 * minutes a try, with two retries, and Gemini has none, so one provider that
 * didn't answer held the command, and the test, for as long, past the
 * client's own timeout.
 */
describe('AI calls made during a test command', () => {
  const ai = useFakeAiProviders();
  const SCREEN = 'c2NyZWVuc2hvdA==';

  afterEach(() => sinon.restore());

  /** What a call came to: its answer, or its error. */
  const outcomeOf = (p: Promise<unknown>) =>
    p.then(
      (value) => ({ value, error: undefined as Error | undefined }),
      (error: Error) => ({ value: undefined, error }),
    );

  const calls: Array<{
    name: string;
    call: (service: AIService) => Promise<unknown>;
    expectOutcome: (outcome: { value: unknown; error?: Error }) => void;
  }> = [
    {
      name: 'an LLM heal finds nothing',
      call: (s) => s.healLocator({ selector: '//x', strategy: 'xpath', xml: '<hierarchy/>' }),
      expectOutcome: ({ value, error }) => {
        expect(error).to.equal(undefined);
        expect(value).to.equal(null);
      },
    },
    {
      name: 'a visual heal or ai-icon find finds nothing',
      call: (s) => s.visualFind(SCREEN, 'the cart icon'),
      expectOutcome: ({ value, error }) => {
        expect(error).to.equal(undefined);
        expect(value).to.equal(null);
      },
    },
    {
      name: "Test locator fails, saying the provider didn't answer",
      call: (s) => s.visualFind(SCREEN, 'the cart icon', { throwOnError: true }),
      expectOutcome: ({ error }) => {
        expect(error?.message).to.equal("The AI provider didn't answer within 30 s");
      },
    },
    {
      name: "a visual assertion fails, saying the provider didn't answer",
      call: (s) => s.assertVisual(SCREEN, 'The cart is empty'),
      expectOutcome: ({ error }) => {
        expect(error?.message).to.equal(
          "The AI provider didn't answer within 30 s, so the condition was not checked. Try again later.",
        );
      },
    },
    {
      name: "a screen description fails, saying the provider didn't answer",
      call: (s) => s.describeScreen(SCREEN),
      expectOutcome: ({ error }) => {
        expect(error?.message).to.equal("The AI provider didn't answer within 30 s");
      },
    },
  ];

  for (const { name, call, expectOutcome } of calls) {
    it(`gives up at the limit, cancelling the request: ${name}`, async () => {
      const { model } = ai.use('anthropic');
      ai.answer('hang');
      const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const service = new AIService();

      const outcome = outcomeOf(call(service));
      await clock.tickAsync(AI_CALL_TIMEOUT_MS - 1);
      expect(ai.calls).to.have.length(1);
      expect(ai.calls[0].signal?.aborted).to.equal(false);
      await clock.tickAsync(1);
      expect(ai.calls[0].signal?.aborted).to.equal(true);

      expectOutcome(await outcome);
      const breaker = CIRCUIT_BREAKERS.snapshot().find((b) => b.key === `ai:anthropic:${model}`);
      expect(breaker?.consecutiveFailures).to.equal(1);
    });
  }

  it("Test connection fails at the limit, saying the provider didn't answer", async () => {
    ai.use('openai');
    ai.answer('hang');
    const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const result = new AIService().testConnection({});
    await clock.tickAsync(AI_CALL_TIMEOUT_MS);

    expect(await result).to.deep.equal({
      success: false,
      message: "Connection failed: The AI provider didn't answer within 30 s",
    });
    expect(ai.calls[0].signal?.aborted).to.equal(true);
  });

  it('a failing findElement is answered within two time limits, after both AI tiers', async () => {
    ai.use('gemini');
    ai.answer('hang');
    const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const driver = {
      getPageSource: async () => '<hierarchy/>',
      getScreenshot: async () => SCREEN,
      findElement: sinon.stub().rejects(new Error('no such element')),
    };

    let healed: unknown = 'not answered';
    const healing = new HealingOrchestrator({} as any)
      // The visual tier (4), then the LLM tier (5).
      .attemptHealing('sess-time-limit', driver, 'id', 'login', [4, 5])
      .then((result) => (healed = result));

    await clock.tickAsync(AI_CALL_TIMEOUT_MS);
    expect(ai.calls).to.have.length(2);
    await clock.tickAsync(AI_CALL_TIMEOUT_MS);
    await healing;

    expect(healed).to.equal(null);
    expect(ai.calls.map((c) => c.signal?.aborted)).to.deep.equal([true, true]);
  });
});
