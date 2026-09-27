import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { SocketServer } from '../../src/services/SocketServer';
import { EventLogService } from '../../src/services/EventLogService';
import { DeviceTeamResolver } from '../../src/services/device-access/DeviceTeamResolver';
import { RecordingStore } from '../../src/services/recording/recording-store';
import { NotificationService } from '../../src/services/NotificationService';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import {
  addNewDevice,
  blockDevice,
  removeDevice,
  unblockDeviceMatchingFilter,
  updateDeviceProgress,
} from '../../src/data-service/device-service';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { config } from '../../src/config';
import { saveRegistrations } from '../helpers/container-registration';

type Received = Array<[string, any]>;

interface FakeSocketSpec {
  id: string;
  /** undefined = admin / auth disabled. */
  teamIds: string[] | undefined;
  /** False for a socket that never joined 'dashboard' (a node). */
  dashboard?: boolean;
}

/**
 * The slice of a Socket.io server the scoped emit reads: the local
 * 'dashboard' room, each socket's `data.identity`, `socket.emit`, and
 * `io.to(room).emit` for the unscoped path.
 */
function fakeIo(specs: FakeSocketSpec[]) {
  const received = new Map<string, Received>();
  const sockets = new Map<string, any>();
  const dashboard = new Set<string>();
  for (const s of specs) {
    const inbox: Received = [];
    received.set(s.id, inbox);
    sockets.set(s.id, {
      id: s.id,
      data: {
        identity: {
          principal: 'dashboard',
          userId: `user-${s.id}`,
          role: s.teamIds === undefined ? 'ADMIN' : 'MEMBER',
          teamIds: s.teamIds,
        },
      },
      emit: (event: string, data: any) => inbox.push([event, data]),
    });
    if (s.dashboard !== false) dashboard.add(s.id);
  }
  const roomBroadcasts: string[] = [];
  const io = {
    sockets: { adapter: { rooms: new Map([['dashboard', dashboard]]) }, sockets },
    to(room: string) {
      return {
        emit(event: string, data: any) {
          roomBroadcasts.push(room);
          const ids = room === 'dashboard' ? dashboard : new Set<string>();
          for (const id of ids) sockets.get(id).emit(event, data);
        },
      };
    },
  };
  const inbox = (id: string): Received => received.get(id) ?? [];
  /** The socket leaves the dashboard room, as a disconnect does. */
  const leave = (id: string) => dashboard.delete(id);
  return { io, inbox, roomBroadcasts, leave };
}

const events = (r: Received) => r.map(([e]) => e);

