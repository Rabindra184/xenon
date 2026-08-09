import { expect } from 'chai';
import { LogcatMultiplexer } from '../../src/device-managers/android/LogcatMultiplexer';
import type { LogcatRecord } from '../../src/services/logcat/logcatParse';

const rec = (message: string): LogcatRecord => ({
  ts: 1,
  pid: 1,
  tid: 1,
  level: 'D',
  tag: 'T',
  message,
});

describe('LogcatMultiplexer', () => {
  it('fans a record out to every client', () => {
    const mux = new LogcatMultiplexer();
    const a: LogcatRecord[] = [];
    const b: LogcatRecord[] = [];
    mux.addClient(
      (r) => a.push(r),
      () => true,
    );
    mux.addClient(
      (r) => b.push(r),
      () => true,
    );

    mux.push(rec('hello'));

    expect(a.map((r) => r.message)).to.deep.equal(['hello']);
    expect(b.map((r) => r.message)).to.deep.equal(['hello']);
  });

  it('reports clientCount and stops sending after the remover runs', () => {
    const mux = new LogcatMultiplexer();
    const seen: LogcatRecord[] = [];
    const remove = mux.addClient(
      (r) => seen.push(r),
      () => true,
    );
    expect(mux.clientCount).to.equal(1);

    remove();
    expect(mux.clientCount).to.equal(0);
    mux.push(rec('after removal'));
    expect(seen).to.have.length(0);
  });

  // Opening the tab should show recent history, not an empty pane.
  it('replays the buffered history to a late joiner', () => {
    const mux = new LogcatMultiplexer();
    mux.push(rec('one'));
    mux.push(rec('two'));

    const late: LogcatRecord[] = [];
    mux.addClient(
      (r) => late.push(r),
      () => true,
    );

    expect(late.map((r) => r.message)).to.deep.equal(['one', 'two']);
  });

  it('bounds the replay buffer', () => {
    const mux = new LogcatMultiplexer();
    for (let i = 0; i < 2500; i++) mux.push(rec(`m${i}`));

    const late: LogcatRecord[] = [];
    mux.addClient(
      (r) => late.push(r),
      () => true,
    );

    expect(late).to.have.length(2000);
    expect(late[0].message).to.equal('m500');
    expect(late[late.length - 1].message).to.equal('m2499');
  });

  // A dropped video frame is invisible; a dropped log line is data loss the
  // reader cannot detect. The gap must appear IN the log.
  it('emits a synthetic warning instead of dropping silently', () => {
    const mux = new LogcatMultiplexer();
    const seen: LogcatRecord[] = [];
    let accepting = true;
    mux.addClient(
      (r) => seen.push(r),
      () => accepting,
    );

    accepting = false;
    mux.push(rec('lost one'));
    mux.push(rec('lost two'));
    accepting = true;
    mux.push(rec('delivered'));

    const messages = seen.map((r) => r.message);
    expect(messages).to.not.include('lost one');
    expect(messages).to.include('delivered');
    const warning = seen.find((r) => r.synthetic);
    expect(warning, 'a synthetic drop record must be emitted').to.not.equal(undefined);
    expect(warning!.level).to.equal('W');
    expect(warning!.tag).to.equal('xenon');
    expect(warning!.message).to.contain('2');
    expect(warning!.message.toLowerCase()).to.contain('dropped');
  });

  it('coalesces consecutive drops into one record', () => {
    const mux = new LogcatMultiplexer();
    const seen: LogcatRecord[] = [];
    let accepting = true;
    mux.addClient(
      (r) => seen.push(r),
      () => accepting,
    );

    accepting = false;
    for (let i = 0; i < 10; i++) mux.push(rec(`lost ${i}`));
    accepting = true;
    mux.push(rec('delivered'));

    expect(seen.filter((r) => r.synthetic)).to.have.length(1);
    expect(seen.find((r) => r.synthetic)!.message).to.contain('10');
  });

  it('does not put synthetic drop records in the replay buffer', () => {
    const mux = new LogcatMultiplexer();
    let accepting = true;
    const remove = mux.addClient(
      () => undefined,
      () => accepting,
    );
    accepting = false;
    mux.push(rec('lost'));
    accepting = true;
    mux.push(rec('delivered'));
    remove();

    const late: LogcatRecord[] = [];
    mux.addClient(
      (r) => late.push(r),
      () => true,
    );
    // The drop was that one slow client's problem, not history.
    expect(late.filter((r) => r.synthetic)).to.have.length(0);
  });
});
