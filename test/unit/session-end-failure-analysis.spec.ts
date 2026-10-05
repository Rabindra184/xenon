import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { SocketServer } from '../../src/services/SocketServer';
import { MetricsService } from '../../src/services/MetricsService';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { AI_SERVICE } from '../../src/services/AIService';
import { explainSessionFailure } from '../../src/dashboard/services/failure-analysis-service';
import { SessionStatus } from '../../src/types/SessionStatus';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * Ending a failed session doesn't wait for the AI to explain the failure.
 *
 * `onSessionStopped` awaited the AI call, and every way a session ends awaits
 * `onSessionStopped`: the client's `driver.quit()`, a hub's forwarded DELETE,
 * an inactivity timeout, a shutdown. Only Ollama's calls had a time limit; the
 * OpenAI and Anthropic SDKs wait minutes and retry. So a quit could outlast
 * the client's own timeout. The category (rules, no AI) is still saved before
 * the session's end returns.
 */
describe('ending a failed session', () => {
  const scratch = useScratchDatabase();
  const ID = 'sess-end-analysis';
  let restore: () => void;
  let explain: { resolve: (text: string | null) => void; promise: Promise<string | null> };

  beforeEach(async () => {
    restore = saveRegistrations(SessionMetricsService, SocketServer, MetricsService);
    Container.set(SessionMetricsService, { stop: sinon.stub().resolves() } as any);
    Container.set(SocketServer, {
      emitToDashboard: sinon.stub(),
      emitToDashboardForDevices: sinon.stub().resolves(),
      hasScopedDashboard: sinon.stub().returns(false),
    } as any);
    Container.set(MetricsService, {
      incrementSessionSuccess: sinon.stub(),
      incrementSessionFailure: sinon.stub(),
    } as any);
    sinon.stub(SESSION_MANAGER, 'getSession').returns(undefined as any);
    sinon
      .stub(DeviceStoreFactory, 'getStore')
      .returns({ getDevices: async () => [], findDevices: async () => [] } as any);

    await scratch.db.log.deleteMany();
    await scratch.db.sessionLog.deleteMany();
    await scratch.db.session.deleteMany();
    await scratch.db.session.create({
      data: {
        id: ID,
        status: 'running',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'node',
        has_live_video: false,
        device_udid: 'R58M123',
        device_platform: 'android',
        device_version: '10',
      },
    });

    // An AI provider that answers when the test says.
    let resolve!: (text: string | null) => void;
    const promise = new Promise<string | null>((r) => (resolve = r));
    explain = { resolve, promise };
    sinon.stub(AI_SERVICE, 'isEnabled').returns(true);
    sinon.stub(AI_SERVICE, 'analyzeFailure').returns(promise);
  });

  afterEach(async () => {
    // The analysis the session's end started finishes before the stubs go,
    // so it never reaches a real AI provider or database. One still pending
    // gets no answer, so it writes nothing; asking again for the same
    // session waits for the one running.
    explain.resolve(null);
    await explainSessionFailure(ID);
    sinon.restore();
    restore();
  });

  const row = () => scratch.db.session.findUniqueOrThrow({ where: { id: ID } });
  const within = <T>(ms: number, p: Promise<T>) =>
    Promise.race([
      p.then(() => 'ended'),
      new Promise((r) => setTimeout(() => r('still waiting for the AI'), ms)),
    ]);
  const end = () =>
    DASHBORD_EVENT_MANAGER.onSessionStopped(ID, SessionStatus.FAILED, 'no such element', {
      notify: false,
    });

  it('returns while the AI is still explaining the failure', async () => {
    expect(await within(10_000, end())).to.equal('ended');

    // The AI is still asked, once the session has ended.
    const analyzeFailure = AI_SERVICE.analyzeFailure as sinon.SinonStub;
    for (let i = 0; i < 500 && !analyzeFailure.called; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(analyzeFailure.calledOnce).to.equal(true);
    expect(analyzeFailure.firstCall.args[0]).to.include({
      sessionId: ID,
      failureReason: 'no such element',
    });
  });

  it('has filed the session under its category when it returns', async () => {
    await within(10_000, end());

    const saved = await row();
    expect(saved.status).to.equal(SessionStatus.FAILED);
    expect(saved.failure_category).to.equal('ELEMENT_NOT_FOUND');
    expect(saved.ai_analysis).to.equal(null);
  });

  it("saves the AI's explanation when it comes", async () => {
    await within(10_000, end());

    explain.resolve('Root Cause: the Login button was covered by a dialog.');
    let saved = await row();
    for (let i = 0; i < 500 && !saved.ai_analysis; i++) {
      await new Promise((r) => setTimeout(r, 20));
      saved = await row();
    }
    expect(saved.ai_analysis).to.equal('Root Cause: the Login button was covered by a dialog.');
    expect(saved.failure_category).to.equal('ELEMENT_NOT_FOUND');
  });
});