describe('SocketServer.emitToDashboardForDevices — events reach only the teams that see the phone', () => {
  const DEVICES: Record<string, { teamId: string | null }> = {
    'phone-a': { teamId: 'team-a' },
    'phone-b': { teamId: 'team-b' },
    'phone-s': { teamId: null },
  };

  let restore: () => void;
  let server: SocketServer;
  let appendSafe: sinon.SinonSpy;
  let lookups: string[];
  /** While set, every store lookup waits for it. */
  let gate: Promise<void> | undefined;
  let openGate: () => void;
  function holdLookups() {
    gate = new Promise<void>((resolve) => (openGate = resolve));
  }

  function connect(specs: FakeSocketSpec[]) {
    const fake = fakeIo(specs);
    (server as any).io = fake.io;
    return fake;
  }

  beforeEach(() => {
    restore = saveRegistrations(EventLogService, DeviceTeamResolver);
    appendSafe = sinon.spy();
    Container.set(EventLogService, { appendSafe } as any);
    lookups = [];
    gate = undefined;
    Container.set(
      DeviceTeamResolver,
      new DeviceTeamResolver({
        findDevice: async (udid: string) => {
          lookups.push(udid);
          if (gate) await gate;
          return DEVICES[udid] ? { udid, ...DEVICES[udid] } : null;
        },
      }),
    );
    server = new SocketServer();
  });

  afterEach(() => {
    sinon.restore();
    restore();
  });

  const EVERYONE: FakeSocketSpec[] = [
    { id: 'admin', teamIds: undefined },
    { id: 'member-a', teamIds: ['team-a'] },
    { id: 'member-b', teamIds: ['team-b'] },
    { id: 'member-none', teamIds: [] },
    { id: 'node', teamIds: ['team-b'], dashboard: false },
  ];

  it("{ udid }: a team's phone reaches that team's members and admins only", async () => {
    const { inbox } = connect(EVERYONE);
    await server.emitToDashboardForDevices('session_command', { n: 1 }, { udid: 'phone-b' });
    expect(events(inbox('admin'))).to.deep.equal(['session_command']);
    expect(events(inbox('member-b'))).to.deep.equal(['session_command']);
    expect(inbox('member-a')).to.deep.equal([]);
    expect(inbox('member-none')).to.deep.equal([]);
    expect(inbox('node'), 'never outside the dashboard room').to.deep.equal([]);
  });

  it('{ udid }: a shared phone reaches every dashboard socket', async () => {
    const { inbox } = connect(EVERYONE);
    await server.emitToDashboardForDevices('session_started', { id: 's1' }, { udid: 'phone-s' });
    for (const id of ['admin', 'member-a', 'member-b', 'member-none']) {
      expect(inbox(id), id).to.deep.equal([['session_started', { id: 's1' }]]);
    }
    expect(inbox('node')).to.deep.equal([]);
  });

  it('{ udid }: an unknown phone fails closed, reaching admins only', async () => {
    const { inbox } = connect(EVERYONE);
    await server.emitToDashboardForDevices('session_stopped', { id: 's1' }, { udid: 'ghost' });
    await server.emitToDashboardForDevices('session_stopped', { id: 's2' }, { udid: '' });
    expect(events(inbox('admin'))).to.deep.equal(['session_stopped', 'session_stopped']);
    for (const id of ['member-a', 'member-b', 'member-none']) {
      expect(inbox(id), id).to.deep.equal([]);
    }
  });

  it("{ udid, teamId }: a device event uses the row's own team, with no lookup", async () => {
    const { inbox } = connect(EVERYONE);
    // The store would say team-a; the row in hand says team-b and wins.
    await server.emitToDashboardForDevices(
      'device_added',
      { udid: 'phone-a', teamId: 'team-b' },
      { udid: 'phone-a', teamId: 'team-b' },
    );
    expect(lookups).to.deep.equal([]);
    expect(events(inbox('member-b'))).to.deep.equal(['device_added']);
    expect(inbox('member-a')).to.deep.equal([]);
  });

  it('{ udid, teamId }: the device event refreshes the resolver for the events after it', async () => {
    const { inbox } = connect(EVERYONE);
    await server.emitToDashboardForDevices(
      'device_added',
      {},
      { udid: 'new-phone', teamId: 'team-a' },
    );
    await server.emitToDashboardForDevices('session_started', {}, { udid: 'new-phone' });
    expect(lookups, 'known from the device event').to.deep.equal([]);
    expect(events(inbox('member-a'))).to.deep.equal(['device_added', 'session_started']);
  });

  it('{ udids, strip }: each socket gets the payload cut to its own phones', async () => {
    const { inbox } = connect(EVERYONE);
    const payload = {
      groupId: 'g1',
      recordings: [
        { id: 'r-a', udid: 'phone-a' },
        { id: 'r-b', udid: 'phone-b' },
        { id: 'r-s', udid: 'phone-s' },
      ],
    };
    const strip = sinon.spy((data: typeof payload, visible: string[]) => ({
      ...data,
      recordings: data.recordings.filter((r) => visible.includes(r.udid)),
    }));
    await server.emitToDashboardForDevices('recording_started', payload, {
      udids: ['phone-a', 'phone-b', 'phone-s'],
      strip,
    });

    const ids = (id: string) => inbox(id)[0][1].recordings.map((r: any) => r.id);
    expect(ids('member-a')).to.deep.equal(['r-a', 'r-s']);
    expect(ids('member-b')).to.deep.equal(['r-b', 'r-s']);
    expect(ids('member-none')).to.deep.equal(['r-s']);
    expect(inbox('admin')[0][1], 'an admin gets the payload untouched').to.equal(payload);
    expect(payload.recordings, 'the original is never mutated').to.have.length(3);
    expect(strip.args.map((a) => a[1])).to.deep.include(['phone-a', 'phone-s']);
  });

  it('{ udids, strip }: a socket that sees none of the phones gets nothing', async () => {
    const { inbox } = connect(EVERYONE);
    const payload = { groupId: 'g2', recordings: [{ id: 'r-b', udid: 'phone-b' }] };
    await server.emitToDashboardForDevices('recording_stopped', payload, {
      udids: ['phone-b'],
      strip: (d: any, visible: string[]) => ({
        ...d,
        recordings: d.recordings.filter((r: any) => visible.includes(r.udid)),
      }),
    });
    expect(inbox('member-a')).to.deep.equal([]);
    expect(inbox('member-none')).to.deep.equal([]);
    expect(events(inbox('member-b'))).to.deep.equal(['recording_stopped']);
    expect(events(inbox('admin'))).to.deep.equal(['recording_stopped']);
  });

  it('records each event in the event log once, unscoped, even when no one may see it', async () => {
    connect(EVERYONE);
    const payload = { id: 's1' };
    await server.emitToDashboardForDevices('session_started', payload, { udid: 'ghost' });
    expect(appendSafe.callCount).to.equal(1);
    expect(appendSafe.firstCall.args[0]).to.deep.equal({ type: 'session_started', payload });
  });

  it('with only unscoped sockets (auth disabled) it broadcasts to the room as before, with no lookup', async () => {
    const { inbox, roomBroadcasts } = connect([
      { id: 'lab-1', teamIds: undefined },
      { id: 'lab-2', teamIds: undefined },
    ]);
    await server.emitToDashboardForDevices('session_command', { n: 1 }, { udid: 'phone-b' });
    expect(roomBroadcasts).to.deep.equal(['dashboard']);
    expect(lookups).to.deep.equal([]);
    expect(events(inbox('lab-1'))).to.deep.equal(['session_command']);
    expect(events(inbox('lab-2'))).to.deep.equal(['session_command']);
  });

  it('with no dashboard socket it looks nothing up, and still logs', async () => {
    connect([{ id: 'node', teamIds: [], dashboard: false }]);
    await server.emitToDashboardForDevices('session_command', {}, { udid: 'phone-b' });
    expect(lookups).to.deep.equal([]);
    expect(appendSafe.callCount).to.equal(1);
  });

  it('before initialize() (no io) it only logs', async () => {
    await server.emitToDashboardForDevices('session_command', {}, { udid: 'phone-b' });
    expect(lookups).to.deep.equal([]);
    expect(appendSafe.callCount).to.equal(1);
  });

  it('a socket with no identity is treated as a member of no team', async () => {
    const { io, inbox } = fakeIo([{ id: 'odd', teamIds: [] }]);
    io.sockets.sockets.get('odd').data = {};
    (server as any).io = io;
    await server.emitToDashboardForDevices('session_command', {}, { udid: 'phone-b' });
    await server.emitToDashboardForDevices('session_command', {}, { udid: 'phone-s' });
    expect(inbox('odd')).to.have.length(1);
  });

  it('per-command events cost one lookup per phone, not one per command, and keep their order', async () => {
    const { inbox } = connect(EVERYONE);
    const sends: Array<Promise<void>> = [];
    for (let n = 0; n < 25; n++) {
      sends.push(server.emitToDashboardForDevices('session_command', { n }, { udid: 'phone-a' }));
    }
    await Promise.all(sends);
    expect(lookups).to.deep.equal(['phone-a']);
    expect(inbox('member-a').map(([, d]) => d.n)).to.deep.equal(
      Array.from({ length: 25 }, (_, n) => n),
    );
  });

  it('never rejects: a strip that throws is logged, not thrown at the caller', async () => {
    connect(EVERYONE);
    await server.emitToDashboardForDevices(
      'recording_started',
      {},
      {
        udids: ['phone-a'],
        strip: () => {
          throw new Error('bad strip');
        },
      },
    );
  });

  describe('one phone, one delivery order', () => {
    it('device_blocked then device_unblocked arrive in that order, though the first waits on a lookup', async () => {
      const { inbox } = connect(EVERYONE);
      holdLookups();
      const blocked = server.emitToDashboardForDevices('device_blocked', {}, { udid: 'phone-a' });
      // The row is in hand, so this one needs no lookup; it must still wait its turn.
      const unblocked = server.emitToDashboardForDevices(
        'device_unblocked',
        {},
        { udid: 'phone-a', teamId: 'team-a' },
      );
      await new Promise((r) => setImmediate(r));
      expect(inbox('admin'), 'nothing overtakes the pending event').to.deep.equal([]);
      openGate();
      await Promise.all([blocked, unblocked]);
      for (const id of ['admin', 'member-a']) {
        expect(events(inbox(id)), id).to.deep.equal(['device_blocked', 'device_unblocked']);
      }
      expect(inbox('member-b')).to.deep.equal([]);
    });

    it('session_command then session_stopped arrive in order after the only member disconnects', async () => {
      const { inbox, leave } = connect([
        { id: 'admin', teamIds: undefined },
        { id: 'member-a', teamIds: ['team-a'] },
      ]);
      holdLookups();
      const command = server.emitToDashboardForDevices('session_command', {}, { udid: 'phone-a' });
      leave('member-a');
      // No scoped socket is left, but the command ahead of it is still pending.
      const stopped = server.emitToDashboardForDevices('session_stopped', {}, { udid: 'phone-a' });
      expect(inbox('admin'), 'no synchronous overtake').to.deep.equal([]);
      openGate();
      await Promise.all([command, stopped]);
      expect(events(inbox('admin'))).to.deep.equal(['session_command', 'session_stopped']);
    });

    it('a group event waits for its phones, and their next events wait for it', async () => {
      const { inbox } = connect(EVERYONE);
      holdLookups();
      const failed = server.emitToDashboardForDevices('recording_failed', {}, { udid: 'phone-a' });
      const stopped = server.emitToDashboardForDevices(
        'recording_stopped',
        { recordings: [] },
        { udids: ['phone-a', 'phone-s'], strip: (d: any) => d },
      );
      const unblocked = server.emitToDashboardForDevices(
        'device_unblocked',
        {},
        { udid: 'phone-s', teamId: null },
      );
      openGate();
      await Promise.all([failed, stopped, unblocked]);
      expect(events(inbox('admin'))).to.deep.equal([
        'recording_failed',
        'recording_stopped',
        'device_unblocked',
      ]);
    });

    it('once nothing is pending and no scoped socket is left, it is the synchronous broadcast again', async () => {
      const { inbox, leave, roomBroadcasts } = connect([
        { id: 'admin', teamIds: undefined },
        { id: 'member-a', teamIds: ['team-a'] },
      ]);
      await server.emitToDashboardForDevices('session_command', {}, { udid: 'phone-a' });
      leave('member-a');
      void server.emitToDashboardForDevices('session_stopped', {}, { udid: 'phone-a' });
      expect(events(inbox('admin'))).to.deep.equal(['session_command', 'session_stopped']);
      expect(roomBroadcasts).to.deep.equal(['dashboard']);
    });
  });

  describe('a lookup that hangs', () => {
    it("times out: that event fails closed (admins only), and the phone's next event follows it", async () => {
      Container.set(
        DeviceTeamResolver,
        new DeviceTeamResolver({
          findDevice: () => new Promise(() => undefined), // never settles
          lookupTimeoutMs: 20,
        }),
      );
      const { inbox } = connect(EVERYONE);
      const command = server.emitToDashboardForDevices('session_command', {}, { udid: 'phone-a' });
      const unblocked = server.emitToDashboardForDevices(
        'device_unblocked',
        {},
        { udid: 'phone-a', teamId: 'team-a' },
      );
      await Promise.all([command, unblocked]);
      expect(events(inbox('admin'))).to.deep.equal(['session_command', 'device_unblocked']);
      expect(events(inbox('member-a'))).to.deep.equal(['device_unblocked']);
    });
  });

  it('emitToDashboard (selector events, nodes) stays unscoped', () => {
    const { inbox } = connect(EVERYONE);
    server.emitToDashboard('selector_fixed', { selector: '//x' });
    for (const id of ['admin', 'member-a', 'member-b', 'member-none']) {
      expect(events(inbox(id)), id).to.deep.equal(['selector_fixed']);
    }
    expect(lookups).to.deep.equal([]);
  });
});

