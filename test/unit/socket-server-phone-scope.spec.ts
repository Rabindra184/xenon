import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { SocketServer } from '../../src/services/SocketServer';
import { EventLogService } from '../../src/services/EventLogService';
import { DeviceTeamResolver } from '../../src/services/device-access/DeviceTeamResolver';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * A udid two servers report (emulator-5554 on a hub and on its node) is two
 * phones, each with its own team. A live event about one is delivered by its
 * udid and host, so it reaches that phone's team only; an event that names
 * only the udid of two phones reaches admins only, as findPhone finds the
 * udid ambiguous.
 */

const UDID = 'emulator-5554';
const H1 = 'http://h1:4723';
const H2 = 'http://h2:4723';

type Received = Array<[string, any]>;

/** The slice of a Socket.io server the scoped emit reads (as socketServer.scopedEmit.spec.ts). */
function fakeIo(specs: Array<{ id: string; teamIds: string[] | undefined }>) {
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
    dashboard.add(s.id);
  }
  const io = {
    sockets: { adapter: { rooms: new Map([['dashboard', dashboard]]) }, sockets },
    to: () => ({
      emit(event: string, data: any) {
        for (const id of dashboard) sockets.get(id).emit(event, data);
      },
    }),
  };
  return { io, inbox: (id: string): Received => received.get(id) ?? [] };
}

const events = (r: Received) => r.map(([e]) => e);

describe('SocketServer.emitToDashboardForDevices — a phone is its udid and host', () => {
  let restore: () => void;
  let server: SocketServer;
  let rows: Array<{ host: string; teamId: string | null }>;

  function connect() {
    const fake = fakeIo([
      { id: 'admin', teamIds: undefined },
      { id: 'member-a', teamIds: ['A'] },
      { id: 'member-b', teamIds: ['B'] },
    ]);
    (server as any).io = fake.io;
    return fake;
  }

  beforeEach(() => {
    restore = saveRegistrations(EventLogService, DeviceTeamResolver);
    Container.set(EventLogService, { appendSafe: sinon.spy() } as any);
    rows = [
      { host: H1, teamId: 'A' },
      { host: H2, teamId: 'B' },
    ];
    Container.set(
      DeviceTeamResolver,
      new DeviceTeamResolver({
        findRows: async (udid: string) => (udid === UDID ? rows.map((r) => ({ ...r })) : []),
      }),
    );
    server = new SocketServer();
  });

  afterEach(() => {
    sinon.restore();
    restore();
  });

  it("{ udid, host }: the h1 phone's event reaches team A's socket, not team B's", async () => {
    const { inbox } = connect();
    await server.emitToDashboardForDevices('session_started', {}, { udid: UDID, host: H1 });
    expect(events(inbox('member-a'))).to.deep.equal(['session_started']);
    expect(inbox('member-b')).to.deep.equal([]);
    expect(events(inbox('admin'))).to.deep.equal(['session_started']);
  });

  it("{ udid, host }: the h2 phone's event reaches team B's socket, not team A's", async () => {
    const { inbox } = connect();
    await server.emitToDashboardForDevices('session_started', {}, { udid: UDID, host: H2 });
    expect(events(inbox('member-b'))).to.deep.equal(['session_started']);
    expect(inbox('member-a')).to.deep.equal([]);
  });

  it('{ udid } of a udid on two hosts reaches admins only', async () => {
    const { inbox } = connect();
    await server.emitToDashboardForDevices('session_started', {}, { udid: UDID });
    expect(events(inbox('admin'))).to.deep.equal(['session_started']);
    expect(inbox('member-a')).to.deep.equal([]);
    expect(inbox('member-b')).to.deep.equal([]);
  });

  it("{ udid } of a udid on one host is that phone's", async () => {
    rows = [{ host: H1, teamId: 'A' }];
    const { inbox } = connect();
    await server.emitToDashboardForDevices('session_started', {}, { udid: UDID });
    expect(events(inbox('member-a'))).to.deep.equal(['session_started']);
    expect(inbox('member-b')).to.deep.equal([]);
  });

  it('{ udid, host, teamId }: the row in hand is noted for that phone only', async () => {
    const { inbox } = connect();
    // The store says team A for h1; the device event's row says team C. A
    // note that leaked onto h2 (team B) would hide h2's event from team B.
    await server.emitToDashboardForDevices(
      'device_added',
      { host: H1 },
      { udid: UDID, host: H1, teamId: 'C' },
    );
    await server.emitToDashboardForDevices(
      'session_started',
      { host: H1 },
      { udid: UDID, host: H1 },
    );
    await server.emitToDashboardForDevices(
      'session_started',
      { host: H2 },
      { udid: UDID, host: H2 },
    );
    expect(inbox('member-b')).to.deep.equal([['session_started', { host: H2 }]]);
    expect(inbox('member-a'), "h1 is team C now, not the store's A").to.deep.equal([]);
    expect(events(inbox('admin'))).to.deep.equal([
      'device_added',
      'session_started',
      'session_started',
    ]);
  });

  it("{ udid, host } of a host no row has reaches the udid's only row's team", async () => {
    // A mark on a recording whose phone's server has changed address since.
    rows = [{ host: H1, teamId: 'A' }];
    const { inbox } = connect();
    await server.emitToDashboardForDevices(
      'recording_bookmark_added',
      {},
      { udid: UDID, host: 'http://h1-old:4723' },
    );
    expect(events(inbox('member-a'))).to.deep.equal(['recording_bookmark_added']);
    expect(inbox('member-b')).to.deep.equal([]);
  });

  it('{ udid, host } of a host no row has stays admins only when two rows have the udid', async () => {
    const { inbox } = connect();
    await server.emitToDashboardForDevices(
      'recording_bookmark_added',
      {},
      { udid: UDID, host: 'http://h3:4723' },
    );
    expect(events(inbox('admin'))).to.deep.equal(['recording_bookmark_added']);
    expect(inbox('member-a')).to.deep.equal([]);
    expect(inbox('member-b')).to.deep.equal([]);
  });

  it('{ phones, strip }: each socket gets the payload cut to the phones it sees', async () => {
    const { inbox } = connect();
    const payload = {
      groupId: 'g1',
      recordings: [
        { id: 'r1', udid: UDID, host: H1 },
        { id: 'r2', udid: UDID, host: H2 },
      ],
    };
    const strip = sinon.spy(
      (data: typeof payload, visible: Array<{ udid: string; host?: string | null }>) => ({
        ...data,
        recordings: data.recordings.filter((r) =>
          visible.some((v) => v.udid === r.udid && v.host === r.host),
        ),
      }),
    );
    await server.emitToDashboardForDevices('recording_started', payload, {
      phones: payload.recordings.map((r) => ({ udid: r.udid, host: r.host })),
      strip,
    });

    expect(strip.calledWith(payload, [{ udid: UDID, host: H1 }])).to.equal(true);
    expect(inbox('member-a')[0][1].recordings.map((r: any) => r.id)).to.deep.equal(['r1']);
    expect(inbox('member-b')[0][1].recordings.map((r: any) => r.id)).to.deep.equal(['r2']);
    expect(inbox('admin')[0][1], 'an admin gets the payload untouched').to.equal(payload);
  });
});
