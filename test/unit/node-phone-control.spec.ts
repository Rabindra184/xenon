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

  it('refuses a host it must never call', async () => {
    findDevice = async () => ({ udid: 'p', host: 'http://169.254.169.254', nodeId: 'node-1' });
    const res = await request(app()).get('/xenon/api/control/p/screenshot');
    expect(res.status).to.equal(400);
    expect(res.body).to.deep.equal({ error: 'Unsafe device host' });
  });
});
