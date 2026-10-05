/**
 * What a hub makes of a node's answer at one of the routes it asks about a
 * session the node runs: the session's CPU and memory
 * (services/metrics/nodeMetrics.ts) and its device log lines
 * (services/logcat/nodeDeviceLogs.ts). Each route puts its own header on every
 * answer, so a hub can tell a node that has the route from an older one.
 */
export type NodeReply<T> =
  | { kind: 'answer'; answer: T }
  /** An older node, without the route. */
  | { kind: 'unsupported'; status: number }
  /** The node refused the hub's token: the session is gone, or isn't the hub's. */
  | { kind: 'refused' }
  /** Unreachable, timed out, or couldn't check the token (503): ask again. */
  | { kind: 'unavailable'; reason: string };

/**
 * The node's answer at a route whose answers carry `header`. `answerOf` reads
 * a 200's `value`, or returns null when it isn't one.
 */
export function readNodeReply<T>(
  header: string,
  status: number,
  headers: Record<string, unknown>,
  data: any,
  answerOf: (value: any) => T | null,
): NodeReply<T> {
  if (!headers?.[header]) {
    // An older node answers its login's 401, an unknown route's 404, or a
    // catch-all's 2xx. Anything else without the header (a proxy's 502 in
    // front of a node) is an outage: ask again, never give the node up.
    if (status === 401 || status === 404 || (status >= 200 && status < 300)) {
      return { kind: 'unsupported', status };
    }
    return { kind: 'unavailable', reason: `answered ${status}` };
  }
  if (status === 404) return { kind: 'refused' };
  const answer = status === 200 ? answerOf(data?.value) : null;
  if (answer !== null) return { kind: 'answer', answer };
  return { kind: 'unavailable', reason: `answered ${status}` };
}

/** How long a hub leaves a node without a route alone before asking it again. */
export const OLDER_NODE_RECHECK_MS = 10 * 60_000;

/**
 * Hub side: which nodes lack a route (an older Xenon). Their sessions go
 * without what the route serves; the hub says so once per node, and asks
 * again after OLDER_NODE_RECHECK_MS, so a node upgraded in place is picked
 * up without restarting the hub.
 */
export abstract class OlderNodes {
  abstract logger: { warn(message: string): void };
  now: () => number = () => Date.now();
  private readonly unsupportedUntil = new Map<string, number>();
  private readonly warned = new Set<string>();

  /** What the hub logs, once, for a node without the route. */
  protected abstract warning(origin: string, status: number): string;

  shouldAsk(origin: string): boolean {
    const until = this.unsupportedUntil.get(origin);
    if (until === undefined) return true;
    if (until > this.now()) return false;
    this.unsupportedUntil.delete(origin);
    return true;
  }

  unsupported(origin: string, status: number): void {
    this.unsupportedUntil.set(origin, this.now() + OLDER_NODE_RECHECK_MS);
    if (this.warned.has(origin)) return;
    this.warned.add(origin);
    this.logger.warn(this.warning(origin, status));
  }
}
