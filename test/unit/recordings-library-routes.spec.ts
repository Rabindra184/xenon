import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Container } from 'typedi';
import RecordingsRouter, { sourceMp4Handler } from '../../src/app/routers/recordings';
import { RecordingStore } from '../../src/services/recording/recording-store';
import * as deviceService from '../../src/data-service/device-service';
import * as recordingFiles from '../../src/services/recording/recordingFiles';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import { PluginContext } from '../../src/PluginContext';
import { useArtifactStore } from '../helpers/artifact-store';

type Role = 'MEMBER' | 'ADMIN' | 'SUPER_ADMIN';
const T0 = Date.parse('2026-09-20T10:00:00.000Z');

function rec(over: any = {}) {
  return {
    id: 'r1',
    group_id: 'g1',
    device_udid: 'U1',
    device_host: '127.0.0.1',
    session_id: null,
    status: 'STOPPED',
    started_at: new Date(T0),
    ended_at: new Date(T0 + 60_000),
    duration_ms: 60_000,
    size_bytes: 10,
    fail_reason: null,
    started_by: 'usr_alice',
    file_path: '/nonexistent/r1/video/r1.mp4',
    device_snapshot: null,
    bookmarks: [],
    annotations: [],
    _count: { annotations: 0 },
    ...over,
  };
}

interface Caller {
  userId: string;
  role?: Role;
  teamIds?: string[];
  /** An API key's own scopes; without them, a cookie session's (scopesForRole). */
  scopes?: string;
}

function buildApp(caller: Caller) {
  const app = express();
  app.use(express.json());
  const api = express.Router();
  api.use((req, _res, next) => {
    const role = caller.role ?? 'MEMBER';
    (req as any).auth = {
      kind: caller.scopes === undefined ? 'user-session' : 'api-key',
      userId: caller.userId,
      role,
      scopes: caller.scopes ?? scopesForRole(role),
      teamIds: caller.teamIds,
      rateLimit: 100,
    };
    next();
  });
  RecordingsRouter.register(api);
  app.use('/xenon/api', api);
  return app;
}

/**
 * A `req` shaped enough for `sourceMp4Handler` called directly (bypassing
 * Express/roleGuard entirely, like `apps-download.spec.ts` calls `downloadApp`).
 */
function fakeSourceReq(overrides: any = {}) {
  return {
    params: { groupId: 'g1' },
    query: { recordingId: 'r1' },
    auth: { teamIds: undefined },
    aborted: false,
    ...overrides,
  };
}

interface SourceResCapture {
  statusCode?: number;
  json: sinon.SinonSpy;
  setHeader: sinon.SinonSpy;
  removeHeader: sinon.SinonSpy;
  destroy: sinon.SinonSpy;
}

/**
 * A fake `res` whose `sendFile` each test overrides. Kept separate from
 * `buildApp`'s real Express response because the repo dev-depends on
 * Express 4 — a supertest run can't reproduce the Express-5 `dotfiles` bug
 * (see DOWNLOAD_OPTIONS in `apps.ts`), and can't synchronously drive
 * `sendFile`'s error callback either.
 */
function fakeSourceRes(): { res: any; cap: SourceResCapture } {
  const cap: SourceResCapture = {
    json: sinon.spy(),
    setHeader: sinon.spy(),
    removeHeader: sinon.spy(),
    destroy: sinon.spy(),
  };
  const res: any = {
    headersSent: false,
    destroyed: false,
    status(code: number) {
      cap.statusCode = code;
      return res;
    },
    json: (body: unknown) => cap.json(body),
    setHeader: (...args: unknown[]) => cap.setHeader(...args),
    removeHeader: (...args: unknown[]) => cap.removeHeader(...args),
    destroy: (...args: unknown[]) => {
      res.destroyed = true;
      return cap.destroy(...args);
    },
    sendFile: sinon.spy(),
  };
  return { res, cap };
}

