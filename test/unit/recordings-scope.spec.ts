import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { Container } from 'typedi';
import RecordingsRouter from '../../src/app/routers/recordings';
import { RecordingOrchestrator } from '../../src/services/recording/RecordingOrchestrator';
import { RecordingStore } from '../../src/services/recording/recording-store';
import { SessionOwnerResolver } from '../../src/services/device-access/SessionOwnerResolver';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import * as deviceService from '../../src/data-service/device-service';
import { saveRegistrations } from '../helpers/container-registration';

const T0 = Date.parse('2026-11-12T10:00:00.000Z');

function buildApp(scopes: string, role = 'MEMBER') {
  const app = express();
  app.use(express.json());
  const api = express.Router();
  api.use((req, _res, next) => {
    (req as any).auth = {
      kind: 'api-key',
      userId: 'usr_alice',
      role,
      scopes,
      teamIds: ['t1'],
      rateLimit: 100,
    };
    next();
  });
  RecordingsRouter.register(api);
  app.use('/xenon/api', api);
  return app;
}

/**
 * Which scope a recording write takes (ENH-06, decided 2026-11-12): a
 * recording of the caller's own sessions, and every write on such a group,
 * take `sessions` or `devices`; a recording of phones and its group take
 * `devices`, as before. A member's own tokens carry `sessions` and `read`.
 * gObs is an observer group, gUdid a recording of phones.
 */
