import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { PluginContext } from '../../src/PluginContext';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserService } from '../../src/services/UserService';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { HubSessionTokenIssuer } from '../../src/gateway/hubSessionToken';
import * as pendingSessions from '../../src/data-service/pending-sessions-service';
import * as deviceService from '../../src/data-service/device-service';
import * as deviceUtils from '../../src/device-utils';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { config } from '../../src/config';
import { prisma } from '../../src/prisma';
import { saveRegistrations } from '../helpers/container-registration';
import { useLokiStores } from '../helpers/loki-stores';

/**
 * createSession end to end: the credentials a session presents in
 * `xe:options` (or its alias `xenon:options`) are read once, then taken out of
 * the capabilities before anything else reads them. So they never reach the
 * pending-session row, device allocation, the driver, or the Session row.
 *
 * The Session row's two capability columns are both written from the session
 * response (event-manager: `desired_capabilities` from its `desired`,
 * `session_capabilities` from the rest), which is what createSessionInstance
 * is handed here. The fake driver echoes the capabilities it received, as
 * UiAutomator2 and XCUITest do, so anything the driver saw would show up there.
 */

const KEY = 'xen_SECRET_ACCESS_KEY';
const TOKEN = 'SECRET_API_TOKEN';
const JWT = 'jwt:usr_jwt';
const SECRETS = [KEY, TOKEN, JWT];

const keys: Record<string, any> = {
  [KEY]: { id: 'key_1', userId: 'usr_key', scopes: 'sessions', teamId: null },
};

const caps = (always: Record<string, unknown>, firstMatch: Record<string, unknown>[] = [{}]) => ({
  alwaysMatch: { platformName: 'Android', 'appium:automationName': 'UiAutomator2', ...always },
  firstMatch,
});

const leaked = (value: unknown) => SECRETS.filter((s) => JSON.stringify(value ?? null).includes(s));

