import * as React from 'react';
import { AnnotationOverlay, type NormalizedAnnotation } from './AnnotationOverlay';
import type { AnnotationShape } from './recording-group-store';
import XenonApiService from '../../api-service';
import { ANDROID_KEYCODE, IOS_BUTTON } from '../device-control/keycodes';
import {
  CONNECT_TIMEOUT_MS,
  canAutoRetry,
  describeStreamFailure,
  retryDelayMs,
} from './stream-retry';
import WsH264Player from './WsH264Player';
import { pickStreamPlayer } from './pickStreamPlayer';

interface Props {
  udid: string;
  name?: string;
  mjpegPort: number;
  recordingId?: string;
  annotateMode: boolean;
  shape: AnnotationShape;
  color: string;
  // CSS aspect-ratio string e.g. "9 / 16" or "16 / 9". Defaults to portrait.
  aspect?: string;
  // Device-pixel resolution; required for tap/swipe coord mapping.
  screenWidth?: number;
  screenHeight?: number;
  // Drives the platform-aware action strip (Back on Android, etc.).
  platform?: string;
  onAnnotation: (recordingId: string, ann: NormalizedAnnotation) => void;
  /** Persistent strokes for this tile's recording (from mosaic store). */
  overlayAnnotations?: NormalizedAnnotation[];
  onOverlayAnnotationsChange?: (next: NormalizedAnnotation[]) => void;
  onRemove?: (udid: string) => void;
}

interface Ripple {
  id: number;
  x: number;
  y: number;
}

// Pointer movement (in CSS px) below which we consider the gesture a tap;
// above which we consider it a swipe. Matches the device-control page's 10px.
const TAP_THRESHOLD_PX = 10;
// Hold-down duration (ms) after which a stationary press becomes a long-press
// (touch-and-hold) instead of a tap. Matches device-control.
const LONG_PRESS_MS = 500;

type StreamState = 'connecting' | 'live' | 'unavailable';