describe('recordings library routes', () => {
  useArtifactStore();
  let rows: any[];
  let visible: Set<string>;
  /** Phones that still have a Device row, with what to call them. */
  let devices: Map<string, { name: string; platform: string | null }>;
  let store: any;
  let remove: sinon.SinonStub;

  beforeEach(() => {
    rows = [];
    visible = new Set(['U1', 'U2']);
    devices = new Map([['U1', { name: 'Galaxy S9+', platform: 'android' }]]);
    store = {
      libraryRows: async () => rows,
      listGroup: async (g: string) => rows.filter((r) => r.group_id === g),
      findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
      deleteGroupRows: sinon.stub().callsFake(async (g: string) => {
        const n = rows.filter((r) => r.group_id === g).length;
        rows = rows.filter((r) => r.group_id !== g);
        return n;
      }),
      deviceNames: async (udids: string[]) =>
        new Map(Array.from(devices).filter(([u]) => udids.includes(u))),
      userNames: async () => new Map([['usr_alice', 'Alice']]),
    };
    Container.set(RecordingStore, store);
    sinon
      .stub(deviceService, 'filterRowsByVisibleDevice')
      .callsFake(async (list: any[], teamIds: any) =>
        teamIds === undefined ? list : list.filter((r) => visible.has(r.device_udid)),
      );
    remove = sinon.stub(recordingFiles, 'removeRecordingFiles').returns([]);
  });

  afterEach(() => {
    sinon.restore();
    Container.remove(RecordingStore);
  });

  const alice = { userId: 'usr_alice', teamIds: ['t1'] };
  const bob = { userId: 'usr_bob', teamIds: ['t1'] };
  const admin = { userId: 'usr_root', role: 'ADMIN' as Role };

  describe('GET /recordings', () => {
    it('lists visible groups, newest first, with retention', async () => {
      rows = [
        rec({ id: 'a', group_id: 'g1' }),
        rec({ id: 'b', group_id: 'g2', started_at: new Date(T0 + 1000) }),
        rec({ id: 'c', group_id: 'g3', device_udid: 'HIDDEN', started_by: 'usr_carol' }),
      ];
      const res = await request(buildApp(alice)).get('/xenon/api/recordings');
      expect(res.status, JSON.stringify(res.body)).to.equal(200);
      expect(res.body.recordings.map((s: any) => s.groupId)).to.deep.equal(['g2', 'g1']);
      expect(res.body.recordings[0].phones[0].name).to.equal('Galaxy S9+');
      expect(res.body.recordings[0].startedBy).to.deep.equal({ id: 'usr_alice', name: 'Alice' });
      expect(res.body.total).to.equal(2);
      expect(res.body.retention).to.deep.equal({ days: 30, maxCount: 100 });
    });

    it('passes the filters and the page through', async () => {
      rows = [
        rec({ id: 'a', group_id: 'g1' }),
        rec({ id: 'b', group_id: 'g2', device_udid: 'U2', started_at: new Date(T0 + 1000) }),
      ];
      const one = await request(buildApp(alice)).get('/xenon/api/recordings?limit=1');
      expect(one.body.recordings.map((s: any) => s.groupId)).to.deep.equal(['g2']);
      const two = await request(buildApp(alice)).get(
        `/xenon/api/recordings?limit=1&cursor=${encodeURIComponent(one.body.nextCursor)}`,
      );
      expect(two.body.recordings.map((s: any) => s.groupId)).to.deep.equal(['g1']);
      const byPhone = await request(buildApp(alice)).get('/xenon/api/recordings?udid=U2');
      expect(byPhone.body.recordings.map((s: any) => s.groupId)).to.deep.equal(['g2']);
    });

    it('answers 400 for a bad query', async () => {
      const res = await request(buildApp(alice)).get('/xenon/api/recordings?since=nope');
      expect(res.status).to.equal(400);
      expect(res.body.error).to.equal('since must be an ISO time');
    });

    it('carries facets: phones, people, unknownCount and when', async () => {
      // buildLibrary buckets "when" off the real Date.now(), which the route
      // does not let the caller override — so, unlike T0 elsewhere in this
      // file, these ages are relative to test-run time, not a fixed instant.
      const now = Date.now();
      rows = [
        rec({ id: 'a', group_id: 'g1', started_at: new Date(now - 1000) }),
        rec({
          id: 'b',
          group_id: 'g2',
          device_udid: 'U2',
          started_by: null,
          started_at: new Date(now - 40 * 24 * 60 * 60 * 1000),
        }),
      ];
      const res = await request(buildApp(alice)).get('/xenon/api/recordings');
      expect(res.status, JSON.stringify(res.body)).to.equal(200);
      expect(res.body.facets.phones).to.deep.equal([
        { udid: 'U1', name: 'Galaxy S9+', count: 1 },
        { udid: 'U2', name: 'U2', count: 1 },
      ]);
      expect(res.body.facets.people).to.deep.equal([{ id: 'usr_alice', name: 'Alice', count: 1 }]);
      expect(res.body.facets.unknownCount).to.equal(1);
      expect(res.body.facets.when).to.deep.equal({ any: 2, '24h': 1, '7d': 1, '30d': 1 });
    });

    it('names the synthetic user of an auth-disabled server "Auth disabled"', async () => {
      rows = [rec({ started_by: 'auth-disabled' })];
      const res = await request(buildApp(admin)).get('/xenon/api/recordings');
      expect(res.status, JSON.stringify(res.body)).to.equal(200);
      expect(res.body.recordings[0].startedBy).to.deep.equal({
        id: 'auth-disabled',
        name: 'Auth disabled',
      });
      expect(res.body.facets.people).to.deep.equal([
        { id: 'auth-disabled', name: 'Auth disabled', count: 1 },
      ]);
    });

    it('reads retention from non-default plugin settings', async () => {
      const ctx = Container.get(PluginContext);
      const original = ctx.pluginArgs;
      ctx.pluginArgs = {
        ...original,
        recordingCleanupDays: 7,
        recordingCleanupMaxCount: 20,
      };
      try {
        rows = [rec()];
        const res = await request(buildApp(alice)).get('/xenon/api/recordings');
        expect(res.status, JSON.stringify(res.body)).to.equal(200);
        expect(res.body.retention).to.deep.equal({ days: 7, maxCount: 20 });
      } finally {
        ctx.pluginArgs = original;
      }
    });
  });

  describe('GET /recordings/:groupId', () => {
    it('adds the summary, and bookmarks and marks with their recording', async () => {
      rows = [
        rec({
          bookmarks: [
            { id: 'b1', recording_id: 'r1', timecode_ms: 4000, label: 'Pay', note: null },
          ],
          annotations: [
            {
              id: 'a1',
              recording_id: 'r1',
              timecode_ms: 2000,
              end_timecode_ms: 3000,
              shape: 'RECT',
              geometry: '{"x":0.1,"y":0.1,"w":0.2,"h":0.2}',
              color: 'red',
              text: null,
            },
          ],
        }),
      ];
      const res = await request(buildApp(alice)).get('/xenon/api/recordings/g1');
      expect(res.status).to.equal(200);
      expect(res.body.summary.groupId).to.equal('g1');
      expect(res.body.recordings).to.have.length(1);
      expect(res.body.bookmarks).to.deep.equal([
        { id: 'b1', recordingId: 'r1', timecodeMs: 4000, label: 'Pay', note: null },
      ]);
      expect(res.body.annotations[0]).to.deep.include({
        id: 'a1',
        recordingId: 'r1',
        timecodeMs: 2000,
        endTimecodeMs: 3000,
        shape: 'RECT',
      });
    });

    it('answers 404 for a group that does not exist or is not visible', async () => {
      expect((await request(buildApp(admin)).get('/xenon/api/recordings/nope')).status).to.equal(
        404,
      );
      rows = [rec({ device_udid: 'HIDDEN' })];
      expect((await request(buildApp(bob)).get('/xenon/api/recordings/g1')).status).to.equal(404);
    });

    it('sorts bookmarks and marks by timecode across every recording in the group', async () => {
      rows = [
        rec({
          id: 'r1',
          device_udid: 'U1',
          bookmarks: [
            { id: 'b2', recording_id: 'r1', timecode_ms: 9000, label: 'Late', note: null },
          ],
          annotations: [
            {
              id: 'a2',
              recording_id: 'r1',
              timecode_ms: 8000,
              end_timecode_ms: null,
              shape: 'RECT',
              geometry: '{}',
              color: 'red',
              text: null,
            },
          ],
        }),
        rec({
          id: 'r2',
          device_udid: 'U2',
          bookmarks: [
            { id: 'b1', recording_id: 'r2', timecode_ms: 1000, label: 'Early', note: null },
          ],
          annotations: [
            {
              id: 'a1',
              recording_id: 'r2',
              timecode_ms: 500,
              end_timecode_ms: null,
              shape: 'RECT',
              geometry: '{}',
              color: 'blue',
              text: null,
            },
          ],
        }),
      ];
      const res = await request(buildApp(alice)).get('/xenon/api/recordings/g1');
      expect(res.status, JSON.stringify(res.body)).to.equal(200);
      expect(res.body.bookmarks.map((b: any) => b.id)).to.deep.equal(['b1', 'b2']);
      expect(res.body.annotations.map((a: any) => a.id)).to.deep.equal(['a1', 'a2']);
    });
  });

  describe('DELETE /recordings/:groupId', () => {
    const del = (who: any) => request(buildApp(who)).delete('/xenon/api/recordings/g1');

    it('lets the person who recorded it delete it: rows, then files', async () => {
      rows = [
        rec(),
        rec({ id: 'r2', device_udid: 'U2', file_path: '/nonexistent/r2/video/r2.mp4' }),
      ];
      const res = await del(alice);
      expect(res.status, JSON.stringify(res.body)).to.equal(204);
      expect(store.deleteGroupRows.calledOnceWith('g1')).to.equal(true);
      expect(remove.calledOnce).to.equal(true);
      expect(remove.firstCall.args[0]).to.deep.equal([
        '/nonexistent/r1/video/r1.mp4',
        '/nonexistent/r2/video/r2.mp4',
      ]);
      expect(remove.firstCall.args[1]).to.match(/_groups[\\/]g1$/);
      expect(store.deleteGroupRows.calledBefore(remove)).to.equal(true);
    });

    it('lets an admin delete anyone’s', async () => {
      rows = [rec()];
      expect((await del(admin)).status).to.equal(204);
    });

    it('refuses someone else with 403 not_owner', async () => {
      rows = [rec()];
      const res = await del(bob);
      expect(res.status).to.equal(403);
      expect(res.body.error).to.equal('not_owner');
      expect(store.deleteGroupRows.called).to.equal(false);
    });

    it('keeps a recording with no known owner for admins', async () => {
      rows = [rec({ started_by: null })];
      expect((await del(alice)).status).to.equal(403);
      expect((await del(admin)).status).to.equal(204);
    });

    it('refuses a running recording with 409 before the ownership check, for owner and non-owner alike', async () => {
      rows = [rec({ status: 'RECORDING', ended_at: null, duration_ms: null })];
      const ownerRes = await del(alice);
      expect(ownerRes.status).to.equal(409);
      expect(ownerRes.body.error).to.equal('recording_in_progress');
      expect(store.deleteGroupRows.called).to.equal(false);

      // bob is not the owner (alice is, per `rec()`'s default started_by) and
      // would get 403 not_owner once the recording is stopped — getting 409
      // here instead is what proves the 409 check runs first.
      const nonOwnerRes = await del(bob);
      expect(nonOwnerRes.status).to.equal(409);
      expect(nonOwnerRes.body.error).to.equal('recording_in_progress');
      expect(store.deleteGroupRows.called).to.equal(false);
    });

    it('needs the devices scope: a read-only API key is refused, a member’s session is not', async () => {
      rows = [rec()];
      // The owner's own key, and a SUPER_ADMIN's: role alone must not let a
      // read-only key delete.
      for (const key of [
        { ...alice, scopes: 'read' },
        { userId: 'usr_root', role: 'SUPER_ADMIN' as Role, scopes: 'read,sessions' },
      ]) {
        const res = await del(key);
        expect(res.status, JSON.stringify(res.body)).to.equal(403);
        expect(res.body.error).to.equal('insufficient scope');
      }
      expect(store.deleteGroupRows.called).to.equal(false);

      expect((await del({ ...alice, scopes: 'read,devices' })).status).to.equal(204);
      rows = [rec()];
      expect((await del(alice)).status, 'cookie session, scopesForRole(MEMBER)').to.equal(204);
    });

    it('answers 404 for a group the caller cannot see, or that is gone', async () => {
      rows = [rec({ device_udid: 'HIDDEN' })];
      expect((await del(bob)).status).to.equal(404);
      rows = [];
      expect((await del(admin)).status).to.equal(404);
    });
  });

  // A phone's Device row is deleted when it is unplugged, and a missing row
  // reads as invisible to every non-admin. The person who recorded a group
  // must still see all of it; nobody else gains anything.
  describe('the owner, after a phone was unplugged', () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-owner-'));
      visible = new Set(['U1']); // GONE has no Device row any more
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    const unplugged = (over: any = {}) =>
      rec({ id: 'r2', device_udid: 'GONE', started_at: new Date(T0 + 500), ...over });

    it('still lists it, and opens it with every phone', async () => {
      rows = [rec({ group_id: 'gone', id: 'solo', device_udid: 'GONE' }), rec(), unplugged()];
      const list = await request(buildApp(alice)).get('/xenon/api/recordings');
      expect(list.status, JSON.stringify(list.body)).to.equal(200);
      expect(list.body.recordings.map((s: any) => s.groupId).sort()).to.deep.equal(['g1', 'gone']);
      const g1 = list.body.recordings.find((s: any) => s.groupId === 'g1');
      expect(g1.phones.map((p: any) => p.udid)).to.deep.equal(['U1', 'GONE']);

      const detail = await request(buildApp(alice)).get('/xenon/api/recordings/gone');
      expect(detail.status, JSON.stringify(detail.body)).to.equal(200);
      expect(detail.body.summary.phones.map((p: any) => p.udid)).to.deep.equal(['GONE']);
      const both = await request(buildApp(alice)).get('/xenon/api/recordings/g1');
      expect(both.body.summary.phones.map((p: any) => p.udid)).to.deep.equal(['U1', 'GONE']);
    });

    it('can still delete it', async () => {
      rows = [rec({ device_udid: 'GONE' })];
      const res = await request(buildApp(alice)).delete('/xenon/api/recordings/g1');
      expect(res.status, JSON.stringify(res.body)).to.equal(204);
      expect(store.deleteGroupRows.calledOnceWith('g1')).to.equal(true);
    });

    it('can still play its video', async () => {
      const file = path.join(dir, 'r2.mp4');
      fs.writeFileSync(file, 'x');
      rows = [rec(), unplugged({ file_path: file })];
      const res = await request(buildApp(alice)).get(
        '/xenon/api/recordings/g1/source.mp4?recordingId=r2',
      );
      expect(res.status, JSON.stringify(res.body)).to.equal(200);
    });

    it('is the person who started it, not someone who added a phone later', async () => {
      // The earliest row with a started_by names the owner (alice); a row with
      // none is skipped, and bob only added the phone that is now unplugged.
      rows = [
        rec({ id: 'rn', started_by: null, started_at: new Date(T0 - 500) }),
        rec({ id: 'r0' }),
        unplugged({ started_by: 'usr_bob' }),
      ];
      const asAlice = await request(buildApp(alice)).get('/xenon/api/recordings/g1');
      expect(asAlice.body.summary.phones.map((p: any) => p.recordingId).sort()).to.deep.equal([
        'r0',
        'r2',
        'rn',
      ]);
      const asBob = await request(buildApp(bob)).get('/xenon/api/recordings/g1');
      expect(asBob.body.summary.phones.map((p: any) => p.recordingId).sort()).to.deep.equal([
        'r0',
        'rn',
      ]);
    });

    // The exemption is for a phone that is gone, not for one that moved to
    // another team: that phone still exists, and its team decides.
    it('does not show the owner a phone that still exists on another team', async () => {
      const file = path.join(dir, 'r2.mp4');
      fs.writeFileSync(file, 'x');
      devices.set('OTHER', { name: 'Team B phone', platform: 'android' });
      rows = [rec(), rec({ id: 'r2', device_udid: 'OTHER', file_path: file })];
      const list = await request(buildApp(alice)).get('/xenon/api/recordings');
      expect(list.status, JSON.stringify(list.body)).to.equal(200);
      expect(list.body.recordings[0].phones.map((p: any) => p.udid)).to.deep.equal(['U1']);
      const detail = await request(buildApp(alice)).get('/xenon/api/recordings/g1');
      expect(detail.body.summary.phones.map((p: any) => p.udid)).to.deep.equal(['U1']);
      expect(detail.body.recordings.map((r: any) => r.id)).to.deep.equal(['r1']);
      const src = await request(buildApp(alice)).get(
        '/xenon/api/recordings/g1/source.mp4?recordingId=r2',
      );
      expect(src.status).to.equal(404);
    });

    it('does not open it to another member: 404 everywhere', async () => {
      const file = path.join(dir, 'r1.mp4');
      fs.writeFileSync(file, 'x');
      rows = [rec({ device_udid: 'GONE', file_path: file })];
      const list = await request(buildApp(bob)).get('/xenon/api/recordings');
      expect(list.body.recordings).to.deep.equal([]);
      expect((await request(buildApp(bob)).get('/xenon/api/recordings/g1')).status).to.equal(404);
      expect(
        (await request(buildApp(bob)).get('/xenon/api/recordings/g1/source.mp4?recordingId=r1'))
          .status,
      ).to.equal(404);
      expect((await request(buildApp(bob)).delete('/xenon/api/recordings/g1')).status).to.equal(
        404,
      );
      expect(store.deleteGroupRows.called).to.equal(false);
    });
  });

  describe('GET /recordings/:groupId/source.mp4', () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-src-'));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('streams the clean video with range support', async () => {
      const file = path.join(dir, 'r1.mp4');
      fs.writeFileSync(file, Buffer.from('0123456789'));
      rows = [rec({ file_path: file })];
      const res = await request(buildApp(alice))
        .get('/xenon/api/recordings/g1/source.mp4?recordingId=r1')
        .set('Range', 'bytes=2-5')
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).to.equal(206);
      expect(res.headers['content-type']).to.match(/video\/mp4/);
      expect(res.body.toString()).to.equal('2345');
      expect(res.headers['content-disposition']).to.equal(undefined);
    });

    it('serves it as an attachment for download', async () => {
      const file = path.join(dir, 'r1.mp4');
      fs.writeFileSync(file, 'x');
      rows = [rec({ file_path: file })];
      const res = await request(buildApp(alice)).get(
        '/xenon/api/recordings/g1/source.mp4?recordingId=r1&download=1',
      );
      expect(res.status).to.equal(200);
      expect(res.headers['content-disposition']).to.match(/attachment; filename="U1\.mp4"/);
    });

    it('answers 400 without a recording, and 404 for another group, an invisible phone or a missing file', async () => {
      rows = [rec(), rec({ id: 'rx', group_id: 'g2' }), rec({ id: 'rh', device_udid: 'HIDDEN' })];
      const get = (q: string) =>
        request(buildApp(bob)).get(`/xenon/api/recordings/g1/source.mp4${q}`);
      expect((await get('')).status).to.equal(400);
      expect((await get('?recordingId=rx')).status).to.equal(404);
      expect((await get('?recordingId=rh')).status).to.equal(404);
      expect((await get('?recordingId=r1')).status).to.equal(404);
    });

    // These call sourceMp4Handler directly rather than through supertest.
    // The repo dev-depends on Express 4, where `send` only looks at a path's
    // last segment, so a supertest run on it can't reproduce the Express 5
    // `dotfiles` bug (see DOWNLOAD_OPTIONS in apps.ts) — nor can it drive
    // sendFile's error callback synchronously with a chosen error.
    describe('sourceMp4Handler internals', () => {
      it('passes dotfiles: allow to sendFile (RED without it: Express 5 500s on the ~/.cache path)', async () => {
        const file = path.join(dir, 'r1.mp4');
        fs.writeFileSync(file, Buffer.from('0123456789'));
        rows = [rec({ file_path: file })];
        const { res } = fakeSourceRes();

        await sourceMp4Handler(fakeSourceReq() as any, res);

        expect(res.sendFile.calledOnce, 'sendFile was called').to.equal(true);
        const [sentPath, opts] = res.sendFile.firstCall.args;
        expect(sentPath).to.equal(path.resolve(file));
        expect(opts).to.include({ dotfiles: 'allow' });
      });

      it('answers 404 video_not_found, not 500, when the file vanishes between the existsSync check and the stat', async () => {
        const file = path.join(dir, 'r1.mp4');
        fs.writeFileSync(file, Buffer.from('data'));
        rows = [rec({ file_path: file })];
        const { res, cap } = fakeSourceRes();
        const err: any = new Error('ENOENT: no such file or directory');
        err.status = 404;
        res.sendFile = sinon.spy((_p: string, _o: any, cb: (e: any) => void) => cb(err));

        await sourceMp4Handler(fakeSourceReq() as any, res);

        expect(cap.statusCode).to.equal(404);
        expect(cap.json.firstCall.args[0]).to.deep.equal({ error: 'video_not_found' });
        // send already set Content-Type: video/mp4; it must not survive onto
        // this JSON error body.
        expect(cap.removeHeader.calledWith('Content-Type')).to.equal(true);
      });

      it('maps a 416 from a Range request to range_not_satisfiable', async () => {
        const file = path.join(dir, 'r1.mp4');
        fs.writeFileSync(file, Buffer.from('data'));
        rows = [rec({ file_path: file })];
        const { res, cap } = fakeSourceRes();
        const err: any = new Error('Range Not Satisfiable');
        err.status = 416;
        res.sendFile = sinon.spy((_p: string, _o: any, cb: (e: any) => void) => cb(err));

        await sourceMp4Handler(fakeSourceReq() as any, res);

        expect(cap.statusCode).to.equal(416);
        expect(cap.json.firstCall.args[0]).to.deep.equal({ error: 'range_not_satisfiable' });
      });

      it('ignores a client abort rather than writing to a dead socket', async () => {
        const file = path.join(dir, 'r1.mp4');
        fs.writeFileSync(file, Buffer.from('data'));
        rows = [rec({ file_path: file })];
        const { res, cap } = fakeSourceRes();
        const err: any = new Error('aborted');
        err.code = 'ECONNABORTED';
        res.sendFile = sinon.spy((_p: string, _o: any, cb: (e: any) => void) => cb(err));

        await sourceMp4Handler(fakeSourceReq() as any, res);

        expect(cap.json.called, 'no response body is written').to.equal(false);
        expect(cap.statusCode, 'no status is set').to.equal(undefined);
        expect(cap.destroy.called, 'the response is left alone').to.equal(false);
      });

      it('logs and destroys the response, without a JSON body, when the error arrives after headers were already sent', async () => {
        const file = path.join(dir, 'r1.mp4');
        fs.writeFileSync(file, Buffer.from('data'));
        rows = [rec({ file_path: file })];
        const { res, cap } = fakeSourceRes();
        const err: any = new Error('mid-stream failure');
        res.sendFile = sinon.spy((_p: string, _o: any, cb: (e: any) => void) => {
          res.headersSent = true;
          cb(err);
        });

        await sourceMp4Handler(fakeSourceReq() as any, res);

        expect(cap.json.called, 'headers are already sent; no JSON body follows').to.equal(false);
        expect(cap.destroy.calledOnce).to.equal(true);
      });
    });
  });
});
