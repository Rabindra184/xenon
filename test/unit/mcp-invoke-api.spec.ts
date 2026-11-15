import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { useScratchDatabase } from '../helpers/scratch-database';
import { seedUser, SeededUser } from '../helpers/seedUser';
import { createRouter } from '../../src/app/index';
import { Container } from 'typedi';
import {
  API_CALL_TIMEOUT_MS,
  invokeApi,
  PRESET_CALLER,
  serveToolsFrom,
} from '../../src/mcp/invokeApi';
import { invokeWebDriver, WEBDRIVER_CALL_TIMEOUT_MS } from '../../src/mcp/invokeWebDriver';
import { runTool, ToolRefusal } from '../../src/mcp/toolCall';
import { PluginContext } from '../../src/PluginContext';
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

  describe('a route or command that never answers', () => {
    /** An app whose one route never answers, noting when its request is ended. */
    function hangingRoute(path: string) {
      const ended = { closed: false, lateWriteThrew: false };
      const router = express.Router();
      router.all(path, (_req, res) => {
        res.on('close', () => {
          ended.closed = true;
          // What the route writes once it was given up on goes nowhere.
          try {
            res.status(200).json({ late: true });
          } catch {
            ended.lateWriteThrew = true;
          }
        });
      });
      return { router, ended };
    }

    it('invokeApi gives up after 30 s by default, with a tool error `timeout`, and ends the request', async () => {
      expect(API_CALL_TIMEOUT_MS).to.equal(30_000);
      const { router, ended } = hangingRoute('/hang');
      const restore = serveToolsFrom(router);
      try {
        let thrown: unknown;
        await invokeApi(caller, { method: 'GET', path: '/hang' }, { timeoutMs: 100 }).catch(
          (e) => (thrown = e),
        );
        expect(thrown).to.be.instanceOf(ToolRefusal);
        expect((thrown as ToolRefusal).error).to.equal('timeout');
        expect(ended.closed).to.equal(true);
        expect(ended.lateWriteThrew).to.equal(false);

        const result: any = await runTool('xenon_test_hang', caller, () =>
          invokeApi(caller, { method: 'GET', path: '/hang' }, { timeoutMs: 100 }),
        );
        expect(result.isError).to.equal(true);
        const answer = JSON.parse(result.content[0].text);
        expect(answer.error).to.equal('timeout');
        expect(answer.message).to.be.a('string').and.not.equal('');
      } finally {
        restore();
      }
    });

    it('invokeWebDriver gives up after 5 minutes by default, with a tool error `timeout`, and ends the request', async () => {
      expect(WEBDRIVER_CALL_TIMEOUT_MS).to.equal(5 * 60_000);
      const { router, ended } = hangingRoute('/wd/hub/session/:sessionId/execute/sync');
      const appium = express();
      appium.use(router);
      const context = Container.get(PluginContext);
      const saved = { app: context.expressApp, basePath: context.nodeBasePath };
      context.expressApp = appium;
      context.nodeBasePath = '/wd/hub';
      try {
        let thrown: unknown;
        await invokeWebDriver(
          caller,
          's-1',
          { method: 'POST', path: 'execute/sync', body: { script: 'xe:debug', args: [] } },
          { timeoutMs: 100 },
        ).catch((e) => (thrown = e));
        expect(thrown).to.be.instanceOf(ToolRefusal);
        expect((thrown as ToolRefusal).error).to.equal('timeout');
        expect(ended.closed).to.equal(true);
      } finally {
        context.expressApp = saved.app;
        context.nodeBasePath = saved.basePath;
      }
    });
  });
});
