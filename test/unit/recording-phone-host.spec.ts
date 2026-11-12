import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import * as fs from 'fs';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import { loopbackServers } from '../helpers/loopbackServer';
import { saveRegistrations } from '../helpers/container-registration';
import { useArtifactStore } from '../helpers/artifact-store';
import { useScratchDatabase } from '../helpers/scratch-database';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';
import RecordingsRouter from '../../src/app/routers/recordings';
import ControlRouter from '../../src/app/routers/control';
import {
  RecordingOrchestrator,
  compositeLayoutPath,
} from '../../src/services/recording/RecordingOrchestrator';
import { RecordingStore } from '../../src/services/recording/recording-store';
import { BusyPrecheck } from '../../src/services/recording/busy-precheck';
import { ConcurrencyGate } from '../../src/services/recording/concurrency-gate';
import {
  defaultObserverDeps,
  resolveObservedPhones,
} from '../../src/services/recording/observerSessions';
import { SessionOwnerResolver } from '../../src/services/device-access/SessionOwnerResolver';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import * as deviceService from '../../src/data-service/device-service';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import AndroidStreamService from '../../src/device-managers/android/AndroidStreamService';
import AndroidH264StreamService from '../../src/device-managers/android/AndroidH264StreamService';
import { scopesForRole } from '../../src/middleware/authMiddleware';

/**
 * Recordings name a phone by udid and host: emulator-5554 is every machine's
 * first emulator, so a hub with its own and a node with one has two phones
 * of that name. Each is recorded, held, busy-checked and stopped as itself.
 */
const E = 'emulator-5554';
const NODE = 'http://node.test:4723';
const HUB = 'http://hub.test:4723';
const ALICE = 'usr_alice';

type Role = 'MEMBER' | 'ADMIN' | 'SUPER_ADMIN';
interface Caller {
  userId: string;
  role?: Role;
  teamIds?: string[];
}

function withAuth(caller: Caller, register: (r: express.Router) => void) {
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
  register(api);
  app.use('/xenon/api', api);
  return app;
}

/** A store over these rows: by udid (and host when asked), and by claim. */
function storeOf(rows: any[]) {
  const match = (filter: any) =>
    rows.filter(
      (r) =>
        (filter.udid === undefined || r.udid === filter.udid) &&
        (filter.host === undefined || r.host === filter.host) &&
        (filter.claimSessionId === undefined || r.claimSessionId === filter.claimSessionId) &&
        (filter.session_id === undefined || r.session_id === filter.session_id),
    );
  return {
    findDevices: sinon.spy(async (filter: any) => match(filter)),
    // The first row wins, as the stores' own findDevice does by udid alone.
    findDevice: sinon.spy(async (filter: any) => match(filter)[0]),
  };
}

