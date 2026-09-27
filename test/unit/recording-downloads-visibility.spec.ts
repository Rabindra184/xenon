import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
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
import { compositeOutputPath } from '../../src/services/recording/RecordingOrchestrator';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import { useArtifactStore } from '../helpers/artifact-store';

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
const COMPOSITE_BYTES = 'CCCC-composite-of-both';

function buildApp(caller: Caller) {
  const app = express();
  app.use(express.json());
  const apiRouter = express.Router();
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
    fs.writeFileSync(files['r-a'], A_BYTES);
    fs.writeFileSync(files['r-b'], B_BYTES);
    composite = compositeOutputPath(GROUP);
    fs.mkdirSync(path.dirname(composite), { recursive: true });
    fs.writeFileSync(composite, COMPOSITE_BYTES);
  });

  beforeEach(() => {
    memberSees = ['U-A'];
    const rows = [row('r-a', 'U-A'), row('r-b', 'U-B')];
    // The routes' visibility check and ProofBundleService both read the group
    // through this store; `prisma.recording` itself cannot be stubbed (it is
    // not one of the wrapped delegates in src/prisma.ts).
    const store = {
      listGroup: async (groupId: string) => (groupId === GROUP ? rows : []),
      findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
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
    // Put each service back to its fresh @Service() registration. A blanket
    // Container.reset() would also wipe the ARTIFACT_STORE that
    // useArtifactStore() registers once for this whole describe.
    for (const svc of [RecordingStore, ProofBundleService, AnnotationRenderService]) {
      Container.set({ id: svc, type: svc } as any);
    }
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
});
