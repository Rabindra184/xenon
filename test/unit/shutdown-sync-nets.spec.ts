import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import { ProcessRegistry } from '../../src/services/ProcessRegistry';
import AndroidH264StreamService from '../../src/device-managers/android/AndroidH264StreamService';

/**
 * The synchronous shutdown nets.
 *
 * On SIGTERM, Appium's own handler closes the HTTP server and exits the
 * process before this plugin's async cleanup phases run — measured against a
 * real device: the log reaches "Shutdown signal received" and Appium's
 * "Received SIGTERM", then the process is gone without ever logging
 * "sanitized". So neither the per-service `cleanup()` methods nor
 * `ProcessRegistry.terminateAll()` can be relied on, and their children —
 * go-ios, WDA, iproxy, ffmpeg, scrcpy — survive the restart.
 *
 * `process.on('exit')` is the last hook that always runs and forbids async
 * work. These methods exist to be callable from there, which is why every
 * assertion below is made on the SAME TICK: anything deferred to a microtask
 * is dropped when the process exits, so a promise-based teardown would pass a
 * test that awaited while still leaking in production.
 */
describe('synchronous shutdown nets', () => {
  describe('ProcessRegistry.killAllSync', () => {
    const fakeChild = (pid: number) => {
      const c = new EventEmitter() as unknown as ChildProcess & { killed: string[] };
      (c as any).pid = pid;
      (c as any).killed = [];
      (c as any).kill = (sig: string) => {
        (c as any).killed.push(sig);
        return true;
      };
      return c as ChildProcess & { killed: string[] };
    };

    let killStub: sinon.SinonStub;
    afterEach(() => killStub?.restore());

    it('kills every tracked process group on the same tick', () => {
      killStub = sinon.stub(process, 'kill');
      const reg = new ProcessRegistry();
      reg.track({ kind: 'wda', process: fakeChild(101) });
      reg.track({ kind: 'ffmpeg', process: fakeChild(102) });
      reg.track({ kind: 'ios-mjpeg', process: fakeChild(103) });

      const n = reg.killAllSync();

      expect(n).to.equal(3);
      // Negative pid = the process GROUP, so a sidecar's own children (iproxy
      // under go-ios) go with it. A plain child.kill() would strand those.
      expect(killStub.args.map((a) => a[0])).to.deep.equal([-101, -102, -103]);
      expect(killStub.args.every((a) => a[1] === 'SIGKILL')).to.equal(true);
      expect(reg.snapshot()).to.have.length(0);
    });

    // 'exit' gives no later tick in which to observe a graceful wait, so the
    // SIGTERM-then-wait-then-SIGKILL escalation terminate() uses is not
    // available here. SIGKILL is the right trade: the alternative is an orphan.
    it('goes straight to SIGKILL rather than escalating', () => {
      killStub = sinon.stub(process, 'kill');
      const reg = new ProcessRegistry();
      reg.track({ kind: 'wda', process: fakeChild(201) });

      reg.killAllSync();

      expect(killStub.args).to.have.length(1);
      expect(killStub.args[0][1]).to.equal('SIGKILL');
    });

    it('falls back to child.kill when the group kill fails', () => {
      killStub = sinon.stub(process, 'kill').throws(new Error('ESRCH'));
      const reg = new ProcessRegistry();
      const child = fakeChild(301);
      reg.track({ kind: 'ffmpeg', process: child });

      expect(() => reg.killAllSync()).to.not.throw();
      expect(child.killed).to.deep.equal(['SIGKILL']);
    });

    it('keeps going when one process throws, and never throws itself', () => {
      killStub = sinon.stub(process, 'kill');
      const reg = new ProcessRegistry();
      const bad = fakeChild(401);
      (bad as any).kill = () => {
        throw new Error('boom');
      };
      killStub.withArgs(-401).throws(new Error('ESRCH'));
      reg.track({ kind: 'other', process: bad });
      reg.track({ kind: 'ffmpeg', process: fakeChild(402) });

      let n = -1;
      expect(() => {
        n = reg.killAllSync();
      }).to.not.throw();
      // The healthy one still died even though the first blew up both paths.
      expect(n).to.equal(1);
      expect(killStub.calledWith(-402, 'SIGKILL')).to.equal(true);
      expect(reg.snapshot()).to.have.length(0);
    });

    it('is a no-op with nothing tracked', () => {
      const reg = new ProcessRegistry();
      expect(reg.killAllSync()).to.equal(0);
    });
  });

  describe('AndroidH264StreamService.killAllSync', () => {
    const svcWith = (n: number) => {
      const svc = new AndroidH264StreamService();
      const caps: { killed: boolean }[] = [];
      const sessions = (svc as any).sessions as Map<string, any>;
      for (let i = 0; i < n; i++) {
        const cap = { killed: false };
        caps.push(cap);
        sessions.set(`DEV-${i}`, {
          status: 'running',
          mux: {},
          capture: {
            kill: () => {
              cap.killed = true;
            },
          },
        });
      }
      return { svc, caps, sessions };
    };

    it('kills every capture child on the same tick', () => {
      const { svc, caps, sessions } = svcWith(3);

      const n = svc.killAllSync();

      expect(n).to.equal(3);
      expect(caps.map((c) => c.killed)).to.deep.equal([true, true, true]);
      expect(sessions.size).to.equal(0);
    });

    it('survives a capture that throws on kill', () => {
      const { svc, sessions } = svcWith(1);
      sessions.get('DEV-0').capture.kill = () => {
        throw new Error('ESRCH');
      };
      sessions.set('DEV-1', { status: 'running', mux: {}, capture: { kill: () => undefined } });

      expect(() => svc.killAllSync()).to.not.throw();
      expect(sessions.size).to.equal(0);
    });

    it('tolerates a session with no capture attached', () => {
      const svc = new AndroidH264StreamService();
      (svc as any).sessions.set('DEV-0', { status: 'running', mux: {} });

      expect(() => svc.killAllSync()).to.not.throw();
      expect((svc as any).sessions.size).to.equal(0);
    });
  });
});
