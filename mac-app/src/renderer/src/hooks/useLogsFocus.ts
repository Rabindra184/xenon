import { useCallback, useEffect, useState } from 'react';
import type { CrashLine, ServerStatus } from '@shared/types';
import { logsFocusAfter, type LogsFocus } from '../logsFocus';
import type { Place } from '../navigation';

export type { LogsFocus } from '../logsFocus';

export interface LogsFocusApi {
  /** Where Logs is sent, until the person changes what it shows, clears it, leaves it, or a new start begins. */
  focus: LogsFocus | null;
  /**
   * Home's "See what happened": Logs, at the crash's line (ServerState.crashLine, the line Home
   * quotes), or as usual when there is none; the keyboard at the lines either way.
   */
  seeWhatHappened(crashLine: CrashLine | null): void;
  /** The person changed Show, typed a search or pressed Clear: Logs is no longer at the line. */
  end(): void;
  /** Give it every status the main process sends (useServer's onStatus): a new start ends the jump. */
  onStatus(status: ServerStatus): void;
}

/**
 * The jump from Home's quote to its line in Logs (R1, R60; logsFocusAfter). Home quotes the crash's
 * line main worked out (R67), and the jump goes to the same line, by its id: one main gave it, so it
 * is the same line in the window's lines. With no line, "See what happened" opens Logs as usual
 * (Everything, at the end); a line no longer in the window's lines (cleared, or rolled off) opens
 * Problems only with no mark. The jump lasts while Logs is open; leaving Logs, or a new start, ends it.
 */
export function useLogsFocus(place: Place, go: (place: Place) => void): LogsFocusApi {
  const [focus, setFocus] = useState<LogsFocus | null>(null);

  useEffect(() => {
    setFocus((f) => logsFocusAfter(f, { type: 'place', place }));
  }, [place]);

  const seeWhatHappened = (crashLine: CrashLine | null) => {
    setFocus((f) => logsFocusAfter(f, { type: 'see-what-happened', crashLine }));
    go('logs');
  };

  const end = useCallback(() => setFocus((f) => logsFocusAfter(f, { type: 'end' })), []);
  const onStatus = useCallback((status: ServerStatus) => setFocus((f) => logsFocusAfter(f, { type: 'status', status })), []);

  return { focus, seeWhatHappened, end, onStatus };
}
