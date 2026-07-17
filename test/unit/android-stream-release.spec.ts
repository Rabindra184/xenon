import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import AndroidStreamService from '../../src/device-managers/android/AndroidStreamService';
import { PortAllocator } from '../../src/services/PortAllocator';
import { DeviceStoreFactory } from '../../src/data-service/device-store';

// Build an instance WITHOUT running the constructor (which starts a 1h watchdog
// interval), then drive stopStream directly with a fake running session.
function makeService(session: any) {
  const svc: any = Object.create(AndroidStreamService.prototype);
  svc.sessions = new Map<string, any>();
  if (session) svc.sessions.set(session.udid, session);
  return svc;
}

function runningSession(udid: string, mjpegPort: number) {
  return {
    udid,
    mjpegPort,
    server: null, // no http.Server so stopStream skips server.close()
    status: 'running' as const,
    lastViewerAt: Date.now(),
    viewerCount: 0,
  };
}

describe('AndroidStreamService.stopStream port-lease release', () => {
  let releaseSpy: sinon.SinonSpy;
  let containerStub: sinon.SinonStub;
  let storeStub: sinon.SinonStub;

  beforeEach(() => {
    releaseSpy = sinon.spy(async (_port: number) => undefined);
    containerStub = sinon.stub(Container, 'get').callsFake((token: any) => {
      if (token === PortAllocator) return { release: releaseSpy } as any;
      return (containerStub as any).wrappedMethod.call(Container, token);
    });
    // Device with no manual/automation lock → stopStream skips the unblock path,
    // isolating the port-release behaviour under test.
    storeStub = sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async () => ({ udid: 'android-1', host: 'h', session_id: undefined, busy: false }),
    } as any);
  });

  afterEach(() => sinon.restore());

  it('releases the stream-owned mjpeg lease and deletes the session', async () => {
    const svc = makeService(runningSession('android-1', 9100));
    await svc.stopStream('android-1');

    expect(releaseSpy.calledOnce, 'PortAllocator.release should be called once').to.be.true;
    expect(releaseSpy.firstCall.args[0]).to.equal(9100);
    expect(svc.sessions.has('android-1'), 'session should be removed').to.be.false;
    expect(storeStub.called).to.be.true;
  });

  it('does not release when there is no active session (idempotent)', async () => {
    const svc = makeService(null);
    await svc.stopStream('android-1');
    expect(releaseSpy.called).to.be.false;
  });

  it('still tears down the session if releasing the lease throws (best-effort)', async () => {
    releaseSpy = sinon.spy(async () => {
      throw new Error('lease gone');
    });
    containerStub.restore();
    containerStub = sinon.stub(Container, 'get').callsFake((token: any) => {
      if (token === PortAllocator) return { release: releaseSpy } as any;
      return (containerStub as any).wrappedMethod.call(Container, token);
    });

    const svc = makeService(runningSession('android-1', 9100));
    await svc.stopStream('android-1'); // must not reject
    expect(svc.sessions.has('android-1'), 'session removed despite release failure').to.be.false;
  });
});
