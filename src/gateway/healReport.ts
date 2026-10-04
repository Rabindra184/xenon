import { AsyncLocalStorage } from 'async_hooks';
import type { IncomingHttpHeaders, ServerResponse } from 'http';

/**
 * A heal on a node's phone, on its way back to the hub.
 *
 * A session the hub created runs its commands on the node, so the node's
 * CommandInterceptor heals its finds. The node keeps no record of such a
 * session; the hub does. So the node puts the heal on its answer to the
 * forwarded command, as the `x-xenon-heal` header, and the hub takes it off
 * before relaying the answer and records it with the command, as it records a
 * local session's heal.
 *
 * The node's session gateway runs a command that came from a hub inside
 * `runReportingHeals`, so the interceptor, deep inside Appium's route, finds
 * the answer to put it on. Anywhere else `reportHeal` does nothing, and the
 * server records the heal itself.
 */

export const HEAL_REPORT_HEADER = 'x-xenon-heal';

/**
 * A header longer than this isn't sent: the hub's HTTP parser refuses an
 * answer whose headers pass 16 KB, and a refused answer would fail the
 * command. A heal of selectors that long goes unrecorded instead.
 */
const MAX_HEADER_LENGTH = 8 * 1024;

/** What the dashboard records about a heal (event-manager.afterSessionCommand). */
export interface HealReport {
  originalSelector: string;
  originalStrategy?: string;
  healedSelector: string;
  healedStrategy?: string;
  confidence: number;
  tier?: number;
}

const answers = new AsyncLocalStorage<ServerResponse>();

/** Run the rest of a command that came from a hub with its answer at hand. */
export function runReportingHeals<R>(res: ServerResponse, fn: () => R): R {
  return answers.run(res, fn);
}

export type HealReported = 'reported' | 'too-long' | 'not-from-hub';

/**
 * Put `heal` on the answer to the hub's command this code runs for.
 * `not-from-hub` when the command didn't come from a hub (or the answer has
 * gone): the caller records the heal itself.
 */
export function reportHeal(heal: HealReport): HealReported {
  const res = answers.getStore();
  if (!res || res.headersSent) return 'not-from-hub';
  const encoded = Buffer.from(JSON.stringify(heal), 'utf8').toString('base64url');
  if (encoded.length > MAX_HEADER_LENGTH) return 'too-long';
  res.setHeader(HEAL_REPORT_HEADER, encoded);
  return 'reported';
}

/**
 * The heal a node put on its answer, taken off the headers so it isn't
 * relayed to the client. Undefined when there is none, or it isn't one.
 */
export function takeHealReport(headers: IncomingHttpHeaders): HealReport | undefined {
  const raw = headers[HEAL_REPORT_HEADER];
  delete headers[HEAL_REPORT_HEADER];
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const heal = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      !heal ||
      typeof heal.originalSelector !== 'string' ||
      typeof heal.healedSelector !== 'string' ||
      typeof heal.confidence !== 'number'
    ) {
      return undefined;
    }
    const optional = (v: unknown) => (typeof v === 'string' ? v : undefined);
    return {
      originalSelector: heal.originalSelector,
      originalStrategy: optional(heal.originalStrategy),
      healedSelector: heal.healedSelector,
      healedStrategy: optional(heal.healedStrategy),
      confidence: heal.confidence,
      tier: typeof heal.tier === 'number' ? heal.tier : undefined,
    };
  } catch {
    return undefined;
  }
}
