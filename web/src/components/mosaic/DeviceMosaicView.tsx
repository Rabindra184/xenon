import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  MosaicContext,
  gridCanChange,
  recordingIdsByPhone,
  useMosaicReducer,
  type AnnotationShape,
  type MosaicAction,
  type MosaicState,
  type MosaicTile,
  type OverlayAnnotation,
} from './recording-group-store';
import { DevicePicker, type PickerDevice } from './DevicePicker';
import { LayoutSelector } from './LayoutSelector';
import { DeviceMosaic } from './DeviceMosaic';
import { RecordingControls } from './RecordingControls';
import { IdleWarningModal } from './IdleWarningModal';
import { IdleReleaseBanner } from './IdleReleaseBanner';
import {
  deviceLabel,
  pickerToggle,
  startRefusesTile,
  tileAspect,
  tileFromDevice,
  type DeviceRow,
} from './mosaicDevices';
import { idleWatchEnabled, planRestore, releaseMessage, restoreMessage } from './idleRestore';
import XenonApiService from '../../api-service';
import { controlUrl, phoneKey, samePhone, type PhoneRef } from '../../lib/phone';
import { busyReason, isRehydratableTile } from './manual-lock';
import { addAnnotation, clearAnnotations, getActiveRecordings } from '../../api-service/recordings';
import { createWriteQueue } from './writeQueue';
import { useIdleDetector } from '../../hooks/useIdleDetector';
import { Tv } from 'lucide-react';
import { PageTitle } from '../ui/page-header';

// Idle thresholds for the manual-session warning + release.
// 5 min total — same shape ADF uses; matches the hub-side OrphanSweeper's
// session-heartbeat-driven release floor (default ~120 s).
const IDLE_TOTAL_MS = 5 * 60 * 1000;
const IDLE_WARNING_SEC = 30;
const GRID_LOCKED = 'Stop recording before changing the devices on the grid.';

function asPickerDevice(d: DeviceRow, myUserId: string | null): PickerDevice {
  return {
    udid: d.udid,
    host: d.host,
    name: deviceLabel(d),
    // The codename still finds it when typed into the filter.
    altName: d.name,
    platform: d.platform,
    busy: d.busy,
    busyReason: busyReason(d, myUserId),
    mjpegServerPort: d.mjpegServerPort,
    offline: !!d.offline,
  };
}

