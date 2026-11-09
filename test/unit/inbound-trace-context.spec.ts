import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import sinon from 'sinon';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import { loopbackServers } from '../helpers/loopbackServer';
import { TracingService } from '../../src/services/TracingService';
import { CommandInterceptor } from '../../src/interceptors/CommandInterceptor';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import * as DeviceService from '../../src/data-service/device-service';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SocketServer } from '../../src/services/SocketServer';
import { SelectorStateService } from '../../src/services/SelectorStateService';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { XenonLogger } from '../../src/logger';
import { createSessionGatewayLayer } from '../../src/gateway/sessionGateway';
import { createSessionCreateLayer } from '../../src/gateway/sessionCreate';
import {
  currentInboundTrace,
  readTraceContext,
  runWithInboundTrace,
} from '../../src/services/tracing/inboundTrace';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';
import { OtlpProbe, OtlpSpan, resetOtelGlobals, startOtlpProbe } from '../helpers/otlp-probe';

const TEST_TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const TEST_SPAN = '00f067aa0ba902b7';
const STEP_TRACE = '0af7651916cd43dd8448eb211c80319c';
const STEP_SPAN = 'b7ad6b7169203331';
const sampled = (traceId: string, spanId: string) => `00-${traceId}-${spanId}-01`;
const unsampled = (traceId: string, spanId: string) => `00-${traceId}-${spanId}-00`;
const contextOf = (traceparent: string) => readTraceContext(traceparent).context!;

const ENV_KEYS = [
  'OTEL_SDK_DISABLED',
  'OTEL_LOGS_ENABLED',
  'OTEL_TRACES_ENABLED',
  'OTEL_METRICS_ENABLED',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
  'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
  'XENON_OTEL_DEBUG',
];

/**
 * ENH-03: a test sends its W3C trace context with the session create and
 * with each command, and Xenon's session span, command spans and command log
 * join that trace. Xenon Test reads the trace id from the command log, so it
 * is kept there even on a server that exports no spans.
 */
