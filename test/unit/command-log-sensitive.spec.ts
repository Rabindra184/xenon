import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import DashboardRouter from '../../src/app/routers/dashboard';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { MASKED } from '../../src/dashboard/commandPrivacy';
import { createSessionGatewayLayer } from '../../src/gateway/sessionGateway';
import { isInsideSensitiveCommand, runMarkingSensitive } from '../../src/gateway/sensitiveCommand';
import { spanArgs } from '../../src/interceptors/CommandInterceptor';
import { XENON_CAPABILITIES } from '../../src/XenonCapabilityManager';
import { PluginContext } from '../../src/PluginContext';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SelectorStateService } from '../../src/services/SelectorStateService';
import { SocketServer } from '../../src/services/SocketServer';
import { useScratchDatabase } from '../helpers/scratch-database';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * A test's typed text, a password included, was kept whole in Xenon's
 * command log (the session page, bug reports) and in the command's span,
 * also when the client marked the request sensitive for Appium's log
 * (Xenon Test's ENH-11, on 2.19.0, Android and iOS).
 */
describe('The command log and sensitive input', () => {
  const PASSWORD = 'hunter2-Secret!';

  describe('the session gateway', () => {
    const app = express();
    app.use(express.json());
    let seen: boolean[] = [];
    let remote = false;
    app.use(
      '/wd/hub/session/:sessionId',
      createSessionGatewayLayer({
        auth: {
          enabled: () => false,
          authDisabled: () => true,
          verifier: { verify: async () => ({ ok: false }) as any },
          ownerOf: async () => null,
          ownersOf: async () => new Map(),
          logger: { warn: () => undefined, error: () => undefined, info: () => undefined } as any,
        },
        routing: {
          locate: async () =>
            (remote
              ? { kind: 'remote', url: 'http://node.test:4723/wd/hub', session: true }
              : { kind: 'local' }) as any,
          forward: async (_req, res) => {
            seen.push(isInsideSensitiveCommand());
            res.json({ value: null });
          },
        },
      }),
    );
    app.post('/wd/hub/session/:sessionId/element/:id/value', (_req, res) => {
      // Appium's route, where the plugin's handle runs.
      setImmediate(() => {
        seen.push(isInsideSensitiveCommand());
        res.json({ value: null });
      });
    });

    beforeEach(() => {
      seen = [];
    });

    for (const where of ['here', 'on a node'] as const) {
      it(`runs a marked command ${where} inside the sensitive context, and no other`, async () => {
        remote = where === 'on a node';
        const send = (marked: boolean) => {
          const r = request(app).post('/wd/hub/session/s-1/element/el-1/value');
          return (marked ? r.set('X-Appium-Is-Sensitive', 'true') : r).send({ text: PASSWORD });
        };
        expect((await send(true)).status).to.equal(200);
        expect((await send(false)).status).to.equal(200);
        expect(seen).to.deep.equal([true, false]);
      });
    }
  });

  describe("the command's record", () => {
    const scratch = useScratchDatabase();
    const SESSION = 'cs-session-1';
    let options: Record<string, unknown>;
    let screenshot: sinon.SinonStub;
    let restore: () => void;
    let savedArgs: any;

    beforeEach(async () => {
      restore = saveRegistrations(SocketServer);
      Container.set(SocketServer, {
        emitToDashboardForDevices: async () => undefined,
        hasScopedDashboard: () => false,
      } as any);
      const context = Container.get(PluginContext);
      savedArgs = context.pluginArgs;
      context.pluginArgs = { ...context.pluginArgs, maskInput: false };
      await scratch.db.sessionLog.deleteMany({});
      await scratch.db.session.deleteMany({});
      await scratch.db.session.create({
        data: {
          id: SESSION,
          desired_capabilities: '{}',
          session_capabilities: '{}',
          node_id: 'node-1',
          has_live_video: false,
          device_udid: 'cs-phone',
          device_platform: 'android',
          device_version: '14',
        },
      });
      options = { [XENON_CAPABILITIES.SCREENSHOT_ON_EVERY_COMMAND]: 'true' };
      screenshot = sinon.stub().resolves('');
      sinon.stub(SESSION_MANAGER, 'getSession').returns({
        getId: () => SESSION,
        getDevice: () => ({ udid: 'cs-phone', name: 'P', platform: 'android' }),
        getXenonOption: (name: string, fallback: unknown) =>
          options[name] ? options[name] : fallback,
        getScreenShot: screenshot,
      } as any);
      sinon.stub(SelectorStateService.prototype, 'onHealRecorded').resolves(null);
    });

    afterEach(() => {
      Container.get(PluginContext).pluginArgs = savedArgs;
      sinon.restore();
      restore();
    });

    /** A command as the hub's gateway records it: the client's W3C body and the node's answer. */
    const record = (command: string, body: unknown, answer: unknown, headers = {}) =>
      DASHBORD_EVENT_MANAGER.afterSessionCommand(
        SESSION,
        command,
        null,
        { body, headers, method: 'POST', originalUrl: `/wd/hub/session/${SESSION}/x` } as any,
        {} as any,
        JSON.stringify(answer),
      );

    async function rows() {
      const app = express();
      app.use((req, _res, next) => {
        (req as any).auth = { kind: 'user-session', userId: 'u', role: 'ADMIN', scopes: 'admin' };
        next();
      });
      DashboardRouter.register(app as never);
      const res = await request(app).get(`/session/${SESSION}/session_log`);
      expect(res.status).to.equal(200);
      return res.body as Array<{
        command_name: string;
        body: string;
        response: string;
        screenshot: string | null;
        original_selector: string | null;
        is_success: boolean;
      }>;
    }

    it('keeps nothing of a command marked sensitive, wherever it ran', async () => {
      // Recorded inside the gateway's context (a local session's command)…
      await new Promise<void>((resolve, reject) =>
        runMarkingSensitive({ 'x-appium-is-sensitive': 'true' }, () =>
          record('setValue', { text: PASSWORD, value: [...PASSWORD] }, { value: null }).then(
            resolve,
            reject,
          ),
        ),
      );
      // …or with the header on the forwarded request (a hub's).
      await record('getText', {}, { value: PASSWORD }, { 'x-appium-is-sensitive': '1' });
      await record(
        'findElement',
        { using: 'xpath', value: `//*[@text="${PASSWORD}"]` },
        { value: { error: 'no such element', message: `nothing matches ${PASSWORD}` } },
        { 'x-appium-is-sensitive': 'yes' },
      );

      const all = await rows();
      expect(all).to.have.length(3);
      for (const row of all) {
        expect(JSON.stringify(row), row.command_name).not.to.include(PASSWORD);
        expect(JSON.parse(row.body)).to.equal(MASKED);
        expect(row.screenshot, 'no screenshot of a sensitive command').to.equal(null);
      }
      const find = all.find((r) => r.command_name === 'findElement') as (typeof all)[number];
      expect(JSON.parse(find.response)).to.deep.equal({
        value: { error: 'no such element', message: MASKED },
      });
      expect(find.original_selector).to.equal(null);
      expect(screenshot.called).to.equal(false);
    });

    it('masks typed text for a session with xe:options.maskInput', async () => {
      options[XENON_CAPABILITIES.MASK_INPUT] = true;
      await record('setValue', { text: PASSWORD, value: [...PASSWORD] }, { value: null });
      await record(
        'execute',
        { script: 'mobile: type', args: [{ text: PASSWORD }] },
        { value: null },
      );

      const all = await rows();
      expect(JSON.stringify(all)).not.to.include(PASSWORD);
      const setValue = all.find((r) => r.command_name === 'setValue') as (typeof all)[number];
      expect(JSON.parse(setValue.body)).to.deep.equal({
        text: MASKED,
        value: MASKED,
      });
    });

    it("masks it for every session with the server's maskInput option", async () => {
      Container.get(PluginContext).pluginArgs.maskInput = true;
      await record('setValue', { text: PASSWORD, value: [...PASSWORD] }, { value: null });

      expect(JSON.stringify(await rows())).not.to.include(PASSWORD);
    });

    it('keeps the text of a session that masks nothing, as before', async () => {
      await record('setValue', { text: PASSWORD, value: [...PASSWORD] }, { value: null });

      expect(JSON.parse((await rows())[0].body).text).to.equal(PASSWORD);
    });
  });

  describe("the command's span", () => {
    it('keeps no arguments of a sensitive command, and masked text where input is masked', async () => {
      const masked = await new Promise((resolve) =>
        runMarkingSensitive({ 'x-appium-is-sensitive': 'true' }, () =>
          resolve(spanArgs('getText', ['el-1'], { caps: {} }, {})),
        ),
      );
      expect(masked).to.equal(MASKED);
      expect(
        spanArgs(
          'setValue',
          [PASSWORD, 'el-1'],
          { caps: { 'xe:options': { maskInput: true } } },
          {},
        ),
      ).to.deep.equal([MASKED, 'el-1']);
      expect(
        spanArgs('setValue', [PASSWORD, 'el-1'], { caps: {} }, { maskInput: true }),
      ).to.deep.equal([MASKED, 'el-1']);
      expect(spanArgs('setValue', [PASSWORD, 'el-1'], { caps: {} }, {})).to.deep.equal([
        PASSWORD,
        'el-1',
      ]);
    });
  });
});
