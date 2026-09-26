import * as React from 'react';

/** How often a live MJPEG tile asks the server whether its stream still runs. */
export const LIVENESS_POLL_MS = 5000;

export interface StreamStatusAnswer {
  httpStatus: number;
  body?: { status?: string; startedAt?: string };
}

/**
 * Decide from one /stream/status answer whether the stream a live tile is
 * showing has ended. `startedAt` is when that stream started, as first seen
 * after the tile went live (iOS reports it; Android does not).
 *
 * Only an answer from the server counts. An error status could be a passing
 * failure, so it keeps the tile waiting; a 404 means the device is gone.
 */
export function judgeStreamStatus(
  answer: StreamStatusAnswer,
  startedAt: string | undefined,
): { ended: boolean; startedAt: string | undefined } {
  if (answer.httpStatus === 404) return { ended: true, startedAt };
  if (answer.httpStatus !== 200) return { ended: false, startedAt };
  const body = answer.body ?? {};
  if (body.status !== 'running') return { ended: true, startedAt };
  // Stopping a stream ends every viewer's connection, so one that started
  // again since the tile connected is not the stream on screen.
  if (startedAt && body.startedAt && body.startedAt !== startedAt) {
    return { ended: true, startedAt };
  }
  return { ended: false, startedAt: startedAt ?? body.startedAt };
}

/**
 * Call `onEnded` once when the server says the stream behind a live MJPEG tile
 * has ended.
 *
 * The <img> can't tell us: measured in Chrome, a server restart left it blank
 * and a stopped stream froze it on the last frame, and neither fired `load` or
 * `error`. The tile stayed "live" and never retried. While the server can't be
 * reached (mid-restart) this keeps waiting instead of spending the tile's
 * retries, and reports the end once the server answers.
 */
export function useStreamLiveness(
  udid: string,
  active: boolean,
  onEnded: () => void,
  pollMs = LIVENESS_POLL_MS,
): void {
  const onEndedRef = React.useRef(onEnded);
  onEndedRef.current = onEnded;

  React.useEffect(() => {
    if (!active) return;
    let done = false;
    let busy = false;
    let startedAt: string | undefined;
    const check = async () => {
      if (busy || done) return;
      busy = true;
      try {
        const r = await fetch(`/xenon/api/control/${encodeURIComponent(udid)}/stream/status`);
        const body = r.ok ? await r.json().catch(() => undefined) : undefined;
        if (done) return;
        const verdict = judgeStreamStatus({ httpStatus: r.status, body }, startedAt);
        startedAt = verdict.startedAt;
        if (verdict.ended) {
          done = true;
          onEndedRef.current();
        }
      } catch {
        // The server can't be reached; ask again on the next tick.
      } finally {
        busy = false;
      }
    };
    void check();
    const timer = setInterval(check, pollMs);
    return () => {
      done = true;
      clearInterval(timer);
    };
  }, [udid, active, pollMs]);
}
