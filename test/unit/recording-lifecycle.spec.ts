import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import os from 'os';
import fs from 'fs';
import path from 'path';
import express from 'express';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import {
  RecordingOrchestrator,
  RecordingError,
} from '../../src/services/recording/RecordingOrchestrator';
import { ConcurrencyGate } from '../../src/services/recording/concurrency-gate';
import RecordingsRouter from '../../src/app/routers/recordings';
import { RecordingStore } from '../../src/services/recording/recording-store';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import { useArtifactStore } from '../helpers/artifact-store';
import { useLokiStores } from '../helpers/loki-stores';
import { saveRegistrations } from '../helpers/container-registration';

const PLAYABLE_BYTES = 200_000;
const HOST = '127.0.0.1';

function playableFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-rec-life-'));
  const file = path.join(dir, 'video.mp4');
  fs.writeFileSync(file, Buffer.alloc(PLAYABLE_BYTES));
  return file;
}

function row(over: any = {}) {
  return {
    id: 'r1',
    group_id: 'g1',
    device_udid: 'U1',
    device_host: HOST,
    status: 'RECORDING',
    started_at: new Date(Date.now() - 30_000).toISOString(),
    file_path: playableFile(),
    annotations: [],
    ...over,
  };
}

/**
 * A recording store over an array, with the database's own rule for
 * finalize: it ends a row only while the row is RECORDING, and answers
 * whether it did.
 */
function rowStore(rows: any[]) {
  return {
    rows,
    create: sinon.stub().callsFake(async (i: any) => {
      rows.push({
        id: i.id,
        group_id: i.groupId,
        device_udid: i.deviceUdid,
        device_host: i.deviceHost,
        file_path: i.filePath,
        started_at: new Date().toISOString(),
        status: 'RECORDING',
        annotations: [],
      });
      return i;
    }),
    finalize: sinon.stub().callsFake(async (id: string, f: any) => {
      const r = rows.find((x) => x.id === id);
      if (!r || r.status !== 'RECORDING') return false;
      Object.assign(r, {
        status: f.status,
        fail_reason: f.failReason,
        duration_ms: f.durationMs,
        size_bytes: f.sizeBytes,
        ended_at: f.endedAt ?? new Date(),
      });
      return true;
    }),
    findById: sinon.stub().callsFake(async (id: string) => rows.find((x) => x.id === id) ?? null),
    listActive: sinon.stub().callsFake(async () => rows.filter((x) => x.status === 'RECORDING')),
    listGroup: sinon
      .stub()
      .callsFake(async (g: string) => rows.filter((x) => x.group_id === g).map((x) => ({ ...x }))),
  };
}

function makeOrch(rows: any[], over: any = {}) {
  const store = rowStore(rows);
  const gate = new ConcurrencyGate(8);
  const exits = new Map<string, (code: number | null) => void>();
  const videoPipeline = {
    startRecording: sinon.stub().callsFake(async (o: any) => {
      // The file a capture writes, so a stopped recording stays STOPPED.
      fs.mkdirSync(path.dirname(o.outputPath), { recursive: true });
      fs.writeFileSync(o.outputPath, Buffer.alloc(PLAYABLE_BYTES));
      if (o.onExit) exits.set(o.sessionId, o.onExit);
    }),
    stopRecording: sinon.stub().resolves(),
    startComposite: sinon.stub().resolves(undefined),
    stopComposite: sinon.stub().resolves(null),
  };
  const eventMgr = {
    emitRecordingStarted: sinon.stub(),
    emitRecordingStopped: sinon.stub(),
    emitRecordingFailed: sinon.stub(),
  };
  // One capture per phone, read from the rows as the real check reads them.
  const busyPrecheck = {
    findBusy: sinon
      .stub()
      .callsFake(async (phones: any[]) =>
        phones
          .filter((p) =>
            rows.some(
              (r) =>
                r.status === 'RECORDING' && r.device_udid === p.udid && r.device_host === p.host,
            ),
          )
          .map((p) => ({ udid: p.udid, host: p.host, reason: 'recording_other_group' })),
      ),
  };
  const blockDeviceFn = sinon.stub().resolves();
  const unblockDeviceFn = sinon.stub().resolves();
  const leaveDeviceFn = sinon.stub();
  const orch: any = new RecordingOrchestrator({
    busyPrecheck: busyPrecheck as any,
    store: store as any,
    gate,
    videoPipeline: videoPipeline as any,
    eventMgr: eventMgr as any,
    blockDeviceFn,
    unblockDeviceFn,
    leaveDeviceFn,
    ensureMjpegPortFn: over.ensureMjpegPortFn ?? sinon.stub().resolves(9100),
    nodeSourceFn: sinon.stub().resolves(null),
    probeDurationMsFn: sinon.stub().resolves(undefined),
    sessionRowExistsFn: sinon.stub().resolves(false),
    finalizeRetryDelaysMs: [0, 0],
  });
  return {
    orch,
    store,
    gate,
    exits,
    videoPipeline,
    eventMgr,
    busyPrecheck,
    blockDeviceFn,
    unblockDeviceFn,
    leaveDeviceFn,
  };
}

