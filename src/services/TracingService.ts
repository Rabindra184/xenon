import { trace, metrics, Span, SpanStatusCode, context, SpanKind, Meter } from '@opentelemetry/api';
import { logs, Logger } from '@opentelemetry/api-logs';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  LoggerProvider,
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
  LogRecordProcessor,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import {
  MeterProvider,
  MetricReader,
  PeriodicExportingMetricReader,
  ConsoleMetricExporter,
} from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { Service } from 'typedi';
import log, { XenonLogger } from '../logger';

/** Why a session's span ended, on the span. */
const SESSION_STOP_REASON = 'xenon.session.stop_reason';

function failSpan(span: Span, error: unknown) {
  const exception =
    error instanceof Error ? error : { message: String((error as any)?.message ?? error) };
  span.recordException(exception);
  span.setStatus({ code: SpanStatusCode.ERROR, message: exception.message });
}

export interface TracingInitOptions {
  // True when this process is acting as a Xenon hub; false when it is a node
  // pointing at a remote hub. Surfaces as a `service` resource attribute so
  // dashboards can split hub vs. node traffic.
  isHub: boolean;
}

@Service()
export class TracingService {
  private sdk: NodeSDK | null = null;
  // Built here only while tracing is off; with it on, the NodeSDK owns them.
  private loggerProvider: LoggerProvider | null = null;
  private meterProvider: MeterProvider | null = null;
  // Whether Xenon's own log export and metric export are configured.
  private logsOn = false;
  private metricsOn = false;
  private tracer = trace.getTracer('xenon-core');
  private activeSpans: Map<string, Span> = new Map();
  // Which of activeSpans are sessions' (keyed by session id) rather than
  // commands' (`<sessionId>:<command>`).
  private sessionSpanIds = new Set<string>();
  private spanProcessorsInUse: SpanProcessor[] = [];

