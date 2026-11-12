import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { Container } from 'typedi';
import RecordingsRouter from '../../src/app/routers/recordings';
import {
  RecordingOrchestrator,
  RecordingError,
} from '../../src/services/recording/RecordingOrchestrator';
import { RecordingStore } from '../../src/services/recording/recording-store';
import { SessionOwnerResolver } from '../../src/services/device-access/SessionOwnerResolver';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import * as deviceService from '../../src/data-service/device-service';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import { saveRegistrations } from '../helpers/container-registration';

type Role = 'MEMBER' | 'ADMIN' | 'SUPER_ADMIN';
const T0 = Date.parse('2026-11-12T10:00:00.000Z');

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

/**
 * POST /recordings with `sessionIds` (ENH-06, observer mode). Alice (team t1)
 * runs sA on U1 and sB on U3; Bob runs sBob on U4; sOrphan on U5 has no owner
 * on record; Alice's sHidden runs on HIDDEN, another team's phone; Alice's
 * sCloud on CLOUD, a cloud provider's. Every phone but HIDDEN is t1's.
 */
describe('POST /recordings with sessionIds: observer mode', () => {
  let orch: Record<string, sinon.SinonStub>;
  let findDevices: sinon.SinonStub;
  let ownerOf: sinon.SinonStub;
  let restoreRegistrations: () => void;

  const phones: Record<string, { udid: string; cloud?: boolean }> = {
    sA: { udid: 'U1' },
    sB: { udid: 'U3' },
    sBob: { udid: 'U4' },
    sOrphan: { udid: 'U5' },
    sHidden: { udid: 'HIDDEN' },
    sCloud: { udid: 'CLOUD', cloud: true },
  };
  const owners: Record<string, string | null> = {
    sA: 'usr_alice',
    sB: 'usr_alice',
    sBob: 'usr_bob',
    sOrphan: null,
    sHidden: 'usr_alice',
    sCloud: 'usr_alice',
  };
  const visible = new Set(['U1', 'U3', 'U4', 'U5', 'CLOUD']);

  const row = (sessionId: string) => ({
    udid: phones[sessionId].udid,
    host: 'http://127.0.0.1:4723',
    busy: true,
    claimSessionId: sessionId,
    session_id: sessionId,
    cloud: phones[sessionId].cloud ?? false,
    // The team check reads the session's own row.
    teamId: visible.has(phones[sessionId].udid) ? 't1' : 't2',
  });
  /** The rows a store holds: by claim, or every session's row of a udid. */
  const rowsFor = (filter: any) => {
    if (filter.udid !== undefined) {
      return Object.keys(phones)
        .filter((id) => phones[id].udid === filter.udid)
        .map(row);
    }
    const id = filter.claimSessionId ?? filter.session_id;
    return phones[id] ? [row(id)] : [];
  };

  beforeEach(() => {
    restoreRegistrations = saveRegistrations(
      RecordingStore,
      RecordingOrchestrator,
      SessionOwnerResolver,
    );
    Container.set(RecordingStore, {
      listGroupStarts: async (g: string) =>
        g === 'gObs'
          ? [
              {
                id: 'r1',
                group_id: 'gObs',
                device_udid: 'U1',
                started_at: new Date(T0),
                started_by: 'usr_alice',
              },
            ]
          : [],
    });
    orch = {
      start: sinon.stub().callsFake(async (input: any) => ({
        groupId: 'g-new',
        recordings: input.phones.map(({ udid }: { udid: string }, i: number) => ({
          id: `r-${i}`,
          udid,
          status: 'RECORDING',
          sessionId: input.observe?.[i]?.sessionId,
        })),
        startedAt: new Date(T0),
        compositeEnabled: input.phones.length > 1,
      })),
      addDevice: sinon.stub().rejects(new RecordingError('observer_group')),
    };
    Container.set(RecordingOrchestrator, orch);
    ownerOf = sinon.stub().callsFake(async (id: string) => owners[id] ?? null);
    Container.set(SessionOwnerResolver, { ownerOf } as any);
    findDevices = sinon.stub().callsFake(async (filter: any) => rowsFor(filter));
    sinon.stub(DeviceStoreFactory, 'getStore').returns({ findDevices } as any);
    sinon
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
  const admin = { userId: 'usr_root', role: 'ADMIN' as Role };
  const post = (who: Caller, url: string, body: any) =>
    request(buildApp(who)).post(`/xenon/api/recordings${url}`).send(body);
  const notFound = (res: request.Response) => {
    expect(res.status, JSON.stringify(res.body)).to.equal(404);
    expect(res.body).to.deep.equal({ error: 'not_found' });
  };

  it("starts an observer group for the owner's sessions", async () => {
    const res = await post(alice, '', { sessionIds: ['sA', 'sB'], note: 'two phones' });
    expect(res.status, JSON.stringify(res.body)).to.equal(202);
    expect(orch.start.calledOnce).to.equal(true);
    expect(orch.start.firstCall.args[0]).to.deep.equal({
      phones: [
        { udid: 'U1', host: 'http://127.0.0.1:4723' },
        { udid: 'U3', host: 'http://127.0.0.1:4723' },
      ],
      observe: [
        { sessionId: 'sA', udid: 'U1', host: 'http://127.0.0.1:4723' },
        { sessionId: 'sB', udid: 'U3', host: 'http://127.0.0.1:4723' },
      ],
      note: 'two phones',
      actorId: 'usr_alice',
    });
    expect(res.body).to.deep.equal({
      groupId: 'g-new',
      recordings: [
        { id: 'r-0', udid: 'U1', status: 'RECORDING', sessionId: 'sA' },
        { id: 'r-1', udid: 'U3', status: 'RECORDING', sessionId: 'sB' },
      ],
      startedAt: new Date(T0).toISOString(),
      compositeEnabled: true,
    });
  });

  it('both udids and sessionIds, or neither, is 400', async () => {
    const both = await post(alice, '', { udids: ['U1'], sessionIds: ['sA'] });
    expect(both.status, JSON.stringify(both.body)).to.equal(400);
    expect(both.body).to.deep.equal({ error: 'send udids or sessionIds, not both' });
    const neither = await post(alice, '', { note: 'nothing' });
    expect(neither.status).to.equal(400);
    // A body without sessionIds is today's udids request, answered as today.
    expect(neither.body).to.deep.equal({ error: 'udids must be a non-empty array' });
    expect(findDevices.called).to.equal(false);
    expect(ownerOf.called).to.equal(false);
    expect(orch.start.called).to.equal(false);
  });

  it('a bad sessionIds entry is 400, before any lookup', async () => {
    for (const [sessionIds, error] of [
      [[], 'sessionIds must be a non-empty array of session ids'],
      ['sA', 'sessionIds must be a non-empty array of session ids'],
      [['sA', ''], 'each entry of sessionIds must be a non-empty string'],
      [['sA', 7], 'each entry of sessionIds must be a non-empty string'],
      [['sA', 'sA'], 'sessionIds names a session more than once'],
      [['sA', 'manual_usr_alice_U1'], 'sessionIds names a device hold, not a session'],
    ] as const) {
      const res = await post(alice, '', { sessionIds });
      expect(res.status, JSON.stringify(sessionIds)).to.equal(400);
      expect(res.body).to.deep.equal({ error });
    }
    expect(findDevices.called).to.equal(false);
    expect(ownerOf.called).to.equal(false);
    expect(orch.start.called).to.equal(false);
  });

  it("another user's session among the owner's is the unknown 404, nothing started", async () => {
    notFound(await post(alice, '', { sessionIds: ['sA', 'sBob'] }));
    notFound(await post(alice, '', { sessionIds: ['sA', 'nope'] }));
    expect(orch.start.callCount).to.equal(0);
  });

  it('an ownerless session is 404 to a member, allowed to an admin', async () => {
    notFound(await post(alice, '', { sessionIds: ['sOrphan'] }));
    expect(orch.start.callCount).to.equal(0);
    const res = await post(admin, '', { sessionIds: ['sOrphan', 'sBob'] });
    expect(res.status, JSON.stringify(res.body)).to.equal(202);
    expect(orch.start.firstCall.args[0]).to.deep.include({
      phones: [
        { udid: 'U5', host: 'http://127.0.0.1:4723' },
        { udid: 'U4', host: 'http://127.0.0.1:4723' },
      ],
      actorId: 'usr_root',
    });
  });

  it("a session on a phone the member's teams can't see is 404", async () => {
    notFound(await post(alice, '', { sessionIds: ['sHidden'] }));
    notFound(await post(alice, '', { sessionIds: ['sA', 'sHidden'] }));
    expect(orch.start.callCount).to.equal(0);
  });

  // The 404 comes before any answer that would name the phone.
  it('an own session on a hidden cloud phone is 404, not the cloud 409', async () => {
    phones.sHiddenCloud = { udid: 'HIDDEN-CLOUD', cloud: true };
    owners.sHiddenCloud = 'usr_alice';
    try {
      notFound(await post(alice, '', { sessionIds: ['sA', 'sHiddenCloud'] }));
      expect(orch.start.callCount).to.equal(0);
    } finally {
      delete phones.sHiddenCloud;
      delete owners.sHiddenCloud;
    }
  });

  it('two own sessions on one hidden phone are 404, not the duplicate 400', async () => {
    phones.sHiddenTwin = { udid: 'HIDDEN' };
    owners.sHiddenTwin = 'usr_alice';
    try {
      notFound(await post(alice, '', { sessionIds: ['sHidden', 'sHiddenTwin'] }));
      expect(orch.start.callCount).to.equal(0);
    } finally {
      delete phones.sHiddenTwin;
      delete owners.sHiddenTwin;
    }
  });

  // The team check reads the session's own row, not every row of its udid:
  // another server's phone of that udid says nothing about this one.
  it('reads the team from the session’s own row, with no lookup of its own', async () => {
    const filter = deviceService.filterRowsByVisibleDevice as sinon.SinonStub;
    const res = await post(alice, '', { sessionIds: ['sA'] });
    expect(res.status, JSON.stringify(res.body)).to.equal(202);
    expect(filter.called).to.equal(false);
  });

  it('two sessions on one phone are 400', async () => {
    phones.sTwin = { udid: 'U1' };
    owners.sTwin = 'usr_alice';
    try {
      const res = await post(alice, '', { sessionIds: ['sA', 'sTwin'] });
      expect(res.status, JSON.stringify(res.body)).to.equal(400);
      expect(res.body).to.deep.equal({ error: 'two sessions in sessionIds run on one phone' });
      expect(orch.start.callCount).to.equal(0);
    } finally {
      delete phones.sTwin;
      delete owners.sTwin;
    }
  });

  it('a cloud phone is 409 device_busy with reason cloud_phone', async () => {
    const res = await post(alice, '', { sessionIds: ['sA', 'sCloud'] });
    expect(res.status, JSON.stringify(res.body)).to.equal(409);
    expect(res.body).to.deep.equal({
      error: 'device_busy',
      busyDevices: [{ udid: 'CLOUD', reason: 'cloud_phone' }],
      message: '1 of 2 selected devices are busy. Recording was not started.',
    });
    expect(orch.start.callCount).to.equal(0);
  });

  // Recording goes by udid and host: the session's phone is recorded as
  // itself. Through 2.33 this was 409 device_busy, reason shared_udid.
  it("a phone whose udid another server's row carries is recorded as itself", async () => {
    findDevices.callsFake(async (filter: any) =>
      filter.udid === 'U3'
        ? [...rowsFor(filter), { udid: 'U3', host: 'http://node:4723', busy: false, teamId: 't1' }]
        : rowsFor(filter),
    );
    const res = await post(alice, '', { sessionIds: ['sA', 'sB'] });
    expect(res.status, JSON.stringify(res.body)).to.equal(202);
    expect(orch.start.firstCall.args[0].phones).to.deep.equal([
      { udid: 'U1', host: 'http://127.0.0.1:4723' },
      { udid: 'U3', host: 'http://127.0.0.1:4723' },
    ]);
  });

  it('a phone the member cannot see is the unknown 404, though its udid’s other phone is visible', async () => {
    findDevices.callsFake(async (filter: any) =>
      filter.udid === 'HIDDEN'
        ? [
            ...rowsFor(filter),
            { udid: 'HIDDEN', host: 'http://node:4723', busy: false, teamId: 't1' },
          ]
        : rowsFor(filter),
    );
    notFound(await post(alice, '', { sessionIds: ['sA', 'sHidden'] }));
    expect(orch.start.callCount).to.equal(0);
  });

  it('an owner lookup that fails is 503, never a start', async () => {
    ownerOf.rejects(new Error('database is down'));
    const res = await post(alice, '', { sessionIds: ['sA'] });
    expect(res.status, JSON.stringify(res.body)).to.equal(503);
    expect(res.body).to.deep.equal({
      error: 'ownership_unavailable',
      message: 'Could not check who owns these sessions. Try again.',
    });
    expect(orch.start.callCount).to.equal(0);
  });

  it('a store lookup that fails is 503, never a start', async () => {
    findDevices.rejects(new Error('store is down'));
    const res = await post(admin, '', { sessionIds: ['sA'] });
    expect(res.status, JSON.stringify(res.body)).to.equal(503);
    expect(res.body.error).to.equal('ownership_unavailable');
    expect(orch.start.callCount).to.equal(0);
  });

  it("the orchestrator's refusals are answered as for a udids start", async () => {
    orch.start.rejects(
      new RecordingError('device_busy', [{ udid: 'U3', reason: 'recording' } as any]),
    );
    const busy = await post(alice, '', { sessionIds: ['sA', 'sB'] });
    expect(busy.status).to.equal(409);
    expect(busy.body).to.deep.equal({
      error: 'device_busy',
      busyDevices: [{ udid: 'U3', reason: 'recording' }],
      message: '1 of 2 selected devices are busy. Recording was not started.',
    });
    orch.start.rejects(new RecordingError('concurrency_cap', undefined, 4, 4));
    const cap = await post(alice, '', { sessionIds: ['sA'] });
    expect(cap.status).to.equal(409);
    expect(cap.body).to.deep.equal({
      error: 'concurrency_cap',
      limit: 4,
      active: 4,
      message: 'Server-wide recording cap reached (4/4).',
    });
  });

  it('add-device on an observer group is 409 observer_group', async () => {
    const res = await post(alice, '/gObs/add-device', { udid: 'U3' });
    expect(res.status, JSON.stringify(res.body)).to.equal(409);
    expect(res.body).to.deep.equal({
      error: 'observer_group',
      message: 'An observer recording records the sessions it was started with.',
    });
  });

  it('a udids start is unchanged', async () => {
    const res = await post(alice, '', { udids: ['U1', 'U3'], sessionId: 'legacy', note: 'n' });
    expect(res.status, JSON.stringify(res.body)).to.equal(202);
    expect(orch.start.firstCall.args[0]).to.deep.equal({
      phones: [
        { udid: 'U1', host: 'http://127.0.0.1:4723' },
        { udid: 'U3', host: 'http://127.0.0.1:4723' },
      ],
      sessionId: 'legacy',
      note: 'n',
      actorId: 'usr_alice',
    });
    // Each phone by its udid (findPhone), never by a session's claim.
    expect(findDevices.args.map(([filter]) => filter)).to.deep.equal([
      { udid: 'U1' },
      { udid: 'U3' },
    ]);
    expect(ownerOf.called).to.equal(false);
    notFound(await post(alice, '', { udids: ['HIDDEN'] }));
  });
});
