import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import http from 'http';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { Container } from 'typedi';
import { io as connectClient, Socket as ClientSocket } from 'socket.io-client';
import { SocketServer } from '../../src/services/SocketServer';
import { EventLogService } from '../../src/services/EventLogService';
import { JWT_CLOCK_TOLERANCE_SEC, JwtKeyService } from '../../src/services/token/JwtKeyService';
import { verifyBearerCredential } from '../../src/middleware/verifyCredential';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserSessionService } from '../../src/services/UserSessionService';
import { DeviceTeamResolver } from '../../src/services/device-access/DeviceTeamResolver';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { addNewDevice } from '../../src/data-service/device-service';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { NotificationService } from '../../src/services/NotificationService';
import { InterceptorService } from '../../src/services/InterceptorService';
import { SelectorStateService } from '../../src/services/SelectorStateService';
import { SelectorVisibilityResolver } from '../../src/services/selector-health/SelectorVisibilityResolver';
import { prisma } from '../../src/prisma';
import { config as xenonConfig } from '../../src/config';
import { usersRouter } from '../../src/app/routers/users';
import { teamsRouter } from '../../src/app/routers/teams';
import { apiKeysRouter } from '../../src/app/routers/apikeys';
import { authPublicRouter } from '../../src/app/routers/auth';
import { saveRegistrations } from '../helpers/container-registration';
import request from '../helpers/loopbackRequest';
import { useScratchDatabase } from '../helpers/scratch-database';
import { UserService } from '../../src/services/UserService';
import { identityChanged } from '../../src/services/identity/identityChanges';
import { SEL, TEAM, USER, seedSelectorHealth } from '../helpers/selector-health-fixture';

/**
 * A real Socket.io server (SocketServer.initialize on a real http server) and
 * two real socket.io clients: a team-A member and an admin, both connecting
 * the way the IDE extension does, with a bearer JWT. Events are produced by
 * the real emitters (device-service's addNewDevice and the event manager's
 * afterSessionCommand), so this covers the handshake identity, the room, the
 * scoped emit and the call sites together.
 *
 * "Did not receive" is proved by delivery: one step sends a phone's event to
 * every socket that may see it, so once the admin holds all four events, a
 * team-B event the member was going to get would already be there.
 */
