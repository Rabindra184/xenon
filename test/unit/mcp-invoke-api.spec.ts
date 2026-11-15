import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { useScratchDatabase } from '../helpers/scratch-database';
import { seedUser, SeededUser } from '../helpers/seedUser';
import { createRouter } from '../../src/app/index';
import { invokeApi, PRESET_CALLER } from '../../src/mcp/invokeApi';
import type { McpCaller } from '../../src/mcp/mcpCredential';
import { config } from '../../src/config';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';

/**
 * A tool runs its REST route in process: `invokeApi` dispatches through the
 * `/xenon/api` router with the tool's caller already known, and nothing a
 * network request carries can stand in for that caller.
 */
describe('invokeApi: a REST route run in process', () => {
  useScratchDatabase({ wholeSuite: true });

  let app: express.Express;
  let member: SeededUser;
  let caller: McpCaller;
  let savedAuthDisabled: boolean;

  before(async () => {
    app = express();
    app.use('/xenon', createRouter({ ...DefaultPluginArgs }));
    member = await seedUser('MEMBER', { name: 'Invoke Member' });
    caller = {
      auth: {
        kind: 'bearer',
        userId: member.user.id,
        role: 'MEMBER',
        scopes: 'read,devices',
        rateLimit: 300,
        teamIds: [],
      },
    };
  });

  beforeEach(() => {
    savedAuthDisabled = config.authDisabled;
    config.authDisabled = false;
  });

  afterEach(() => {
    config.authDisabled = savedAuthDisabled;
  });

  it('runs a route with the preset caller', async () => {
    const res = await invokeApi(caller, { method: 'GET', path: '/auth/me' });
    expect(res.status).to.equal(200);
    expect(res.body.userId).to.equal(caller.auth.userId);
  });

  it('ignores a header that tries to preset a caller', async () => {
    const forged = JSON.stringify(caller);
    const res = await request(app)
      .get('/xenon/api/auth/me')
      .set(String(PRESET_CALLER.description), forged)
      .set('x-xenon-mcp-preset-caller', forged)
      .set('x-preset-caller', forged);
    expect(res.status).to.equal(401);
  });

  it('passes route errors through', async () => {
    const res = await invokeApi(caller, { method: 'GET', path: '/devices/nope' });
    const overHttp = await request(app).get('/xenon/api/devices/nope').set('cookie', member.cookie);
    expect(overHttp.status).to.equal(404);
    expect(res.status).to.equal(404);
    expect(res.body).to.deep.equal(overHttp.body);
  });

  it("isn't refused by the CSRF check a cookie's POST gets", async () => {
    const overHttp = await request(app).post('/xenon/api/nope').set('cookie', member.cookie);
    expect(overHttp.status).to.equal(403);
    const res = await invokeApi(caller, { method: 'POST', path: '/nope', body: { a: 1 } });
    expect(res.status).to.equal(404);
  });

  it('sends the query as REST reads it', async () => {
    const res = await invokeApi(caller, {
      method: 'GET',
      path: '/healing/events',
      query: { sessionId: 'no-such-session', limit: '5' },
    });
    expect(res.status).to.equal(200);
    expect(res.body.events).to.deep.equal([]);
  });
});
