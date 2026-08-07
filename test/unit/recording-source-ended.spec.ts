import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { Container } from 'typedi';
import { RecordingOrchestrator } from '../../src/services/recording/RecordingOrchestrator';
import { ConcurrencyGate } from '../../src/services/recording/concurrency-gate';
import { ARTIFACT_STORE, FsArtifactStore } from '../../src/services/artifacts/ArtifactStore';

// Issue #203. When the ffmpeg process for a recording exits on its own nothing
// told the orchestrator, so the row sat at RECORDING — no ended_at, no duration,
// no size — until a human clicked Stop. Observed live during the #200 cable-pull
// test: the device was disconnected, ffmpeg saw EOF and exited 0, the mp4
// finalised correctly at 35.16s, and five and a half minutes later the row still
// read {"status":"RECORDING","ended_at":null} with zero ffmpeg processes alive.
//
// It was near-unreachable before #201, because ffmpeg only exited early if it
// crashed. #201 made a clean early exit a designed outcome.

before(() => {
  Container.set(ARTIFACT_STORE, new FsArtifactStore(os.tmpdir()));
});
after(() => {
  Container.remove(ARTIFACT_STORE);
});

const PLAYABLE_BYTES = 200_000;

function writeFile(bytes: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-rec-'));
  const file = path.join(dir, 'video.mp4');
  fs.writeFileSync(file, Buffer.alloc(bytes));
  return file;
}

function makeRow(overrides: any = {}) {
  return {
    id: 'rec-1',
    group_id: 'grp-1',
    device_udid: 'android-1',
    device_host: '127.0.0.1',
    status: 'RECORDING',
    started_at: new Date(Date.now() - 30_000).toISOString(),
    file_path: writeFile(PLAYABLE_BYTES),
    annotations: [],
    ...overrides,
  };
}

function makeOrch(row: any, overrides: any = {}) {
  const store = {
    create: sinon.stub().resolves({}),
    finalize: sinon.stub().resolves({}),
    listActive: sinon.stub().resolves([]),
    listGroup: sinon.stub().resolves(row ? [row] : []),
    findById: sinon.stub().resolves(row),
    addBookmark: sinon.stub().resolves({}),
    addAnnotation: sinon.stub().resolves({}),
    ...(overrides.store ?? {}),
  };
  const gate = new ConcurrencyGate(4);
  const videoPipeline = {
    startRecording: sinon.stub().resolves(),
    stopRecording: sinon.stub().resolves('/tmp/x.mp4'),
    startComposite: sinon.stub().resolves(),
    stopComposite: sinon.stub().resolves(null),
    ...(overrides.videoPipeline ?? {}),
  };
  const eventMgr = {
    emitRecordingStarted: sinon.stub(),
    emitRecordingStopped: sinon.stub(),
    emitRecordingFailed: sinon.stub(),
    emitRecordingBookmark: sinon.stub(),
    emitRecordingAnnotation: sinon.stub(),
  };
  const unblockDeviceFn = sinon.stub().resolves();
  const orch: any = new RecordingOrchestrator({
    busyPrecheck: { findBusy: sinon.stub().resolves([]) } as any,
    store: store as any,
    gate,
    videoPipeline: videoPipeline as any,
    eventMgr: eventMgr as any,
    blockDeviceFn: sinon.stub().resolves(),
    unblockDeviceFn,
    ensureMjpegPortFn: sinon.stub().resolves(9100),
  });
  return { orch, store, gate, videoPipeline, eventMgr, unblockDeviceFn };
}

describe('RecordingOrchestrator: ffmpeg exiting on its own', () => {
  afterEach(() => sinon.restore());

  it('finalizes the row instead of leaving it at RECORDING', async () => {
    const row = makeRow();
    const { orch, store, eventMgr } = makeOrch(row);

    await orch.handleSourceEnded('rec-1', 0);

    expect(store.finalize.calledOnce, 'the row must be finalized').to.be.true;
    const [id, input] = store.finalize.firstCall.args;
    expect(id).to.equal('rec-1');
    expect(input.status, 'a playable file is a stopped recording, not a failure').to.equal(
      'STOPPED',
    );
    expect(input.sizeBytes).to.equal(PLAYABLE_BYTES);
    expect(input.durationMs).to.be.a('number');
    expect(eventMgr.emitRecordingStopped.calledOnce, 'dashboard must be told').to.be.true;
  });

  it('records WHY it ended, so short footage is visible in the data', () => {
    // The video is valid, just shorter than the user asked for. Marking it
    // FAILED would misdescribe a playable file; marking it STOPPED and saying
    // nothing would hide that footage is missing.
    const row = makeRow();
    const { orch, store } = makeOrch(row);

    return orch.handleSourceEnded('rec-1', 0).then(() => {
      expect(store.finalize.firstCall.args[1].failReason).to.equal('source_ended');
    });
  });

  it('marks FAILED when the file is unusable', async () => {
    const row = makeRow({ file_path: writeFile(128) });
    const { orch, store } = makeOrch(row);

    await orch.handleSourceEnded('rec-1', 1);

    expect(store.finalize.firstCall.args[1].status).to.equal('FAILED');
    expect(store.finalize.firstCall.args[1].failReason).to.equal('empty_or_corrupt_mp4');
  });

  it('releases the gate slot and the device lock', async () => {
    const row = makeRow();
    const { orch, gate, unblockDeviceFn } = makeOrch(row);
    gate.tryAcquire(['rec-1']);

    await orch.handleSourceEnded('rec-1', 0);

    expect(gate.tryAcquire(['rec-1']), 'slot must be free again').to.be.true;
    expect(unblockDeviceFn.called, 'manual lock released').to.be.true;
  });

  it('does nothing when the row was already finalized', async () => {
    // A manual Stop that won the race already closed it out.
    const row = makeRow({ status: 'STOPPED' });
    const { orch, store } = makeOrch(row);

    await orch.handleSourceEnded('rec-1', 0);

    expect(store.finalize.called, 'must not re-finalize').to.be.false;
  });

  it('does nothing when a stop is already in flight for that recording', async () => {
    const row = makeRow();
    const { orch, store } = makeOrch(row);
    // stop() marks ids as finalizing while it works; an exit arriving in that
    // window must not finalize the same row a second time.
    orch.finalizing.add('rec-1');

    await orch.handleSourceEnded('rec-1', 0);

    expect(store.finalize.called).to.be.false;
  });

  it('survives an unknown recording id', async () => {
    const { orch, store } = makeOrch(null, { store: { findById: sinon.stub().resolves(null) } });
    await orch.handleSourceEnded('nope', 0);
    expect(store.finalize.called).to.be.false;
  });

  it('wires the pipeline callback so a self-exit reaches the orchestrator', async () => {
    const row = makeRow();
    const { orch, videoPipeline, store } = makeOrch(row);

    await orch.start({ udids: ['android-1'], actorId: 'user-1' });

    const opts = videoPipeline.startRecording.firstCall.args[0];
    expect(opts.onExit, 'startRecording must be given an exit callback').to.be.a('function');

    // Drive it the way the pipeline would.
    store.findById.resolves({ ...row, id: opts.sessionId });
    opts.onExit(0);
    await new Promise((r) => setTimeout(r, 20));
    expect(store.finalize.called, 'the callback must finalize the row').to.be.true;
  });
});
