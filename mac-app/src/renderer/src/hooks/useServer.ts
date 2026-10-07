import { useEffect, useRef, useState } from 'react';
import type { PreflightResult, Profile, ServerState, ServerStatus, ValidationIssue } from '@shared/types';
import { LOG_BUFFER_LIMIT, LOG_FLUSH_MS, appendCapped, type UiLogLine } from '../logBuffer';
import { afterStartCheck, decideStart, startFailureMessage, type StartDecision } from '../readiness';
import type { Place } from '../navigation';
import { toast } from '../components/ui/toastStore';

const IDLE_STATE: ServerState = {
  status: 'stopped',
  profileId: null,
  pid: null,
  port: null,
  dashboardUrl: null,
  startedAt: null,
  logFile: null,
  exitCode: null,
  exitSignal: null,
  lastError: null
};

export interface ServerApi {
  state: ServerState;
  logs: UiLogLine[];
  clearLogs(): void;
  stop(): Promise<void>;
  /** A stop request is in flight. */
  stopPending: boolean;
}

/** The Appium server as the main process reports it, and what it has printed. */
export function useServer(): ServerApi {
  const [state, setState] = useState<ServerState>(IDLE_STATE);
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
      if (live && !changed) setState(st);
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
      setState(st);
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

  return { state, logs, clearLogs, stop, stopPending };
}

export interface StartFlowInput {
  draft: Profile | null;
  /** What is wrong with the draft's settings; the first one is where an invalid start sends the person. */
  issues: ValidationIssue[];
  readiness: PreflightResult | null;
  checking: boolean;
  /** Set up is running. */
  installing: boolean;
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
  const { draft, issues, readiness, checking, installing, status, refreshNow, flush, resetLogs, go, focus } = i;
  const [busy, setBusy] = useState(false);
  // Why the last start failed, shown in the sidebar until the next start.
  const [startError, setStartError] = useState<string | null>(null);
  // Held across the preflight, which takes a moment: a second ⌘⏎ must not start a second run.
  const startInFlight = useRef(false);
  // The same fact for code that runs after an await (requestStart looks again once
  // its check is back), where the `installing` it closed over may be a second old.
  const installingRef = useRef(installing);
  installingRef.current = installing;

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
      // Set up may have been clicked while that look was running.
      const next = afterStartCheck(result, installingRef.current);
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
