import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  RecordingOrchestrator,
  RecordingError,
} from '../../src/services/recording/RecordingOrchestrator';
import { ConcurrencyGate } from '../../src/services/recording/concurrency-gate';
import * as deviceStoreModule from '../../src/data-service/device-store';
import { useArtifactStore } from '../helpers/artifact-store';
import { useScratchDatabase } from '../helpers/scratch-database';
import { prisma } from '../../src/prisma';
import type { ObservedPhone } from '../../src/services/recording/observerSessions';

// ENH-06: an observer recording films the phones of the caller's own Appium
// sessions without holding them, and the whole group stops as soon as any of
// those sessions ends, so it never films the next test on a phone.

const PLAYABLE_BYTES = 4096;

const PHONES: ObservedPhone[] = [
  { sessionId: 'S1', udid: 'A1', host: 'h-a' },
  { sessionId: 'S2', udid: 'I1', host: 'h-i' },
];
const observeStart = (phones: ObservedPhone[] = PHONES) => ({
  phones: phones.map(({ udid, host }) => ({ udid, host })),
  observe: phones,
  actorId: 'alice',
});

/** A store that keeps what create() was given, as listGroup and findById read it. */
function rowStore() {
  const rows: any[] = [];
  return {
    rows,
    create: sinon.stub().callsFake(async (i: any) => {
      rows.push({
        id: i.id,
        group_id: i.groupId,
        device_udid: i.deviceUdid,
        device_host: i.deviceHost,
        session_id: i.sessionId,
        file_path: i.filePath,
        started_at: new Date().toISOString(),
        status: 'RECORDING',
      });
      return i;
    }),
    finalize: sinon.stub().callsFake(async (id: string, f: any) => {
      const row = rows.find((r) => r.id === id);
      if (!row || row.status !== 'RECORDING') return false;
      Object.assign(row, { status: f.status, fail_reason: f.failReason });
      return true;
    }),
    findById: sinon.stub().callsFake(async (id: string) => rows.find((r) => r.id === id) ?? null),
    listActive: sinon.stub().resolves([]),
    listGroup: sinon
      .stub()
      .callsFake(async (groupId: string) => rows.filter((r) => r.group_id === groupId)),
  };
}

