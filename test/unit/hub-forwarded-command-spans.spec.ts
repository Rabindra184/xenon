import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import type { IncomingHttpHeaders } from 'http';
import request from '../helpers/loopbackRequest';
import { loopbackServers } from '../helpers/loopbackServer';
import { TracingService } from '../../src/services/TracingService';
import { XenonLogger } from '../../src/logger';
import {
  createHubRouting,
  createSessionGatewayLayer,
  DashboardHooks,
} from '../../src/gateway/sessionGateway';
import { createInternalCallLayer, internalCallHeaders } from '../../src/gateway/internalCall';
import { HEAL_REPORT_HEADER, HealReport } from '../../src/gateway/healReport';
import { routeToCommandName } from '@appium/base-driver';
import { readTraceContext } from '../../src/services/tracing/inboundTrace';
import { OtlpProbe, OtlpSpan, resetOtelGlobals, startOtlpProbe } from '../helpers/otlp-probe';

const SESSION = 'node-s-1';
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

const SPAN_OK = 1;
const SPAN_ERROR = 2;

function attr(span: OtlpSpan | undefined, key: string): unknown {
  const value = span?.attributes?.find((a) => a.key === key)?.value;
  if (!value) return undefined;
  if ('intValue' in value) return Number(value.intValue);
  return Object.values(value)[0];
}

const heal: HealReport = {
  originalSelector: '//old',
  originalStrategy: 'xpath',
  healedSelector: 'id=new',
  healedStrategy: 'id',
  confidence: 0.92,
  tier: 2,
};

/**
 * ENH-04: a command a hub forwards to a node (or a cloud provider) gets a
 * span on the hub, as a command on the hub's own phones does in
 * CommandInterceptor, and the node is sent that span as the command's
 * `traceparent`.
 */
