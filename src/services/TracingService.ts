import { trace, Span, SpanStatusCode, context, SpanKind } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Service } from 'typedi';
import log from '../logger';

@Service()
export class TracingService {
  private sdk: NodeSDK | null = null;
  private tracer = trace.getTracer('xenon-core');
  private activeSpans: Map<string, Span> = new Map();

  public initialize() {
    const exporters = [];

    // Always add console exporter for debugging if enabled via env or log level
    if (process.env.XENON_OTEL_DEBUG === 'true') {
      exporters.push(new ConsoleSpanExporter());
    }

    // Add OTLP exporter if endpoint is provided
    if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      exporters.push(
        new OTLPTraceExporter({
          url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        }),
      );
    }

    if (exporters.length === 0) {
      log.info(
        '[TracingService] No OTel exporters configured. Spans will be recorded in memory only.',
      );
    }

    if (exporters.length > 0) {
      this.sdk = new NodeSDK({
        serviceName: 'xenon',
        spanProcessor: new SimpleSpanProcessor(exporters[0] as any),
      });

      try {
        this.sdk.start();
        log.info('[TracingService] OpenTelemetry SDK started');
      } catch (err: any) {
        log.error(`[TracingService] Failed to start OTel SDK: ${err.message}`);
      }
    } else {
      log.info('[TracingService] No OTel exporters enabled.');
    }
  }

  public startSessionSpan(
    sessionId: string,
    name: string,
    attributes: Record<string, any> = {},
  ): Span {
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
  ): Span {
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
  }
}
