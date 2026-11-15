import { Container } from 'typedi';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import log from '../logger';
import { TracingService } from '../services/TracingService';
import { EventLogService } from '../services/EventLogService';
import { admit } from '../middleware/rateLimitMiddleware';
import type { McpCaller } from './mcpCredential';
import type { ApiAnswer } from './invokeApi';
import { ToolRefusal } from './toolRefusal';

const logger = log.scope('McpToolCall');

export { ToolRefusal };

/**
 * The body of a REST answer that worked; a ToolRefusal with REST's own
 * `error` and `message` for one that didn't, so a hidden phone or session
 * reads to an agent exactly as it does on REST.
 */
export function answerOf(answer: ApiAnswer): any {
  if (answer.status < 400) return answer.body;
  const body = answer.body && typeof answer.body === 'object' ? answer.body : {};
  const error = body.error ?? `http_${answer.status}`;
  const message =
    typeof body.message === 'string'
      ? body.message
      : typeof body.error === 'string'
        ? body.error
        : typeof answer.body === 'string' && answer.body
          ? answer.body
          : `Failed with status ${answer.status}.`;
  throw new ToolRefusal(error, message, answer.status);
}

type Outcome = 'ok' | 'refused' | 'failed' | 'rate_limited';

function toolError(error: unknown, message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error, message }) }] };
}

/**
 * Runs one tool call for `caller`: within the caller's per-user tool budget
 * (the REST rate limiter's buckets, keyed `mcp:<userId>`, sized by the
 * caller's own per-minute limit), inside a span, and logged once in the event
 * log as `{ userId, tool, outcome, durationMs }`. No arguments and no answer
 * go to either: an argument can be typed text, an answer a screen's contents.
 *
 * The answer is the tool's result as JSON text. A ToolRefusal is a tool error
 * with REST's `error` and message; anything else that throws is a tool error
 * `internal`, its details only in the log. Never a protocol error.
 */
export async function runTool(
  name: string,
  caller: McpCaller,
  fn: () => Promise<unknown>,
): Promise<CallToolResult> {
  const { userId } = caller.auth;
  const started = Date.now();
  const tracing = Container.get(TracingService);
  const span = tracing.startToolSpan(name, userId);

  let outcome: Outcome = 'ok';
  let failure: unknown;
  let result: CallToolResult;
  try {
    const admission = admit(`mcp:${userId}`, caller.auth.rateLimit, 'control', false);
    if (!admission.admitted) {
      outcome = 'rate_limited';
      failure = new Error('rate limit exceeded');
      result = toolError(
        'rate limit exceeded',
        `Too many tool calls. Try again in ${admission.retryAfter} s.`,
      );
    } else {
      const answer = await fn();
      result = { content: [{ type: 'text', text: JSON.stringify(answer ?? null) }] };
    }
  } catch (err) {
    failure = err;
    if (err instanceof ToolRefusal) {
      outcome = err.status >= 500 ? 'failed' : 'refused';
      result = toolError(err.error, err.message);
    } else {
      outcome = 'failed';
      logger.error(`MCP tool ${name} failed: ${(err as Error)?.stack ?? err}`);
      result = toolError('internal', 'The tool failed. The lab log has the details.');
    }
  }

  const durationMs = Date.now() - started;
  tracing.endToolSpan(span, outcome, outcome === 'ok' ? undefined : failure);
  Container.get(EventLogService).appendSafe({
    type: 'mcp_tool_call',
    payload: { userId, tool: name, outcome, durationMs },
  });
  return result;
}