  public initialize(opts: TracingInitOptions = { isHub: true }) {
    if (process.env.OTEL_SDK_DISABLED === 'true') {
      log.info('[TracingService] OTEL_SDK_DISABLED=true — OTel disabled.');
      return;
    }

    const role = opts.isHub ? 'hub' : 'node';
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'xenon',
      service: role,
    });

    const spanProcessors = this.spanProcessors();
    const logRecordProcessors = this.logRecordProcessors();
    const metricReaders = this.metricReaders();

    if (spanProcessors.length > 0) {
      // A NodeSDK that isn't handed log processors and metric readers builds
      // its own from the standard OTEL_* variables (OTLP exporters at
      // OTEL_EXPORTER_OTLP_ENDPOINT + /v1/logs and /v1/metrics, which is
      // Xenon's trace URL) and registers them globally before Xenon could, so
      // Xenon's settings for logs and metrics did nothing while tracing was
      // on. It gets Xenon's, or none. With none for logs it still registers
      // a logger provider, one that exports nothing.
      this.spanProcessorsInUse = spanProcessors;
      this.sdk = new NodeSDK({
        resource,
        spanProcessors,
        logRecordProcessors,
        metricReaders,
      });
      try {
        this.sdk.start();
        log.info('[TracingService] Trace SDK started.');
      } catch (err: any) {
        log.error(`[TracingService] Failed to start trace SDK: ${err.message}`);
      }
    } else {
      if (logRecordProcessors.length > 0) {
        this.loggerProvider = new LoggerProvider({ resource, processors: logRecordProcessors });
        logs.setGlobalLoggerProvider(this.loggerProvider);
      }
      if (metricReaders.length > 0) {
        this.meterProvider = new MeterProvider({ resource, readers: metricReaders });
        metrics.setGlobalMeterProvider(this.meterProvider);
      }
    }

    if (logRecordProcessors.length > 0) {
      this.logsOn = true;
      XenonLogger.setOtlpReady(true);
      log.info(
        `[TracingService] Log OTLP endpoint: ${process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT}. Log SDK started.`,
      );
    }
    if (metricReaders.length > 0) {
      this.metricsOn = true;
      log.info(
        `[TracingService] Metric OTLP endpoint: ${
          process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ?? '(console-only)'
        }. Metrics SDK started.`,
      );
    }
  }

  private spanProcessors(): SpanProcessor[] {
    if (process.env.OTEL_TRACES_ENABLED === 'false') {
      log.info('[TracingService] OTEL_TRACES_ENABLED=false — trace export disabled.');
      return [];
    }

    const exporters = [];

    if (process.env.XENON_OTEL_DEBUG === 'true') {
      log.info('[TracingService] XENON_OTEL_DEBUG=true — adding ConsoleSpanExporter.');
      exporters.push(new ConsoleSpanExporter());
    }

    if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      log.info(`[TracingService] Trace OTLP endpoint: ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}.`);
      exporters.push(
        new OTLPTraceExporter({
          url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        }),
      );
    }

    if (exporters.length === 0) {
      log.info('[TracingService] No trace exporters configured. Spans recorded in-memory only.');
      return [];
    }

    // Pre-existing pre-PR-86 bug: only exporters[0] was wired, so combining
    // XENON_OTEL_DEBUG=true with an OTLP endpoint silently dropped one of the
    // two destinations. Each exporter now gets its own SimpleSpanProcessor.
    return exporters.map((e) => new SimpleSpanProcessor(e as any));
  }

  private logRecordProcessors(): LogRecordProcessor[] {
    if (process.env.OTEL_LOGS_ENABLED === 'false') {
      log.info('[TracingService] OTEL_LOGS_ENABLED=false — log export disabled.');
      return [];
    }

    const endpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
    if (!endpoint) return [];

    const processors: LogRecordProcessor[] = [];
    if (process.env.XENON_OTEL_DEBUG === 'true') {
      processors.push(new SimpleLogRecordProcessor(new ConsoleLogRecordExporter()));
    }
    processors.push(new BatchLogRecordProcessor(new OTLPLogExporter({ url: endpoint })));
    return processors;
  }

  private metricReaders(): MetricReader[] {
    if (process.env.OTEL_METRICS_ENABLED === 'false') {
      log.info('[TracingService] OTEL_METRICS_ENABLED=false — metrics export disabled.');
      return [];
    }

    const endpoint = process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
    const debug = process.env.XENON_OTEL_DEBUG === 'true';
    if (!endpoint && !debug) return [];

    const readers: MetricReader[] = [];
    if (debug) {
      // 10s interval keeps console output readable during dev sessions.
      readers.push(
        new PeriodicExportingMetricReader({
          exporter: new ConsoleMetricExporter(),
          exportIntervalMillis: 10_000,
        }),
      );
    }
    if (endpoint) {
      // 60s default cadence balances real-time visibility against export volume.
      readers.push(
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: endpoint }),
          exportIntervalMillis: 60_000,
        }),
      );
    }
    return readers;
  }

  public getLogger(name = 'xenon-core'): Logger | undefined {
    if (!this.logsOn) return undefined;
    return logs.getLogger(name);
  }

  public getMeter(name = 'xenon-core'): Meter | undefined {
    if (!this.metricsOn) return undefined;
    return metrics.getMeter(name);
  }

  public startSessionSpan(
    sessionId: string,
    name: string,
    attributes: Record<string, any> = {},
  ): Span | undefined {
    if (!this.sdk) return undefined;
    const span = this.tracer.startSpan(`Session: ${name || sessionId}`, {
      kind: SpanKind.SERVER,
      attributes: {
        'xenon.session_id': sessionId,
        ...attributes,
      },
    });
    this.activeSpans.set(sessionId, span);
    this.sessionSpanIds.add(sessionId);
    return span;
  }

  /**
   * Ends a session's span. Every way a session ends calls this (the client's
   * delete, Appium's new-command timeout, the idle release, the heartbeat
   * sweeps, a shutdown's drain), so whichever comes second finds nothing.
   * `failed` for a session that ended failed; `reason` says why it ended.
   */
  public endSessionSpan(sessionId: string, ending: { failed?: boolean; reason?: string } = {}) {
    this.endSpan(
      sessionId,
      ending.failed ? 'ERROR' : 'OK',
      ending.reason ? { [SESSION_STOP_REASON]: ending.reason } : {},
    );
  }

  public startCommandSpan(
    sessionId: string,
    commandName: string,
    attributes: Record<string, any> = {},
  ): Span | undefined {
    if (!this.sdk) return undefined;
    const parentSpan = this.activeSpans.get(sessionId);
    const spanOptions: any = {
      kind: SpanKind.INTERNAL,
      attributes: {
        'xenon.session_id': sessionId,
        'xenon.command': commandName,
        ...attributes,
      },
    };

    let span: Span;
    if (parentSpan) {
      const ctx = trace.setSpan(context.active(), parentSpan);
      span = this.tracer.startSpan(commandName, spanOptions, ctx);
    } else {
      span = this.tracer.startSpan(commandName, spanOptions);
    }

    this.activeSpans.set(`${sessionId}:${commandName}`, span);
    return span;
  }

  public endSpan(id: string, status: 'OK' | 'ERROR' = 'OK', attributes: Record<string, any> = {}) {
    if (!this.sdk) return;
    const span = this.activeSpans.get(id);
    if (!span) return;
    this.activeSpans.delete(id);
    this.sessionSpanIds.delete(id);
    if (Object.keys(attributes).length > 0) {
      span.setAttributes(attributes);
    }
    span.setStatus({
      code: status === 'OK' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
    });
    span.end();
  }

  /**
   * Ends the span a command started: ERROR with the exception when it
   * `failed`, else OK. By the span itself, not by its id: two commands of the
   * same name on one session at once (the Inspector reading the page source
   * while a test does) share `<sessionId>:<command>`, and the second's span
   * replaced the first's under it, so one command's error went on the other's
   * span and its own never ended.
   */
  public endCommandSpan(id: string, span: Span, failed?: { error: unknown }) {
    if (failed) failSpan(span, failed.error);
    else span.setStatus({ code: SpanStatusCode.OK });
    span.end();
    if (this.activeSpans.get(id) === span) this.activeSpans.delete(id);
  }

  public getTraceId(sessionId: string): string | undefined {
    return this.activeSpans.get(sessionId)?.spanContext().traceId;
  }

  public getSpanId(id: string): string | undefined {
    return this.activeSpans.get(id)?.spanContext().spanId;
  }

  /**
   * shutdown(), waiting no longer than `budgetMs`: an export to a collector
   * that doesn't answer is held for the exporter's own timeout (10 s), and a
   * process that is exiting can't wait that long.
   */
  public async shutdownWithin(budgetMs: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.shutdown(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, budgetMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Stops every exporter, once what each still holds is sent. A session span
   * still open belongs to a session this process didn't end: one running on a
   * node or at a cloud provider, which a hub's shutdown leaves running, or one
   * whose ending was missed. It ends here, saying so, or it is never exported.
   */
  public async shutdown(): Promise<void> {
    for (const sessionId of [...this.sessionSpanIds]) {
      const span = this.activeSpans.get(sessionId);
      this.activeSpans.delete(sessionId);
      span?.setAttribute(SESSION_STOP_REASON, 'Xenon shut down while the session was running');
      span?.end();
    }
    this.sessionSpanIds.clear();
    // A span processor's shutdown doesn't wait for the exports it started,
    // and with the NodeSDK's resource detection every export waits on it.
    await Promise.allSettled(this.spanProcessorsInUse.map((p) => p.forceFlush()));
    this.spanProcessorsInUse = [];

    XenonLogger.setOtlpReady(false);
    const stopping = [this.sdk, this.loggerProvider, this.meterProvider].map((owner) =>
      owner?.shutdown(),
    );
    this.sdk = null;
    this.loggerProvider = null;
    this.meterProvider = null;
    this.logsOn = false;
    this.metricsOn = false;
    this.activeSpans.clear();
    await Promise.allSettled(stopping);
  }
}
