import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  MosaicContext,
  useMosaicReducer,
  type MosaicAction,
  type MosaicState,
  type MosaicTile,
} from './recording-group-store';
import { DevicePicker, type PickerDevice } from './DevicePicker';
import { LayoutSelector } from './LayoutSelector';
import { DeviceMosaic } from './DeviceMosaic';
import { RecordingControls } from './RecordingControls';
import XenonApiService from '../../api-service';
import { addAnnotation, addBookmark } from '../../api-service/recordings';

interface DeviceRow {
  udid: string;
  name?: string;
  platform?: string;
  busy?: boolean;
  session_id?: string;
  mjpegServerPort?: number;
  screenWidth?: string | number;
  screenHeight?: string | number;
}

// Derive a CSS aspect-ratio string from device data.
// Prefers the WDA-reported screen dimensions (set during stream start);
// falls back to platform conventions (tvos/androidtv → 16:9, else 9:16).
function tileAspect(d?: Partial<DeviceRow>): string {
  if (!d) return '9 / 16';
  const w = Number(d.screenWidth);
  const h = Number(d.screenHeight);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return `${w} / ${h}`;
  }
  const p = (d.platform || '').toLowerCase();
  if (p === 'tvos' || p === 'androidtv' || p === 'android-tv') return '16 / 9';
  return '9 / 16';
}

/**
 * A manual lock is `manual_<actorId>_<udid>`. If our userId matches the
 * actor portion, this is *our* lock. Legacy `manual_<udid>` (no actor)
 * is treated as foreign — we can't prove ownership.
 */
function isSelfManualLock(
  blockId: string,
  udid: string,
  myUserId: string | null,
): boolean {
  if (!myUserId) return false;
  return blockId === `manual_${myUserId}_${udid}`;
}

function inferReason(d: DeviceRow, myUserId: string | null): string | undefined {
  if (!d.busy) return undefined;
  if (!d.session_id) return 'unknown';
  if (d.session_id.startsWith('manual_')) {
    return isSelfManualLock(d.session_id, d.udid, myUserId)
      ? 'manual_self'
      : 'manual_other';
  }
  return 'automation';
}

function asPickerDevice(d: DeviceRow, myUserId: string | null): PickerDevice {
  return {
    udid: d.udid,
    name: d.name,
    platform: d.platform,
    busy: d.busy,
    busyReason: inferReason(d, myUserId),
    mjpegServerPort: d.mjpegServerPort,
  };
}

