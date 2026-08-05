import 'reflect-metadata';
import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as unzipper from 'unzipper';
import { ProofBundleService } from '../../src/services/recording/proof-bundle';

describe('ProofBundleService.streamBundleZip', () => {
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
