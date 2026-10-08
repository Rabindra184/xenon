import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UiLogLine } from '../logBuffer';
import { problemToQuote } from '../logView';
import type { Place } from '../navigation';

/** The line Logs was sent to by Home's "See what happened". */
export interface LogsFocus {
  lineId: number;
}

export interface LogsFocusApi {
  /** Where Logs is sent, until the person changes what it shows, clears it, or leaves it. */
  focus: LogsFocus | null;
  /** The words Home quotes after a crash ("Last message"), or null when there is no problem line. */
  lastProblem: string | null;
  /** Home's "See what happened": Logs, at the line Home quotes, or as usual when it quotes none. */
  seeWhatHappened(): void;
  /** The person changed Show, typed a search or pressed Clear: Logs is no longer at the line. */
  end(): void;
}

/**
 * The jump from Home's quote to its line in Logs (R1, R60). The quote and the
 * jump come from one look at the lines (problemToQuote), so they are always the
 * same line. With no problem line, "See what happened" opens Logs as usual
 * (Everything, at the end). The jump lasts while Logs is open; leaving Logs ends it.
 *
 * Home quotes a line, and offers "See what happened", only after a crash
 * (`crashed`), when no more lines come. The lines are looked through only then,
 * not on every batch a running server prints.
 */
export function useLogsFocus(
  place: Place,
  logs: UiLogLine[],
  crashed: boolean,
  go: (place: Place) => void
): LogsFocusApi {
  const [focus, setFocus] = useState<LogsFocus | null>(null);
  const quote = useMemo(() => (crashed ? problemToQuote(logs) : null), [crashed, logs]);

  useEffect(() => {
    if (place !== 'logs') setFocus(null);
  }, [place]);

  // A fresh object each time, so a second "See what happened" to the same line jumps again.
  const seeWhatHappened = () => {
    setFocus(quote === null ? null : { lineId: quote.lineId });
    go('logs');
  };

  const end = useCallback(() => setFocus(null), []);

  return { focus, lastProblem: quote?.text ?? null, seeWhatHappened, end };
}
