import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import SessionType from '../../src/enums/SessionType';
import { SessionLocator, sessionRowsFrom } from '../../src/gateway/sessionLocator';
import {
  BASE_PATH_TTL_MS,
  FALLBACK_TTL_MS,
  NodeBasePathResolver,
  WEBDRIVER_INFO_PATH,
  nodeWebDriverUrl,
  webdriverInfoHandler,
} from '../../src/gateway/nodeWebDriverUrl';
import { saveRegistrations } from '../helpers/container-registration';
import { loopbackServers } from '../helpers/loopbackServer';

/**
 * Where a session runs, as the hub's gateway asks it: SESSION_MANAGER for a
 * live session, the database after a restart, and never a routing table of
 * its own. And where a node's WebDriver API lives, which a node says itself.
 */

const NODE = 'http://10.0.0.7:4725';

function fakeSession(type: SessionType, url: string, host = NODE) {
  return {
    getType: () => type,
    getWebDriverUrl: () => url,
    getDevice: () => ({ udid: 'u1', host }),
  } as any;
}

describe('SessionLocator', () => {
  let live: Record<string, any>;
  let rows: Record<string, { device_udid: string; node_id: string | null }>;
  let devices: Record<string, any>;
  let findOpenSession: sinon.SinonSpy;
  let findDevice: sinon.SinonSpy;
  let webDriverUrlOf: sinon.SinonSpy;

  function locator(maxRemembered?: number) {
    return new SessionLocator({
      getSession: (id) => live[id],
      findOpenSession,
      findDevice,
      isLocalDevice: (device) => device.host === 'http://10.0.0.1:4724',
      webDriverUrlOf,
      maxRemembered,
    });
  }

  beforeEach(() => {
    live = {};
    rows = {};
    devices = {};
    findOpenSession = sinon.spy(async (id: string) => rows[id] ?? null);
    findDevice = sinon.spy(async (udid: string) => devices[udid] ?? null);
    webDriverUrlOf = sinon.spy(async (device: any) => `${device.host}/node-base`);
  });

  it('answers a live local session from SESSION_MANAGER, with no lookup', async () => {
    live.s = fakeSession(SessionType.LOCAL, 'http://10.0.0.1:4724/wd/hub/wd-internal');
    expect(await locator().locate('s')).to.deep.equal({ kind: 'local' });
    expect(findOpenSession.called).to.equal(false);
  });

  it('answers a live remote session with its node URL and the session', async () => {
    live.s = fakeSession(SessionType.REMOTE, `${NODE}/wd/hub`);
    const location = await locator().locate('s');
    expect(location).to.include({ kind: 'remote', url: `${NODE}/wd/hub`, cloud: false });
    expect((location as any).session).to.equal(live.s);
    expect(findOpenSession.called).to.equal(false);
  });

  it('marks a cloud session, which gets no hub token', async () => {
    live.s = fakeSession(
      SessionType.CLOUD,
      'https://cloud.example/wd/hub',
      'https://cloud.example',
    );
    expect(await locator().locate('s')).to.include({ kind: 'remote', cloud: true });
  });

  it('never routes a session back to this server’s own phone', async () => {
    live.s = fakeSession(SessionType.REMOTE, 'http://10.0.0.1:4724/wd/hub', 'http://10.0.0.1:4724');
    expect(await locator().locate('s')).to.deep.equal({ kind: 'local' });
  });

  it('after a restart, routes an open session from its row and its phone’s row', async () => {
    rows.s = { device_udid: 'u1', node_id: 'node-1' };
    devices.u1 = { udid: 'u1', host: NODE, nodeId: 'node-1' };
    expect(await locator().locate('s')).to.deep.equal({
      kind: 'remote',
      url: `${NODE}/node-base`,
      cloud: false,
    });
    expect(findDevice.firstCall.args).to.deep.equal(['u1', 'node-1']);
  });

  it('remembers the database’s answer, which cannot change, until forgotten', async () => {
    rows.s = { device_udid: 'u1', node_id: null };
    devices.u1 = { udid: 'u1', host: NODE };
    const l = locator();
    await l.locate('s');
    await l.locate('s');
    expect(findOpenSession.callCount).to.equal(1);
    l.forget('s');
    await l.locate('s');
    expect(findOpenSession.callCount).to.equal(2);
  });

  it('answers local for a session nobody here knows, so Appium gives its own answer', async () => {
    const l = locator();
    expect(await l.locate('nobody')).to.deep.equal({ kind: 'local' });
    await l.locate('nobody');
    expect(findOpenSession.callCount).to.equal(1);
  });

  it('answers local for an open session on this server’s own phone', async () => {
    rows.s = { device_udid: 'u1', node_id: null };
    devices.u1 = { udid: 'u1', host: 'http://10.0.0.1:4724' };
    expect(await locator().locate('s')).to.deep.equal({ kind: 'local' });
    expect(webDriverUrlOf.called).to.equal(false);
  });

  it('bounds what it remembers', async () => {
    const l = locator(2);
    await l.locate('a');
    await l.locate('b');
    await l.locate('c');
    await l.locate('a');
    expect(findOpenSession.callCount).to.equal(4);
  });

  it('lets a database error through for the gateway to answer', async () => {
    const l = new SessionLocator({
      getSession: () => undefined,
      findOpenSession: async () => {
        throw new Error('database is locked');
      },
      findDevice,
      isLocalDevice: () => false,
      webDriverUrlOf,
    });
    let thrown: unknown;
    try {
      await l.locate('s');
    } catch (err) {
      thrown = err;
    }
    expect((thrown as Error).message).to.equal('database is locked');
  });

  describe('sessionRowsFrom (Prisma)', () => {
    it('reads only an open session, and prefers the phone on the session’s node', async () => {
      const db = {
        session: { findFirst: sinon.stub().resolves({ device_udid: 'u1', node_id: 'n1' }) },
        device: {
          findFirst: sinon
            .stub()
            .callsFake(async ({ where }: any) =>
              where.nodeId ? { udid: 'u1', host: NODE, nodeId: 'n1' } : { udid: 'u1', host: 'x' },
            ),
        },
      };
      const rowsFrom = sessionRowsFrom(db);
      expect(await rowsFrom.findOpenSession('s')).to.deep.equal({
        device_udid: 'u1',
        node_id: 'n1',
      });
      expect(db.session.findFirst.firstCall.args[0].where).to.deep.equal({
        id: 's',
        endTime: null,
      });
      expect(await rowsFrom.findDevice('u1', 'n1')).to.include({ host: NODE });
      expect(await rowsFrom.findDevice('u1', null)).to.include({ host: 'x' });
    });
  });
});

