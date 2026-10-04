import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { AIService, AI_SERVICE, FAILURE_ANALYSIS_TIMEOUT_MS } from '../../src/services/AIService';
import { CIRCUIT_BREAKERS } from '../../src/services/CircuitBreaker';
import {
  categorizeSessionFailure,
  explainSessionFailure,
  MAX_CONCURRENT_FAILURE_ANALYSES,
} from '../../src/dashboard/services/failure-analysis-service';
import { useScratchDatabase } from '../helpers/scratch-database';
import { PROVIDERS, useFakeAiProviders } from '../helpers/fake-ai-provider';

/**
 * A failed session gets two things: a category from its failure reason and
 * failed commands (rules, no AI), and, with an AI provider, an explanation.
 * They are saved separately, so the category never waits for the AI, and only
 * a real explanation is saved: a rate limit, a timeout or a failed call saves
 * nothing, and leaves an explanation saved earlier in place.
 */
describe('failure analysis of a failed session', () => {
  const scratch = useScratchDatabase();
  const ai = useFakeAiProviders();
  const ID = 'sess-failure-analysis';

  beforeEach(async () => {
    await scratch.db.log.deleteMany();
    await scratch.db.sessionLog.deleteMany();
    await scratch.db.session.deleteMany();
    await scratch.db.session.create({
      data: {
        id: ID,
        status: 'failed',
        failure_reason: 'An element could not be located on the page',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'node',
        has_live_video: false,
        device_udid: 'R58M123',
        device_platform: 'android',
        device_version: '10',
      },
    });
    await scratch.db.sessionLog.create({
      data: {
        session_id: ID,
        command_name: 'findElement',
        url: '/session/x/element',
        method: 'POST',
        title: 'findElement',
        response: '{"value":{"error":"no such element"}}',
        is_error: true,
        is_success: false,
      },
    });
  });
  afterEach(() => sinon.restore());

  const row = () => scratch.db.session.findUniqueOrThrow({ where: { id: ID } });

  it('files the session under its category without asking the AI', async () => {
    ai.use('anthropic');
    ai.answer({ text: 'Root Cause: x' });

    await categorizeSessionFailure(ID);

    expect((await row()).failure_category).to.equal('ELEMENT_NOT_FOUND');
    expect(ai.calls).to.have.length(0);
  });

  it("saves the provider's explanation", async () => {
    ai.use('anthropic');
    ai.answer({ text: 'Root Cause: the Login button was covered by a dialog.' });

    await explainSessionFailure(ID);

    expect((await row()).ai_analysis).to.equal(
      'Root Cause: the Login button was covered by a dialog.',
    );
  });

  for (const provider of PROVIDERS) {
    it(`saves no explanation when ${provider} is rate-limited`, async () => {
      ai.use(provider);
      ai.answer({ status: 429 });

      await explainSessionFailure(ID);

      expect(ai.calls).to.have.length(1);
      expect((await row()).ai_analysis).to.equal(null);
    });
  }

  it('leaves an earlier explanation when a later attempt gets none', async () => {
    // A session can end twice (a driver crash, then the client's delete).
    await scratch.db.session.update({
      where: { id: ID },
      data: { ai_analysis: 'Root Cause: from the first end.' },
    });
    ai.use('gemini');
    ai.answer({ status: 429 });

    await explainSessionFailure(ID);

    expect((await row()).ai_analysis).to.equal('Root Cause: from the first end.');
  });

  describe('how many run', () => {
    // Analyses run after their sessions have ended, so nothing else limits
    // them: a broken build on a big lab ends hundreds of failed sessions in
    // minutes, and each analysis holds a screenshot while it runs.
    let answers: Array<(text: string | null) => void>;
    let analyzeFailure: sinon.SinonStub;

    beforeEach(async () => {
      answers = [];
      sinon.stub(AI_SERVICE, 'isEnabled').returns(true);
      analyzeFailure = sinon
        .stub(AI_SERVICE, 'analyzeFailure')
        .callsFake(() => new Promise((resolve) => answers.push(resolve)));
    });

    const settle = () => new Promise((r) => setTimeout(r, 50));

    it('asks once for a session whose analysis is already running', async () => {
      const first = explainSessionFailure(ID);
      const second = explainSessionFailure(ID);
      await settle();

      expect(analyzeFailure.callCount).to.equal(1);
      answers[0]('Root Cause: once.');
      await Promise.all([first, second]);
      expect((await row()).ai_analysis).to.equal('Root Cause: once.');
    });

    it(`runs ${MAX_CONCURRENT_FAILURE_ANALYSES} at once; the others wait their turn`, async () => {
      const ids = Array.from(
        { length: MAX_CONCURRENT_FAILURE_ANALYSES + 2 },
        (_, i) => `${ID}-${i}`,
      );
      for (const id of ids) {
        await scratch.db.session.create({
          data: {
            id,
            status: 'failed',
            desired_capabilities: '{}',
            session_capabilities: '{}',
            node_id: 'node',
            has_live_video: false,
            device_udid: 'R58M123',
            device_platform: 'android',
            device_version: '10',
          },
        });
      }

      const all = ids.map((id) => explainSessionFailure(id));
      await settle();
      expect(analyzeFailure.callCount).to.equal(MAX_CONCURRENT_FAILURE_ANALYSES);

      answers[0](null);
      await settle();
      expect(analyzeFailure.callCount).to.equal(MAX_CONCURRENT_FAILURE_ANALYSES + 1);

      for (let i = 0; i < 10 && answers.length < ids.length; i++) {
        answers.forEach((answer) => answer(null));
        await settle();
      }
      answers.forEach((answer) => answer(null));
      await Promise.all(all);
      expect(analyzeFailure.callCount).to.equal(ids.length);
    });
  });

  describe('a provider that does not answer', () => {
    const FAILURE = {
      sessionId: ID,
      failureReason: 'An element could not be located on the page',
      commandLogs: [],
      deviceLogs: [],
    };

    for (const provider of PROVIDERS) {
      it(`${provider}: is given up on after the time limit, and its request cancelled`, async () => {
        const { model } = ai.use(provider);
        ai.answer('hang');
        const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const service = new AIService();

        const analysis = service.analyzeFailure(FAILURE);
        await clock.tickAsync(FAILURE_ANALYSIS_TIMEOUT_MS - 1);
        expect(ai.calls[0].signal?.aborted).to.equal(false);
        await clock.tickAsync(1);

        expect(await analysis).to.equal(null);
        expect(ai.calls).to.have.length(1);
        expect(ai.calls[0].signal?.aborted).to.equal(true);
        // A provider that doesn't answer is a failure, like one that refuses.
        const breaker = CIRCUIT_BREAKERS.snapshot().find(
          (b) => b.key === `ai:${provider}:${model}`,
        );
        expect(breaker?.consecutiveFailures).to.equal(1);
      });
    }
  });
});
