import 'reflect-metadata';
import { expect } from 'chai';
import http from 'http';
import type { AddressInfo } from 'net';
import sinon from 'sinon';
import { Container } from 'typedi';
import { TracingService } from '../../src/services/TracingService';
import { CommandInterceptor } from '../../src/interceptors/CommandInterceptor';
import { XenonPlugin } from '../../src/plugin';
import * as DeviceService from '../../src/data-service/device-service';
import * as ActiveLeases from '../../src/services/lease/activeLeases';
import { releaseBlockedDevices } from '../../src/device-utils';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { OrphanSweeper } from '../../src/services/OrphanSweeper';
import { PhoneNetworkRestore } from '../../src/services/network/PhoneNetworkRestore';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SessionStatus } from '../../src/types/SessionStatus';
import { XenonLogger } from '../../src/logger';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';
import {
  attributeOf,
  OtlpProbe,
  OtlpSpan,
  resetOtelGlobals,
  startOtlpProbe,
} from '../helpers/otlp-probe';

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

const ERROR = 2;
const OK = 1;

/**
 * A hub starts a span for every session it creates, a node's and a cloud
 * provider's included, and its commands' spans are its children. The only
 * place that ended it was Appium's new-command timeout with the dashboard on,
 * so every other session's span stayed open in memory for the life of the
 * process and was never exported, and its commands showed no parent. A
 * failed command's span also ended OK.
 */
