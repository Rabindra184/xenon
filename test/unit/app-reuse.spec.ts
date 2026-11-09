import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { createHash } from 'crypto';
import { Container } from 'typedi';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { PluginContext } from '../../src/PluginContext';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserService } from '../../src/services/UserService';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { AppDownloadTicketService } from '../../src/services/token/AppDownloadTicketService';
import { NodeAppCache } from '../../src/services/apps/NodeAppCache';
import { APP_SERVICE } from '../../src/dashboard/services/app-service';
import * as pendingSessions from '../../src/data-service/pending-sessions-service';
import * as deviceService from '../../src/data-service/device-service';
import * as deviceUtils from '../../src/device-utils';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { config } from '../../src/config';
import { capsForNode } from '../../src/services/session/nodeCreateCaps';
import {
  HubApp,
  appCapabilityOf,
  readHubApp,
  withoutQuery,
} from '../../src/services/session/appCapability';
import { saveRegistrations } from '../helpers/container-registration';
import { loopbackServers } from '../helpers/loopbackServer';

const PLAIN = (id: string) => `http://127.0.0.1:4726/xenon/api/apps/${id}/download`;
const TICKETED = /^http:\/\/127\.0\.0\.1:4726\/xenon\/api\/apps\/([^/?]+)\/download\?ticket=.+$/;
const md5Of = (bytes: Buffer) => createHash('md5').update(bytes).digest('hex');

/**
 * ENH-19: an uploaded app is transferred at most once per build per host.
 * Appium caches downloads by the whole URL, and with sign-in on each session's
 * URL carried a new single-use ticket, so the driver downloaded the build
 * again for every session.
 */
