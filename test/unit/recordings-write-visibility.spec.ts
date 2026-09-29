import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { Container } from 'typedi';
import RecordingsRouter from '../../src/app/routers/recordings';
import { RecordingOrchestrator } from '../../src/services/recording/RecordingOrchestrator';
import { RecordingStore } from '../../src/services/recording/recording-store';
import * as deviceService from '../../src/data-service/device-service';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import { saveRegistrations } from '../helpers/container-registration';

type Role = 'MEMBER' | 'ADMIN' | 'SUPER_ADMIN';
const T0 = Date.parse('2026-09-20T10:00:00.000Z');

interface Caller {
  userId: string;
  role?: Role;
  teamIds?: string[];
}

function buildApp(caller: Caller) {
  const app = express();
  app.use(express.json());
  const api = express.Router();
  api.use((req, _res, next) => {
    const role = caller.role ?? 'MEMBER';
    (req as any).auth = {
      kind: 'user-session',
      userId: caller.userId,
      role,
      scopes: scopesForRole(role),
      teamIds: caller.teamIds,
      rateLimit: 100,
    };
    next();
  });
  RecordingsRouter.register(api);
  app.use('/xenon/api', api);
  return app;
}

function rec(over: any) {
  return {
    group_id: 'g1',
    device_host: '127.0.0.1',
    status: 'RECORDING',
    started_at: new Date(T0),
    started_by: 'usr_alice',
    file_path: `/nonexistent/${over.id}/video/${over.id}.mp4`,
    bookmarks: [],
    annotations: [],
    ...over,
  };
}

const RECT = {
  timecodeMs: 1000,
  shape: 'RECT',
  geometry: '{"x":0.1,"y":0.1,"w":0.2,"h":0.2}',
  color: '#ff0000',
};

/**
 * The write routes of a recording, for a member of team t1. Alice started g1
 * on her team's phone U1; an admin added OTHER, a phone on team t2. g2 is
 * wholly team t2's. g3 is another of Alice's, on U1. NOPE has no Device row.
 * Seeing one phone of a group is not seeing the group: a member may write
 * only on what they can see, and is told "not found" about the rest.
 */
