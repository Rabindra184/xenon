import { trace, metrics, Span, SpanStatusCode, context, SpanKind, Meter } from '@opentelemetry/api';
import { logs, Logger } from '@opentelemetry/api-logs';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  LoggerProvider,
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  ConsoleMetricExporter,
} from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { Service } from 'typedi';
import log, { XenonLogger } from '../logger';

export interface TracingInitOptions {
  // True when this process is acting as a Xenon hub; false when it is a node
  // pointing at a remote hub. Surfaces as a `service` resource attribute so
  // dashboards can split hub vs. node traffic.
  isHub: boolean;
}

@Service()
export class TracingService {
  private sdk: NodeSDK | null = null;
  private loggerProvider: LoggerProvider | null = null;
  private meterProvider: MeterProvider | null = null;
  private tracer = trace.getTracer('xenon-core');
  private activeSpans: Map<string, Span> = new Map();

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

    this.initTraces(resource);
    this.initLogs(resource);
    this.initMetrics(resource);
  }

  private initTraces(resource: ReturnType<typeof resourceFromAttributes>) {
    if (process.env.OTEL_TRACES_ENABLED === 'false') {
      log.info('[TracingService] OTEL_TRACES_ENABLED=false — trace export disabled.');
      return;
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
      return;
    }

    // Pre-existing pre-PR-86 bug: only exporters[0] was wired, so combining
    // XENON_OTEL_DEBUG=true with an OTLP endpoint silently dropped one of the
    // two destinations. Each exporter now gets its own SimpleSpanProcessor.
    const spanProcessors = exporters.map((e) => new SimpleSpanProcessor(e as any));
    this.sdk = new NodeSDK({
      resource,
      spanProcessors,
    });

    try {
      this.sdk.start();
      log.info('[TracingService] Trace SDK started.');
    } catch (err: any) {
      log.error(`[TracingService] Failed to start trace SDK: ${err.message}`);
    }
  }

  private initLogs(resource: ReturnType<typeof resourceFromAttributes>) {
    if (process.env.OTEL_LOGS_ENABLED === 'false') {
      log.info('[TracingService] OTEL_LOGS_ENABLED=false — log export disabled.');
      return;
    }

    const endpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
    if (!endpoint) return;

    const processors = [];
    if (process.env.XENON_OTEL_DEBUG === 'true') {
      processors.push(new SimpleLogRecordProcessor(new ConsoleLogRecordExporter()));
    }
    processors.push(new BatchLogRecordProcessor(new OTLPLogExporter({ url: endpoint })));

    const provider = new LoggerProvider({ resource, processors });
    logs.setGlobalLoggerProvider(provider);
    this.loggerProvider = provider;
    XenonLogger.setOtlpReady(true);
    log.info(`[TracingService] Log OTLP endpoint: ${endpoint}. Log SDK started.`);
  }

  private initMetrics(resource: ReturnType<typeof resourceFromAttributes>) {
    if (process.env.OTEL_METRICS_ENABLED === 'false') {
      log.info('[TracingService] OTEL_METRICS_ENABLED=false — metrics export disabled.');
      return;
    }

    const endpoint = process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
    const debug = process.env.XENON_OTEL_DEBUG === 'true';
    if (!endpoint && !debug) return;

    const readers = [];
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

    const provider = new MeterProvider({ resource, readers });
    metrics.setGlobalMeterProvider(provider);
    this.meterProvider = provider;
    log.info(
      `[TracingService] Metric OTLP endpoint: ${endpoint ?? '(console-only)'}. Metrics SDK started.`,
    );
  }

  public getLogger(name = 'xenon-core'): Logger | undefined {
    if (!this.loggerProvider) return undefined;
    return logs.getLogger(name);
  }

  public getMeter(name = 'xenon-core'): Meter | undefined {
    if (!this.meterProvider) return undefined;
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
    return span;
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
    if (span) {
      if (Object.keys(attributes).length > 0) {
        span.setAttributes(attributes);
      }

      span.setStatus({
        code: status === 'OK' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
      });

      span.end();
      this.activeSpans.delete(id);
    }
  }

  public recordError(id: string, error: Error | string) {
    if (!this.sdk) return;
    const span = this.activeSpans.get(id);
    if (span) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: typeof error === 'string' ? error : error.message,
      });
    }
  }

  public getTraceId(sessionId: string): string | undefined {
    return this.activeSpans.get(sessionId)?.spanContext().traceId;
  }

  public getSpanId(id: string): string | undefined {
    return this.activeSpans.get(id)?.spanContext().spanId;
  }

  public shutdown() {
    this.sdk?.shutdown();
    XenonLogger.setOtlpReady(false);
    this.loggerProvider?.shutdown();
    this.meterProvider?.shutdown();
  }
}
