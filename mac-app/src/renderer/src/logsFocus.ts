import type { CrashLine, ServerStatus } from '@shared/types';
import type { Place } from './navigation';

/**
 * Where Home's "See what happened" sent Logs: the crash's line (`lineId`), or no line to go to
 * (null: Logs opens as usual, Everything at the end). Either way the keyboard picks up at the lines,
 * since the button that sent the person there went with Home (minor 5).
 */
export interface LogsFocus {
  lineId: number | null;
}

export type LogsFocusEvent =
  /** Home's "See what happened", with the crash's line main froze (ServerState.crashLine). */
  | { type: 'see-what-happened'; crashLine: CrashLine | null }
  /** The place on screen now. */
  | { type: 'place'; place: Place }
  /** A status main sent. */
  | { type: 'status'; status: ServerStatus }
  /** The person changed Show, typed a search or pressed Clear. */
  | { type: 'end' };

/**
 * The jump from Home's quote to its line in Logs (R1, R60), after an event. It lasts while Logs is
 * open, and ends when the person changes what Logs shows or clears it, leaves Logs, or a new start
 * begins (minor 10): Logs then follows the end again. A fresh object for each See what happened, so a
 * second one to the same line jumps again.
 */
export function logsFocusAfter(focus: LogsFocus | null, event: LogsFocusEvent): LogsFocus | null {
  switch (event.type) {
    case 'see-what-happened':
      return { lineId: event.crashLine === null ? null : event.crashLine.id };
    case 'place':
      return event.place === 'logs' ? focus : null;
    case 'status':
      return event.status === 'starting' ? null : focus;
    case 'end':
      return null;
  }
}
