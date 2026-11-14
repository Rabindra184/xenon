// Local state store for the mosaic page. Uses React's built-in useReducer +
// Context — keeps "no new dependencies" honest (zustand isn't installed).

import { createContext, useContext, useReducer, type Dispatch } from 'react';
import { phoneKey, samePhone, type PhoneRef } from '../../lib/phone';
import type { CompositePart } from '../../api-service/recordings';

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

/** Stroke drawn on the live mosaic preview (also POSTed to the recording API). */
export interface OverlayAnnotation {
  shape: AnnotationShape;
  /**
   * Normalized to the tile (0..1). FREEHAND also carries its path; x/y/w/h stay
   * its bounding box for readers that only draw boxes.
   */
  geometry: { x: number; y: number; w?: number; h?: number; points?: Array<[number, number]> };
  color: string;
  text?: string;
}

/**
 * Where the grid's recording is: the one record of it. Read it through
 * `isRecording` and `gridCanChange`, never by comparing phases at a call site.
 * Through 2.36 a stored `recording` flag (false while starting) sat beside it,
 * and the picker, the reducer, Restore and the toolbar each read a different
 * one.
 */
export type RecordingPhase = 'idle' | 'starting' | 'recording' | 'stopping';

/** A recording is running (and can be stopped or marked once `recording`). */
export function isRecording(state: Pick<MosaicState, 'recordingPhase'>): boolean {
  return state.recordingPhase === 'recording' || state.recordingPhase === 'stopping';
}

/**
 * Whether the devices on the grid may change now: only with no recording
 * starting, running or stopping. A start has already named its phones, so a
 * phone added while it starts gets no recording; one removed under a running
 * recording has its stream stopped under it. The reducer, the device list,
 * the tile's × and Restore all ask this.
 */
export function gridCanChange(state: Pick<MosaicState, 'recordingPhase'>): boolean {
  return state.recordingPhase === 'idle';
}

export interface MosaicTile {
  udid: string;
  /** The phone's server, sent with every request about the tile's phone. */
  host: string;
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
  /** `phoneKey`s: two servers can each have a phone of one udid. */
  selected: Set<string>;
  layout: Layout;
  tiles: MosaicTile[];
  /**
   * The running recording's group while one runs; after it stops, the last
   * group, for its download links.
   */
  groupId: string | null;
  /** True when the server actually started a composite ffmpeg for this group. */
  compositeEnabled: boolean;
  /**
   * The side-by-side video's parts, from the group's summary once it stopped
   * (a phone added while it recorded starts one, the first included); until
   * then, or from an older server, unknown and `compositeEnabled` decides.
   */
  compositeParts?: CompositePart[];
  /** A part of the side-by-side video stopped before the recording did. */
  compositeEndedEarly: boolean;
  /** How many playable per-device videos the last stop reported. */
  downloadableVideoCount: number;
  recordingPhase: RecordingPhase;
  startedAt: number | null;
  annotateMode: boolean;
  shape: AnnotationShape;
  color: string;
  /** Live preview strokes keyed by recording id (survive tile remounts). */
  overlayAnnotations: Record<string, OverlayAnnotation[]>;
  banner: MosaicBanner | null;
}

export const initialMosaicState: MosaicState = {
  selected: new Set(),
  // Auto sizes the grid to the devices on it; a fixed 2x2 gave two portrait
  // phones about a third of the space.
  layout: 'auto',
  tiles: [],
  groupId: null,
  compositeEnabled: false,
  compositeEndedEarly: false,
  downloadableVideoCount: 0,
  recordingPhase: 'idle',
  startedAt: null,
  annotateMode: false,
  shape: 'RECT',
  color: '#ff3333',
  overlayAnnotations: {},
  banner: null,
};

