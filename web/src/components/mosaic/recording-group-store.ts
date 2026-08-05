// Local state store for the mosaic page. Uses React's built-in useReducer +
// Context — keeps "no new dependencies" honest (zustand isn't installed).

import { createContext, useContext, useReducer, type Dispatch } from 'react';

export type Layout = '1' | '2x1' | '2x2' | '3x2' | 'auto';

/**
 * Resolve `auto` to a concrete grid layout based on tile count.
 * Stable layouts above each threshold so the user doesn't see the grid
 * flicker between 2×1 and 2×2 every time they add/remove a tile.
 */
export function effectiveLayout(layout: Layout, tileCount: number): Exclude<Layout, 'auto'> {
  if (layout !== 'auto') return layout;
  if (tileCount <= 1) return '1';
  if (tileCount === 2) return '2x1';
  if (tileCount <= 4) return '2x2';
  return '3x2';
}
export type AnnotationShape = 'RECT' | 'CIRCLE' | 'ARROW' | 'TEXT' | 'FREEHAND';

/** Toolbar / recording lifecycle — prevents double-submit during start/stop. */
export type RecordingPhase = 'idle' | 'starting' | 'recording' | 'stopping';

export interface MosaicTile {
  udid: string;
  name?: string;
  mjpegPort: number;
  recordingId?: string;
  // Optional CSS aspect-ratio string e.g. "9 / 16". Computed from the
  // device's platform/screen dimensions by the page; absent ⇒ 9/16 default.
  aspect?: string;
  // Device-pixel screen dimensions (from WDA/UIAutomator2). Used to translate
  // pointer events on the tile into tap/swipe coords. Absent ⇒ no interaction.
  screenWidth?: number;
  screenHeight?: number;
  // Platform string from the device row (ios | tvos | android | androidtv).
  // Drives platform-aware action strip (Back button on Android, etc.).
  platform?: string;
}

export interface MosaicBanner {
  tone: 'error' | 'info';
  message: string;
}

export interface MosaicState {
  selected: Set<string>;
  layout: Layout;
  tiles: MosaicTile[];
  groupId: string | null;
  /** True when the server actually started a composite ffmpeg for this group. */
  compositeEnabled: boolean;
  /** How many playable per-device videos the last stop reported. */
  downloadableVideoCount: number;
  recordingPhase: RecordingPhase;
  /** Convenience: true while actively recording or stopping. */
  recording: boolean;
  startedAt: number | null;
  annotateMode: boolean;
  shape: AnnotationShape;
  color: string;
  /** @deprecated Prefer `banner` — kept so older dispatches still type-check via SET_ERROR_BANNER. */
  errorBanner: string | null;
  banner: MosaicBanner | null;
}

export const initialMosaicState: MosaicState = {
  selected: new Set(),
  layout: '2x2',
  tiles: [],
  groupId: null,
  compositeEnabled: false,
  downloadableVideoCount: 0,
  recordingPhase: 'idle',
  recording: false,
  startedAt: null,
  annotateMode: false,
  shape: 'RECT',
  color: '#ff3333',
  errorBanner: null,
  banner: null,
};

export type MosaicAction =
  | { type: 'SET_LAYOUT'; layout: Layout }
  | { type: 'TOGGLE_SELECTED'; udid: string }
  | { type: 'CLEAR_SELECTED' }
  | { type: 'SET_TILES'; tiles: MosaicTile[] }
  | { type: 'ADD_TILE'; tile: MosaicTile }
  | { type: 'REMOVE_TILE'; udid: string }
  | { type: 'BIND_RECORDING_IDS'; map: Record<string, string> }
  | { type: 'SET_RECORDING_PHASE'; phase: RecordingPhase }
  | {
      type: 'START_RECORDING';
      groupId: string;
      startedAt: number;
      tileIds: Record<string, string>;
      compositeEnabled?: boolean;
    }
  | {
      type: 'STOP_RECORDING';
      downloadableVideoCount?: number;
      compositeEnabled?: boolean;
    }
  | { type: 'SET_ANNOTATE_MODE'; enabled: boolean }
  | { type: 'SET_SHAPE'; shape: AnnotationShape }
  | { type: 'SET_COLOR'; color: string }
  | { type: 'SET_ERROR_BANNER'; message: string | null }
  | { type: 'SET_BANNER'; banner: MosaicBanner | null };