describe('Inbound W3C trace context (ENH-03)', function () {
  this.timeout(30_000);

  describe('the session gateway', () => {
    const loopback = loopbackServers();
    afterEach(async () => {
      sinon.restore();
      await loopback.closeAll();
    });

    it("runs each command, here or on a node, inside that command's trace context, and no other", async () => {
      const seen: Array<string | undefined> = [];
      let remote = false;
      const app = express();
      app.use(express.json());
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
            forward: async (req, res) => {
              seen.push(`${currentInboundTrace()?.traceId}|${req.headers.traceparent}`);
              res.json({ value: null });
            },
          },
        }),
      );
      app.get('/wd/hub/session/:sessionId/source', (_req, res) => {
        // Appium's route, where the plugin's handle runs.
        setImmediate(() => {
          seen.push(currentInboundTrace()?.traceId);
          res.json({ value: '<xml/>' });
        });
      });
      const server = await loopback.serve(app);
      const base = `http://127.0.0.1:${(server.address() as any).port}`;

      await request(base)
        .get('/wd/hub/session/s-1/source')
        .set('traceparent', sampled(STEP_TRACE, STEP_SPAN))
        .expect(200);
      await request(base).get('/wd/hub/session/s-1/source').expect(200);
      await request(base)
        .get('/wd/hub/session/s-1/source')
        .set('traceparent', 'garbage')
        .expect(200);
      remote = true;
      await request(base)
        .get('/wd/hub/session/s-1/source')
        .set('traceparent', sampled(STEP_TRACE, STEP_SPAN))
        .expect(200);

      expect(seen).to.deep.equal([
        STEP_TRACE,
        undefined,
        undefined,
        // The node is sent the header as it came.
        `${STEP_TRACE}|${sampled(STEP_TRACE, STEP_SPAN)}`,
      ]);
    });

    it("runs a create, to this server's phone or a node's, inside the create's trace context", async () => {
      const seen: Array<string | undefined> = [];
      let remote = false;
      const lifecycle = {
        prepareSession: sinon.stub().callsFake(async () => ({ remote })),
        completeRemoteSession: sinon.stub().callsFake(async () => {
          seen.push(currentInboundTrace()?.traceId);
          return { protocol: 'W3C', value: ['node-s1', {}, 'W3C'] };
        }),
        releaseAllocation: sinon.stub().resolves(),
      };
      const app = express();
      app.use(express.json());
      app.use(
        '/wd/hub/session',
        createSessionCreateLayer({
          lifecycle: () => lifecycle as any,
          authDisabled: () => true,
          logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
        }),
      );
      app.post('/wd/hub/session', async (_req, res) => {
        // Appium's route, where XenonPlugin.createSession finalizes the session.
        await new Promise((resolve) => setTimeout(resolve, 1));
        seen.push(currentInboundTrace()?.traceId);
        res.json({ value: { sessionId: 'local-s1', capabilities: {} } });
      });
      const server = await loopback.serve(app);
      const base = `http://127.0.0.1:${(server.address() as any).port}`;
      const caps = { capabilities: { alwaysMatch: { platformName: 'Android' }, firstMatch: [{}] } };

      await request(base)
        .post('/wd/hub/session')
        .set('traceparent', sampled(TEST_TRACE, TEST_SPAN))
        .send(caps)
        .expect(200);
      remote = true;
      await request(base)
        .post('/wd/hub/session')
        .set('traceparent', sampled(TEST_TRACE, TEST_SPAN))
        .send(caps)
        .expect(200);
      await request(base).post('/wd/hub/session').send(caps).expect(200);

      expect(seen).to.deep.equal([TEST_TRACE, TEST_TRACE, undefined]);
    });
  });

  describe('which trace a session joins', () => {
    let started: Array<{ sessionId: string; parent?: { traceId: string; spanId: string } }>;
    let restoreRegs: () => void;
    let savedContext: any;
    let warn: sinon.SinonSpy;

    beforeEach(() => {
      started = [];
      restoreRegs = saveRegistrations(TracingService);
      Container.set(TracingService, {
        startSessionSpan: (sessionId: string, _name: string, _attrs: unknown, parent?: any) => {
          started.push({
            sessionId,
            parent: parent && { traceId: parent.traceId, spanId: parent.spanId },
          });
        },
        endSessionSpan: () => undefined,
      } as any);
      const context = Container.get(PluginContext);
      savedContext = { ...context };
      context.setContext({ ...DefaultPluginArgs } as any, 4723, 'hub-1', '');
      // Stops the create right after its span started, as a failed claim does.
      sinon.stub(DeviceService, 'claimDeviceForSession').rejects(new Error('stop here'));
      warn = sinon.spy((Container.get(SessionLifecycleService) as any).logger, 'warn');
    });

    afterEach(() => {
      Object.assign(Container.get(PluginContext), savedContext);
      sinon.restore();
      restoreRegs();
    });

    async function finalize(
      options: Record<string, unknown>,
      headers: Record<string, string> = {},
    ) {
      await runWithInboundTrace(headers, () =>
        (Container.get(SessionLifecycleService) as any)
          .finalizeSession(
            { value: ['s-join', {}] },
            { udid: 'R5CT', platform: 'android', host: 'http://127.0.0.1:4723', nodeId: 'hub-1' },
            { alwaysMatch: { 'xe:options': options }, firstMatch: [{}] },
            {},
            false,
          )
          .catch(() => undefined),
      );
      return started.pop()?.parent;
    }

    it("the create header's", async () => {
      expect(await finalize({}, { traceparent: sampled(TEST_TRACE, TEST_SPAN) })).to.deep.equal({
        traceId: TEST_TRACE,
        spanId: TEST_SPAN,
      });
    });

    it("xe:options.traceparent's, over the header's", async () => {
      const parent = await finalize(
        { traceparent: sampled(STEP_TRACE, STEP_SPAN) },
        { traceparent: sampled(TEST_TRACE, TEST_SPAN) },
      );
      expect(parent).to.deep.equal({ traceId: STEP_TRACE, spanId: STEP_SPAN });
      expect(warn.called).to.equal(false);
    });

    it("the header's when the capability can't be read, saying so", async () => {
      const parent = await finalize(
        { traceparent: 'not-one' },
        { traceparent: sampled(TEST_TRACE, TEST_SPAN) },
      );
      expect(parent?.traceId).to.equal(TEST_TRACE);
      expect(warn.calledOnce).to.equal(true);
      expect(String(warn.firstCall.args[0])).to.include('xe:options.traceparent');
    });

    it('a trace of its own when neither is sent, or neither can be read', async () => {
      expect(await finalize({})).to.equal(undefined);
      expect(await finalize({ traceparent: 7 }, { traceparent: 'x' })).to.equal(undefined);
      expect(String(warn.lastCall.args[0])).to.include('the traceparent header');
    });
  });

  describe('the spans', () => {
    let probe: OtlpProbe;
    let tracing: TracingService;
    let restoreRegs: () => void;
    let saved: Record<string, string | undefined>;

    beforeEach(async () => {
      saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
      for (const k of ENV_KEYS) delete process.env[k];
      resetOtelGlobals();
      XenonLogger.setOtlpReady(false);
      probe = await startOtlpProbe();
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = probe.url('/v1/traces');
      restoreRegs = saveRegistrations(TracingService);
      tracing = new TracingService();
      tracing.initialize({ isHub: true });
      Container.set(TracingService, tracing);
      sinon.stub(DeviceService, 'updateCmdExecutedTime').resolves();
      sinon.stub(DASHBORD_EVENT_MANAGER, 'beforeSessionCommand').resolves(true as any);
    });

    afterEach(async () => {
      await tracing.shutdown();
      sinon.restore();
      restoreRegs();
      resetOtelGlobals();
      await probe.close();
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    async function exported(): Promise<OtlpSpan[]> {
      await tracing.shutdown();
      return probe.spans();
    }

    /** A command as Appium hands it to the plugin, sent with `traceparent` if given. */
    function run(traceparent?: string, next: () => Promise<unknown> = async () => '<xml/>') {
      return runWithInboundTrace(traceparent ? { traceparent } : {}, () =>
        Container.get(CommandInterceptor).handle(
          next,
          { sessionId: 's-t', caps: {} },
          'getPageSource',
          [],
          {} as any,
          true,
        ),
      );
    }

    it('a session joins the test’s trace, and so do the commands sent without their own', async () => {
      tracing.startSessionSpan('s-t', 's-t', {}, contextOf(sampled(TEST_TRACE, TEST_SPAN)));
      await run();
      tracing.endSessionSpan('s-t');

      const spans = await exported();
      const session = spans.find((s) => s.name === 'Session: s-t');
      const command = spans.find((s) => s.name === 'getPageSource');
      expect(session?.traceId).to.equal(TEST_TRACE);
      expect(session?.parentSpanId).to.equal(TEST_SPAN);
      expect(command?.traceId).to.equal(TEST_TRACE);
      expect(command?.parentSpanId).to.equal(session?.spanId);
      expect(command?.links ?? []).to.have.length(0);
    });

    it("a command sent with its own context is that context's child, linked to its session", async () => {
      tracing.startSessionSpan('s-t', 's-t');
      await run(sampled(STEP_TRACE, STEP_SPAN));
      tracing.endSessionSpan('s-t');

      const spans = await exported();
      const session = spans.find((s) => s.name === 'Session: s-t');
      const command = spans.find((s) => s.name === 'getPageSource');
      expect(command?.traceId).to.equal(STEP_TRACE);
      expect(command?.parentSpanId).to.equal(STEP_SPAN);
      expect(command?.links?.map((l) => ({ traceId: l.traceId, spanId: l.spanId }))).to.deep.equal([
        { traceId: session?.traceId, spanId: session?.spanId },
      ]);
    });

    it('a session the test did not sample exports nothing, and still carries its trace id', async () => {
      tracing.startSessionSpan('s-t', 's-t', {}, contextOf(unsampled(TEST_TRACE, TEST_SPAN)));
      let ids: { traceId?: string; spanId?: string } = {};
      await run(undefined, async () => {
        ids = tracing.commandTraceIds('s-t');
        return '<xml/>';
      });
      expect(tracing.getTraceId('s-t')).to.equal(TEST_TRACE);
      tracing.endSessionSpan('s-t');

      // No span id: the command's span is never sent anywhere.
      expect(ids).to.deep.equal({ traceId: TEST_TRACE, spanId: undefined });
      expect(await exported()).to.deep.equal([]);
    });

    it("a command's record carries its own span's ids, not another same-named command's", async () => {
      tracing.startSessionSpan('s-t', 's-t');
      const ids: Array<{ traceId?: string; spanId?: string }> = [];
      let finishFirst!: () => void;
      const first = run(sampled(STEP_TRACE, STEP_SPAN), async () => {
        await new Promise<void>((resolve) => (finishFirst = resolve));
        ids.push(tracing.commandTraceIds('s-t'));
      });
      await run(undefined, async () => {
        ids.push(tracing.commandTraceIds('s-t'));
      });
      finishFirst();
      await first;
      tracing.endSessionSpan('s-t');

      const commands = (await exported()).filter((s) => s.name === 'getPageSource');
      const [second, firstIds] = ids;
      expect(firstIds.traceId).to.equal(STEP_TRACE);
      expect(second.traceId).to.not.equal(STEP_TRACE);
      expect(commands.map((c) => c.spanId).sort()).to.deep.equal(
        [firstIds.spanId, second.spanId].sort(),
      );
    });
  });

  describe('with no spans exported', () => {
    let tracing: TracingService;

    beforeEach(() => {
      tracing = new TracingService(); // never initialized: tracing is off
    });

    it("keeps the session's joined trace id until the session ends", () => {
      tracing.startSessionSpan('s-off', 's-off', {}, contextOf(sampled(TEST_TRACE, TEST_SPAN)));
      expect(tracing.getTraceId('s-off')).to.equal(TEST_TRACE);
      expect(tracing.commandTraceIds('s-off')).to.deep.equal({ traceId: TEST_TRACE });
      tracing.endSessionSpan('s-off');
      expect(tracing.getTraceId('s-off')).to.equal(undefined);
    });

    it("gives a command sent with a context that context's trace id, and no span id", () => {
      tracing.startSessionSpan('s-off', 's-off', {}, contextOf(sampled(TEST_TRACE, TEST_SPAN)));
      runWithInboundTrace({ traceparent: sampled(STEP_TRACE, STEP_SPAN) }, () => {
        expect(tracing.commandTraceIds('s-off')).to.deep.equal({ traceId: STEP_TRACE });
      });
      tracing.endSessionSpan('s-off');
    });

    it('has nothing for a session that sent none', () => {
      tracing.startSessionSpan('s-none', 's-none');
      expect(tracing.commandTraceIds('s-none')).to.deep.equal({ traceId: undefined });
    });
  });

  describe("the command log's rows", () => {
    const scratch = useScratchDatabase();
    const SESSION = 'trace-row-session';
    let restore: () => void;

    beforeEach(async () => {
      restore = saveRegistrations(SocketServer, TracingService);
      Container.set(SocketServer, {
        emitToDashboardForDevices: async () => undefined,
        hasScopedDashboard: () => false,
      } as any);
      Container.set(TracingService, new TracingService()); // export off
      await scratch.db.sessionLog.deleteMany({});
      await scratch.db.session.deleteMany({});
      await scratch.db.session.create({
        data: {
          id: SESSION,
          desired_capabilities: '{}',
          session_capabilities: '{}',
          node_id: 'node-1',
          has_live_video: false,
          device_udid: 'tr-phone',
          device_platform: 'android',
          device_version: '14',
        },
      });
      sinon.stub(SESSION_MANAGER, 'getSession').returns({
        getId: () => SESSION,
        getDevice: () => ({ udid: 'tr-phone', name: 'P', platform: 'android' }),
        getXenonOption: (_name: string, fallback: unknown) => fallback,
        getScreenShot: async () => '',
      } as any);
      sinon.stub(SelectorStateService.prototype, 'onHealRecorded').resolves(null);
    });

    afterEach(() => {
      Container.get(TracingService).endSessionSpan(SESSION);
      sinon.restore();
      restore();
    });

    const record = (command: string) =>
      DASHBORD_EVENT_MANAGER.afterSessionCommand(
        SESSION,
        command,
        null,
        {
          body: {},
          headers: {},
          method: 'GET',
          originalUrl: `/wd/hub/session/${SESSION}/x`,
        } as any,
        {} as any,
        JSON.stringify({ value: null }),
      );

    it("carry the command's trace id, else the session's, with no spans exported", async () => {
      Container.get(TracingService).startSessionSpan(
        SESSION,
        SESSION,
        {},
        contextOf(sampled(TEST_TRACE, TEST_SPAN)),
      );
      await runWithInboundTrace({ traceparent: sampled(STEP_TRACE, STEP_SPAN) }, () =>
        record('getPageSource'),
      );
      await runWithInboundTrace({}, () => record('getWindowRect'));

      const rows = await scratch.db.sessionLog.findMany({
        where: { session_id: SESSION },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => [r.command_name, r.trace_id, r.span_id])).to.deep.equal([
        ['getPageSource', STEP_TRACE, null],
        ['getWindowRect', TEST_TRACE, null],
      ]);
    });
  });
});
