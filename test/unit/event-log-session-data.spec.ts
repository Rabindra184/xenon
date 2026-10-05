import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { SocketServer } from '../../src/services/SocketServer';
import { EventLogService } from '../../src/services/EventLogService';
import { PrismaService } from '../../src/data-service/prisma-service';
import { InterceptorService } from '../../src/services/InterceptorService';
import { SelectorStateService } from '../../src/services/SelectorStateService';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SocketEvents } from '../../src/enums/SocketEvents';
import type { CapturedRequest } from '../../src/services/interceptor/types';
import { useScratchDatabase } from '../helpers/scratch-database';
import { saveRegistrations } from '../helpers/container-registration';

/** What a session's data may carry: the app's sign-in, its cookies, a password typed, personal data. */
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

describe("The event log keeps no copy of a session's own data", () => {
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

  const live = (event: string) =>
    broadcast.filter(([name]) => name === event).map(([, data]) => data);

  describe('a captured request', () => {
    it('reaches the live dashboard whole, and the EventLog table never', async () => {
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
      expect(live(SocketEvents.INTERCEPTOR_REQUEST)).to.deep.equal([
        capturedRequest('q1'),
        capturedRequest('q2'),
      ]);
    });
  });

  describe('a command', () => {
    const SESSION = 's2';

    beforeEach(async () => {
      await scratch.db.sessionLog.deleteMany({});
      await scratch.db.session.deleteMany({});
      await scratch.db.session.create({
        data: {
          id: SESSION,
          desired_capabilities: '{}',
          session_capabilities: '{}',
          node_id: 'node',
          has_live_video: false,
          device_udid: 'phone-a',
          device_platform: 'android',
          device_version: '14',
        },
      });
      sinon.stub(SESSION_MANAGER, 'getSession').returns({
        getId: () => SESSION,
        getDevice: () => ({ udid: 'phone-a', name: 'P', platform: 'android' }),
        getXenonOption: () => undefined,
        getScreenShot: async () => '',
      } as any);
      sinon.stub(SelectorStateService.prototype, 'onHealRecorded').resolves(null);
    });

    function command(
      name: string,
      args: unknown[],
      answer: unknown,
      healed?: Parameters<typeof DASHBORD_EVENT_MANAGER.afterSessionCommand>[6],
    ) {
      return DASHBORD_EVENT_MANAGER.afterSessionCommand(
        SESSION,
        name,
        null,
        { body: args, method: 'POST', path: `/${name}`, originalUrl: `/${name}` } as any,
        {} as any,
        JSON.stringify({ value: answer, sessionId: SESSION }),
        healed,
      );
    }

    it('logs and sends which command ran and how it went, never what it typed or answered', async () => {
      const pageSource = '<hierarchy><node text="jane@example.com"/></hierarchy>';
      await command('setValue', ['hunter2', 'element-1'], null);
      await command('getPageSource', [], pageSource);
      await command(
        'findElement',
        ['xpath', '//*[@text="Pay"]'],
        { ELEMENT: 'e' },
        {
          originalSelector: '//*[@text="Pay"]',
          originalStrategy: 'xpath',
          healedSelector: 'pay_button',
          healedStrategy: 'id',
          confidence: 0.9,
          tier: 2,
        },
      );

      // Three commands and the heal's own event.
      const rows = await eventLogRows(4);
      const commands = rows
        .filter((r) => r.type === SocketEvents.SESSION_COMMAND)
        .map((r) => JSON.parse(r.payload));

      expect(commands.map((c) => c.command_name)).to.have.members([
        'setValue',
        'getPageSource',
        'findElement',
      ]);
      for (const row of rows) {
        for (const secret of SECRETS) expect(row.payload).to.not.include(secret);
      }
      for (const logged of commands) {
        expect(logged).to.not.have.any.keys('body', 'response', 'screenshot', 'url');
        expect(logged).to.include({ session_id: SESSION, is_success: true, is_error: false });
      }
      // What a reader of the log needs from a heal is there.
      expect(commands.find((c) => c.command_name === 'findElement')).to.include({
        is_healed: true,
        original_strategy: 'xpath',
        original_selector: '//*[@text="Pay"]',
        healed_strategy: 'id',
        healed_selector: 'pay_button',
        healing_confidence: 0.9,
        healing_tier: 'Fuzzy XML',
      });

      // The session's own record, which goes with the session, keeps them.
      const sessionLog = await scratch.db.sessionLog.findMany({ where: { session_id: SESSION } });
      expect(sessionLog.find((l) => l.command_name === 'setValue')?.body).to.include('hunter2');
      expect(sessionLog.find((l) => l.command_name === 'getPageSource')?.response).to.include(
        'jane@example.com',
      );

      // The live event is the same summary. It reaches every dashboard that
      // can see the phone, and no client reads more (the dashboard and Xenon
      // Studio don't subscribe to it).
      const sent = live(SocketEvents.SESSION_COMMAND);
      expect(sent.map((c) => c.command_name)).to.deep.equal([
        'setValue',
        'getPageSource',
        'findElement',
      ]);
      for (const summary of sent) {
        for (const secret of SECRETS) expect(JSON.stringify(summary)).to.not.include(secret);
        expect(summary).to.deep.equal(
          commands.find((c) => c.command_name === summary.command_name),
        );
      }
    });
  });

  it("every other event is logged once and whole, by either emit; a command's own fields are named", async () => {
    const server = Container.get(SocketServer);
    server.emitToDashboard(SocketEvents.INTERCEPTOR_REQUEST, capturedRequest('q3'));
    await server.emitToDashboardForDevices(
      SocketEvents.INTERCEPTOR_REQUEST,
      capturedRequest('q4'),
      { udid: 'phone-a' },
    );
    expect(appendSafe.called).to.equal(false);

    const payload = { session_id: 's', command_name: 'click', body: '["hunter2"]', extra: 1 };
    const others = Object.values(SocketEvents).filter(
      (event) => event !== SocketEvents.INTERCEPTOR_REQUEST,
    );
    for (const event of others) {
      await server.emitToDashboardForDevices(event, payload, { udid: 'phone-a' });
    }
    server.emitToDashboard(SocketEvents.SESSION_COMMAND, payload);

    expect(appendSafe.getCalls().map((c) => c.args[0])).to.deep.equal([
      ...others.map((event) => ({
        type: event,
        payload:
          event === SocketEvents.SESSION_COMMAND
            ? { session_id: 's', command_name: 'click' }
            : payload,
      })),
      { type: SocketEvents.SESSION_COMMAND, payload: { session_id: 's', command_name: 'click' } },
    ]);
    // The writes are fire-and-forget: let them land here, or they land in the
    // next test's table after its beforeEach emptied it.
    expect(await eventLogRows(others.length + 1)).to.have.length(others.length + 1);
  });
});
