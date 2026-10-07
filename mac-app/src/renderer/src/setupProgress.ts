import type { SetupProgress, SetupResult } from '@shared/types';
import { GO_IOS_SKIP_NOTE, GO_IOS_STEP } from '@shared/setupNotes';

// Pure helpers behind the setup rows on Setup and the toast that ends
// a run, kept out of the components so they are unit-testable.

/**
 * One row per step. Main emits a step twice, once when it starts and once when
 * it ends; the latest event replaces the earlier row in place, so order is
 * first appearance and a step never shows up twice.
 */
export function mergeProgress(rows: SetupProgress[], p: SetupProgress): SetupProgress[] {
  const i = rows.findIndex((r) => r.step === p.step);
  if (i === -1) return [...rows, p];
  return rows.map((r, j) => (j === i ? p : r));
}

const STEP_LABELS: Record<string, string> = {
  'locate-appium': 'Finding Appium',
  'plugin-source': 'Choosing where to get Xenon',
  'uninstall-plugin': 'Removing the old Xenon',
  'install-plugin': 'Installing Xenon',
  'update-plugin': 'Updating Xenon',
  'install-driver:uiautomator2': 'Installing Android support',
  'install-driver:xcuitest': 'Installing iOS support',
  'install-go-ios': 'Installing real-iPhone support',
  'verify-plugin': 'Checking the install'
};

/** Plain-words name for a setup step id; an id this build does not know is returned as is. */
export function stepLabel(step: string): string {
  return STEP_LABELS[step] ?? step;
}

/** How a setup row is drawn: still going, done, done with a warning, or failed. */
export type RowState = 'running' | 'ok' | 'note' | 'failed';

/**
 * Main reports "skipped because the installed Xenon can't set up iPhones" as a
 * finished, ok go-ios step whose detail is the skip note. That is not a success,
 * so it gets its own state instead of a tick.
 */
function isIphoneSkip(p: SetupProgress): boolean {
  return p.done && p.ok && p.step === GO_IOS_STEP && p.detail === GO_IOS_SKIP_NOTE;
}

export function rowState(p: SetupProgress): RowState {
  if (!p.done) return 'running';
  if (!p.ok) return 'failed';
  return isIphoneSkip(p) ? 'note' : 'ok';
}

/**
 * The second line under a row, or null for none. A failed row shows its raw
 * detail (the error). A note row shows the note, which is already plain words.
 * A running row's detail is the raw command line and an ok row's is noise, so
 * neither is shown.
 */
export function rowDetail(p: SetupProgress): string | null {
  const state = rowState(p);
  if (state === 'failed' || state === 'note') return p.detail || null;
  return null;
}

/** True when the run skipped iPhone setup (the installed Xenon has no go-ios installer). */
export function iphoneSetupSkipped(rows: SetupProgress[]): boolean {
  return rows.some(isIphoneSkip);
}

/**
 * The toast that ends a setup run. A run that "succeeded" but skipped iPhone
 * setup must not claim it finished; pass `iphoneSkipped` from the final rows.
 */
export function setupSummary(
  r: SetupResult,
  opts: { iphoneSkipped?: boolean } = {}
): { message: string; kind: 'success' | 'error' } {
  if (r.ok && opts.iphoneSkipped) {
    return {
      message: 'Setup finished, but iPhones still need attention. See the steps on Setup.',
      kind: 'error'
    };
  }
  if (r.ok) return { message: 'Setup finished', kind: 'success' };
  const what = r.failedStep ? `${stepLabel(r.failedStep)} failed.` : 'Something failed.';
  return {
    message: `Setup didn't finish: ${what} See the steps on Setup.`,
    kind: 'error'
  };
}

/** The toast for a run whose request itself failed, so there is no result to summarise. */
export const SETUP_INTERRUPTED = {
  message: "Setup didn't finish. See the steps on Setup.",
  kind: 'error'
} as const;
