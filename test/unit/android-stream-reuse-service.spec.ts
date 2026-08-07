import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import AndroidStreamService from '../../src/device-managers/android/AndroidStreamService';
import { SingleFlight } from '../../src/helpers/singleFlight';
import { PortAllocator } from '../../src/services/PortAllocator';
import { DeviceStoreFactory } from '../../src/data-service/device-store';

// Companion to android-stream-reuse.spec.ts: that one covers the decision, this
// one covers the wiring — that startStream still short-circuits on a healthy
// session, and that an unusable one is actually torn down (capture loop stopped,
// server closed, port lease released) instead of being left listening while a
// replacement binds a second port. See issue #196.

// Bypass the constructor: it starts a 1h watchdog interval we don't want.
function makeService(session: any) {
  const svc: any = Object.create(AndroidStreamService.prototype);
  svc.sessions = new Map<string, any>();
  svc.startFlight = new SingleFlight<{ mjpegPort: number }>();
  if (session) svc.sessions.set(session.udid, session);
  return svc;
}

function session(udid: string, mjpegPort: number, overrides: any = {}) {
  return {
    udid,
    mjpegPort,
    server: { listening: true, close: sinon.spy() },
    status: 'running' as string,
    latestFrame: Buffer.from([0xff, 0xd8]),
    lastViewerAt: Date.now(),
    viewerCount: 0,
    ...overrides,
  };
}

describe('AndroidStreamService.startStream session reuse', () => {
  let releaseSpy: sinon.SinonSpy;
  let getStoreStub: sinon.SinonStub;

  beforeEach(() => {
    releaseSpy = sinon.spy(async (_port: number) => undefined);
    const containerStub = sinon.stub(Container, 'get').callsFake((token: any) => {
      if (token === PortAllocator) return { release: releaseSpy } as any;
      return (containerStub as any).wrappedMethod.call(Container, token);
    });
    // Any attempt at a real startup dies here, which is what we want: it marks
    // the point where the reuse short-circuit was NOT taken.
    getStoreStub = sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async () => undefined,
    } as any);
  });

  afterEach(() => sinon.restore());

  it('hands back a healthy session without touching the device store', async () => {
    const svc = makeService(session('android-1', 9100));

    expect(await svc.startStream('android-1')).to.deep.equal({ mjpegPort: 9100 });
    expect(getStoreStub.called, 'reuse must not fall through to a real startup').to.be.false;
    expect(releaseSpy.called, 'a reused session keeps its port lease').to.be.false;
  });

  for (const [label, overrides] of [
    ['the server is no longer listening', { server: { listening: false, close: sinon.spy() } }],
    ['it never captured a frame', { latestFrame: undefined }],
    ['it is still starting', { status: 'starting' }],
  ] as const) {
    it(`discards a session and restarts when ${label}`, async () => {
      const dead = session('android-1', 9100, overrides);
      const svc = makeService(dead);

      // No device in the store, so the fresh startup throws — proving we fell
      // through rather than returning the stale port.
      let err: Error | undefined;
      try {
        await svc.startStream('android-1');
      } catch (e: any) {
        err = e;
      }
      expect(err?.message, 'must attempt a real startup').to.match(/not found in DB/);

      expect(dead.status, 'capture loop must be told to stop').to.equal('stopped');
      expect(dead.server, 'server handle cleared').to.equal(null);
      expect(svc.sessions.has('android-1'), 'stale session evicted').to.be.false;
      expect(releaseSpy.calledWith(9100), 'stale port lease released').to.be.true;
    });
  }

  it('does not release a lease when there was no session at all', async () => {
    const svc = makeService(null);
    await svc.startStream('android-1').catch(() => undefined);
    expect(releaseSpy.called).to.be.false;
  });
});