describe('RecordingOrchestrator: a recording ends once, and its phone with it', () => {
  useLokiStores();
  useArtifactStore();
  afterEach(() => sinon.restore());

  describe('a finalize write that fails', () => {
    it('is tried again, and the phone goes once it is written', async () => {
      const rows = [row()];
      const { orch, store, gate, leaveDeviceFn } = makeOrch(rows);
      gate.tryAcquire(['r1']);
      const write = store.finalize;
      let failures = 2;
      write.callsFake(async (id: string, f: any) => {
        if (failures-- > 0) throw new Error('database is locked');
        const r = rows.find((x) => x.id === id)!;
        if (r.status !== 'RECORDING') return false;
        Object.assign(r, { status: f.status, fail_reason: f.failReason });
        return true;
      });

      const out = await orch.stop('g1');

      expect(write.callCount, 'two failures, then the write').to.equal(3);
      expect(rows[0].status).to.equal('STOPPED');
      expect(out.recordings[0].status).to.equal('STOPPED');
      expect(gate.activeCount(), 'the slot goes with the row').to.equal(0);
      expect(leaveDeviceFn.callCount).to.equal(1);
    });

    // Through 2.36 the error was logged and the slot, the observer marker and
    // the phone all went, while the row stayed RECORDING: the busy check,
    // stream/stop and the leave path refused the phone until a restart, and
    // nothing could close the row.
    it('keeps the slot and the phone while the row says RECORDING, and a later stop finishes it', async () => {
      const rows = [row()];
      const { orch, store, gate, leaveDeviceFn, videoPipeline } = makeOrch(rows);
      gate.tryAcquire(['r1']);
      const fake = store.finalize;
      let down = true;
      fake.callsFake(async (id: string, f: any) => {
        if (down) throw new Error('database is locked');
        const r = rows.find((x) => x.id === id)!;
        if (r.status !== 'RECORDING') return false;
        Object.assign(r, { status: f.status, fail_reason: f.failReason, ended_at: f.endedAt });
        return true;
      });

      const first = await orch.stop('g1');
      expect(first.recordings[0].status, 'reported as it stands').to.equal('RECORDING');
      expect(rows[0].status).to.equal('RECORDING');
      expect(gate.activeCount(), 'the slot is kept while the row is open').to.equal(1);
      expect(leaveDeviceFn.called, 'the phone is kept while the row is open').to.equal(false);

      down = false;
      const second = await orch.stop('g1');
      expect(second.recordings[0].status).to.equal('STOPPED');
      expect(rows[0].status).to.equal('STOPPED');
      expect(
        rows[0].ended_at,
        'the end is when it stopped, not when it was written',
      ).to.be.instanceOf(Date);
      expect(gate.activeCount()).to.equal(0);
      expect(leaveDeviceFn.callCount).to.equal(1);
      expect(videoPipeline.stopRecording.callCount, 'its capture is stopped once').to.equal(1);
    });

    it('is written again on its own once the database answers, and announced then', async () => {
      const rows = [row()];
      const made = makeOrch(rows);
      // A fast timer for this test: 20 ms instead of 30 s.
      made.orch.unfinishedRetryMs = 20;
      const { orch, store, gate, leaveDeviceFn, eventMgr } = made;
      gate.tryAcquire(['r1']);
      let down = true;
      store.finalize.callsFake(async (id: string, f: any) => {
        if (down) throw new Error('database is locked');
        const r = rows.find((x) => x.id === id)!;
        if (r.status !== 'RECORDING') return false;
        Object.assign(r, { status: f.status, fail_reason: f.failReason });
        return true;
      });

      await orch.stop('g1');
      expect(
        eventMgr.emitRecordingStopped.firstCall.args[0].recordings,
        'not announced stopped while its row records',
      ).to.deep.equal([]);
      down = false;
      await new Promise((r) => setTimeout(r, 80));

      expect(rows[0].status).to.equal('STOPPED');
      expect(gate.activeCount()).to.equal(0);
      expect(leaveDeviceFn.callCount).to.equal(1);
      const last = eventMgr.emitRecordingStopped.lastCall.args[0];
      expect(last.recordings.map((r: any) => [r.id, r.status])).to.deep.equal([['r1', 'STOPPED']]);
    });

    it('from a source that ended is finished by a stop', async () => {
      const rows = [row()];
      const { orch, store, gate, leaveDeviceFn } = makeOrch(rows);
      gate.tryAcquire(['r1']);
      let down = true;
      store.finalize.callsFake(async (id: string, f: any) => {
        if (down) throw new Error('database is locked');
        const r = rows.find((x) => x.id === id)!;
        if (r.status !== 'RECORDING') return false;
        Object.assign(r, { status: f.status, fail_reason: f.failReason });
        return true;
      });

      await orch.handleSourceEnded('r1', 0);
      expect(rows[0].status).to.equal('RECORDING');
      expect(gate.activeCount()).to.equal(1);
      expect(leaveDeviceFn.called).to.equal(false);

      down = false;
      await orch.stop('g1');
      expect(rows[0]).to.include({ status: 'STOPPED', fail_reason: 'source_ended' });
      expect(gate.activeCount()).to.equal(0);
      expect(leaveDeviceFn.callCount).to.equal(1);
    });
  });

  describe('finalize as a transition', () => {
    // stop() reads its group once; a phone whose source ended after that read
    // was finalized again with the stale status, its end and duration
    // overwritten and its phone let go of twice.
    it('a row finalized after stop read the group is not finalized again', async () => {
      const rows = [row({ id: 'r1' }), row({ id: 'r2', device_udid: 'U2' })];
      const { orch, store, gate, leaveDeviceFn } = makeOrch(rows);
      gate.tryAcquire(['r1', 'r2']);
      const read = store.listGroup;
      read.callsFake(async (g: string) => {
        const snapshot = rows.filter((x) => x.group_id === g).map((x) => ({ ...x }));
        // r1's source ends just after the group was read.
        await orch.handleSourceEnded('r1', 0);
        return snapshot;
      });

      const out = await orch.stop('g1');

      expect(rows[0]).to.include({ status: 'STOPPED', fail_reason: 'source_ended' });
      expect(
        leaveDeviceFn.getCalls().map((c: any) => c.args[0]),
        'each phone is let go of once',
      ).to.deep.equal(['U1', 'U2']);
      const r1 = out.recordings.find((r: any) => r.id === 'r1');
      expect(r1.status).to.equal('STOPPED');
      expect(gate.activeCount()).to.equal(0);
    });

    it('recoverOnBoot leaves the phone of a row it did not end', async () => {
      const rows = [row({ started_by: 'alice' })];
      const { orch, store, unblockDeviceFn } = makeOrch(rows);
      // The phone still carries the recording's hold, so only the row's own
      // state can tell recovery to leave it.
      sinon.stub(DeviceStoreFactory, 'getStore').returns({
        findDevice: async () => ({ udid: 'U1', host: HOST, session_id: 'manual_alice_U1' }),
        getDevices: async () => [],
      } as any);
      store.listActive.resolves([{ ...rows[0] }]);
      rows[0].status = 'STOPPED'; // ended by another server meanwhile
      await orch.recoverOnBoot();
      expect(unblockDeviceFn.called).to.equal(false);
    });
  });

  describe('add-device', () => {
    // Through 2.36 its ffmpeg had no onExit: a source that ended left the row
    // RECORDING until someone pressed Stop or the server restarted.
    it('finalizes an added phone whose source ends', async () => {
      const rows = [row()];
      const { orch, exits, leaveDeviceFn, gate } = makeOrch(rows);
      const { recording } = await orch.addDevice('g1', { udid: 'U9', host: HOST }, 'alice');
      const onExit = exits.get(recording.id);
      expect(onExit, 'its capture reports its exit').to.be.a('function');

      onExit!(0);
      await new Promise((r) => setTimeout(r, 20));

      const added = rows.find((x) => x.id === recording.id);
      expect(added).to.include({ status: 'STOPPED', fail_reason: 'source_ended' });
      expect(leaveDeviceFn.calledWith('U9')).to.equal(true);
      expect(gate.activeCount()).to.equal(0);
    });

    it('is refused for a group that has stopped, or never was', async () => {
      const rows = [row({ status: 'STOPPED' })];
      const { orch, blockDeviceFn, videoPipeline, store } = makeOrch(rows);
      for (const groupId of ['g1', 'nope']) {
        let err: any;
        try {
          await orch.addDevice(groupId, { udid: 'U9', host: HOST }, 'alice');
        } catch (e) {
          err = e;
        }
        expect(err, groupId).to.be.instanceOf(RecordingError);
        expect(err.code).to.equal('group_not_recording');
      }
      expect(blockDeviceFn.called).to.equal(false);
      expect(videoPipeline.startRecording.called).to.equal(false);
      expect(store.create.called).to.equal(false);
    });
  });

  describe('one capture per phone', () => {
    // The row is written only after the hold, the source port (up to 90 s for
    // a node's relay) and a Session lookup, so two quick starts of one phone
    // both passed the check and both recorded it.
    it('refuses a second start of a phone still being started', async () => {
      const rows: any[] = [];
      let release!: () => void;
      const gateOpen = new Promise<void>((r) => (release = r));
      const ensureMjpegPortFn = sinon.stub().callsFake(async () => {
        await gateOpen;
        return 9100;
      });
      const { orch, videoPipeline } = makeOrch(rows, { ensureMjpegPortFn });
      const phone = { udid: 'U1', host: HOST };

      const first = orch.start({ phones: [phone], actorId: 'alice' });
      await new Promise((r) => setImmediate(r));
      const second = orch.start({ phones: [phone], actorId: 'alice' }).then(
        () => undefined,
        (e: any) => e,
      );
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
      release();
      await first;
      const err = await second;

      expect(err).to.be.instanceOf(RecordingError);
      expect(err.code).to.equal('device_busy');
      expect(err.busyDevices).to.deep.equal([
        { udid: 'U1', host: HOST, reason: 'recording_other_group' },
      ]);
      expect(videoPipeline.startRecording.callCount).to.equal(1);
    });

    it('lets the phone go again once a start fails', async () => {
      const rows: any[] = [];
      const ensureMjpegPortFn = sinon.stub();
      ensureMjpegPortFn.onFirstCall().rejects(new Error('no stream'));
      ensureMjpegPortFn.resolves(9100);
      const { orch } = makeOrch(rows, { ensureMjpegPortFn });
      const phone = { udid: 'U1', host: HOST };
      await orch.start({ phones: [phone], actorId: 'alice' });
      const second = await orch.start({ phones: [phone], actorId: 'alice' });
      expect(second.recordings).to.have.length(1);
    });

    it('a refused start leaves the phones it reserved', async () => {
      const rows = [row({ device_udid: 'U2' })];
      const { orch } = makeOrch(rows);
      let err: any;
      try {
        await orch.start({
          phones: [
            { udid: 'U1', host: HOST },
            { udid: 'U2', host: HOST },
          ],
          actorId: 'alice',
        });
      } catch (e) {
        err = e;
      }
      expect(err?.code).to.equal('device_busy');
      const ok = await orch.start({ phones: [{ udid: 'U1', host: HOST }], actorId: 'alice' });
      expect(ok.recordings).to.have.length(1);
    });
  });
});

