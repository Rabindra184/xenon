import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as unzipper from 'unzipper';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import {
  RecordingOrchestrator,
  compositeOutputPath,
  compositeLayoutPath,
  listCompositeParts,
  readCompositeEnded,
} from '../../src/services/recording/RecordingOrchestrator';
import { ConcurrencyGate } from '../../src/services/recording/concurrency-gate';
import { compositeGrid } from '../../src/services/VideoPipelineService';
import { ProofBundleService } from '../../src/services/recording/proof-bundle';
import { AnnotationRenderService } from '../../src/services/recording/annotation-render';
import { RecordingStore } from '../../src/services/recording/recording-store';
import RecordingsRouter from '../../src/app/routers/recordings';
import * as deviceService from '../../src/data-service/device-service';
import * as deviceStoreModule from '../../src/data-service/device-store';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import { useArtifactStore } from '../helpers/artifact-store';
import { saveRegistrations } from '../helpers/container-registration';

// A phone added to a running group (add-device) joins the group's composite:
// the composite in progress ends and a new part starts with every phone still
// recording. The group's composite is then its parts in order: composite.mp4,
// composite-2.mp4, ... Through 2.36 the composite kept the phones it started
// with, and an added phone was in no side-by-side video.

const PLAYABLE_BYTES = 4096;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const at = (...udids: string[]) => udids.map((udid) => ({ udid, host: '127.0.0.1' }));
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

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

function makeOrch(opts: { now?: () => number; gate?: number } = {}) {
  const store = rowStore();
  const exits = new Map<string, (code: number | null) => void>();
  let port = 9100;
  const videoPipeline = {
    startRecording: sinon.stub().callsFake(async (o: any) => {
      fs.mkdirSync(path.dirname(o.outputPath), { recursive: true });
      fs.writeFileSync(o.outputPath, Buffer.alloc(PLAYABLE_BYTES));
      if (o.onExit) exits.set(o.udid, o.onExit);
    }),
    stopRecording: sinon.stub().resolves('/tmp/x.mp4'),
    startComposite: sinon.stub().callsFake(async (o: any) => ({
      cellW: 540,
      cellH: 960,
      ...compositeGrid(o.inputs.length),
    })),
    stopComposite: sinon.stub().resolves(null),
  };
  const eventMgr = {
    emitRecordingStarted: sinon.stub(),
    emitRecordingStopped: sinon.stub(),
    emitRecordingFailed: sinon.stub(),
  };
  const orch = new RecordingOrchestrator({
    busyPrecheck: { findBusy: sinon.stub().resolves([]) } as any,
    store: store as any,
    gate: new ConcurrencyGate(opts.gate ?? 8),
    videoPipeline: videoPipeline as any,
    eventMgr: eventMgr as any,
    blockDeviceFn: sinon.stub().resolves(),
    unblockDeviceFn: sinon.stub().resolves(),
    ensureMjpegPortFn: sinon.stub().callsFake(async () => port++),
    nodeSourceFn: sinon.stub().resolves(null),
    leaveDeviceFn: sinon.stub(),
    probeDurationMsFn: sinon.stub().resolves(undefined),
    now: opts.now,
  });
  return { orch, store, videoPipeline, exits };
}

const clock = (...ticks: number[]) => {
  let i = 0;
  return () => ticks[Math.min(i++, ticks.length - 1)];
};

