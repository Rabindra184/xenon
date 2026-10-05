import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { Container } from 'typedi';
import { io as connectClient, Socket as ClientSocket } from 'socket.io-client';
import { SocketServer } from '../../src/services/SocketServer';
import { EventLogService } from '../../src/services/EventLogService';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { ApiKeyService } from '../../src/services/ApiKeyService';
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
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';
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
