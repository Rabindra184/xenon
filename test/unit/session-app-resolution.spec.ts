import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as jose from 'jose';
import { Container } from 'typedi';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { HUB_CREATE_AUDIENCE } from '../../src/gateway/hubSessionToken';
import { PluginContext } from '../../src/PluginContext';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserService } from '../../src/services/UserService';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { AppDownloadTicketService } from '../../src/services/token/AppDownloadTicketService';
import { APP_SERVICE } from '../../src/dashboard/services/app-service';
import * as pendingSessions from '../../src/data-service/pending-sessions-service';
import * as deviceService from '../../src/data-service/device-service';
import * as deviceUtils from '../../src/device-utils';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { config } from '../../src/config';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * A session that names an uploaded app by id (`appium:app: <id>`) gets it
 * resolved to a download URL only when the session's creator may see the app,
 * by the same team scoping its phone is allocated with. The URL carries a
 * single-use ticket bound to that app, because the Appium driver downloads it
 * itself with no credentials.
 *
 * An app the creator can't see is left exactly as an unknown id is today: the
 * capability goes to the driver untouched, so the driver fails the session the
 * same way for both (it looks for a file by that name and finds none).
 */
const keys: Record<string, any> = {
  ak_team_a: { id: 'key_a', userId: 'usr_a', scopes: 'sessions', teamId: 'team-a' },
  ak_member: { id: 'key_m', userId: 'usr_m', scopes: 'sessions', teamId: null },
  ak_admin: { id: 'key_adm', userId: 'usr_adm', scopes: 'admin', teamId: null },
};

const APPS: Record<string, any> = {
  'app-shared': { id: 'app-shared', teamId: null },
  'app-a': { id: 'app-a', teamId: 'team-a' },
  'app-b': { id: 'app-b', teamId: 'team-b' },
};

const caps = (app: string, accessKey?: string) => ({
  alwaysMatch: {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:app': app,
    ...(accessKey ? { 'xe:options': { accessKey, token: 'tk' } } : {}),
  },
  firstMatch: [{}],
});

const URL_RE = /^http:\/\/127\.0\.0\.1:4726\/xenon\/api\/apps\/([^/?]+)\/download\?ticket=(.+)$/;

/** The app id and ticket in a resolved download URL; fails the test if it isn't one. */
function parseAppUrl(url: string): { appId: string; ticket: string } {
  const m = URL_RE.exec(url);
  if (!m) throw new Error(`not a ticketed app download URL: ${url}`);
  return { appId: m[1], ticket: decodeURIComponent(m[2]) };
}