export function mosaicReducer(state: MosaicState, action: MosaicAction): MosaicState {
  switch (action.type) {
    case 'SET_LAYOUT':
      return { ...state, layout: action.layout };
    case 'TOGGLE_SELECTED': {
      const next = new Set(state.selected);
      if (next.has(action.udid)) next.delete(action.udid);
      else next.add(action.udid);
      return { ...state, selected: next };
    }
    case 'CLEAR_SELECTED':
      return { ...state, selected: new Set() };
    case 'SET_TILES':
      return { ...state, tiles: action.tiles };
    case 'ADD_TILE':
      // Idempotent: don't duplicate if the tile is already in the mosaic.
      if (state.tiles.some((t) => t.udid === action.tile.udid)) return state;
      return { ...state, tiles: [...state.tiles, action.tile] };
    case 'REMOVE_TILE':
      // Block remove while a recording is in flight — avoids tearing down MJPEG
      // under a live ffmpeg.
      if (state.recordingPhase !== 'idle') return state;
      return { ...state, tiles: state.tiles.filter((t) => t.udid !== action.udid) };
    case 'BIND_RECORDING_IDS': {
      const tiles = state.tiles.map((t) => ({
        ...t,
        recordingId: action.map[t.udid] ?? t.recordingId,
      }));
      return { ...state, tiles };
    }
    case 'SET_RECORDING_PHASE': {
      const phase = action.phase;
      return {
        ...state,
        recordingPhase: phase,
        recording: phase === 'recording' || phase === 'stopping',
      };
    }
    case 'START_RECORDING': {
      const tiles = state.tiles.map((t) => ({
        ...t,
        recordingId: action.tileIds[t.udid] ?? t.recordingId,
      }));
      return {
        ...state,
        groupId: action.groupId,
        compositeEnabled: action.compositeEnabled === true,
        downloadableVideoCount: 0,
        recordingPhase: 'recording',
        recording: true,
        startedAt: action.startedAt,
        tiles,
      };
    }
    case 'STOP_RECORDING': {
      // Clear each tile's recordingId too — the per-tile REC badge is driven by
      // recordingId (DeviceTile), so leaving it set keeps a stale "REC" overlay
      // after the recording has stopped until the component remounts.
      // Keep groupId + compositeEnabled so download links still work.
      const tiles = state.tiles.map((t) => ({ ...t, recordingId: undefined }));
      return {
        ...state,
        recording: false,
        recordingPhase: 'idle',
        annotateMode: false,
        downloadableVideoCount:
          action.downloadableVideoCount ?? state.downloadableVideoCount,
        compositeEnabled:
          action.compositeEnabled !== undefined
            ? action.compositeEnabled
            : state.compositeEnabled,
        tiles,
      };
    }
    case 'SET_ANNOTATE_MODE':
      return { ...state, annotateMode: action.enabled };
    case 'SET_SHAPE':
      return { ...state, shape: action.shape };
    case 'SET_COLOR':
      return { ...state, color: action.color };
    case 'SET_ERROR_BANNER':
      return {
        ...state,
        errorBanner: action.message,
        banner: action.message ? { tone: 'error', message: action.message } : null,
      };
    case 'SET_BANNER':
      return {
        ...state,
        banner: action.banner,
        errorBanner: action.banner?.tone === 'error' ? action.banner.message : null,
      };
    default:
      return state;
  }
}

export const MosaicContext = createContext<{
  state: MosaicState;
  dispatch: Dispatch<MosaicAction>;
} | null>(null);

export function useMosaic() {
  const ctx = useContext(MosaicContext);
  if (!ctx) throw new Error('useMosaic must be used inside <MosaicContext.Provider>');
  return ctx;
}

export function useMosaicReducer() {
  return useReducer(mosaicReducer, initialMosaicState);
}

/** Format elapsed ms as m:ss or h:mm:ss for the REC timer. */
export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}
