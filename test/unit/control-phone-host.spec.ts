import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import sinon from 'sinon';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import { loopbackServers } from '../helpers/loopbackServer';
import { saveRegistrations } from '../helpers/container-registration';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';
import ControlRouter from '../../src/app/routers/control';
import { ambiguousPhoneBody, HIDDEN_DEVICE_UDID } from '../../src/middleware/controlDevice';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { XenonManager } from '../../src/device-managers';
import { DisplayStateService } from '../../src/services/DisplayStateService';
import { HubSessionTokenIssuer } from '../../src/gateway/hubSessionToken';
import * as forwardToNode from '../../src/gateway/forwardToNode';

/**
 * /control names a phone by udid and, when two servers have one by that
 * udid, by host (the spec's "Device control"): a hub and its node can both
 * report emulator-5554. The team guard resolves the phone once per request
 * through findPhone, and the ownership guard, the hub's gate and the handlers
 * all use that one row.
 */

const UDID = 'emulator-5554';
// The same length as UDID, so an answer that echoes the path is the same
// length for both.
const UNKNOWN = 'emulator-9999';
const HUB = 'http://hub:4723';
const NODE = 'http://node:4723';
const TEAM_HUB = 'team-hub';
const TEAM_NODE = 'team-node';

// This server's own emulator-5554, and its node's. Different platforms, so a
// handler's answer says which row it read.
const HUB_ROW = {
  udid: UDID,
  host: HUB,
  nodeId: OWN_NODE_ID,
  platform: 'android',
  teamId: TEAM_HUB,
  busy: false,
  session_id: null,
};
const NODE_ROW = {
  udid: UDID,
  host: NODE,
  nodeId: 'node-1',
  platform: 'ios',
  teamId: TEAM_NODE,
  busy: false,
  session_id: null,
};

type Who = 'both' | 'node-only' | 'hub-only' | 'admin';
// undefined: an admin, who sees every row.
const TEAMS: Record<Who, string[] | undefined> = {
  both: [TEAM_HUB, TEAM_NODE],
  'node-only': [TEAM_NODE],
  'hub-only': [TEAM_HUB],
  admin: undefined,
};

// Named like the real manager: /control picks one by constructor.name.
class AndroidDeviceManager {
  calls: string[] = [];
  getDisplayState = async (udid: string) => {
    this.calls.push(`getDisplayState:${udid}`);
    return 'on';
  };
}