export type MosaicAction =
  | { type: 'SET_LAYOUT'; layout: Layout }
  | { type: 'TOGGLE_SELECTED'; key: string }
  | { type: 'CLEAR_SELECTED' }
  | { type: 'ADD_TILE'; tile: MosaicTile }
  /**
   * Tiles the page found it should have (its own previews, a running
   * recording's phones) after loading: adds those it lacks, keeps every tile
   * it has. Not held back by a recording: these phones are already open.
   */
  | { type: 'MERGE_TILES'; tiles: MosaicTile[] }
  | {
      // Fill in device screen dimensions discovered after the tile was created
      // (Android reports them lazily ~first stream). Enables tap/swipe on tiles
      // added before their dimensions were known.
      type: 'PATCH_TILE_DIMS';
      /** The tile's `phoneKey`. */
      key: string;
      screenWidth: number;
      screenHeight: number;
      aspect?: string;
    }
  /** `key` is the tile's `phoneKey`. */
  | { type: 'REMOVE_TILE'; key: string }
  /** Recording ids by `phoneKey`, as are START_RECORDING's and REHYDRATE_RECORDING's. */
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
      // A reload or navigation lost the page state while the server kept
      // recording; pick the running group back up from GET /recordings/active.
      type: 'REHYDRATE_RECORDING';
      groupId: string;
      startedAt: number;
      tileIds: Record<string, string>;
      compositeEnabled: boolean;
      overlayAnnotations: Record<string, OverlayAnnotation[]>;
    }
  | {
      type: 'STOP_RECORDING';
      downloadableVideoCount?: number;
      compositeEnabled?: boolean;
    }
  /**
   * The stopped group's side-by-side video, from its summary. Ignored for any
   * other group, or once another recording has started.
   */
  | {
      type: 'SET_COMPOSITE';
      groupId: string;
      hasComposite: boolean;
      parts?: CompositePart[];
      endedEarly: boolean;
    }
  /** The stop didn't go through and the recording still runs: back to recording. */
  | { type: 'STOP_FAILED' }
  | { type: 'SET_ANNOTATE_MODE'; enabled: boolean }
  | { type: 'SET_SHAPE'; shape: AnnotationShape }
  | { type: 'SET_COLOR'; color: string }
  | {
      type: 'SET_OVERLAY_ANNOTATIONS';
      recordingId: string;
      annotations: OverlayAnnotation[];
    }
  | { type: 'CLEAR_OVERLAY_ANNOTATIONS' }
  /** An error banner, or none: shorthand for SET_BANNER with tone `error`. */
  | { type: 'SET_ERROR_BANNER'; message: string | null }
  | { type: 'SET_BANNER'; banner: MosaicBanner | null };

