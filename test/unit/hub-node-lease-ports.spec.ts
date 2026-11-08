import 'reflect-metadata';
import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import express from 'express';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import PortsRouter from '../../src/app/routers/ports';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { csrfMiddleware } from '../../src/middleware/csrfMiddleware';
import {
  HUB_TOKEN_HEADER,
  HubSessionTokenIssuer,
  HubSessionTokenVerifier,
} from '../../src/gateway/hubSessionToken';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { PortAllocatorClient } from '../../src/services/ports/PortAllocatorClient';
import { defaultNodePairAuthProvider } from '../../src/services/lease/LeaseService';
import { buildCapabilities } from '../../src/app/routers/capabilities';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { config } from '../../src/config';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';
import { loopbackServers } from '../helpers/loopbackServer';

/**
 * A lease of a node's phone reserves its driver ports on the node
 * (`POST /ports/allocate`, then `extend` and `release`). Through 2.20 the hub
 * sent only its node-pair credentials (XENON_HUB_ACCESS_KEY / XENON_HUB_TOKEN),
 * which a node with sign-in on checks against its own database, where the
 * hub's users aren't: every lease of such a node's phone was refused
 * (Xenon Test's ENH-08). The hub now signs each call (audience
 * xenon-node-ports, the phone and its node), as it signs forwarded device
 * control, and the node takes it on its port routes only.
 */
