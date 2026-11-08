import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import sinon from 'sinon';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import { makeRouter } from '../../src/app/routers/sdk-leases';
import { LeaseService, NODE_CREDENTIALS_MISSING } from '../../src/services/lease/LeaseService';
import { LeaseQueue } from '../../src/services/lease/LeaseQueue';
import { PortAllocatorClient } from '../../src/services/ports/PortAllocatorClient';
import { InternalHttpClient } from '../../src/InternalHttpClient';
import { PluginContext } from '../../src/PluginContext';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { config } from '../../src/config';
import { buildCapabilities } from '../../src/app/routers/capabilities';
import { prisma } from '../../src/prisma';
import { useScratchDatabase } from '../helpers/scratch-database';
import { drainLeaseQueues } from '../helpers/lease-queue';
import { usePrismaStores } from '../helpers/loki-stores';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';
import { HubSessionTokenIssuer } from '../../src/gateway/hubSessionToken';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * A lease's driver ports are reserved on the phone's server. Through 2.20
 * this server's own phone was reserved over HTTP too, at its own
 * `/ports/allocate`, with the node credentials (XENON_HUB_ACCESS_KEY /
 * XENON_HUB_TOKEN): with sign-in on and none set, every lease on a single
 * server answered `503 device_unhealthy`, which clients retry.
 *
 * Here the real port client and credential provider run against a scratch
 * database with sign-in on and no node credentials, and every HTTP call
 * fails: an own phone is reserved, extended and freed in process, and a
 * lease only a node's phone could fill is `500 lab_misconfigured`.
 */
const HOST = 'http://127.0.0.1:4723';
/** Another server: a node with phones of its own. */
const NODE = 'http://10.9.9.9:4723';

