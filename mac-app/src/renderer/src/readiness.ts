import type { PreflightResult, Profile, ServerStatus, ValidationIssue } from '@shared/types';

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

/** Every reason a failed check gives, one line each: the blockers, then each blocking check with its fix. */
export function blockerLines(r: PreflightResult): string[] {
  const lines = [
    ...r.blockers,
    ...r.checks.filter((c) => c.blocking && c.status !== 'ok').map((c) => `${c.label}: ${c.remediation ?? c.detail}`)
  ];
  return lines.length > 0 ? lines : [firstBlocker(r)];
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

/** Stands in for a check whose request itself failed, so "Checking…" never sticks. */
export const CHECK_FAILED: PreflightResult = {
  ok: false,
  checks: [],
  blockers: ["Couldn't check whether this Mac is ready. Press Re-check on the Health tab."]
};

export interface CheckRun {
  tracker: ReadinessTracker;
  profile: Profile;
  preflight: (p: Profile) => Promise<PreflightResult>;
  /** A check has begun. `last` is what was last learned about the profile, which stays on screen meanwhile. */
  onBegin: (profileId: string, last: PreflightResult | null) => void;
  /** The newest check for the profile finished while the profile was still on screen. */
  onApply: (profileId: string, result: PreflightResult) => void;
  /** Whether the profile is the one on screen right now. */
  isShown: (profileId: string) => boolean;
}

/**
 * Run one check. Only the newest check for a profile may show its answer, and
 * only while that profile is still on screen; a slow answer for an older
 * check or another profile is kept in the tracker, not shown. The caller
 * always gets the answer to the check it asked for.
 */
export async function runCheck(i: CheckRun): Promise<PreflightResult> {
  const id = i.profile.id;
  const token = i.tracker.begin(id);
  i.onBegin(id, i.tracker.get(id));
  let result: PreflightResult;
  try {
    result = await i.preflight(i.profile);
  } catch {
    result = CHECK_FAILED;
  }
  if (i.tracker.complete(id, token, result) && i.isShown(id)) i.onApply(id, result);
  return result;
}

/** Each bump says "something Start depends on may have changed". */
export interface ReadinessTicks {
  focus: number;
  setup: number;
  recheck: number;
  serverStopped: number;
}

/** Everything a re-check depends on; a change to any field is a reason to look again. */
export interface RecheckKey extends ReadinessTicks {
  profileId: string | null;
  port: number | null;
  appiumHome: string | null;
}

export function recheckKey(profile: Profile | null, ticks: ReadinessTicks): RecheckKey {
  return {
    profileId: profile?.id ?? null,
    port: profile?.server.port ?? null,
    appiumHome: profile?.server.appiumHome ?? null,
    ...ticks
  };
}

export type RecheckPlan = 'none' | 'now' | 'later';

/**
 * A different profile is checked at once, since nothing is known about it yet.
 * Edits and ticks wait out the debounce, because they come in bursts.
 */
export function planRecheck(prev: RecheckKey | null, next: RecheckKey): RecheckPlan {
  if (next.profileId === null) return 'none';
  if (prev === null || prev.profileId !== next.profileId) return 'now';
  const changed = (Object.keys(next) as (keyof RecheckKey)[]).some((k) => prev[k] !== next[k]);
  return changed ? 'later' : 'none';
}

/** What a failed start says: Electron's "Error invoking remote method" prefix is plumbing, not news. */
export function startFailureMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const message = raw.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '').trim();
  return message || "Couldn't start the server.";
}
