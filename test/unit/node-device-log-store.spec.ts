import 'reflect-metadata';
import { expect } from 'chai';
import { NodeDeviceLogStore } from '../../src/services/logcat/NodeDeviceLogStore';
import {
  NODE_DEVICE_LOGS_KEEP_AFTER_END_MS,
  NODE_DEVICE_LOG_PAGE,
} from '../../src/services/logcat/nodeDeviceLogs';
import type { DeviceLogLine } from '../../src/services/logcat/deviceLogBook';

const row = (n: number): DeviceLogLine => ({ message: `line ${n}`, timestamp: new Date(1000 + n) });
const rows = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => row(from + i));

describe('NodeDeviceLogStore: a node holds a session’s device log lines for its hub', () => {
  let now: number;
  let store: NodeDeviceLogStore;

  beforeEach(() => {
    now = 1_000_000;
    store = new NodeDeviceLogStore();
    store.now = () => now;
  });

  it('numbers each line, and answers every one without `after`', () => {
    store.begin('s1');
    store.add('s1', [row(1), row(2)]);
    store.add('s1', [row(3)]);

    expect(store.read('s1', null)).to.deep.equal({
      state: 'recording',
      more: false,
      lines: [
        { seq: 1, message: 'line 1', timestamp: 1001 },
        { seq: 2, message: 'line 2', timestamp: 1002 },
        { seq: 3, message: 'line 3', timestamp: 1003 },
      ],
    });
  });

  it('drops what the hub has: the lines at or before `after`', () => {
    store.begin('s1');
    store.add('s1', rows(1, 3));
    expect(store.read('s1', 2).lines.map((l) => l.seq)).to.deep.equal([3]);
    // Gone for good, even to an ask that names none.
    expect(store.read('s1', null).lines.map((l) => l.seq)).to.deep.equal([3]);
    store.add('s1', [row(4)]);
    expect(store.read('s1', 3).lines.map((l) => l.seq)).to.deep.equal([4]);
  });

  it(`answers at most ${NODE_DEVICE_LOG_PAGE} lines at a time, and says there are more`, () => {
    store.begin('s1');
    store.add('s1', rows(1, NODE_DEVICE_LOG_PAGE + 5));

    const first = store.read('s1', null);
    expect(first.lines).to.have.length(NODE_DEVICE_LOG_PAGE);
    expect(first.more).to.equal(true);
    const second = store.read('s1', NODE_DEVICE_LOG_PAGE);
    expect(second.lines.map((l) => l.seq)).to.deep.equal(
      [1, 2, 3, 4, 5].map((n) => NODE_DEVICE_LOG_PAGE + n),
    );
    expect(second.more).to.equal(false);
  });

  it('says a session ended, and keeps it 10 minutes for the hub’s last ask', () => {
    store.begin('s1');
    store.add('s1', rows(1, 2));
    store.end('s1');
    expect(store.read('s1', null).state).to.equal('ended');

    now += NODE_DEVICE_LOGS_KEEP_AFTER_END_MS - 1;
    expect(store.read('s1', 1).lines.map((l) => l.seq)).to.deep.equal([2]);
    now += 1;
    expect(store.read('s1', null)).to.deep.equal({ state: 'off', lines: [], more: false });
  });

  it('forgets an ended session nobody asks about, at the next session', () => {
    store.begin('s1');
    store.end('s1');
    now += NODE_DEVICE_LOGS_KEEP_AFTER_END_MS;
    store.begin('s2');
    expect((store as any).entries.has('s1')).to.equal(false);
  });

  it('says off for a session it holds nothing for, and keeps nothing for it', () => {
    store.add('nobody', rows(1, 2));
    expect(store.read('nobody', null)).to.deep.equal({ state: 'off', lines: [], more: false });
  });

  it('knows whether a hub has asked about a session', () => {
    store.begin('s1');
    expect(store.claimed('s1')).to.equal(false);
    store.read('s1', null);
    expect(store.claimed('s1')).to.equal(true);
    expect(store.claimed('unknown')).to.equal(false);
  });

  it('forgets a session it was told to', () => {
    store.begin('s1');
    store.add('s1', rows(1, 2));
    store.forget('s1');
    expect(store.read('s1', null).state).to.equal('off');
  });
});