describe("a lease's ports on a node's phone", () => {
  const scratch = useScratchDatabase();
  const loopback = loopbackServers();
  let dir: string;
  let hubKeys: JwtKeyService;
  let context: PluginContext;
  let saved: {
    context: Partial<PluginContext>;
    authDisabled: boolean;
    key?: string;
    token?: string;
  };
  let restore: () => void;
  let hubUrl: string;
  let nodeOrigin: string;
  let nodePort: number;
  let nodeArgs: any;
  const HUB_ARGS = { ...DefaultPluginArgs, bindHostOrIp: '127.0.0.1' } as any;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-ports-keys-'));
    hubKeys = new JwtKeyService();
    await hubKeys.init(dir);
    restore = saveRegistrations(JwtKeyService, HubSessionTokenIssuer);
    Container.set(JwtKeyService, hubKeys);
    Container.set(HubSessionTokenIssuer, new HubSessionTokenIssuer());
    context = Container.get(PluginContext);
    saved = {
      context: { ...context },
      authDisabled: config.authDisabled,
      key: config.hubAccessKey,
      token: config.hubToken,
    };
    // Sign-in on everywhere, and no node credentials on the hub.
    config.authDisabled = false;
    config.hubAccessKey = undefined;
    config.hubToken = undefined;

    const hub = express();
    hub.get('/xenon/api/auth/jwks.json', (_req, res) => res.json(hubKeys.jwks()));
    hubUrl = `http://127.0.0.1:${((await loopback.serve(hub)).address() as any).port}`;

    // The node: its CSRF check, its login and its /ports, as ServerManager mounts them.
    const node = express();
    node.use((_req, _res, next) => {
      context.setContext(nodeArgs, nodePort, 'node-1', '');
      next();
    });
    node.use(express.json());
    const nodeApi = express.Router();
    nodeApi.use(csrfMiddleware);
    nodeApi.use(authMiddleware);
    nodeApi.get('/whoami', (req: any, res) => res.json(req.auth));
    PortsRouter(nodeApi);
    node.use('/xenon/api', nodeApi);
    nodePort = ((await loopback.serve(node)).address() as any).port;
    nodeOrigin = `http://127.0.0.1:${nodePort}`;
    nodeArgs = { ...DefaultPluginArgs, hub: hubUrl, bindHostOrIp: '127.0.0.1' } as any;
    await scratch.db.portLease.deleteMany({});
  });

  afterEach(async () => {
    Object.assign(context, saved.context);
    config.authDisabled = saved.authDisabled;
    config.hubAccessKey = saved.key;
    config.hubToken = saved.token;
    sinon.restore();
    restore();
    await loopback.closeAll();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** The hub's ports token for a phone, signed as the hub signs it. */
  const portsToken = (udid = 'phone-1', host = nodeOrigin) =>
    Container.get(HubSessionTokenIssuer).portsTokenFor({ udid, host }) as Promise<string>;

  const allocate = (token: string | undefined, udid = 'phone-1') => {
    const req = request(nodeOrigin).post('/xenon/api/ports/allocate');
    if (token) req.set(HUB_TOKEN_HEADER, token);
    return req.send({ udid, host: nodeOrigin, purposes: ['systemPort'], durationMs: 60_000 });
  };

  describe('on the node', () => {
    it("reserves the phone's ports for the hub's token, with sign-in on", async () => {
      const res = await allocate(await portsToken());

      expect(res.status, JSON.stringify(res.body)).to.equal(200);
      expect(res.body.ports.systemPort).to.be.a('number');
      const rows = await scratch.db.portLease.findMany({ where: { leasedToUdid: 'phone-1' } });
      expect(rows).to.have.length(1);
    });

    it('extends and releases them with it too', async () => {
      const port = (await allocate(await portsToken())).body.ports.systemPort;
      const extend = await request(nodeOrigin)
        .post('/xenon/api/ports/extend')
        .set(HUB_TOKEN_HEADER, await portsToken())
        .send({ udid: 'phone-1', ports: [port], expiresAt: Date.now() + 3_600_000 });
      expect(extend.status, JSON.stringify(extend.body)).to.equal(200);
      const release = await request(nodeOrigin)
        .post('/xenon/api/ports/release')
        .set(HUB_TOKEN_HEADER, await portsToken())
        .send({ udid: 'phone-1', ports: [port] });
      expect(release.status, JSON.stringify(release.body)).to.equal(200);
      expect(await scratch.db.portLease.count({ where: { leasedToUdid: 'phone-1' } })).to.equal(0);
    });

    it("refuses the node-pair credentials it can't check, as before", async () => {
      const res = await request(nodeOrigin)
        .post('/xenon/api/ports/allocate')
        .set('x-xenon-access-key', 'hub-key')
        .set('x-xenon-token', 'hub-token')
        .send({ udid: 'phone-1', host: nodeOrigin, purposes: ['systemPort'], durationMs: 60_000 });
      expect(res.status).to.equal(401);
    });

    it('refuses a call about another phone than the token names', async () => {
      const res = await allocate(await portsToken('phone-1'), 'phone-2');
      expect(res.status).to.equal(403);
      expect(res.body.error).to.equal('hub_token_phone_mismatch');
      expect(await scratch.db.portLease.count()).to.equal(0);
    });

    it("refuses a token for another node's phone, or another kind of hub token", async () => {
      expect((await allocate(await portsToken('phone-1', 'http://10.9.9.9:4723'))).status).to.equal(
        401,
      );
      const control = await Container.get(HubSessionTokenIssuer).controlTokenFor({
        userId: 'alice',
        isAdmin: true,
        udid: 'phone-1',
        host: nodeOrigin,
      });
      expect((await allocate(control as string)).status).to.equal(401);
    });

    it('is no credential anywhere but the port routes', async () => {
      const res = await request(nodeOrigin)
        .get('/xenon/api/whoami')
        .set(HUB_TOKEN_HEADER, await portsToken());
      expect(res.status).to.equal(401);
    });

    it("can't be checked while the hub's keys can't be fetched: 503", async () => {
      const token = await portsToken();
      nodeArgs = { ...nodeArgs, hub: 'http://127.0.0.1:1' };
      expect((await allocate(token)).status).to.equal(503);
    });

    it('a server that is not a node ignores it', async () => {
      const token = await portsToken();
      nodeArgs = { ...nodeArgs, hub: undefined };
      expect((await allocate(token)).status).to.equal(401);
    });
  });

  describe('on the hub', () => {
    beforeEach(() => {
      context.setContext(HUB_ARGS, 1, 'hub-1', '');
    });

    it('signs each call for the phone and its node, with no node credentials set', async () => {
      const credentials = await defaultNodePairAuthProvider().nodePairAuth(nodeOrigin, 'phone-1');

      expect(credentials).to.include({ accessKey: '', token: '' });
      const grant = await new HubSessionTokenVerifier(hubUrl).verifyPorts(
        credentials.hubToken as string,
      );
      expect(grant).to.deep.equal({ udid: 'phone-1', host: nodeOrigin });
    });

    it('sends the pair as well when it is set, for a node older than this release', async () => {
      config.hubAccessKey = 'hub-key';
      config.hubToken = 'hub-token';
      const credentials = await defaultNodePairAuthProvider().nodePairAuth(nodeOrigin, 'phone-1');
      expect(credentials).to.include({ accessKey: 'hub-key', token: 'hub-token' });
      expect(credentials.hubToken).to.be.a('string');
    });

    it("reserves the node's phone's ports through the port client", async () => {
      const credentials = await defaultNodePairAuthProvider().nodePairAuth(nodeOrigin, 'phone-1');
      const client = new PortAllocatorClient();
      client.ownPorts = { isOwnHost: () => false, allocator: () => ({}) as any };

      const ports = await client.allocate({
        nodeHost: nodeOrigin,
        udid: 'phone-1',
        purposes: ['systemPort', 'mjpegServerPort'],
        durationMs: 60_000,
        nodePairAuth: credentials,
        once: true,
      });

      expect(Object.keys(ports).sort()).to.deep.equal(['mjpegServerPort', 'systemPort']);
      expect(await scratch.db.portLease.count({ where: { leasedToUdid: 'phone-1' } })).to.equal(2);
    });

    it("can lease a node's phone, and says so in /capabilities", async () => {
      context.setContext(HUB_ARGS, 1, 'hub-1', '');
      expect(await defaultNodePairAuthProvider().reaches?.(nodeOrigin)).to.equal(true);
      expect(buildCapabilities().features.leasing).to.deep.equal({ nodePhones: true });
    });

    it("can't when it can't sign and has no node credentials", async () => {
      const issuer = new HubSessionTokenIssuer();
      issuer.useSigner({
        ready: false,
        sign: async () => {
          throw new Error('JWT key service not initialized');
        },
      });
      Container.set(HubSessionTokenIssuer, issuer);

      expect(await defaultNodePairAuthProvider().reaches?.(nodeOrigin)).to.equal(false);
      expect(buildCapabilities().features.leasing.nodePhones).to.equal(false);
      let thrown: Error | undefined;
      try {
        await defaultNodePairAuthProvider().nodePairAuth(nodeOrigin, 'phone-1');
      } catch (err) {
        thrown = err as Error;
      }
      expect(thrown?.message).to.match(/XENON_HUB_ACCESS_KEY/);
    });
  });
});
