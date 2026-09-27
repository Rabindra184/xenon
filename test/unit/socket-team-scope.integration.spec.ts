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
import { prisma } from '../../src/prisma';
import { config as xenonConfig } from '../../src/config';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * A real Socket.io server (SocketServer.initialize on a real http server) and
 * two real socket.io clients: a team-A member and an admin, both connecting
 * the way the IDE extension does, with a bearer JWT. Events are produced by
 * the real emitters (device-service's addNewDevice and the event manager's
 * afterSessionCommand), so this covers the handshake identity, the room, the
 * scoped emit and the call sites together.
 *
 * "Did not receive" is proved by order: each hidden event is followed by one
 * the member may see, and the member's first event must be that one.
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

    const summary = (inbox: Array<[string, any]>) =>
      inbox.map(([event, data]) => `${event}:${data.udid ?? data.session_id}`);
    expect(summary(admin.inbox)).to.deep.equal([
      'device_added:phone-b',
      'session_command:session-on-phone-b',
      'device_added:phone-a',
      'session_command:session-on-phone-a',
    ]);
    expect(summary(member.inbox)).to.deep.equal([
      'device_added:phone-a',
      'session_command:session-on-phone-a',
    ]);
  });
});
