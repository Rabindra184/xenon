import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import {
  RecordingOrchestrator,
  RecordingError,
} from '../../src/services/recording/RecordingOrchestrator';
import { ConcurrencyGate } from '../../src/services/recording/concurrency-gate';
import * as deviceStoreModule from '../../src/data-service/device-store';

/**
 * The six scenarios from the spec's cross-workflow risk matrix
 * (docs/superpowers/specs/2026-04-27-multi-device-mosaic-and-proof-pack-design.md
 * §"Test Plan"). Asserts the contract that no manual or automation
 * workflow is broken by the new free-form recording surface.
 */

function makeOrch(overrides: any = {}) {
  const busyPrecheck = overrides.busyPrecheck ?? { findBusy: sinon.stub().resolves([]) };
  const store =
    overrides.store ?? {
      create: sinon.stub().callsFake(async (i: any) => ({ id: `rec-${i.deviceUdid}`, ...i })),
      finalize: sinon.stub().resolves({}),
      listActive: sinon.stub().resolves([]),
      listGroup: sinon.stub().resolves([]),
    };
  const gate = overrides.gate ?? new ConcurrencyGate(4);
  const videoPipeline =
    overrides.videoPipeline ?? {
      startRecording: sinon.stub().resolves(),
      stopRecording: sinon.stub().resolves(),
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
  const orch = new RecordingOrchestrator({
    busyPrecheck: busyPrecheck as any,
    store: store as any,
    gate: gate as any,
    videoPipeline: videoPipeline as any,
    blockDeviceFn,
    eventMgr: eventMgr as any,
    unblockDeviceFn,
  });
  return { orch, busyPrecheck, store, gate, videoPipeline, blockDeviceFn, unblockDeviceFn, eventMgr };
}

describe('Cross-workflow integration: manual + automation safety (6 scenarios)', () => {
  let factoryStub: sinon.SinonStub;
  beforeEach(() => {
    factoryStub = sinon
      .stub(deviceStoreModule.DeviceStoreFactory, 'getStore')
      .returns({
        findDevice: async ({ udid }: any) => ({
          udid,
          host: '127.0.0.1',
          busy: false,
        }),
      } as any);
  });
  afterEach(() => sinon.restore());

  it('1. mosaic recording on UDID X then automation request on UDID X — automation rejected by existing busy semantics', async () => {
    const { orch, blockDeviceFn } = makeOrch();
    await orch.start({ udids: ['U1'], actorId: 'test-actor' });
    // The existing device-allocator inspects device.busy=true (set by
    // blockDevice) and skips the device for any new automation session.
    // We assert the block was taken with the manual_<actorId>_<udid>
    // sentinel — automation guards continue to recognise it via the
    // `startsWith('manual_')` test they already use.
    expect(
      (blockDeviceFn as any).calledWith('U1', '127.0.0.1', 'manual_test-actor_U1'),
    ).to.equal(true);
  });

  it('2. automation running on U1 then mosaic tries — 409 device_busy, no rows, no ffmpeg, no blocks', async () => {
    const { orch, store, videoPipeline, blockDeviceFn } = makeOrch({
      busyPrecheck: {
        findBusy: sinon
          .stub()
          .resolves([{ udid: 'U1', reason: 'automation', sessionId: 'sess-X' }]),
      },
    });
    let caught: any;
    try {
      await orch.start({ udids: ['U1'], actorId: 'test-actor' });
    } catch (e) {
      caught = e;
    }
    expect(caught).to.be.instanceOf(RecordingError);
    expect(caught.code).to.equal('device_busy');
    expect(caught.busyDevices[0].reason).to.equal('automation');
    expect(store.create.callCount).to.equal(0);
    expect(videoPipeline.startRecording.callCount).to.equal(0);
    expect((blockDeviceFn as any).callCount).to.equal(0);
  });

  it('3. automation and mosaic on different UDIDs concurrently — both proceed, isolated ffmpegs', async () => {
    const { orch, videoPipeline } = makeOrch();
    await orch.start({ udids: ['U1'], actorId: 'test-actor' });
    await orch.start({ udids: ['U2'], actorId: 'test-actor' });
    expect(videoPipeline.startRecording.callCount).to.equal(2);
    // Two distinct sessionIds (Recording.id) → two independent ffmpeg keys
    // in VideoPipelineService.activeRecordings.
    const calls = videoPipeline.startRecording.getCalls();
    const passedSessionIds = calls.map((c: any) => c.args[0].sessionId);
    expect(new Set(passedSessionIds).size).to.equal(2);
  });

  it('4. ffmpeg stop throws (simulated device unplug) — Recording marked FAILED, manual block released', async () => {
    const { orch, store, unblockDeviceFn, videoPipeline } = makeOrch({
      store: {
        listGroup: sinon.stub().resolves([
          {
            id: 'r-X',
            device_udid: 'U1',
            device_host: '127.0.0.1',
            file_path: '/nonexistent.mp4',
            started_at: new Date(Date.now() - 1000),
          },
        ]),
        finalize: sinon.stub().resolves({}),
      },
      videoPipeline: {
        startRecording: sinon.stub(),
        stopRecording: sinon.stub().rejects(new Error('device unplugged')),
      },
    });
    await orch.stop('grp-X');
    const finalizeArgs = store.finalize.firstCall.args[1];
    expect(finalizeArgs.status).to.equal('FAILED');
    expect(unblockDeviceFn.calledWith('U1', '127.0.0.1')).to.equal(true);
  });

  it('5. server restart with orphan RECORDING row — recoverOnBoot marks FAILED + releases block', async () => {
    const { orch, store, unblockDeviceFn } = makeOrch({
      store: {
        listActive: sinon.stub().resolves([
          { id: 'r-orphan', device_udid: 'U9', device_host: '127.0.0.1' },
        ]),
        finalize: sinon.stub().resolves({}),
      },
    });
    await orch.recoverOnBoot();
    const args = store.finalize.firstCall.args[1];
    expect(args).to.deep.include({ status: 'FAILED', failReason: 'server_restart' });
    expect(unblockDeviceFn.calledWith('U9', '127.0.0.1')).to.equal(true);
  });

  it('6. two clients race on overlapping UDIDs — exactly one wins, loser gets 409 device_busy, no partial group', async () => {
    // Client A acquires [U1, U2] first.
    const { orch, videoPipeline } = makeOrch();
    await orch.start({ udids: ['U1', 'U2'], actorId: 'test-actor' });
    expect(videoPipeline.startRecording.callCount).to.equal(2);

    // Client B requests [U2, U3]. The precheck now sees U2 as
    // manual_other (since A took the block).
    const orchB = makeOrch({
      busyPrecheck: {
        findBusy: sinon
          .stub()
          .resolves([{ udid: 'U2', reason: 'manual_other', blockId: 'manual_U2' }]),
      },
    });
    let caught: any;
    try {
      await orchB.orch.start({ udids: ['U2', 'U3'], actorId: 'test-actor' });
    } catch (e) {
      caught = e;
    }
    expect(caught).to.be.instanceOf(RecordingError);
    expect(caught.code).to.equal('device_busy');
    // U3 was never spawned because the request is atomic.
    expect(orchB.videoPipeline.startRecording.callCount).to.equal(0);
    expect(orchB.store.create.callCount).to.equal(0);
  });
});
