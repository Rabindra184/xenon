import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from '../helpers/loopbackRequest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as unzipper from 'unzipper';
import { Container } from 'typedi';
import RecordingsRouter from '../../src/app/routers/recordings';
import * as deviceService from '../../src/data-service/device-service';
import { RecordingStore } from '../../src/services/recording/recording-store';
import { ProofBundleService } from '../../src/services/recording/proof-bundle';
import { AnnotationRenderService } from '../../src/services/recording/annotation-render';
import {
  compositeOutputPath,
  compositeLayoutPath,
} from '../../src/services/recording/RecordingOrchestrator';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import { useArtifactStore } from '../helpers/artifact-store';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * A recording group can mix phones from several teams: an admin records
 * phones from more than one team, or a phone moves team after it was
 * recorded. The downloads used to check only that the caller could see *one*
 * phone of the group, then serve every phone. Each download must now carry
 * only the phones the caller can see, and the composite (which shows every
 * phone) only to a caller who can see them all.
 */

type Caller = { userId: string; role: 'MEMBER' | 'ADMIN'; teamIds?: string[] };

const MEMBER: Caller = { userId: 'usr_member', role: 'MEMBER', teamIds: ['t1'] };
const ADMIN: Caller = { userId: 'usr_admin', role: 'ADMIN' };

const GROUP = 'g1';
const A_BYTES = 'AAAA-video-of-phone-a';
const B_BYTES = 'BBBB-video-of-phone-b';
const C_BYTES = 'CCCC-video-of-phone-c';
const COMPOSITE_BYTES = 'MMMM-composite-of-a-and-b';
/** What src/app/index.ts sets on every /xenon/api response. */
const API_CACHE_CONTROL = 'no-store, no-cache, must-revalidate, proxy-revalidate';

function buildApp(caller: Caller) {
  const app = express();
  app.use(express.json());
  const apiRouter = express.Router();
  apiRouter.use((_req, res, next) => {
    res.setHeader('Cache-Control', API_CACHE_CONTROL);
    next();
  });
  apiRouter.use((req, _res, next) => {
    (req as any).auth = {
      kind: 'user-session',
      userId: caller.userId,
      role: caller.role,
      scopes: scopesForRole(caller.role),
      teamIds: caller.teamIds,
      rateLimit: 100,
    };
    next();
  });
  RecordingsRouter.register(apiRouter);
  app.use('/xenon/api', apiRouter);
  return app;
}