describe('recording writes: the sessions scope for observer recordings', () => {
  let orch: Record<string, sinon.SinonStub>;
  let restoreRegistrations: () => void;

  const groupRow = (groupId: string) => ({
    id: `r-${groupId}`,
    group_id: groupId,
    device_udid: 'U1',
    started_at: new Date(T0),
    started_by: 'usr_alice',
  });

  beforeEach(() => {
    restoreRegistrations = saveRegistrations(
      RecordingStore,
      RecordingOrchestrator,
      SessionOwnerResolver,
    );
    Container.set(RecordingStore, {
      listGroupStarts: async (groupId: string) => [groupRow(groupId)],
      findVideo: async (id: string) => (id.startsWith('r-') ? groupRow(id.slice(2)) : null),
    });
    orch = {
      start: sinon.stub().callsFake(async (input: any) => ({
        groupId: input.observe ? 'gObs' : 'gUdid',
        recordings: input.phones.map(({ udid }: { udid: string }, i: number) => ({
          id: `r-${i}`,
          udid,
          status: 'RECORDING',
          sessionId: input.observe?.[i]?.sessionId,
        })),
        startedAt: new Date(T0),
        compositeEnabled: false,
      })),
      stop: sinon.stub().callsFake(async (groupId: string) => ({
        groupId,
        recordings: [{ id: `r-${groupId}`, udid: 'U1', status: 'STOPPED' }],
      })),
      addBookmark: sinon.stub().resolves({ id: 'b1' }),
      addDevice: sinon.stub().resolves({ recording: { id: 'r-x', udid: 'U2' } }),
      clearAnnotations: sinon.stub().resolves({ cleared: 0 }),
      isObserverGroup: sinon
        .stub()
        .callsFake((groupId: string) => groupId === 'gObs' || groupId === 'gBob'),
      observerGroupStarter: sinon
        .stub()
        .callsFake((groupId: string) => ({ gObs: 'usr_alice', gBob: 'usr_bob' })[groupId]),
    };
    Container.set(RecordingOrchestrator, orch);
    Container.set(SessionOwnerResolver, { ownerOf: async () => 'usr_alice' } as any);
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevices: async (filter: any) => {
        const id = filter.claimSessionId ?? filter.session_id;
        // U1 runs sA; a phone is found by its udid too (findPhone).
        return id === 'sA' || filter.udid === 'U1'
          ? [{ udid: 'U1', host: 'http://127.0.0.1:4723', busy: true, claimSessionId: 'sA' }]
          : [];
      },
    } as any);
    sinon.stub(deviceService, 'filterRowsByVisibleDevice').callsFake(async (list: any[]) => list);
  });

  afterEach(() => {
    sinon.restore();
    restoreRegistrations();
  });

  const member = () => buildApp('sessions,read');

  it("a member's own token starts a recording of their sessions", async () => {
    const res = await request(member())
      .post('/xenon/api/recordings')
      .send({ sessionIds: ['sA'] });
    expect(res.status, JSON.stringify(res.body)).to.equal(202);
    expect(orch.start.calledOnce).to.equal(true);
  });

  it('and stops and marks that observer group', async () => {
    const stop = await request(member()).post('/xenon/api/recordings/gObs/stop').send({});
    expect(stop.status, JSON.stringify(stop.body)).to.equal(200);
    expect(orch.stop.calledOnceWith('gObs')).to.equal(true);

    const mark = await request(member())
      .post('/xenon/api/recordings/gObs/bookmark')
      .send({ recordingId: 'r-gObs', timecodeMs: 1000, label: 'Paid' });
    expect(mark.status, JSON.stringify(mark.body)).to.equal(201);
  });

  it('and clears that group’s marks', async () => {
    const res = await request(member())
      .post('/xenon/api/recordings/gObs/annotations/clear')
      .send({ timecodeMs: 1000 });
    expect(res.status, JSON.stringify(res.body)).to.not.equal(403);
    expect(orch.observerGroupStarter.calledWith('gObs')).to.equal(true);
  });

  // Whoever started an observer group can finish it; with only `sessions`,
  // nobody else can. gBob is Bob's observer group.
  it('but not another user’s observer group: stop, marks and clearing marks are 403', async () => {
    const app = member();
    const answers = [
      await request(app).post('/xenon/api/recordings/gBob/stop').send({}),
      await request(app)
        .post('/xenon/api/recordings/gBob/bookmark')
        .send({ recordingId: 'r-gBob', timecodeMs: 1000, label: 'Paid' }),
      await request(app)
        .post('/xenon/api/recordings/gBob/annotations/clear')
        .send({ timecodeMs: 1000 }),
      await request(app).delete('/xenon/api/recordings/gBob'),
    ];
    for (const res of answers) {
      expect(res.status, JSON.stringify(res.body)).to.equal(403);
      expect(res.body).to.deep.equal({ error: 'insufficient scope' });
    }
    expect(orch.stop.called).to.equal(false);
    expect(orch.addBookmark.called).to.equal(false);
    expect(orch.clearAnnotations.called).to.equal(false);
  });

  it('a super admin with only sessions may write any observer group', async () => {
    const res = await request(buildApp('sessions,read', 'SUPER_ADMIN'))
      .post('/xenon/api/recordings/gBob/stop')
      .send({});
    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    expect(orch.stop.calledOnceWith('gBob')).to.equal(true);
  });

  it('the devices scope still writes another user’s observer group', async () => {
    const res = await request(buildApp('devices')).post('/xenon/api/recordings/gBob/stop').send({});
    expect(res.status, JSON.stringify(res.body)).to.equal(200);
  });

  it('but not a recording of phones, or a write on one', async () => {
    const app = member();
    const answers = [
      await request(app)
        .post('/xenon/api/recordings')
        .send({ udids: ['U1'] }),
      await request(app).post('/xenon/api/recordings/gUdid/add-device').send({ udid: 'U2' }),
      await request(app).post('/xenon/api/recordings/gUdid/stop').send({}),
    ];
    for (const res of answers) {
      expect(res.status, JSON.stringify(res.body)).to.equal(403);
      expect(res.body).to.deep.equal({ error: 'insufficient scope' });
    }
    expect(orch.start.called).to.equal(false);
    expect(orch.addDevice.called).to.equal(false);
    expect(orch.stop.called).to.equal(false);
  });

  it('a read-only token still records nothing', async () => {
    const res = await request(buildApp('read'))
      .post('/xenon/api/recordings')
      .send({ sessionIds: ['sA'] });
    expect(res.status).to.equal(403);
    expect(res.body).to.deep.equal({ error: 'insufficient scope' });
    const stop = await request(buildApp('read')).post('/xenon/api/recordings/gObs/stop').send({});
    expect(stop.status).to.equal(403);
    expect(orch.start.called || orch.stop.called).to.equal(false);
  });

  it('the devices scope does both, without asking which kind of group it is', async () => {
    const app = buildApp('devices');
    expect(
      (
        await request(app)
          .post('/xenon/api/recordings')
          .send({ udids: ['U1'] })
      ).status,
    ).to.equal(202);
    expect((await request(app).post('/xenon/api/recordings/gUdid/stop').send({})).status).to.equal(
      200,
    );
    expect(orch.isObserverGroup.called).to.equal(false);
    expect(orch.observerGroupStarter.called).to.equal(false);
  });
});