export function DeviceTile({
  udid,
  name,
  recordingId,
  annotateMode,
  shape,
  color,
  aspect = '9 / 16',
  screenWidth,
  screenHeight,
  platform,
  onAnnotation,
  overlayAnnotations,
  onOverlayAnnotationsChange,
  onRemove,
}: Props) {
  const [streamState, setStreamState] = React.useState<StreamState>('connecting');
  const [retryKey, setRetryKey] = React.useState(0);
  // When set, this Android tile renders the WebCodecs H.264 player instead of
  // the MJPEG <img>. Cleared on fatal error to fall back to MJPEG.
  const [h264WsUrl, setH264WsUrl] = React.useState<string | null>(null);
  // Number of connect attempts that have failed (drives bounded auto-retry).
  // A ref, not state — bumping it must not itself trigger a re-render/effect.
  const attemptRef = React.useRef(0);
  // Pending backoff timer between a failed attempt and its auto-retry.
  const retryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Human-readable reason shown on the terminal "unavailable" overlay, fetched
  // from GET /stream/status once auto-retries are exhausted.
  const [failureReason, setFailureReason] = React.useState<string>('');
  const [ripples, setRipples] = React.useState<Ripple[]>([]);
  // Whether this tile is the keyboard-input target. Click on the tile to
  // claim focus; clicks elsewhere on the page release it via blur.
  const [keyboardActive, setKeyboardActive] = React.useState(false);
  const interactionRef = React.useRef<HTMLDivElement>(null);
  // Active pointer-down bookkeeping, used to discriminate tap vs swipe on up.
  const pointerDownRef = React.useRef<{
    startX: number;
    startY: number;
    startTime: number;
    rect: DOMRect;
  } | null>(null);

  const isAndroid = platform === 'android' || platform === 'androidtv' || platform === 'android-tv';
  const isIOS = platform === 'ios' || platform === 'tvos';

  // Decide MJPEG vs H.264 for this tile. The backend advertises `type` on
  // /stream/status (flag-gated, Android-only); if H.264 and the browser has
  // WebCodecs, mint a stream ticket and switch to the WebCodecs player. Any
  // failure silently leaves the MJPEG <img> in place.
  //
  // While this tile is being recorded, always use MJPEG: the recording
  // pipeline stops H.264 and feeds ffmpeg from the MJPEG server. Staying on
  // a dead WebSocket freezes the live preview and blocks tap/swipe (gated on
  // streamState === 'live').
  React.useEffect(() => {
    let cancelled = false;
    if (recordingId) {
      setH264WsUrl(null);
      setStreamState('connecting');
      setRetryKey(Date.now());
      // Warm / confirm MJPEG so the <img> gets frames quickly after the switch.
      fetch(`/xenon/api/control/${encodeURIComponent(udid)}/stream/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).catch(() => undefined);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasWebCodecs = typeof (window as any).VideoDecoder !== 'undefined';
    (async () => {
      try {
        const enc = encodeURIComponent(udid);
        const sr = await fetch(`/xenon/api/control/${enc}/stream/status`);
        if (!sr.ok) return;
        const status = await sr.json();
        if (pickStreamPlayer(platform || '', status?.type, hasWebCodecs) !== 'h264') return;
        if (!status?.h264Path) return;
        const tr = await fetch(`/xenon/api/control/${enc}/stream/ticket`, { method: 'POST' });
        if (!tr.ok) return;
        const { ticket } = await tr.json();
        if (cancelled || !ticket) return;
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const url = `${proto}://${window.location.host}${status.h264Path}?ticket=${encodeURIComponent(ticket)}`;
        setH264WsUrl(url);
        // Stay 'connecting' until the first frame decodes (WsH264Player.onReady)
        // — otherwise the tile is interactive over a black canvas during
        // screenrecord's multi-second cold start.
      } catch {
        /* leave MJPEG in place */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [udid, platform, recordingId]);

  // Tap/swipe interaction. Disabled in annotate mode (overlay handles that)
  // and when device dimensions are unknown (we can't translate pointer →
  // device coords reliably without screenWidth/screenHeight).
  // Keep interaction available during recording so browser taps are captured
  // on the device and appear in both the live preview and the mp4.
  const interactive = !annotateMode && !!screenWidth && !!screenHeight;

  const toDeviceCoords = (clientX: number, clientY: number, rect: DOMRect) => {
    const w = screenWidth as number;
    const h = screenHeight as number;
    const nx = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const ny = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    return { x: Math.round(nx * w), y: Math.round(ny * h) };
  };

  const spawnRipple = (clientX: number, clientY: number, rect: DOMRect) => {
    const id = Date.now() + Math.random();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    setRipples((rs) => [...rs, { id, x, y }]);
    window.setTimeout(() => {
      setRipples((rs) => rs.filter((r) => r.id !== id));
    }, 500);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || streamState === 'unavailable') return;
    if (e.button !== 0) return; // only left/primary
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    pointerDownRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTime: Date.now(),
      rect: target.getBoundingClientRect(),
    };
    spawnRipple(e.clientX, e.clientY, pointerDownRef.current.rect);
    // Claim keyboard focus so subsequent typing is routed to this device.
    target.focus();
  };

  const onPointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerDownRef.current;
    pointerDownRef.current = null;
    if (!start || !interactive) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const dx = e.clientX - start.startX;
    const dy = e.clientY - start.startY;
    const distance = Math.hypot(dx, dy);
    const elapsedMs = Date.now() - start.startTime;
    const from = toDeviceCoords(start.startX, start.startY, start.rect);
    const isStationary = distance < TAP_THRESHOLD_PX;
    try {
      if (isStationary && elapsedMs < LONG_PRESS_MS) {
        await XenonApiService.tap(udid, from.x, from.y);
      } else if (isStationary) {
        // Stationary press held longer than the long-press threshold.
        await (XenonApiService as any).touchAndHold?.(udid, from.x, from.y, elapsedMs);
      } else {
        const to = toDeviceCoords(e.clientX, e.clientY, start.rect);
        await XenonApiService.swipe(udid, from.x, from.y, to.x, to.y);
      }
    } catch (err) {
      console.error(`[DeviceTile] gesture failed for ${udid}`, err);
    }
  };

  const onPointerCancel = () => {
    pointerDownRef.current = null;
  };

  // Keyboard input: typed characters → /text, special keys → /keyevent.
  // Special-key mapping is platform-aware; iOS WDA only exposes hardware
  // buttons, so most editing keys go through the text endpoint with
  // their string representation (e.g., '\b', '\n').
  const onKeyDown = async (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!interactive || streamState === 'unavailable') return;
    // Allow native browser shortcuts to pass through.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    try {
      if (k.length === 1) {
        e.preventDefault();
        await XenonApiService.typeText(udid, k);
        return;
      }
      // Common editing keys
      if (k === 'Backspace') {
        e.preventDefault();
        if (isAndroid) {
          await XenonApiService.pressKey(udid, 67); // KEYCODE_DEL
        } else {
          await XenonApiService.typeText(udid, '\b');
        }
        return;
      }
      if (k === 'Enter') {
        e.preventDefault();
        if (isAndroid) {
          await XenonApiService.pressKey(udid, 66); // KEYCODE_ENTER
        } else {
          await XenonApiService.typeText(udid, '\n');
        }
        return;
      }
      if (k === 'Tab') {
        e.preventDefault();
        await XenonApiService.typeText(udid, '\t');
        return;
      }
      // Hardware/system keys via /keyevent. Android has named keycodes for
      // most of these; iOS has named buttons via WDA.
      if (k === 'Escape' && isAndroid) {
        e.preventDefault();
        await XenonApiService.pressKey(udid, ANDROID_KEYCODE.BACK);
      }
    } catch (err) {
      console.error(`[DeviceTile] keystroke "${k}" failed for ${udid}`, err);
    }
  };

  // Hardware-button helpers used by the per-tile action strip.
  const sendHome = () =>
    XenonApiService.pressKey(udid, isAndroid ? ANDROID_KEYCODE.HOME : IOS_BUTTON.HOME).catch(
      (err) => console.error(`[DeviceTile] home failed for ${udid}`, err),
    );
  const sendBack = () =>
    XenonApiService.pressKey(udid, ANDROID_KEYCODE.BACK).catch((err) =>
      console.error(`[DeviceTile] back failed for ${udid}`, err),
    );
  const sendAppSwitch = () =>
    XenonApiService.pressKey(udid, ANDROID_KEYCODE.APP_SWITCH).catch((err) =>
      console.error(`[DeviceTile] app-switch failed for ${udid}`, err),
    );
  const captureScreenshot = async () => {
    try {
      const r: any = await XenonApiService.getScreenshot(udid);
      const b64 = r?.screenshot ?? r?.value ?? r;
      if (!b64) return;
      const blob = await fetch(`data:image/png;base64,${b64}`).then((x) => x.blob());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name || udid}-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error(`[DeviceTile] screenshot failed for ${udid}`, err);
    }
  };

  // Diagnostic Log: Verify tile is rendering and its state
  React.useEffect(() => {
    console.log(`[DeviceTile] Rendering ${udid} in state: ${streamState}`);
  }, [udid, streamState]);

  // Cache buster to ensure the browser doesn't reuse a failed/stale stream connection
  const proxyUrl = `/xenon/api/control/${encodeURIComponent(udid)}/stream?t=${retryKey}`;

  // Fetch the real failure reason from the backend once retries are exhausted,
  // so the "unavailable" overlay explains *why* (WDA not installed, unsupported
  // iOS, lost tunnel, …) instead of a hardcoded "port 9100" guess. Best-effort.
  const loadFailureReason = React.useCallback(async () => {
    try {
      const r = await fetch(`/xenon/api/control/${encodeURIComponent(udid)}/stream/status`);
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      setFailureReason(describeStreamFailure({ lastError: j?.lastError, status: j?.status }));
    } catch {
      setFailureReason(describeStreamFailure({}));
    }
  }, [udid]);

  // A single connect attempt failed (either the <img> errored, or it never
  // produced a frame within the connect window). Auto-retry with backoff a
  // bounded number of times before showing a terminal failure — a healthy
  // device whose cold-start was slowed by a busy/broken neighbour recovers on a
  // later attempt instead of getting stuck on "Connection Failed".
  const onAttemptFailed = React.useCallback(() => {
    const attempt = attemptRef.current;
    if (canAutoRetry(attempt)) {
      attemptRef.current = attempt + 1;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        // Stay in 'connecting'; bumping retryKey re-opens the stream (fresh GET,
        // cache-busted) and restarts the connect-window timer below.
        setStreamState('connecting');
        setRetryKey(Date.now());
      }, retryDelayMs(attempt));
    } else {
      setStreamState('unavailable');
      void loadFailureReason();
    }
  }, [loadFailureReason]);

  // Connect-window watchdog: if the image hasn't loaded within CONNECT_TIMEOUT_MS
  // of an attempt starting, treat it as a failed attempt and let onAttemptFailed
  // decide retry vs. give-up. Re-armed on every (re)connect via retryKey.
  React.useEffect(() => {
    if (streamState !== 'connecting') return;
    // If this timer fires, no onLoad/onError/retry intervened (any of those
    // changes streamState or retryKey and clears it), so we're still connecting.
    const timer = setTimeout(onAttemptFailed, CONNECT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [streamState, retryKey, onAttemptFailed]);

  // Clear any pending backoff timer on unmount.
  React.useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  // Manual retry: reset the attempt budget and reconnect immediately.
  const handleRetry = () => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    attemptRef.current = 0;
    setFailureReason('');
    setStreamState('connecting');
    setRetryKey(Date.now());
  };

  const recording = !!recordingId;
  const displayName = name || udid.slice(0, 16) + '…';

  return (
    <div className="flex items-stretch justify-center w-full h-full min-h-0 min-w-0 gap-2">
      <div
        className="relative bg-[#000] rounded-lg overflow-hidden border border-[var(--border)] group max-h-full max-w-full self-center"
        style={{ aspectRatio: aspect, height: '100%' }}
      >
        {/* Connecting state Overlay */}
        {streamState === 'connecting' && (
          <div className="flex flex-col items-center justify-center bg-neutral-900/80 text-neutral-400 absolute inset-0 z-20 pointer-events-none">
            <div className="relative flex items-center justify-center">
              <div className="w-12 h-12 border-4 border-neutral-800 border-t-neutral-400 rounded-full animate-spin" />
            </div>
            <div className="mt-4 font-bold text-neutral-200">Starting Stream…</div>
            <div className="text-[10px] mt-1 text-neutral-500 opacity-60 font-mono">{udid}</div>
            <div className="text-[10px] mt-4 text-neutral-400 bg-white/5 px-2 py-1 rounded">
              Waiting for device connection...
            </div>
          </div>
        )}

        {/* Unavailable state Overlay */}
        {streamState === 'unavailable' && (
          <div className="flex items-center justify-center bg-black text-neutral-400 absolute inset-0 z-20">
            <div className="text-center p-6">
              <div className="text-5xl mb-4 opacity-20">📵</div>
              <div className="font-bold text-white text-lg">Connection Failed</div>
              <p className="text-xs mt-2 text-neutral-500 leading-relaxed max-w-[240px] mx-auto">
                {failureReason || 'We couldn’t start the live stream for this device.'}
              </p>
              <button
                className="mt-6 text-sm font-semibold px-6 py-2.5 rounded-full bg-red-600 hover:bg-red-500 text-white transition-all shadow-[0_0_20px_rgba(220,38,38,0.3)] active:scale-95"
                onClick={handleRetry}
              >
                Retry Connection
              </button>
            </div>
          </div>
        )}

        {/* H.264 (WebCodecs) player when active; otherwise the MJPEG <img>.
          onFatal clears the ws url so we fall back to MJPEG (which resumes its
          own connect/retry machine). */}
        {h264WsUrl ? (
          <WsH264Player
            wsUrl={h264WsUrl}
            className="absolute inset-0 w-full h-full object-contain bg-black select-none pointer-events-none"
            onReady={() => setStreamState('live')}
            onFatal={() => {
              console.warn(`[DeviceTile] H.264 fatal for ${udid}; falling back to MJPEG`);
              setH264WsUrl(null);
              setStreamState('connecting');
              setRetryKey(Date.now());
            }}
          />
        ) : (
          <img
            key={retryKey}
            src={proxyUrl}
            alt={displayName}
            className="absolute inset-0 w-full h-full object-contain bg-black select-none pointer-events-none"
            draggable={false}
            style={{
              opacity: streamState === 'live' ? 1 : 0,
              transition: 'opacity 0.3s ease-in-out',
            }}
            onLoad={() => {
              console.log(`[DeviceTile] Image LOADED for ${udid}`);
              // A frame arrived: healthy. Reset the retry budget so a later mid-
              // stream drop gets its own fresh set of auto-retries.
              attemptRef.current = 0;
              if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
              setStreamState('live');
            }}
            onError={(e) => {
              console.error(`[DeviceTile] Image ERROR for ${udid}`, e);
              // Don't dead-end: let the retry policy decide (auto-retry with backoff,
              // then a terminal failure with the real reason).
              onAttemptFailed();
            }}
          />
        )}

        {/* Interaction surface: above the inert annotation canvas (z-25) so
          tap/swipe resume immediately after Annotate is toggled off. While
          annotateMode is on this layer unmounts and the overlay (z-40) draws. */}
        {interactive && streamState !== 'unavailable' && (
          <div
            ref={interactionRef}
            className={`absolute inset-0 z-[35] touch-none outline-none ${
              keyboardActive ? 'ring-2 ring-emerald-400/60 ring-inset rounded-lg' : ''
            }`}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onKeyDown={onKeyDown}
            onFocus={() => setKeyboardActive(true)}
            onBlur={() => setKeyboardActive(false)}
          />
        )}

        {/* Tap ripples — quick visual confirmation that the gesture registered,
          shown above the interaction surface but below HUD elements. */}
        <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
          {ripples.map((r) => (
            <span
              key={r.id}
              className="absolute block w-10 h-10 rounded-full border-2 border-emerald-300/80 animate-ping"
              style={{ left: r.x - 20, top: r.y - 20 }}
            />
          ))}
        </div>

        {/* Keep the overlay mounted for the whole recording so strokes survive
          annotate toggle / stream reconnect remounts of sibling UI. */}
        {recording && (
          <AnnotationOverlay
            enabled={annotateMode}
            shape={shape}
            color={color}
            committed={overlayAnnotations}
            onCommittedChange={onOverlayAnnotationsChange}
            onCommit={(a) => onAnnotation(recordingId!, a)}
          />
        )}

        {recording && annotateMode && streamState === 'live' && (
          <div className="absolute bottom-3 left-3 right-3 z-30 pointer-events-none">
            <div className="px-2 py-1 rounded bg-black/70 text-[10px] text-amber-100 border border-amber-500/40 text-center">
              Annotate on — drag on the preview. Shapes stay on screen and appear in
              Download video from that moment. Toggle Annotate off to tap the device.
            </div>
          </div>
        )}

        {/* REC badge — always visible while recording so the user can see at
          a glance which devices are being captured. Sits above the
          interaction surface but doesn't capture events. */}
        {recording && (
          <div className="absolute top-3 left-3 z-30 pointer-events-none">
            <span className="px-2 py-0.5 rounded-sm bg-red-600 text-white text-[9px] font-black shadow-lg">
              REC
            </span>
          </div>
        )}

        {/* Hover HUD — LIVE badge + device name fade in only when the user
          moves over the tile, so the device screen is unobstructed during
          normal interaction. */}
        <div className="absolute top-3 left-3 z-30 flex flex-col gap-1.5 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          {streamState === 'live' && (
            <span className="px-2 py-0.5 rounded-sm bg-emerald-500 text-black text-[9px] font-black shadow-lg w-fit">
              LIVE
            </span>
          )}
          <span className="px-2 py-1 rounded bg-black/80 text-white text-[11px] font-medium backdrop-blur-md border border-white/10 shadow-xl truncate max-w-[180px]">
            {displayName}
          </span>
        </div>
      </div>

      {/* Side-rail action column — sits to the right of the device, sized to
        the device's height. Buttons distribute evenly across the available
        height so they stay reachable on small grid cells. */}
      <ActionColumn
        streamState={streamState}
        recording={recording}
        isIOS={isIOS}
        isAndroid={isAndroid}
        platform={platform}
        onClose={!recording && onRemove ? () => onRemove(udid) : undefined}
        sendHome={sendHome}
        sendBack={sendBack}
        sendAppSwitch={sendAppSwitch}
        captureScreenshot={captureScreenshot}
        displayName={displayName}
      />
    </div>
  );
}

