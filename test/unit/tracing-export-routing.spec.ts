import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { metrics } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { TracingService } from '../../src/services/TracingService';
import { XenonLogger } from '../../src/logger';
import {
  flushOtelGlobals,
  OtlpProbe,
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

/**
 * With tracing on, Xenon builds an OTel NodeSDK for its spans. A NodeSDK
 * that isn't handed log processors or metric readers builds its own from the
 * standard OTEL_* variables and registers them globally before Xenon could.
 * Xenon's own logger and meter providers were then refused, so:
 * - logs went out as protobuf through the SDK's exporter, not Xenon's;
 * - metrics went to the trace URL + /v1/metrics, even with
 *   OTEL_METRICS_ENABLED=false;
 * - only traces on also exported logs, to the trace URL + /v1/logs;
 * - XENON_OTEL_DEBUG's console log and metric exporters never printed.
 *
 * A probe collector shows where each signal went.
 */
describe('TracingService — where logs and metrics go with tracing on', function () {
  this.timeout(20_000);
  let probe: OtlpProbe;
  let service: TracingService | undefined;
  let saved: Record<string, string | undefined>;

  beforeEach(async () => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    resetOtelGlobals();
    XenonLogger.setOtlpReady(false);
    probe = await startOtlpProbe();
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = probe.url('/v1/traces');
  });

  afterEach(async () => {
    await service?.shutdown();
    service = undefined;
    sinon.restore();
    resetOtelGlobals();
    XenonLogger.setOtlpReady(false);
    await probe.close();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function start(): TracingService {
    service = new TracingService();
    service.initialize({ isHub: true });
    return service;
  }

  function countProbeMetric(): void {
    metrics.getMeter('probe').createCounter('xenon.probe.count').add(1);
  }

  function emitProbeLog(): void {
    logs.getLogger('probe').emit({ body: 'probe line', severityNumber: SeverityNumber.INFO });
  }

  it('exports no metrics with OTEL_METRICS_ENABLED=false', async () => {
    process.env.OTEL_METRICS_ENABLED = 'false';
    start();
    countProbeMetric();
    await flushOtelGlobals();

    expect(probe.requests.map((r) => r.path).filter((p) => p.includes('metrics'))).to.deep.equal(
      [],
    );
  });

  it('exports no metrics when no metrics endpoint is set, and never to the trace URL', async () => {
    start();
    countProbeMetric();
    await flushOtelGlobals();

    expect(probe.requests.map((r) => r.path)).to.not.include('/v1/traces/v1/metrics');
  });

  it("sends metrics to Xenon's metrics endpoint as OTLP/JSON", async () => {
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = probe.url('/xenon-metrics');
    start();
    countProbeMetric();
    await flushOtelGlobals();

    const sent = probe.requests.filter((r) => r.path === '/xenon-metrics');
    expect(sent, 'metrics export').to.have.length.greaterThan(0);
    expect(sent.every((r) => r.contentType.includes('application/json'))).to.equal(true);
    expect(sent.map((r) => r.body.toString('utf8')).join()).to.include('xenon.probe.count');
  });

  it('exports no logs when only traces are configured', async () => {
    start();
    emitProbeLog();
    await flushOtelGlobals();

    expect(probe.requests.map((r) => r.path).filter((p) => p.includes('logs'))).to.deep.equal([]);
  });

  it("sends logs to Xenon's log endpoint as OTLP/JSON", async () => {
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = probe.url('/xenon-logs');
    start();
    emitProbeLog();
    await flushOtelGlobals();

    const sent = probe.requests.filter((r) => r.path === '/xenon-logs');
    expect(sent, 'logs export').to.have.length.greaterThan(0);
    expect(sent.every((r) => r.contentType.includes('application/json'))).to.equal(true);
    expect(sent.map((r) => r.body.toString('utf8')).join()).to.include('probe line');
  });

  it('prints logs and metrics to the console with XENON_OTEL_DEBUG=true', async () => {
    const printed = sinon.stub(console, 'dir');
    process.env.XENON_OTEL_DEBUG = 'true';
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = probe.url('/xenon-logs');
    start();
    emitProbeLog();
    countProbeMetric();
    await flushOtelGlobals();
    printed.restore();

    const shown = printed.getCalls().map((c) => JSON.stringify(c.args[0]));
    expect(
      shown.some((s) => s.includes('probe line')),
      'console log record',
    ).to.equal(true);
    expect(
      shown.some((s) => s.includes('xenon.probe.count')),
      'console metric',
    ).to.equal(true);
  });
});
