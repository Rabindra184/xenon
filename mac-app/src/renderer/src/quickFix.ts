import type { PreflightResult, ValidationIssue } from '@shared/types';
import { NOT_INSTALLED_MESSAGE, portInUseMessage } from '@shared/preflightMessages';
import { HOME } from './copy/home';
import type { Place } from './navigation';
import { firstBlocker } from './readiness';

// What stops a start, as one kind of problem, and the one button that fixes it.
// Home's "Can't start yet" shows the button; this decides which. Pure, so every
// kind is unit-tested without a window.

export type Blocker =
  | { kind: 'port-in-use'; port: number }
  | { kind: 'not-installed' }
  | { kind: 'invalid'; issue: ValidationIssue; count: number }
  | { kind: 'runtime'; check: 'node' | 'appium' }
  | { kind: 'other'; reason: string };

/**
 * The first thing in the way of a start, or null when nothing is. A setting
 * problem comes first (it is the person's to fix, and known before any check);
 * then, from the check, the port, Xenon not installed, Node.js or Appium, and
 * anything else with the reason Part A already words.
 */
export function blockerOf(readiness: PreflightResult | null, issues: ValidationIssue[], port: number): Blocker | null {
  if (issues.length > 0) return { kind: 'invalid', issue: issues[0], count: issues.length };
  if (readiness === null) return null;
  if (readiness.blockers.includes(portInUseMessage(port))) return { kind: 'port-in-use', port };
  if (readiness.blockers.includes(NOT_INSTALLED_MESSAGE)) return { kind: 'not-installed' };
  const runtime = readiness.checks.find(
    (c) => (c.id === 'node' || c.id === 'appium') && c.blocking && c.status !== 'ok'
  );
  if (runtime) return { kind: 'runtime', check: runtime.id as 'node' | 'appium' };
  if (!readiness.ok) return { kind: 'other', reason: firstBlocker(readiness) };
  return null;
}

/** What pressing a quick fix does; the screen carries it out. */
export type FixAction =
  | { kind: 'set-port'; port: number }
  | { kind: 'setup' }
  | { kind: 'focus'; path: string }
  | { kind: 'link'; link: 'install' }
  | { kind: 'go'; place: Place };

/** `freePort` is the next port nothing is listening on, or null when none was found (or it is not known yet). */
export function quickFix(b: Blocker, ctx: { freePort: number | null }): { label: string; action: FixAction } {
  switch (b.kind) {
    case 'port-in-use':
      return ctx.freePort === null
        ? { label: HOME.quickFix.seeSetup, action: { kind: 'go', place: 'setup' } }
        : { label: HOME.quickFix.usePort(ctx.freePort), action: { kind: 'set-port', port: ctx.freePort } };
    case 'not-installed':
      return { label: HOME.quickFix.setUp, action: { kind: 'setup' } };
    case 'invalid':
      return { label: HOME.quickFix.fixIt, action: { kind: 'focus', path: b.issue.path } };
    case 'runtime':
      return { label: HOME.quickFix.howToInstall, action: { kind: 'link', link: 'install' } };
    case 'other':
      return { label: HOME.quickFix.seeSetup, action: { kind: 'go', place: 'setup' } };
    default: {
      // A new kind of blocker must say what fixes it here.
      const unhandled: never = b;
      return unhandled;
    }
  }
}