function makeOrch(overrides: any = {}) {
  const busyPrecheck = { findBusy: sinon.stub().resolves([]) };
  const store = rowStore();
  const exits = new Map<string, (code: number | null) => void>();
  const videoPipeline = {
    // A playable file, so a stopped recording stays STOPPED.
    startRecording: sinon.stub().callsFake(async (o: any) => {
      fs.mkdirSync(path.dirname(o.outputPath), { recursive: true });
      fs.writeFileSync(o.outputPath, Buffer.alloc(PLAYABLE_BYTES));
      if (o.onExit) exits.set(o.udid, o.onExit);
    }),
    stopRecording: sinon.stub().resolves('/tmp/x.mp4'),
    startComposite: sinon.stub().resolves(undefined),
    stopComposite: sinon.stub().resolves(null),
  };
  const eventMgr = {
    emitRecordingStarted: sinon.stub(),
    emitRecordingStopped: sinon.stub(),
    emitRecordingFailed: sinon.stub(),
    emitRecordingBookmark: sinon.stub(),
    emitRecordingAnnotation: sinon.stub(),
  };
  const deps = {
    blockDeviceFn: (overrides.blockDeviceFn ?? sinon.stub().resolves()) as sinon.SinonStub,
    unblockDeviceFn: (overrides.unblockDeviceFn ?? sinon.stub().resolves()) as sinon.SinonStub,
    ensureMjpegPortFn: (overrides.ensureMjpegPortFn ??
      sinon.stub().resolves(9100)) as sinon.SinonStub,
    nodeSourceFn: (overrides.nodeSourceFn ?? sinon.stub().resolves(null)) as sinon.SinonStub,
    leaveDeviceFn: (overrides.leaveDeviceFn ?? sinon.stub()) as sinon.SinonStub,
    probeDurationMsFn: sinon.stub().resolves(undefined),
    sessionRowExistsFn: (overrides.sessionRowExistsFn ??
      sinon.stub().resolves(true)) as sinon.SinonStub,
    claimHoldsFn: (overrides.claimHoldsFn ?? sinon.stub().resolves(true)) as sinon.SinonStub,
    observerCheckMs: overrides.observerCheckMs as number | undefined,
  };
  const orch = new RecordingOrchestrator({
    busyPrecheck: busyPrecheck as any,
    store: store as any,
    gate: new ConcurrencyGate(8),
    videoPipeline: videoPipeline as any,
    eventMgr: eventMgr as any,
    ...deps,
  });
  return { orch, busyPrecheck, store, videoPipeline, eventMgr, exits, ...deps };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('RecordingOrchestrator: observer recordings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-observer-'));
  useArtifactStore(root);
  const orchs: RecordingOrchestrator[] = [];
  const track = <T extends { orch: RecordingOrchestrator }>(made: T): T => {
    orchs.push(made.orch);
    return made;
  };

  beforeEach(() => {
    sinon.stub(deviceStoreModule.DeviceStoreFactory, 'getStore').returns({
      findDevice: sinon
        .stub()
        .callsFake(async ({ udid }: any) => ({ udid, host: '127.0.0.1', busy: false })),
    } as any);
  });
  afterEach(async () => {
    // No backstop timer outlives its test.
    for (const orch of orchs.splice(0)) {
      for (const p of PHONES) await orch.sessionEnded(p.sessionId);
    }
    sinon.restore();
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  it('observe start writes no hold', async () => {
    const { orch, blockDeviceFn, busyPrecheck } = track(makeOrch());

    await orch.start(observeStart());

    expect(blockDeviceFn.callCount).to.equal(0);
    const args = busyPrecheck.findBusy.firstCall.args;
    expect(args[0]).to.deep.equal([
      { udid: 'A1', host: 'h-a' },
      { udid: 'I1', host: 'h-i' },
    ]);
    expect(args[1]).to.equal('alice');
    expect([...(args[3] as Map<string, string>).entries()]).to.deep.equal([
      ['A1@h-a', 'S1'],
      ['I1@h-i', 'S2'],
    ]);
  });

  it('records each phone under the host the session was found on', async () => {
    const { orch, store } = track(makeOrch());

    await orch.start(observeStart());

    expect(store.rows.map((r) => [r.device_udid, r.device_host])).to.deep.equal([
      ['A1', 'h-a'],
      ['I1', 'h-i'],
    ]);
  });

  it('refuses phones that are not the observed phones', async () => {
    const { orch, store } = track(makeOrch());

    let error: any;
    try {
      await orch.start({
        ...observeStart(),
        phones: [
          { udid: 'A1', host: 'h-a' },
          { udid: 'X9', host: 'h-i' },
        ],
      });
    } catch (err) {
      error = err;
    }

    expect(error).to.be.instanceOf(Error);
    expect(store.create.called).to.equal(false);
  });

  it('writes session_id on the rows only when the Session row exists', async () => {
    const sessionRowExistsFn = sinon.stub().callsFake(async (id: string) => id === 'S2');
    const { orch, store } = track(makeOrch({ sessionRowExistsFn }));

    await orch.start(observeStart());

    expect(store.rows.map((r) => [r.device_udid, r.session_id])).to.deep.equal([
      ['A1', null],
      ['I1', 'S2'],
    ]);
  });

  it('a Session row lookup that fails writes no session_id and still records', async () => {
    const sessionRowExistsFn = sinon.stub().rejects(new Error('database gone'));
    const { orch, store } = track(makeOrch({ sessionRowExistsFn }));

    const out = await orch.start(observeStart());

    expect(out.recordings).to.have.length(2);
    expect(store.rows.map((r) => r.session_id)).to.deep.equal([null, null]);
  });

  it('answers each recording with its sessionId', async () => {
    const sessionRowExistsFn = sinon.stub().resolves(false);
    const { orch } = track(makeOrch({ sessionRowExistsFn }));

    const out = await orch.start(observeStart());

    expect(out.recordings.map((r) => [r.udid, r.sessionId])).to.deep.equal([
      ['A1', 'S1'],
      ['I1', 'S2'],
    ]);
    expect(orch.isObserverGroup(out.groupId)).to.equal(true);
  });

  it('remembers who started an observer group, after it stops too', async () => {
    const { orch } = track(makeOrch());
    const { groupId } = await orch.start(observeStart());
    expect(orch.observerGroupStarter(groupId)).to.equal('alice');
    await orch.sessionEnded('S1');
    expect(orch.observerGroupStarter(groupId)).to.equal('alice');
    expect(orch.observerGroupStarter('no-such-group')).to.equal(undefined);
  });

  it('forgets the oldest observer group, and its starter, past 1,000', () => {
    const { orch } = track(makeOrch());
    // Groups with no recording are noted and not watched (no timer).
    for (let i = 0; i <= 1000; i++) (orch as any).watchObserverGroup(`g${i}`, `u${i}`, [], []);
    expect(orch.isObserverGroup('g0')).to.equal(false);
    expect(orch.observerGroupStarter('g0')).to.equal(undefined);
    expect(orch.isObserverGroup('g1')).to.equal(true);
    expect(orch.observerGroupStarter('g1')).to.equal('u1');
    expect(orch.observerGroupStarter('g1000')).to.equal('u1000');
  });

  it('sessionEnded stops the whole group with session_ended', async () => {
    const { orch, store, videoPipeline, unblockDeviceFn, leaveDeviceFn } = track(makeOrch());
    const { groupId } = await orch.start(observeStart());

    await orch.sessionEnded('S2');

    expect(store.rows.map((r) => [r.status, r.fail_reason])).to.deep.equal([
      ['STOPPED', 'session_ended'],
      ['STOPPED', 'session_ended'],
    ]);
    expect(videoPipeline.stopComposite.calledOnceWith(groupId)).to.equal(true);
    expect(videoPipeline.stopComposite.calledBefore(videoPipeline.stopRecording)).to.equal(true);
    expect(videoPipeline.stopRecording.callCount).to.equal(2);
    expect(unblockDeviceFn.called).to.equal(false);
    expect(leaveDeviceFn.called).to.equal(false);
  });

  it('sessionEnded twice, or for an unknown session, stops nothing more and does not throw', async () => {
    const { orch, store, videoPipeline } = track(makeOrch());
    await orch.start(observeStart());

    await orch.sessionEnded('S1');
    await orch.sessionEnded('S1');
    await orch.sessionEnded('S2');
    await orch.sessionEnded('nobody');

    expect(videoPipeline.stopComposite.callCount).to.equal(1);
    expect(videoPipeline.stopRecording.callCount).to.equal(2);
    expect(store.finalize.callCount).to.equal(2);
  });

  it('sessionEnded does not throw when the stop fails', async () => {
    const { orch, store } = track(makeOrch());
    await orch.start(observeStart());
    store.listGroup.rejects(new Error('database gone'));

    await orch.sessionEnded('S1');
  });

  it('a stop whose group the store cannot list still stops every phone’s capture', async () => {
    const { orch, store, videoPipeline } = track(makeOrch());
    const out = await orch.start(observeStart());
    store.listGroup.rejects(new Error('database gone'));
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      await orch.sessionEnded('S1');
      // The caller's own stop sees the store's error, and its captures stop too.
      const second = track(makeOrch());
      const started = await second.orch.start(observeStart());
      second.store.listGroup.rejects(new Error('database gone'));
      second.videoPipeline.stopRecording.onFirstCall().rejects(new Error('ffmpeg stuck'));
      let error: any;
      try {
        await second.orch.stop(started.groupId);
      } catch (err) {
        error = err;
      }
      expect(error?.message).to.equal('database gone');
      expect(second.videoPipeline.stopRecording.args.map((a) => a[0])).to.have.members(
        started.recordings.map((r) => r.id),
      );
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }

    expect(videoPipeline.stopRecording.args.map((a) => a[0])).to.have.members(
      out.recordings.map((r) => r.id),
    );
    expect(unhandled, 'unhandled rejections').to.deep.equal([]);
  });

  it('a session that ends during the start still stops the group', async () => {
    let release!: () => void;
    const gateOpen = new Promise<void>((resolve) => (release = resolve));
    const ensureMjpegPortFn = sinon.stub().callsFake(async () => {
      await gateOpen;
      return 9100;
    });
    const { orch, store, videoPipeline } = track(makeOrch({ ensureMjpegPortFn }));

    const starting = orch.start(observeStart());
    await sleep(5);
    expect(ensureMjpegPortFn.called).to.equal(true);
    await orch.sessionEnded('S1');
    release();
    const { groupId } = await starting;

    expect(videoPipeline.stopComposite.calledOnceWith(groupId)).to.equal(true);
    expect(store.rows.map((r) => [r.status, r.fail_reason])).to.deep.equal([
      ['STOPPED', 'session_ended'],
      ['STOPPED', 'session_ended'],
    ]);
    expect(orch.isObserverGroup(groupId)).to.equal(true);
    // Stopped once: a later ending finds nothing to stop.
    await orch.sessionEnded('S2');
    expect(videoPipeline.stopComposite.callCount).to.equal(1);
  });

  it('a start that fails leaves its sessions to a later start', async () => {
    const { orch, busyPrecheck, videoPipeline } = track(makeOrch());
    busyPrecheck.findBusy.resolves([{ udid: 'A1', reason: 'recording_other_group' }]);

    let error: any;
    try {
      await orch.start(observeStart());
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(RecordingError);

    // Nothing of the failed start is left to be stopped, and a later start of
    // the same sessions records until one of them ends.
    busyPrecheck.findBusy.resolves([]);
    const { groupId } = await orch.start(observeStart());
    expect(videoPipeline.stopComposite.called).to.equal(false);
    await orch.sessionEnded('S1');
    expect(videoPipeline.stopComposite.calledOnceWith(groupId)).to.equal(true);
  });

  it('a session that ended before its start stops the group once it is built', async () => {
    const { orch, store, videoPipeline } = track(makeOrch());

    await orch.sessionEnded('S1');
    const out = await orch.start(observeStart());

    expect(videoPipeline.stopComposite.calledOnceWith(out.groupId)).to.equal(true);
    expect(store.rows.map((r) => [r.status, r.fail_reason])).to.deep.equal([
      ['STOPPED', 'session_ended'],
      ['STOPPED', 'session_ended'],
    ]);
    expect(out.recordings.map((r) => r.status)).to.deep.equal(['STOPPED', 'STOPPED']);

    // The ending was used up: another start of S1 is not stopped by it.
    const again = await orch.start(observeStart([PHONES[0]]));
    expect(videoPipeline.stopComposite.calledWith(again.groupId)).to.equal(false);
    expect(again.recordings.map((r) => r.status)).to.deep.equal(['RECORDING']);
  });

  it('answers the stopped statuses when a session ended during the start', async () => {
    let release!: () => void;
    const gateOpen = new Promise<void>((resolve) => (release = resolve));
    const ensureMjpegPortFn = sinon.stub().callsFake(async () => {
      await gateOpen;
      return 9100;
    });
    const { orch } = track(makeOrch({ ensureMjpegPortFn }));

    const starting = orch.start(observeStart());
    await sleep(5);
    await orch.sessionEnded('S2');
    release();
    const out = await starting;

    expect(out.recordings.map((r) => r.status)).to.deep.equal(['STOPPED', 'STOPPED']);
  });

  it('answers the stopped statuses when the start’s claim check stopped the group', async () => {
    const claimHoldsFn = sinon.stub().callsFake(async (udid: string) => udid !== 'I1');
    const { orch } = track(makeOrch({ claimHoldsFn }));

    const out = await orch.start(observeStart());

    expect(out.recordings.map((r) => r.status)).to.deep.equal(['STOPPED', 'STOPPED']);
  });

  it('a start still resolves when stopping a group whose session ended fails', async () => {
    let release!: () => void;
    const gateOpen = new Promise<void>((resolve) => (release = resolve));
    const ensureMjpegPortFn = sinon.stub().callsFake(async () => {
      await gateOpen;
      return 9100;
    });
    const { orch, store } = track(makeOrch({ ensureMjpegPortFn }));
    store.listGroup.rejects(new Error('database gone'));

    const starting = orch.start(observeStart());
    await sleep(5);
    await orch.sessionEnded('S1');
    release();
    const out = await starting;

    expect(out.recordings).to.have.length(2);
  });

  it('sessionEnded stops every group observing the session', async () => {
    const { orch, videoPipeline } = track(makeOrch());
    const first = await orch.start(observeStart());
    const second = await orch.start(observeStart());

    await orch.sessionEnded('S1');

    expect(videoPipeline.stopComposite.calledWith(first.groupId)).to.equal(true);
    expect(videoPipeline.stopComposite.calledWith(second.groupId)).to.equal(true);
    expect(videoPipeline.stopComposite.callCount).to.equal(2);
  });

  it('the backstop stops every group whose claim failed, each by its own id', async () => {
    let ended = false;
    const claimHoldsFn = sinon.stub().callsFake(async () => !ended);
    const { orch, videoPipeline } = track(makeOrch({ claimHoldsFn, observerCheckMs: 20 }));
    const first = await orch.start(observeStart());
    const second = await orch.start(observeStart());
    ended = true;

    const until = Date.now() + 200;
    while (videoPipeline.stopComposite.callCount < 2 && Date.now() < until) await sleep(10);

    expect(videoPipeline.stopComposite.calledWith(first.groupId)).to.equal(true);
    expect(videoPipeline.stopComposite.calledWith(second.groupId)).to.equal(true);
    await sleep(60);
    expect(videoPipeline.stopComposite.callCount).to.equal(2);
  });

  it('the backstop stops a group whose claim no longer names its session', async () => {
    let s2Ended = false;
    const claimHoldsFn = sinon
      .stub()
      .callsFake(async (_udid: string, sessionId: string) => !(sessionId === 'S2' && s2Ended));
    const { orch, store, videoPipeline } = track(makeOrch({ claimHoldsFn, observerCheckMs: 20 }));

    const { groupId } = await orch.start(observeStart());
    expect(videoPipeline.stopComposite.called).to.equal(false);
    s2Ended = true;

    const until = Date.now() + 200;
    while (!videoPipeline.stopComposite.called && Date.now() < until) await sleep(10);

    expect(videoPipeline.stopComposite.calledOnceWith(groupId)).to.equal(true);
    expect(claimHoldsFn.calledWith('I1', 'S2')).to.equal(true);
    expect(store.rows.map((r) => r.fail_reason)).to.deep.equal(['session_ended', 'session_ended']);
    // Its timer is gone: no second check, no second stop.
    const checks = claimHoldsFn.callCount;
    await sleep(80);
    expect(claimHoldsFn.callCount).to.equal(checks);
    expect(videoPipeline.stopComposite.callCount).to.equal(1);
  });

  it('a claim check that fails stops nothing', async () => {
    const claimHoldsFn = sinon.stub().rejects(new Error('store hiccup'));
    const { orch, videoPipeline } = track(makeOrch({ claimHoldsFn, observerCheckMs: 20 }));

    await orch.start(observeStart());
    await sleep(80);

    expect(claimHoldsFn.called).to.equal(true);
    expect(videoPipeline.stopComposite.called).to.equal(false);
  });

  it('a session already gone when the start finishes stops the group at once', async () => {
    const claimHoldsFn = sinon.stub().callsFake(async (udid: string) => udid !== 'A1');
    const { orch, videoPipeline } = track(makeOrch({ claimHoldsFn }));

    const { groupId } = await orch.start(observeStart());

    expect(videoPipeline.stopComposite.calledOnceWith(groupId)).to.equal(true);
  });

  it('an observer recording whose ffmpeg ends on its own releases nothing', async () => {
    const { orch, store, exits, unblockDeviceFn, leaveDeviceFn, videoPipeline } = track(makeOrch());
    const { groupId } = await orch.start(observeStart());

    exits.get('A1')!(0);
    const until = Date.now() + 200;
    while (store.rows[0].status === 'RECORDING' && Date.now() < until) await sleep(5);

    expect(store.rows.map((r) => [r.status, r.fail_reason])).to.deep.equal([
      ['STOPPED', 'source_ended'],
      ['RECORDING', undefined],
    ]);
    expect(unblockDeviceFn.called).to.equal(false);
    expect(leaveDeviceFn.called).to.equal(false);
    expect(orch.isObserverGroup(groupId)).to.equal(true);

    // The group is still watched: an ending stops the rest.
    await orch.sessionEnded('S1');
    expect(store.rows.map((r) => [r.status, r.fail_reason])).to.deep.equal([
      ['STOPPED', 'source_ended'],
      ['STOPPED', 'session_ended'],
    ]);
    expect(videoPipeline.stopComposite.calledOnceWith(groupId)).to.equal(true);
    await orch.sessionEnded('S2');
    expect(videoPipeline.stopComposite.callCount).to.equal(1);
    expect(unblockDeviceFn.called).to.equal(false);
    expect(leaveDeviceFn.called).to.equal(false);
  });

  it('a phone whose recording cannot start is not unblocked', async () => {
    const ensureMjpegPortFn = sinon.stub().callsFake(async (udid: string) => {
      if (udid === 'I1') throw new Error('no picture');
      return 9100;
    });
    const { orch, unblockDeviceFn, leaveDeviceFn } = track(makeOrch({ ensureMjpegPortFn }));

    const out = await orch.start(observeStart());

    expect(out.recordings.map((r) => r.udid)).to.deep.equal(['A1']);
    expect(unblockDeviceFn.called).to.equal(false);
    expect(leaveDeviceFn.called).to.equal(false);
  });

  it('the caller’s own stop of an observer group releases nothing either', async () => {
    const { orch, store, unblockDeviceFn, leaveDeviceFn, videoPipeline } = track(makeOrch());
    const { groupId } = await orch.start(observeStart());

    await orch.stop(groupId);
    await orch.sessionEnded('S1');

    expect(store.rows.map((r) => [r.status, r.fail_reason])).to.deep.equal([
      ['STOPPED', undefined],
      ['STOPPED', undefined],
    ]);
    expect(videoPipeline.stopComposite.callCount).to.equal(1);
    expect(unblockDeviceFn.called).to.equal(false);
    expect(leaveDeviceFn.called).to.equal(false);
  });

  describe('a node session’s phone, read through the hub’s relay', () => {
    /** A relay per phone, as nodeRecordingSource gives for another server's phone. */
    const relays = () => {
      const made = new Map<string, { port: number; close: sinon.SinonStub }>();
      let port = 15000;
      const nodeSourceFn = sinon.stub().callsFake(async (phone: { udid: string }) => {
        const relay = { port: port++, close: sinon.stub().resolves() };
        made.set(phone.udid, relay);
        return relay;
      });
      return { made, nodeSourceFn };
    };

    it('records from the relay, and the session’s end closes it and releases nothing', async () => {
      const { made, nodeSourceFn } = relays();
      const { orch, videoPipeline, unblockDeviceFn, leaveDeviceFn, ensureMjpegPortFn } = track(
        makeOrch({ nodeSourceFn }),
      );

      await orch.start(observeStart());
      expect(nodeSourceFn.args.map((a) => a.slice(0, 2))).to.deep.equal([
        [{ udid: 'A1', host: 'h-a' }, 'alice'],
        [{ udid: 'I1', host: 'h-i' }, 'alice'],
      ]);
      expect(ensureMjpegPortFn.called).to.equal(false);
      expect(videoPipeline.startRecording.args.map((a) => a[0].mjpegPort)).to.deep.equal([
        made.get('A1')!.port,
        made.get('I1')!.port,
      ]);
      expect(made.get('A1')!.close.called).to.equal(false);

      await orch.sessionEnded('S1');

      expect(made.get('A1')!.close.calledOnce).to.equal(true);
      expect(made.get('I1')!.close.calledOnce).to.equal(true);
      expect(unblockDeviceFn.called).to.equal(false);
      expect(leaveDeviceFn.called).to.equal(false);
    });

    it('a relay whose source ends by itself is closed and releases nothing', async () => {
      const { made, nodeSourceFn } = relays();
      const { orch, store, exits, unblockDeviceFn, leaveDeviceFn } = track(
        makeOrch({ nodeSourceFn }),
      );
      await orch.start(observeStart());

      exits.get('I1')!(0);
      const until = Date.now() + 200;
      while (store.rows[1].status === 'RECORDING' && Date.now() < until) await sleep(5);

      expect(store.rows[1].fail_reason).to.equal('source_ended');
      expect(made.get('I1')!.close.calledOnce).to.equal(true);
      expect(made.get('A1')!.close.called).to.equal(false);
      expect(unblockDeviceFn.called).to.equal(false);
      expect(leaveDeviceFn.called).to.equal(false);
    });

    it('a phone whose recording fails to start has its relay closed and is not unblocked', async () => {
      const { made, nodeSourceFn } = relays();
      const made2 = makeOrch({ nodeSourceFn });
      made2.videoPipeline.startRecording.callsFake(async (o: any) => {
        if (o.udid === 'I1') throw new Error('ffmpeg would not start');
        fs.mkdirSync(path.dirname(o.outputPath), { recursive: true });
        fs.writeFileSync(o.outputPath, Buffer.alloc(PLAYABLE_BYTES));
      });
      const { orch, unblockDeviceFn, leaveDeviceFn } = track(made2);

      const out = await orch.start(observeStart());

      expect(out.recordings.map((r) => r.udid)).to.deep.equal(['A1']);
      expect(made.get('I1')!.close.calledOnce).to.equal(true);
      expect(made.get('A1')!.close.called).to.equal(false);
      expect(unblockDeviceFn.called).to.equal(false);
      expect(leaveDeviceFn.called).to.equal(false);
    });
  });

  it('addDevice on an observer group throws observer_group', async () => {
    const { orch, blockDeviceFn, store } = track(makeOrch());
    const { groupId } = await orch.start(observeStart());

    let error: any;
    try {
      await orch.addDevice(groupId, { udid: 'U9', host: 'h-u' }, 'alice');
    } catch (err) {
      error = err;
    }

    expect(error).to.be.instanceOf(RecordingError);
    expect(error.code).to.equal('observer_group');
    expect(blockDeviceFn.called).to.equal(false);
    expect(store.rows).to.have.length(2);

    // Still refused once the group has stopped.
    await orch.sessionEnded('S1');
    let afterStop: any;
    try {
      await orch.addDevice(groupId, { udid: 'U9', host: 'h-u' }, 'alice');
    } catch (err) {
      afterStop = err;
    }
    expect(afterStop?.code).to.equal('observer_group');
  });

  it('a udid start still blocks and leaves as before', async () => {
    const { orch, blockDeviceFn, leaveDeviceFn, busyPrecheck, store } = track(makeOrch());

    const phones = [
      { udid: 'U1', host: '127.0.0.1' },
      { udid: 'U2', host: '127.0.0.1' },
    ];
    const { groupId, recordings } = await orch.start({ phones, actorId: 'alice' });

    expect(busyPrecheck.findBusy.firstCall.args).to.deep.equal([phones, 'alice']);
    expect(blockDeviceFn.callCount).to.equal(2);
    expect(blockDeviceFn.firstCall.args).to.deep.equal(['U1', '127.0.0.1', 'manual_alice_U1']);
    expect(recordings.every((r) => r.sessionId === undefined)).to.equal(true);
    expect(orch.isObserverGroup(groupId)).to.equal(false);
    expect(orch.observerGroupStarter(groupId)).to.equal(undefined);

    await orch.stop(groupId);

    expect(store.rows.map((r) => [r.status, r.fail_reason])).to.deep.equal([
      ['STOPPED', undefined],
      ['STOPPED', undefined],
    ]);
    expect(leaveDeviceFn.getCalls().map((c: any) => c.args[0])).to.deep.equal(['U1', 'U2']);
  });

  describe('recoverOnBoot', () => {
    function bootOrch(orphan: any, row: any | Error) {
      const findDevice =
        row instanceof Error ? sinon.stub().rejects(row) : sinon.stub().resolves(row);
      sinon.restore();
      sinon.stub(deviceStoreModule.DeviceStoreFactory, 'getStore').returns({
        findDevice,
        getDevices: sinon.stub().resolves([]),
      } as any);
      const made = makeOrch();
      made.store.listActive.resolves([orphan]);
      // The orphan's row is still RECORDING, so recovery ends it.
      made.store.finalize.resolves(true);
      return { ...made, findDevice };
    }
    const orphan = {
      id: 'r-orphan',
      device_udid: 'U9',
      device_host: 'h-9',
      started_by: 'alice',
    };

    it('releases a phone that still holds the recording’s own hold', async () => {
      const { orch, unblockDeviceFn, findDevice } = bootOrch(orphan, {
        udid: 'U9',
        host: 'h-9',
        busy: true,
        session_id: 'manual_alice_U9',
      });

      await orch.recoverOnBoot();

      expect(findDevice.firstCall.args[0]).to.deep.equal({ udid: 'U9', host: 'h-9' });
      expect(unblockDeviceFn.calledOnceWith('U9', 'h-9')).to.equal(true);
    });

    it('leaves alone a phone that runs a session (an observer recording’s phone)', async () => {
      const { orch, unblockDeviceFn, store } = bootOrch(orphan, {
        udid: 'U9',
        host: 'h-9',
        busy: true,
        session_id: 'S1',
        claimSessionId: 'S1',
      });

      await orch.recoverOnBoot();

      expect(store.finalize.firstCall.args[1]).to.deep.include({
        status: 'FAILED',
        failReason: 'server_restart',
      });
      expect(unblockDeviceFn.called).to.equal(false);
    });

    it('leaves alone a phone another user holds', async () => {
      const { orch, unblockDeviceFn } = bootOrch(orphan, {
        udid: 'U9',
        host: 'h-9',
        busy: true,
        session_id: 'manual_bob_U9',
      });

      await orch.recoverOnBoot();

      expect(unblockDeviceFn.called).to.equal(false);
    });

    it('releases any manual hold for a recording that names no starter', async () => {
      const { orch, unblockDeviceFn } = bootOrch(
        { id: 'r-old', device_udid: 'U9', device_host: null, started_by: null },
        { udid: 'U9', host: '127.0.0.1', busy: true, session_id: 'manual_U9' },
      );

      await orch.recoverOnBoot();

      expect(unblockDeviceFn.calledOnceWith('U9', '127.0.0.1')).to.equal(true);
    });

    it('leaves the phone alone when its row cannot be read', async () => {
      const { orch, unblockDeviceFn, store } = bootOrch(orphan, new Error('store down'));

      await orch.recoverOnBoot();

      expect(store.finalize.calledOnce).to.equal(true);
      expect(unblockDeviceFn.called).to.equal(false);
    });
  });
});

