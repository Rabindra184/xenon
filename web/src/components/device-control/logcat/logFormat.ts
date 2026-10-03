/**
 * How the Logs tab writes numbers and times.
 *
 * One formatter, built once: `new Date(ts).toLocaleTimeString(...)` builds a
 * Date and a fresh Intl formatter per call, which at 20 updates a second was
 * the most expensive thing in a row's render. `format` takes epoch millis.
 * `h23` rather than `hour12: false`, which some engines render as "24:05:00"
 * just after midnight.
 */
const TIME = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** 2,629: the copy is English, so the separators are too. */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** HH:MM:SS, local time. */
export function formatTime(ts: number): string {
  return TIME.format(ts);
}

/** HH:MM:SS.mmm, local time, for the details panel. */
export function formatTimeMs(ts: number): string {
  const ms = ((Math.floor(ts) % 1000) + 1000) % 1000;
  return `${TIME.format(ts)}.${String(ms).padStart(3, '0')}`;
}