interface ActionColumnProps {
  streamState: StreamState;
  recording: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  platform?: string;
  onClose?: () => void;
  sendHome: () => void | Promise<void>;
  sendBack: () => void | Promise<void>;
  sendAppSwitch: () => void | Promise<void>;
  captureScreenshot: () => void | Promise<void>;
  displayName: string;
}

function ActionColumn({
  streamState,
  recording,
  isIOS,
  isAndroid,
  platform,
  onClose,
  sendHome,
  sendBack,
  sendAppSwitch,
  captureScreenshot,
  displayName,
}: ActionColumnProps) {
  const live = streamState === 'live';
  // Don't render at all when the close button isn't available and the stream
  // isn't live — there's nothing to put in the column.
  if (!onClose && !live) return null;

  return (
    <div className="self-stretch w-9 flex flex-col items-center justify-between gap-1 py-2 rounded-lg bg-black/40 border border-white/10 backdrop-blur-md text-white">
      {/* Top group: close button */}
      <div className="flex flex-col items-center gap-1">
        {onClose && (
          <button
            type="button"
            aria-label={`Remove ${displayName} from mosaic`}
            title="Remove from mosaic"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-red-600/70 transition-colors text-base leading-none"
          >
            ×
          </button>
        )}
      </div>

      {/* Middle group: hardware buttons. Distributed inside a flex column
          with even spacing so they spread out on tall tiles and bunch up
          on short ones without overflowing. */}
      {live && (
        <div className="flex flex-col items-center gap-1.5 my-auto">
          {(isAndroid || isIOS) && (
            <button
              type="button"
              title={`Home${platform ? ` (${platform})` : ''}`}
              onClick={sendHome}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/15 transition-colors text-sm"
            >
              ⌂
            </button>
          )}
          {isAndroid && (
            <button
              type="button"
              title="Back"
              onClick={sendBack}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/15 transition-colors text-sm"
            >
              ‹
            </button>
          )}
          {isAndroid && (
            <button
              type="button"
              title="Recent apps"
              onClick={sendAppSwitch}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/15 transition-colors text-sm"
            >
              ▢
            </button>
          )}
        </div>
      )}

      {/* Bottom group: screenshot */}
      {live && (
        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            title="Screenshot"
            onClick={captureScreenshot}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/15 transition-colors text-sm"
          >
            ⎙
          </button>
        </div>
      )}
    </div>
  );
}
