import 'reflect-metadata';
import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as unzipper from 'unzipper';
import sinon from 'sinon';
import { ProofBundleService } from '../../src/services/recording/proof-bundle';
import { AnnotationRenderService } from '../../src/services/recording/annotation-render';
import {
  compositeEndedPath,
  compositeOutputPath,
} from '../../src/services/recording/RecordingOrchestrator';
import { useArtifactStore } from '../helpers/artifact-store';

describe('ProofBundleService.streamBundleZip', () => {
  // The bundle looks up the composite path through ARTIFACT_STORE.
  useArtifactStore();
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-test-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('produces a zip with manifest, README, and per-device folders', async () => {
    const fakeMp4 = path.join(tmp, 'src.mp4');
    fs.writeFileSync(fakeMp4, 'FAKEMP4');
    const store = {
      listGroup: async () => [
        {
          id: 'r-1',
          group_id: 'grp-1',
          device_udid: 'U1',
          device_host: '127.0.0.1',
          file_path: fakeMp4,
          status: 'STOPPED',
          duration_ms: 5000,
          size_bytes: 7,
          started_at: new Date('2026-04-27T10:00:00Z'),
          ended_at: new Date('2026-04-27T10:00:05Z'),
          device_snapshot: null,
          session_id: null,
          fail_reason: null,
          bookmarks: [{ label: 'bug here', timecode_ms: 1000, note: 'first repro' }],
          annotations: [],
        },
      ],
    };
    const svc = new ProofBundleService(store as any);
    const outZip = path.join(tmp, 'out.zip');
    await new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream(outZip);
      svc.streamBundleZip('grp-1').pipe(ws).on('finish', () => resolve()).on('error', reject);
    });
    const dir = await unzipper.Open.file(outZip);
    const names = dir.files.map((f: any) => f.path).sort();
    expect(names).to.include('manifest.json');
    expect(names).to.include('README.md');
    expect(names).to.include('devices/U1/video.mp4');
    expect(names).to.include('devices/U1/bookmarks.json');
    expect(names).to.include('devices/U1/annotations.json');
    expect(names).to.include('devices/U1/device.json');
  });

  it('omits video.mp4 when file_path does not exist on disk', async () => {
    const store = {
      listGroup: async () => [
        {
          id: 'r-2',
          group_id: 'grp-2',
          device_udid: 'U2',
          device_host: '127.0.0.1',
          file_path: '/path/that/does/not/exist.mp4',
          status: 'FAILED',
          duration_ms: 0,
          size_bytes: 0,
          started_at: new Date(),
          ended_at: new Date(),
          device_snapshot: null,
          session_id: null,
          fail_reason: 'device_disconnected',
          bookmarks: [],
          annotations: [],
        },
      ],
    };
    const svc = new ProofBundleService(store as any);
    const outZip = path.join(tmp, 'out2.zip');
    await new Promise<void>((resolve, reject) => {
      svc
        .streamBundleZip('grp-2')
        .pipe(fs.createWriteStream(outZip))
        .on('finish', () => resolve())
        .on('error', reject);
    });
    const dir = await unzipper.Open.file(outZip);
    const names = dir.files.map((f: any) => f.path);
    expect(names).to.not.include('devices/U2/video.mp4');
    expect(names).to.include('devices/U2/device.json');
  });

  it('manifest.json carries all devices with correct shape', async () => {
    const store = {
      listGroup: async () => [
        {
          id: 'r-A',
          group_id: 'grp-3',
          device_udid: 'U-A',
          device_host: '127.0.0.1',
          file_path: '/tmp/a.mp4',
          status: 'STOPPED',
          duration_ms: 1000,
          size_bytes: 50,
          started_at: new Date(),
          ended_at: new Date(),
          device_snapshot: null,
          session_id: null,
          fail_reason: null,
          bookmarks: [],
          annotations: [],
        },
        {
          id: 'r-B',
          group_id: 'grp-3',
          device_udid: 'U-B',
          device_host: '127.0.0.1',
          file_path: '/tmp/b.mp4',
          status: 'STOPPED',
          duration_ms: 2000,
          size_bytes: 100,
          started_at: new Date(),
          ended_at: new Date(),
          device_snapshot: null,
          session_id: null,
          fail_reason: null,
          bookmarks: [],
          annotations: [],
        },
      ],
    };
    const svc = new ProofBundleService(store as any);
    const outZip = path.join(tmp, 'out3.zip');
    await new Promise<void>((resolve, reject) => {
      svc
        .streamBundleZip('grp-3')
        .pipe(fs.createWriteStream(outZip))
        .on('finish', () => resolve())
        .on('error', reject);
    });
    const dir = await unzipper.Open.file(outZip);
    const manifestEntry = dir.files.find((f: any) => f.path === 'manifest.json');
    expect(manifestEntry).to.exist;
    const buf = await manifestEntry!.buffer();
    const manifest = JSON.parse(buf.toString('utf8'));
    expect(manifest.groupId).to.equal('grp-3');
    expect(manifest.devices).to.have.length(2);
    expect(manifest.devices[0].udid).to.equal('U-A');
  });
});