/** Collect any response body as raw bytes, whatever its content type. */
function binary(res: any, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

async function get(caller: Caller, url: string, headers: Record<string, string> = {}) {
  let req = request(buildApp(caller)).get(`/xenon/api/recordings/${GROUP}/${url}`);
  for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
  const res = await req.buffer(true).parse(binary);
  const body = res.body as Buffer;
  return {
    status: res.status,
    headers: res.headers,
    body,
    json: () => JSON.parse(body.toString('utf8')),
  };
}

async function zipNames(buf: Buffer): Promise<string[]> {
  const dir = await unzipper.Open.buffer(buf);
  return dir.files.map((f: any) => f.path).sort();
}

async function zipText(buf: Buffer, name: string): Promise<string | undefined> {
  const dir = await unzipper.Open.buffer(buf);
  const f = dir.files.find((e: any) => e.path === name);
  return f ? (await f.buffer()).toString('utf8') : undefined;
}

describe('recording downloads serve only the phones the caller can see', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-dl-vis-'));
  // compositeOutputPath resolves through ARTIFACT_STORE.
  useArtifactStore(root);

  const files: Record<string, string> = {};
  let composite: string;
  /** Udids the member's team can see; an admin sees everything. */
  let memberSees: string[];
  /** Udids that still have a Device row: an unplugged phone's is deleted. */
  let existing: string[];
  /** The group's rows as the store returns them now. */
  let rows: any[];
  let listGroup: sinon.SinonSpy;
  let restoreRegistrations: () => void;

  /**
   * composite.json, as the orchestrator writes it when the composite starts:
   * which recording sits in which cell. `null` removes it, like a composite
   * recorded before the layout file existed.
   */
  const writeLayout = (cells: Array<[string, string]> | null) => {
    const file = compositeLayoutPath(GROUP);
    if (cells === null) {
      fs.rmSync(file, { force: true });
      return;
    }
    const layout = {
      version: 1,
      cellW: 360,
      cellH: 640,
      cols: cells.length,
      rows: 1,
      cells: cells.map(([recordingId, udid], index) => ({ index, udid, recordingId })),
    };
    fs.writeFileSync(file, JSON.stringify(layout));
  };

  const row = (id: string, udid: string) => ({
    id,
    group_id: GROUP,
    device_udid: udid,
    device_host: `host-of-${udid}`,
    file_path: files[id],
    status: 'STOPPED',
    duration_ms: 1000,
    size_bytes: 21,
    started_at: new Date('2026-09-27T10:00:00Z'),
    ended_at: new Date('2026-09-27T10:00:01Z'),
    device_snapshot: null,
    session_id: `session-of-${udid}`,
    fail_reason: null,
    bookmarks: [{ label: `mark on ${udid}`, timecode_ms: 500, note: null }],
    annotations: [],
  });

  before(() => {
    files['r-a'] = path.join(root, 'a.mp4');
    files['r-b'] = path.join(root, 'b.mp4');
    files['r-c'] = path.join(root, 'c.mp4');
    fs.writeFileSync(files['r-a'], A_BYTES);
    fs.writeFileSync(files['r-b'], B_BYTES);
    fs.writeFileSync(files['r-c'], C_BYTES);
    composite = compositeOutputPath(GROUP);
    fs.mkdirSync(path.dirname(composite), { recursive: true });
    fs.writeFileSync(composite, COMPOSITE_BYTES);
  });

  beforeEach(() => {
    restoreRegistrations = saveRegistrations(
      RecordingStore,
      ProofBundleService,
      AnnotationRenderService,
    );
    memberSees = ['U-A'];
    existing = ['U-A', 'U-B', 'U-C'];
    rows = [row('r-a', 'U-A'), row('r-b', 'U-B')];
    writeLayout([
      ['r-a', 'U-A'],
      ['r-b', 'U-B'],
    ]);
    // The routes' visibility check and ProofBundleService both read the group
    // through this store; `prisma.recording` itself cannot be stubbed (it is
    // not one of the wrapped delegates in src/prisma.ts).
    listGroup = sinon.spy(async (groupId: string) => (groupId === GROUP ? rows : []));
    const store = {
      listGroup,
      findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
      deviceNames: async (udids: string[]) =>
        new Map(
          udids.filter((u) => existing.includes(u)).map((u) => [u, { name: u, platform: null }]),
        ),
    };
    Container.set(RecordingStore, store as any);
    Container.set(ProofBundleService, new ProofBundleService(store as any));
    Container.set(AnnotationRenderService, {
      resolvePlayablePath: async (id: string) => ({ filePath: files[id], annotated: false }),
      resolveCompositePath: async () => ({ filePath: composite, annotated: false }),
    } as any);

    sinon
      .stub(deviceService, 'filterRowsByVisibleDevice')
      .callsFake(async (rows: any[], teamIds: string[] | undefined, field: any) =>
        teamIds === undefined ? rows : rows.filter((r) => memberSees.includes(r[field])),
      );
  });

  afterEach(() => {
    sinon.restore();
    // Put back what each service was registered as before this test. A
    // blanket Container.reset() would also wipe the ARTIFACT_STORE that
    // useArtifactStore() registers once for this whole describe.
    restoreRegistrations();
  });

  after(() => fs.rmSync(root, { recursive: true, force: true }));

  describe('a member who sees only U-A', () => {
    it("404s video.mp4 for another team's phone", async () => {
      const res = await get(MEMBER, 'video.mp4?udid=U-B');
      expect(res.status).to.equal(404);
      expect(res.body.toString('utf8')).to.not.include(B_BYTES);
      expect(res.json().error).to.equal('video_not_found');
    });

    it('serves the one visible phone from video.mp4 without a udid', async () => {
      const res = await get(MEMBER, 'video.mp4');
      expect(res.status).to.equal(200);
      expect(res.body.toString('utf8')).to.equal(A_BYTES);
      expect(res.headers['content-type']).to.match(/^video\/mp4/);
      expect(res.headers['content-disposition']).to.equal('attachment; filename="U-A.mp4"');
    });

    it('puts only U-A in videos.zip, and no composite', async () => {
      const res = await get(MEMBER, 'videos.zip');
      expect(res.status).to.equal(200);
      expect(await zipNames(res.body)).to.deep.equal(['U-A.mp4']);
      expect(await zipText(res.body, 'U-A.mp4')).to.equal(A_BYTES);
    });

    it('puts only U-A in bundle.zip: files, manifest and README', async () => {
      const res = await get(MEMBER, 'bundle.zip');
      expect(res.status).to.equal(200);
      const names = await zipNames(res.body);
      const deviceEntries = names.filter((n) => n.startsWith('devices/'));
      expect(deviceEntries).to.have.length.greaterThan(0);
      expect(deviceEntries.every((n) => n.startsWith('devices/U-A/'))).to.equal(true);
      expect(names).to.not.include('composite.mp4');
      const manifest = JSON.parse(String(await zipText(res.body, 'manifest.json')));
      expect(manifest.devices.map((d: any) => d.udid)).to.deep.equal(['U-A']);
      const readme = String(await zipText(res.body, 'README.md'));
      expect(readme).to.include('U-A');
      expect(readme).to.not.include('U-B');
    });

    it('404s composite.mp4, which shows every phone', async () => {
      const res = await get(MEMBER, 'composite.mp4');
      expect(res.status).to.equal(404);
      expect(res.json()).to.deep.equal({ error: 'composite_not_found' });
    });
  });

  describe('an admin', () => {
    it('gets composite.mp4', async () => {
      const res = await get(ADMIN, 'composite.mp4');
      expect(res.status).to.equal(200);
      expect(res.body.toString('utf8')).to.equal(COMPOSITE_BYTES);
    });

    it('gets every phone and the composite in videos.zip', async () => {
      const res = await get(ADMIN, 'videos.zip');
      expect(res.status).to.equal(200);
      expect(await zipNames(res.body)).to.deep.equal(['U-A.mp4', 'U-B.mp4', 'composite.mp4']);
    });

    it('gets every phone and the composite in bundle.zip', async () => {
      const res = await get(ADMIN, 'bundle.zip');
      expect(res.status).to.equal(200);
      const names = await zipNames(res.body);
      expect(names).to.include.members([
        'composite.mp4',
        'devices/U-A/video.mp4',
        'devices/U-B/video.mp4',
      ]);
    });

    it("gets any phone's video.mp4", async () => {
      const res = await get(ADMIN, 'video.mp4?udid=U-B');
      expect(res.status).to.equal(200);
      expect(res.body.toString('utf8')).to.equal(B_BYTES);
    });
  });

  describe('a member who sees every phone in the composite', () => {
    beforeEach(() => {
      memberSees = ['U-A', 'U-B'];
    });

    it('gets composite.mp4', async () => {
      const res = await get(MEMBER, 'composite.mp4');
      expect(res.status).to.equal(200);
      expect(res.body.toString('utf8')).to.equal(COMPOSITE_BYTES);
    });

    it('gets the composite in videos.zip and bundle.zip', async () => {
      const videos = await get(MEMBER, 'videos.zip');
      expect(await zipNames(videos.body)).to.deep.equal(['U-A.mp4', 'U-B.mp4', 'composite.mp4']);
      const bundle = await get(MEMBER, 'bundle.zip');
      expect(await zipText(bundle.body, 'composite.mp4')).to.equal(COMPOSITE_BYTES);
    });
  });

  // Retention purges rows one at a time while the composite lives on, and a
  // phone added to a running recording never joins the composite. Seeing
  // every row that is left is not seeing every phone the composite shows.
  describe('a group whose composite shows a phone that has no row any more', () => {
    beforeEach(() => {
      // The composite has cells for r-a and r-b; r-b's row was purged, and
      // r-c was added to the recording after the composite started.
      rows = [row('r-a', 'U-A'), row('r-c', 'U-C')];
      memberSees = ['U-A', 'U-C'];
    });

    it('404s composite.mp4 for a member who sees every row that is left', async () => {
      const res = await get(MEMBER, 'composite.mp4');
      expect(res.status).to.equal(404);
      expect(res.json()).to.deep.equal({ error: 'composite_not_found' });
    });

    it('leaves the composite out of videos.zip and bundle.zip', async () => {
      const videos = await get(MEMBER, 'videos.zip');
      expect(await zipNames(videos.body)).to.deep.equal(['U-A.mp4', 'U-C.mp4']);
      const bundle = await get(MEMBER, 'bundle.zip');
      expect(await zipNames(bundle.body)).to.not.include('composite.mp4');
    });

    it('still gives an admin the composite', async () => {
      const res = await get(ADMIN, 'composite.mp4');
      expect(res.status).to.equal(200);
    });
  });

  // composite.json arrived on 2026-09-26. Without it there is no telling
  // which phones a composite shows, so only an admin gets one.
  describe('a composite without a layout file', () => {
    beforeEach(() => {
      writeLayout(null);
      memberSees = ['U-A', 'U-B'];
    });

    it('denies a member even when they see every row', async () => {
      expect((await get(MEMBER, 'composite.mp4')).status).to.equal(404);
      const videos = await get(MEMBER, 'videos.zip');
      expect(await zipNames(videos.body)).to.deep.equal(['U-A.mp4', 'U-B.mp4']);
      const bundle = await get(MEMBER, 'bundle.zip');
      expect(await zipNames(bundle.body)).to.not.include('composite.mp4');
    });

    it('still gives an admin the composite', async () => {
      const res = await get(ADMIN, 'composite.mp4');
      expect(res.status).to.equal(200);
      expect(res.body.toString('utf8')).to.equal(COMPOSITE_BYTES);
      const videos = await get(ADMIN, 'videos.zip');
      expect(await zipNames(videos.body)).to.include('composite.mp4');
    });

    it('denies a member when the layout file cannot be read', async () => {
      fs.writeFileSync(compositeLayoutPath(GROUP), 'not json');
      memberSees = ['U-A', 'U-B'];
      expect((await get(MEMBER, 'composite.mp4')).status).to.equal(404);
      const videos = await get(MEMBER, 'videos.zip');
      expect(await zipNames(videos.body)).to.deep.equal(['U-A.mp4', 'U-B.mp4']);
    });
  });

  // The person who recorded a group also sees its phones that were unplugged
  // since (their Device row is gone), and nothing more: a phone that moved to
  // another team is still that team's, and so is the composite showing it.
  describe('the member who recorded the group', () => {
    const owned = (id: string, udid: string) => ({ ...row(id, udid), started_by: MEMBER.userId });
    beforeEach(() => {
      rows = [owned('r-a', 'U-A'), owned('r-b', 'U-B')];
    });

    it('gets no phone that is on another team, and no composite showing it', async () => {
      expect((await get(MEMBER, 'video.mp4?udid=U-B')).status).to.equal(404);
      expect((await get(MEMBER, 'composite.mp4')).status).to.equal(404);
      const videos = await get(MEMBER, 'videos.zip');
      expect(await zipNames(videos.body)).to.deep.equal(['U-A.mp4']);
    });

    it('gets no unplugged phone that someone else added, and no composite', async () => {
      rows = [owned('r-a', 'U-A'), { ...row('r-b', 'U-B'), started_by: 'usr_other' }];
      existing = ['U-A'];
      expect((await get(MEMBER, 'video.mp4?udid=U-B')).status).to.equal(404);
      expect((await get(MEMBER, 'composite.mp4')).status).to.equal(404);
    });

    it('gets a phone that was unplugged, and then the composite', async () => {
      existing = ['U-A'];
      const b = await get(MEMBER, 'video.mp4?udid=U-B');
      expect(b.status).to.equal(200);
      expect(b.body.toString('utf8')).to.equal(B_BYTES);
      expect((await get(MEMBER, 'composite.mp4')).status).to.equal(200);
      const videos = await get(MEMBER, 'videos.zip');
      expect(await zipNames(videos.body)).to.deep.equal(['U-A.mp4', 'U-B.mp4', 'composite.mp4']);
    });
  });

  it('reads the group once per download', async () => {
    for (const url of ['video.mp4?udid=U-A', 'videos.zip', 'bundle.zip']) {
      listGroup.resetHistory();
      const res = await get(MEMBER, url);
      expect(res.status, url).to.equal(200);
      expect(listGroup.callCount, url).to.equal(1);
    }
  });

  describe('a member who sees neither phone', () => {
    beforeEach(() => {
      memberSees = [];
    });

    for (const [url, error] of [
      ['video.mp4?udid=U-A', 'not_found'],
      ['video.mp4', 'not_found'],
      ['videos.zip', 'not_found'],
      ['bundle.zip', 'not_found'],
      ['composite.mp4', 'composite_not_found'],
    ]) {
      it(`404s ${url}`, async () => {
        const res = await get(MEMBER, url);
        expect(res.status).to.equal(404);
        expect(res.json()).to.deep.equal({ error });
      });
    }
  });

  describe('video.mp4 as a file download', () => {
    it('answers a Range request with 206 and just those bytes', async () => {
      const res = await get(MEMBER, 'video.mp4?udid=U-A', { Range: 'bytes=0-2' });
      expect(res.status).to.equal(206);
      expect(res.body.toString('utf8')).to.equal(A_BYTES.slice(0, 3));
      expect(res.headers['content-range']).to.equal(`bytes 0-2/${A_BYTES.length}`);
    });

    // `send` sets the file's Content-Type and validators before it finds the
    // range unsatisfiable. Left in place, the JSON would go out as video/mp4
    // with the video's ETag.
    it('answers an unsatisfiable Range with 416 JSON and the size it can ask within', async () => {
      const fileEtag = (await get(MEMBER, 'video.mp4?udid=U-A')).headers.etag;
      expect(fileEtag, "the file's own ETag").to.be.a('string');
      const res = await get(MEMBER, 'video.mp4?udid=U-A', { Range: 'bytes=9999-10000' });
      expect(res.status).to.equal(416);
      expect(res.headers['content-type']).to.match(/^application\/json/);
      expect(res.headers['content-range']).to.equal(`bytes */${A_BYTES.length}`);
      // Express tags the JSON body itself; it must not reuse the video's tag.
      expect(res.headers.etag).to.not.equal(fileEtag);
      expect(res.headers).to.not.have.any.keys('last-modified');
      // The API's no-store survives: it is the app's policy, not the file's.
      expect(res.headers['cache-control']).to.equal(API_CACHE_CONTROL);
      // A JSON error is never an attachment. The old hand-set headers made it one.
      expect(res.headers['content-disposition']).to.equal(undefined);
      expect(res.json()).to.deep.equal({ error: 'range_not_satisfiable' });
    });

    it('answers a file gone from disk with 404 JSON, not an attachment', async () => {
      const gone = path.join(root, 'gone.mp4');
      const svc = Container.get(ProofBundleService);
      sinon
        .stub(svc, 'resolveVideoFile')
        .resolves({ filePath: gone, downloadName: 'U-A.mp4', recordingId: 'r-a' });
      const res = await get(MEMBER, 'video.mp4?udid=U-A');
      expect(res.status).to.equal(404);
      expect(res.headers['content-type']).to.match(/^application\/json/);
      expect(res.headers['cache-control']).to.equal(API_CACHE_CONTROL);
      expect(res.headers['content-disposition']).to.equal(undefined);
      expect(res.json()).to.deep.equal({ error: 'video_not_found' });
    });

    // The repo dev-depends on Express 4, whose `send` serves a path with a
    // dot-segment anyway, so a plain request passes with or without the
    // option. Appium 3 runs the plugin on Express 5, which refuses every file
    // under ~/.cache without it. See DOWNLOAD_OPTIONS in routers/apps.ts.
    it('sends with dotfiles allowed, so ~/.cache paths survive Express 5', async () => {
      const download = sinon.spy(express.response, 'download');
      const res = await get(MEMBER, 'video.mp4?udid=U-A');
      expect(res.status).to.equal(200);
      expect(download.calledOnce, 'served through res.download').to.equal(true);
      const [sentPath, sentName, opts] = download.firstCall.args as unknown[];
      expect(sentPath).to.equal(files['r-a']);
      expect(sentName).to.equal('U-A.mp4');
      expect(opts).to.deep.include({ dotfiles: 'allow' });
    });
  });
});