describe('Spans for commands a hub forwards (ENH-04)', function () {
  this.timeout(30_000);

  const loopback = loopbackServers();
  let probe: OtlpProbe | undefined;
  let tracing: TracingService;
  let saved: Record<string, string | undefined>;
  let nodeSeen: IncomingHttpHeaders[];
  let nodeUrl: string;
  let hubBase: string;
  let recordIds: Array<{ command?: string; traceId?: string; spanId?: string }>;
  let cloud: boolean;
  let dashboardOn: boolean;

  /** A node: answers by path, keeps the headers of each command it was sent. */
  async function startNode() {
    const node = express();
    node.use(express.json());
    node.use((req, res, next) => {
      nodeSeen.push({ ...req.headers });
      next();
    });
    node.get('/wd/hub/session/:id/source', (_req, res) => res.json({ value: '<xml/>' }));
    node.post('/wd/hub/session/:id/element', (req, res) => {
      if (req.body?.value === '//old') {
        res.setHeader(HEAL_REPORT_HEADER, Buffer.from(JSON.stringify(heal)).toString('base64url'));
        res.json({ value: { 'element-6066-11e4-a52e-4f735466cecf': 'healed-1' } });
        return;
      }
      res.status(404).json({
        value: {
          error: 'no such element',
          message: 'An element could not be located',
          stacktrace: '',
        },
      });
    });
    node.get('/wd/hub/session/:id/url', (_req, res) => {
      setTimeout(() => res.json({ value: 'about:blank' }), 1_500);
    });
    node.get('/wd/hub/session/:id/window/rect', (_req, res) => {
      res.status(500).send('not json at all');
    });
    const server = await loopback.serve(node);
    return `http://127.0.0.1:${(server.address() as any).port}/wd/hub`;
  }

  async function startHub(withTracing: TracingService, url = () => nodeUrl) {
    const dashboard: DashboardHooks = {
      before: async () => true,
      after: async (sessionId, command) => {
        recordIds.push({ command, ...withTracing.commandTraceIds(sessionId) });
      },
    };
    const routing = createHubRouting({
      basePath: '/wd/hub',
      locate: async () => ({ kind: 'remote', url: url(), cloud, session: {} as any }),
      forget: () => undefined,
      tokenFor: async () => null,
      forgetToken: () => undefined,
      deleteSession: async (next) => next(),
      touch: async () => undefined,
      commandName: (path, method) => routeToCommandName(path, method as any, '/wd/hub'),
      get dashboard() {
        return dashboardOn ? dashboard : undefined;
      },
      tracing: withTracing,
      logger: { warn: () => undefined, error: () => undefined, info: () => undefined } as any,
    });
    const hub = express();
    hub.use(createInternalCallLayer('/wd/hub'));
    hub.use(express.json());
    hub.use(
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
        routing,
      }),
    );
    const server = await loopback.serve(hub);
    hubBase = `http://127.0.0.1:${(server.address() as any).port}`;
  }

  beforeEach(async () => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    resetOtelGlobals();
    XenonLogger.setOtlpReady(false);
    nodeSeen = [];
    recordIds = [];
    cloud = false;
    dashboardOn = true;
    nodeUrl = await startNode();
  });

  afterEach(async () => {
    await tracing?.shutdown();
    resetOtelGlobals();
    await probe?.close();
    probe = undefined;
    await loopback.closeAll();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe('with traces exported', () => {
    beforeEach(async () => {
      probe = await startOtlpProbe();
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = probe.url('/v1/traces');
      tracing = new TracingService();
      tracing.initialize({ isHub: true });
      await startHub(tracing);
    });

    async function exported(): Promise<OtlpSpan[]> {
      await tracing.shutdown();
      return probe!.spans();
    }

    it("a forwarded command is a span under its session's, and the node is sent that span as the parent", async () => {
      tracing.startSessionSpan(SESSION, SESSION, {}, contextOf(sampled(TEST_TRACE, TEST_SPAN)));
      const res = await request(hubBase).get(`/wd/hub/session/${SESSION}/source`).expect(200);
      expect(res.body).to.deep.equal({ value: '<xml/>' });
      tracing.endSessionSpan(SESSION);

      const spans = await exported();
      const session = spans.find((s) => s.name === `Session: ${SESSION}`);
      const command = spans.find((s) => s.name === 'getPageSource');
      expect(command, 'command span').to.exist;
      expect(command!.traceId).to.equal(TEST_TRACE);
      expect(command!.parentSpanId).to.equal(session!.spanId);
      expect(command!.status?.code).to.equal(SPAN_OK);
      expect(attr(command, 'xenon.session_id')).to.equal(SESSION);
      expect(attr(command, 'xenon.forwarded_to')).to.equal(new URL(nodeUrl).origin);
      expect(attr(command, 'http.response.status_code')).to.equal(200);

      expect(nodeSeen).to.have.length(1);
      expect(nodeSeen[0].traceparent).to.equal(sampled(TEST_TRACE, command!.spanId));
      expect(recordIds).to.deep.equal([
        { command: 'getPageSource', traceId: TEST_TRACE, spanId: command!.spanId },
      ]);
    });

    it("a command sent with its own context is that context's child, linked to its session, and its tracestate goes on", async () => {
      tracing.startSessionSpan(SESSION, SESSION);
      await request(hubBase)
        .get(`/wd/hub/session/${SESSION}/source`)
        .set('traceparent', sampled(STEP_TRACE, STEP_SPAN))
        .set('tracestate', 'vendor=abc')
        .expect(200);
      tracing.endSessionSpan(SESSION);

      const spans = await exported();
      const session = spans.find((s) => s.name === `Session: ${SESSION}`);
      const command = spans.find((s) => s.name === 'getPageSource');
      expect(command!.traceId).to.equal(STEP_TRACE);
      expect(command!.parentSpanId).to.equal(STEP_SPAN);
      expect(command!.links?.map((l) => l.spanId)).to.deep.equal([session!.spanId]);
      expect(nodeSeen[0].traceparent).to.equal(sampled(STEP_TRACE, command!.spanId));
      expect(nodeSeen[0].tracestate).to.equal('vendor=abc');
    });

    it("a node's WebDriver error ends the span ERROR with its code and message, and the client gets the answer unchanged", async () => {
      tracing.startSessionSpan(SESSION, SESSION);
      const res = await request(hubBase)
        .post(`/wd/hub/session/${SESSION}/element`)
        .send({ using: 'xpath', value: '//missing' })
        .expect(404);
      expect(res.body.value.error).to.equal('no such element');
      tracing.endSessionSpan(SESSION);

      const command = (await exported()).find((s) => s.name === 'findElement');
      expect(command!.status?.code).to.equal(SPAN_ERROR);
      expect(command!.status?.message).to.equal('An element could not be located');
      expect(attr(command, 'xenon.webdriver.error')).to.equal('no such element');
      expect(attr(command, 'http.response.status_code')).to.equal(404);
      expect(command!.events?.map((e) => e.name)).to.include('exception');
    });

    it("reads the node's error for the span with the hub's dashboard off, which reads no answers", async () => {
      dashboardOn = false;
      tracing.startSessionSpan(SESSION, SESSION);
      const res = await request(hubBase)
        .post(`/wd/hub/session/${SESSION}/element`)
        .send({ using: 'xpath', value: '//missing' })
        .expect(404);
      expect(res.body.value.message).to.equal('An element could not be located');
      await request(hubBase).get(`/wd/hub/session/${SESSION}/source`).expect(200);
      tracing.endSessionSpan(SESSION);

      const spans = await exported();
      const find = spans.find((s) => s.name === 'findElement');
      expect(find!.status?.message).to.equal('An element could not be located');
      expect(attr(find, 'xenon.webdriver.error')).to.equal('no such element');
      expect(spans.find((s) => s.name === 'getPageSource')!.status?.code).to.equal(SPAN_OK);
      expect(recordIds).to.deep.equal([]);
    });

    it('an error answer that is not WebDriver JSON still ends the span ERROR, by its status', async () => {
      tracing.startSessionSpan(SESSION, SESSION);
      const res = await request(hubBase).get(`/wd/hub/session/${SESSION}/window/rect`).expect(500);
      expect(res.text).to.equal('not json at all');
      tracing.endSessionSpan(SESSION);

      const command = (await exported()).find((s) => s.name === 'getWindowRect');
      expect(command!.status?.code).to.equal(SPAN_ERROR);
      expect(command!.status?.message).to.equal('The node answered HTTP 500');
      expect(attr(command, 'xenon.webdriver.error')).to.equal(undefined);
    });

    it("a heal the node made is on the command's span", async () => {
      tracing.startSessionSpan(SESSION, SESSION);
      const res = await request(hubBase)
        .post(`/wd/hub/session/${SESSION}/element`)
        .send({ using: 'xpath', value: '//old' })
        .expect(200);
      expect(res.headers[HEAL_REPORT_HEADER]).to.equal(undefined);
      tracing.endSessionSpan(SESSION);

      const command = (await exported()).find((s) => s.name === 'findElement');
      expect(command!.status?.code).to.equal(SPAN_OK);
      expect(attr(command, 'xenon.healed')).to.equal(true);
      expect(attr(command, 'xenon.heal.tier')).to.equal(2);
      expect(attr(command, 'xenon.heal.original_selector')).to.equal('//old');
      expect(attr(command, 'xenon.heal.original_strategy')).to.equal('xpath');
      expect(attr(command, 'xenon.heal.healed_selector')).to.equal('id=new');
      expect(attr(command, 'xenon.heal.healed_strategy')).to.equal('id');
      expect(attr(command, 'xenon.heal.confidence')).to.equal(0.92);
    });

    it('a node that cannot be reached ends the span ERROR', async () => {
      tracing.startSessionSpan(SESSION, SESSION);
      nodeUrl = 'http://127.0.0.1:1/wd/hub';
      await request(hubBase).get(`/wd/hub/session/${SESSION}/source`).expect(500);
      tracing.endSessionSpan(SESSION);

      const command = (await exported()).find((s) => s.name === 'getPageSource');
      expect(command!.status?.code).to.equal(SPAN_ERROR);
      expect(command!.status?.message).to.match(/^Could not reach the node/);
    });

    it('a client that leaves before the node answers ends the span ERROR', async () => {
      tracing.startSessionSpan(SESSION, SESSION);
      const left = await request(hubBase)
        .get(`/wd/hub/session/${SESSION}/url`)
        .timeout(200)
        .then(
          () => false,
          (error) => error.timeout !== undefined,
        );
      expect(left, 'the client timed out').to.equal(true);
      await new Promise((resolve) => setTimeout(resolve, 300));
      tracing.endSessionSpan(SESSION);

      const command = (await exported()).find((s) => s.name === 'getUrl');
      expect(command!.status?.code).to.equal(SPAN_ERROR);
      expect(command!.status?.message).to.equal(
        'The client closed the connection before the command was answered',
      );
    });

    it('names a cloud provider by its origin alone, never with the credentials in its URL', async () => {
      cloud = true;
      const port = new URL(nodeUrl).port;
      nodeUrl = `http://user:secret-key@127.0.0.1:${port}/wd/hub`;
      tracing.startSessionSpan(SESSION, SESSION);
      await request(hubBase).get(`/wd/hub/session/${SESSION}/source`).expect(200);
      tracing.endSessionSpan(SESSION);

      const command = (await exported()).find((s) => s.name === 'getPageSource');
      expect(attr(command, 'xenon.forwarded_to')).to.equal(`http://127.0.0.1:${port}`);
      expect(JSON.stringify(command)).to.not.include('secret-key');
    });

    it("a command in a trace the test didn't sample exports nothing, and the node gets the test's header as it came", async () => {
      tracing.startSessionSpan(SESSION, SESSION, {}, contextOf(unsampled(TEST_TRACE, TEST_SPAN)));
      await request(hubBase)
        .get(`/wd/hub/session/${SESSION}/source`)
        .set('traceparent', unsampled(STEP_TRACE, STEP_SPAN))
        .expect(200);
      tracing.endSessionSpan(SESSION);

      expect(await exported()).to.deep.equal([]);
      expect(nodeSeen[0].traceparent).to.equal(unsampled(STEP_TRACE, STEP_SPAN));
      expect(recordIds).to.deep.equal([
        { command: 'getPageSource', traceId: STEP_TRACE, spanId: undefined },
      ]);
    });

    it("gives Xenon's own call to the session, and the session's delete, no span", async () => {
      tracing.startSessionSpan(SESSION, SESSION);
      await request(hubBase)
        .get(`/wd/hub/wd-internal/session/${SESSION}/source`)
        .set(internalCallHeaders())
        .expect(200);
      await request(hubBase).delete(`/wd/hub/session/${SESSION}`);
      tracing.endSessionSpan(SESSION);

      const names = (await exported()).map((s) => s.name);
      expect(names).to.deep.equal([`Session: ${SESSION}`]);
      expect(nodeSeen).to.have.length(2);
    });
  });

  describe('with no traces exported', () => {
    beforeEach(async () => {
      tracing = new TracingService(); // never initialized: tracing is off
      await startHub(tracing);
    });

    it("sends the node the client's trace headers as they came, and records the command's trace id with no span id", async () => {
      tracing.startSessionSpan(SESSION, SESSION, {}, contextOf(sampled(TEST_TRACE, TEST_SPAN)));
      await request(hubBase)
        .get(`/wd/hub/session/${SESSION}/source`)
        .set('traceparent', sampled(STEP_TRACE, STEP_SPAN))
        .set('tracestate', 'vendor=abc')
        .expect(200);
      await request(hubBase).get(`/wd/hub/session/${SESSION}/source`).expect(200);
      tracing.endSessionSpan(SESSION);

      expect(nodeSeen.map((h) => [h.traceparent, h.tracestate])).to.deep.equal([
        [sampled(STEP_TRACE, STEP_SPAN), 'vendor=abc'],
        [undefined, undefined],
      ]);
      expect(recordIds).to.deep.equal([
        { command: 'getPageSource', traceId: STEP_TRACE, spanId: undefined },
        { command: 'getPageSource', traceId: TEST_TRACE, spanId: undefined },
      ]);
    });
  });
});
