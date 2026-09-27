import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import http from 'http';
import type { AddressInfo } from 'net';
import { Container } from 'typedi';
import { io as connectClient, Socket as ClientSocket } from 'socket.io-client';
import { SocketServer } from '../../src/services/SocketServer';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserSessionService } from '../../src/services/UserSessionService';
import { UserService } from '../../src/services/UserService';
import { EventLogService } from '../../src/services/EventLogService';
import { prisma } from '../../src/prisma';
import { config as xenonConfig } from '../../src/config';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * A dashboard signed in through /login holds a `xenon_dashboard_session`
 * cookie whose value is a UserSession id. REST resolves it as a UserSession
 * first and only then tries it as a raw API key (the older /api-key-gate
 * cookie). The socket handshake tried only the raw key, so with auth enabled
 * every signed-in dashboard was refused and got no live events at all.
 */

const USERS: Record<string, { id: string; status: string; role: string }> = {
  'u-member': { id: 'u-member', status: 'ACTIVE', role: 'MEMBER' },
  'u-admin': { id: 'u-admin', status: 'ACTIVE', role: 'ADMIN' },
  'u-gone': { id: 'u-gone', status: 'DISABLED', role: 'MEMBER' },
};
const SESSIONS: Record<string, { id: string; userId: string }> = {
  'sess-member': { id: 'sess-member', userId: 'u-member' },
  'sess-admin': { id: 'sess-admin', userId: 'u-admin' },
  'sess-gone': { id: 'sess-gone', userId: 'u-gone' },
};
const TEAMS: Record<string, string[]> = { 'u-member': ['team-a'] };

const cookie = (value: string) => `theme=dark; xenon_dashboard_session=${value}`;

describe('SocketServer — a signed-in dashboard session cookie', () => {
  let server: SocketServer;
  let restore: () => void;
  let authDisabled: boolean;
  let resolve: sinon.SinonStub;
  let verify: sinon.SinonStub;
  const authenticate = (headers: Record<string, string>) =>
    (server as any).authenticate({ handshake: { auth: {}, headers } });

  beforeEach(() => {
    authDisabled = xenonConfig.authDisabled;
    xenonConfig.authDisabled = false;
    restore = saveRegistrations(UserSessionService, UserService, ApiKeyService, EventLogService);
    resolve = sinon.stub().callsFake(async (id: string) => SESSIONS[id] ?? null);
    verify = sinon.stub().resolves(null);
    Container.set(UserSessionService, { resolve } as any);
    Container.set(UserService, { findById: async (id: string) => USERS[id] ?? null } as any);
    Container.set(ApiKeyService, { verify, verifyPair: sinon.stub().resolves(null) } as any);
    Container.set(EventLogService, { appendSafe: () => undefined } as any);
    sinon
      .stub(prisma.user, 'findUnique')
      .callsFake((async (args: any) => USERS[args.where.id] ?? null) as any);
    sinon
      .stub(prisma.teamMember, 'findMany')
      .callsFake((async (args: any) =>
        (TEAMS[args.where.userId] ?? []).map((teamId) => ({ teamId }))) as any);
    server = new SocketServer();
  });

  afterEach(() => {
    sinon.restore();
    restore();
    xenonConfig.authDisabled = authDisabled;
  });

  it("a member's /login cookie: a dashboard socket with the member's teams", async () => {
    const identity = await authenticate({ cookie: cookie('sess-member') });

    expect(identity).to.deep.equal({
      principal: 'dashboard',
      userId: 'u-member',
      role: 'MEMBER',
      teamIds: ['team-a'],
    });
    expect(resolve.firstCall.args[0]).to.equal('sess-member');
    expect(verify.called, 'a session never reaches the raw-key check').to.equal(false);
  });

  it("an admin's /login cookie: unscoped", async () => {
    const identity = await authenticate({ cookie: cookie('sess-admin') });

    expect(identity).to.deep.include({ principal: 'dashboard', userId: 'u-admin' });
    expect(identity.teamIds).to.equal(undefined);
  });

  it("a disabled user's session is refused, and not retried as a raw key", async () => {
    let error: Error | undefined;
    try {
      await authenticate({ cookie: cookie('sess-gone') });
    } catch (e: any) {
      error = e;
    }

    expect(error?.message).to.match(/inactive/i);
    expect(verify.called).to.equal(false);
  });

  it('an expired or unknown session falls back to the raw-key check, and is refused', async () => {
    let error: Error | undefined;
    try {
      await authenticate({ cookie: cookie('sess-expired') });
    } catch (e: any) {
      error = e;
    }

    expect(verify.firstCall.args[0]).to.equal('sess-expired');
    expect(error?.message).to.match(/invalid or revoked dashboard session/i);
  });

  it('REST and the socket reach the same identity for the same cookie', async () => {
    for (const value of ['sess-member', 'sess-admin']) {
      const req: any = { headers: { cookie: cookie(value) }, query: {} };
      const res: any = { status: () => res, json: () => res, cookie: () => res };
      let called = false;
      await authMiddleware(req, res, () => (called = true));
      expect(called, `REST accepted ${value}`).to.equal(true);

      const socket = await authenticate({ cookie: cookie(value) });
      expect(
        { userId: socket.userId, role: socket.role, teamIds: socket.teamIds },
        value,
      ).to.deep.equal({ userId: req.auth.userId, role: req.auth.role, teamIds: req.auth.teamIds });
    }
  });

  describe('over a real Socket.io server', () => {
    let httpServer: http.Server;
    let client: ClientSocket | undefined;

    beforeEach(async () => {
      httpServer = http.createServer();
      server.initialize(httpServer);
      await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', () => r()));
    });

    afterEach(async () => {
      client?.close();
      (server as any).io?.close();
      await new Promise<void>((r) => httpServer.close(() => r()));
    });

    it('a member signed in through /login connects and receives their phone’s event', async () => {
      const { port } = httpServer.address() as AddressInfo;
      const socket = connectClient(`http://127.0.0.1:${port}`, {
        extraHeaders: { cookie: cookie('sess-member') },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });
      client = socket;
      const inbox: Array<[string, any]> = [];
      socket.onAny((event: string, data: any) => inbox.push([event, data]));
      await new Promise<void>((ok, fail) => {
        socket.once('connect', () => ok());
        socket.once('connect_error', fail);
      });
      socket.emit('register_dashboard');
      const room = () => (server as any).io?.sockets.adapter.rooms.get('dashboard')?.size ?? 0;
      for (const deadline = Date.now() + 3000; room() < 1; ) {
        if (Date.now() > deadline) throw new Error('never joined the dashboard room');
        await new Promise((r) => setTimeout(r, 10));
      }

      await server.emitToDashboardForDevices(
        'device_blocked',
        { udid: 'phone-b' },
        { udid: 'phone-b', teamId: 'team-b' },
      );
      await server.emitToDashboardForDevices(
        'device_blocked',
        { udid: 'phone-a' },
        { udid: 'phone-a', teamId: 'team-a' },
      );
      for (const deadline = Date.now() + 3000; inbox.length < 1; ) {
        if (Date.now() > deadline) throw new Error('no event arrived');
        await new Promise((r) => setTimeout(r, 10));
      }

      expect(inbox.map(([, d]) => d.udid)).to.deep.equal(['phone-a']);
    });
  });
});
