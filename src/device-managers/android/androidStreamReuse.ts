/**
 * Decide whether an existing Android MJPEG stream session can be handed back as
 * is, or has to be torn down and restarted.
 *
 * Why this exists: `startStream` used to return `existing.mjpegPort` for any
 * session marked 'running' *or* 'starting', with nothing verifying that a
 * server was still bound to it. A session whose HTTP server had closed, or one
 * that went live without ever capturing a frame (startStream warns and
 * continues after a 5s first-frame wait), was therefore reused indefinitely —
 * every caller, `ensureMjpegForRecording` included, got a port that serves
 * nothing, and ffmpeg left a 0-byte mp4 behind. Same silent symptom as #194,
 * reached by a different route. See issue #196.
 *
 * This is the Android analogue of `resolveIosMjpegPort` (#191), minus the async
 * probe: the MJPEG server is ours and in-process, so its liveness is a property
 * read rather than a loopback request.
 *
 * Kept free of TypeDI and `http` so the decision is unit-testable; the service
 * maps its live session onto the view below.
 */

/** Minimal view of a stream session — the service derives this from its own state. */
export interface AndroidStreamSessionView {
  status: string;
  /** Our own `http.Server` is still bound and accepting connections. */
  serverListening: boolean;
  /** At least one frame has been captured, so a connecting client gets JPEGs. */
  hasFrame: boolean;
  /** Capture has been failing long enough that any cached frame is a still. */
  captureStalled: boolean;
}

export type AndroidStreamReuseDecision =
  | { reuse: true }
  | {
      reuse: false;
      reason: 'no-session' | 'not-running' | 'server-closed' | 'no-frame' | 'capture-stalled';
    };

export function decideAndroidStreamReuse(
  session: AndroidStreamSessionView | undefined | null,
): AndroidStreamReuseDecision {
  if (!session) return { reuse: false, reason: 'no-session' };

  // 'starting' is deliberately excluded: the bind loop registers the candidate
  // before awaiting the listen, so that status means "a port exists" and not
  // "a port serves". Concurrent callers join the in-flight start via
  // SingleFlight (#195) instead of being handed a half-bound port here.
  if (session.status !== 'running') return { reuse: false, reason: 'not-running' };

  if (!session.serverListening) return { reuse: false, reason: 'server-closed' };
  if (!session.hasFrame) return { reuse: false, reason: 'no-frame' };
  // Ordered after hasFrame: "never captured anything" and "captured, then went
  // silent" are different problems, and the reason ends up in a log line.
  if (session.captureStalled) return { reuse: false, reason: 'capture-stalled' };

  return { reuse: true };
}

/**
 * How long the device may go without producing a frame before anything we still
 * hold is treated as a still image rather than a live feed.
 *
 * Deliberately generous. A single failed `screencap`, a device briefly held by
 * the interaction lock, or one 15s ADB timeout must not tear down a live
 * preview or an in-flight recording — the cure for that would be the
 * over-eager-restart failure mode #198 was careful to avoid.
 */
export const CAPTURE_STALL_MS = 10_000;

/**
 * Tracks whether the device is still answering `screencap`.
 *
 * Why this exists (issue #200): the capture loop swallows capture errors and
 * loops on `while (status === 'running' || status === 'starting')`, so a device
 * that goes away — unplugged, adb killed, reboot — never changes the session's
 * status. `latestFrame` is only ever assigned, never cleared, so the MJPEG
 * server happily rewrote the last good JPEG every 60ms: a frozen preview, and a
 * recording that ffprobe calls healthy but which is a still photograph. That is
 * worse than the 0-byte failure of #194/#196, because it looks valid.
 *
 * The measure is time-since-the-device-last-answered, not a failure count: a
 * fast `ADB Exit 1` and a 15s `ADB Timeout` are wildly different amounts of
 * frozen video for the same count. It is also immune to the idle path —
 * `shouldIdleCapture` skips capture entirely when nobody is watching, so an
 * idle-but-healthy session records neither successes nor failures and simply
 * stays in whatever state it was left in.
 */
export class CaptureHealth {
  /** Start of the earliest attempt in the current run of failures. */
  private failingSince?: number;
  private consecutive = 0;
  private announced = false;

  /** A frame was captured — the device is answering. */
  recordSuccess(): void {
    this.failingSince = undefined;
    this.consecutive = 0;
    this.announced = false;
  }

  /**
   * A capture attempt threw.
   *
   * `attemptStartedAt` (not `now`) dates the stall, because a 15s ADB timeout
   * means the device had already been silent for 15s by the time we got here.
   */
  recordFailure(attemptStartedAt: number, now: number): { consecutive: number; stalled: boolean } {
    if (this.failingSince === undefined) this.failingSince = attemptStartedAt;
    this.consecutive += 1;
    return { consecutive: this.consecutive, stalled: this.isStalled(now) };
  }

  /**
   * Claim the right to announce this stall episode: true for the first caller
   * that observes the session stalled, false for every caller after it until a
   * successful frame resets the episode.
   *
   * Why a claim rather than a flag computed inside `recordFailure`: ending
   * client responses on a stall drops `viewerCount` to 0, `shouldIdleCapture`
   * then stops the capture loop attempting anything more, and so the failure
   * that would have crossed the threshold never happens — the catch never gets
   * to warn. A live cable-pull run showed exactly that: 10 failures spanning
   * 9.214s against a 10s threshold, then silence, so a device that had vanished
   * produced no warning at all. Either path can claim it now, and neither
   * double-logs.
   */
  takeStallAnnouncement(now: number): boolean {
    if (!this.isStalled(now) || this.announced) return false;
    this.announced = true;
    return true;
  }

  /** Consecutive failed capture attempts in the current episode, for logging. */
  get consecutiveFailures(): number {
    return this.consecutive;
  }

  /** Capture has been failing long enough that any cached frame is a still. */
  isStalled(now: number): boolean {
    return this.failingSince !== undefined && now - this.failingSince >= CAPTURE_STALL_MS;
  }

  /** How long the device has been silent, for logging. 0 when healthy. */
  failingForMs(now: number): number {
    return this.failingSince === undefined ? 0 : now - this.failingSince;
  }
}