describe('RecordingOrchestrator: an added phone joins the composite', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-composite-parts-'));
  useArtifactStore(root);
  beforeEach(() => {
    sinon.stub(deviceStoreModule.DeviceStoreFactory, 'getStore').returns({
      findDevice: sinon
        .stub()
        .callsFake(async ({ udid }: any) => ({ udid, host: '127.0.0.1', busy: false })),
    } as any);
  });
  afterEach(() => sinon.restore());
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  it('starts a new part with every phone, the old cells first, then ends the old part', async () => {
    // U1 and U2 spawn at 1000 and 1600, start() returns at 2350 (t=0), U3 is
    // added at 9000 and the new part has spawned at 9800.
    const { orch, videoPipeline } = makeOrch({ now: clock(1000, 1600, 2350, 9000, 9800) });
    const { groupId, recordings } = await orch.start({ phones: at('U1', 'U2'), actorId: 'alice' });
    const { recording } = await orch.addDevice(groupId, at('U3')[0], 'alice');

    expect(videoPipeline.startComposite.callCount).to.equal(2);
    const second = videoPipeline.startComposite.secondCall.args[0];
    expect(second.inputs.map((i: any) => [i.udid, i.mjpegPort])).to.deep.equal([
      ['U1', 9100],
      ['U2', 9101],
      ['U3', 9102],
    ]);
    expect(second.outputPath).to.equal(compositeOutputPath(groupId, 2));
    expect(second.outputPath).to.not.equal(compositeOutputPath(groupId));
    expect(second.groupId, 'its own ffmpeg, beside the running one').to.not.equal(groupId);
    // The new part starts first, so the group's side-by-side video has no gap.
    await orch.stop(groupId);
    const stopped = videoPipeline.stopComposite.args.map((a: any[]) => a[0]);
    expect(stopped).to.deep.equal([groupId, second.groupId]);
    expect(
      videoPipeline.stopComposite.firstCall.calledAfter(videoPipeline.startComposite.secondCall),
    ).to.equal(true);

    const ids = [...recordings.map((r) => r.id), recording.id];
    expect(readJson(compositeLayoutPath(groupId, 2))).to.deep.equal({
      version: 1,
      cellW: 540,
      cellH: 960,
      cols: 2,
      rows: 2,
      cells: [
        { index: 0, udid: 'U1', recordingId: ids[0] },
        { index: 1, udid: 'U2', recordingId: ids[1] },
        { index: 2, udid: 'U3', recordingId: ids[2] },
      ],
      startMs: 9800 - 2350,
    });
    // The first part's marks stop where the second part's begin.
    const first = readJson(compositeLayoutPath(groupId));
    expect(first.cells.map((c: any) => c.recordingId)).to.deep.equal(ids.slice(0, 2));
    expect(first.startMs).to.equal(undefined);
    expect(first.endMs).to.equal(9800 - 2350);
  });

  it('leaves out a phone whose recording has ended', async () => {
    const { orch, videoPipeline, exits, store } = makeOrch();
    const { groupId } = await orch.start({ phones: at('U1', 'U2', 'U3'), actorId: 'alice' });
    exits.get('U2')!(0);
    const until = Date.now() + 500;
    while (store.rows[1].status === 'RECORDING' && Date.now() < until) await sleep(5);

    await orch.addDevice(groupId, at('U4')[0], 'alice');

    expect(
      videoPipeline.startComposite.secondCall.args[0].inputs.map((i: any) => i.udid),
    ).to.deep.equal(['U1', 'U3', 'U4']);
    await orch.stop(groupId);
  });

  it('gives a one-phone group its first composite when a second phone joins', async () => {
    const { orch, videoPipeline } = makeOrch({ now: clock(1000, 1100, 5000, 5900) });
    const { groupId, compositeEnabled } = await orch.start({ phones: at('U1'), actorId: 'alice' });
    expect(compositeEnabled).to.equal(false);
    expect(videoPipeline.startComposite.called).to.equal(false);

    await orch.addDevice(groupId, at('U2')[0], 'alice');

    expect(videoPipeline.startComposite.callCount).to.equal(1);
    const first = videoPipeline.startComposite.firstCall.args[0];
    expect(first.groupId).to.equal(groupId);
    expect(first.outputPath).to.equal(compositeOutputPath(groupId));
    expect(first.inputs.map((i: any) => i.udid)).to.deep.equal(['U1', 'U2']);
    // It starts after t=0: its marks shift back by as much.
    expect(readJson(compositeLayoutPath(groupId)).startMs).to.equal(5900 - 1100);
    expect(videoPipeline.stopComposite.called).to.equal(false);

    await orch.stop(groupId);
    expect(videoPipeline.stopComposite.args).to.deep.equal([[groupId]]);
  });

  it('notes a part that ends on its own beside that part alone', async () => {
    const { orch, videoPipeline } = makeOrch();
    const { groupId } = await orch.start({ phones: at('U1', 'U2'), actorId: 'alice' });
    await orch.addDevice(groupId, at('U3')[0], 'alice');

    videoPipeline.startComposite.secondCall.args[0].onExit(1);

    expect(readCompositeEnded(groupId, 2)?.exitCode).to.equal(1);
    expect(readCompositeEnded(groupId), 'the first part was ended by the roll').to.equal(null);
    await orch.stop(groupId);
  });

  it('ends every part once when phones are added at the same time, the last with them all', async () => {
    const { orch, videoPipeline } = makeOrch();
    const { groupId } = await orch.start({ phones: at('U1', 'U2'), actorId: 'alice' });

    await Promise.all([
      orch.addDevice(groupId, at('U3')[0], 'alice'),
      orch.addDevice(groupId, at('U4')[0], 'alice'),
    ]);
    await orch.stop(groupId);

    const starts = videoPipeline.startComposite.args.map((a: any[]) => a[0]);
    expect(starts[starts.length - 1].inputs.map((i: any) => i.udid)).to.have.members([
      'U1',
      'U2',
      'U3',
      'U4',
    ]);
    const stopped = videoPipeline.stopComposite.args.map((a: any[]) => a[0]);
    expect(stopped).to.deep.equal(starts.map((s: any) => s.groupId));
    expect(new Set(starts.map((s: any) => s.outputPath)).size).to.equal(starts.length);
  });

  it('a stop while a new part is starting waits for it, then ends it', async () => {
    const { orch, videoPipeline } = makeOrch();
    const { groupId } = await orch.start({ phones: at('U1', 'U2'), actorId: 'alice' });
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    videoPipeline.startComposite.onSecondCall().callsFake(async (o: any) => {
      await gate;
      return { cellW: 540, cellH: 960, ...compositeGrid(o.inputs.length) };
    });

    const adding = orch.addDevice(groupId, at('U3')[0], 'alice');
    while (videoPipeline.startComposite.callCount < 2) await sleep(2);
    const stopping = orch.stop(groupId);
    await sleep(10);
    expect(videoPipeline.stopComposite.called, 'nothing stopped under the start').to.equal(false);
    open();
    await Promise.all([adding, stopping]);

    const key2 = videoPipeline.startComposite.secondCall.args[0].groupId;
    expect(videoPipeline.stopComposite.args.map((a: any[]) => a[0])).to.deep.equal([groupId, key2]);
  });

  it('keeps the running part when the new one cannot start', async () => {
    const { orch, videoPipeline } = makeOrch();
    const { groupId } = await orch.start({ phones: at('U1', 'U2'), actorId: 'alice' });
    videoPipeline.startComposite.onSecondCall().rejects(new Error('ffmpeg would not start'));

    const out = await orch.addDevice(groupId, at('U3')[0], 'alice');

    expect(out.recording.status).to.equal('RECORDING');
    expect(videoPipeline.stopComposite.called).to.equal(false);
    expect(fs.existsSync(compositeLayoutPath(groupId, 2))).to.equal(false);
    await orch.stop(groupId);
    expect(videoPipeline.stopComposite.args).to.deep.equal([[groupId]]);
  });

  it('keeps the running part when the group would be more than six phones', async () => {
    const { orch, videoPipeline } = makeOrch({ gate: 10 });
    const { groupId } = await orch.start({
      phones: at('U1', 'U2', 'U3', 'U4', 'U5', 'U6'),
      actorId: 'alice',
    });
    await orch.addDevice(groupId, at('U7')[0], 'alice');

    expect(videoPipeline.startComposite.callCount).to.equal(1);
    await orch.stop(groupId);
  });

  it('starts no new part for a group with no add-device', async () => {
    const { orch, videoPipeline } = makeOrch();
    const { groupId } = await orch.start({ phones: at('U1', 'U2'), actorId: 'alice' });
    await orch.stop(groupId);
    expect(videoPipeline.startComposite.callCount).to.equal(1);
    expect(videoPipeline.startComposite.firstCall.args[0].outputPath).to.equal(
      compositeOutputPath(groupId),
    );
    expect(videoPipeline.stopComposite.args).to.deep.equal([[groupId]]);
  });
});

