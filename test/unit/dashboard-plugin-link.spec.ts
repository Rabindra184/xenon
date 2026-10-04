import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { createRouter } from '../../src/app/index';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { InternalHttpClient } from '../../src/InternalHttpClient';
import { config } from '../../src/config';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import {
  DASHBOARD_PING_TIMEOUT_MS,
  dashboardPluginMiddleware,
  dashboardPluginMiddlewareFor,
  ownServerOrigin,
} from '../../src/app/dashboardPluginLink';
import GridRouter from '../../src/app/routers/grid';

// The store grid.ts took when it was loaded (it keeps the one it got then).
const gridStore = DeviceStoreFactory.getStore();

/**
 * Where Xenon looks for the appium-dashboard-plugin, and the `dashboard_link`
 * it hands back with each device.
 *
 * Through 2.14 both came from the Host header of the first /xenon/api request
 * after startup, before the login (a GET /xenon/api/health was enough):
 * Xenon sent a GET to `<that host>/dashboard/api/ping`, and if the answer had
 * `pong`, kept `<that host>/dashboard` for the life of the process. From then
 * on every device list fetched `<that host>/dashboard/api/sessions`, and gave
 * every user a `dashboard_link` to that host. A forged Host made Xenon call a
 * server of the sender's choosing (blind SSRF) and point everyone at it.
 *
 * Both now come from configuration: the plugin is reached on this server's own
 * address and port, and the link is `/dashboard` under XENON_PUBLIC_URL, or a
 * path on the server the dashboard is open on.
 */
