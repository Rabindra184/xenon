import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { PluginContext } from '../../src/PluginContext';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserService } from '../../src/services/UserService';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import * as pendingSessions from '../../src/data-service/pending-sessions-service';
import * as deviceService from '../../src/data-service/device-service';
import * as deviceUtils from '../../src/device-utils';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { config } from '../../src/config';
import { prisma } from '../../src/prisma';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * createSession writes who asked onto the pending-session row, so the queue
 * can show a member her own and her team's requests. It goes on that row only:
 * never into the capabilities handed to the driver, a peer node or the Session
 * row. And it costs no lookup: a team is read when the queue is.
 */

const REQUESTER = 'xenon:requester';

const keys: Record<string, any> = {
  ak_member: { id: 'key_member', userId: 'usr_member', scopes: 'sessions', teamId: null },
  ak_team_a: { id: 'key_team_a', userId: 'usr_member', scopes: 'sessions', teamId: 'team_a' },
  ak_admin: { id: 'key_admin', userId: 'usr_admin', scopes: 'admin', teamId: null },
};

const caps = (extra: Record<string, unknown> = {}) => ({
  alwaysMatch: {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    ...extra,
  },
  firstMatch: [{}],
});
const withKey = (accessKey: string, extra: Record<string, unknown> = {}) =>
  caps({ 'xe:options': { accessKey, token: 'tk' }, ...extra });

