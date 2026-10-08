import { useCallback, useEffect, useRef, useState } from 'react';
import type { Profile, SetupProgress } from '@shared/types';
import { SETUP_INTERRUPTED, iphoneSetupSkipped, mergeProgress, setupSummary } from '../setupProgress';
import { toast } from '../components/ui/toastStore';

/** How a run ended, in A3's words: what its toast says. */
export interface SetupSummary {
  message: string;
  kind: 'success' | 'error';
}

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
  /** The profile the current or last run was for (its steps and summary are that profile's), or null before one. */
  runFor: string | null;
  /** Bumped each time a run ends, so the checks look again at what it changed. */
  runs: number;
  /** How the last run ended, as its toast said it (A3's summary), or null before one has ended and while one runs. */
  summary: SetupSummary | null;
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
  const [summary, setSummary] = useState<SetupSummary | null>(null);
  const [runFor, setRunFor] = useState<string | null>(null);
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
    setSummary(null);
    setRunFor(draft.id);
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
        setSummary(SETUP_INTERRUPTED);
        return;
      }
      const ended = setupSummary(r, { iphoneSkipped: iphoneSetupSkipped(progressRef.current) });
      toast(ended.message, ended.kind);
      setSummary(ended);
      await afterRun();
    } finally {
      installingNow.current = false;
      setInstalling(false);
      // Also what tells readiness a setup finished.
      setRuns((n) => n + 1);
    }
  };

  const isInstalling = useCallback(() => installingNow.current, []);

  return { installing, isInstalling, progress, runFor, runs, summary, run };
}