describe('recordings by udid and host', () => {
  describe('POST /recordings and add-device', () => {
    let orch: Record<string, sinon.SinonStub>;
    let rows: any[];
    let restore: () => void;

    beforeEach(() => {
      restore = saveRegistrations(RecordingStore, RecordingOrchestrator);
      rows = [
        { udid: E, host: NODE, teamId: 't1' },
        { udid: E, host: HUB, teamId: 't1' },
        { udid: 'R5CT', host: HUB, teamId: 't1' },
        { udid: 'HID', host: NODE, teamId: 't2' },
        { udid: 'HID', host: HUB, teamId: 't1' },
      ];
      sinon.stub(DeviceStoreFactory, 'getStore').returns(storeOf(rows) as any);
      Container.set(RecordingStore, {
        listGroupStarts: async (g: string) =>
          g === 'g1'
            ? [
                {
                  id: 'r1',
                  group_id: 'g1',
                  device_udid: 'R5CT',
                  started_at: new Date(),
                  started_by: ALICE,
                },
              ]
            : [],
      });
      sinon.stub(deviceService, 'filterRowsByVisibleDevice').callsFake(async (list: any[]) => list);
      orch = {
        start: sinon.stub().callsFake(async (input: any) => ({
          groupId: 'g-new',
          recordings: input.phones.map((p: any, i: number) => ({
            id: `r-${i}`,
            udid: p.udid,
            status: 'RECORDING',
          })),
          startedAt: new Date(0),
          compositeEnabled: input.phones.length > 1,
        })),
        addDevice: sinon
          .stub()
          .resolves({ recording: { id: 'r-add', udid: E, status: 'RECORDING' } }),
      };
      Container.set(RecordingOrchestrator, orch);
    });

    afterEach(() => {
      sinon.restore();
      restore();
    });

    const alice = { userId: ALICE, teamIds: ['t1'] };
    const post = (url: string, body: any, who: Caller = alice) =>
      request(withAuth(who, (r) => RecordingsRouter.register(r)))
        .post(`/xenon/api/recordings${url}`)
        .send(body);

    it('a udid two visible servers have is 409 ambiguous_phone, naming both, and starts nothing', async () => {
      const res = await post('', { udids: [E] });
      expect(res.status, JSON.stringify(res.body)).to.equal(409);
      expect(res.body).to.deep.equal({
        error: 'ambiguous_phone',
        message: `Two servers have a phone named ${E}. Name the one you mean with its host.`,
        hosts: [HUB, NODE],
      });
      const mixed = await post('', { udids: ['R5CT', E] });
      expect(mixed.status).to.equal(409);
      expect(orch.start.called).to.equal(false);
    });

    it('records both same-named phones, named by host, in one group', async () => {
      const res = await post('', {
        udids: [
          { udid: E, host: NODE },
          { udid: E, host: HUB },
        ],
      });
      expect(res.status, JSON.stringify(res.body)).to.equal(202);
      expect(orch.start.calledOnce).to.equal(true);
      expect(orch.start.firstCall.args[0]).to.deep.equal({
        phones: [
          { udid: E, host: NODE },
          { udid: E, host: HUB },
        ],
        sessionId: undefined,
        note: undefined,
        actorId: ALICE,
      });
    });

    it('a udid one server has records as before, with its host', async () => {
      const res = await post('', { udids: ['R5CT'] });
      expect(res.status, JSON.stringify(res.body)).to.equal(202);
      expect(orch.start.firstCall.args[0].phones).to.deep.equal([{ udid: 'R5CT', host: HUB }]);
    });

    it('a udid the member sees on one server only is that phone', async () => {
      const res = await post('', { udids: ['HID'] });
      expect(res.status, JSON.stringify(res.body)).to.equal(202);
      expect(orch.start.firstCall.args[0].phones).to.deep.equal([{ udid: 'HID', host: HUB }]);
    });

    it('a host that is not a non-empty string is 400 invalid_host', async () => {
      for (const host of ['', 7, null, ['a']]) {
        const res = await post('', { udids: [{ udid: E, host }] });
        expect(res.status, JSON.stringify(host)).to.equal(400);
        expect(res.body).to.deep.equal({ error: 'invalid_host' });
      }
      expect(orch.start.called).to.equal(false);
    });

    it('a bad entry is 400 with the old wording', async () => {
      for (const udids of [[{ host: NODE }], [{ udid: '', host: NODE }], [7]]) {
        const res = await post('', { udids });
        expect(res.status).to.equal(400);
        expect(res.body).to.deep.equal({ error: 'every udid must be a non-empty string' });
      }
    });

    it('a host the caller can’t see, or no row has, is the unknown 404', async () => {
      for (const entry of [
        { udid: 'HID', host: NODE },
        { udid: E, host: 'http://nowhere:4723' },
      ]) {
        const res = await post('', { udids: ['R5CT', entry] });
        expect(res.status, JSON.stringify(entry)).to.equal(404);
        expect(res.body).to.deep.equal({ error: 'not_found' });
      }
      expect(orch.start.called).to.equal(false);
    });

    it('the same phone twice is 400', async () => {
      const res = await post('', { udids: ['R5CT', { udid: 'R5CT', host: HUB }] });
      expect(res.status).to.equal(400);
      expect(res.body).to.deep.equal({ error: 'duplicate_phone' });
      expect(orch.start.called).to.equal(false);
    });

    it('add-device takes a host, and refuses an ambiguous udid', async () => {
      const ok = await post('/g1/add-device', { udid: E, host: NODE });
      expect(ok.status, JSON.stringify(ok.body)).to.equal(201);
      expect(orch.addDevice.firstCall.args).to.deep.equal(['g1', { udid: E, host: NODE }, ALICE]);

      const ambiguous = await post('/g1/add-device', { udid: E });
      expect(ambiguous.status).to.equal(409);
      expect(ambiguous.body.error).to.equal('ambiguous_phone');

      const bad = await post('/g1/add-device', { udid: E, host: '' });
      expect(bad.status).to.equal(400);
      expect(bad.body).to.deep.equal({ error: 'invalid_host' });

      const hidden = await post('/g1/add-device', { udid: 'HID', host: NODE });
      expect(hidden.status).to.equal(404);
      expect(orch.addDevice.calledOnce).to.equal(true);
    });
  });

  describe('GET /recordings/active', () => {
    // Its composite check resolves ARTIFACT_STORE, which the server registers at boot.
    useArtifactStore();
    let restore: () => void;

    beforeEach(() => {
      restore = saveRegistrations(RecordingStore);
    });
    afterEach(() => {
      sinon.restore();
      restore();
    });

    it('reads each phone’s hold by udid and host', async () => {
      // The node's phone (Bob's hold) is first: a lookup by udid alone finds it.
      const store = storeOf([
        { udid: E, host: NODE, session_id: `manual_usr_bob_${E}` },
        { udid: E, host: HUB, session_id: `manual_${ALICE}_${E}` },
      ]);
      sinon.stub(DeviceStoreFactory, 'getStore').returns(store as any);
      const active = (id: string, group: string, host: string) => ({
        id,
        group_id: group,
        device_udid: E,
        device_host: host,
        started_at: new Date(0),
        started_by: null,
        annotations: [],
      });
      Container.set(RecordingStore, {
        listActiveWithMarks: async () => [active('rn', 'gNode', NODE), active('rh', 'gHub', HUB)],
        listGroupStarts: async () => [],
      });
      const res = await request(
        withAuth({ userId: ALICE }, (r) => RecordingsRouter.register(r)),
      ).get('/xenon/api/recordings/active');
      expect(res.status, JSON.stringify(res.body)).to.equal(200);
      expect(res.body.groups.map((g: any) => g.groupId)).to.deep.equal(['gHub']);
    });
  });

  describe('the orchestrator', () => {
    useArtifactStore();
    afterEach(() => sinon.restore());

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
        finalize: sinon.stub().resolves({}),
        listActive: sinon.stub().resolves([]),
        listGroup: sinon.stub().callsFake(async () => rows),
      };
    }

    it('gives two same-named phones each its own source, hold, row and release', async () => {
      const close = sinon.stub().resolves();
      const nodeSourceFn = sinon
        .stub()
        .callsFake(async (phone: any) => (phone.host === NODE ? { port: 5555, close } : null));
      const ensureMjpegPortFn = sinon.stub().resolves(9100);
      const blockDeviceFn = sinon.stub().resolves();
      const unblockDeviceFn = sinon.stub().resolves();
      const leaveDeviceFn = sinon.stub();
      const findBusy = sinon.stub().resolves([]);
      const store = rowStore();
      const videoPipeline = {
        startRecording: sinon.stub().resolves(),
        stopRecording: sinon.stub().resolves('/tmp/x.mp4'),
        startComposite: sinon.stub().resolves({ cellW: 540, cellH: 960, cols: 2, rows: 1 }),
        stopComposite: sinon.stub().resolves(null),
      };
      const orch = new RecordingOrchestrator({
        busyPrecheck: { findBusy } as any,
        store: store as any,
        gate: new ConcurrencyGate(4) as any,
        videoPipeline: videoPipeline as any,
        eventMgr: {
          emitRecordingStarted: sinon.stub(),
          emitRecordingStopped: sinon.stub(),
          emitRecordingFailed: sinon.stub(),
        } as any,
        blockDeviceFn,
        unblockDeviceFn,
        ensureMjpegPortFn,
        nodeSourceFn,
        leaveDeviceFn,
        // The mp4s are fakes: their size is never read as playable.
        probeDurationMsFn: async () => 1000,
      });
      const phones = [
        { udid: E, host: NODE },
        { udid: E, host: HUB },
      ];

      const { groupId, recordings } = await orch.start({ phones, actorId: ALICE });

      expect(findBusy.firstCall.args[0]).to.deep.equal(phones);
      expect(nodeSourceFn.getCalls().map((c) => c.args)).to.deep.equal([
        [phones[0], ALICE],
        [phones[1], ALICE],
      ]);
      expect(ensureMjpegPortFn.getCalls().map((c) => c.args)).to.deep.equal([[E, HUB]]);
      expect(blockDeviceFn.getCalls().map((c) => c.args)).to.deep.equal([
        [E, NODE, `manual_${ALICE}_${E}`],
        [E, HUB, `manual_${ALICE}_${E}`],
      ]);
      expect(store.rows.map((r) => r.device_host)).to.deep.equal([NODE, HUB]);
      expect(
        videoPipeline.startComposite.firstCall.args[0].inputs.map((i: any) => i.mjpegPort),
      ).to.deep.equal([5555, 9100]);
      const layout = JSON.parse(fs.readFileSync(compositeLayoutPath(groupId), 'utf8'));
      expect(layout.cells.map((c: any) => c.recordingId)).to.deep.equal(
        recordings.map((r) => r.id),
      );

      await orch.stop(groupId);
      expect(close.calledOnce).to.equal(true);
      expect(unblockDeviceFn.getCalls().map((c) => c.args)).to.deep.equal([[E, NODE]]);
      expect(leaveDeviceFn.getCalls().map((c) => c.args)).to.deep.equal([[E]]);
    });

    it('add-device holds, reads and records the named phone', async () => {
      const blockDeviceFn = sinon.stub().resolves();
      const nodeSourceFn = sinon.stub().resolves(null);
      const ensureMjpegPortFn = sinon.stub().resolves(9100);
      const findBusy = sinon.stub().resolves([]);
      const store = rowStore();
      const orch = new RecordingOrchestrator({
        busyPrecheck: { findBusy } as any,
        store: store as any,
        gate: new ConcurrencyGate(4) as any,
        videoPipeline: {
          startRecording: sinon.stub().resolves(),
        } as any,
        eventMgr: { emitRecordingStarted: sinon.stub() } as any,
        blockDeviceFn,
        unblockDeviceFn: sinon.stub().resolves(),
        ensureMjpegPortFn,
        nodeSourceFn,
        leaveDeviceFn: sinon.stub(),
      });

      await orch.addDevice('grp', { udid: E, host: HUB }, ALICE);

      expect(findBusy.firstCall.args[0]).to.deep.equal([{ udid: E, host: HUB }]);
      expect(blockDeviceFn.firstCall.args.slice(0, 2)).to.deep.equal([E, HUB]);
      expect(nodeSourceFn.firstCall.args[0]).to.deep.equal({ udid: E, host: HUB });
      expect(ensureMjpegPortFn.firstCall.args).to.deep.equal([E, HUB]);
      expect(store.rows[0].device_host).to.equal(HUB);
    });
  });

  describe('RecordingStore', () => {
    const scratch = useScratchDatabase();
    const store = new RecordingStore();

    afterEach(async () => {
      await scratch.db.recording.deleteMany({ where: { group_id: { startsWith: 'phost-' } } });
    });

    it('isRecording and activeRecordingFor count the named host only', async () => {
      await store.create({
        id: 'phost-1',
        groupId: 'phost-g1',
        deviceUdid: E,
        deviceHost: NODE,
        filePath: '/tmp/phost-1.mp4',
        sessionId: null,
        deviceSnapshot: null,
      });
      expect(await store.isRecording(E, NODE)).to.equal(true);
      expect(await store.isRecording(E, HUB)).to.equal(false);
      expect(await store.activeRecordingFor(E, NODE)).to.deep.equal({
        id: 'phost-1',
        groupId: 'phost-g1',
      });
      expect(await store.activeRecordingFor(E, HUB)).to.equal(null);
    });
  });

  describe('the busy check', () => {
    it('reads each phone by udid and host', async () => {
      // The hub's own phone runs a session; the node's is free.
      const store = storeOf([
        { udid: E, host: HUB, busy: true, session_id: 'appium-1' },
        { udid: E, host: NODE, busy: false, session_id: null },
      ]);
      const isRecording = sinon.stub().resolves(false);
      const pc = new BusyPrecheck(
        store,
        { isRecording },
        {
          find: async () => null,
          holderOf: async () => null,
        },
      );

      expect(await pc.findBusy([{ udid: E, host: NODE }], ALICE)).to.deep.equal([]);
      expect(isRecording.firstCall.args).to.deep.equal([E, NODE]);
      expect(await pc.findBusy([{ udid: E, host: HUB }], ALICE)).to.deep.equal([
        { udid: E, reason: 'automation', sessionId: 'appium-1' },
      ]);
    });

    it('keys the observed sessions by udid and host', async () => {
      const store = storeOf([
        { udid: E, host: HUB, busy: true, session_id: 'S-hub', claimSessionId: 'S-hub' },
        { udid: E, host: NODE, busy: true, claimSessionId: 'S-node' },
      ]);
      const pc = new BusyPrecheck(
        store,
        { isRecording: async () => false },
        { find: async () => null, holderOf: async () => null },
      );
      const observed = new Map([[`${E}@${NODE}`, 'S-node']]);
      expect(
        await pc.findBusy([{ udid: E, host: NODE }], ALICE, undefined, observed),
      ).to.deep.equal([]);
    });
  });

  describe('observer recordings', () => {
    it('record a session on the node’s phone while the hub has one of that name', async () => {
      const nodeRow = { udid: E, host: NODE, busy: true, claimSessionId: 'S1' } as any;
      const out = await resolveObservedPhones(
        ['S1'],
        { userId: ALICE, isAdmin: false },
        {
          findClaimedDevices: async () => [nodeRow],
          ownerOf: async () => ALICE,
          canSee: async () => true,
        },
      );
      expect(out).to.deep.equal({ ok: true, phones: [{ sessionId: 'S1', udid: E, host: NODE }] });
      expect(Object.keys(defaultObserverDeps())).to.not.include('udidIsShared');
    });

    describe('through the route', () => {
      let orch: Record<string, sinon.SinonStub>;
      let restore: () => void;

      beforeEach(() => {
        restore = saveRegistrations(RecordingStore, RecordingOrchestrator, SessionOwnerResolver);
        sinon.stub(DeviceStoreFactory, 'getStore').returns(
          storeOf([
            { udid: E, host: HUB, busy: false, teamId: 't1' },
            { udid: E, host: NODE, busy: true, claimSessionId: 'S1', teamId: 't1' },
            { udid: 'X', host: NODE, busy: true, claimSessionId: 'S2', teamId: 't2' },
            { udid: 'X', host: HUB, busy: false, teamId: 't1' },
          ]) as any,
        );
        Container.set(SessionOwnerResolver, { ownerOf: async () => ALICE } as any);
        orch = {
          start: sinon.stub().callsFake(async (input: any) => ({
            groupId: 'g-obs',
            recordings: input.phones.map((p: any, i: number) => ({
              id: `r-${i}`,
              udid: p.udid,
              status: 'RECORDING',
              sessionId: input.observe[i].sessionId,
            })),
            startedAt: new Date(0),
            compositeEnabled: false,
          })),
        };
        Container.set(RecordingOrchestrator, orch);
      });
      afterEach(() => {
        sinon.restore();
        restore();
      });

      const post = (body: any) =>
        request(withAuth({ userId: ALICE, teamIds: ['t1'] }, (r) => RecordingsRouter.register(r)))
          .post('/xenon/api/recordings')
          .send(body);

      it('starts the recording: no shared_udid refusal', async () => {
        const res = await post({ sessionIds: ['S1'] });
        expect(res.status, JSON.stringify(res.body)).to.equal(202);
        expect(orch.start.firstCall.args[0]).to.deep.equal({
          phones: [{ udid: E, host: NODE }],
          observe: [{ sessionId: 'S1', udid: E, host: NODE }],
          note: undefined,
          actorId: ALICE,
        });
      });

      // The team check reads the session's own phone, not any phone of its udid.
      it('a session on another team’s phone is 404 though the udid’s other phone is visible', async () => {
        const res = await post({ sessionIds: ['S2'] });
        expect(res.status, JSON.stringify(res.body)).to.equal(404);
        expect(res.body).to.deep.equal({ error: 'not_found' });
        expect(orch.start.called).to.equal(false);
      });
    });
  });

  describe('stream/stop', () => {
    useOwnNodeId();
    const loopback = loopbackServers();
    let restore: () => void;
    let androidStop: sinon.SinonStub;
    let activeRecordingFor: sinon.SinonStub;

    beforeEach(() => {
      restore = saveRegistrations(
        ApiKeyService,
        AndroidStreamService,
        AndroidH264StreamService,
        IOSStreamService,
        RecordingStore,
      );
      // The node's emulator is being recorded; the hub's own is not.
      sinon.stub(DeviceStoreFactory, 'getStore').returns(
        storeOf([
          {
            udid: E,
            host: NODE,
            nodeId: 'node-1',
            platform: 'android',
            busy: true,
            session_id: `manual_${ALICE}_${E}`,
          },
          {
            udid: E,
            host: HUB,
            nodeId: OWN_NODE_ID,
            platform: 'android',
            busy: true,
            session_id: `manual_${ALICE}_${E}`,
          },
        ]) as any,
      );
      sinon.stub(deviceService, 'unblockDevice').resolves();
      androidStop = sinon.stub().resolves();
      Container.set(ApiKeyService, new ApiKeyService());
      Container.set(AndroidStreamService, { stopStream: androidStop } as any);
      Container.set(AndroidH264StreamService, { stop: sinon.stub().resolves() } as any);
      Container.set(IOSStreamService, { stopStream: sinon.stub().resolves() } as any);
      activeRecordingFor = sinon
        .stub()
        .callsFake(async (_udid: string, host: string) =>
          host === NODE ? { id: 'rec-n', groupId: 'g-node' } : null,
        );
      Container.set(RecordingStore, { activeRecordingFor } as any);
    });

    afterEach(async () => {
      sinon.restore();
      restore();
      await loopback.closeAll();
    });

    const stop = async (host: string) =>
      request(
        await loopback.serve(withAuth({ userId: ALICE }, (r) => ControlRouter.register(r))),
      ).post(`/xenon/api/control/${E}/stream/stop?host=${encodeURIComponent(host)}`);

    it('is refused for the host being recorded', async () => {
      const res = await stop(NODE);
      expect(res.status, JSON.stringify(res.body)).to.equal(409);
      expect(res.body).to.deep.include({ error: 'device_recording', groupId: 'g-node' });
      expect(activeRecordingFor.lastCall.args).to.deep.equal([E, NODE]);
    });

    it('stops the other host’s phone of that name', async () => {
      const res = await stop(HUB);
      expect(res.status, JSON.stringify(res.body)).to.equal(200);
      expect(activeRecordingFor.lastCall.args).to.deep.equal([E, HUB]);
      expect(androidStop.calledOnceWith(E)).to.equal(true);
    });
  });
});