describe('TracingService — session and command spans', function () {
  this.timeout(30_000);
  const scratch = useScratchDatabase();
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

    restoreRegs = saveRegistrations(TracingService, PhoneNetworkRestore, SessionMetricsService);
    tracing = new TracingService();
    tracing.initialize({ isHub: true });
    Container.set(TracingService, tracing);
    Container.set(PhoneNetworkRestore, {
      restoreSession: sinon.stub().resolves(),
      restoreAll: sinon.stub().resolves(),
    } as any);
    Container.set(SessionMetricsService, { stop: sinon.stub().resolves() } as any);
    sinon.stub(DeviceService, 'releaseSessionDevices').resolves();
    sinon.stub(DASHBORD_EVENT_MANAGER, 'onSessionStopped').resolves();
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

  /** The spans exported once the tracer has sent everything it holds. */
  async function exported(): Promise<OtlpSpan[]> {
    await tracing.shutdown();
    return probe.spans();
  }

  async function sessionSpans(sessionId: string): Promise<OtlpSpan[]> {
    return (await exported()).filter((s) => s.name === `Session: ${sessionId}`);
  }

  describe('a session span ends once, however the session ends', () => {
    it('when the test deletes a session Xenon keeps no record of (dashboard off)', async () => {
      tracing.startSessionSpan('s-delete', 's-delete');
      expect(SESSION_MANAGER.getSession('s-delete')).to.equal(undefined);

      await Container.get(SessionLifecycleService).deleteSession(
        sinon.stub().resolves(),
        's-delete',
      );

      const spans = await sessionSpans('s-delete');
      expect(spans).to.have.length(1);
      expect(spans[0].status?.code).to.equal(OK);
    });

    it('as failed when a session ends failed (a node no longer has it)', async () => {
      tracing.startSessionSpan('s-gone', 's-gone');

      await Container.get(SessionLifecycleService).deleteSession(
        async () => undefined,
        's-gone',
        SessionStatus.FAILED,
        'Session terminal failure (gone)',
      );

      const [span] = await sessionSpans('s-gone');
      expect(span.status?.code).to.equal(ERROR);
      expect(attributeOf(span.attributes, 'xenon.session.stop_reason')).to.equal(
        'Session terminal failure (gone)',
      );
    });

    it('when Appium ends the session itself, with the dashboard off', async () => {
      tracing.startSessionSpan('s-timeout', 's-timeout');
      const plugin = { pluginArgs: {}, xenonLog: { withSession: () => ({ info() {} }) } };

      await XenonPlugin.prototype.onUnexpectedShutdown.call(
        plugin as any,
        { sessionId: 's-timeout', caps: { udid: 'R5CT' } },
        new Error('New command timeout'),
      );

      const spans = await sessionSpans('s-timeout');
      expect(spans).to.have.length(1);
      expect(spans[0].status?.code).to.equal(ERROR);
    });

    it("when Xenon's idle check releases the phone", async () => {
      tracing.startSessionSpan('s-idle', 's-idle');
      sinon.stub(DeviceService, 'getAllDevices').resolves([
        {
          udid: 'R5CT',
          host: 'http://127.0.0.1:4723',
          busy: true,
          userBlocked: false,
          session_id: 's-idle',
          claimSessionId: 's-idle',
          lastCmdExecutedAt: Date.now() - 10 * 60 * 1000,
        } as any,
      ]);
      sinon.stub(ActiveLeases, 'activeLeasesByDevice').resolves(new Map());
      sinon.stub(DeviceService, 'releaseSessionDevice').resolves(true);

      await releaseBlockedDevices(60);

      const [span] = await sessionSpans('s-idle');
      expect(span, 'idle session span').to.not.equal(undefined);
      expect(span.status?.code).to.equal(ERROR);
    });

    it('when a graceful shutdown drains the session', async () => {
      tracing.startSessionSpan('s-down', 's-down');

      await Container.get(SessionLifecycleService).stopSessionForShutdown('s-down', 'shutdown');

      const [span] = await sessionSpans('s-down');
      expect(span, 'drained session span').to.not.equal(undefined);
      expect(span.status?.code).to.equal(ERROR);
    });

    it("when a session's heartbeat goes stale", async () => {
      tracing.startSessionSpan('s-stale', 's-stale');
      await scratch.db.session.deleteMany({});
      await scratch.db.session.create({
        data: {
          id: 's-stale',
          status: 'running',
          desired_capabilities: '{}',
          session_capabilities: '{}',
          node_id: 'n',
          has_live_video: false,
          device_udid: 'R5CT',
          device_platform: 'android',
          device_version: '14',
          last_heartbeat_at: new Date(Date.now() - 60 * 60 * 1000),
        },
      });

      await new OrphanSweeper().sweep({ heartbeatIntervalMs: 1_000 });

      const [span] = await sessionSpans('s-stale');
      expect(span, 'stale session span').to.not.equal(undefined);
      expect(span.status?.code).to.equal(ERROR);
    });

    it('when the server shuts down with the session still running elsewhere', async () => {
      tracing.startSessionSpan('s-on-node', 's-on-node');

      const [span] = await sessionSpans('s-on-node');
      expect(span, 'open session span at shutdown').to.not.equal(undefined);
      expect(attributeOf(span.attributes, 'xenon.session.stop_reason')).to.equal(
        'Xenon shut down while the session was running',
      );
    });

    it('within its budget when the collector never answers', async () => {
      const silent = http.createServer(() => undefined);
      await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', () => resolve()));
      try {
        await tracing.shutdown();
        resetOtelGlobals();
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${
          (silent.address() as AddressInfo).port
        }/v1/traces`;
        tracing = new TracingService();
        tracing.initialize({ isHub: true });
        tracing.startSessionSpan('s-hung', 's-hung');

        const started = Date.now();
        await tracing.shutdownWithin(300);

        expect(Date.now() - started).to.be.lessThan(2_000);
      } finally {
        silent.closeAllConnections?.();
        silent.close();
      }
    });

    it('when Xenon fails to finish creating it', async () => {
      const context = Container.get(PluginContext);
      const savedContext = { ...context };
      context.setContext({ ...DefaultPluginArgs } as any, 4723, 'hub-1', '');
      sinon.stub(DeviceService, 'claimDeviceForSession').rejects(new Error('database is locked'));
      try {
        const finishing = (Container.get(SessionLifecycleService) as any).finalizeSession(
          { value: ['s-half', {}] },
          { udid: 'R5CT', platform: 'android', host: 'http://127.0.0.1:4723', nodeId: 'hub-1' },
          { alwaysMatch: {}, firstMatch: [{}] },
          {},
          false,
        );
        await finishing.then(
          () => expect.fail('the create was expected to fail'),
          () => undefined,
        );
      } finally {
        Object.assign(context, savedContext);
      }

      const [span] = await sessionSpans('s-half');
      expect(span, 'half-created session span').to.not.equal(undefined);
      expect(span.status?.code).to.equal(ERROR);
      expect(attributeOf(span.attributes, 'xenon.session.stop_reason')).to.include(
        'database is locked',
      );
    });

    it('only once when two endings race', async () => {
      tracing.startSessionSpan('s-twice', 's-twice');
      const lifecycle = Container.get(SessionLifecycleService);

      await Promise.all([
        lifecycle.deleteSession(async () => undefined, 's-twice'),
        lifecycle.stopSessionForShutdown('s-twice', 'shutdown'),
      ]);

      expect(await sessionSpans('s-twice')).to.have.length(1);
    });
  });

  describe("a command's span", () => {
    beforeEach(() => {
      sinon.stub(DeviceService, 'updateCmdExecutedTime').resolves();
      sinon.stub(DASHBORD_EVENT_MANAGER, 'beforeSessionCommand').resolves(true as any);
    });

    function run(next: () => Promise<unknown>) {
      return Container.get(CommandInterceptor).handle(
        next,
        { sessionId: 's-cmd', caps: {} },
        'getPageSource',
        [],
        {} as any,
        true,
      );
    }

    it('is a child of its session span', async () => {
      tracing.startSessionSpan('s-cmd', 's-cmd');

      await run(async () => '<xml/>');
      tracing.endSessionSpan('s-cmd');

      const spans = await exported();
      const session = spans.find((s) => s.name === 'Session: s-cmd');
      const command = spans.find((s) => s.name === 'getPageSource');
      expect(session, 'session span').to.not.equal(undefined);
      expect(command, 'command span').to.not.equal(undefined);
      expect(command?.parentSpanId).to.equal(session?.spanId);
      expect(command?.status?.code).to.equal(OK);
    });

    it('records the error and ends ERROR when the command fails', async () => {
      tracing.startSessionSpan('s-cmd', 's-cmd');

      let thrown: unknown;
      try {
        await run(async () => {
          throw new Error('An unknown server-side error occurred: boom');
        });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).to.be.instanceOf(Error);

      const command = (await exported()).find((s) => s.name === 'getPageSource');
      expect(command?.status?.code).to.equal(ERROR);
      expect(command?.status?.message).to.equal('An unknown server-side error occurred: boom');
      const exception = command?.events?.find((e) => e.name === 'exception');
      expect(attributeOf(exception?.attributes, 'exception.message')).to.equal(
        'An unknown server-side error occurred: boom',
      );
    });
  });
});
