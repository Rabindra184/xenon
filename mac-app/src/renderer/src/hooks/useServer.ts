import { useCallback, useEffect, useRef, useState } from 'react';
import type { LastRun, LogLine, PreflightResult, Profile, ServerState, ServerStatus, ValidationIssue } from '@shared/types';
import { LOG_BUFFER_LIMIT, LOG_FLUSH_MS, withLiveLines, withSeed } from '../logBuffer';
import { afterStartCheck, decideStart, startFailureMessage, type StartDecision } from '../readiness';
import { placeAfterFailedCheck, type Place } from '../navigation';
import { toast } from '../components/ui/toastStore';
import { commitFocusedEdit } from '../commitEdit';

const IDLE_STATE: ServerState = {
  status: 'stopped',
  profileId: null,
  pid: null,
  port: null,
  basePath: null,
  appiumHome: null,
  dashboardUrl: null,
  startedAt: null,
  logFile: null,
  exitCode: null,
  exitSignal: null,
  lastError: null,
  crashLine: null
};

export interface ServerApi {
  state: ServerState;
  /** The first status has come from the main process (read, or sent). */
  loaded: boolean;
  /** The lines main keeps, with main's ids: read when the window opens, then each batch main sends. */
  logs: LogLine[];
  /** Clears the lines shown, here and in main (through the newest one shown). */
  clearLogs(): void;
  stop(): Promise<void>;
  /** A stop request is in flight. */
  stopPending: boolean;
}

export interface ServerOptions {
  /**
   * Called with every status the main process sends, and the one before it.
   * Every one: two that arrive together (starting, then crashed a moment
   * later) may be drawn in one render, so a change seen only in what is drawn
   * can be missed.
   */
  onStatus?(prev: ServerStatus, next: ServerStatus): void;
  /**
   * Called with the status of the window's first read, when no status was sent before it came
   * back (one that was is newer, and goes to onStatus). A window that opens after a crash learns of
   * it here.
   */
  onFirstRead?(status: ServerStatus): void;
}

/** The Appium server as the main process reports it, and what it has printed. */
export function useServer(options: ServerOptions = {}): ServerApi {
  const [state, setState] = useState<ServerState>(IDLE_STATE);
  const [loaded, setLoaded] = useState(false);
  const onStatus = useRef(options.onStatus);
  onStatus.current = options.onStatus;
  const onFirstRead = useRef(options.onFirstRead);
  onFirstRead.current = options.onFirstRead;
  // The last status the main process gave, read or sent.
  const lastStatus = useRef<ServerStatus>(IDLE_STATE.status);
  const [logs, setLogs] = useState<LogLine[]>([]);
  // The lines drawn now, for Clear, which clears what the person saw.
  const drawn = useRef<LogLine[]>(logs);
  drawn.current = logs;
  // The newest line cleared: main's answer to the seed may be older than a Clear, and holds it again.
  const clearedThrough = useRef(0);
  const [stopPending, setStopPending] = useState(false);
  const pendingLogs = useRef<LogLine[]>([]);
  const flushTimer = useRef<number | null>(null);

  useEffect(() => {
    // A change that arrives before the first read is newer than that read.
    let changed = false;
    let live = true;
    void window.xenon.server.state().then((st) => {
      if (!live || changed) return;
      lastStatus.current = st.status;
      onFirstRead.current?.(st.status);
      setState(st);
      setLoaded(true);
    });

    // Coalesce incoming lines: a chatty server emits far faster than anyone can
    // read, and one render per line re-reconciles the whole buffer. Each comes
    // with main's id; one the window already has (from the seed) is skipped.
    const offLog = window.xenon.onLog((lines) => {
      pendingLogs.current.push(...lines);
      if (flushTimer.current !== null) return;
      flushTimer.current = window.setTimeout(() => {
        flushTimer.current = null;
        const batch = pendingLogs.current;
        pendingLogs.current = [];
        setLogs((prev) => withLiveLines(prev, batch, LOG_BUFFER_LIMIT));
      }, LOG_FLUSH_MS);
    });
    // Main kept the lines while no window was open, or before this one: start from them (R67). Asked
    // once the batches are listened to, so none falls between the two; a batch that comes in first,
    // or holds lines the answer has too, is put together with it by id (withSeed).
    void window.xenon.server.logs().then(
      (seed) => {
        if (live) setLogs((prev) => withSeed(prev, seed, clearedThrough.current, LOG_BUFFER_LIMIT));
      },
      // Without them, Logs shows what comes from now on.
      () => undefined
    );
    const offState = window.xenon.onServerState((st) => {
      changed = true;
      const prev = lastStatus.current;
      lastStatus.current = st.status;
      onStatus.current?.(prev, st.status);
      setState(st);
      setLoaded(true);
    });
    return () => {
      live = false;
      offLog();
      offState();
      if (flushTimer.current !== null) clearTimeout(flushTimer.current);
    };
  }, []);

  // The lines drawn go, here and in main, through the newest of them: lines on their way (main
  // has sent them, or this window is gathering them) are after it, and stay in both.
  const clearLogs = useCallback(() => {
    const shown = drawn.current;
    if (shown.length === 0) return;
    const through = shown.reduce((newest, l) => Math.max(newest, l.id), -Infinity);
    clearedThrough.current = Math.max(clearedThrough.current, through);
    setLogs((prev) => prev.filter((l) => l.id > through));
    void window.xenon.server.clearLogs(through).catch(() => undefined);
  }, []);

  const stop = async () => {
    setStopPending(true);
    try {
      await window.xenon.server.stop();
    } finally {
      setStopPending(false);
    }
  };

  return { state, loaded, logs, clearLogs, stop, stopPending };
}