describe('POST /recordings/:groupId/add-device on a group that is not recording', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = saveRegistrations(RecordingStore, RecordingOrchestrator);
    Container.set(RecordingStore, {} as any);
    Container.set(RecordingOrchestrator, {
      addDevice: sinon.stub().rejects(new RecordingError('group_not_recording')),
    } as any);
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevices: async ({ udid }: any) => [{ udid, host: HOST, teamId: null }],
    } as any);
  });
  afterEach(() => {
    sinon.restore();
    restore();
  });

  it('is 409 group_not_recording, saying so', async () => {
    const app = express();
    app.use(express.json());
    const api = express.Router();
    api.use((req, _res, next) => {
      (req as any).auth = {
        kind: 'user-session',
        userId: 'usr_root',
        role: 'ADMIN',
        scopes: scopesForRole('ADMIN'),
        teamIds: undefined,
        rateLimit: 100,
      };
      next();
    });
    RecordingsRouter.register(api);
    app.use('/xenon/api', api);

    const res = await request(app).post('/xenon/api/recordings/g1/add-device').send({ udid: 'U9' });

    expect(res.status, JSON.stringify(res.body)).to.equal(409);
    expect(res.body.error).to.equal('group_not_recording');
    expect(res.body.message).to.match(/no longer recording/i);
  });
});