describe('/control names a phone by udid and host', () => {
  useOwnNodeId();
  const loopback = loopbackServers();
  let restore: () => void;
  let manager: AndroidDeviceManager;
  let forwarded: string[];
  let nodeSaw: string[];

  beforeEach(async () => {
    restore = saveRegistrations(XenonManager, DisplayStateService, HubSessionTokenIssuer);
    manager = new AndroidDeviceManager();
    Container.set(XenonManager, { deviceInstances: async () => [manager] } as any);
    Container.set(DisplayStateService, new DisplayStateService());
    Container.set(HubSessionTokenIssuer, { controlTokenFor: async () => null } as any);

    const rows = [HUB_ROW, NODE_ROW];
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevices: async (filter: any) =>
        rows.filter((r) => Object.entries(filter).every(([k, v]) => (r as any)[k] === v)),
      // The first row of the udid is the node's: a handler that still looked
      // the phone up by udid alone would read it.
      findDevice: async (filter: any) =>
        [NODE_ROW, HUB_ROW].find((r) =>
          Object.entries(filter).every(([k, v]) => (r as any)[k] === v),
        ) ?? null,
    } as any);

    // The node, on a loopback port: what it was asked, and a recognisable answer.
    nodeSaw = [];
    const node = express();
    node.use((req, res) => {
      nodeSaw.push(req.originalUrl);
      res.json({ state: 'from-node' });
    });
    const server = await loopback.serve(node);
    const nodeOrigin = `http://127.0.0.1:${(server.address() as any).port}`;
    forwarded = [];
    const send = forwardToNode.sendToNode;
    sinon.stub(forwardToNode, 'sendToNode').callsFake((call) => {
      forwarded.push(call.url);
      return send({ ...call, url: call.url.replace(NODE, nodeOrigin) });
    });
  });

  afterEach(async () => {
    sinon.restore();
    restore();
    await loopback.closeAll();
  });

  /** The /xenon/api stack as far as /control goes, with the API's JSON 404 after it. */
  function app(who: Who) {
    const app = express();
    app.use(express.json());
    const api = express.Router();
    api.use((req, _res, next) => {
      (req as any).auth = {
        kind: 'user-session',
        userId: `usr_${who}`,
        role: who === 'admin' ? 'ADMIN' : 'MEMBER',
        scopes: who === 'admin' ? 'admin,devices,sessions,read' : 'devices,sessions,read',
        rateLimit: 100,
        teamIds: TEAMS[who],
      };
      next();
    });
    ControlRouter.register(api);
    api.use('*', (req, res) => {
      res.status(404).json({
        error: true,
        message: `API endpoint ${req.method} ${req.originalUrl} not found`,
      });
    });
    app.use('/xenon/api', api);
    return app;
  }

  const get = (who: Who, path: string) => request(app(who)).get(`/xenon/api/control/${path}`);

  /** What a caller can observe of an answer, with the requested udid masked out. */
  function observed(res: request.Response, udid: string) {
    return {
      status: res.status,
      body: (res.text ?? '').split(udid).join('<udid>'),
      contentType: res.headers['content-type'],
      contentLength: res.headers['content-length'],
    };
  }

  it('answers 409 ambiguous_phone, naming both hosts, when no host is given and both are visible', async () => {
    const res = await get('both', `${UDID}/display`);
    expect(res.status, res.text).to.equal(409);
    expect(res.body).to.deep.equal(ambiguousPhoneBody(UDID, [HUB, NODE]));
    expect(manager.calls, 'no handler ran').to.deep.equal([]);
    expect(forwarded, 'nothing went to the node').to.deep.equal([]);
  });

  it('answers a mutation the same 409 before the ownership guard', async () => {
    const res = await request(app('both'))
      .post(`/xenon/api/control/${UDID}/tap`)
      .send({ x: 1, y: 2 });
    expect(res.status, res.text).to.equal(409);
    expect(res.body.error).to.equal('ambiguous_phone');
    expect(forwarded).to.deep.equal([]);
  });

  it('tells an admin, who sees both, the same', async () => {
    const res = await get('admin', `${UDID}/display`);
    expect(res.status, res.text).to.equal(409);
    expect(res.body).to.deep.equal(ambiguousPhoneBody(UDID, [HUB, NODE]));
    expect(forwarded).to.deep.equal([]);
  });

  describe('with no host, the one phone the caller can see', () => {
    it("sends a member who sees only the node's on to the node", async () => {
      const res = await get('node-only', `${UDID}/display`);
      expect(res.status, res.text).to.equal(200);
      expect(res.body).to.deep.equal({ state: 'from-node' });
      expect(forwarded).to.deep.equal([`${NODE}/xenon/api/control/${UDID}/display`]);
      expect(manager.calls).to.deep.equal([]);
    });

    // The udid's first row is the node's: by udid alone this went to the node.
    it("handles a member who sees only this server's here", async () => {
      const res = await get('hub-only', `${UDID}/display`);
      expect(res.status, res.text).to.equal(200);
      expect(res.body).to.deep.equal({ state: 'on' });
      expect(manager.calls).to.deep.equal([`getDisplayState:${UDID}`]);
      expect(forwarded).to.deep.equal([]);
    });
  });

  it('forwards ?host=<node> to the node, without the host parameter', async () => {
    const res = await get('both', `${UDID}/display?host=${encodeURIComponent(NODE)}&x=1`);
    expect(res.status, res.text).to.equal(200);
    expect(res.body).to.deep.equal({ state: 'from-node' });
    expect(forwarded).to.deep.equal([`${NODE}/xenon/api/control/${UDID}/display?x=1`]);
    expect(nodeSaw).to.deep.equal([`/xenon/api/control/${UDID}/display?x=1`]);
  });

  it("handles ?host=<this server> here, on this server's row", async () => {
    const res = await get('both', `${UDID}/display?host=${encodeURIComponent(HUB)}`);
    expect(res.status, res.text).to.equal(200);
    // The Android manager answered: the handler read the hub's row, not the
    // node's (an iPhone, whose display state no manager here reads).
    expect(res.body).to.deep.equal({ state: 'on' });
    expect(manager.calls).to.deep.equal([`getDisplayState:${UDID}`]);
    expect(forwarded).to.deep.equal([]);
  });

  describe('a host naming a phone the caller may not see', () => {
    for (const action of ['display', 'screenshot', 'bogus']) {
      it(`answers ${action} exactly like an unknown udid`, async () => {
        const host = `?host=${encodeURIComponent(HUB)}`;
        const hidden = await get('node-only', `${UDID}/${action}${host}`);
        const unknown = await get('node-only', `${UNKNOWN}/${action}${host}`);
        expect(hidden.status).to.equal(404);
        expect(observed(hidden, UDID)).to.deep.equal(observed(unknown, UNKNOWN));
        expect(hidden.text).to.not.include(HIDDEN_DEVICE_UDID);
        expect(manager.calls).to.deep.equal([]);
        expect(forwarded).to.deep.equal([]);
      });
    }

    it('answers a host no row has like an unknown udid', async () => {
      const host = `?host=${encodeURIComponent('http://elsewhere:4723')}`;
      const res = await get('both', `${UDID}/display${host}`);
      const unknown = await get('both', `${UNKNOWN}/display${host}`);
      expect(observed(res, UDID)).to.deep.equal(observed(unknown, UNKNOWN));
      expect(res.status).to.equal(404);
    });
  });

  for (const [label, query] of [
    ['empty', '?host='],
    ['repeated', `?host=${encodeURIComponent(HUB)}&host=${encodeURIComponent(NODE)}`],
    ['an object', '?host[a]=b'],
  ]) {
    it(`refuses a host that is ${label} with 400 invalid_host`, async () => {
      const res = await get('both', `${UDID}/display${query}`);
      expect(res.status, res.text).to.equal(400);
      expect(res.body.error).to.equal('invalid_host');
      expect(manager.calls).to.deep.equal([]);
      expect(forwarded).to.deep.equal([]);
    });
  }
});
