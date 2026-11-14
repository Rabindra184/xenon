import { describe, expect, it } from 'vitest';
import {
  gridCanChange,
  initialMosaicState,
  isRecording,
  mosaicReducer,
  type MosaicState,
  type MosaicTile,
  type RecordingPhase,
} from './recording-group-store';
import { phoneKey } from '../../lib/phone';

const tile = (udid: string): MosaicTile => ({
  udid,
  host: 'http://127.0.0.1:4723',
  mjpegPort: 0,
});

function withPhase(phase: RecordingPhase, udids = ['u1']): MosaicState {
  let s = initialMosaicState;
  for (const u of udids) s = mosaicReducer(s, { type: 'ADD_TILE', tile: tile(u) });
  if (phase === 'idle') return s;
  s = mosaicReducer(s, { type: 'SET_RECORDING_PHASE', phase: 'starting' });
  if (phase === 'starting') return s;
  s = mosaicReducer(s, {
    type: 'START_RECORDING',
    groupId: 'g1',
    startedAt: 1000,
    tileIds: Object.fromEntries(udids.map((u) => [phoneKey(tile(u)), `rec-${u}`])),
  });
  if (phase === 'recording') return s;
  return mosaicReducer(s, { type: 'SET_RECORDING_PHASE', phase: 'stopping' });
}

// The phase is the one record of where a recording is. Through 2.36 a stored
// `recording` flag (false while starting) sat beside it, and the picker, the
// reducer and Restore each read a different one.
describe('the recording phase is the one source', () => {
  it('a recording runs while recording and stopping, not while starting or idle', () => {
    expect(isRecording(withPhase('idle'))).toBe(false);
    expect(isRecording(withPhase('starting'))).toBe(false);
    expect(isRecording(withPhase('recording'))).toBe(true);
    expect(isRecording(withPhase('stopping'))).toBe(true);
  });

  it('the grid changes only when nothing is starting, running or stopping', () => {
    expect(gridCanChange(withPhase('idle'))).toBe(true);
    for (const p of ['starting', 'recording', 'stopping'] as const) {
      expect(gridCanChange(withPhase(p))).toBe(false);
    }
  });

  // An add while starting was kept, but the start had already named its
  // phones: the new tile never got a recording and no REC.
  it('refuses an add and a remove while a recording starts', () => {
    const s = withPhase('starting');
    expect(mosaicReducer(s, { type: 'ADD_TILE', tile: tile('u2') }).tiles).toHaveLength(1);
    expect(mosaicReducer(s, { type: 'REMOVE_TILE', key: phoneKey(tile('u1')) }).tiles).toHaveLength(
      1,
    );
  });

  it('keeps no stored recording flag or second error banner to drift from the phase', () => {
    expect('recording' in initialMosaicState).toBe(false);
    expect('errorBanner' in initialMosaicState).toBe(false);
  });

  it('SET_ERROR_BANNER still shows an error banner', () => {
    const s = mosaicReducer(initialMosaicState, { type: 'SET_ERROR_BANNER', message: 'No' });
    expect(s.banner).toEqual({ tone: 'error', message: 'No' });
    expect(mosaicReducer(s, { type: 'SET_ERROR_BANNER', message: null }).banner).toBe(null);
  });
});

// A failed Stop used to dispatch STOP_RECORDING: the page said idle, Record
// came back, and the server went on recording with no Stop until a reload.
describe('STOP_FAILED', () => {
  it('goes back to recording, keeping the group, its start and every tile’s recording', () => {
    const s = mosaicReducer(withPhase('stopping', ['u1', 'u2']), { type: 'STOP_FAILED' });
    expect(s.recordingPhase).toBe('recording');
    expect(isRecording(s)).toBe(true);
    expect(s.groupId).toBe('g1');
    expect(s.startedAt).toBe(1000);
    expect(s.tiles.map((t) => t.recordingId)).toEqual(['rec-u1', 'rec-u2']);
  });

  it('does nothing unless a stop was under way', () => {
    const idle = withPhase('idle');
    expect(mosaicReducer(idle, { type: 'STOP_FAILED' })).toBe(idle);
  });
});

// The page's rehydrate used to SET_TILES its answer, replacing tiles the user
// had added while it ran (and whose streams were already started).
describe('MERGE_TILES', () => {
  it('adds the tiles it lacks and keeps every tile it has, in place', () => {
    const s = withPhase('idle', ['u2']);
    const next = mosaicReducer(s, { type: 'MERGE_TILES', tiles: [tile('u1'), tile('u2')] });
    expect(next.tiles.map((t) => t.udid)).toEqual(['u2', 'u1']);
  });

  it('returns the same state when there is nothing new', () => {
    const s = withPhase('idle', ['u1']);
    expect(mosaicReducer(s, { type: 'MERGE_TILES', tiles: [tile('u1')] })).toBe(s);
  });

  // A running recording's phones belong on the grid whatever the phase.
  it('adds a running recording’s phone even while a recording starts', () => {
    const s = withPhase('starting', ['u1']);
    expect(mosaicReducer(s, { type: 'MERGE_TILES', tiles: [tile('u2')] }).tiles).toHaveLength(2);
  });
});
