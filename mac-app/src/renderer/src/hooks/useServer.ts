import { useEffect, useRef, useState } from 'react';
import type { LastRun, PreflightResult, Profile, ServerState, ServerStatus, ValidationIssue } from '@shared/types';
import { LOG_BUFFER_LIMIT, LOG_FLUSH_MS, appendCapped, type UiLogLine } from '../logBuffer';
import { afterStartCheck, decideStart, startFailureMessage, type StartDecision } from '../readiness';
import type { Place } from '../navigation';
import { toast } from '../components/ui/toastStore';

const IDLE_STATE: ServerState = {
  status: 'stopped',
  profileId: null,
  pid: null,
  port: null,
  basePath: null,
  dashboardUrl: null,
  startedAt: null,
  logFile: null,
  exitCode: null,
  exitSignal: null,
  lastError: null
};

export interface ServerApi {
  state: ServerState;
  /** The first status has come from the main process (read, or sent). */
  loaded: boolean;
  logs: UiLogLine[];
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
}

/** The Appium server as the main process reports it, and what it has printed. */
export function useServer(options: ServerOptions = {}): ServerApi {
  const [state, setState] = useState<ServerState>(IDLE_STATE);
  const [loaded, setLoaded] = useState(false);
  const onStatus = useRef(options.onStatus);
  onStatus.current = options.onStatus;
  // The last status the main process gave, read or sent.
  const lastStatus = useRef<ServerStatus>(IDLE_STATE.status);
  const [logs, setLogs] = useState<UiLogLine[]>([]);
  const [stopPending, setStopPending] = useState(false);
  const pendingLogs = useRef<UiLogLine[]>([]);
  const flushTimer = useRef<number | null>(null);
  const logSeq = useRef(0);

  useEffect(() => {
    // A change that arrives before the first read is newer than that read.
    let changed = false;
    let live = true;
    void window.xenon.server.state().then((st) => {
      if (!live || changed) return;
      lastStatus.current = st.status;
      setState(st);
      setLoaded(true);
    });

    // Coalesce incoming lines: a chatty server emits far faster than anyone can
    // read, and one render per line re-reconciles the whole buffer.
    const offLog = window.xenon.onLog((lines) => {
      for (const line of lines) pendingLogs.current.push({ ...line, id: logSeq.current++ });
      if (flushTimer.current !== null) return;
      flushTimer.current = window.setTimeout(() => {
        flushTimer.current = null;
        const batch = pendingLogs.current;
        pendingLogs.current = [];
        setLogs((prev) => appendCapped(prev, batch, LOG_BUFFER_LIMIT));
      }, LOG_FLUSH_MS);
    });
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

  const clearLogs = () => setLogs([]);

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
  refreshNow(): Promise<PreflightResult | null>;
  /** Write a pending edit now, so the server launches the config the person sees. */
  flush(): void;
  resetLogs(): void;
  go(place: Place): void;
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
  const { draft, issues, readiness, checking, installing, isInstalling, status, refreshNow, flush, resetLogs, go, focus } = i;
  const [busy, setBusy] = useState(false);
  // Why the last start failed, shown in the sidebar until the next start.
  const [startError, setStartError] = useState<string | null>(null);
  // Held across the preflight, which takes a moment: a second ⌘⏎ must not start a second run.
  const startInFlight = useRef(false);

  const decision = decideStart({ status, issues, readiness, checking, installing });

  const requestStart = async () => {
    if (!draft || startInFlight.current) return;
    // A running server, or a Set up still rewriting the Appium folder: no check, no start.
    if (!decision.ok && (decision.kind === 'active' || decision.kind === 'setup-running')) return;
    if (!decision.ok && decision.kind === 'invalid') {
      // Every setting, the port and base path included, is on Settings.
      go('settings');
      focus(decision.issue.path);
      return;
    }
    // Whatever was last learned about this Mac may be old, so look again
    // before launching, and let only that answer decide.
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
        go('setup');
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

  return { requestStart, busy, startError, decision };
}
