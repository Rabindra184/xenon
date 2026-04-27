import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import {
  RecordingOrchestrator,
  RecordingError,
} from '../../src/services/recording/RecordingOrchestrator';
import { ConcurrencyGate } from '../../src/services/recording/concurrency-gate';

// Stub the device store factory (used to look up host).
import * as deviceStoreModule from '../../src/data-service/device-store';

function makeOrch(overrides: any = {}) {
  const busyPrecheck = overrides.busyPrecheck ?? { findBusy: sinon.stub().resolves([]) };
  const store =
    overrides.store ?? {
      create: sinon.stub().callsFake(async (i: any) => ({ id: `rec-${i.deviceUdid}`, ...i })),
      finalize: sinon.stub().resolves({}),
      listActive: sinon.stub().resolves([]),
      listGroup: sinon.stub().resolves([]),
      addBookmark: sinon.stub().resolves({ id: 'bm-1' }),
      addAnnotation: sinon.stub().resolves({ id: 'an-1' }),
    };
  const gate = overrides.gate ?? new ConcurrencyGate(4);
  const videoPipeline =
    overrides.videoPipeline ?? {
      startRecording: sinon.stub().resolves(),
      stopRecording: sinon.stub().resolves('/tmp/x.mp4'),
    };
  const blockDeviceFn = overrides.blockDeviceFn ?? sinon.stub().resolves();
  const unblockDeviceFn = overrides.unblockDeviceFn ?? sinon.stub().resolves();
  const eventMgr =
    overrides.eventMgr ?? {
      emitRecordingStarted: sinon.stub(),
      emitRecordingStopped: sinon.stub(),
      emitRecordingFailed: sinon.stub(),
      emitRecordingBookmark: sinon.stub(),
      emitRecordingAnnotation: sinon.stub(),
    };
  const orch = new RecordingOrchestrator(
    busyPrecheck as any,
    store as any,
    gate as any,
    videoPipeline as any,
    blockDeviceFn,
    eventMgr as any,
    unblockDeviceFn,
  );
  return { orch, busyPrecheck, store, gate, videoPipeline, blockDeviceFn, unblockDeviceFn, eventMgr };
}

describe('RecordingOrchestrator.start', () => {
  let factoryStub: sinon.SinonStub;
  beforeEach(() => {
    factoryStub = sinon
      .stub(deviceStoreModule.DeviceStoreFactory, 'getStore')
      .returns({
        findDevice: sinon.stub().callsFake(async ({ udid }: any) => ({
          udid,
          host: '127.0.0.1',
          busy: false,
        })),
      } as any);
  });
  afterEach(() => sinon.restore());

  it('refuses atomically when any UDID is busy — no rows, no ffmpeg, no blocks', async () => {
    const { orch, store, videoPipeline, blockDeviceFn } = makeOrch({
      busyPrecheck: {
        findBusy: sinon
          .stub()
          .resolves([{ udid: 'U2', reason: 'automation', sessionId: 'sess-x' }]),
      },
    });
    try {
      await orch.start({ udids: ['U1', 'U2'] });
      expect.fail('expected throw');
    } catch (e: any) {
      expect(e).to.be.instanceOf(RecordingError);
      expect(e.code).to.equal('device_busy');
      expect(e.busyDevices).to.have.length(1);
    }
    expect(store.create.callCount).to.equal(0);
    expect(videoPipeline.startRecording.callCount).to.equal(0);
    expect((blockDeviceFn as any).callCount).to.equal(0);
  });

  it('refuses when concurrency cap would be exceeded — atomic rollback', async () => {
    const gate = new ConcurrencyGate(0);
    const { orch, store } = makeOrch({ gate });
    try {
      await orch.start({ udids: ['U1'] });
      expect.fail('expected throw');
    } catch (e: any) {
      expect(e.code).to.equal('concurrency_cap');
      expect(e.limit).to.equal(0);
    }
    expect(store.create.callCount).to.equal(0);
  });

  it('happy path: creates one row per UDID, spawns ffmpeg, takes blocks, emits started', async () => {
    const { orch, store, videoPipeline, blockDeviceFn, eventMgr } = makeOrch();
    const out = await orch.start({ udids: ['U1', 'U2'] });
    expect(out.recordings).to.have.length(2);
    expect(store.create.callCount).to.equal(2);
    expect(videoPipeline.startRecording.callCount).to.equal(2);
    expect((blockDeviceFn as any).callCount).to.equal(2);
    expect(
      (blockDeviceFn as any).calledWith('U1', sinon.match.string, 'manual_U1'),
    ).to.equal(true);
    expect(eventMgr.emitRecordingStarted.callCount).to.equal(1);
  });
});

