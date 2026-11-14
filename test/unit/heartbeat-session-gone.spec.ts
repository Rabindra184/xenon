import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { SessionHeartbeatService } from '../../src/services/SessionHeartbeatService';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { HealthErrorType } from '../../src/sessions/XenonSession';
import { SessionStatus } from '../../src/types/SessionStatus';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * The heartbeat counts failed probes and ends a session after six of them
 * (~3 minutes at the 30 s interval), so a node that can't be reached for a
 * moment doesn't lose its sessions. A node that answers "I don't have this
 * session" isn't a moment's trouble: through 2.33 that answer was counted
 * like an unreachable node, and the hub kept its claim on the node's phone
 * for three minutes after the session had died there.
 */

const fakeSession = (id: string, answers: () => any): any => ({
  getId: () => id,
  isStopping: false,
  stoppedAt: undefined,
  checkHealth: async () => answers(),
});

describe('SessionHeartbeatService: a session its node says it no longer has', () => {
  let restore: () => void;
  let deleteSession: sinon.SinonStub;

  beforeEach(() => {
    restore = saveRegistrations(SessionLifecycleService);
    deleteSession = sinon.stub().resolves();
    Container.set(SessionLifecycleService, { deleteSession } as any);
  });

  afterEach(() => {
    sinon.restore();
    restore();
  });

  const check = (svc: SessionHeartbeatService, session: any) =>
    (svc as any).checkSession(session) as Promise<void>;

  it('is ended at the first answer, not after six', async () => {
    const svc = new SessionHeartbeatService();
    const session = fakeSession('hb-gone-1', () => ({
      isHealthy: false,
      errorType: HealthErrorType.SESSION_NOT_FOUND,
      message: 'The node no longer has this session',
      statusCode: 404,
      gone: true,
    }));

    await check(svc, session);

    expect(deleteSession.callCount, 'sessions ended').to.equal(1);
    const [, sessionId, status, reason] = deleteSession.firstCall.args;
    expect(sessionId).to.equal('hb-gone-1');
    expect(status).to.equal(SessionStatus.FAILED);
    expect(String(reason)).to.include('no longer has this session');
    expect((svc as any).failureCounts.has('hb-gone-1')).to.equal(false);
  });

  for (const [what, answer] of [
    [
      'an unreachable node',
      { isHealthy: false, errorType: HealthErrorType.SERVER_UNREACHABLE, message: 'ECONNREFUSED' },
    ],
    [
      'a probe that timed out',
      { isHealthy: false, errorType: HealthErrorType.TIMEOUT, message: 'timeout' },
    ],
    [
      'an unknown-session answer without the node’s say-so (an older node, a refused token)',
      {
        isHealthy: false,
        errorType: HealthErrorType.SESSION_NOT_FOUND,
        message: 'Invalid Session ID',
        statusCode: 404,
      },
    ],
  ] as const) {
    it(`is still counted for ${what}: ended at the sixth failure`, async () => {
      const svc = new SessionHeartbeatService();
      const session = fakeSession('hb-counted', () => ({ ...answer }));
      for (let i = 1; i <= 5; i++) {
        await check(svc, session);
        expect(deleteSession.callCount, `ended after ${i} failure(s)`).to.equal(0);
      }
      await check(svc, session);
      expect(deleteSession.callCount).to.equal(1);
    });
  }
});