describe('NodeBasePathResolver', () => {
  const loopback = loopbackServers();
  let restore: () => void;
  let hits: number;

  beforeEach(() => {
    restore = saveRegistrations(NodeBasePathResolver);
    Container.set(NodeBasePathResolver, new NodeBasePathResolver());
    hits = 0;
  });

  afterEach(async () => {
    restore();
    await loopback.closeAll();
  });

  async function node(basePath: unknown | undefined): Promise<string> {
    const app = express();
    if (basePath !== undefined) {
      app.get(WEBDRIVER_INFO_PATH, (req, res, next) => {
        hits++;
        webdriverInfoHandler(() => basePath)(req, res, next);
      });
    }
    const server = await loopback.serve(app);
    return `http://127.0.0.1:${(server.address() as any).port}`;
  }

  it('the node says its base path, normalised as Appium does', async () => {
    const origin = await node('node/base/');
    const res = await request(origin).get(WEBDRIVER_INFO_PATH).expect(200);
    expect(res.body).to.deep.equal({ basePath: '/node/base' });
  });

  it('uses the base path the node says, however the hub’s differs', async () => {
    const origin = await node('');
    expect(await Container.get(NodeBasePathResolver).resolve(origin, '/wd/hub')).to.equal('');
  });

  it('falls back to the hub’s own for a node that does not say (an older Xenon)', async () => {
    const origin = await node(undefined);
    expect(await Container.get(NodeBasePathResolver).resolve(origin, 'wd/hub')).to.equal('/wd/hub');
  });

  it('falls back to the hub’s own for a node that cannot be reached', async () => {
    const origin = await node('/x');
    await loopback.closeAll();
    expect(await Container.get(NodeBasePathResolver).resolve(origin, '/wd/hub')).to.equal(
      '/wd/hub',
    );
  });

  it('asks once for concurrent callers, and again only after the answer expires', async () => {
    const origin = await node('/node');
    const resolver = Container.get(NodeBasePathResolver);
    let now = 1_000;
    resolver.now = () => now;
    const answers = await Promise.all([
      resolver.resolve(origin, '/wd/hub'),
      resolver.resolve(origin, '/wd/hub'),
    ]);
    expect(answers).to.deep.equal(['/node', '/node']);
    expect(hits).to.equal(1);
    now += BASE_PATH_TTL_MS - 1;
    await resolver.resolve(origin, '/wd/hub');
    expect(hits).to.equal(1);
    now += 2;
    await resolver.resolve(origin, '/wd/hub');
    expect(hits).to.equal(2);
  });

  it('asks again soon after a fallback', async () => {
    const origin = await node(undefined);
    const resolver = Container.get(NodeBasePathResolver);
    let now = 1_000;
    resolver.now = () => now;
    await resolver.resolve(origin, '/wd/hub');
    now += FALLBACK_TTL_MS + 1;
    const lookUp = sinon.spy(resolver as any, 'lookUp');
    await resolver.resolve(origin, '/wd/hub');
    expect(lookUp.callCount).to.equal(1);
  });

  it('nodeWebDriverUrl: a node’s origin plus its own base path', async () => {
    const origin = await node('/node');
    expect(await nodeWebDriverUrl({ udid: 'u', host: `${origin}/` } as any, '/wd/hub')).to.equal(
      `${origin}/node`,
    );
  });

  it('nodeWebDriverUrl: a cloud provider’s own URL, with no lookup', async () => {
    const url = await nodeWebDriverUrl(
      { udid: 'u', host: 'https://cloud.example', cloud: 'pCloudy' } as any,
      '/wd/hub',
    );
    expect(url).to.equal('https://cloud.example/wd/hub');
    expect(hits).to.equal(0);
  });
});
