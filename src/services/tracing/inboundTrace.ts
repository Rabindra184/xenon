import { AsyncLocalStorage } from 'async_hooks';
import type { IncomingHttpHeaders } from 'http';
import {
  ROOT_CONTEXT,
  SpanContext,
  TextMapGetter,
  isSpanContextValid,
  trace,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

/**
 * A test's W3C trace context (`traceparent`, `tracestate`), sent with a
 * session create or with one command, so Xenon's spans and its command log
 * join the test's trace (ENH-03).
 *
 * It is read with OpenTelemetry's own W3C propagator, so the spec's rules
 * hold: version `ff`, an all-zero trace or parent id, or anything malformed
 * is no context at all; a later version is read by its first fields; a
 * `tracestate` over 512 characters is dropped. A context that can't be read
 * never refuses the request.
 */

export const TRACEPARENT = 'traceparent';
export const TRACESTATE = 'tracestate';

/** What a request said about its trace. */
export interface InboundTraceRead {
  /** The context it carried, when it carried one that can be read. */
  context?: SpanContext;
  /** It sent a `traceparent` that couldn't be read. */
  malformed: boolean;
}

const propagator = new W3CTraceContextPropagator();

interface Carrier {
  traceparent: string;
  tracestate?: string;
}

const getter: TextMapGetter<Carrier> = {
  keys: (carrier) => Object.keys(carrier),
  get: (carrier, key) => (key === TRACEPARENT || key === TRACESTATE ? carrier[key] : undefined),
};

/**
 * The context in a `traceparent` and `tracestate`, as the strings a header or
 * a capability gives. Several `traceparent` values (the header sent twice)
 * say nothing certain, so they are no context; several `tracestate` values
 * are one list, as the spec reads them.
 */
export function readTraceContext(traceparent: unknown, tracestate?: unknown): InboundTraceRead {
  if (traceparent === undefined || traceparent === null) return { malformed: false };
  const parent =
    Array.isArray(traceparent) && traceparent.length === 1 ? traceparent[0] : traceparent;
  if (typeof parent !== 'string') return { malformed: true };
  const carrier: Carrier = { traceparent: parent.trim() };
  const state = Array.isArray(tracestate) ? tracestate.join(',') : tracestate;
  if (typeof state === 'string' && state.length > 0) carrier.tracestate = state;

  const context = trace.getSpanContext(propagator.extract(ROOT_CONTEXT, carrier, getter));
  if (!context || !isSpanContextValid(context)) return { malformed: true };
  return { context, malformed: false };
}

/** The context in a request's headers. */
export function readTraceHeaders(headers: IncomingHttpHeaders | undefined): InboundTraceRead {
  return readTraceContext(headers?.[TRACEPARENT], headers?.[TRACESTATE]);
}

/**
 * The context of the request being run. The session gateway sees every
 * request under `<basePath>/session` and runs the rest of it inside this
 * context (`runWithInboundTrace`), as it does for the sensitive marker: the
 * plugin's `handle`, deep inside Appium's route, is never given the request.
 *
 * A request without a context runs with none, never with one it would inherit.
 * Like any AsyncLocalStorage it also holds in what the request starts and
 * runs later, so read it only where a create or a command enters Xenon.
 */
const inbound = new AsyncLocalStorage<InboundTraceRead>();

/** Runs `next` with the trace context of `headers` (or none) as its context. */
export function runWithInboundTrace<R>(headers: IncomingHttpHeaders | undefined, next: () => R): R {
  return inbound.run(readTraceHeaders(headers), next);
}

/** The trace context the request being run was sent with, if any. */
export function currentInboundTrace(): SpanContext | undefined {
  return inbound.getStore()?.context;
}

/** Whether the request being run sent a `traceparent` that couldn't be read. */
export function currentTraceMalformed(): boolean {
  return inbound.getStore()?.malformed === true;
}

/** The `xe:options` fields a session create may carry its trace context in. */
export const TRACEPARENT_OPTION = 'traceparent';
export const TRACESTATE_OPTION = 'tracestate';

/**
 * The trace a session joins: `xe:options.traceparent` (and `tracestate`)
 * when it can be read, else the create request's headers. The capability
 * wins when both are sent: it is the test's own choice, where the header may
 * be an instrumented HTTP client's span. `problem` names a value sent that
 * couldn't be read, for the caller to log.
 */
export function sessionTraceParent(options: Record<string, unknown>): {
  context?: SpanContext;
  problem?: string;
} {
  const fromCaps = readTraceContext(options[TRACEPARENT_OPTION], options[TRACESTATE_OPTION]);
  if (fromCaps.context) return { context: fromCaps.context };
  const context = currentInboundTrace();
  const problems: string[] = [];
  if (fromCaps.malformed) problems.push(`xe:options.${TRACEPARENT_OPTION}`);
  if (currentTraceMalformed()) problems.push(`the ${TRACEPARENT} header`);
  return {
    ...(context ? { context } : {}),
    ...(problems.length > 0 ? { problem: problems.join(' and ') } : {}),
  };
}
