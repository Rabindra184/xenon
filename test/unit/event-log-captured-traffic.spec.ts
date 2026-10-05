import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { SocketServer } from '../../src/services/SocketServer';
import { EventLogService } from '../../src/services/EventLogService';
import { PrismaService } from '../../src/data-service/prisma-service';
import { InterceptorService } from '../../src/services/InterceptorService';
import { SocketEvents } from '../../src/enums/SocketEvents';
import type { CapturedRequest } from '../../src/services/interceptor/types';
import { useScratchDatabase } from '../helpers/scratch-database';
import { saveRegistrations } from '../helpers/container-registration';

/** What a captured request may carry: the app's sign-in, its cookies and personal data. */
const SECRETS = [
  'Bearer eyJ-app-access-token',
  'sid=app-session-cookie',
  'hunter2',
  'jane@example.com',
];

function capturedRequest(id: string): CapturedRequest {
  return {
    id,
    sessionId: 's1',
    ts: 1_700_000_000_000,
    method: 'POST',
    url: 'https://api.example.com/v1/login',
    host: 'api.example.com',
    path: '/v1/login',
    reqHeaders: { authorization: 'Bearer eyJ-app-access-token', cookie: 'sid=app-session-cookie' },
    reqBody: JSON.stringify({ email: 'jane@example.com', password: 'hunter2' }),
    resStatus: 200,
    resHeaders: { 'set-cookie': 'sid=app-session-cookie; HttpOnly' },
    resBody: JSON.stringify({ user: { email: 'jane@example.com' } }),
    durationMs: 12,
    mocked: false,
    modified: false,
  };
}

/** A socket.io server with no dashboard socket: the room broadcast, recorded. */
function fakeIo() {
  const broadcast: Array<[string, any]> = [];
  const io = {
    sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
    to: () => ({ emit: (event: string, data: any) => broadcast.push([event, data]) }),
  };
  return { io, broadcast };
}

describe("The event log keeps no copy of an app's captured traffic", () => {
  const scratch = useScratchDatabase();

  let restore: () => void;
  let eventLogEnv: string | undefined;
  let appendSafe: sinon.SinonSpy;
  let broadcast: Array<[string, any]>;

  beforeEach(async () => {
    restore = saveRegistrations(SocketServer, EventLogService);
    // The log must be on, or "no row" would prove nothing.
    eventLogEnv = process.env.XENON_EVENT_LOG;
    delete process.env.XENON_EVENT_LOG;
    await scratch.db.eventLog.deleteMany({});

    const eventLog = new EventLogService(new PrismaService());
    appendSafe = sinon.spy(eventLog, 'appendSafe');
    Container.set(EventLogService, eventLog);

    const server = new SocketServer();
    const fake = fakeIo();
    (server as any).io = fake.io;
    broadcast = fake.broadcast;
    Container.set(SocketServer, server);
  });

  afterEach(() => {
    sinon.restore();
    restore();
    if (eventLogEnv === undefined) delete process.env.XENON_EVENT_LOG;
    else process.env.XENON_EVENT_LOG = eventLogEnv;
  });

  /** Waits for the fire-and-forget writes of `count` rows, then lets any later one land. */
  async function eventLogRows(count: number) {
    const deadline = Date.now() + 5_000;
    while ((await scratch.db.eventLog.count()) < count && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    await new Promise((r) => setTimeout(r, 50));
    return scratch.db.eventLog.findMany();
  }

  it('a captured request reaches the live dashboard whole, and the EventLog table never', async () => {
    const svc = new InterceptorService();
    const emit = (evt: any) => (svc as any).emit(evt, 'phone-a');
    emit({ type: 'session_started', sessionId: 's1', port: 9100, host: '10.0.2.2' });
    emit({ type: 'request', sessionId: 's1', payload: capturedRequest('q1') });
    emit({ type: 'request', sessionId: 's1', payload: capturedRequest('q2') });
    emit({ type: 'session_stopped', sessionId: 's1' });

    const rows = await eventLogRows(2);

    // Written in the same millisecond, so in no particular order.
    expect(rows.map((r) => r.type)).to.have.members([
      SocketEvents.INTERCEPTOR_SESSION_STARTED,
      SocketEvents.INTERCEPTOR_SESSION_STOPPED,
    ]);
    for (const row of rows) {
      for (const secret of SECRETS) expect(row.payload).to.not.include(secret);
    }
    expect(appendSafe.getCalls().map((c) => c.args[0].type)).to.not.include(
      SocketEvents.INTERCEPTOR_REQUEST,
    );

    // The session page's Network panel still gets the whole entry, live.
    const live = broadcast.filter(([event]) => event === SocketEvents.INTERCEPTOR_REQUEST);
    expect(live.map(([, data]) => data)).to.deep.equal([
      capturedRequest('q1'),
      capturedRequest('q2'),
    ]);
  });

  it('by either emit, and every other dashboard event is still logged once', async () => {
    const server = Container.get(SocketServer);
    server.emitToDashboard(SocketEvents.INTERCEPTOR_REQUEST, capturedRequest('q3'));
    await server.emitToDashboardForDevices(
      SocketEvents.INTERCEPTOR_REQUEST,
      capturedRequest('q4'),
      { udid: 'phone-a' },
    );
    expect(appendSafe.called).to.equal(false);

    const others = Object.values(SocketEvents).filter(
      (event) => event !== SocketEvents.INTERCEPTOR_REQUEST,
    );
    for (const event of others) {
      await server.emitToDashboardForDevices(event, { event }, { udid: 'phone-a' });
    }
    expect(appendSafe.getCalls().map((c) => c.args[0])).to.deep.equal(
      others.map((event) => ({ type: event, payload: { event } })),
    );
  });
});