describe('a group composite in parts: the files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-composite-files-'));
  useArtifactStore(root);
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  const write = (file: string, body: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };

  it('names part 1 composite.mp4 and the next ones composite-<n>.mp4, beside it', () => {
    const dir = path.dirname(compositeOutputPath('g'));
    expect(path.basename(compositeOutputPath('g'))).to.equal('composite.mp4');
    expect(compositeOutputPath('g', 2)).to.equal(path.join(dir, 'composite-2.mp4'));
    expect(compositeLayoutPath('g', 2)).to.equal(path.join(dir, 'composite-2.json'));
  });

  it('lists the parts on disk in order, leaving out rendered copies', () => {
    for (const name of [
      'composite.mp4',
      'composite-2.mp4',
      'composite-10.mp4',
      'composite.annotated.mp4',
      'composite-2.annotated.mp4',
      'composite.json',
      'composite-x.mp4',
    ]) {
      write(path.join(path.dirname(compositeOutputPath('g-list')), name), 'x');
    }
    expect(listCompositeParts('g-list')).to.deep.equal([1, 2, 10]);
    expect(listCompositeParts('g-none')).to.deep.equal([]);
  });
});

describe('a group composite in parts: downloads', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-composite-dl-'));
  useArtifactStore(root);
  const GROUP = 'g-parts';
  let restore: () => void;
  let rows: any[];

  const row = (id: string, udid: string) => ({
    id,
    group_id: GROUP,
    device_udid: udid,
    device_host: '127.0.0.1',
    file_path: path.join(root, `${id}.mp4`),
    status: 'STOPPED',
    duration_ms: 1000,
    size_bytes: 10,
    started_at: new Date('2026-11-14T10:00:00Z'),
    ended_at: new Date('2026-11-14T10:00:30Z'),
    device_snapshot: null,
    session_id: null,
    fail_reason: null,
    bookmarks: [],
    annotations: [],
  });
  const layout = (part: number, ids: string[]) =>
    fs.writeFileSync(
      compositeLayoutPath(GROUP, part),
      JSON.stringify({
        version: 1,
        cellW: 540,
        cellH: 960,
        cols: 2,
        rows: 2,
        cells: ids.map((recordingId, index) => ({ index, udid: `U-${recordingId}`, recordingId })),
      }),
    );

  before(() => {
    fs.mkdirSync(path.dirname(compositeOutputPath(GROUP)), { recursive: true });
    fs.writeFileSync(compositeOutputPath(GROUP), 'PART-ONE');
    fs.writeFileSync(compositeOutputPath(GROUP, 2), 'PART-TWO');
    for (const id of ['a', 'b', 'c']) fs.writeFileSync(path.join(root, `${id}.mp4`), `V-${id}`);
  });
  beforeEach(() => {
    restore = saveRegistrations(RecordingStore, ProofBundleService, AnnotationRenderService);
    rows = [row('a', 'U-a'), row('b', 'U-b'), row('c', 'U-c')];
    layout(1, ['a', 'b']);
    layout(2, ['a', 'b', 'c']);
    const store = {
      listGroup: async (g: string) => (g === GROUP ? rows : []),
      findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
      deviceNames: async () => new Map(),
    };
    Container.set(RecordingStore, store as any);
    Container.set(ProofBundleService, new ProofBundleService(store as any));
    Container.set(AnnotationRenderService, {
      resolvePlayablePath: async (id: string) => ({
        filePath: path.join(root, `${id}.mp4`),
        annotated: false,
      }),
      resolveCompositePath: async (g: string, part?: number) => ({
        filePath: compositeOutputPath(g, part),
        annotated: false,
      }),
    } as any);
    sinon
      .stub(deviceService, 'filterRowsByVisibleDevice')
      .callsFake(async (list: any[], teamIds: string[] | undefined, field: any) =>
        teamIds === undefined ? list : list.filter((r) => ['U-a', 'U-b'].includes(r[field])),
      );
    sinon.stub(deviceService, 'rowsWithNoPhone').resolves([]);
  });
  afterEach(() => {
    sinon.restore();
    restore();
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  const zipOf = async (archive: any): Promise<Record<string, string>> => {
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      archive.on('data', (c: Buffer) => chunks.push(c));
      archive.on('end', resolve);
      archive.on('error', reject);
    });
    const dir = await unzipper.Open.buffer(Buffer.concat(chunks));
    const out: Record<string, string> = {};
    for (const f of dir.files) out[f.path] = (await f.buffer()).toString('utf8');
    return out;
  };

  it('puts every part in the videos zip, in order', async () => {
    const zip = await zipOf(await Container.get(ProofBundleService).buildVideosZip(GROUP));
    const parts = Object.keys(zip).filter((n) => n.startsWith('composite'));
    expect(parts).to.deep.equal(['composite.mp4', 'composite-2.mp4']);
    expect(zip['composite-2.mp4']).to.equal('PART-TWO');
  });

  it('puts every part in the proof bundle, and says what each one is', async () => {
    fs.writeFileSync(
      path.join(path.dirname(compositeOutputPath(GROUP)), 'composite-2-ended.json'),
      JSON.stringify({ version: 1, exitCode: 1, endedAt: '2026-11-14T10:00:20.000Z' }),
    );
    try {
      const zip = await zipOf(Container.get(ProofBundleService).streamBundleZip(GROUP));
      expect(zip['composite.mp4']).to.equal('PART-ONE');
      expect(zip['composite-2.mp4']).to.equal('PART-TWO');
      const manifest = JSON.parse(zip['manifest.json']);
      expect(manifest.composite.endedEarly).to.equal(true);
      expect(manifest.compositeParts).to.deep.equal([
        { file: 'composite.mp4', endedEarly: false },
        {
          file: 'composite-2.mp4',
          endedEarly: true,
          exitCode: 1,
          endedAt: '2026-11-14T10:00:20.000Z',
        },
      ]);
      expect(zip['README.md']).to.include('composite.mp4, then composite-2.mp4');
      expect(zip['README.md']).to.include('composite-2.mp4 ended on its own');
    } finally {
      fs.rmSync(path.join(path.dirname(compositeOutputPath(GROUP)), 'composite-2-ended.json'));
    }
  });

  it('leaves out a part showing a phone the caller cannot see', async () => {
    const zip = await zipOf(
      await Container.get(ProofBundleService).buildVideosZip(GROUP, ['a', 'b']),
    );
    expect(Object.keys(zip).filter((n) => n.startsWith('composite'))).to.deep.equal([
      'composite.mp4',
    ]);
  });

  function buildApp(role: 'ADMIN' | 'MEMBER') {
    const app = express();
    const api = express.Router();
    api.use((req, _res, next) => {
      (req as any).auth = {
        kind: 'user-session',
        userId: `usr_${role}`,
        role,
        scopes: scopesForRole(role),
        teamIds: role === 'ADMIN' ? undefined : ['t1'],
        rateLimit: 100,
      };
      next();
    });
    RecordingsRouter.register(api);
    app.use('/xenon/api', api);
    return app;
  }
  const getText = (role: 'ADMIN' | 'MEMBER', url: string) =>
    request(buildApp(role))
      .get(`/xenon/api/recordings/${GROUP}/${url}`)
      .buffer(true)
      .parse((res: any, cb: any) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
      });

  it('serves a part by number from composite.mp4, part 1 without one', async () => {
    expect((await getText('ADMIN', 'composite.mp4')).body).to.equal('PART-ONE');
    expect((await getText('ADMIN', 'composite.mp4?part=1')).body).to.equal('PART-ONE');
    expect((await getText('ADMIN', 'composite.mp4?part=2')).body).to.equal('PART-TWO');
  });

  it('404s a part the group does not have, or one with a phone the caller cannot see', async () => {
    expect((await getText('ADMIN', 'composite.mp4?part=3')).status).to.equal(404);
    expect((await getText('MEMBER', 'composite.mp4?part=2')).status).to.equal(404);
    expect((await getText('MEMBER', 'composite.mp4?part=1')).status).to.equal(200);
  });

  it('refuses a part that is not a number', async () => {
    for (const bad of ['0', 'x', '-1', '1.5', '2&part=3']) {
      const res = await getText('ADMIN', `composite.mp4?part=${bad}`);
      expect(res.status, bad).to.equal(400);
      expect(JSON.parse(res.body).error).to.equal('invalid_part');
    }
  });
});