describe('createSession — an app named by id follows the team rule', () => {
  let dir: string;
  let svc: SessionLifecycleService;
  let context: PluginContext;
  let savedContext: Partial<PluginContext>;
  let authDisabledBefore: boolean;
  let driverCaps: any;
  let allocate: sinon.SinonStub;
  let tickets: AppDownloadTicketService;
  let mint: sinon.SinonSpy;
  let restore: () => void;
  let pendingCopy: any;
  let finalCaps: any;
  let release: sinon.SinonStub;

  const create = async (c: any) => {
    const next = sinon.stub().callsFake(async () => {
      driverCaps = JSON.parse(JSON.stringify(c));
      return { value: ['sess-1', { platformName: 'Android' }] };
    });
    await svc.createSession(next, {}, c);
    return driverCaps;
  };

  beforeEach(async () => {
    authDisabledBefore = config.authDisabled;
    config.authDisabled = false;
    context = Container.get(PluginContext);
    savedContext = { pluginArgs: context.pluginArgs, nodeId: context.nodeId, port: context.port };
    context.pluginArgs = Object.assign({}, DefaultPluginArgs, { bindHostOrIp: '127.0.0.1' });
    context.nodeId = 'node-hub';
    context.port = 4726;

    restore = saveRegistrations(
      ApiKeyService,
      UserService,
      JwtKeyService,
      AppDownloadTicketService,
    );
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-session-app-'));
    const jwt = new JwtKeyService();
    await jwt.init(dir);
    Container.set(JwtKeyService, jwt);
    tickets = new AppDownloadTicketService();
    mint = sinon.spy(tickets, 'mint');
    Container.set(AppDownloadTicketService, tickets);
    Container.set(ApiKeyService, {
      verifyPair: sinon.stub().callsFake(async (ak: string) => keys[ak] ?? null),
      hasScope: (row: any, req: string[]) => {
        const owned = row.scopes.split(',');
        return owned.includes('admin') || req.some((s) => owned.includes(s));
      },
    } as any);
    // Every key's owner is an ACTIVE member: a key names its owner only while
    // they are. The admin key is unscoped by its admin scope.
    Container.set(UserService, {
      findById: async (id: string) => ({ id, role: 'MEMBER', status: 'ACTIVE' }),
    } as any);

    sinon.stub(APP_SERVICE, 'getAppById').callsFake(async (id: string) => APPS[id] ?? null);
    const device = { udid: 'u1', host: 'h1', platform: 'android', nodeId: 'node-hub' };
    allocate = sinon.stub(deviceUtils, 'allocateDeviceForSession').resolves(device as any);
    sinon.stub(pendingSessions, 'addNewPendingSession').callsFake(async (c: any) => {
      pendingCopy = JSON.parse(JSON.stringify(c));
    });
    sinon.stub(pendingSessions, 'removePendingSession').resolves();
    sinon.stub(deviceService, 'updateDeviceProgress').resolves();
    sinon.stub(deviceService, 'claimDeviceForSession').resolves(true);
    release = sinon.stub(deviceService, 'releasePendingClaim').resolves(true);

    svc = new SessionLifecycleService();
    sinon.stub(svc as any, 'createSessionInstance').callsFake((...args: any[]) => {
      finalCaps = JSON.parse(JSON.stringify(args[2]));
      return {};
    });
    sinon.stub(svc as any, 'applyPostSessionLogic').resolves();
    driverCaps = pendingCopy = finalCaps = undefined;
  });

  afterEach(() => {
    config.authDisabled = authDisabledBefore;
    Object.assign(context, savedContext);
    sinon.restore();
    restore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("resolves the creator's team app to a download URL with a ticket for that app", async () => {
    const out = await create(caps('app-a', 'ak_team_a'));
    const { appId, ticket } = parseAppUrl(out.alwaysMatch['appium:app']);
    expect(appId).to.equal('app-a');
    // The ticket in the URL is the one thing the driver's download presents.
    await tickets.redeem(ticket, 'app-a');
  });

  it('the ticket downloads that app only', async () => {
    const out = await create(caps('app-a', 'ak_team_a'));
    const { ticket } = parseAppUrl(out.alwaysMatch['appium:app']);
    let err: Error | undefined;
    try {
      await tickets.redeem(ticket, 'app-b');
    } catch (e: any) {
      err = e;
    }
    expect(String(err?.message)).to.match(/app mismatch/);
  });

  it('a shared app resolves for anyone', async () => {
    const out = await create(caps('app-shared', 'ak_member'));
    expect(parseAppUrl(out.alwaysMatch['appium:app']).appId).to.equal('app-shared');
  });

  it("leaves another team's app exactly as an unknown id: untouched, and no ticket minted", async () => {
    // What the client sent, less the credentials createSession takes out.
    const asSent = (app: string) => {
      const sent: any = caps(app, 'ak_team_a');
      sent.alwaysMatch['xe:options'] = {};
      return sent;
    };
    const hidden = await create(caps('app-b', 'ak_team_a'));
    const unknown = await create(caps('no-such-app', 'ak_team_a'));
    expect(hidden).to.deep.equal(asSent('app-b'));
    expect(unknown).to.deep.equal(asSent('no-such-app'));
    expect(mint.called).to.equal(false);
  });

  it('a member key in no team sees shared apps only', async () => {
    const out = await create(caps('app-a', 'ak_member'));
    expect(out.alwaysMatch['appium:app']).to.equal('app-a');
    expect(mint.called).to.equal(false);
  });

  it('uses the teams the phone is allocated with', async () => {
    await create(caps('app-a', 'ak_team_a'));
    expect(allocate.firstCall.args[4]).to.deep.equal(['team-a']);
    await create(caps('app-a', 'ak_member'));
    expect(allocate.secondCall.args[4]).to.deep.equal([]);
  });

  it("resolves any team's app for an admin key", async () => {
    const out = await create(caps('app-b', 'ak_admin'));
    expect(parseAppUrl(out.alwaysMatch['appium:app']).appId).to.equal('app-b');
  });

  it('rewrites the capability wherever the client put it', async () => {
    const c: any = {
      alwaysMatch: {
        platformName: 'Android',
        'xe:options': { accessKey: 'ak_team_a', token: 'tk' },
      },
      firstMatch: [{ 'appium:app': 'app-a' }],
    };
    const out = await create(c);
    expect(parseAppUrl(out.firstMatch[0]['appium:app']).appId).to.equal('app-a');
  });

  it('with auth disabled, keeps the plain URL: no ticket is needed, and the driver can cache it', async () => {
    config.authDisabled = true;
    const out = await create(caps('app-b'));
    expect(out.alwaysMatch['appium:app']).to.equal(
      'http://127.0.0.1:4726/xenon/api/apps/app-b/download',
    );
    expect(mint.called).to.equal(false);
  });

  // The ticket is a bearer secret until the driver spends it. Minted only when
  // the driver is about to read it, so it is never in the pending-session row
  // (which members who can see the phone can list while the session queues),
  // and the stored session keeps the plain URL.
  it('puts the ticket only in what the driver reads', async () => {
    const c = caps('app-a', 'ak_team_a');
    await create(c);
    const plain = 'http://127.0.0.1:4726/xenon/api/apps/app-a/download';
    expect(URL_RE.test(driverCaps.alwaysMatch['appium:app'])).to.equal(true);
    expect(pendingCopy['appium:app']).to.equal(plain);
    expect(finalCaps.desired['appium:app']).to.equal(plain);
    expect(c.alwaysMatch['appium:app']).to.equal(plain);
  });

  it('a session forwarded to another node carries the ticket; the hub keeps the plain URL', async () => {
    allocate.resolves({
      udid: 'u2',
      host: 'http://10.0.0.2:4723',
      platform: 'android',
      nodeId: 'node-2',
    } as any);
    let forwarded: any;
    sinon.stub(svc, 'forwardSessionRequest').callsFake(async (_d: any, c: any) => {
      forwarded = JSON.parse(JSON.stringify(c));
      return { value: ['sess-2', { platformName: 'Android' }] } as any;
    });
    sinon.stub(svc as any, 'finalizeSession').resolves();
    const c = caps('app-a', 'ak_team_a');
    await svc.createSession(sinon.stub(), {}, c);
    expect(parseAppUrl(forwarded.alwaysMatch['appium:app']).appId).to.equal('app-a');
    expect(c.alwaysMatch['appium:app']).to.equal(
      'http://127.0.0.1:4726/xenon/api/apps/app-a/download',
    );
  });

  // The app ticket and the session's credentials are both bearer secrets, and
  // are handled apart: the credentials are taken out before anything reads
  // the caps, the ticket is put in only for the driver. Neither may end up in
  // what Xenon stores.
  describe('beside the credential strip', () => {
    const PLAIN = 'http://127.0.0.1:4726/xenon/api/apps/app-a/download';

    it('the driver gets the ticket and no credentials; what is stored gets neither', async () => {
      const c = caps('app-a', 'ak_team_a');
      await create(c);
      expect(URL_RE.test(driverCaps.alwaysMatch['appium:app'])).to.equal(true);
      expect(driverCaps.alwaysMatch['xe:options']).to.deep.equal({});
      for (const [where, seen] of Object.entries({ pendingCopy, finalCaps, sent: c })) {
        const text = JSON.stringify(seen);
        expect(text, where).to.include(PLAIN);
        expect(text, where).to.not.include('ticket=');
        expect(text, where).to.not.match(/"token"|"accessKey"/);
      }
    });

    it('a peer node gets the ticket and the hub’s token, never the credentials; the hub keeps neither', async () => {
      allocate.resolves({
        udid: 'u2',
        host: 'http://10.0.0.2:4723',
        platform: 'android',
        nodeId: 'node-2',
      } as any);
      let forwarded: any;
      let hubToken: any;
      sinon.stub(svc, 'forwardSessionRequest').callsFake(async (_d: any, fc: any, t: any) => {
        forwarded = JSON.parse(JSON.stringify(fc));
        hubToken = t;
        return { value: ['sess-2', { platformName: 'Android' }] } as any;
      });
      sinon.stub(svc as any, 'finalizeSession').resolves();
      const c = caps('app-a', 'ak_team_a');
      await svc.createSession(sinon.stub(), {}, c);
      expect(parseAppUrl(forwarded.alwaysMatch['appium:app']).appId).to.equal('app-a');
      expect(forwarded.alwaysMatch['xe:options']).to.deep.equal({});
      expect(JSON.stringify(forwarded)).to.not.match(/"token"|"accessKey"/);
      expect(jose.decodeJwt(hubToken)).to.include({ aud: HUB_CREATE_AUDIENCE, udid: 'u2' });
      for (const [where, seen] of Object.entries({ pendingCopy, sent: c })) {
        const text = JSON.stringify(seen);
        expect(text, where).to.include(PLAIN);
        expect(text, where).to.not.include('ticket=');
        expect(text, where).to.not.match(/"token"|"accessKey"/);
      }
    });
  });

  it('fails the session and releases its phone when a ticket cannot be minted', async () => {
    mint.restore();
    sinon.stub(tickets, 'mint').rejects(new Error('JWT key service not initialized'));
    let err: Error | undefined;
    try {
      await create(caps('app-a', 'ak_team_a'));
    } catch (e: any) {
      err = e;
    }
    expect(String(err?.message)).to.match(/app-a.*JWT key service not initialized/);
    expect(driverCaps, 'the driver was never started').to.equal(undefined);
    expect(release.calledOnce).to.equal(true);
    expect(release.firstCall.args[0]).to.include({ udid: 'u1', host: 'h1' });
  });
});