describe('the dashboard-plugin link never comes from a request', () => {
  const EVIL = 'attacker.example:8080';
  let calls: string[];
  let authDisabledBefore: boolean;
  let publicUrlBefore: string | undefined;

  beforeEach(async () => {
    authDisabledBefore = config.authDisabled;
    publicUrlBefore = config.publicUrl;
    config.authDisabled = true;
    calls = [];
    sinon.stub(InternalHttpClient, 'get').callsFake((async (url: string) => {
      calls.push(url);
      if (url.endsWith('/dashboard/api/ping')) return { pong: true };
      return { result: { rows: [] } };
    }) as any);
    sinon
      .stub(gridStore, 'getAllDevices')
      .resolves([{ udid: 'phone-1', host: 'http://127.0.0.1:4723', platform: 'android' } as any]);
  });

  afterEach(() => {
    config.authDisabled = authDisabledBefore;
    config.publicUrl = publicUrlBefore;
    sinon.restore();
  });

  // This server's own address, as ServerManager passes it from Appium's CLI
  // arguments. InternalHttpClient is stubbed, so nothing is sent anywhere.
  function app() {
    const a = express();
    a.use(
      '/xenon',
      createRouter({ ...DefaultPluginArgs, bindHostOrIp: '127.0.0.1' } as any, {
        address: '0.0.0.0',
        port: 4999,
      }),
    );
    return a;
  }

  // The old check was a layer ahead of the login, first on the router, so a
  // public request was enough: GET /xenon/api/health with a forged Host made
  // Xenon ping that host. Now a public request makes no outbound call at all.
  it('asks nothing of anyone for a public request, whatever Host it names', async () => {
    await request(app()).get('/xenon/api/health').set('Host', EVIL);
    expect(calls).to.deep.equal([]);
  });

  // Lets the middleware's ping (started by a request, never awaited by one)
  // finish.
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  // The middleware ServerManager installs, with the device list, on a router
  // of their own: the process-wide /xenon router may already answer /device
  // from a layer another spec put ahead of it.
  describe('the device list', () => {
    function gridApp(ownServer: { address?: string; port: number; tls?: boolean }) {
      const r = express.Router();
      r.use((req, _res, next) => {
        (req as any).auth = {
          kind: 'user-session',
          userId: 'u1',
          role: 'SUPER_ADMIN',
          scopes: 'admin',
        };
        next();
      });
      r.use(dashboardPluginMiddlewareFor(ownServer));
      GridRouter.register(r, { ...DefaultPluginArgs } as any);
      const a = express();
      a.use('/xenon/api', r);
      return a;
    }

    /** A first request starts the ping; the second sees what it found. */
    async function devices(a: express.Express) {
      await request(a).get('/xenon/api/device').set('Host', EVIL);
      await settle();
      return request(a).get('/xenon/api/device').set('Host', EVIL);
    }

    it("fetches the plugin's sessions from this server, never the request's host", async () => {
      await devices(gridApp({ address: '0.0.0.0', port: 4999 }));
      expect(calls.length, 'the ping and the sessions fetch ran').to.be.greaterThan(1);
      expect(calls[0]).to.equal('http://127.0.0.1:4999/dashboard/api/ping');
      for (const url of calls.slice(1)) {
        expect(url).to.match(/^http:\/\/127\.0\.0\.1:4999\/dashboard\/api\/sessions\?/);
      }
    });

    it('links a device to /dashboard under XENON_PUBLIC_URL, or on the server it is open on', async () => {
      config.publicUrl = 'https://xenon.example.com';
      const withPublic = await devices(gridApp({ port: 4999 }));
      const phone = withPublic.body.find((d: any) => d.udid === 'phone-1');
      expect(phone.dashboard_link).to.match(
        /^https:\/\/xenon\.example\.com\/dashboard\?device_udid=phone-1&/,
      );

      config.publicUrl = undefined;
      const without = await devices(gridApp({ port: 4999 }));
      expect(without.body.find((d: any) => d.udid === 'phone-1').dashboard_link).to.match(
        /^\/dashboard\?device_udid=phone-1&/,
      );
    });

    // Appium serves HTTPS with --ssl-certificate-path and --ssl-key-path. A
    // plain-HTTP ping got ECONNRESET, retried three times (about 4 s) while
    // every signed-in request waited on it, every 30 s once the back-off
    // capped, and the plugin's link was lost.
    it('pings over HTTPS when Appium serves it, once, with a short time limit', async () => {
      await devices(gridApp({ address: '0.0.0.0', port: 4999, tls: true }));
      const ping = (InternalHttpClient.get as sinon.SinonStub).firstCall;
      expect(ping.args[0]).to.equal('https://127.0.0.1:4999/dashboard/api/ping');
      expect(ping.args[1]).to.include({ retry: false, timeout: DASHBOARD_PING_TIMEOUT_MS });
      expect(DASHBOARD_PING_TIMEOUT_MS).to.be.at.most(2000);
    });
  });

  describe('dashboardPluginMiddleware', () => {
    const run = async (mw: any, host = EVIL) => {
      const req: any = { headers: { host }, get: () => host, protocol: 'http' };
      await new Promise<void>((resolve) => mw(req, {}, resolve));
      return req;
    };

    it('reaches the plugin on the server it is given, whatever the request', async () => {
      const got: string[] = [];
      const mw = dashboardPluginMiddleware({
        ownServerOrigin: 'http://127.0.0.1:4723',
        get: async (url) => {
          got.push(url);
          return { pong: true };
        },
        publicBase: () => null,
      });
      await run(mw);
      await settle();
      const req = await run(mw);
      expect(got).to.deep.equal(['http://127.0.0.1:4723/dashboard/api/ping']);
      expect(req['dashboard-plugin-url']).to.equal('http://127.0.0.1:4723/dashboard');
      expect(req['dashboard-plugin-link']).to.equal('/dashboard');
      await run(mw, 'other.example');
      expect(got, 'pinged once, while it answers').to.have.length(1);
    });

    // A request never waits for the ping: one the plugin doesn't answer
    // (a hung server, the wrong scheme) would hold every signed-in request.
    it('never holds a request while the ping is out', async () => {
      const mw = dashboardPluginMiddleware({
        ownServerOrigin: 'http://127.0.0.1:4723',
        get: () => new Promise(() => undefined),
      });
      const outcome = await Promise.race([
        run(mw).then(() => 'answered'),
        new Promise((resolve) => setTimeout(() => resolve('held'), 200)),
      ]);
      expect(outcome).to.equal('answered');
    });

    it('backs off after a failed ping, and links nothing meanwhile', async () => {
      let t = 0;
      const get = sinon.stub().rejects(new Error('ECONNREFUSED'));
      const mw = dashboardPluginMiddleware({
        ownServerOrigin: 'http://127.0.0.1:4723',
        get,
        now: () => t,
      });
      await run(mw);
      await settle();
      const req = await run(mw);
      expect(req['dashboard-plugin-url']).to.equal('');
      expect(req['dashboard-plugin-link']).to.equal('');
      expect(get.callCount, 'no second ping inside the back-off').to.equal(1);
      t = 1000;
      await run(mw);
      expect(get.callCount).to.equal(2);
    });

    it('finds the server on 127.0.0.1 for a wildcard bind address, over HTTPS when asked', () => {
      expect(ownServerOrigin('0.0.0.0', 4723)).to.equal('http://127.0.0.1:4723');
      expect(ownServerOrigin(undefined, 4723)).to.equal('http://127.0.0.1:4723');
      expect(ownServerOrigin('::', 4723)).to.equal('http://127.0.0.1:4723');
      expect(ownServerOrigin('10.0.0.5', 4723)).to.equal('http://10.0.0.5:4723');
      expect(ownServerOrigin('fe80::1', 4723)).to.equal('http://[fe80::1]:4723');
      expect(ownServerOrigin('0.0.0.0', 4723, true)).to.equal('https://127.0.0.1:4723');
    });
  });
});