describe('Uploaded apps are reused, not downloaded per session (ENH-19)', () => {
  describe('readHubApp', () => {
    const good = { id: 'a1b2-c3', md5: 'f'.repeat(32), size: 10, extension: '.apk' };

    it('reads what a hub sends', () => {
      expect(readHubApp(good)).to.deep.equal(good);
    });

    for (const [why, bad] of [
      ['an id that is a path', { ...good, id: '../../etc' }],
      ['an md5 that is not one', { ...good, md5: 'abc' }],
      ['an upper-case md5', { ...good, md5: 'F'.repeat(32) }],
      ['a size of 0', { ...good, size: 0 }],
      ['a size that is text', { ...good, size: '10' }],
      ['an extension with a slash', { ...good, extension: '.a/b' }],
      ['an extension with no dot', { ...good, extension: 'apk' }],
      ['a list', [good]],
      ['nothing', undefined],
    ] as const) {
      it(`refuses ${why}`, () => {
        expect(readHubApp(bad)).to.equal(undefined);
      });
    }

    it('the URL helpers', () => {
      expect(withoutQuery('http://h/x?ticket=t')).to.equal('http://h/x');
      expect(withoutQuery('http://h/x')).to.equal('http://h/x');
      expect(
        appCapabilityOf({ alwaysMatch: {}, firstMatch: [{ 'appium:app': 'http://h/a' }] } as any),
      ).to.equal('http://h/a');
    });
  });

  describe('the copy of a create a node is sent (capsForNode)', () => {
    const app: HubApp = { id: 'app-1', md5: 'a'.repeat(32), size: 42, extension: '.apk' };

    it("carries the hub's app, beside the client's other options", () => {
      const caps = {
        alwaysMatch: { 'appium:app': 'http://hub/x?ticket=t', 'xe:options': { maskInput: true } },
        firstMatch: [{}],
      };
      const sent = capsForNode(caps as any, 'phone-1', app);
      expect(sent.alwaysMatch['xe:options']).to.deep.equal({ maskInput: true, hubApp: app });
      expect((caps.alwaysMatch['xe:options'] as any).hubApp).to.equal(undefined);
    });

    it('never passes on a hubApp the client sent', () => {
      const forged = { id: 'other', md5: 'b'.repeat(32), size: 1, extension: '.apk' };
      const caps = {
        alwaysMatch: { 'xe:options': { hubApp: forged }, 'xenon:options': { hubApp: forged } },
        firstMatch: [{ 'xe:options': { hubApp: forged } }],
      };
      const withNone = capsForNode(caps as any, 'phone-1');
      expect(JSON.stringify(withNone)).not.to.include('hubApp');
      const withOurs = capsForNode(caps as any, 'phone-1', app);
      expect(withOurs.alwaysMatch['xe:options'].hubApp).to.deep.equal(app);
      expect(JSON.stringify(withOurs)).not.to.include('"other"');
    });
  });

  describe('a create', () => {
    let dir: string;
    let svc: SessionLifecycleService;
    let context: PluginContext;
    let savedContext: Partial<PluginContext>;
    let authDisabledBefore: boolean;
    let driverCaps: any;
    let allocate: sinon.SinonStub;
    let mint: sinon.SinonSpy;
    let restore: () => void;
    let finalCaps: any;
    let apps: Record<string, any>;

    const caps = (app: string, options?: Record<string, unknown>) => ({
      alwaysMatch: {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:app': app,
        ...(options ? { 'xe:options': options } : {}),
      },
      firstMatch: [{}],
    });

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
        NodeAppCache,
      );
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-app-reuse-'));
      const jwt = new JwtKeyService();
      await jwt.init(dir);
      Container.set(JwtKeyService, jwt);
      const tickets = new AppDownloadTicketService();
      mint = sinon.spy(tickets, 'mint');
      Container.set(AppDownloadTicketService, tickets);

      const apk = path.join(dir, 'app-here.apk');
      fs.writeFileSync(apk, 'the apk');
      apps = {
        'app-here': {
          id: 'app-here',
          teamId: null,
          filepath: apk,
          md5: md5Of(Buffer.from('the apk')),
          size: 7,
        },
        'app-elsewhere': {
          id: 'app-elsewhere',
          teamId: null,
          filepath: path.join(dir, 'gone.apk'),
          md5: 'c'.repeat(32),
          size: 9,
        },
        'app-old': { id: 'app-old', teamId: null, filepath: apk, md5: null, size: 7 },
      };
      sinon.stub(APP_SERVICE, 'getAppById').callsFake(async (id: string) => apps[id] ?? null);
      const device = { udid: 'u1', host: 'h1', platform: 'android', nodeId: 'node-hub' };
      allocate = sinon.stub(deviceUtils, 'allocateDeviceForSession').resolves(device as any);
      sinon.stub(pendingSessions, 'addNewPendingSession').resolves();
      sinon.stub(pendingSessions, 'removePendingSession').resolves();
      sinon.stub(deviceService, 'updateDeviceProgress').resolves();
      sinon.stub(deviceService, 'claimDeviceForSession').resolves(true);
      sinon.stub(deviceService, 'releasePendingClaim').resolves(true);

      svc = new SessionLifecycleService();
      sinon.stub(svc as any, 'createSessionInstance').callsFake((...args: any[]) => {
        finalCaps = JSON.parse(JSON.stringify(args[2]));
        return {};
      });
      sinon.stub(svc as any, 'applyPostSessionLogic').resolves();
      driverCaps = finalCaps = undefined;
    });

    afterEach(() => {
      config.authDisabled = authDisabledBefore;
      Object.assign(context, savedContext);
      sinon.restore();
      restore();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    describe("on this server's own phone", () => {
      it("hands the driver the library's file: no download, no ticket", async () => {
        const c = caps('app-here');
        const out = await create(c);
        expect(out.alwaysMatch['appium:app']).to.equal(apps['app-here'].filepath);
        expect(mint.called).to.equal(false);
        // What is kept is the plain URL, never the file.
        expect(c.alwaysMatch['appium:app']).to.equal(PLAIN('app-here'));
        expect(finalCaps.desired['appium:app']).to.equal(PLAIN('app-here'));
      });

      it("gets the ticketed URL, as before, when the library's file isn't on this server", async () => {
        const out = await create(caps('app-elsewhere'));
        expect(TICKETED.exec(out.alwaysMatch['appium:app'])?.[1]).to.equal('app-elsewhere');
        expect(mint.calledOnce).to.equal(true);
      });

      it('gets the file with sign-in off too', async () => {
        config.authDisabled = true;
        const out = await create(caps('app-here'));
        expect(out.alwaysMatch['appium:app']).to.equal(apps['app-here'].filepath);
      });
    });

    describe("on a node's phone", () => {
      let forwarded: any;

      beforeEach(() => {
        allocate.resolves({
          udid: 'u2',
          host: 'http://10.0.0.2:4723',
          platform: 'android',
          nodeId: 'node-2',
        } as any);
        sinon.stub(svc, 'forwardSessionRequest').callsFake(async (_d: any, c: any) => {
          forwarded = JSON.parse(JSON.stringify(c));
          return { value: ['sess-2', { platformName: 'Android' }] } as any;
        });
        sinon.stub(svc as any, 'finalizeSession').resolves();
        forwarded = undefined;
      });

      it('sends the ticketed URL and what the app is', async () => {
        await svc.createSession(sinon.stub(), {}, caps('app-here'));
        expect(TICKETED.exec(forwarded.alwaysMatch['appium:app'])?.[1]).to.equal('app-here');
        expect(forwarded.alwaysMatch['xe:options'].hubApp).to.deep.equal({
          id: 'app-here',
          md5: apps['app-here'].md5,
          size: 7,
          extension: '.apk',
        });
      });

      it('sends no app record for an app stored before md5s were kept', async () => {
        await svc.createSession(sinon.stub(), {}, caps('app-old'));
        expect(TICKETED.test(forwarded.alwaysMatch['appium:app'])).to.equal(true);
        expect(forwarded.alwaysMatch['xe:options']?.hubApp).to.equal(undefined);
      });
    });

    describe('on a node, a create from its hub', () => {
      const hubUrl = 'http://hub.test:4723/xenon/api/apps/app-1/download?ticket=tk';
      const hubApp: HubApp = { id: 'app-1', md5: 'd'.repeat(32), size: 5, extension: '.apk' };
      let fileFor: sinon.SinonStub;

      beforeEach(() => {
        fileFor = sinon.stub().resolves('/cache/app-1.apk');
        Container.set(NodeAppCache, { fileFor } as any);
        sinon.stub(svc as any, 'handleLocalWDAProvisioning').resolves();
        sinon.stub(svc as any, 'finishCreate').callsFake(async () => ({}));
      });

      async function complete(withApp: HubApp | undefined) {
        const c: any = caps(hubUrl);
        let seen: string | undefined;
        const next = async () => {
          seen = c.alwaysMatch['appium:app'];
          return { value: ['s', {}] };
        };
        await svc.completeLocalSession(
          {
            caps: c,
            device: { udid: 'u3', host: 'h', platform: 'android' } as any,
            remote: false,
            pendingSessionId: 'p',
            apiKeyId: null,
            userId: null,
            hubApp: withApp,
          },
          next,
          {},
          c,
        );
        return { seen, kept: c.alwaysMatch['appium:app'] };
      }

      it("hands the driver the node's copy, and keeps the URL without its ticket", async () => {
        const { seen, kept } = await complete(hubApp);
        expect(seen).to.equal('/cache/app-1.apk');
        expect(fileFor.calledOnceWithExactly(hubUrl, hubApp)).to.equal(true);
        expect(kept).to.equal('http://hub.test:4723/xenon/api/apps/app-1/download');
      });

      it('fails the create, saying why, when the build cannot be fetched', async () => {
        fileFor.rejects(new Error('Could not fetch app app-1 from the hub: socket hang up'));
        const failed = sinon.stub(svc as any, 'failedCreate').resolves();
        let thrown: any;
        await complete(hubApp).catch((e) => (thrown = e));
        expect(String(thrown?.message)).to.include('Could not fetch app app-1 from the hub');
        expect(failed.calledOnce).to.equal(true);
      });

      it('leaves the URL to the driver when the hub sent no app record', async () => {
        const { seen } = await complete(undefined);
        expect(seen).to.equal(hubUrl);
        expect(fileFor.called).to.equal(false);
      });

      it("takes a hubApp only from a create its hub's token vouched for, or with sign-in off", () => {
        const c: any = caps(hubUrl, { hubApp });
        const grant = { userId: 'u', udid: 'u3', host: 'h' } as any;
        expect((svc as any).hubAppFor(c, grant)).to.deep.equal(hubApp);
        expect((svc as any).hubAppFor(c, undefined)).to.equal(undefined);
        config.authDisabled = true;
        expect((svc as any).hubAppFor(c, undefined)).to.deep.equal(hubApp);
      });
    });
  });

  describe("the node's cache (NodeAppCache)", () => {
    const loopback = loopbackServers();
    const BYTES = Buffer.from('an apk, more or less');
    let dir: string;
    let cache: NodeAppCache;
    let requests: string[];
    let body: Buffer;
    let base: string;
    let hold: Promise<void> | undefined;
    let restore: () => void;
    const app = (overrides: Partial<HubApp> = {}): HubApp => ({
      id: 'app-1',
      md5: md5Of(BYTES),
      size: BYTES.length,
      extension: '.apk',
      ...overrides,
    });

    beforeEach(async () => {
      restore = saveRegistrations(PluginContext);
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-node-app-cache-'));
      cache = new NodeAppCache();
      cache.dir = dir;
      requests = [];
      body = BYTES;
      hold = undefined;
      const server = await loopback.serve(
        http.createServer(async (req, res) => {
          requests.push(req.url ?? '');
          if (hold) await hold;
          res.writeHead(200, { 'content-type': 'application/octet-stream' });
          res.end(body);
        }) as any,
      );
      base = `http://127.0.0.1:${(server.address() as any).port}`;
    });

    afterEach(async () => {
      restore();
      await loopback.closeAll();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const url = (ticket: string, id = 'app-1') =>
      `${base}/xenon/api/apps/${id}/download?ticket=${ticket}`;

    it('fetches a build once, with the first ticket, and hands later creates the file', async () => {
      const first = await cache.fileFor(url('t1'), app());
      const second = await cache.fileFor(url('t2'), app());
      expect(second).to.equal(first);
      expect(fs.readFileSync(first).equals(BYTES)).to.equal(true);
      expect(requests).to.deep.equal(['/xenon/api/apps/app-1/download?ticket=t1']);
    });

    it('shares one download between two creates at once', async () => {
      let open!: () => void;
      hold = new Promise<void>((resolve) => (open = resolve));
      const both = Promise.all([cache.fileFor(url('t1'), app()), cache.fileFor(url('t2'), app())]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      open();
      const [a, b] = await both;
      expect(a).to.equal(b);
      expect(requests).to.have.length(1);
    });

    it('keeps nothing, and fails, when the bytes are not the build the hub described', async () => {
      body = Buffer.from('something else entirely');
      let thrown: any;
      await cache.fileFor(url('t1'), app()).catch((e) => (thrown = e));
      expect(String(thrown?.message)).to.include('Could not fetch app app-1 from the hub');
      expect(fs.readdirSync(dir)).to.deep.equal([]);
      // The next create fetches again rather than trusting a partial file.
      body = BYTES;
      await cache.fileFor(url('t2'), app());
      expect(requests).to.have.length(2);
    });

    it('fetches again when its copy was removed or cut short', async () => {
      const file = await cache.fileFor(url('t1'), app());
      fs.truncateSync(file, 3);
      await cache.fileFor(url('t2'), app());
      expect(requests).to.have.length(2);
      expect(fs.readFileSync(file).equals(BYTES)).to.equal(true);
    });

    it('keeps one file per hub, app and md5', async () => {
      const a = await cache.fileFor(url('t1'), app());
      const other = Buffer.from('build two');
      body = other;
      const b = await cache.fileFor(url('t2'), app({ md5: md5Of(other), size: other.length }));
      expect(a).to.not.equal(b);
      expect(path.basename(b)).to.match(/^[0-9a-f]{16}-app-1-[0-9a-f]{32}\.apk$/);
    });

    it('keeps the most recently used builds and deletes the rest', async () => {
      cache.keep = 2;
      const files: string[] = [];
      for (const n of [1, 2, 3]) {
        body = Buffer.from(`build ${n}`);
        files.push(
          await cache.fileFor(url(`t${n}`, `app-${n}`), {
            id: `app-${n}`,
            md5: md5Of(body),
            size: body.length,
            extension: '.apk',
          }),
        );
        // A distinct mtime for each, oldest first.
        const at = new Date(Date.now() - (10 - n) * 60_000);
        fs.utimesSync(files[files.length - 1], at, at);
      }
      body = Buffer.from('build 4');
      const fourth = await cache.fileFor(url('t4', 'app-4'), {
        id: 'app-4',
        md5: md5Of(body),
        size: body.length,
        extension: '.apk',
      });
      expect(fs.readdirSync(dir).sort()).to.deep.equal(
        [path.basename(files[2]), path.basename(fourth)].sort(),
      );
    });
  });
});