describe('AnnotationRenderService: marks in a later composite part', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-composite-marks-'));
  useArtifactStore(root);
  afterEach(() => sinon.restore());
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  const GROUP = 'g-marks';
  const box = JSON.stringify({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
  const video = path.join(root, 'rec-a.mp4');
  const store = {
    listGroup: async () => [
      {
        id: 'rec-a',
        file_path: video,
        annotations: [
          // Group time 3 s to 4 s: in the first part only.
          { id: 'early', shape: 'RECT', geometry: box, timecode_ms: 3000, end_timecode_ms: 4000 },
          // Group time 9 s to 9.5 s: in the second part, which starts at 7 s.
          { id: 'late', shape: 'RECT', geometry: box, timecode_ms: 9000, end_timecode_ms: 9500 },
        ],
      },
    ],
  };
  const writePart = (part: number, extra: Record<string, number>) => {
    const file = compositeOutputPath(GROUP, part);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `part-${part}`);
    fs.writeFileSync(
      compositeLayoutPath(GROUP, part),
      JSON.stringify({
        version: 1,
        cellW: 540,
        cellH: 960,
        cols: 2,
        rows: 1,
        cells: [{ index: 0, udid: 'U1', recordingId: 'rec-a' }],
        ...extra,
      }),
    );
  };
  const windowsOf = async (part: number) => {
    fs.writeFileSync(video, 'x');
    const svc = new AnnotationRenderService(store as any);
    sinon.stub(svc as any, 'probeDurationSec').resolves(30);
    sinon.stub(svc as any, 'probeFrameSize').resolves({ w: 540, h: 960 });
    const runGraph = sinon.stub(svc as any, 'runGraph').callsFake(async (...args: any[]) => {
      fs.writeFileSync(args[1], 'rendered');
    });
    const out = await svc.resolveCompositePath(GROUP, part);
    const graph = runGraph.firstCall?.args[2]?.graph ?? '';
    return { out, windows: graph.match(/enable='[^']*'/g) ?? [] };
  };

  it("shifts a later part's marks back by its start, and keeps each mark to its own part", async () => {
    writePart(1, { endMs: 7000 });
    writePart(2, { startMs: 7000 });

    const second = await windowsOf(2);
    expect(second.out.filePath).to.equal(
      path.join(path.dirname(compositeOutputPath(GROUP)), 'composite-2.annotated.mp4'),
    );
    expect([...new Set(second.windows)]).to.deep.equal(["enable='gte(t\\,2)*lt(t\\,2.5)'"]);

    sinon.restore();
    const first = await windowsOf(1);
    expect([...new Set(first.windows)]).to.deep.equal(["enable='gte(t\\,3)*lt(t\\,4)'"]);
  });

  it('serves a later part without marks when its start is not known', async () => {
    writePart(3, {});
    const { out } = await windowsOf(3);
    expect(out).to.deep.equal({ filePath: compositeOutputPath(GROUP, 3), annotated: false });
  });
});
