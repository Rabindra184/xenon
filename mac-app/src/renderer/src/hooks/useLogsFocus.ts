import { useCallback, useEffect, useState } from 'react';
import type { CrashLine } from '@shared/types';
import type { Place } from '../navigation';

/** The line Logs was sent to by Home's "See what happened". */
export interface LogsFocus {
  lineId: number;
}

export interface LogsFocusApi {
  /** Where Logs is sent, until the person changes what it shows, clears it, or leaves it. */
  focus: LogsFocus | null;
  /**
   * Home's "See what happened": Logs, at the crash's line (ServerState.crashLine, the line Home
   * quotes), or as usual when there is none.
   */
  seeWhatHappened(crashLine: CrashLine | null): void;
  /** The person changed Show, typed a search or pressed Clear: Logs is no longer at the line. */
  end(): void;
}

/**
 * The jump from Home's quote to its line in Logs (R1, R60). Home quotes the crash's line main worked
 * out (R67), and the jump goes to the same line, by its id: one main gave it, so it is the same line
 * in the window's lines. With no line, "See what happened" opens Logs as usual (Everything, at the
 * end); a line no longer in the window's lines (cleared, or rolled off) opens Problems only with no
 * mark. The jump lasts while Logs is open; leaving Logs ends it.
 */
export function useLogsFocus(place: Place, go: (place: Place) => void): LogsFocusApi {
  const [focus, setFocus] = useState<LogsFocus | null>(null);

  useEffect(() => {
    if (place !== 'logs') setFocus(null);
  }, [place]);

  // A fresh object each time, so a second "See what happened" to the same line jumps again.
  const seeWhatHappened = (crashLine: CrashLine | null) => {
    setFocus(crashLine === null ? null : { lineId: crashLine.id });
    go('logs');
  };

  const end = useCallback(() => setFocus(null), []);

  return { focus, seeWhatHappened, end };
}
