import type { PreflightResult } from '@shared/types';
import { blockedReason, type StartDecision } from './readiness';
import { runtimeSentence } from './setupRows';

/**
 * Why Start is off, as the sidebar says it under Start (R24). It is Part A's
 * reason (blockedReason), except for a Node.js or Appium that is in the way:
 * Part A gives that check's own fix, which names commands ("npm i -g appium"),
 * so with technical details off the sidebar says the plain sentence Home and
 * Setup say instead. With technical details on, the check's own words stay.
 *
 * The check is the one whose fix is the reason given, in `readiness`, the
 * answer the decision was made from; a reason no runtime check gives is left
 * as it is. readiness.ts is unchanged: this only rewords what it decided.
 */
export function sidebarBlockedReason(
  decision: StartDecision,
  readiness: PreflightResult | null,
  technicalDetails: boolean
): string | null {
  const reason = blockedReason(decision);
  if (technicalDetails || decision.ok || decision.kind !== 'not-ready' || readiness === null) return reason;
  // Part A's firstBlocker: a blocker main words itself comes first, and is plain already.
  if (readiness.blockers.length > 0) return reason;
  const check = readiness.checks.find((c) => c.blocking && c.status !== 'ok');
  if (check === undefined || (check.remediation ?? check.detail) !== decision.reason) return reason;
  return runtimeSentence(check) ?? reason;
}
