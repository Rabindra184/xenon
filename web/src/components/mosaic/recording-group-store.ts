// Local state store for the mosaic page. Uses React's built-in useReducer +
// Context — keeps "no new dependencies" honest (zustand isn't installed).

import { createContext, useContext, useReducer, type Dispatch } from 'react';

export type Layout = '1' | '2x1' | '2x2' | '3x2';
export type AnnotationShape = 'RECT' | 'CIRCLE' | 'ARROW' | 'TEXT' | 'FREEHAND';

export interface MosaicTile {
  udid: string;
  mjpegPort: number;
  recordingId?: string;
}

export interface MosaicState {
  selected: Set<string>;
  layout: Layout;
  tiles: MosaicTile[];
  groupId: string | null;
  recording: boolean;
  startedAt: number | null;
  annotateMode: boolean;
  shape: AnnotationShape;
  color: string;
  errorBanner: string | null;
}

export const initialMosaicState: MosaicState = {
  selected: new Set(),
  layout: '2x2',
  tiles: [],
  groupId: null,
  recording: false,
  startedAt: null,
  annotateMode: false,
  shape: 'RECT',
  color: '#ff3333',
  errorBanner: null,
};

export type MosaicAction =
  | { type: 'SET_LAYOUT'; layout: Layout }
  | { type: 'TOGGLE_SELECTED'; udid: string }
  | { type: 'CLEAR_SELECTED' }
  | { type: 'SET_TILES'; tiles: MosaicTile[] }
  | { type: 'BIND_RECORDING_IDS'; map: Record<string, string> }
  | {
      type: 'START_RECORDING';
      groupId: string;
      startedAt: number;
      tileIds: Record<string, string>;
    }
  | { type: 'STOP_RECORDING' }
  | { type: 'SET_ANNOTATE_MODE'; enabled: boolean }
  | { type: 'SET_SHAPE'; shape: AnnotationShape }
  | { type: 'SET_COLOR'; color: string }
  | { type: 'SET_ERROR_BANNER'; message: string | null };

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
    case 'BIND_RECORDING_IDS': {
      const tiles = state.tiles.map((t) => ({
        ...t,
        recordingId: action.map[t.udid] ?? t.recordingId,
      }));
      return { ...state, tiles };
    }
    case 'START_RECORDING': {
      const tiles = state.tiles.map((t) => ({
        ...t,
        recordingId: action.tileIds[t.udid] ?? t.recordingId,
      }));
      return {
        ...state,
        groupId: action.groupId,
        recording: true,
        startedAt: action.startedAt,
        tiles,
      };
    }
    case 'STOP_RECORDING':
      return { ...state, recording: false };
    case 'SET_ANNOTATE_MODE':
      return { ...state, annotateMode: action.enabled };
    case 'SET_SHAPE':
      return { ...state, shape: action.shape };
    case 'SET_COLOR':
      return { ...state, color: action.color };
    case 'SET_ERROR_BANNER':
      return { ...state, errorBanner: action.message };
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
