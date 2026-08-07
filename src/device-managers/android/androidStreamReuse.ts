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
}

export type AndroidStreamReuseDecision =
  | { reuse: true }
  | { reuse: false; reason: 'no-session' | 'not-running' | 'server-closed' | 'no-frame' };

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

  return { reuse: true };
}
