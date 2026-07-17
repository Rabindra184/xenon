/**
 * Pure diagnostics helpers for the iOS stream pipeline.
 *
 * Kept free of side effects so they can be unit-tested. IOSStreamService uses
 * them to (a) turn an opaque WDA crash into an actionable message and (b) tame
 * the go-ios tunnel's repetitive stderr.
 */

/**
 * True when a WDA run log indicates the WebDriverAgentRunner app is missing on
 * the device (a permanent condition — retrying the launch is pointless until
 * WDA is installed).
 */
export function isMissingWdaError(logContent: string): boolean {
  if (!logContent) return false;
  return (
    /Did not find test app/i.test(logContent) ||
    /WebDriverAgentRunner[^\n]*\b(not installed|not found|is it installed)/i.test(logContent)
  );
}

/** Human-facing, actionable message for the missing-WDA case. */
export function missingWdaMessage(udid: string): string {
  return (
    `WebDriverAgent is not installed on ${udid}. ` +
    `Live streaming requires the WebDriverAgentRunner app — install WDA on this device to enable the mirror.`
  );
}

/**
 * Classify a chunk of go-ios `tunnel start` stderr.
 *
 * When a connected device runs iOS < 17 (which needs no tunnel), go-ios emits a
 * repeated "unsupported iOS version" warning for that device. We detect it so
 * the caller can log it once, attributed to the *actual* target udid rather than
 * the tunnel owner's udid.
 */
export function classifyTunnelStderr(text: string): { unsupported: boolean; udid: string | null } {
  const trimmed = (text ?? '').trim();
  if (!/unsupported iOS version/i.test(trimmed)) {
    return { unsupported: false, udid: null };
  }

  let udid: string | null = null;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      if (typeof parsed?.udid === 'string') udid = parsed.udid;
    } catch {
      /* fall through to regex */
    }
  }
  if (!udid) {
    const m = trimmed.match(/"udid"\s*:\s*"([^"]+)"/);
    if (m) udid = m[1];
  }
  return { unsupported: true, udid };
}

/**
 * Decide whether a process listening on one of this device's stream ports is
 * actually *ours* to kill during stale-process cleanup.
 *
 * Port-based cleanup (`lsof -ti :PORT` → `kill -9`) is a footgun when two
 * subsystems share a port number: an iOS device whose default mjpegServerPort is
 * 9100 collides with the Android stream's PortAllocator lease at 9100, so a
 * failing iOS device's cleanup would kill a *healthy* Android neighbour's stream.
 *
 * We only own a process if its command line references this device's udid — the
 * iproxy forwards (`iproxy -u <udid> …`) and go-ios/WDA processes we spawn all
 * carry it. A process on the port whose command mentions a *different* udid, or
 * no udid at all, belongs to someone else and must be left alone.
 */
export function isOwnStreamProcess(processCommand: string, udid: string): boolean {
  if (!processCommand || !udid) return false;
  return processCommand.includes(udid);
}