export function mosaicReducer(state: MosaicState, action: MosaicAction): MosaicState {
  switch (action.type) {
    case 'SET_LAYOUT':
      return { ...state, layout: action.layout };
    case 'TOGGLE_SELECTED': {
      const next = new Set(state.selected);
      if (next.has(action.key)) next.delete(action.key);
      else next.add(action.key);
      return { ...state, selected: next };
    }
    case 'CLEAR_SELECTED':
      return { ...state, selected: new Set() };
    case 'ADD_TILE':
      if (!gridCanChange(state)) return state;
      // Idempotent: don't duplicate if the tile is already in the mosaic.
      if (state.tiles.some((t) => samePhone(t, action.tile))) return state;
      return { ...state, tiles: [...state.tiles, action.tile] };
    case 'MERGE_TILES': {
      const missing = action.tiles.filter(
        (n, i) =>
          !state.tiles.some((t) => samePhone(t, n)) &&
          action.tiles.findIndex((o) => samePhone(o, n)) === i,
      );
      return missing.length > 0 ? { ...state, tiles: [...state.tiles, ...missing] } : state;
    }
    case 'PATCH_TILE_DIMS': {
      // Only fill dims that are currently missing; never overwrite known values.
      // Return the same state reference when nothing changes so the store
      // doesn't re-render on every device poll.
      let changed = false;
      const tiles = state.tiles.map((t) => {
        if (phoneKey(t) !== action.key || (t.screenWidth && t.screenHeight)) return t;
        changed = true;
        return {
          ...t,
          screenWidth: action.screenWidth,
          screenHeight: action.screenHeight,
          // The tile only lacked dims if it was built from the fallback
          // aspect, so the real one replaces it.
          aspect: action.aspect ?? t.aspect,
        };
      });
      return changed ? { ...state, tiles } : state;
    }
    case 'REMOVE_TILE':
      // Block remove while a recording is in flight — avoids tearing down MJPEG
      // under a live ffmpeg.
      if (!gridCanChange(state)) return state;
      return { ...state, tiles: state.tiles.filter((t) => phoneKey(t) !== action.key) };
    case 'BIND_RECORDING_IDS': {
      const tiles = state.tiles.map((t) => ({
        ...t,
        recordingId: action.map[phoneKey(t)] ?? t.recordingId,
      }));
      return { ...state, tiles };
    }
    case 'SET_RECORDING_PHASE':
      return { ...state, recordingPhase: action.phase };
    case 'STOP_FAILED':
      if (state.recordingPhase !== 'stopping') return state;
      return { ...state, recordingPhase: 'recording' };
    case 'START_RECORDING': {
      const tiles = state.tiles.map((t) => ({
        ...t,
        recordingId: action.tileIds[phoneKey(t)] ?? t.recordingId,
      }));
      return {
        ...state,
        groupId: action.groupId,
        compositeEnabled: action.compositeEnabled === true,
        compositeParts: undefined,
        compositeEndedEarly: false,
        downloadableVideoCount: 0,
        recordingPhase: 'recording',
        // Start on Interact: taps reach the phone. Annotate is one click away.
        annotateMode: false,
        startedAt: action.startedAt,
        overlayAnnotations: {},
        tiles,
      };
    }
    case 'REHYDRATE_RECORDING': {
      const tiles = state.tiles.map((t) => ({
        ...t,
        recordingId: action.tileIds[phoneKey(t)] ?? t.recordingId,
      }));
      return {
        ...state,
        groupId: action.groupId,
        compositeEnabled: action.compositeEnabled,
        compositeParts: undefined,
        compositeEndedEarly: false,
        downloadableVideoCount: 0,
        recordingPhase: 'recording',
        // Land able to tap the device; Annotate is one click away.
        annotateMode: false,
        startedAt: action.startedAt,
        overlayAnnotations: action.overlayAnnotations,
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
        recordingPhase: 'idle',
        annotateMode: false,
        overlayAnnotations: {},
        downloadableVideoCount: action.downloadableVideoCount ?? state.downloadableVideoCount,
        compositeEnabled:
          action.compositeEnabled !== undefined ? action.compositeEnabled : state.compositeEnabled,
        tiles,
      };
    }
    case 'SET_COMPOSITE':
      if (state.groupId !== action.groupId || state.recordingPhase !== 'idle') return state;
      return {
        ...state,
        compositeEnabled: action.hasComposite,
        compositeParts: action.parts,
        compositeEndedEarly: action.endedEarly,
      };
    case 'SET_ANNOTATE_MODE':
      return { ...state, annotateMode: action.enabled };
    case 'SET_SHAPE':
      return { ...state, shape: action.shape };
    case 'SET_COLOR':
      return { ...state, color: action.color };
    case 'SET_OVERLAY_ANNOTATIONS':
      return {
        ...state,
        overlayAnnotations: {
          ...state.overlayAnnotations,
          [action.recordingId]: action.annotations,
        },
      };
    case 'CLEAR_OVERLAY_ANNOTATIONS':
      return { ...state, overlayAnnotations: {} };
    case 'SET_ERROR_BANNER':
      return {
        ...state,
        banner: action.message ? { tone: 'error', message: action.message } : null,
      };
    case 'SET_BANNER':
      return { ...state, banner: action.banner };
    default:
      return state;
  }
}

/**
 * Recording ids by `phoneKey`, from answers that name each recording's phone
 * (`POST /recordings`, `GET /recordings/active`): each tile gets its own
 * phone's recording, even where two servers share a udid.
 */
export function recordingIdsByPhone(
  recordings: Array<PhoneRef & { id: string }>,
): Record<string, string> {
  return Object.fromEntries(recordings.map((r) => [phoneKey(r), r.id]));
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