describe('createSession records who asked on the pending-session row', () => {
  let svc: SessionLifecycleService;
  let device: any;
  let context: PluginContext;
  let savedContext: Partial<PluginContext>;
  let authDisabledBefore: boolean;
  let pendingRow: any;
  let driverCaps: any;
  let finalCaps: any;
  let forwardedCaps: any;
  let findById: sinon.SinonSpy;
  let teamRows: sinon.SinonStub;
  let restore: () => void;

  const create = async (sent: any) => {
    const next = sinon.stub().callsFake(async () => {
      driverCaps = JSON.parse(JSON.stringify(sent));
      return { value: ['sess-1', { platformName: 'Android' }] };
    });
    await svc.createSession(next, {}, sent);
    return sent;
  };

  beforeEach(() => {
    authDisabledBefore = config.authDisabled;
    config.authDisabled = false;

    context = Container.get(PluginContext);
    savedContext = { pluginArgs: context.pluginArgs, nodeId: context.nodeId };
    context.pluginArgs = Object.assign({}, DefaultPluginArgs, { bindHostOrIp: '127.0.0.1' });
    context.nodeId = 'node-hub';
    device = { udid: 'u1', host: 'h1', platform: 'android', nodeId: 'node-hub', teamId: null };

    restore = saveRegistrations(ApiKeyService, UserService, JwtKeyService);
    Container.set(ApiKeyService, {
      verifyPair: sinon.stub().callsFake(async (ak: string) => keys[ak] ?? null),
      hasScope: (row: any, wanted: string[]) => {
        const owned = row.scopes.split(',');
        return owned.includes('admin') || wanted.some((s) => owned.includes(s));
      },
    } as any);
    const users = { findById: async (id: string) => ({ id, role: 'MEMBER', status: 'ACTIVE' }) };
    findById = sinon.spy(users, 'findById');
    Container.set(UserService, users as any);
    Container.set(JwtKeyService, {
      verify: async (t: string) => {
        const [sub, teamId] = t.replace(/^jwt:/, '').split('@');
        return { sub, teamId: teamId ?? null };
      },
    } as any);
    teamRows = sinon.stub(prisma.teamMember, 'findMany').resolves([] as any);

    sinon.stub(pendingSessions, 'addNewPendingSession').callsFake(async (c: any) => {
      pendingRow = JSON.parse(JSON.stringify(c));
    });
    sinon.stub(pendingSessions, 'removePendingSession').resolves();
    sinon.stub(deviceService, 'updateDeviceProgress').resolves();
    sinon.stub(deviceService, 'updatedAllocatedDevice').resolves();
    sinon.stub(deviceUtils, 'allocateDeviceForSession').callsFake(async () => device);

    svc = new SessionLifecycleService();
    sinon.stub(svc as any, 'createSessionInstance').callsFake((...args: any[]) => {
      finalCaps = JSON.parse(JSON.stringify(args[2]));
      return {};
    });
    sinon.stub(svc as any, 'applyPostSessionLogic').resolves();
    pendingRow = driverCaps = finalCaps = forwardedCaps = undefined;
  });

  afterEach(() => {
    config.authDisabled = authDisabledBefore;
    Object.assign(context, savedContext);
    sinon.restore();
    restore();
  });

  describe('the requester it records', () => {
    it("a key's user, with no team narrowing for a key bound to none", async () => {
      await create(withKey('ak_member'));
      expect(pendingRow[REQUESTER]).to.deep.equal({ userId: 'usr_member', teamId: null });
    });

    it("a team-bound key's team", async () => {
      await create(withKey('ak_team_a'));
      expect(pendingRow[REQUESTER]).to.deep.equal({ userId: 'usr_member', teamId: 'team_a' });
    });

    it('the team xenon:team asks for', async () => {
      await create(withKey('ak_admin', { 'xenon:team': 'team_b' }));
      expect(pendingRow[REQUESTER]).to.deep.equal({ userId: 'usr_admin', teamId: 'team_b' });
    });

    it("a session token's subject and its teamId claim", async () => {
      await create(caps({ 'xe:options': { sessionToken: 'jwt:usr_token@team_t' } }));
      expect(pendingRow[REQUESTER]).to.deep.equal({ userId: 'usr_token', teamId: 'team_t' });
    });

    it('nobody, for a session with no credentials: the key is still written', async () => {
      await create(caps());
      expect(pendingRow[REQUESTER]).to.deep.equal({ userId: null, teamId: null });
    });

    it('nobody, with auth disabled', async () => {
      config.authDisabled = true;
      await create(withKey('ak_member'));
      expect(pendingRow[REQUESTER]).to.deep.equal({ userId: null, teamId: null });
    });

    it('never one the client sent', async () => {
      const forged = { userId: 'usr_victim', teamId: 'team_victim' };
      const sent: any = withKey('ak_member', { [REQUESTER]: forged });
      sent.firstMatch = [{ [REQUESTER]: forged }];
      await create(sent);
      expect(pendingRow[REQUESTER]).to.deep.equal({ userId: 'usr_member', teamId: null });
    });

    it('from the one user and team lookup the session is scoped by, with none of its own', async () => {
      await create(withKey('ak_member'));
      expect(findById.calledOnce).to.equal(true);
      expect(teamRows.calledOnce).to.equal(true);
    });
  });

  describe('it stays on the pending-session row', () => {
    it('never reaches the driver, the Session row, or the caps the client sent', async () => {
      const sent = await create(withKey('ak_team_a'));
      expect(pendingRow).to.have.property(REQUESTER);
      for (const [where, bag] of Object.entries({ driverCaps, finalCaps, sent })) {
        expect(JSON.stringify(bag), where).to.not.include(REQUESTER);
      }
    });

    it('never reaches a peer node the session is forwarded to', async () => {
      device.nodeId = 'node-peer';
      sinon.stub(svc as any, 'finalizeSession').callsFake(async (...args: any[]) => {
        finalCaps = JSON.parse(JSON.stringify(args[2]));
      });
      sinon.stub(svc, 'forwardSessionRequest').callsFake(async (_d: any, c: any) => {
        forwardedCaps = JSON.parse(JSON.stringify(c));
        return { protocol: 'W3C', value: ['sess-1', {}, 'W3C'] } as any;
      });
      await create(withKey('ak_team_a'));
      expect(pendingRow).to.have.property(REQUESTER);
      expect(JSON.stringify(forwardedCaps)).to.not.include(REQUESTER);
      expect(JSON.stringify(finalCaps)).to.not.include(REQUESTER);
    });
  });
});
