import type { SetupProgress, SetupResult } from '@shared/types';

// Pure helpers behind the setup rows on the Health tab and the toast that ends
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

/** The toast that ends a setup run. */
export function setupSummary(r: SetupResult): { message: string; kind: 'success' | 'error' } {
  if (r.ok) return { message: 'Setup finished', kind: 'success' };
  const what = r.failedStep ? `${stepLabel(r.failedStep)} failed.` : 'Something failed.';
  return {
    message: `Setup didn't finish: ${what} See the steps on the Health tab.`,
    kind: 'error'
  };
}