export default function DeviceMosaicView() {
  const [state, dispatch] = useMosaicReducer();
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  // Identity of the dashboard caller — drives the self/other distinction
  // for manual-control locks. Fetched once on mount from /auth/me.
  const [myUserId, setMyUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/xenon/api/auth/me', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.userId) setMyUserId(data.userId);
      })
      .catch(() => {
        /* not authenticated — picker just falls back to "manual_other" */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Periodically refresh device list so busy state updates as automation
  // sessions come and go. Cheap polling — the dashboard already does this
  // pattern elsewhere.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const list: DeviceRow[] = await XenonApiService.getDevices();
        if (!cancelled) setDevices(Array.isArray(list) ? list : []);
      } catch {
        /* swallow */
      }
    };
    load();
    const t = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [refreshKey]);

  // On mount, rehydrate tiles for any device that the backend is *still*
  // streaming for us (status=running + manual_<udid> lock). Without this,
  // a page refresh leaves the device "busy" with no UI to release it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list: DeviceRow[] = await XenonApiService.getDevices();
        const candidates = (Array.isArray(list) ? list : []).filter(
          (d) => d.busy && d.session_id?.startsWith('manual_'),
        );
        if (candidates.length === 0) return;
        const checks = await Promise.all(
          candidates.map(async (d) => {
            try {
              const r = await fetch(
                `/xenon/api/control/${encodeURIComponent(d.udid)}/stream/status`,
              );
              if (!r.ok) return null;
              const j = await r.json();
              return j?.status === 'running' ? d : null;
            } catch {
              return null;
            }
          }),
        );
        const active = checks.filter((d): d is DeviceRow => d !== null);
        if (cancelled || active.length === 0) return;
        // Use the same tile-builder as the click-to-add path so platform/aspect/
        // screen dimensions are consistent regardless of how the tile entered.
        const tiles: MosaicTile[] = active.map((d) => {
          const sw = Number(d.screenWidth);
          const sh = Number(d.screenHeight);
          return {
            udid: d.udid,
            name: d.name,
            mjpegPort: 0,
            aspect: tileAspect(d),
            screenWidth: Number.isFinite(sw) && sw > 0 ? sw : undefined,
            screenHeight: Number.isFinite(sh) && sh > 0 ? sh : undefined,
            platform: d.platform,
          };
        });
        dispatch({ type: 'SET_TILES', tiles });
      } catch {
        /* swallow — rehydration is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only: rehydrate once. Re-running on every devices[] change would
    // resurrect tiles the user just removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Hotkey: B to add a bookmark mid-recording (spec requirement).
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (e.key !== 'b' && e.key !== 'B') return;
      // Don't fire if the user is typing in an input or textarea.
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!state.recording || !state.groupId) return;
      const label = window.prompt('Bookmark label?');
      if (!label) return;
      const elapsed = state.startedAt ? Date.now() - state.startedAt : 0;
      const firstId = state.tiles.find((t) => t.recordingId)?.recordingId;
      if (!firstId) return;
      try {
        await addBookmark(state.groupId, firstId, elapsed, label);
      } catch (err: any) {
        dispatch({ type: 'SET_ERROR_BANNER', message: `Bookmark failed: ${err.message}` });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.recording, state.groupId, state.startedAt, state.tiles, dispatch]);

  // Tile-membership set drives the picker's "is in mosaic" highlight; it's
  // independent of the manual-lock identity check (a device may be in our
  // mosaic but the lock is currently held by a different user — e.g. after
  // an admin force-release).
  const inMosaic = useMemo(
    () => new Set(state.tiles.map((t) => t.udid)),
    [state.tiles],
  );
  const pickerDevices = useMemo(
    () => devices.map((d) => asPickerDevice(d, myUserId)),
    [devices, myUserId],
  );

  // Build a MosaicTile from a DeviceRow — shared by direct-add and rehydration.
  const tileFromDevice = (device: DeviceRow): MosaicTile => {
    const sw = Number(device.screenWidth);
    const sh = Number(device.screenHeight);
    return {
      udid: device.udid,
      name: device.name,
      mjpegPort: 0,
      aspect: tileAspect(device),
      screenWidth: Number.isFinite(sw) && sw > 0 ? sw : undefined,
      screenHeight: Number.isFinite(sh) && sh > 0 ? sh : undefined,
      platform: device.platform,
    };
  };

  // Click-to-toggle: a single click on a picker row adds the device to the
  // mosaic (if not present) or removes it (if present). Replaces the prior
  // checkbox + "Add to mosaic" two-step flow.
  const onTogglePickerRow = async (udid: string) => {
    const inMosaic = state.tiles.some((t) => t.udid === udid);
    if (inMosaic) {
      // Removing — same path as the tile's × button.
      await onRemoveTile(udid);
      return;
    }
    if (state.recording) {
      dispatch({
        type: 'SET_ERROR_BANNER',
        message: 'Stop recording before changing the mosaic layout.',
      });
      return;
    }
    const device = devices.find((d) => d.udid === udid);
    if (!device) return;
    dispatch({ type: 'ADD_TILE', tile: tileFromDevice(device) });
    // Fire-and-forget stream pre-warm; the GET /stream proxy auto-starts too.
    fetch(`/xenon/api/control/${encodeURIComponent(udid)}/stream/start`, {
      method: 'POST',
    }).catch(() => {
      /* best-effort */
    });
  };

  const onRemoveTile = async (udid: string) => {
    // Optimistic: drop the tile immediately so the user sees the change.
    dispatch({ type: 'REMOVE_TILE', udid });
    // Best-effort release: tells the backend to stop the iOS stream and
    // unblock the device. If this fails (network, device gone), the
    // watchdog's idle-timeout still releases it eventually.
    try {
      await fetch(`/xenon/api/control/${encodeURIComponent(udid)}/stream/stop`, {
        method: 'POST',
      });
    } catch {
      /* best-effort */
    }
    setRefreshKey((k) => k + 1);
  };

  const onAnnotation = async (recordingId: string, ann: any) => {
    if (!state.groupId) return;
    try {
      await addAnnotation(state.groupId, {
        recordingId,
        timecodeMs: state.startedAt ? Date.now() - state.startedAt : 0,
        shape: ann.shape,
        geometry: JSON.stringify(ann.geometry),
        color: ann.color,
        text: ann.text,
      });
    } catch (e: any) {
      dispatch({ type: 'SET_ERROR_BANNER', message: `Annotation failed: ${e.message}` });
    }
  };

  return (
    <MosaicContext.Provider value={{ state, dispatch }}>
      <div className="flex flex-col h-full p-4 gap-3">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold">Live Devices</h1>
            <LayoutSelector
              value={state.layout}
              onChange={(l) => dispatch({ type: 'SET_LAYOUT', layout: l })}
            />
          </div>
          <RecordingControls
            selectedUdids={state.tiles.map((t) => t.udid)}
          />
        </header>

        {state.errorBanner && (
          <div
            role="alert"
            className="text-sm rounded border border-red-500/40 bg-red-500/10 text-red-100 px-3 py-2 flex items-center gap-2"
          >
            <span className="flex-1">{state.errorBanner}</span>
            <button
              className="text-xs opacity-80 hover:opacity-100"
              onClick={() => dispatch({ type: 'SET_ERROR_BANNER', message: null })}
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="grid grid-cols-[260px_1fr] gap-3 flex-1 min-h-0">
          <aside className="flex flex-col gap-2 border border-[var(--border)] rounded p-3 overflow-y-auto min-h-0">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-[var(--text-dim)]">
                Devices
              </span>
              <button
                className="text-xs underline opacity-70 hover:opacity-100"
                onClick={() => setRefreshKey((k) => k + 1)}
              >
                Refresh
              </button>
            </div>
            <DevicePicker
              devices={pickerDevices}
              inMosaic={inMosaic}
              onToggle={onTogglePickerRow}
            />
            <p className="mt-2 text-[11px] text-[var(--text-dim)] leading-relaxed">
              Click a device to add it to the mosaic. Click again (or use the
              × on the tile) to remove it.
            </p>
          </aside>

          <main className="border border-[var(--border)] rounded p-2 overflow-y-auto h-full min-h-0">
            <DeviceMosaic
              layout={state.layout}
              tiles={state.tiles}
              annotateMode={state.annotateMode}
              shape={state.shape}
              color={state.color}
              onAnnotation={onAnnotation}
              onRemove={onRemoveTile}
              onDropDevice={onTogglePickerRow}
            />
          </main>
        </div>
      </div>
    </MosaicContext.Provider>
  );
}
