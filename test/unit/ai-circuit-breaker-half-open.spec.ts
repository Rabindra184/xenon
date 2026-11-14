import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { CIRCUIT_BREAKERS, CircuitOpenError } from '../../src/services/CircuitBreaker';
import { AIService } from '../../src/services/AIService';
import { config } from '../../src/config';
import { useFakeAiProviders } from '../helpers/fake-ai-provider';

/**
 * Once its cooldown is over, an open breaker lets one call through (the
 * probe), and that call alone decides: it closes the breaker if it works and
 * opens it again if it fails, however it fails. Through 2.36 every caller was
 * let through while half-open, and a probe that failed with a 4xx (which the
 * breaker doesn't count) left it half-open, so it let everyone through until
 * enough transient failures piled up again.
 */
describe('the AI circuit breaker, after its cooldown', () => {
  let clock: sinon.SinonFakeTimers;
  let key: string;
  const OPTS = { failureThreshold: 1, openDurationMs: 60_000 };

  const transient = () => Object.assign(new Error('Service Unavailable'), { status: 503 });
  const badRequest = () => Object.assign(new Error('Bad Request'), { status: 400 });
  const stateOf = (k: string) => CIRCUIT_BREAKERS.snapshot().find((b) => b.key === k)?.state;
  const run = <T>(task: () => Promise<T>) => CIRCUIT_BREAKERS.execute(key, task, OPTS);

  async function tripAndWait(): Promise<void> {
    await run(async () => {
      throw transient();
    }).catch(() => undefined);
    expect(stateOf(key)).to.equal('open');
    clock.tick(OPTS.openDurationMs);
  }

  beforeEach(() => {
    clock = sinon.useFakeTimers({ toFake: ['Date'] });
    key = `test:breaker:${Math.random().toString(36).slice(2)}`;
  });

  afterEach(() => clock.restore());

  it('lets one call through and holds back the others while it runs', async () => {
    await tripAndWait();
    let finish!: (v: string) => void;
    const probe = run(() => new Promise<string>((r) => (finish = r)));
    expect(stateOf(key)).to.equal('half_open');

    const second = await run(async () => 'second').catch((e) => e);
    expect(second).to.be.instanceOf(CircuitOpenError);

    finish('probe');
    expect(await probe).to.equal('probe');
    expect(stateOf(key)).to.equal('closed');
    expect(await run(async () => 'after')).to.equal('after');
  });

  it('opens again when the probe fails with a 4xx, which it would not count while closed', async () => {
    await tripAndWait();
    await run(async () => {
      throw badRequest();
    }).catch(() => undefined);

    expect(stateOf(key)).to.equal('open');
    const next = await run(async () => 'next').catch((e) => e);
    expect(next).to.be.instanceOf(CircuitOpenError);
  });

  it('opens again when the probe fails with a transient error', async () => {
    await tripAndWait();
    await run(async () => {
      throw transient();
    }).catch(() => undefined);
    expect(stateOf(key)).to.equal('open');
  });

  it('lets another probe through when one never comes back', async () => {
    await tripAndWait();
    void run(() => new Promise<string>(() => undefined));
    clock.tick(OPTS.openDurationMs);
    expect(await run(async () => 'second probe')).to.equal('second probe');
    expect(stateOf(key)).to.equal('closed');
  });

  it('is not settled by a call let through before it opened', async () => {
    let finishEarly!: (v: unknown) => void;
    // In flight while the breaker was closed.
    const early = run(
      () =>
        new Promise((_resolve, reject) => {
          finishEarly = reject;
        }),
    ).catch(() => undefined);
    await tripAndWait();
    let finishProbe!: (v: string) => void;
    const probe = run(() => new Promise<string>((r) => (finishProbe = r)));

    finishEarly(badRequest());
    await early;
    expect(stateOf(key), 'still waiting on its probe').to.equal('half_open');
    finishProbe('ok');
    await probe;
    expect(stateOf(key)).to.equal('closed');
  });
});

describe("the AI circuit breaker's key", () => {
  const ai = useFakeAiProviders();
  const FAILURE = {
    sessionId: 'sess-breaker-key',
    failureReason: 'An element could not be located on the page',
    commandLogs: [],
    deviceLogs: [],
  };

  it("is the model the provider calls, the generic model when the provider's own isn't set", async () => {
    ai.use('openai');
    const generic = `generic-${Math.random().toString(36).slice(2)}`;
    config.openaiModel = undefined as any;
    config.aiModel = generic;
    ai.answer({ status: 429 });
    const service = new AIService();

    await service.analyzeFailure(FAILURE);

    expect(JSON.parse(ai.calls[0].body).model, 'the model called').to.equal(generic);
    const keys = CIRCUIT_BREAKERS.snapshot().map((b) => b.key);
    expect(keys).to.include(`ai:openai:${generic}`);
    expect(keys).not.to.include('ai:openai:default');
  });
});