describe('Live dashboard events are team-scoped (real Socket.io, two clients)', () => {
  const USERS: Record<string, { status: string; role: string }> = {
    'u-member-a': { status: 'ACTIVE', role: 'MEMBER' },
    'u-admin': { status: 'ACTIVE', role: 'ADMIN' },
  };
  const DEVICES: Record<string, { teamId: string | null }> = {
    'phone-a': { teamId: 'team-a' },
    'phone-b': { teamId: 'team-b' },
  };

  let httpServer: http.Server;
  let server: SocketServer;
  let url: string;
  let dir: string;
  let restore: () => void;
  let authDisabled: boolean;
  const clients: ClientSocket[] = [];

  async function connect(
    userId: string,
  ): Promise<{ socket: ClientSocket; inbox: Array<[string, any]> }> {
    const bearer = await Container.get(JwtKeyService).sign(
      { sub: userId },
      { audience: 'xenon-rest', ttlSeconds: 60 },
    );
    const socket = connectClient(url, {
      auth: { bearer },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    clients.push(socket);
    const inbox: Array<[string, any]> = [];
    socket.onAny((event: string, data: any) => inbox.push([event, data]));
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    socket.emit('register_dashboard');
    return { socket, inbox };
  }

  async function until(check: () => boolean, what: string, ms = 3000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  const dashboardRoomSize = () =>
    (server as any).io?.sockets.adapter.rooms.get('dashboard')?.size ?? 0;

  function fakeSession(udid: string) {
    return {
      getId: () => `session-on-${udid}`,
      getDevice: () => ({ udid, name: udid, platform: 'android' }),
      getXenonOption: () => undefined,
      getScreenShot: async () => '',
    };
  }

  async function sessionCommand(udid: string) {
    (SESSION_MANAGER.getSession as sinon.SinonStub).returns(fakeSession(udid));
    await DASHBORD_EVENT_MANAGER.afterSessionCommand(
      `session-on-${udid}`,
      'getText',
      null,
      { body: {}, method: 'GET', originalUrl: '/text' } as any,
      {} as any,
      JSON.stringify({ value: null }),
    );
  }

  beforeEach(async () => {
    authDisabled = xenonConfig.authDisabled;
    xenonConfig.authDisabled = false;
    restore = saveRegistrations(
      SocketServer,
      EventLogService,
      JwtKeyService,
      ApiKeyService,
      DeviceTeamResolver,
      NotificationService,
    );

    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-socket-scope-'));
    const keys = new JwtKeyService();
    await keys.init(dir);
    Container.set(JwtKeyService, keys);
    Container.set(ApiKeyService, { verifyPair: async () => null, verify: async () => null } as any);
    Container.set(EventLogService, { appendSafe: () => undefined } as any);
    Container.set(NotificationService, { dispatchEvent: () => undefined } as any);
    Container.set(
      DeviceTeamResolver,
      new DeviceTeamResolver({
        findDevice: async (udid: string) => (DEVICES[udid] ? { udid, ...DEVICES[udid] } : null),
      }),
    );

    sinon
      .stub(prisma.user, 'findUnique')
      .callsFake(((args: any) => Promise.resolve(USERS[args.where.id] ?? null)) as any);
    sinon
      .stub(prisma.teamMember, 'findMany')
      .callsFake(((args: any) =>
        Promise.resolve(args.where.userId === 'u-member-a' ? [{ teamId: 'team-a' }] : [])) as any);
    sinon
      .stub(prisma.sessionLog, 'create' as any)
      .resolves({ id: 'log-1', createdAt: new Date() } as any);
    sinon.stub(SESSION_MANAGER, 'getSession');
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      addDevices: async (rows: any[]) => rows.map((r) => ({ ...r, ...DEVICES[r.udid] })),
    } as any);

    server = new SocketServer();
    Container.set(SocketServer, server);
    httpServer = http.createServer();
    server.initialize(httpServer);
    await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await new Promise<void>((r) =>
      (server as any).io ? (server as any).io.close(() => r()) : r(),
    );
    await new Promise<void>((r) => httpServer.close(() => r()));
    sinon.restore();
    restore();
    xenonConfig.authDisabled = authDisabled;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a team-B device_added and a session command on a team-B phone reach only the admin; team-A ones reach both', async () => {
    const member = await connect('u-member-a');
    const admin = await connect('u-admin');
    await until(() => dashboardRoomSize() === 2, 'both clients in the dashboard room');

    await addNewDevice([{ udid: 'phone-b', host: 'h' } as any]);
    await sessionCommand('phone-b');
    await addNewDevice([{ udid: 'phone-a', host: 'h' } as any]);
    await sessionCommand('phone-a');

    await until(() => admin.inbox.length >= 4, 'the admin to get all four events');
    await until(() => member.inbox.length >= 2, "the member to get team A's two events");
    // Give any stray delivery a moment to land before asserting its absence.
    await new Promise((r) => setTimeout(r, 50));

    // Order is kept per phone; two phones' events may interleave.
    const onPhone = (inbox: Array<[string, any]>, udid: string) =>
      inbox
        .filter(([, data]) => data.udid === udid || data.session_id === `session-on-${udid}`)
        .map(([event]) => event);
    expect(admin.inbox).to.have.length(4);
    expect(onPhone(admin.inbox, 'phone-b')).to.deep.equal(['device_added', 'session_command']);
    expect(onPhone(admin.inbox, 'phone-a')).to.deep.equal(['device_added', 'session_command']);
    expect(member.inbox).to.have.length(2);
    expect(onPhone(member.inbox, 'phone-a')).to.deep.equal(['device_added', 'session_command']);
  });

  it("a request captured on the member's own team phone reaches the admin only", async () => {
    const member = await connect('u-member-a');
    const admin = await connect('u-admin');
    await until(() => dashboardRoomSize() === 2, 'both clients in the dashboard room');

    // The headers and bodies of a captured request can carry the app's
    // sign-in tokens; REST's /interceptor routes are admin-only.
    const captured = {
      id: 'q1',
      sessionId: 'session-on-phone-a',
      reqHeaders: { authorization: 'Bearer app-secret' },
      resHeaders: { 'set-cookie': 'sid=app-secret' },
    };
    const interceptor = new InterceptorService();
    (interceptor as any).emit(
      { type: 'session_started', sessionId: 'session-on-phone-a', port: 1, host: 'h' },
      'phone-a',
    );
    (interceptor as any).emit(
      { type: 'request', sessionId: captured.sessionId, payload: captured },
      'phone-a',
    );
    (interceptor as any).emit(
      { type: 'session_stopped', sessionId: captured.sessionId },
      'phone-a',
    );
    // A member's event on the same phone, sent after them, proves the
    // member's socket is live: one chain delivers the phone's events in order.
    await sessionCommand('phone-a');

    await until(() => admin.inbox.length >= 4, 'the admin to get all four events');
    await until(() => member.inbox.length >= 1, 'the member to get the session command');
    await new Promise((r) => setTimeout(r, 50));

    expect(admin.inbox.map(([event]) => event)).to.deep.equal([
      'interceptor_session_started',
      'interceptor_request',
      'interceptor_session_stopped',
      'session_command',
    ]);
    expect(admin.inbox[1][1]).to.deep.equal(captured);
    expect(member.inbox.map(([event]) => event)).to.deep.equal(['session_command']);
  });
});

/**
 * Selector Health's live events, on a real Socket.io server and a real
 * (scratch) database seeded with Selector Health's own fixture: Priya is on
 * team A, Alex on team B. A selector reaches a member only if it healed in a
 * session they may see, as `GET /healing/selectors` decides.
 */
describe('Selector events reach only those who may see the selector (real Socket.io, real database)', () => {
  const scratch = useScratchDatabase();
  const ADMIN_ID = 'sh-u-admin';

  let httpServer: http.Server;
  let server: SocketServer;
  let url: string;
  let dir: string;
  let restore: () => void;
  let authDisabled: boolean;
  const clients: ClientSocket[] = [];

  before(async () => {
    await seedSelectorHealth(scratch.db);
    await scratch.db.user.create({
      data: {
        id: ADMIN_ID,
        name: 'Admin',
        email: 'admin@xenon.local',
        passwordHash: 'x',
        accessKey: 'ak-admin',
        role: 'ADMIN',
      },
    });
    await scratch.db.teamMember.create({ data: { teamId: TEAM.a, userId: USER.priya } });
    await scratch.db.teamMember.create({ data: { teamId: TEAM.b, userId: USER.alex } });
  });

  async function connect(userId: string): Promise<Array<[string, any]>> {
    const bearer = await Container.get(JwtKeyService).sign(
      { sub: userId },
      { audience: 'xenon-rest', ttlSeconds: 60 },
    );
    const socket = connectClient(url, {
      auth: { bearer },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    clients.push(socket);
    const inbox: Array<[string, any]> = [];
    socket.onAny((event: string, data: any) => inbox.push([event, data]));
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    socket.emit('register_dashboard');
    return inbox;
  }

  async function until(check: () => boolean, what: string, ms = 3000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  beforeEach(async () => {
    authDisabled = xenonConfig.authDisabled;
    xenonConfig.authDisabled = false;
    restore = saveRegistrations(
      SocketServer,
      EventLogService,
      JwtKeyService,
      ApiKeyService,
      SelectorVisibilityResolver,
    );
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-selector-scope-'));
    const keys = new JwtKeyService();
    await keys.init(dir);
    Container.set(JwtKeyService, keys);
    Container.set(ApiKeyService, { verifyPair: async () => null, verify: async () => null } as any);
    Container.set(EventLogService, { appendSafe: () => undefined } as any);
    Container.set(SelectorVisibilityResolver, new SelectorVisibilityResolver());

    server = new SocketServer();
    Container.set(SocketServer, server);
    httpServer = http.createServer();
    server.initialize(httpServer);
    await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await new Promise<void>((r) =>
      (server as any).io ? (server as any).io.close(() => r()) : r(),
    );
    await new Promise<void>((r) => httpServer.close(() => r()));
    restore();
    xenonConfig.authDisabled = authDisabled;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("muting team B's selector reaches the admin and Alex, not Priya; team A's reaches the admin and Priya", async () => {
    const admin = await connect(ADMIN_ID);
    const priya = await connect(USER.priya);
    const alex = await connect(USER.alex);
    await until(
      () => (server as any).io?.sockets.adapter.rooms.get('dashboard')?.size === 3,
      'all three clients in the dashboard room',
    );

    // The scratch client itself: its transaction must not reach another database.
    const states = new SelectorStateService(scratch.db as never);
    await states.mute({ strategy: 'xpath', selector: SEL.bOnly, apiKeyId: '', reason: 'redesign' });
    await states.mute({ strategy: 'id', selector: SEL.warm, apiKeyId: '' });

    await until(() => admin.length >= 2, 'the admin to get both events');
    await until(() => priya.length >= 1 && alex.length >= 1, 'each member to get their own');
    // Give any stray delivery a moment to land before asserting its absence.
    await new Promise((r) => setTimeout(r, 50));

    const muted = (inbox: Array<[string, any]>) =>
      inbox
        .filter(([event]) => event === 'selector_muted')
        .map(([, data]) => data.original_selector)
        .sort();
    expect(muted(admin)).to.deep.equal([SEL.warm, SEL.bOnly].sort());
    expect(muted(priya)).to.deep.equal([SEL.warm]);
    expect(muted(alex)).to.deep.equal([SEL.bOnly]);
    expect(priya, 'nothing else').to.have.length(1);
    expect(alex, 'nothing else').to.have.length(1);
  });
});

/**
 * A socket keeps who it is (role, teams, and that its sign-in is still good)
 * from its handshake. REST looks the caller up again on every request, so a
 * change to the user reaches it at once; these hold the live events to the
 * same, on a real Socket.io server and real clients, against a real (scratch)
 * database, through the routes and services that make the change.
 *
 * A socket whose user may still connect is updated where it is, never
 * disconnected. One whose credential no longer checks out has its connection
 * closed: the client reconnects as after any drop, and the handshake decides
 * on the credential it has then. These clients don't reconnect, so a closed
 * one stays closed ('transport close'), except where a test says otherwise.
 */
describe("A socket's identity follows its user (real Socket.io, real database)", () => {
  const scratch = useScratchDatabase();

  const ID = {
    super: 'rv-u-super',
    admin: 'rv-u-admin',
    admin2: 'rv-u-admin2',
    member: 'rv-u-member',
  };
  const TEAMS = { a: 'rv-team-a', b: 'rv-team-b' };
  const PHONES: Record<string, string | null> = {
    'rv-phone-a': TEAMS.a,
    'rv-phone-b': TEAMS.b,
    'rv-phone-shared': null,
  };
  const SESSION = { member: 'rv-sess-member', admin: 'rv-sess-admin' };
  const MEMBER_KEY = 'rv-raw-member-key';
  const MEMBER_KEY_ID = 'rv-key-member';
  const SUPER = {
    kind: 'user-session',
    userId: ID.super,
    role: 'SUPER_ADMIN',
    scopes: 'admin,devices,sessions,read',
    teamIds: undefined,
  };

  interface Client {
    socket: ClientSocket;
    inbox: Array<[string, any]>;
    /** Why the connection ended, once it has. */
    ended: () => string | undefined;
  }

  let httpServer: http.Server | undefined;
  let server: SocketServer;
  let url: string;
  let dir: string;
  let restore: () => void;
  let authDisabled: boolean;
  let app: express.Express;
  const clients: ClientSocket[] = [];
  const ttl = process.env.XENON_USER_SESSION_TTL_MS;

  async function seed(): Promise<void> {
    const db = scratch.db;
    await db.teamMember.deleteMany();
    await db.userSession.deleteMany();
    await db.apiKey.deleteMany();
    await db.team.deleteMany();
    await db.user.deleteMany();
    const user = (id: string, role: string) =>
      db.user.create({
        data: {
          id,
          role,
          name: id,
          email: `${id}@xenon.local`,
          passwordHash: 'x',
          accessKey: `ak-${id}`,
        },
      });
    await user(ID.super, 'SUPER_ADMIN');
    await user(ID.admin, 'ADMIN');
    await user(ID.admin2, 'ADMIN');
    await user(ID.member, 'MEMBER');
    await db.team.create({ data: { id: TEAMS.a, name: 'Team A' } });
    await db.team.create({ data: { id: TEAMS.b, name: 'Team B' } });
    await db.teamMember.create({ data: { teamId: TEAMS.a, userId: ID.member } });
    const inAnHour = new Date(Date.now() + 60 * 60 * 1000);
    await db.userSession.create({
      data: { id: SESSION.member, userId: ID.member, expiresAt: inAnHour },
    });
    await db.userSession.create({
      data: { id: SESSION.admin, userId: ID.admin, expiresAt: inAnHour },
    });
    await db.apiKey.create({
      data: {
        id: MEMBER_KEY_ID,
        name: 'member key',
        keyHash: new ApiKeyService().hash(MEMBER_KEY),
        scopes: 'devices,sessions,read',
        userId: ID.member,
      },
    });
  }

  /** Starts the server; each test calls it first, with any options it needs. */
  async function start(options?: Parameters<SocketServer['initialize']>[1]): Promise<void> {
    const listening = http.createServer();
    httpServer = listening;
    server.initialize(listening, options);
    await new Promise<void>((r) => listening.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;
  }

  /** A dashboard client (bearer or cookie), or a node's (an access key and token). */
  async function connect(
    as:
      | { bearer: string; ttlSeconds?: number }
      | { bearerToken: string }
      | { cookie: string }
      | { accessKey: string; token: string },
  ): Promise<Client> {
    const credentials =
      'bearerToken' in as
        ? { auth: { bearer: as.bearerToken } }
        : 'bearer' in as
          ? {
              auth: {
                bearer: await Container.get(JwtKeyService).sign(
                  { sub: as.bearer },
                  { audience: 'xenon-rest', ttlSeconds: as.ttlSeconds ?? 60 },
                ),
              },
            }
          : 'cookie' in as
            ? { extraHeaders: { cookie: `xenon_dashboard_session=${as.cookie}` } }
            : { auth: { accessKey: as.accessKey, token: as.token } };
    const socket = connectClient(url, {
      ...credentials,
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    clients.push(socket);
    const inbox: Array<[string, any]> = [];
    let reason: string | undefined;
    socket.onAny((event: string, data: any) => inbox.push([event, data]));
    socket.on('disconnect', (why: string) => {
      reason = why;
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    if (!('accessKey' in as)) socket.emit('register_dashboard');
    return { socket, inbox, ended: () => reason };
  }

  /** Who the server holds the client's socket to be now. */
  const identityOf = (client: Client) =>
    (server as any).io?.sockets.sockets.get(client.socket.id)?.data.identity;

  async function untilAsync(check: () => Promise<boolean>, what: string, ms = 3000) {
    const deadline = Date.now() + ms;
    while (!(await check())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  async function until(check: () => boolean, what: string, ms = 3000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  const roomSize = () => (server as any).io?.sockets.adapter.rooms.get('dashboard')?.size ?? 0;

  /** One event about a phone, delivered to every socket that may see it before this settles. */
  function emit(udid: string, event: string, adminOnly = false): Promise<void> {
    return server.emitToDashboardForDevices(
      event,
      { udid },
      { udid, teamId: PHONES[udid], adminOnly },
    );
  }

  /** Lets a delivery that was going to reach a socket land before its absence is asserted. */
  const settle = () => new Promise((r) => setTimeout(r, 50));

  const seen = (client: Client) => client.inbox.map(([event, data]) => `${event}:${data.udid}`);

  beforeEach(async () => {
    authDisabled = xenonConfig.authDisabled;
    xenonConfig.authDisabled = false;
    restore = saveRegistrations(
      SocketServer,
      EventLogService,
      JwtKeyService,
      ApiKeyService,
      UserSessionService,
      DeviceTeamResolver,
      SelectorVisibilityResolver,
    );
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-socket-identity-'));
    const keys = new JwtKeyService();
    await keys.init(dir);
    Container.set(JwtKeyService, keys);
    Container.set(ApiKeyService, new ApiKeyService());
    Container.set(UserSessionService, new UserSessionService());
    Container.set(EventLogService, { appendSafe: () => undefined } as any);
    Container.set(
      DeviceTeamResolver,
      new DeviceTeamResolver({
        findDevice: async (udid: string) =>
          udid in PHONES ? { udid, teamId: PHONES[udid] } : null,
      }),
    );
    await seed();

    server = new SocketServer();
    Container.set(SocketServer, server);

    // The routes the dashboard's Users, Teams and API keys pages call, and
    // sign-out, as a super admin.
    app = express();
    app.use(express.json());
    app.use('/auth', authPublicRouter());
    app.use((req, _res, next) => {
      (req as any).auth = SUPER;
      next();
    });
    app.use('/users', usersRouter());
    app.use('/teams', teamsRouter());
    app.use('/apikeys', apiKeysRouter());
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await new Promise<void>((r) =>
      (server as any).io ? (server as any).io.close(() => r()) : r(),
    );
    if (ttl === undefined) delete process.env.XENON_USER_SESSION_TTL_MS;
    else process.env.XENON_USER_SESSION_TTL_MS = ttl;
    const open = httpServer;
    if (open?.listening) await new Promise<void>((r) => open.close(() => r()));
    httpServer = undefined;
    sinon.restore();
    restore();
    xenonConfig.authDisabled = authDisabled;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('an admin demoted to member gets no captured request once the change is saved, and stays connected as a member', async () => {
    await start();
    const demoted = await connect({ bearer: ID.admin });
    const control = await connect({ bearer: ID.admin2 });
    await until(() => roomSize() === 2, 'both clients in the dashboard room');

    await request(app).patch(`/users/${ID.admin}`).send({ role: 'MEMBER' }).expect(200);

    await emit('rv-phone-shared', 'interceptor_request', true);
    await emit('rv-phone-a', 'device_blocked');
    await emit('rv-phone-shared', 'device_unblocked');
    await until(() => control.inbox.length >= 3, 'the other admin to get all three');
    await until(() => demoted.inbox.length >= 1, "the shared phone's event");
    await settle();

    expect(seen(control)).to.deep.equal([
      'interceptor_request:rv-phone-shared',
      'device_blocked:rv-phone-a',
      'device_unblocked:rv-phone-shared',
    ]);
    // A member of no team: the shared pool only, and no captured traffic.
    expect(seen(demoted)).to.deep.equal(['device_unblocked:rv-phone-shared']);
    expect(demoted.socket.connected, 'still connected').to.equal(true);
    expect(demoted.ended()).to.equal(undefined);
  });

  it('a disabled user is signed out of every socket once the change is saved; others stay', async () => {
    await start();
    const disabled = await connect({ bearer: ID.admin });
    const sameUserCookie = await connect({ cookie: SESSION.admin });
    const control = await connect({ bearer: ID.admin2 });
    await until(() => roomSize() === 3, 'all three clients in the dashboard room');

    await request(app).patch(`/users/${ID.admin}`).send({ status: 'INACTIVE' }).expect(200);

    await until(() => disabled.ended() !== undefined, 'the bearer socket to end');
    await until(() => sameUserCookie.ended() !== undefined, 'the cookie socket to end');
    expect(disabled.ended()).to.equal('transport close');
    expect(sameUserCookie.ended()).to.equal('transport close');
    await emit('rv-phone-shared', 'interceptor_request', true);
    await until(() => control.inbox.length >= 1, 'the other admin to get it');
    expect(control.socket.connected).to.equal(true);
  });

  it("a deleted user's socket is ended", async () => {
    await start();
    const deleted = await connect({ bearer: ID.member });
    await until(() => roomSize() === 1, 'the client in the dashboard room');

    await request(app).delete(`/users/${ID.member}`).expect(204);

    await until(() => deleted.ended() !== undefined, 'the socket to end');
    expect(deleted.ended()).to.equal('transport close');
  });

  it("a member taken off a team stops getting its phones' events, and one added to a team starts, without reconnecting", async () => {
    await start();
    const member = await connect({ cookie: SESSION.member });
    const admin = await connect({ bearer: ID.admin });
    await until(() => roomSize() === 2, 'both clients in the dashboard room');

    await request(app).delete(`/teams/${TEAMS.a}/members/${ID.member}`).expect(200);
    await emit('rv-phone-a', 'device_blocked');
    await until(() => admin.inbox.length >= 1, "the admin to get team A's event");
    await settle();
    expect(seen(member), 'off team A').to.deep.equal([]);

    await request(app).post(`/teams/${TEAMS.b}/members`).send({ userId: ID.member }).expect(200);
    await emit('rv-phone-b', 'device_blocked');
    await until(() => member.inbox.length >= 1, "team B's event");
    expect(seen(member), 'on team B').to.deep.equal(['device_blocked:rv-phone-b']);
    expect(member.ended()).to.equal(undefined);
  });

  it("signing out ends that sign-in's socket, not the same user's other ones", async () => {
    await start();
    const signedOut = await connect({ cookie: SESSION.member });
    const ide = await connect({ bearer: ID.member });
    await until(() => roomSize() === 2, 'both clients in the dashboard room');

    await request(app)
      .post('/auth/logout')
      .set('Cookie', `xenon_dashboard_session=${SESSION.member}`)
      .expect(204);

    await until(() => signedOut.ended() !== undefined, 'the signed-out socket to end');
    expect(signedOut.ended()).to.equal('transport close');
    await emit('rv-phone-a', 'device_blocked');
    await until(() => ide.inbox.length >= 1, "the bearer socket to get team A's event");
    expect(ide.ended()).to.equal(undefined);
  });

  it("a revoked API key's socket is ended", async () => {
    await start();
    const keyed = await connect({ cookie: MEMBER_KEY });
    await until(() => roomSize() === 1, 'the client in the dashboard room');

    await request(app).delete(`/apikeys/${MEMBER_KEY_ID}`).expect(200);

    await until(() => keyed.ended() !== undefined, 'the socket to end');
    expect(keyed.ended()).to.equal('transport close');
  });

  it('a bearer socket closes when REST stops taking its token, and the token is refused from then on', async function () {
    this.timeout(10_000);
    await start();
    // Past its exp, but within the 60 s REST still takes it for: ~2 s left.
    const bearer = await Container.get(JwtKeyService).sign(
      { sub: ID.admin },
      { audience: 'xenon-rest', ttlSeconds: 2 - JWT_CLOCK_TOLERANCE_SEC },
    );
    expect(await verifyBearerCredential(bearer), 'REST takes it').to.not.equal(null);
    const ide = await connect({ bearerToken: bearer });

    await until(() => ide.ended() !== undefined, 'the socket to close', 3500);
    expect(ide.ended()).to.equal('transport close');
    expect(await verifyBearerCredential(bearer), 'nor does REST, by then').to.equal(null);

    const late = connectClient(url, {
      auth: { bearer },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    clients.push(late);
    const refused = await new Promise<string>((resolve) => {
      late.once('connect', () => resolve('connected'));
      late.once('connect_error', (err: Error) => resolve(err.message));
    });
    expect(refused).to.equal('unauthorized');
  });

  it('a client that fetches a fresh token is let back in after its token runs out', async function () {
    this.timeout(10_000);
    await start();
    // As Xenon Studio and the documented client do: a function, which
    // socket.io calls for every connection attempt.
    let tokens = 0;
    const socket = connectClient(url, {
      auth: (cb: (data: object) => void) => {
        tokens += 1;
        Container.get(JwtKeyService)
          .sign(
            { sub: ID.admin },
            { audience: 'xenon-rest', ttlSeconds: tokens === 1 ? 2 - JWT_CLOCK_TOLERANCE_SEC : 60 },
          )
          .then((bearer) => cb({ bearer }));
      },
      transports: ['websocket'],
      reconnectionDelay: 50,
      forceNew: true,
    });
    clients.push(socket);
    const reasons: string[] = [];
    let connects = 0;
    socket.on('disconnect', (why: string) => reasons.push(why));
    socket.on('connect', () => {
      connects += 1;
      socket.emit('register_dashboard');
    });

    await until(() => connects === 2, 'the client to come back with a fresh token', 4000);
    expect(reasons).to.deep.equal(['transport close']);
    expect(tokens).to.equal(2);
    await until(() => roomSize() === 1, 'it to register again');
    await emit('rv-phone-shared', 'interceptor_request', true);
    const received = await new Promise<string>((resolve) =>
      socket.once('interceptor_request', (data: any) => resolve(data.udid)),
    );
    expect(received).to.equal('rv-phone-shared');
  });

  it("a disabled user's client, reconnecting by itself, is refused once and stops", async () => {
    await start();
    const bearer = await Container.get(JwtKeyService).sign(
      { sub: ID.admin },
      { audience: 'xenon-rest', ttlSeconds: 60 },
    );
    const socket = connectClient(url, {
      auth: { bearer },
      transports: ['websocket'],
      reconnectionDelay: 50,
      forceNew: true,
    });
    clients.push(socket);
    const refusals: string[] = [];
    socket.on('connect_error', (err: Error) => refusals.push(err.message));
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));

    await request(app).patch(`/users/${ID.admin}`).send({ status: 'INACTIVE' }).expect(200);

    await until(() => refusals.length === 1, 'the reconnect to be refused');
    expect(refusals).to.deep.equal(['unauthorized']);
    expect(socket.active, 'socket.io gives up after a refused handshake').to.equal(false);
    await new Promise((r) => setTimeout(r, 300));
    expect(refusals, 'no further attempts').to.have.length(1);
  });

  it('a sign-in that lapses ends its socket when it expires, not before, though nothing ended it', async function () {
    this.timeout(10_000);
    // The handshake is a use of the sign-in: it renews it for the TTL. The
    // socket's own checks renew nothing, so with no REST call it lapses then.
    process.env.XENON_USER_SESSION_TTL_MS = '1500';
    await scratch.db.userSession.update({
      where: { id: SESSION.member },
      data: { expiresAt: new Date(Date.now() + 700) },
    });
    await start();
    const t0 = Date.now();
    const lapsing = await connect({ cookie: SESSION.member });
    await until(() => lapsing.ended() !== undefined, 'the socket to end with its sign-in', 5000);
    expect(lapsing.ended()).to.equal('transport close');
    expect(Date.now() - t0, 'ended at the renewed expiry').to.be.at.least(1400);
  });

  it("a node whose user's access key was rotated is ended", async () => {
    await start();
    const node = await connect({ accessKey: `ak-${ID.member}`, token: MEMBER_KEY });
    expect(identityOf(node)?.principal).to.equal('node');

    await Container.get(UserService).rotateAccessKey(ID.member);

    await until(() => node.ended() !== undefined, 'the node socket to end');
    expect(node.ended()).to.equal('transport close');
  });

  it('a change made elsewhere (straight to the database) reaches the socket at the next sweep', async () => {
    await start({ recheckIntervalMs: 100 });
    const admin = await connect({ bearer: ID.admin });
    await until(() => roomSize() === 1, 'the client in the dashboard room');

    // Another server sharing the database, or a hand edit: no notice here.
    await scratch.db.user.update({ where: { id: ID.admin }, data: { role: 'MEMBER' } });
    await until(() => identityOf(admin)?.role === 'MEMBER', 'the next sweep');

    await emit('rv-phone-shared', 'interceptor_request', true);
    await emit('rv-phone-shared', 'device_blocked');
    await until(() => admin.inbox.length >= 1, "the shared phone's event");
    await settle();
    expect(seen(admin)).to.deep.equal(['device_blocked:rv-phone-shared']);
    expect(admin.ended()).to.equal(undefined);
  });

  it("checking a socket again renews nothing: a sign-in's TTL doesn't slide and a key isn't marked used", async () => {
    const check = sinon.spy(server as any, 'check');
    await start({ recheckIntervalMs: 50 });
    await connect({ cookie: SESSION.member });
    await connect({ cookie: MEMBER_KEY });
    // The handshakes are uses, recorded in the background.
    const rows = async () => ({
      session: await scratch.db.userSession.findUniqueOrThrow({ where: { id: SESSION.member } }),
      key: await scratch.db.apiKey.findUniqueOrThrow({ where: { id: MEMBER_KEY_ID } }),
    });
    const times = ({ session, key }: Awaited<ReturnType<typeof rows>>) => ({
      expiresAt: session.expiresAt.getTime(),
      lastSeenAt: session.lastSeenAt.getTime(),
      lastUsedAt: key.lastUsedAt?.getTime(),
    });
    await untilAsync(async () => {
      const t = times(await rows());
      return t.lastUsedAt !== undefined && t.expiresAt > Date.now() + 2 * 60 * 60 * 1000;
    }, 'the handshakes to be recorded');
    const before = times(await rows());

    const rechecks = () => check.getCalls().filter((c) => c.args[1] === true).length;
    await until(() => rechecks() >= 4, 'two sweeps of both sockets');
    await settle();

    expect(times(await rows())).to.deep.equal(before);
  });

  it('a check that cannot run (the database unavailable) keeps the socket as it was', async () => {
    await start();
    const admin = await connect({ bearer: ID.admin });
    await until(() => roomSize() === 1, 'the client in the dashboard room');

    // The scratch database's own stub, put back after the test.
    (prisma.user.findUnique as unknown as sinon.SinonStub).rejects(new Error('database is locked'));
    await identityChanged(ID.admin);

    await emit('rv-phone-shared', 'interceptor_request', true);
    await until(() => admin.inbox.length >= 1, 'the captured request');
    expect(admin.socket.connected).to.equal(true);
    expect(identityOf(admin)?.role).to.equal('ADMIN');
  });

  const MEMBER_IDENTITY = { principal: 'dashboard', userId: ID.admin, role: 'MEMBER', teamIds: [] };
  /** A socket for check-order tests: an admin's, whose bearer token no longer verifies. */
  const checkedSocket = (): any => ({
    id: 'fake',
    connected: true,
    handshake: { auth: { bearer: 'no-longer-valid' }, headers: {} },
    data: {
      identity: { principal: 'dashboard', userId: ID.admin, role: 'ADMIN', teamIds: undefined },
    },
    conn: { close: sinon.spy() },
  });

  it('a check that finishes first is applied though a newer one is still running', async () => {
    // A change's check, then a sweep's started while it runs: REST answers
    // once the change's check settles, so its outcome can't wait on the sweep.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const check = sinon.stub(server as any, 'check');
    check.onFirstCall().resolves({ identity: MEMBER_IDENTITY });
    check.onSecondCall().callsFake(async () => {
      await gate;
      return { identity: { ...MEMBER_IDENTITY, teamIds: [TEAMS.a] } };
    });
    const socket = checkedSocket();

    const first = (server as any).recheck(socket);
    const second = (server as any).recheck(socket);
    await first;
    expect(socket.data.identity.role, 'applied when it settles').to.equal('MEMBER');

    release();
    await second;
    expect(socket.data.identity.teamIds, 'then the newer one').to.deep.equal([TEAMS.a]);
  });

  it('an older check that finishes after a newer one has applied changes nothing', async () => {
    const real = (server as any).check.bind(server);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const check = sinon.stub(server as any, 'check');
    // The older check refuses (a token that no longer verifies), but only
    // after a newer one has found the user a member.
    check.onFirstCall().callsFake(async (socket: any, recheck: any) => {
      await gate;
      return real(socket, recheck);
    });
    check.onSecondCall().resolves({ identity: MEMBER_IDENTITY });
    const socket = checkedSocket();

    const older = (server as any).recheck(socket);
    await (server as any).recheck(socket);
    release();
    await older;

    expect(socket.data.identity.role).to.equal('MEMBER');
    expect(socket.conn.close.called, 'the older refusal is dropped').to.equal(false);
  });

  it("a newer check that can't run doesn't cancel an older refusal", async () => {
    const real = (server as any).check.bind(server);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const check = sinon.stub(server as any, 'check');
    check.onFirstCall().callsFake(async (socket: any, recheck: any) => {
      await gate;
      return real(socket, recheck);
    });
    check.onSecondCall().rejects(new Error('database is locked'));
    const socket = checkedSocket();

    const older = (server as any).recheck(socket);
    await (server as any).recheck(socket);
    expect(socket.conn.close.called, 'a check that failed changes nothing').to.equal(false);
    release();
    await older;

    expect(socket.conn.close.calledOnce, 'the refusal stands').to.equal(true);
  });

  it('a handshake that overlaps a change to its user is checked again once connected', async () => {
    await start();
    const real = (server as any).check.bind(server);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let releaseRecheck!: () => void;
    const recheckGate = new Promise<void>((r) => (releaseRecheck = r));
    let handshakes = 0;
    sinon.stub(server as any, 'check').callsFake(async (socket: any, recheck: any) => {
      const result = await real(socket, recheck);
      if (!recheck && handshakes++ === 0) await gate;
      if (recheck) await recheckGate;
      return result;
    });

    const connecting = connect({ bearer: ID.admin });
    await until(() => handshakes === 1, 'the handshake to read the user');
    // The change finds no socket of the user's: this one isn't connected yet.
    await request(app).patch(`/users/${ID.admin}`).send({ role: 'MEMBER' }).expect(200);
    release();
    const admin = await connecting;

    // It asked to join (connect() registers), but gets no dashboard event
    // under the identity it connected with.
    await new Promise((r) => setTimeout(r, 100));
    expect(identityOf(admin)?.role).to.equal('ADMIN');
    expect(roomSize(), 'not in the room before its check').to.equal(0);
    releaseRecheck();
    await until(() => roomSize() === 1, 'it to join the room');
    expect(identityOf(admin)?.role).to.equal('MEMBER');
  });

  it("a selector event asked about before the member's team changed doesn't reach them", async () => {
    await start();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let asked = 0;
    // Yes for every member, but only once released.
    Container.set(SelectorVisibilityResolver, {
      canSee: async () => {
        asked += 1;
        await gate;
        return true;
      },
    } as any);
    const member = await connect({ cookie: SESSION.member });
    const admin = await connect({ bearer: ID.admin });
    await until(() => roomSize() === 2, 'both clients in the dashboard room');

    const delivered = server.emitToDashboardForSelector(
      'selector_muted',
      { original_selector: '//x' },
      { strategy: 'xpath', selector: '//x' },
    );
    await until(() => asked === 1, "the member's visibility to be asked");
    await request(app).delete(`/teams/${TEAMS.a}/members/${ID.member}`).expect(200);
    release();
    await delivered;

    await until(() => admin.inbox.length >= 1, 'the admin to get it');
    await settle();
    expect(member.inbox, 'asked about with the team it no longer has').to.deep.equal([]);
    expect(member.ended()).to.equal(undefined);
  });

  it('a closed server stops listening for changes', async () => {
    await start();
    const recheckUser = sinon.spy(server, 'recheckUser');
    await new Promise<void>((r) => (server as any).io.close(() => r()));

    await identityChanged(ID.admin);

    expect(recheckUser.called).to.equal(false);
  });
});