describe('ProofBundleService.buildVideosZip', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'videos-zip-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('zips only mp4 files with udid filenames (no JSON extras)', async () => {
    const a = path.join(tmp, 'a.mp4');
    const b = path.join(tmp, 'b.mp4');
    fs.writeFileSync(a, 'AAAA');
    fs.writeFileSync(b, 'BBBB');
    const store = {
      listGroup: async () => [
        {
          id: 'r1',
          device_udid: 'device-A',
          file_path: a,
          bookmarks: [],
          annotations: [],
        },
        {
          id: 'r2',
          device_udid: 'device-B',
          file_path: b,
          bookmarks: [],
          annotations: [],
        },
      ],
    };
    const svc = new ProofBundleService(store as any);
    const outZip = path.join(tmp, 'videos.zip');
    await new Promise<void>((resolve, reject) => {
      svc
        .buildVideosZip('g')
        .then((archive) => {
          archive.pipe(fs.createWriteStream(outZip)).on('finish', () => resolve()).on('error', reject);
        })
        .catch(reject);
    });
    const dir = await unzipper.Open.file(outZip);
    const names = dir.files.map((f: any) => f.path).sort();
    expect(names).to.deep.equal(['device-A.mp4', 'device-B.mp4']);
    expect(names.some((n: string) => n.endsWith('.json'))).to.equal(false);
  });

  it('throws no_videos when nothing is on disk', async () => {
    const store = {
      listGroup: async () => [
        { id: 'r1', device_udid: 'U', file_path: '/missing/x.mp4', bookmarks: [], annotations: [] },
      ],
    };
    const svc = new ProofBundleService(store as any);
    try {
      await svc.buildVideosZip('g');
      expect.fail('expected throw');
    } catch (e: any) {
      expect(e.message).to.equal('no_videos');
    }
  });

  it('resolveVideoFile returns the sole playable file', async () => {
    const a = path.join(tmp, 'only.mp4');
    fs.writeFileSync(a, 'VIDEO');
    const store = {
      listGroup: async () => [
        { id: 'r1', device_udid: 'solo-device', file_path: a },
      ],
    };
    const svc = new ProofBundleService(store as any);
    const hit = await svc.resolveVideoFile('g');
    expect(hit?.downloadName).to.equal('solo-device.mp4');
    expect(hit?.filePath).to.equal(a);
  });
});