/**
 * The orchestrator's own lookups, as the server runs them: whether an observed
 * session's Session row exists (Recording.session_id is a foreign key to it)
 * and whether a phone's claim still names its session (the backstop).
 */
describe('RecordingOrchestrator: observer lookups it makes itself', () => {
  const scratch = useScratchDatabase();

  /** Every dependency but the two lookups under test. */
  const bare = () =>
    new RecordingOrchestrator({
      busyPrecheck: { findBusy: sinon.stub().resolves([]) } as any,
      store: {} as any,
      gate: new ConcurrencyGate(8),
      videoPipeline: {} as any,
      eventMgr: {} as any,
    });

  afterEach(() => sinon.restore());

  describe('sessionRowExistsFn', () => {
    it('finds a Session row by its id, and none for another', async () => {
      await scratch.db.build.create({ data: { id: 'test-build-row', name: 'Nightly' } });
      await scratch.db.session.create({
        data: {
          id: 'test-session-row',
          build_id: 'test-build-row',
          desired_capabilities: '{}',
          session_capabilities: '{}',
          node_id: 'node-1',
          has_live_video: false,
          device_udid: 'TEST-R1',
          device_platform: 'android',
          device_version: '14',
        },
      });
      try {
        const orch = bare();
        expect(await orch.sessionRowExistsFn('test-session-row')).to.equal(true);
        expect(await orch.sessionRowExistsFn('test-session-none')).to.equal(false);
      } finally {
        await scratch.db.session.delete({ where: { id: 'test-session-row' } });
        await scratch.db.build.delete({ where: { id: 'test-build-row' } });
      }
    });

    it('answers no row, never throws, when the lookup fails', async () => {
      // The scratch helper's stub of the server's prisma, told to fail.
      const findUnique = (prisma.session.findUnique as unknown as sinon.SinonStub).rejects(
        new Error('database gone'),
      );
      expect(await bare().sessionRowExistsFn('S1')).to.equal(false);
      expect(findUnique.calledOnce).to.equal(true);
    });
  });

  describe('claimHoldsFn', () => {
    const storeWith = (rows: any[]) => {
      const findDevices = sinon
        .stub()
        .callsFake(async ({ udid }: any) => rows.filter((r) => r.udid === udid));
      sinon.stub(deviceStoreModule.DeviceStoreFactory, 'getStore').returns({ findDevices } as any);
      return findDevices;
    };

    it('holds while a row of the phone is claimed for the session', async () => {
      const findDevices = storeWith([
        { udid: 'A1', host: 'h-a', claimSessionId: 'S1', session_id: 'S1' },
      ]);
      expect(await bare().claimHoldsFn('A1', 'S1')).to.equal(true);
      expect(findDevices.firstCall.args[0]).to.deep.equal({ udid: 'A1' });
    });

    it('holds for a pre-claim row whose session_id names the session', async () => {
      storeWith([{ udid: 'A1', host: 'h-a', claimSessionId: null, session_id: 'S1' }]);
      expect(await bare().claimHoldsFn('A1', 'S1')).to.equal(true);
    });

    it("holds for a hub's node phone, claimed with an empty session_id", async () => {
      storeWith([{ udid: 'N1', host: 'h-node', claimSessionId: 'S1', session_id: '' }]);
      expect(await bare().claimHoldsFn('N1', 'S1')).to.equal(true);
    });

    it('no longer holds once the claim names another session, or the phone is free', async () => {
      storeWith([
        // The claim moved on; a stale session_id still names the old session.
        { udid: 'A1', host: 'h-a', claimSessionId: 'S2', session_id: 'S1' },
        { udid: 'I1', host: 'h-i', claimSessionId: null, session_id: null },
      ]);
      const orch = bare();
      expect(await orch.claimHoldsFn('A1', 'S1')).to.equal(false);
      expect(await orch.claimHoldsFn('I1', 'S2')).to.equal(false);
      expect(await orch.claimHoldsFn('GONE', 'S1')).to.equal(false);
    });

    it('counts a failed lookup as still held: a store hiccup stops nothing', async () => {
      sinon.stub(deviceStoreModule.DeviceStoreFactory, 'getStore').returns({
        findDevices: sinon.stub().rejects(new Error('store is down')),
      } as any);
      expect(await bare().claimHoldsFn('A1', 'S1')).to.equal(true);
    });
  });
});