describe('Auth disabled: the lab path looks nothing up', () => {
  let restore: () => void;
  let authDisabled: boolean;
  let findDevice: sinon.SinonSpy;
  let findVideo: sinon.SinonSpy;
  let fake: ReturnType<typeof fakeIo>;

  beforeEach(() => {
    authDisabled = config.authDisabled;
    config.authDisabled = true;
    restore = saveRegistrations(
      SocketServer,
      EventLogService,
      DeviceTeamResolver,
      RecordingStore,
      NotificationService,
      'LocalStorage',
    );
    Container.set(EventLogService, { appendSafe: () => undefined } as any);
    Container.set(NotificationService, { dispatchEvent: () => undefined } as any);
    Container.set('LocalStorage', { getItem: () => null, setItem: () => undefined });
    findDevice = sinon.spy(async () => ({ teamId: 'team-a' }));
    Container.set(DeviceTeamResolver, new DeviceTeamResolver({ findDevice }));
    findVideo = sinon.spy(async () => ({ device_udid: 'phone-a' }));
    Container.set(RecordingStore, { findVideo } as any);
    const row = { udid: 'phone-a', host: 'h', teamId: 'team-a' };
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      removeDevices: async () => undefined,
      addDevices: async () => [row],
      updateDevice: async () => undefined,
      getDevices: async () => [{ ...row, sessionStartTime: 0, totalUtilizationTimeMilliSec: 0 }],
    } as any);
    const server = new SocketServer();
    Container.set(SocketServer, server);
    // Every socket on an auth-disabled server is unscoped.
    fake = fakeIo([
      { id: 'lab-1', teamIds: undefined },
      { id: 'lab-2', teamIds: undefined },
    ]);
    (server as any).io = fake.io;
  });

  afterEach(() => {
    sinon.restore();
    restore();
    config.authDisabled = authDisabled;
  });

  it('device and mark events: no store or recording lookup, each broadcast as it is emitted', async () => {
    await removeDevice([{ udid: 'phone-a', host: 'h' }]);
    await addNewDevice([{ udid: 'phone-a', host: 'h' } as any]);
    await blockDevice('phone-a', 'h', 'sess-1');
    await updateDeviceProgress('phone-a', 'h', 'installing');
    await unblockDeviceMatchingFilter({ udid: 'phone-a' });
    DASHBORD_EVENT_MANAGER.emitRecordingBookmark({
      groupId: 'g',
      bookmark: { recording_id: 'r1' },
    });
    DASHBORD_EVENT_MANAGER.emitRecordingAnnotation({
      groupId: 'g',
      annotation: { recording_id: 'r1' },
    });

    expect(findDevice.callCount, 'device store lookups').to.equal(0);
    expect(findVideo.callCount, 'recording lookups').to.equal(0);
    const expected = [
      'device_removed',
      'device_added',
      'device_blocked',
      'device_progress',
      'device_unblocked',
      'recording_bookmark_added',
      'recording_annotation_added',
    ];
    expect(events(fake.inbox('lab-1'))).to.deep.equal(expected);
    expect(events(fake.inbox('lab-2'))).to.deep.equal(expected);
    expect(fake.roomBroadcasts).to.have.length(expected.length);
  });
});