describe('ProofBundleService — the composite that downloads get', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'composite-dl-'));
  useArtifactStore(root);
  let annotated: string;
  const store = { listGroup: async () => [] };

  beforeEach(() => {
    const raw = compositeOutputPath('g1');
    fs.mkdirSync(path.dirname(raw), { recursive: true });
    fs.writeFileSync(raw, 'RAW-COMPOSITE');
    annotated = path.join(path.dirname(raw), 'composite.annotated.mp4');
    fs.writeFileSync(annotated, 'MARKED-COMPOSITE');
  });
  afterEach(() => sinon.restore());
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  const zipEntry = async (zipFile: string, name: string) => {
    const dir = await unzipper.Open.file(zipFile);
    const f = dir.files.find((e: any) => e.path === name);
    return f ? (await f.buffer()).toString() : undefined;
  };

  it('serves the composite with marks when the render succeeds', async () => {
    sinon
      .stub(AnnotationRenderService.prototype, 'resolveCompositePath')
      .resolves({ filePath: annotated, annotated: true });
    expect(await new ProofBundleService(store as any).resolveCompositeFile('g1')).to.equal(
      annotated,
    );
  });

  it('falls back to the raw composite when the render fails', async () => {
    sinon
      .stub(AnnotationRenderService.prototype, 'resolveCompositePath')
      .rejects(new Error('boom'));
    expect(await new ProofBundleService(store as any).resolveCompositeFile('g1')).to.equal(
      compositeOutputPath('g1'),
    );
  });

  it('returns null when the group has no composite', async () => {
    expect(await new ProofBundleService(store as any).resolveCompositeFile('g-none')).to.equal(
      null,
    );
  });

  it('puts the marked composite in videos.zip and bundle.zip', async () => {
    sinon
      .stub(AnnotationRenderService.prototype, 'resolveCompositePath')
      .resolves({ filePath: annotated, annotated: true });
    const svc = new ProofBundleService(store as any);
    const videos = path.join(root, 'videos.zip');
    const archive = await svc.buildVideosZip('g1');
    await new Promise<void>((resolve, reject) => {
      archive
        .pipe(fs.createWriteStream(videos))
        .on('finish', () => resolve())
        .on('error', reject);
    });
    expect(await zipEntry(videos, 'composite.mp4')).to.equal('MARKED-COMPOSITE');

    const bundle = path.join(root, 'bundle.zip');
    await new Promise<void>((resolve, reject) => {
      svc
        .streamBundleZip('g1')
        .pipe(fs.createWriteStream(bundle))
        .on('finish', () => resolve())
        .on('error', reject);
    });
    expect(await zipEntry(bundle, 'composite.mp4')).to.equal('MARKED-COMPOSITE');
  });
});

// Through 2.36 a composite whose ffmpeg ended on its own while the group
// recorded was served as if it covered the whole group, and the group's
// summaries offered one by the file's existence alone, an empty one included,
// which the download then refused.
describe('ProofBundleService — a composite that ended on its own', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'composite-ended-'));
  useArtifactStore(root);
  const store = { listGroup: async () => [] };

  beforeEach(() => {
    const raw = compositeOutputPath('g-ended');
    fs.mkdirSync(path.dirname(raw), { recursive: true });
    fs.writeFileSync(raw, 'PARTIAL-COMPOSITE');
    sinon.stub(AnnotationRenderService.prototype, 'resolveCompositePath').rejects(new Error('no'));
  });
  afterEach(() => {
    sinon.restore();
    fs.rmSync(path.dirname(compositeOutputPath('g-ended')), { recursive: true, force: true });
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  const bundleOf = async (groupId: string) => {
    const out = path.join(root, `${groupId}.zip`);
    await new Promise<void>((resolve, reject) => {
      new ProofBundleService(store as any)
        .streamBundleZip(groupId)
        .pipe(fs.createWriteStream(out))
        .on('finish', () => resolve())
        .on('error', reject);
    });
    const dir = await unzipper.Open.file(out);
    const read = async (name: string) => {
      const f = dir.files.find((e: any) => e.path === name);
      return f ? (await f.buffer()).toString() : undefined;
    };
    return {
      manifest: JSON.parse((await read('manifest.json'))!),
      readme: (await read('README.md'))!,
      composite: await read('composite.mp4'),
    };
  };

  it('says in the manifest and README that the composite stops early, and still carries it', async () => {
    fs.writeFileSync(
      compositeEndedPath('g-ended'),
      JSON.stringify({ version: 1, exitCode: 1, endedAt: '2026-11-14T10:00:05.000Z' }),
    );

    const { manifest, readme, composite } = await bundleOf('g-ended');

    expect(composite).to.equal('PARTIAL-COMPOSITE');
    expect(manifest.composite).to.deep.equal({
      endedEarly: true,
      exitCode: 1,
      endedAt: '2026-11-14T10:00:05.000Z',
    });
    expect(readme).to.match(/composite.*ended on its own at 2026-11-14T10:00:05\.000Z/i);
  });

  it('says a composite that ran to the stop did', async () => {
    const { manifest, readme } = await bundleOf('g-ended');

    expect(manifest.composite).to.deep.equal({ endedEarly: false });
    expect(readme).not.to.match(/ended on its own/);
  });

  it('says nothing of a composite the bundle has none of', async () => {
    const { manifest } = await bundleOf('g-none');
    expect(manifest).not.to.have.property('composite');
  });

  it('hasCompositeFile: a file with something in it, never an empty one or none', () => {
    const svc = new ProofBundleService(store as any);
    expect(svc.hasCompositeFile('g-ended')).to.equal(true);

    fs.writeFileSync(compositeOutputPath('g-ended'), '');
    expect(svc.hasCompositeFile('g-ended'), 'empty: the download would refuse it').to.equal(false);
    expect(svc.hasCompositeFile('g-none')).to.equal(false);
  });
});

