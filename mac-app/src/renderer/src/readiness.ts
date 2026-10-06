import type { PreflightResult, ServerStatus, ValidationIssue } from '@shared/types';

// Whether Start is allowed, and the plain reason when it is not. Kept out of
// the React tree so every branch is unit-testable. The tracker owns the async
// part (a slow check must never overwrite a newer one, nor another profile's).

/** Latest preflight answer per profile. Tokens are global, so a token can only ever complete its own check. */
export class ReadinessTracker {
  private seq = 0;
  private latest = new Map<string, number>();
  private results = new Map<string, PreflightResult>();
  private inFlight = new Set<string>();

  /** Start a check for a profile. Any check begun earlier for it is now stale. */
  begin(profileId: string): number {
    const token = ++this.seq;
    this.latest.set(profileId, token);
    this.inFlight.add(profileId);
    return token;
  }

  /** Store a finished check. Returns false, and stores nothing, if a newer check has begun since. */
  complete(profileId: string, token: number, result: PreflightResult): boolean {
    if (this.latest.get(profileId) !== token) return false;
    this.results.set(profileId, result);
    this.inFlight.delete(profileId);
    return true;
  }

  /** The last completed result, even while a newer check is pending. */
  get(profileId: string): PreflightResult | null {
    return this.results.get(profileId) ?? null;
  }

  pending(profileId: string): boolean {
    return this.inFlight.has(profileId);
  }
}

export type StartDecision =
  | { ok: true }
  | { ok: false; kind: 'active' }
  | { ok: false; kind: 'invalid'; issue: ValidationIssue; count: number }
  | { ok: false; kind: 'not-ready'; reason: string }
  | { ok: false; kind: 'checking' };

/** The one reason worth showing for a failed preflight: a blocker, else the first blocking check's fix. */
export function firstBlocker(r: PreflightResult): string {
  if (r.blockers.length > 0) return r.blockers[0];
  const check = r.checks.find((c) => c.blocking && c.status !== 'ok');
  if (check) return check.remediation ?? check.detail;
  return 'Not ready to start yet.';
}

export function decideStart(i: {
  status: ServerStatus;
  issues: ValidationIssue[];
  readiness: PreflightResult | null;
  checking: boolean;
}): StartDecision {
  if (i.status === 'starting' || i.status === 'running' || i.status === 'stopping') {
    return { ok: false, kind: 'active' };
  }
  if (i.issues.length > 0) {
    return { ok: false, kind: 'invalid', issue: i.issues[0], count: i.issues.length };
  }
  if (i.readiness === null && i.checking) return { ok: false, kind: 'checking' };
  if (i.readiness !== null && !i.readiness.ok) {
    return { ok: false, kind: 'not-ready', reason: firstBlocker(i.readiness) };
  }
  return { ok: true };
}

/** Why Start is off, in words, or null when there is nothing to say (startable, or already active). */
export function blockedReason(d: StartDecision): string | null {
  if (d.ok) return null;
  switch (d.kind) {
    case 'invalid':
      return `Fix ${d.count} setting${d.count === 1 ? '' : 's'} first: ${d.issue.label}`;
    case 'not-ready':
      return d.reason;
    case 'checking':
      return 'Checking…';
    default:
      return null;
  }
}
