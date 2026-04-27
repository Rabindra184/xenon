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
import { addAnnotation } from '../../api-service/recordings';

interface DeviceRow {
  udid: string;
  name?: string;
  platform?: string;
  busy?: boolean;
  session_id?: string;
  mjpegServerPort?: number;
}

function inferReason(d: DeviceRow): string | undefined {
  if (!d.busy) return undefined;
  if (!d.session_id) return 'unknown';
  if (d.session_id.startsWith('manual_')) return 'manual_other';
  return 'automation';
}

function asPickerDevice(d: DeviceRow): PickerDevice {
  return {
    udid: d.udid,
    name: d.name,
    platform: d.platform,
    busy: d.busy,
    busyReason: inferReason(d),
    mjpegServerPort: d.mjpegServerPort,
  };
}

export default function DeviceMosaicView() {
  const [state, dispatch] = useMosaicReducer();
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

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

  // If a previously-selected device became busy, drop it from the selection.
  useEffect(() => {
    if (state.selected.size === 0) return;
    const busyNow = new Set(devices.filter((d) => d.busy).map((d) => d.udid));
    const selectedList = Array.from(state.selected);
    const removed: string[] = [];
    selectedList.forEach((u) => {
      if (busyNow.has(u)) removed.push(u);
    });
    if (removed.length > 0) {
      removed.forEach((u) => dispatch({ type: 'TOGGLE_SELECTED', udid: u }));
      dispatch({
        type: 'SET_ERROR_BANNER',
        message: 'A selected device became busy and was removed from your selection.',
      });
    }
  }, [devices, state.selected, dispatch]);

  const pickerDevices = useMemo(() => devices.map(asPickerDevice), [devices]);

  const onAddToMosaic = async () => {
    const tiles: MosaicTile[] = [];
    for (const udid of Array.from(state.selected)) {
      try {
        const r = await fetch(`/xenon/api/control/${encodeURIComponent(udid)}/stream/start`, {
          method: 'POST',
        });
        if (!r.ok) continue;
        const body = await r.json();
        tiles.push({ udid, mjpegPort: body.mjpegPort });
      } catch {
        /* skip */
      }
    }
    dispatch({ type: 'SET_TILES', tiles });
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
            selectedUdids={state.tiles.length > 0
              ? state.tiles.map((t) => t.udid)
              : Array.from(state.selected)}
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
          <aside className="flex flex-col gap-2 border border-[var(--border)] rounded p-3 overflow-y-auto">
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
              selected={state.selected}
              onToggle={(u) => dispatch({ type: 'TOGGLE_SELECTED', udid: u })}
            />
            <button
              onClick={onAddToMosaic}
              disabled={state.selected.size === 0 || state.recording}
              className="mt-2 px-3 py-1.5 text-sm rounded bg-[var(--accent,#3b82f6)] text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add to mosaic ({state.selected.size})
            </button>
          </aside>

          <main className="border border-[var(--border)] rounded p-2 overflow-hidden">
            <DeviceMosaic
              layout={state.layout}
              tiles={state.tiles}
              annotateMode={state.annotateMode}
              shape={state.shape}
              color={state.color}
              onAnnotation={onAnnotation}
            />
          </main>
        </div>
      </div>
    </MosaicContext.Provider>
  );
}