describe('recording write routes: team visibility', () => {
  let rows: any[];
  /** udids with a Device row the caller's team can see. */
  let visible: Set<string>;
  /** udids with a Device row at all, on any team. */
  let devices: Set<string>;
  let store: any;
  let orch: Record<string, sinon.SinonStub>;
  let filter: sinon.SinonStub;
  let restoreRegistrations: () => void;

  beforeEach(() => {
    restoreRegistrations = saveRegistrations(RecordingStore, RecordingOrchestrator);
    rows = [
      rec({ id: 'r1', device_udid: 'U1' }),
      rec({
        id: 'r2',
        device_udid: 'OTHER',
        started_by: 'usr_root',
        started_at: new Date(T0 + 500),
      }),
      rec({ id: 'r3', group_id: 'g2', device_udid: 'OTHER', started_by: 'usr_carol' }),
      rec({ id: 'r4', group_id: 'g3', device_udid: 'U1' }),
    ];
    visible = new Set(['U1', 'U3']);
    devices = new Set(['U1', 'U3', 'OTHER']);
    const lean = (r: any) => ({
      id: r.id,
      group_id: r.group_id,
      device_udid: r.device_udid,
      started_at: r.started_at,
      started_by: r.started_by,
    });
    store = {
      listGroup: sinon.spy(async (g: string) => rows.filter((r) => r.group_id === g)),
      listGroupStarts: sinon.spy(async (g: string) =>
        rows.filter((r) => r.group_id === g).map(lean),
      ),
      findVideo: sinon.spy(async (id: string) => {
        const r = rows.find((x) => x.id === id);
        return r ? { ...lean(r), file_path: r.file_path, status: r.status } : null;
      }),
      deviceNames: async (udids: string[]) =>
        new Map(udids.filter((u) => devices.has(u)).map((u) => [u, { name: u, platform: null }])),
    };
    Container.set(RecordingStore, store);
    orch = {
      start: sinon.stub().resolves({
        groupId: 'g-new',
        recordings: [{ id: 'r-new', udid: 'U1', status: 'RECORDING' }],
        startedAt: new Date(T0),
        compositeEnabled: false,
      }),
      addDevice: sinon
        .stub()
        .resolves({ recording: { id: 'r-add', udid: 'U3', status: 'RECORDING' } }),
      stop: sinon.stub().resolves({ groupId: 'g1', recordings: [] }),
      addBookmark: sinon.stub().resolves({ id: 'bm-1', label: 'bug' }),
      addAnnotation: sinon.stub().resolves({ id: 'an-1' }),
      clearAnnotations: sinon.stub().resolves({ cleared: 2 }),
    };
    Container.set(RecordingOrchestrator, orch);
    filter = sinon
      .stub(deviceService, 'filterRowsByVisibleDevice')
      .callsFake(async (list: any[], teamIds: any, field: any) =>
        teamIds === undefined ? list : list.filter((r) => visible.has(String(r[field]))),
      );
  });

  afterEach(() => {
    sinon.restore();
    restoreRegistrations();
  });

  const alice = { userId: 'usr_alice', teamIds: ['t1'] };
  const bob = { userId: 'usr_bob', teamIds: ['t1'] };
  const admin = { userId: 'usr_root', role: 'ADMIN' as Role };
  const post = (who: Caller, url: string, body: any = {}) =>
    request(buildApp(who)).post(`/xenon/api/recordings${url}`).send(body);
  const notFound = (res: request.Response) => {
    expect(res.status, JSON.stringify(res.body)).to.equal(404);
    expect(res.body).to.deep.equal({ error: 'not_found' });
  };
  const orchCalls = () => Object.values(orch).reduce((n, s) => n + s.callCount, 0);

  describe('a member', () => {
    it('cannot start a recording of another team’s phone, alone or with their own: 404, nothing started', async () => {
      notFound(await post(alice, '', { udids: ['OTHER'] }));
      notFound(await post(alice, '', { udids: ['U1', 'OTHER'] }));
      expect(orchCalls()).to.equal(0);
    });

    it('gets the same 404 for a phone with no Device row', async () => {
      notFound(await post(alice, '', { udids: ['NOPE'] }));
      expect(orchCalls()).to.equal(0);
    });

    it('cannot add another team’s phone to their group, or a phone to a group they cannot see', async () => {
      notFound(await post(alice, '/g1/add-device', { udid: 'OTHER' }));
      notFound(await post(alice, '/g1/add-device', { udid: 'NOPE' }));
      notFound(await post(alice, '/g2/add-device', { udid: 'U3' }));
      notFound(await post(alice, '/nope/add-device', { udid: 'U3' }));
      expect(orchCalls()).to.equal(0);
    });

    it('cannot stop a group they see nothing of, or one that does not exist', async () => {
      notFound(await post(alice, '/g2/stop'));
      notFound(await post(alice, '/nope/stop'));
      expect(orchCalls()).to.equal(0);
    });

    for (const [route, verb, body] of [
      ['bookmark', 'bookmark', { timecodeMs: 1000, label: 'bug' }],
      ['annotation', 'annotate', RECT],
    ] as const) {
      it(`cannot ${verb} the hidden phone’s recording, one from another group, or none`, async () => {
        notFound(await post(alice, `/g1/${route}`, { ...body, recordingId: 'r2' }));
        // r4 is Alice's and visible, but in g3: a mark is written to its group.
        notFound(await post(alice, `/g1/${route}`, { ...body, recordingId: 'r4' }));
        notFound(await post(alice, `/g1/${route}`, { ...body, recordingId: 'nope' }));
        expect(orchCalls()).to.equal(0);
      });
    }

    it('is still told 400 about a bad body before anything is looked up', async () => {
      const bm = await post(alice, '/g1/bookmark', { recordingId: 'r2', timecodeMs: 1000 });
      expect(bm.status).to.equal(400);
      const an = await post(alice, '/g1/annotation', { recordingId: 'r2', shape: 'RECT' });
      expect(an.status).to.equal(400);
      const clear = await post(alice, '/g2/annotations/clear', { timecodeMs: -1 });
      expect(clear.status).to.equal(400);
      expect(store.findVideo.called).to.equal(false);
      expect(store.listGroup.called).to.equal(false);
      expect(orchCalls()).to.equal(0);
    });

    it('clears the marks of only the phones they can see', async () => {
      const res = await post(alice, '/g1/annotations/clear', { timecodeMs: 5000 });
      expect(res.status, JSON.stringify(res.body)).to.equal(200);
      expect(res.body).to.deep.equal({ cleared: 2 });
      expect(orch.clearAnnotations.calledOnce).to.equal(true);
      expect(orch.clearAnnotations.firstCall.args).to.deep.equal(['g1', 5000, ['r1']]);
    });

    it('cannot clear a group they see nothing of', async () => {
      notFound(await post(alice, '/g2/annotations/clear', { timecodeMs: 5000 }));
      expect(orchCalls()).to.equal(0);
    });

    // The exemption visibleRows gives the owner of a phone since unplugged
    // (no Device row) holds for marks too, and for nobody else.
    it('can still mark their own phone after it was unplugged; another member cannot', async () => {
      rows.push(rec({ id: 'rg', group_id: 'g4', device_udid: 'GONE' }));
      const ok = await post(alice, '/g4/annotation', { ...RECT, recordingId: 'rg' });
      expect(ok.status, JSON.stringify(ok.body)).to.equal(201);
      notFound(await post(bob, '/g4/annotation', { ...RECT, recordingId: 'rg' }));
      expect(orch.addAnnotation.calledOnce).to.equal(true);
    });
  });

  // What Live devices does: start on the member's own phones, mark, clear, stop.
  describe('the same member’s own flow', () => {
    it('starts a recording of their team’s phones', async () => {
      const res = await post(alice, '', { udids: ['U1', 'U3'] });
      expect(res.status, JSON.stringify(res.body)).to.equal(202);
      expect(res.body.groupId).to.equal('g-new');
      expect(orch.start.firstCall.args[0]).to.deep.include({
        udids: ['U1', 'U3'],
        actorId: 'usr_alice',
      });
    });

    it('adds their team’s phone to their group', async () => {
      const res = await post(alice, '/g1/add-device', { udid: 'U3' });
      expect(res.status, JSON.stringify(res.body)).to.equal(201);
      expect(orch.addDevice.firstCall.args).to.deep.equal(['g1', 'U3', 'usr_alice']);
    });

    it('bookmarks and annotates their phone’s recording', async () => {
      const bm = await post(alice, '/g1/bookmark', {
        recordingId: 'r1',
        timecodeMs: 1000,
        label: 'bug',
      });
      expect(bm.status, JSON.stringify(bm.body)).to.equal(201);
      expect(bm.body).to.deep.equal({ id: 'bm-1', label: 'bug' });
      expect(orch.addBookmark.firstCall.args).to.deep.equal(['g1', 'r1', 1000, 'bug', undefined]);
      const an = await post(alice, '/g1/annotation', { ...RECT, recordingId: 'r1' });
      expect(an.status, JSON.stringify(an.body)).to.equal(201);
      expect(an.body).to.deep.equal({ id: 'an-1' });
      expect(orch.addAnnotation.firstCall.args.slice(0, 2)).to.deep.equal(['g1', 'r1']);
    });

    // Stopping is group-wide: the composite has one ffmpeg for every phone.
    it('stops the whole group when they see a phone of it', async () => {
      const res = await post(alice, '/g1/stop');
      expect(res.status, JSON.stringify(res.body)).to.equal(200);
      expect(res.body).to.deep.equal({ groupId: 'g1', recordings: [] });
      expect(orch.stop.firstCall.args).to.deep.equal(['g1']);
    });
  });

  describe('an admin', () => {
    it('starts, adds, stops and marks any phone, as before, with no visibility lookup', async () => {
      expect((await post(admin, '', { udids: ['OTHER', 'NOPE'] })).status).to.equal(202);
      expect((await post(admin, '/g2/add-device', { udid: 'OTHER' })).status).to.equal(201);
      expect((await post(admin, '/g2/stop')).status).to.equal(200);
      expect((await post(admin, '/nope/stop')).status).to.equal(200);
      const bm = await post(admin, '/g1/bookmark', {
        recordingId: 'r2',
        timecodeMs: 1,
        label: 'x',
      });
      expect(bm.status).to.equal(201);
      const an = await post(admin, '/g1/annotation', { ...RECT, recordingId: 'r2' });
      expect(an.status).to.equal(201);
      expect(orchCalls()).to.equal(6);
      expect(filter.called, 'no device lookup').to.equal(false);
      expect(store.listGroup.called || store.listGroupStarts.called, 'no group read').to.equal(
        false,
      );
    });

    // Visibility aside, a mark is written to its own group: the event that
    // announces it carries :groupId.
    it('cannot bookmark or annotate a recording from another group, or none', async () => {
      const bm = { timecodeMs: 1000, label: 'bug' };
      notFound(await post(admin, '/g1/bookmark', { ...bm, recordingId: 'r3' }));
      notFound(await post(admin, '/g1/annotation', { ...RECT, recordingId: 'r3' }));
      notFound(await post(admin, '/g1/bookmark', { ...bm, recordingId: 'nope' }));
      notFound(await post(admin, '/g1/annotation', { ...RECT, recordingId: 'nope' }));
      expect(orchCalls()).to.equal(0);
      expect(filter.called, 'no device lookup').to.equal(false);
    });

    it('clears the whole group', async () => {
      const res = await post(admin, '/g1/annotations/clear', { timecodeMs: 5000 });
      expect(res.status, JSON.stringify(res.body)).to.equal(200);
      expect(orch.clearAnnotations.calledOnce).to.equal(true);
      expect(orch.clearAnnotations.firstCall.args[0]).to.equal('g1');
      expect(orch.clearAnnotations.firstCall.args[1]).to.equal(5000);
      expect(orch.clearAnnotations.firstCall.args[2], 'no filter').to.equal(undefined);
    });
  });
});
