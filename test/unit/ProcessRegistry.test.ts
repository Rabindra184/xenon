import { expect } from 'chai';
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
});
