import http from 'http';
import type { AddressInfo } from 'net';
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';

export interface OtlpRequest {
  path: string;
  contentType: string;
  body: Buffer;
  /** The body, parsed, when it was sent as OTLP/JSON. */
  json?: any;
}

/** One span as an OTLP/JSON export carries it. */
export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  status?: { code?: number; message?: string };
  events?: Array<{ name: string; attributes?: OtlpAttribute[] }>;
  attributes?: OtlpAttribute[];
}

interface OtlpAttribute {
  key: string;
  value: Record<string, unknown>;
}

export interface OtlpProbe {
  /** A URL on the probe, for an OTEL_EXPORTER_OTLP_*_ENDPOINT. */
  url(path: string): string;
  requests: OtlpRequest[];
  /** Every span in the OTLP/JSON trace exports the probe received. */
  spans(): OtlpSpan[];
  close(): Promise<void>;
}

/**
 * A stand-in OTLP/HTTP collector on 127.0.0.1. It answers every request 200
 * and keeps what it was sent, so a spec can see where Xenon's telemetry went
 * and in which encoding (Xenon's own exporters send OTLP/JSON; the ones the
 * OTel SDK builds from OTEL_* variables send protobuf).
 */
export async function startOtlpProbe(): Promise<OtlpProbe> {
  const requests: OtlpRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const contentType = String(req.headers['content-type'] ?? '');
      let json: any;
      if (contentType.includes('json')) {
        try {
          json = JSON.parse(body.toString('utf8'));
        } catch {
          json = undefined;
        }
      }
      requests.push({ path: req.url ?? '', contentType, body, json });
      if (contentType.includes('json')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      } else {
        res.writeHead(200, { 'content-type': 'application/x-protobuf' });
        res.end();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: (path: string) => `http://127.0.0.1:${port}${path}`,
    requests,
    spans: () =>
      requests.flatMap((r) =>
        (r.json?.resourceSpans ?? []).flatMap((rs: any) =>
          (rs.scopeSpans ?? []).flatMap((ss: any) => (ss.spans ?? []) as OtlpSpan[]),
        ),
      ),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

/** A span attribute's value, whatever its OTLP/JSON type. */
export function attributeOf(
  attributes: OtlpAttribute[] | undefined,
  key: string,
): unknown | undefined {
  const found = attributes?.find((a) => a.key === key);
  if (!found) return undefined;
  return Object.values(found.value)[0];
}

/**
 * Takes every OTel global (tracer, meter and logger providers, context
 * manager, propagator) off the API, so the next registration wins. The API
 * keeps the first registration for the life of the process and refuses the
 * rest: a spec that leaves one behind decides what every later spec exports.
 */
export function resetOtelGlobals(): void {
  trace.disable();
  metrics.disable();
  logs.disable();
  context.disable();
  propagation.disable();
}

/** Exports whatever the registered meter and logger providers hold now. */
export async function flushOtelGlobals(): Promise<void> {
  const meterProvider = metrics.getMeterProvider() as { forceFlush?: () => Promise<void> };
  await meterProvider.forceFlush?.();
  const loggerProvider = logs.getLoggerProvider() as { forceFlush?: () => Promise<void> };
  await loggerProvider.forceFlush?.();
}
