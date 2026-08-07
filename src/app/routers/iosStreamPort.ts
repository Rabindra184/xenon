/**
 * Resolve the MJPEG port to proxy for an iOS stream request.
 *
 * Why this exists: WDA dies *on the device* while the host-side `runwda`
 * process stays alive with `exitCode === null`. The in-memory stream session
 * therefore stays `status: 'running'` pointing at a dead upstream. The stream
 * route used to reuse such a session verbatim, so every request failed and
 * nothing attempted recovery until the watchdog's next tick — an hour later.
 * Reuse now requires WDA to actually answer; otherwise we restart the stream,
 * which is the same recovery the watchdog would eventually perform.
 *
 * Kept free of TypeDI/HTTP so the decision is unit-testable; the router injects
 * the real IOSStreamService methods.
 */

/** Minimal view of a stream session — structurally satisfied by StreamSession. */
export interface IosStreamSessionView {
  status: string;
  mjpegPort: number;
  wdaPort: number;
}

export interface IosStreamPortDeps {
  getSession: (udid: string) => IosStreamSessionView | undefined;
  /** Liveness probe against WDA's /status on the session's forwarded port. */
  isWdaHealthy: (wdaPort: number, udid: string) => Promise<boolean>;
  startStream: (udid: string) => Promise<{ mjpegPort: number }>;
}

export async function resolveIosMjpegPort(
  udid: string,
  deps: IosStreamPortDeps,
): Promise<number> {
  const session = deps.getSession(udid);

  if (session && session.status === 'running') {
    // A probe failure is treated exactly like an unhealthy WDA: fall through to
    // a restart. Never let the health check itself fail the request — that would
    // trade a recoverable stream for a hard error.
    let healthy = false;
    try {
      healthy = await deps.isWdaHealthy(session.wdaPort, udid);
    } catch {
      healthy = false;
    }
    if (healthy) return session.mjpegPort;
  }

  const started = await deps.startStream(udid);
  return started.mjpegPort;
}
