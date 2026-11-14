import type { LogcatRecord } from './useLogcatStream';

/**
 * Where the lines a client already had end in a reconnect's replay.
 *
 * The stream starts its buffer over on a reconnect (`useLogcatStream`'s new
 * generation), and the server replays its newest lines (up to
 * `REPLAY_LINES`) to the new socket, each given a new `seq`. So by `seq`
 * alone every replayed line looks new: a Logs recording that spanned a
 * reconnect saved them twice, and the pause pill jumped by the replay.
 *
 * The wire record has no id, so the lines are matched by content, the way
 * the hub matches a node's device log after a restart
 * (`NodeDeviceLogsCollector.pastStored`): the newest `OVERLAP_LINES` lines
 * the client had, line for line back from the end of the match. logcat often
 * prints the same line twice in one millisecond, so one line alone can't say
 * which copy the client had.
 */

/** How many of the newest lines the client had are compared. */
export const OVERLAP_LINES = 32;

/** The most a reconnect replays (`LogcatMultiplexer`'s REPLAY_BUFFER_SIZE). */
export const REPLAY_LINES = 2000;

/**
 * How long a recording waits for the replay to reach the lines it had before
 * it takes what arrived as new. The replay comes in one burst right after the
 * open; a new stream that never sends the old lines (an iPhone whose filter
 * now leaves them out of what it sends) would otherwise hold the capture back.
 */
export const REPLAY_WAIT_MS = 3000;

type Line = Pick<LogcatRecord, 'ts' | 'pid' | 'tid' | 'level' | 'tag' | 'message' | 'synthetic'> & {
  pkg?: string;
};

const sameLine = (a: Line, b: Line) =>
  a.ts === b.ts &&
  a.pid === b.pid &&
  a.tid === b.tid &&
  a.level === b.level &&
  a.tag === b.tag &&
  a.message === b.message;

/**
 * The index in `records` (a new generation, newest last) of the first line
 * after the replayed copy of what the client had (`seen`, newest last): 0 when
 * the client had nothing, null when the replay hasn't reached it (yet, or at
 * all).
 *
 * Markers Xenon sends this client alone (dropped lines, a stream's end) are
 * never replayed, so they are left out on both sides. `wanted` is what the new
 * socket sends (an iPhone's stream is narrowed at the source, so a filter
 * change leaves lines it had out of the replay); everything by default.
 */
export function afterReplay<T extends Line>(
  records: ReadonlyArray<T>,
  seen: ReadonlyArray<Line>,
  wanted: (r: Line) => boolean = () => true,
): number | null {
  const tail: Line[] = [];
  for (let i = seen.length - 1; i >= 0 && tail.length < OVERLAP_LINES; i--) {
    const r = seen[i];
    if (!r.synthetic && wanted(r)) tail.unshift(r);
  }
  if (tail.length === 0) return 0;
  const real: number[] = [];
  records.forEach((r, i) => {
    if (!r.synthetic) real.push(i);
  });
  for (let end = real.length - 1; end >= 0; end--) {
    const span = Math.min(tail.length, end + 1);
    let k = 0;
    while (k < span && sameLine(records[real[end - k]], tail[tail.length - 1 - k])) k++;
    if (k === span) return real[end] + 1;
  }
  return null;
}