describe('ProofBundleService with two phones two servers name alike', () => {
  useArtifactStore();
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-host-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const rowOf = (id: string, udid: string, host: string, file: string) => ({
    id,
    group_id: 'g-dup',
    device_udid: udid,
    device_host: host,
    file_path: file,
    status: 'STOPPED',
    duration_ms: 1000,
    size_bytes: 4,
    started_at: new Date(),
    ended_at: new Date(),
    device_snapshot: null,
    session_id: null,
    fail_reason: null,
    bookmarks: [],
    annotations: [],
  });

  function storeOf() {
    const hub = path.join(tmp, 'hub.mp4');
    const node = path.join(tmp, 'node.mp4');
    const other = path.join(tmp, 'other.mp4');
    fs.writeFileSync(hub, 'HUB');
    fs.writeFileSync(node, 'NODE');
    fs.writeFileSync(other, 'OTHER');
    return {
      listGroup: async () => [
        rowOf('r-hub', 'emulator-5554', 'http://hub.test:4723', hub),
        rowOf('r-node', 'emulator-5554', 'http://node.test:4723', node),
        rowOf('r-other', 'R58M', '127.0.0.1', other),
      ],
    };
  }

  async function names(archive: NodeJS.ReadableStream, file: string): Promise<string[]> {
    const out = path.join(tmp, file);
    await new Promise<void>((resolve, reject) => {
      archive
        .pipe(fs.createWriteStream(out))
        .on('finish', () => resolve())
        .on('error', reject);
    });
    const dir = await unzipper.Open.file(out);
    return dir.files.map((f: any) => f.path).sort();
  }

  it('videos.zip carries both, each named with its host; a unique udid keeps its name', async () => {
    const svc = new ProofBundleService(storeOf() as any);
    expect(await names(await svc.buildVideosZip('g-dup'), 'videos.zip')).to.deep.equal([
      'R58M.mp4',
      'emulator-5554@hub.test-4723.mp4',
      'emulator-5554@node.test-4723.mp4',
    ]);
  });

  it('bundle.zip carries both folders, each with its video and device.json', async () => {
    const svc = new ProofBundleService(storeOf() as any);
    const got = await names(svc.streamBundleZip('g-dup'), 'bundle.zip');
    for (const dir of [
      'devices/emulator-5554@hub.test-4723',
      'devices/emulator-5554@node.test-4723',
      'devices/R58M',
    ]) {
      expect(got).to.include(`${dir}/video.mp4`);
      expect(got).to.include(`${dir}/device.json`);
      expect(got).to.include(`${dir}/bookmarks.json`);
    }
  });
});
