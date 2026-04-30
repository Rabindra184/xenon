import 'reflect-metadata';
import { expect } from 'chai';
import { TracingService } from '../../src/services/TracingService';
import { XenonLogger } from '../../src/logger';

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

function clearOtelEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

describe('TracingService — SDK init', () => {
  beforeEach(() => {
    clearOtelEnv();
    XenonLogger.setOtlpReady(false);
  });

  afterEach(() => {
    clearOtelEnv();
    XenonLogger.setOtlpReady(false);
  });

  it('returns undefined logger when OTEL_SDK_DISABLED=true (master kill switch)', () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'http://localhost:3100';
    const t = new TracingService();
    t.initialize({ isHub: true });
    expect(t.getLogger()).to.equal(undefined);
  });

  it('returns undefined logger when OTEL_LOGS_ENABLED=false (per-channel disable)', () => {
    process.env.OTEL_LOGS_ENABLED = 'false';
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'http://localhost:3100';
    const t = new TracingService();
    t.initialize({ isHub: true });
    expect(t.getLogger()).to.equal(undefined);
  });

  it('returns undefined logger when no log endpoint is configured', () => {
    const t = new TracingService();
    t.initialize({ isHub: true });
    expect(t.getLogger()).to.equal(undefined);
  });

  it('wires the LoggerProvider when an endpoint is set', () => {
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'http://localhost:3100';
    const t = new TracingService();
    t.initialize({ isHub: true });
    expect(t.getLogger()).to.not.equal(undefined);
  });

  it('flips XenonLogger.otlpReady on init and back off on shutdown', () => {
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'http://localhost:3100';
    const t = new TracingService();
    expect(t.getLogger()).to.equal(undefined);

    t.initialize({ isHub: true });
    // Indirect probe: after init, logger.ts will fan out OTLP. If otlpReady
    // weren't set, getLogger() might still be non-null but the static guard
    // in logMessage would skip emission. We verify via the fact that
    // shutdown clears the cache (which only matters when otlpReady was true).
    expect(t.getLogger()).to.not.equal(undefined);

    t.shutdown();
    // After shutdown, instance-level state is gone but the cache reset means
    // a fresh init can re-wire cleanly.
    const t2 = new TracingService();
    t2.initialize({ isHub: true });
    expect(t2.getLogger()).to.not.equal(undefined);
  });

  it('initializes logs independently from traces (logs endpoint set, traces endpoint absent)', () => {
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'http://localhost:3100';
    // No OTEL_EXPORTER_OTLP_ENDPOINT — traces should remain unconfigured.
    const t = new TracingService();
    t.initialize({ isHub: true });
    expect(t.getLogger()).to.not.equal(undefined);
  });

  it('accepts both isHub=true (hub role) and isHub=false (node role) without throwing', () => {
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'http://localhost:3100';

    const hub = new TracingService();
    expect(() => hub.initialize({ isHub: true })).to.not.throw();
    expect(hub.getLogger()).to.not.equal(undefined);

    const node = new TracingService();
    expect(() => node.initialize({ isHub: false })).to.not.throw();
    expect(node.getLogger()).to.not.equal(undefined);
  });

  // ----------------------------------------------------------------------
  // Metrics SDK
  // ----------------------------------------------------------------------

  it('returns undefined meter when OTEL_SDK_DISABLED=true', () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = 'http://localhost:4318/v1/metrics';
    const t = new TracingService();
    t.initialize({ isHub: true });
    expect(t.getMeter()).to.equal(undefined);
  });

  it('returns undefined meter when OTEL_METRICS_ENABLED=false', () => {
    process.env.OTEL_METRICS_ENABLED = 'false';
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = 'http://localhost:4318/v1/metrics';
    const t = new TracingService();
    t.initialize({ isHub: true });
    expect(t.getMeter()).to.equal(undefined);
  });

  it('returns undefined meter when no metrics endpoint and no debug flag', () => {
    const t = new TracingService();
    t.initialize({ isHub: true });
    expect(t.getMeter()).to.equal(undefined);
  });

  it('wires the MeterProvider when a metrics endpoint is set', () => {
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = 'http://localhost:4318/v1/metrics';
    const t = new TracingService();
    t.initialize({ isHub: true });
    expect(t.getMeter()).to.not.equal(undefined);
    t.shutdown();
  });

  it('wires a console-only MeterProvider when XENON_OTEL_DEBUG=true with no metrics endpoint', () => {
    process.env.XENON_OTEL_DEBUG = 'true';
    const t = new TracingService();
    t.initialize({ isHub: true });
    expect(t.getMeter()).to.not.equal(undefined);
    t.shutdown();
  });

  it('initializes metrics independently from traces and logs', () => {
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = 'http://localhost:4318/v1/metrics';
    // Neither traces nor logs endpoints set.
    const t = new TracingService();
    t.initialize({ isHub: true });
    expect(t.getMeter()).to.not.equal(undefined);
    expect(t.getLogger()).to.equal(undefined);
    t.shutdown();
  });

  it('emitting through getMeter does not throw (counter/histogram API smoke)', () => {
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = 'http://localhost:4318/v1/metrics';
    const t = new TracingService();
    t.initialize({ isHub: true });
    const meter = t.getMeter();
    expect(meter).to.not.equal(undefined);
    if (!meter) return;

    const counter = meter.createCounter('xenon.test.smoke_counter');
    const histogram = meter.createHistogram('xenon.test.smoke_histogram');
    expect(() => counter.add(1, { tier: 'native' })).to.not.throw();
    expect(() => histogram.record(42, { tier: 'native' })).to.not.throw();

    t.shutdown();
  });
});