describe('createSession — credentials never reach the driver or storage', () => {
  // The in-memory stores, also when this file runs on its own: without
  // NODE_ENV=test the factory handed out the Prisma stores, which are the
  // developer's ~/.cache/xenon/xenon.db.
  useLokiStores();
  let svc: SessionLifecycleService;
  let device: any;
  let context: PluginContext;
  let savedContext: Partial<PluginContext>;
  let authDisabledBefore: boolean;
  let gateBefore: string | undefined;
  let restore: () => void;
  let seen: Record<string, any>;
  let instance: any;
  let warn: sinon.SinonSpy;

  const create = async (sent: any) => {
    const next = sinon.stub().callsFake(async () => {
      seen.driver = JSON.parse(JSON.stringify(sent));
      const merged = Object.assign({}, sent.firstMatch?.[0], sent.alwaysMatch);
      return { value: ['sess-1', JSON.parse(JSON.stringify(merged))] };
    });
    await svc.createSession(next, {}, sent);
    seen.sent = sent;
    return sent;
  };

  const refusal = async (sent: any) => {
    try {
      await create(sent);
    } catch (err: any) {
      return err.message as string;
    }
    return 'created';
  };

  beforeEach(() => {
    authDisabledBefore = config.authDisabled;
    config.authDisabled = false;
    gateBefore = process.env.XENON_REQUIRE_SESSION_TOKEN;
    delete process.env.XENON_REQUIRE_SESSION_TOKEN;

    context = Container.get(PluginContext);
    savedContext = { pluginArgs: context.pluginArgs, nodeId: context.nodeId };
    context.pluginArgs = Object.assign({}, DefaultPluginArgs, { bindHostOrIp: '127.0.0.1' });
    context.nodeId = 'node-hub';
    device = { udid: 'u1', host: 'h1', platform: 'android', nodeId: 'node-hub', teamId: null };

    restore = saveRegistrations(ApiKeyService, UserService, JwtKeyService, HubSessionTokenIssuer);
    Container.set(ApiKeyService, {
      verifyPair: sinon
        .stub()
        .callsFake(async (ak: string, tk: string) => (tk === TOKEN ? (keys[ak] ?? null) : null)),
      hasScope: (row: any, wanted: string[]) => wanted.some((s) => row.scopes.includes(s)),
    } as any);
    Container.set(UserService, {
      findById: async (id: string) => ({ id, role: 'MEMBER', status: 'ACTIVE' }),
    } as any);
    Container.set(JwtKeyService, {
      verify: async (t: string) => {
        if (!t.startsWith('jwt:')) throw new Error('bad token');
        return { sub: t.slice('jwt:'.length), teamId: null, scopes: 'sessions' };
      },
    } as any);

    // The owner's teams: none, and not read from the developer's database.
    sinon.stub(prisma.teamMember, 'findMany').resolves([] as any);

    seen = {};
    sinon.stub(pendingSessions, 'addNewPendingSession').callsFake(async (c: any) => {
      seen.pending = JSON.parse(JSON.stringify(c));
    });
    sinon.stub(pendingSessions, 'removePendingSession').resolves();
    sinon.stub(deviceService, 'updateDeviceProgress').resolves();
    sinon.stub(deviceService, 'updatedAllocatedDevice').resolves();
    sinon.stub(deviceUtils, 'allocateDeviceForSession').callsFake(async (c: any) => {
      seen.allocation = JSON.parse(JSON.stringify(c));
      return device;
    });

    svc = new SessionLifecycleService();
    warn = sinon.spy((svc as any).logger, 'warn');
    sinon.stub(svc as any, 'createSessionInstance').callsFake((...args: any[]) => {
      seen.sessionResponse = JSON.parse(JSON.stringify(args[2]));
      instance = {};
      return instance;
    });
    sinon.stub(svc as any, 'applyPostSessionLogic').resolves();
    instance = undefined;
  });

  afterEach(() => {
    config.authDisabled = authDisabledBefore;
    if (gateBefore === undefined) delete process.env.XENON_REQUIRE_SESSION_TOKEN;
    else process.env.XENON_REQUIRE_SESSION_TOKEN = gateBefore;
    Object.assign(context, savedContext);
    sinon.restore();
    restore();
  });

  const expectNothingLeaked = () => {
    for (const where of ['pending', 'allocation', 'driver', 'sessionResponse', 'sent']) {
      expect(seen[where], `${where} was never reached`).to.not.equal(undefined);
      expect(leaked(seen[where]), where).to.deep.equal([]);
    }
    // What event-manager writes to the Session row.
    expect(leaked(seen.sessionResponse.desired), 'desired_capabilities').to.deep.equal([]);
  };

  describe('an access key and token in xe:options', () => {
    it('attribute the session and stop there', async () => {
      await create(caps({ 'xe:options': { accessKey: KEY, token: TOKEN, buildId: 'b-1' } }));
      expect(instance.apiKeyId).to.equal('key_1');
      expect(instance.userId).to.equal('usr_key');
      expectNothingLeaked();
      // Options that are not secrets still travel.
      expect(seen.driver.alwaysMatch['xe:options']).to.deep.equal({ buildId: 'b-1' });
      expect(seen.sessionResponse.desired['xe:options']).to.deep.equal({ buildId: 'b-1' });
    });

    it('are taken from firstMatch too, and from every firstMatch entry', async () => {
      await create(
        caps({}, [
          { 'xe:options': { accessKey: KEY, token: TOKEN } },
          { 'xe:options': { accessKey: KEY, token: TOKEN } },
        ]),
      );
      expect(instance.userId).to.equal('usr_key');
      expectNothingLeaked();
      expect(leaked(seen.driver.firstMatch)).to.deep.equal([]);
    });
  });

  it('a session token in xe:options attributes the session and stops there', async () => {
    await create(caps({ 'xe:options': { sessionToken: JWT } }));
    expect(instance.apiKeyId).to.equal(null);
    expect(instance.userId).to.equal('usr_jwt');
    expectNothingLeaked();
  });

  it('the xenon:options alias works the same, and is stripped the same', async () => {
    await create(caps({ 'xenon:options': { accessKey: KEY, token: TOKEN, sessionToken: JWT } }));
    expect(instance.userId).to.equal('usr_key');
    expectNothingLeaked();
  });

  it('xe:options wins over xenon:options field by field, and both are stripped', async () => {
    await create(
      caps({
        'xenon:options': { accessKey: KEY, token: 'WRONG_TOKEN' },
        'xe:options': { token: TOKEN },
      }),
    );
    expect(instance.apiKeyId).to.equal('key_1');
    expectNothingLeaked();
    expect(JSON.stringify(seen.driver)).to.not.include('WRONG_TOKEN');
  });

  describe('df:options is not Xenon’s and is not read', () => {
    it('a session sending only df:options is unattributed, like one with no credentials', async () => {
      await create(caps({ 'df:options': { accessKey: KEY, token: TOKEN } }));
      expect(instance.apiKeyId).to.equal(null);
      expect(instance.userId).to.equal(null);
      const warned = warn.getCalls().map((c) => String(c.args[0]));
      expect(warned.some((m) => m.includes('xe:options.accessKey'))).to.equal(true);
    });

    it('and is refused when XENON_REQUIRE_SESSION_TOKEN is on, naming the new form', async () => {
      process.env.XENON_REQUIRE_SESSION_TOKEN = 'true';
      const message = await refusal(caps({ 'df:options': { accessKey: KEY, token: TOKEN } }));
      expect(message).to.include('xe:options.accessKey');
      expect(message).to.include('xe:options.token');
      expect(message).to.include('xe:options.sessionToken');
      expect(message).to.not.include('df:options');
      expect(seen.pending, 'no pending-session row').to.equal(undefined);
      expect(seen.driver, 'no driver').to.equal(undefined);
    });

    it('while the same credentials in xe:options pass that gate', async () => {
      process.env.XENON_REQUIRE_SESSION_TOKEN = 'true';
      expect(await refusal(caps({ 'xe:options': { accessKey: KEY, token: TOKEN } }))).to.equal(
        'created',
      );
      expectNothingLeaked();
    });
  });

  describe('when the device is on another node', () => {
    let grants: sinon.SinonStub;

    beforeEach(() => {
      sinon.stub(svc as any, 'finalizeSession').callsFake(async (...args: any[]) => {
        seen.sessionResponse = { desired: JSON.parse(JSON.stringify(args[2])) };
      });
      sinon.stub(svc, 'forwardSessionRequest').callsFake(async (_d: any, c: any, t: any) => {
        seen.forwarded = JSON.parse(JSON.stringify(c));
        seen.hubToken = t;
        return { protocol: 'W3C', value: ['sess-1', {}, 'W3C'] } as any;
      });
      grants = sinon.stub().resolves('HUB-CREATE-TOKEN');
      Container.set(HubSessionTokenIssuer, {
        createTokenFor: grants,
        forget: () => undefined,
      } as any);
    });

    it('a peer Xenon node never gets them: it gets the hub’s token for the verified owner', async () => {
      device.nodeId = 'node-peer';
      await create(caps({ 'xe:options': { accessKey: KEY, token: TOKEN, sessionToken: JWT } }));
      expect(leaked(seen.forwarded), 'forwarded').to.deep.equal([]);
      expect(seen.hubToken).to.equal('HUB-CREATE-TOKEN');
      expect(grants.firstCall.args[0]).to.deep.equal({ userId: 'usr_key', udid: 'u1', host: 'h1' });
      for (const where of ['pending', 'sent', 'sessionResponse']) {
        expect(leaked(seen[where]), where).to.deep.equal([]);
      }
    });

    it('a cloud provider gets neither', async () => {
      device.nodeId = undefined;
      device.cloud = true;
      await create(caps({ 'xe:options': { accessKey: KEY, token: TOKEN, sessionToken: JWT } }));
      expect(leaked(seen.forwarded)).to.deep.equal([]);
      expect(seen.hubToken).to.equal(null);
      expect(grants.called).to.equal(false);
    });
  });
});
