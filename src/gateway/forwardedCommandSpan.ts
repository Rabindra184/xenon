import type { OutgoingHttpHeaders } from 'http';
import { ROOT_CONTEXT, Span, TextMapSetter, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import type { TracingService } from '../services/TracingService';
import { TRACEPARENT, TRACESTATE, currentInboundTrace } from '../services/tracing/inboundTrace';
import type { HealReport } from './healReport';

/**
 * A span for a command a hub forwards to another server (ENH-04).
 *
 * A session on a node's phone (or a cloud provider's) runs its commands
 * there, so CommandInterceptor, which makes a command's span on the server
 * that drives the phone, never sees them on the hub, and a node exports no
 * telemetry. The hub makes the span instead, around the forward: under the
 * command's own W3C context when it was sent one (linked to the session),
 * else under the session's span, as CommandInterceptor does. The node is
 * sent that span as the command's `traceparent`, so anything it traces
 * nests under it.
 *
 * Its duration is the forward's (the node's work and the hop to it). It keeps
 * no arguments: the node has them, and the command's answer is the node's.
 */

/** What the forward needs of TracingService. */
export type ForwardTracing = Pick<
  TracingService,
  'startCommandSpan' | 'endCommandSpan' | 'getTraceId'
>;

/** How the forward ended. */
export type ForwardOutcome =
  | { status: number; body?: string; heal?: HealReport }
  | { unreachable: string }
  | { aborted: true };

export interface ForwardedSpan {
  /** The command's trace and span ids, for its record and logs (sessionContext). */
  ids: { traceId?: string; spanId?: string };
  /** Put the span's context on the node's request, where it replaces the client's. */
  propagate(headers: OutgoingHttpHeaders): void;
  /** Whether the forward should read an answer with this status, to describe an error. */
  wantsBody(status: number): boolean;
  finish(outcome: ForwardOutcome): void;
}

const propagator = new W3CTraceContextPropagator();
const setter: TextMapSetter<OutgoingHttpHeaders> = {
  set: (carrier, key, value) => {
    carrier[key] = value;
  },
};

/** A server's URL without its credentials or path: a cloud provider's carries a key. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return 'unknown';
  }
}

/** The WebDriver error in a node's answer, when it is one. */
function webDriverError(body: string | undefined): { error: string; message?: string } | undefined {
  if (!body) return undefined;
  try {
    const value = JSON.parse(body)?.value;
    if (value && typeof value.error === 'string') {
      return {
        error: value.error,
        message: typeof value.message === 'string' && value.message ? value.message : undefined,
      };
    }
  } catch {
    // Not JSON: described by its status alone.
  }
  return undefined;
}

function healAttributes(heal: HealReport): Record<string, string | number | boolean> {
  const attributes: Record<string, string | number | boolean> = {
    'xenon.healed': true,
    'xenon.heal.original_selector': heal.originalSelector,
    'xenon.heal.healed_selector': heal.healedSelector,
    'xenon.heal.confidence': heal.confidence,
  };
  if (heal.originalStrategy) attributes['xenon.heal.original_strategy'] = heal.originalStrategy;
  if (heal.healedStrategy) attributes['xenon.heal.healed_strategy'] = heal.healedStrategy;
  if (heal.tier !== undefined) attributes['xenon.heal.tier'] = heal.tier;
  return attributes;
}

/** Starts the span of a command `sessionId` sends to the server at `url`. */
export function startForwardedSpan(
  tracing: ForwardTracing,
  sessionId: string,
  command: string,
  url: string,
): ForwardedSpan {
  const inbound = currentInboundTrace();
  const span: Span | undefined = tracing.startCommandSpan(
    sessionId,
    command,
    { 'xenon.forwarded_to': originOf(url) },
    inbound,
  );
  // A span the test's sampling left unrecorded is never exported, so it has
  // no id worth recording or sending on: the node gets the test's header.
  const recorded = span?.isRecording() ? span : undefined;
  const ids = {
    traceId: span?.spanContext().traceId ?? inbound?.traceId ?? tracing.getTraceId(sessionId),
    spanId: recorded?.spanContext().spanId,
  };
  let finished = false;

  return {
    ids,
    propagate(headers) {
      if (!recorded) return;
      delete headers[TRACEPARENT];
      delete headers[TRACESTATE];
      propagator.inject(trace.setSpan(ROOT_CONTEXT, recorded), headers, setter);
    },
    wantsBody: (status) => !!span && status >= 400,
    finish(outcome) {
      if (!span || finished) return;
      finished = true;
      const id = `${sessionId}:${command}`;
      if ('aborted' in outcome) {
        tracing.endCommandSpan(id, span, {
          error: new Error('The client closed the connection before the command was answered'),
        });
        return;
      }
      if ('unreachable' in outcome) {
        tracing.endCommandSpan(id, span, {
          error: new Error(`Could not reach the node: ${outcome.unreachable}`),
        });
        return;
      }
      span.setAttribute('http.response.status_code', outcome.status);
      if (outcome.heal) span.setAttributes(healAttributes(outcome.heal));
      if (outcome.status < 400) {
        tracing.endCommandSpan(id, span);
        return;
      }
      const error = webDriverError(outcome.body);
      if (error) span.setAttribute('xenon.webdriver.error', error.error);
      tracing.endCommandSpan(id, span, {
        error: new Error(
          error?.message ?? error?.error ?? `The node answered HTTP ${outcome.status}`,
        ),
      });
    },
  };
}
