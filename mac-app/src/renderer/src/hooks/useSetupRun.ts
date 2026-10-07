import { useCallback, useEffect, useRef, useState } from 'react';
import type { Profile, SetupProgress } from '@shared/types';
import { SETUP_INTERRUPTED, iphoneSetupSkipped, mergeProgress, setupSummary } from '../setupProgress';
import { toast } from '../components/ui/toastStore';

export interface SetupRun {
  /** Set up is running, as last drawn. */
  installing: boolean;
  /**
   * Set up is running, right now. For code that runs after an await (a start
   * looks again once its check is back), where `installing` from the render
   * it closed over may be old: this is written the moment a run begins and ends.
   */
  isInstalling(): boolean;
  /** The rows of the current or last run, one per step. */
  progress: SetupProgress[];
  /** Bumped each time a run ends, so the checks look again at what it changed. */
  runs: number;
  /** Runs Set up for the open profile. */
  run(): Promise<void>;
}

/**
 * Set up: running it for the open profile, its live progress, and how many
 * runs have ended. The progress lives here, not in a screen, so the rows
 * survive moving between places mid-run. `afterRun` runs once a run has ended
 * well enough to summarise, so what the run changed can be read again.
 */
export function useSetupRun(draft: Profile | null, afterRun: () => Promise<void>): SetupRun {
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<SetupProgress[]>([]);
  // The latest rows, so the end of a run can read the final ones without waiting on a render.
  const progressRef = useRef<SetupProgress[]>([]);
  const [runs, setRuns] = useState(0);
  // Written before the run's first await and in its finally, so it never waits on a render.
  const installingNow = useRef(false);

  // Live setup progress from the main process. A step reports when it starts and
  // again when it ends; merging keeps it to one row per step.
  useEffect(
    () =>
      window.xenon.onSetupProgress((p) => {
        progressRef.current = mergeProgress(progressRef.current, p);
        setProgress(progressRef.current);
      }),
    []
  );

  const run = async () => {
    // A run under way is not started again: two presses before the first is drawn (Home's button
    // goes with its state, Setup's turns off) would start two runs on the same Appium folder.
    if (!draft || installingNow.current) return;
    installingNow.current = true;
    progressRef.current = [];
    setProgress([]);
    setInstalling(true);
    try {
      let r;
      try {
        r = await window.xenon.setup.install({
          profile: draft,
          pluginSource: 'local',
          drivers: ['uiautomator2', 'xcuitest']
        });
      } catch {
        // The request itself failed, so there is no result to summarise. The rows say how far it got.
        toast(SETUP_INTERRUPTED.message, SETUP_INTERRUPTED.kind);
        return;
      }
      const summary = setupSummary(r, { iphoneSkipped: iphoneSetupSkipped(progressRef.current) });
      toast(summary.message, summary.kind);
      await afterRun();
    } finally {
      installingNow.current = false;
      setInstalling(false);
      // Also what tells readiness a setup finished.
      setRuns((n) => n + 1);
    }
  };

  const isInstalling = useCallback(() => installingNow.current, []);

  return { installing, isInstalling, progress, runs, run };
}
