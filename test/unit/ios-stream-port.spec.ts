import { expect } from 'chai';
import { resolveIosMjpegPort, IosStreamPortDeps } from '../../src/app/routers/iosStreamPort';

// GET /:udid/stream used to reuse any session marked `running` without checking
// that WDA was actually alive. WDA dies ON THE DEVICE while the host-side
// `runwda` process stays alive (exitCode null), so the session stays 'running'
// with a dead upstream and every request fails until the hourly watchdog
// notices — up to an hour of broken preview. Reuse now requires a live WDA.

function makeDeps(overrides: Partial<IosStreamPortDeps> = {}) {
  const calls = { started: 0, healthChecks: 0 };
  const deps: IosStreamPortDeps = {
    getSession: () => ({ status: 'running', mjpegPort: 9100, wdaPort: 8100 }),
    isWdaHealthy: async () => {
      calls.healthChecks += 1;
      return true;
    },
    startStream: async () => {
      calls.started += 1;
      return { mjpegPort: 9200 };
    },
    ...overrides,
  };
  return { deps, calls };
}

describe('resolveIosMjpegPort', () => {
  it('reuses a running session when WDA answers, without restarting', async () => {
    const { deps, calls } = makeDeps();
    expect(await resolveIosMjpegPort('udid', deps)).to.equal(9100);
    expect(calls.started, 'must not restart a healthy stream').to.equal(0);
    expect(calls.healthChecks).to.equal(1);
  });

  it('restarts when the running session has a dead WDA, and returns the new port', async () => {
    const { deps, calls } = makeDeps({ isWdaHealthy: async () => false });
    expect(await resolveIosMjpegPort('udid', deps)).to.equal(9200);
    expect(calls.started, 'a dead WDA must trigger recovery').to.equal(1);
  });

  it('health-checks the session wdaPort', async () => {
    let seen: { port?: number; udid?: string } = {};
    const { deps } = makeDeps({
      getSession: () => ({ status: 'running', mjpegPort: 9100, wdaPort: 8123 }),
      isWdaHealthy: async (wdaPort, udid) => {
        seen = { port: wdaPort, udid };
        return true;
      },
    });
    await resolveIosMjpegPort('my-udid', deps);
    expect(seen).to.deep.equal({ port: 8123, udid: 'my-udid' });
  });

  it('starts the stream when there is no session', async () => {
    const { deps, calls } = makeDeps({ getSession: () => undefined });
    expect(await resolveIosMjpegPort('udid', deps)).to.equal(9200);
    expect(calls.started).to.equal(1);
    expect(calls.healthChecks, 'no session means nothing to health-check').to.equal(0);
  });

  it('starts the stream when the session is not running', async () => {
    const { deps, calls } = makeDeps({
      getSession: () => ({ status: 'error', mjpegPort: 9100, wdaPort: 8100 }),
    });
    expect(await resolveIosMjpegPort('udid', deps)).to.equal(9200);
    expect(calls.started).to.equal(1);
  });

  it('propagates a startStream failure so the route can still 503', async () => {
    const { deps } = makeDeps({
      getSession: () => undefined,
      startStream: async () => {
        throw new Error('WDA failed to start');
      },
    });
    let err: Error | undefined;
    try {
      await resolveIosMjpegPort('udid', deps);
    } catch (e: any) {
      err = e;
    }
    expect(err?.message).to.equal('WDA failed to start');
  });

  it('recovers when the health check itself throws, rather than failing the request', async () => {
    const { deps, calls } = makeDeps({
      isWdaHealthy: async () => {
        throw new Error('probe blew up');
      },
    });
    expect(await resolveIosMjpegPort('udid', deps)).to.equal(9200);
    expect(calls.started).to.equal(1);
  });
});
