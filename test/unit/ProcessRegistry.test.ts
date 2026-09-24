import { expect } from 'chai';
import sinon from 'sinon';
import { ProcessRegistry } from '../../src/services/ProcessRegistry';
import { EventEmitter } from 'events';

class FakeChild extends EventEmitter {
  pid: number;
  killed = false;
  constructor(pid: number) {
    super();
    this.pid = pid;
  }
  kill(signal: NodeJS.Signals) {
    this.killed = signal === 'SIGKILL' ? true : this.killed;
    return true;
  }
}

describe('ProcessRegistry', () => {
  // ProcessRegistry signals process GROUPS with process.kill(-pid). Unstubbed,
  // a fake child's pid is a real target: pid 1 became kill(-1), which on macOS
  // SIGTERMs and then SIGKILLs every process the user owns. Running this file
  // killed the test runner, the Xenon server and every open app. So no test
  // here sends a real signal. The stub throws ESRCH ("no such group") by
  // default, which exercises the fall back to the child's own kill().
  let killStub: sinon.SinonStub;
  beforeEach(() => {
    killStub = sinon.stub(process, 'kill').throws(Object.assign(new Error('ESRCH'), { code: 'ESRCH' }));
  });
  afterEach(() => {
    killStub.restore();
  });

  it('tracks and untracks processes', () => {
    const reg = new ProcessRegistry();
    const child = new FakeChild(12345) as any;
    const id = reg.track({ kind: 'wda', udid: 'u1', process: child });
    expect(reg.snapshot()).to.have.length(1);
    reg.untrack(id);
    expect(reg.snapshot()).to.have.length(0);
  });

  it('sends SIGTERM then SIGKILL when a child ignores SIGTERM', async () => {
    const reg = new ProcessRegistry();
    const child = new FakeChild(12345);
    const sent: NodeJS.Signals[] = [];
    child.kill = (sig: NodeJS.Signals) => {
      sent.push(sig);
      return true;
    };
    const id = reg.track({ kind: 'wda', udid: 'u1', process: child as any });
    const p = reg.terminate(id, { gracefulMs: 50 });
    await p;
    expect(sent[0]).to.equal('SIGTERM');
    expect(sent[sent.length - 1]).to.equal('SIGKILL');
  });

  it('terminateForUdid kills only matching tracked processes', async () => {
    const reg = new ProcessRegistry();
    const a = new FakeChild(1);
    const b = new FakeChild(2);
    const signalsA: string[] = [];
    const signalsB: string[] = [];
    a.kill = (s) => {
      signalsA.push(s);
      a.emit('exit', 0);
      return true;
    };
    b.kill = (s) => {
      signalsB.push(s);
      return true;
    };
    reg.track({ kind: 'wda', udid: 'u1', process: a as any });
    reg.track({ kind: 'wda', udid: 'u2', process: b as any });
    await reg.terminateForUdid('u1', { gracefulMs: 10 });
    expect(signalsA.length).to.be.greaterThan(0);
    expect(signalsB.length).to.equal(0);
  });

  it('signals the process group for a real pid', async () => {
    killStub.returns(true);
    const reg = new ProcessRegistry();
    const child = new FakeChild(4242);
    const id = reg.track({ kind: 'wda', udid: 'u1', process: child as any });
    await reg.terminate(id, { gracefulMs: 10 });
    expect(killStub.firstCall.args).to.deep.equal([-4242, 'SIGTERM']);
  });

  for (const pid of [0, 1]) {
    it(`never group-signals pid ${pid}: kill(-${pid}) would hit ${pid === 1 ? 'every process the user owns' : 'our own process group'}`, async () => {
      killStub.returns(true);
      const reg = new ProcessRegistry();
      const child = new FakeChild(pid);
      const sent: string[] = [];
      child.kill = (s: NodeJS.Signals) => {
        sent.push(s);
        return true;
      };
      const id = reg.track({ kind: 'wda', udid: 'u1', process: child as any });
      await reg.terminate(id, { gracefulMs: 10 });
      reg.track({ kind: 'wda', udid: 'u1', process: child as any });
      reg.killAllSync();
      expect(killStub.called).to.equal(false);
      expect(sent).to.deep.equal(['SIGTERM', 'SIGKILL', 'SIGKILL']);
    });
  }
});