describe("A lease of this server's own phone", () => {
  const scratch = useScratchDatabase({ wholeSuite: true });
  usePrismaStores();
  useOwnNodeId();

  let http: sinon.SinonStub;
  let restoreIssuer: () => void;
  let app: express.Express;
  let saved: { args: any; port: number; authDisabled: boolean; key?: string; token?: string };

  const phone = (udid: string, host = HOST, nodeId: string | null = OWN_NODE_ID) =>
    scratch.db.device.create({
      data: {
        udid,
        host,
        nodeId,
        name: `Phone ${udid}`,
        platform: 'android',
        sdk: '13',
        busy: false,
        offline: false,
        userBlocked: false,
        deviceType: 'real',
        realDevice: true,
      } as any,
    });

  const post = (filters: Record<string, unknown>) =>
    request(app)
      .post('/sdk/leases')
      .send({ filters: { platform: 'android', ...filters }, durationMs: 600_000 });
  const portRows = (udid: string) =>
    scratch.db.portLease.findMany({ where: { leasedToUdid: udid } });

  beforeEach(async () => {
    sinon.stub(process, 'kill');
    const context = Container.get(PluginContext);
    saved = {
      args: context.pluginArgs,
      port: context.port,
      authDisabled: config.authDisabled,
      key: config.hubAccessKey,
      token: config.hubToken,
    };
    context.pluginArgs = { ...context.pluginArgs, bindHostOrIp: '127.0.0.1' } as any;
    context.port = 4723;
    // Sign-in on, and no node credentials: the configuration that failed.
    config.authDisabled = false;
    config.hubAccessKey = undefined;
    config.hubToken = undefined;
    http = sinon.stub(InternalHttpClient, 'post').rejects(new Error('no HTTP in this spec'));
    // A hub that can't sign tokens for its nodes (its JWT key didn't load):
    // without the node credentials, nothing reaches a node's phone. A hub
    // that can sign sends its ports token instead (hub-node-lease-ports.spec.ts).
    restoreIssuer = saveRegistrations(HubSessionTokenIssuer);
    const issuer = new HubSessionTokenIssuer();
    issuer.useSigner({
      ready: false,
      sign: async () => {
        throw new Error('JWT key service not initialized');
      },
    });
    Container.set(HubSessionTokenIssuer, issuer);

    await scratch.db.portLease.deleteMany({});
    await scratch.db.lease.deleteMany({});
    await scratch.db.device.deleteMany({});
    await scratch.db.deviceSetting.deleteMany({});

    const portClient = new PortAllocatorClient();
    const store = DeviceStoreFactory.getStore();
    // The default credential provider, which is what's being checked.
    const queue = new LeaseQueue(prisma, store, portClient);
    const svc = new LeaseService(prisma, store, portClient, undefined, queue);
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.apiKey = { id: 'key_owner', teamId: null };
      req.auth = { kind: 'apiKey', userId: 'usr_owner', role: 'ADMIN' };
      next();
    });
    app.use('/sdk/leases', makeRouter({ leaseService: svc }));
  });

  afterEach(async () => {
    await drainLeaseQueues();
    const context = Container.get(PluginContext);
    context.pluginArgs = saved.args;
    context.port = saved.port;
    config.authDisabled = saved.authDisabled;
    config.hubAccessKey = saved.key;
    config.hubToken = saved.token;
    sinon.restore();
    restoreIssuer();
  });

  it('is granted with no node credentials, its ports reserved here', async () => {
    await phone('A');

    const res = await post({ udid: 'A' });

    expect(res.status, JSON.stringify(res.body)).to.equal(201);
    const rows = await portRows('A');
    expect(rows.map((row: any) => row.port).sort()).to.deep.equal(
      Object.values(res.body.allocatedPorts).sort(),
    );
    expect(rows.every((row: any) => row.leasedToHost === HOST)).to.equal(true);
    expect(http.called, 'an own phone is reserved without HTTP').to.equal(false);
  });

  it('holds its ports until the new end on extend, and frees them on release', async () => {
    await phone('A');
    const lease = (await post({ udid: 'A' })).body;
    const before = Math.max(...(await portRows('A')).map((row: any) => Number(row.expiresAt)));

    const extended = await request(app)
      .post(`/sdk/leases/${lease.leaseId}/extend`)
      .set('x-xenon-lease-token', lease.leaseToken)
      .send({ durationMs: 3_600_000 });
    expect(extended.status, JSON.stringify(extended.body)).to.equal(200);
    const until = async (what: () => Promise<boolean>) => {
      const end = Date.now() + 2_000;
      while (!(await what())) {
        if (Date.now() > end) throw new Error('not within 2 s');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    await until(async () =>
      (await portRows('A')).every((row: any) => Number(row.expiresAt) > before),
    );

    const released = await request(app)
      .delete(`/sdk/leases/${lease.leaseId}`)
      .set('x-xenon-lease-token', lease.leaseToken);
    expect(released.status).to.equal(204);
    await until(async () => (await portRows('A')).length === 0);
    expect(http.called).to.equal(false);
  });

  it("is lab_misconfigured, not retried, when only a node's phone matches", async () => {
    await phone('N', NODE, 'node-1');

    const res = await post({ udid: 'N' });

    expect(res.status).to.equal(500);
    expect(res.body).to.deep.equal({
      error: 'lab_misconfigured',
      message: NODE_CREDENTIALS_MISSING,
    });
    expect(res.body).not.to.have.property('retryAfterMs');
    const row = await scratch.db.device.findUnique({
      where: { udid_host: { udid: 'N', host: NODE } },
    });
    expect(row?.busy, 'nothing was locked').to.equal(false);
  });

  it("takes an own phone when a node's phone matches too", async () => {
    await phone('N', NODE, 'node-1');
    await phone('A');

    const res = await post({});

    expect(res.status, JSON.stringify(res.body)).to.equal(201);
    expect(res.body.device?.udid ?? res.body.members?.[0]?.device?.udid).to.equal('A');
  });

  it('asks a node over HTTP, with the credentials, once they are set', async () => {
    config.hubAccessKey = 'ak_hub';
    config.hubToken = 'tok_hub';
    http.resolves({
      ports: { systemPort: 13100, chromedriverPort: 13101, mjpegServerPort: 13102 },
    });
    await phone('N', NODE, 'node-1');

    const res = await post({ udid: 'N' });

    expect(res.status, JSON.stringify(res.body)).to.equal(201);
    expect(http.firstCall.args[0]).to.equal(`${NODE}/xenon/api/ports/allocate`);
    expect(http.firstCall.args[2].headers).to.include({
      'x-xenon-access-key': 'ak_hub',
      'x-xenon-token': 'tok_hub',
    });
  });

  it('says in /capabilities whether a node phone can be leased', () => {
    expect(buildCapabilities().features.leasing).to.deep.equal({
      nodePhones: false,
      reason: NODE_CREDENTIALS_MISSING,
    });
    config.hubAccessKey = 'ak_hub';
    config.hubToken = 'tok_hub';
    expect(buildCapabilities().features.leasing).to.deep.equal({ nodePhones: true });
    config.authDisabled = true;
    config.hubAccessKey = undefined;
    expect(buildCapabilities().features.leasing).to.deep.equal({ nodePhones: true });
  });

  it('reports the WebDriver base path in /capabilities', () => {
    const context = Container.get(PluginContext);
    const before = context.nodeBasePath;
    try {
      context.nodeBasePath = '/wd/hub/';
      expect(buildCapabilities().webDriverBasePath).to.equal('/wd/hub');
      context.nodeBasePath = '';
      expect(buildCapabilities().webDriverBasePath).to.equal('');
    } finally {
      context.nodeBasePath = before;
    }
  });
});