export default function DeviceMosaicView() {
  const [state, dispatch] = useMosaicReducer();
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [devicesStatus, setDevicesStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refreshKey, setRefreshKey] = useState(0);
  // Identity of the dashboard caller — drives the self/other distinction
  // for manual-control locks. Fetched once on mount from /auth/me.
  const [myUserId, setMyUserId] = useState<string | null>(null);
  // Guards the one-shot tile rehydration below, which is keyed on myUserId.
  const rehydratedRef = React.useRef(false);
  // One ordered lane for mark and clear writes; see createWriteQueue.
  const writes = React.useRef(createWriteQueue());
  // The state as last rendered, for handlers that run after an await.
  const stateRef = React.useRef(state);
  stateRef.current = state;
  // Phones the person took off the grid since the page loaded: the load's
  // rehydrate, still running, mustn't put them back.
  const removedSinceLoad = React.useRef(new Set<string>());

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
        if (cancelled) return;
        setDevices(Array.isArray(list) ? list : []);
        setDevicesStatus('ready');
      } catch {
        // Keeps the last list; an empty one now says why instead of "none online".
        if (!cancelled) setDevicesStatus('error');
      }
    };
    load();
    const t = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [refreshKey]);

  // The phones a test runs on, as the device list (polled above) says, by `phoneKey`.
  const testsRunning = React.useMemo(
    () =>
      new Set(
        devices.filter((d) => busyReason(d, myUserId) === 'automation').map((d) => phoneKey(d)),
      ),
    [devices, myUserId],
  );

  // On mount, rehydrate tiles for any device that the backend is *still*
  // streaming for us (status=running + manual_<udid> lock). Without this,
  // a page refresh leaves the device "busy" with no UI to release it.
  useEffect(() => {
    let cancelled = false;
    // Ownership is now part of the filter, so this must wait for /auth/me to
    // resolve — at mount myUserId is still null and nothing would match.
    // Runs once, on the transition to a known identity.
    if (!myUserId || rehydratedRef.current) return;
    rehydratedRef.current = true;
    (async () => {
      let list: DeviceRow[] = [];
      let tiles: MosaicTile[] = [];
      try {
        const rows = await XenonApiService.getDevices();
        list = Array.isArray(rows) ? rows : [];
        // Only re-adopt devices *I* hold. Matching any `manual_` lock meant a
        // second user's mosaic silently adopted a device the first user was
        // streaming, × button and all.
        const candidates = list.filter((d) => isRehydratableTile(d, myUserId));
        const checks = await Promise.all(
          candidates.map(async (d) => {
            try {
              const r = await fetch(controlUrl(d, 'stream/status'));
              if (!r.ok) return null;
              const j = await r.json();
              return j?.status === 'running' ? d : null;
            } catch {
              return null;
            }
          }),
        );
        tiles = checks
          .filter((d): d is DeviceRow => d !== null)
          .filter((d) => !removedSinceLoad.current.has(phoneKey(d)))
          .map(tileFromDevice);
        if (cancelled) return;
        // Merged, never set: tiles added while this ran stay (their streams
        // are started). Through 2.36 it replaced the grid with its answer.
        if (tiles.length > 0) dispatch({ type: 'MERGE_TILES', tiles });
      } catch {
        /* swallow — rehydration is best-effort */
      }
      // A running recording outlives the page. Without picking it back up, a
      // reload left it recording with no Stop button, and Record started a
      // second capture of the same device.
      try {
        const { serverNow, groups } = await getActiveRecordings();
        const g = groups[0];
        if (cancelled || !g) return;
        // Each recording names its phone by udid and host: two servers can
        // each have an emulator-5554. The recording reads these phones, so
        // they come back even if taken off the grid meanwhile.
        const recorded = g.recordings
          .map((r) => list.find((d) => samePhone(d, r)))
          .filter((d): d is DeviceRow => !!d)
          .map(tileFromDevice);
        if (recorded.length > 0) dispatch({ type: 'MERGE_TILES', tiles: recorded });
        const overlayAnnotations: Record<string, OverlayAnnotation[]> = {};
        for (const a of g.annotations) {
          let geometry: OverlayAnnotation['geometry'];
          try {
            geometry = JSON.parse(a.geometry);
          } catch {
            continue;
          }
          (overlayAnnotations[a.recordingId] ??= []).push({
            shape: a.shape as AnnotationShape,
            color: a.color,
            geometry,
            text: a.text ?? undefined,
          });
        }
        dispatch({
          type: 'REHYDRATE_RECORDING',
          groupId: g.groupId,
          // Rebase onto this browser's clock, so skew between client and
          // server cannot shift new marks' timecodes.
          startedAt: Date.now() - (serverNow - Date.parse(g.startedAt)),
          tileIds: recordingIdsByPhone(g.recordings),
          compositeEnabled: g.compositeEnabled,
          overlayAnnotations,
        });
      } catch {
        /* best-effort: the recording can still be stopped server-side */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Keyed on identity, not on devices[]: re-running when the device list
    // changes would resurrect tiles the user just removed. rehydratedRef keeps
    // it to a single pass even if myUserId settles more than once.
  }, [myUserId, dispatch]);

  // Backfill screen dimensions for tiles added before the device reported them.
  // Android populates screenWidth/height lazily (~first stream via `wm size`);
  // a tile added earlier caches `undefined`, which leaves it non-interactive
  // (tap/swipe need device coords). PATCH_TILE_DIMS only fills missing values
  // and no-ops (same state ref) once known, so this converges without churn.
  useEffect(() => {
    for (const t of state.tiles) {
      if (t.screenWidth && t.screenHeight) continue;
      const d = devices.find((dev) => samePhone(dev, t));
      if (!d) continue;
      const sw = Number(d.screenWidth);
      const sh = Number(d.screenHeight);
      if (Number.isFinite(sw) && sw > 0 && Number.isFinite(sh) && sh > 0) {
        dispatch({
          type: 'PATCH_TILE_DIMS',
          key: phoneKey(t),
          screenWidth: sw,
          screenHeight: sh,
          aspect: tileAspect(d),
        });
      }
    }
  }, [devices, state.tiles, dispatch]);

  // Tile-membership set drives the picker's "is in mosaic" highlight; it's
  // independent of the manual-lock identity check (a device may be in our
  // mosaic but the lock is currently held by a different user — e.g. after
  // an admin force-release).
  const inMosaic = useMemo(() => new Set(state.tiles.map((t) => phoneKey(t))), [state.tiles]);
  const pickerDevices = useMemo(
    () => devices.map((d) => asPickerDevice(d, myUserId)),
    [devices, myUserId],
  );

  // One add path for the device list and Restore after an idle release.
  const addDevice = async (device: DeviceRow) => {
    // The reducer would refuse the tile; don't start a stream for it either.
    if (!gridCanChange(stateRef.current)) return;
    removedSinceLoad.current.delete(phoneKey(device));
    dispatch({ type: 'ADD_TILE', tile: tileFromDevice(device) });
    // Pre-warm the stream. Go through XenonApiService rather than a raw fetch:
    // a raw fetch swallows a 409 (it isn't a rejection), which left the tile
    // stuck on "Starting Stream…" with no explanation when another user held
    // the device. The api-client raises the toast that says who holds it.
    //
    // Only roll the optimistic tile back on a genuine ownership conflict, or
    // a udid two servers have (startRefusesTile). A network blip or a
    // retryable 503 must keep the tile — GET /stream auto-starts the service,
    // so those recover on their own.
    const started = await XenonApiService.startStream(device).catch(() => null);
    if (startRefusesTile(started)) {
      dispatch({ type: 'REMOVE_TILE', key: phoneKey(device) });
    }
  };

  // Click-to-toggle: a single click on a picker row adds the device to the
  // mosaic (if not present) or removes it (if present). Replaces the prior
  // checkbox + "Add to mosaic" two-step flow. `key` is the row's `phoneKey`
  // (from a click or a drop): two servers can each have a phone of one udid.
  const onTogglePickerRow = async (key: string) => {
    const current = stateRef.current;
    const tile = current.tiles.find((t) => phoneKey(t) === key);
    const action = pickerToggle(!!tile, current);
    if (action === 'blocked') {
      dispatch({ type: 'SET_ERROR_BANNER', message: GRID_LOCKED });
      return;
    }
    if (action === 'remove' && tile) {
      // Same path as the tile's × button.
      await onRemoveTile(tile);
      return;
    }
    const device = devices.find((d) => phoneKey(d) === key);
    if (!device) return;
    await addDevice(device);
  };

  // The × names its phone, udid and host, and that phone is left even when
  // the store no longer has its tile: looking the tile up by udid took the
  // first phone of that udid, or found none and left nothing.
  const onRemoveTile = async (phone: PhoneRef) => {
    // While a recording starts, runs or stops the tile stays (the reducer
    // refuses it), so its phone mustn't be left either: through 2.36 the
    // leave was sent anyway, for a phone the recording was reading.
    if (!gridCanChange(stateRef.current)) {
      dispatch({ type: 'SET_ERROR_BANNER', message: GRID_LOCKED });
      return;
    }
    removedSinceLoad.current.add(phoneKey(phone));
    // Optimistic: drop the tile immediately so the user sees the change.
    dispatch({ type: 'REMOVE_TILE', key: phoneKey(phone) });
    // Best-effort release: the backend stops the stream and unblocks the
    // device once nobody else is watching it (a device control tab, another
    // tile). If this fails (network, device gone), the watchdog's
    // idle-timeout still releases it eventually.
    try {
      await fetch(controlUrl(phone, 'stream/leave'), {
        method: 'POST',
      });
    } catch {
      /* best-effort */
    }
    setRefreshKey((k) => k + 1);
  };

  const onAnnotation = (recordingId: string, ann: any, image?: string | null) => {
    if (!state.groupId) return;
    const groupId = state.groupId;
    // Stamp at the moment of drawing, not when the queued request finally leaves.
    const timecodeMs = state.startedAt ? Date.now() - state.startedAt : 0;
    const body = {
      recordingId,
      timecodeMs,
      shape: ann.shape,
      geometry: JSON.stringify(ann.geometry),
      color: ann.color,
      text: ann.text,
    };
    void writes.current
      .enqueue(async () => {
        try {
          return await addAnnotation(groupId, image ? { ...body, image } : body);
        } catch (e) {
          // An image the server refuses must not lose the mark: it still renders, as a box.
          if (!image) throw e;
          return addAnnotation(groupId, body);
        }
      })
      .catch((e: any) =>
        dispatch({ type: 'SET_ERROR_BANNER', message: `Annotation failed: ${e.message}` }),
      );
  };

  const onClearMarks = () => {
    if (!state.groupId) return;
    const groupId = state.groupId;
    const timecodeMs = state.startedAt ? Date.now() - state.startedAt : 0;
    dispatch({ type: 'CLEAR_OVERLAY_ANNOTATIONS' });
    void writes.current
      .enqueue(() => clearAnnotations(groupId, timecodeMs))
      .catch(() =>
        dispatch({
          type: 'SET_ERROR_BANNER',
          message: "Couldn't clear marks from the recording. They will still appear in the video.",
        }),
      );
  };

  // Release every locked device. Used both by the user's "Release now" click
  // and by the idle-timeout firing. Uses sendBeacon so the request survives a
  // tab close. Best-effort — the hub-side OrphanSweeper backstops anything
  // that doesn't land.
  const releaseAll = () => {
    if (!gridCanChange(stateRef.current)) return;
    for (const tile of state.tiles) {
      // Leave, not stop: a device also open in another tab stays held for it.
      const url = controlUrl(tile, 'stream/leave');
      // sendBeacon doesn't send JSON content-type; the route accepts an empty
      // body so this is safe.
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(url);
        } else {
          fetch(url, { method: 'POST', keepalive: true }).catch(() => undefined);
        }
      } catch {
        /* best-effort */
      }
    }
    state.tiles.forEach((t) => dispatch({ type: 'REMOVE_TILE', key: phoneKey(t) }));
  };

  // After an automatic release: what to say, and the tiles Restore can bring
  // back (null once Restore has run). The person was away when it happened,
  // so it stays until dismissed rather than fading like a toast.
  const [idleNotice, setIdleNotice] = useState<{
    message: string;
    tiles: MosaicTile[] | null;
  } | null>(null);

  const onRestoreReleased = async () => {
    const saved = idleNotice?.tiles;
    if (!saved) return;
    const plan = planRestore(saved, devices, myUserId);
    for (const d of plan.restore) await addDevice(d);
    const note = restoreMessage(plan.restore.length, plan.skipped);
    setIdleNotice(note ? { message: note, tiles: null } : null);
    setRefreshKey((k) => k + 1);
  };

  // Only run the idle watchdog when the user has at least one device tiled.
  // No tiles → nothing to release → no warning.
  const idle = useIdleDetector({
    idleAfterMs: IDLE_TOTAL_MS,
    warningSec: IDLE_WARNING_SEC,
    // Never during a recording: the release stops the streams the recording
    // reads from, and the whole recording is lost.
    enabled: idleWatchEnabled(state.tiles.length, state.recordingPhase),
    onWarning: () => {
      // Surface the warning banner; the modal renders below based on
      // idle.warning. Nothing else to do here.
    },
    onTimeout: () => {
      const released = state.tiles;
      releaseAll();
      setIdleNotice({
        message: releaseMessage(released.length, IDLE_TOTAL_MS / 60_000),
        tiles: released,
      });
    },
  });

  return (
    <MosaicContext.Provider value={{ state, dispatch }}>
      <div className="flex flex-col h-full p-4 gap-3">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <PageTitle icon={Tv}>Live devices</PageTitle>
            <LayoutSelector
              value={state.layout}
              onChange={(l) => dispatch({ type: 'SET_LAYOUT', layout: l })}
            />
          </div>
          <RecordingControls phones={state.tiles} onClearMarks={onClearMarks} />
        </header>

        {state.banner && (
          <div
            role="alert"
            className={`text-sm rounded border px-3 py-2 flex items-center gap-2 ${
              state.banner.tone === 'error'
                ? 'border-[rgb(var(--rgb-red)/0.4)] bg-[rgb(var(--rgb-red)/0.1)] text-[var(--red-100)]'
                : 'border-[rgb(var(--rgb-success)/0.4)] bg-[rgb(var(--rgb-success)/0.1)] text-[var(--text)]'
            }`}
          >
            <span className="flex-1">{state.banner.message}</span>
            <button
              type="button"
              className="text-xs opacity-80 hover:opacity-100"
              onClick={() => dispatch({ type: 'SET_BANNER', banner: null })}
            >
              Dismiss
            </button>
          </div>
        )}

        {idleNotice && (
          <IdleReleaseBanner
            message={idleNotice.message}
            onRestore={idleNotice.tiles && gridCanChange(state) ? onRestoreReleased : undefined}
            onDismiss={() => setIdleNotice(null)}
          />
        )}

        <div className="grid grid-cols-[260px_1fr] gap-3 flex-1 min-h-0">
          <aside className="flex flex-col gap-2 border border-[var(--border)] rounded p-3 overflow-y-auto min-h-0">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-dim)]">Devices</span>
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
              status={devicesStatus}
            />
            <p className="mt-2 text-caption text-[var(--text-dim)] leading-relaxed">
              Click a device to add it to the grid. Record captures every device on the grid; after
              Stop, download the video.
            </p>
          </aside>

          <main className="border border-[var(--border)] rounded p-2 overflow-y-auto h-full min-h-0">
            <DeviceMosaic
              layout={state.layout}
              tiles={state.tiles}
              annotateMode={state.annotateMode}
              shape={state.shape}
              color={state.color}
              overlayAnnotationsByRecording={state.overlayAnnotations}
              onOverlayAnnotationsChange={(recordingId, annotations) =>
                dispatch({ type: 'SET_OVERLAY_ANNOTATIONS', recordingId, annotations })
              }
              onAnnotation={onAnnotation}
              onRemove={onRemoveTile}
              onDropDevice={onTogglePickerRow}
              testsRunning={testsRunning}
            />
          </main>
        </div>
      </div>

      {idle.warning && idle.remainingSec !== null && (
        <IdleWarningModal
          remainingSec={idle.remainingSec}
          onContinue={idle.reset}
          onReleaseNow={releaseAll}
        />
      )}
    </MosaicContext.Provider>
  );
}
