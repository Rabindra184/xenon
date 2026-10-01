import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import type { Request } from 'express';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import { loopbackServers } from '../helpers/loopbackServer';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { nodePhoneControl } from '../../src/app/routers/nodePhoneControl';
import type { ControlDevice } from '../../src/middleware/controlDevice';

/**
 * The gate in front of /control's handlers, on its own: what it does when the
 * phone's node is slow or its row can't be read. The actions themselves are
 * in hub-node-control-forward.spec.ts.
 */
describe('nodePhoneControl', () => {
  const loopback = loopbackServers();
  let context: PluginContext;
  let saved: Partial<PluginContext>;
  let findDevice: (udid: string) => Promise<ControlDevice | null>;
  let held: Request[];

  beforeEach(() => {
    context = Container.get(PluginContext);
    saved = { ...context };
    context.setContext({ ...DefaultPluginArgs, bindHostOrIp: '127.0.0.1' } as any, 1, 'hub-1', '');
    held = [];
  });

  afterEach(async () => {
    Object.assign(context, saved);
    await loopback.closeAll();
  });

  const app = (timeoutMs = 60_000) => {
    const a = express();
    a.use(express.json());
    a.use(
      '/xenon/api/control',
      nodePhoneControl({ findDevice: (udid) => findDevice(udid), timeoutMs }),
      (_req, res) => res.status(299).json({ handledHere: true }),
    );
    return a;
  };

  it('a node that doesn’t answer in time: 504, naming it', async () => {
    const node = express();
    node.use((req) => held.push(req)); // never answers
    const origin = `http://127.0.0.1:${((await loopback.serve(node)).address() as any).port}`;
    findDevice = async () => ({ udid: 'p', host: origin, nodeId: 'node-1' });

    const res = await request(app(150)).get('/xenon/api/control/p/screenshot');

    expect(res.status).to.equal(504);
    expect(res.body.error).to.equal('node_timeout');
    expect(res.body.message).to.include(origin);
    expect(held).to.have.length(1);
  });

  it('a device row that can’t be read: 503, and no handler runs it here', async () => {
    findDevice = async () => {
      throw new Error('database is locked');
    };
    const res = await request(app()).post('/xenon/api/control/p/tap').send({ x: 1, y: 2 });
    expect(res.status).to.equal(503);
    expect(res.body.error).to.equal('device_ownership_unavailable');
  });

  it('this server’s own phone, and an unknown one, go to the handlers', async () => {
    findDevice = async () => ({ udid: 'p', host: 'http://10.0.0.9:4725', nodeId: 'hub-1' });
    await request(app()).post('/xenon/api/control/p/tap').send({}).expect(299);
    findDevice = async () => null;
    await request(app()).post('/xenon/api/control/p/tap').send({}).expect(299);
  });

  it('a stream outlives the timeout once the node has answered', async () => {
    const node = express();
    node.get('/xenon/api/control/p/stream', (_req, res) => {
      // Text, so the test's client doesn't try to parse it; an MJPEG
      // answer is relayed the same way.
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('frame one;');
      setTimeout(() => res.end('frame two;'), 400);
    });
    const origin = `http://127.0.0.1:${((await loopback.serve(node)).address() as any).port}`;
    findDevice = async () => ({ udid: 'p', host: origin, nodeId: 'node-1' });

    const res = await request(app(150)).get('/xenon/api/control/p/stream');

    expect(res.status).to.equal(200);
    expect(res.text).to.equal('frame one;frame two;');
  });

  it('sends the node none of the caller’s ticket, and the rest of the query', async () => {
    const node = express();
    const seen: string[] = [];
    node.use((req, res) => {
      seen.push(req.originalUrl);
      res.json({ status: 'stopped' });
    });
    const origin = `http://127.0.0.1:${((await loopback.serve(node)).address() as any).port}`;
    findDevice = async () => ({ udid: 'p', host: origin, nodeId: 'node-1' });

    await request(app()).get('/xenon/api/control/p/stream/status?ticket=spent&t=1&r=2').expect(200);

    expect(seen).to.deep.equal(['/xenon/api/control/p/stream/status?t=1&r=2']);
  });

  it('marks the phone busy for its node, held by the caller, once the node has started a preview', async () => {
    let answer = 200;
    const node = express();
    node.use((_req, res) => res.status(answer).json({}));
    const origin = `http://127.0.0.1:${((await loopback.serve(node)).address() as any).port}`;
    findDevice = async () => ({ udid: 'p', host: origin, nodeId: 'node-1' });
    const marked: string[] = [];
    const a = express();
    a.use(express.json());
    a.use((req: any, _res, next) => {
      req.auth = { kind: 'user-session', userId: 'alice', role: 'MEMBER', scopes: 'devices' };
      next();
    });
    a.use(
      '/xenon/api/control',
      nodePhoneControl({
        findDevice: (udid) => findDevice(udid),
        controlToken: async () => null,
        markNodeBusy: async (udid, host, hold) => {
          marked.push(`${udid}@${host} ${hold}`);
        },
      }),
    );

    await request(a).post('/xenon/api/control/p/stream/start').send({}).expect(200);
    answer = 409;
    await request(a).post('/xenon/api/control/p/stream/start').send({}).expect(409);
    answer = 200;
    await request(a).get('/xenon/api/control/p/stream/status').expect(200);

    // The hold the node writes for the same user (formatManualLock).
    expect(marked).to.deep.equal([`p@${origin} manual_alice_p`]);
  });

  describe('a node’s refusal because someone holds the phone', () => {
    // The node knows the holder's id but not their name: its database has
    // no rows for the hub's users. The hub has, and fills it in.
    const refusal = (holder: Record<string, unknown>) => ({
      success: false,
      error: 'device_held_by_another_user',
      message:
        'Device is being controlled by another user. Ask them to release it, or use an admin key to force-release.',
      holder,
    });
    const through = async (body: unknown, names: Record<string, string>) => {
      const node = express();
      node.use((_req, res) => res.status(409).json(body));
      const origin = `http://127.0.0.1:${((await loopback.serve(node)).address() as any).port}`;
      findDevice = async () => ({ udid: 'p', host: origin, nodeId: 'node-1' });
      const a = express();
      a.use(express.json());
      a.use(
        '/xenon/api/control',
        nodePhoneControl({
          findDevice: (udid) => findDevice(udid),
          describeHolder: async (id) => names[id] ?? null,
        }),
      );
      return request(a).post('/xenon/api/control/p/tap').send({ x: 1, y: 2 });
    };

    it('names the holder the node could not', async () => {
      const res = await through(refusal({ userId: 'bob' }), { bob: 'bob@example.com' });
      expect(res.status).to.equal(409);
      expect(res.body.error).to.equal('device_held_by_another_user');
      expect(res.body.message).to.include('bob@example.com');
      expect(res.body.holder).to.deep.equal({ userId: 'bob', name: 'bob@example.com' });
    });

    it('passes it on unchanged when this server doesn’t know the holder either', async () => {
      const body = refusal({ userId: 'someone-of-the-node' });
      const res = await through(body, {});
      expect(res.status).to.equal(409);
      expect(res.body).to.deep.equal(body);
    });

    it('passes on any other 409 unchanged', async () => {
      const body = {
        success: false,
        error: 'device_recording',
        message: 'Stop the recording first.',
      };
      const res = await through(body, { bob: 'bob@example.com' });
      expect(res.body).to.deep.equal(body);
    });
  });

  it('streams an upload to the node as it came, and waits as long as an install takes', async () => {
    const node = express();
    let got: { type?: string; body: string } | undefined;
    node.post('/xenon/api/control/p/upload-install', (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        got = { type: req.headers['content-type'], body: Buffer.concat(chunks).toString() };
        // Past the ordinary limit: an install answers when it is done.
        setTimeout(() => res.json({ success: true }), 400);
      });
    });
    const origin = `http://127.0.0.1:${((await loopback.serve(node)).address() as any).port}`;
    findDevice = async () => ({ udid: 'p', host: origin, nodeId: 'node-1' });
    const a = express();
    a.use(express.json());
    a.use(
      '/xenon/api/control',
      nodePhoneControl({
        findDevice: (udid) => findDevice(udid),
        timeoutMs: 150,
        installTimeoutMs: 5_000,
      }),
    );

    const res = await request(a)
      .post('/xenon/api/control/p/upload-install')
      .attach('app', Buffer.from('apk-bytes'), 'build-42.apk');

    expect(res.status, res.text).to.equal(200);
    expect(got?.type).to.match(/^multipart\/form-data; boundary=/);
    expect(got?.body).to.include('filename="build-42.apk"');
    expect(got?.body).to.include('apk-bytes');
  });

  it('leaves the library install and Omni to this server for a node’s phone, not a cloud one', async () => {
    for (const [method, action] of [
      ['post', 'install-repository-app'],
      ['get', 'omni-scan'],
      ['post', 'test-locator'],
    ] as const) {
      findDevice = async () => ({ udid: 'p', host: 'http://10.0.0.9:4725', nodeId: 'node-1' });
      await request(app())[method](`/xenon/api/control/p/${action}`).expect(299);
      findDevice = async () => ({ udid: 'p', host: 'http://10.0.0.9:4725', cloud: '{"x":1}' });
      const cloud = await request(app())[method](`/xenon/api/control/p/${action}`);
      expect(cloud.status, action).to.equal(501);
      expect(cloud.body.error, action).to.equal('not_available_for_cloud_phone');
    }
  });

  // The node doesn't know this server is recording its phone, so it would stop
  // the stream the recording reads; /control refuses a local phone's the same way.
  it('refuses to stop a node phone’s preview while this server records it', async () => {
    const node = express();
    const hits: string[] = [];
    node.use((req, res) => {
      hits.push(req.path);
      res.json({ success: true });
    });
    const origin = `http://127.0.0.1:${((await loopback.serve(node)).address() as any).port}`;
    findDevice = async () => ({ udid: 'p', host: origin, nodeId: 'node-1' });
    let recording: { groupId: string } | null = { groupId: 'g-1' };
    const a = express();
    a.use(express.json());
    a.use(
      '/xenon/api/control',
      nodePhoneControl({
        findDevice: (udid) => findDevice(udid),
        activeRecordingFor: async () => recording,
      }),
    );

    const refused = await request(a).post('/xenon/api/control/p/stream/stop').send({});
    expect(refused.status).to.equal(409);
    expect(refused.body).to.include({ error: 'device_recording', groupId: 'g-1' });
    expect(hits).to.deep.equal([]);

    recording = null;
    await request(a).post('/xenon/api/control/p/stream/stop').send({}).expect(200);
    expect(hits).to.deep.equal(['/xenon/api/control/p/stream/stop']);
  });

  it('refuses a host it must never call', async () => {
    findDevice = async () => ({ udid: 'p', host: 'http://169.254.169.254', nodeId: 'node-1' });
    const res = await request(app()).get('/xenon/api/control/p/screenshot');
    expect(res.status).to.equal(400);
    expect(res.body).to.deep.equal({ error: 'Unsafe device host' });
  });
});