/**
 * How the profile's server last ended, for Home's footer, or null when it has
 * not run. Read when the profile is opened and again on every change of the
 * server's status: main keeps a run that ended before it announces the state
 * that ended it, so the answer to that announcement already has it.
 */
export function useLastRun(profileId: string | null, status: ServerStatus): LastRun | null {
  const [read, setRead] = useState<{ profileId: string; run: LastRun | null } | null>(null);
  useEffect(() => {
    if (profileId === null) return;
    let live = true;
    window.xenon.server.lastRun(profileId).then(
      (run) => {
        if (live) setRead({ profileId, run });
      },
      // Not knowing how the last run ended only leaves the footer out.
      () => undefined
    );
    return () => {
      live = false;
    };
  }, [profileId, status]);
  // What was read for another profile is not this one's.
  return read !== null && read.profileId === profileId ? read.run : null;
}

export interface StartFlowInput {
  draft: Profile | null;
  /** What is wrong with the draft's settings; the first one is where an invalid start sends the person. */
  issues: ValidationIssue[];
  readiness: PreflightResult | null;
  checking: boolean;
  /** Set up is running, as last drawn: it decides whether Start can be pressed. */
  installing: boolean;
  /**
   * Set up is running right now, read when it is called. A start reads it once
   * its check is back: Set up may have been clicked while the check ran.
   */
  isInstalling(): boolean;
  /** The server's status, which decides whether a start is allowed at all. */
  status: ServerStatus;
  /** Looks at this Mac again now; `fresh` reads the login shell again too (R80). */
  refreshNow(look?: { fresh: boolean }): Promise<PreflightResult | null>;
  /** Write a pending edit now, so the server launches the config the person sees. */
  flush(): void;
  resetLogs(): void;
  go(place: Place): void;
  /**
   * The place on screen right now, read when it is called. A start whose own check finds a problem
   * reads it once the check is back: the person may have moved since pressing Start.
   */
  placeNow(): Place;
  /** Put the cursor in a setting, once the screen that holds it is drawn. */
  focus(path: string): void;
}

export interface StartFlow {
  requestStart(): Promise<void>;
  busy: boolean;
  /** Why the last start failed, shown until the next start. */
  startError: string | null;
  decision: StartDecision;
}

/** The one way to start: the button, ⌘⏎, the menu and the Logs link all end in requestStart. */
export function useStartFlow(i: StartFlowInput): StartFlow {
  // The newest start, for the one that waits for an edit it ended to be drawn.
  const latest = useRef<(edited: boolean) => Promise<void>>(async () => undefined);
  const { draft, issues, readiness, checking, installing, isInstalling, status, refreshNow, flush, resetLogs, go, placeNow, focus } =
    i;
  const [busy, setBusy] = useState(false);
  // Why the last start failed, shown in the sidebar until the next start.
  const [startError, setStartError] = useState<string | null>(null);
  // Held across the preflight, which takes a moment: a second ⌘⏎ must not start a second run.
  const startInFlight = useRef(false);

  const decision = decideStart({ status, issues, readiness, checking, installing });

  /**
   * The start. `edited` says the edit in the focused box has been ended (commitFocusedEdit) and the
   * window has drawn what it committed, so `draft`, `issues` and `decision` here are what is on screen.
   */
  const run = async (edited: boolean) => {
    if (!draft || startInFlight.current) return;
    // A JSON box or a table cell commits when it loses focus, and ⌘⏎ moves no focus: end the edit,
    // let the window draw it, and start with what it committed.
    if (!edited && commitFocusedEdit()) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return latest.current(true);
    }
    // A running server, or a Set up still rewriting the Appium folder: no check, no start.
    if (!decision.ok && (decision.kind === 'active' || decision.kind === 'setup-running')) return;
    if (!decision.ok && decision.kind === 'invalid') {
      // Every setting, the port and base path included, is on Settings.
      go('settings');
      focus(decision.issue.path);
      return;
    }
    // Whatever was last learned about this Mac may be old, so look again
    // before launching, and let only that answer decide. A good read of the
    // login shell is reused: only Check again and Try again read it again (R82).
    startInFlight.current = true;
    flush(); // launch the config the user actually sees
    setBusy(true);
    try {
      const result = await refreshNow();
      // Set up may have been clicked while that look was running. The `installing` this
      // closed over is from before the await, so ask the run itself.
      const next = afterStartCheck(result, isInstalling());
      if (next === 'wait') return;
      if (next === 'fix') {
        // Home, when it is open, says what is in the way and offers its fix; from anywhere else, Setup.
        const there = placeAfterFailedCheck(placeNow());
        if (there !== null) go(there);
        return;
      }
      setStartError(null);
      resetLogs();
      await window.xenon.server.start(draft);
    } catch (err) {
      const message = startFailureMessage(err);
      setStartError(message);
      toast(message, 'error');
    } finally {
      startInFlight.current = false;
      setBusy(false);
    }
  };

  latest.current = run;
  const requestStart = () => run(false);

  return { requestStart, busy, startError, decision };
}