describe('RecordingOrchestrator.stop', () => {
  it('finalizes, releases gate, releases blocks, emits stopped', async () => {
    const store = {
      listGroup: sinon.stub().resolves([
        {
          id: 'r1',
          device_udid: 'U1',
          device_host: '127.0.0.1',
          file_path: '/nonexistent/r1.mp4',
          started_at: new Date(Date.now() - 5000),
        },
        {
          id: 'r2',
          device_udid: 'U2',
          device_host: '127.0.0.1',
          file_path: '/nonexistent/r2.mp4',
          started_at: new Date(Date.now() - 5000),
        },
      ]),
      finalize: sinon.stub().resolves({}),
    };
    const gate = { release: sinon.stub(), tryAcquire: () => true, getLimit: () => 4, activeCount: () => 0 };
    const videoPipeline = {
      startRecording: sinon.stub(),
      stopRecording: sinon.stub().resolves('/tmp/x.mp4'),
    };
    const unblockDeviceFn = sinon.stub().resolves();
    const eventMgr = { emitRecordingStopped: sinon.stub() };
    const { orch } = makeOrch({ store, gate, videoPipeline, unblockDeviceFn, eventMgr });
    await orch.stop('grp-1');
    expect(videoPipeline.stopRecording.callCount).to.equal(2);
    expect(store.finalize.callCount).to.equal(2);
    expect(gate.release.callCount).to.equal(2);
    expect(unblockDeviceFn.callCount).to.equal(2);
    expect(eventMgr.emitRecordingStopped.callCount).to.equal(1);
  });

  it('marks FAILED when ffmpeg stop throws but still releases the block', async () => {
    const store = {
      listGroup: sinon.stub().resolves([
        {
          id: 'r1',
          device_udid: 'U1',
          device_host: '127.0.0.1',
          file_path: '/nonexistent/r1.mp4',
          started_at: new Date(Date.now() - 1000),
        },
      ]),
      finalize: sinon.stub().resolves({}),
    };
    const videoPipeline = {
      startRecording: sinon.stub(),
      stopRecording: sinon.stub().rejects(new Error('ffmpeg died')),
    };
    const unblockDeviceFn = sinon.stub().resolves();
    const { orch } = makeOrch({ store, videoPipeline, unblockDeviceFn });
    await orch.stop('grp-1');
    expect(store.finalize.firstCall.args[1].status).to.equal('FAILED');
    expect(unblockDeviceFn.calledWith('U1', '127.0.0.1')).to.equal(true);
  });
});

describe('RecordingOrchestrator.recoverOnBoot', () => {
  it('marks orphans FAILED with fail_reason=server_restart and releases blocks', async () => {
    const store = {
      listActive: sinon.stub().resolves([
        { id: 'r-orphan', device_udid: 'U9', device_host: '127.0.0.1' },
      ]),
      finalize: sinon.stub().resolves({}),
    };
    const unblockDeviceFn = sinon.stub().resolves();
    const { orch } = makeOrch({ store, unblockDeviceFn });
    await orch.recoverOnBoot();
    const args = store.finalize.firstCall.args[1];
    expect(args).to.deep.include({ status: 'FAILED', failReason: 'server_restart' });
    expect(unblockDeviceFn.calledWith('U9', '127.0.0.1')).to.equal(true);
  });

  it('no-ops cleanly when there are no orphans', async () => {
    const store = {
      listActive: sinon.stub().resolves([]),
      finalize: sinon.stub().resolves({}),
    };
    const { orch } = makeOrch({ store });
    await orch.recoverOnBoot();
    expect(store.finalize.callCount).to.equal(0);
  });
});

describe('RecordingOrchestrator.addBookmark / addAnnotation', () => {
  it('addBookmark persists and emits', async () => {
    const store = { addBookmark: sinon.stub().resolves({ id: 'bm-1', label: 'bug here' }) };
    const eventMgr = {
      emitRecordingBookmark: sinon.stub(),
    };
    const { orch } = makeOrch({ store, eventMgr });
    await orch.addBookmark('grp', 'rec-1', 1500, 'bug here');
    expect(store.addBookmark.calledWith('rec-1', 'bug here', 1500)).to.equal(true);
    expect(eventMgr.emitRecordingBookmark.callCount).to.equal(1);
  });

  it('addAnnotation persists and emits', async () => {
    const store = { addAnnotation: sinon.stub().resolves({ id: 'an-1' }) };
    const eventMgr = {
      emitRecordingAnnotation: sinon.stub(),
    };
    const { orch } = makeOrch({ store, eventMgr });
    await orch.addAnnotation('grp', 'rec-1', {
      timecodeMs: 100,
      shape: 'RECT',
      geometry: '{}',
      color: '#fff',
    });
    expect(store.addAnnotation.callCount).to.equal(1);
    expect(eventMgr.emitRecordingAnnotation.callCount).to.equal(1);
  });
});
