import { describe, expect, it } from 'vitest';
import {
  effectiveLayout,
  initialMosaicState,
  mosaicReducer,
  type MosaicState,
  type MosaicTile,
} from './recording-group-store';

const tile = (udid: string): MosaicTile => ({ udid, mjpegPort: 9100 });

function recordingState(): MosaicState {
  const withTiles = mosaicReducer(
    mosaicReducer(initialMosaicState, { type: 'ADD_TILE', tile: tile('u1') }),
    { type: 'ADD_TILE', tile: tile('u2') },
  );
  return mosaicReducer(withTiles, {
    type: 'START_RECORDING',
    groupId: 'g1',
    startedAt: 1000,
    tileIds: { u1: 'rec-1', u2: 'rec-2' },
  });
}

describe('mosaicReducer — recording lifecycle', () => {
  it('START_RECORDING sets the group flag and per-tile recordingIds', () => {
    const s = recordingState();
    expect(s.recording).to.equal(true);
    expect(s.groupId).to.equal('g1');
    expect(s.tiles.map((t) => t.recordingId)).to.deep.equal(['rec-1', 'rec-2']);
  });

  it('STOP_RECORDING clears both the group flag AND every tile recordingId (F6)', () => {
    const stopped = mosaicReducer(recordingState(), { type: 'STOP_RECORDING' });
    expect(stopped.recording).to.equal(false);
    // The REC badge is derived from recordingId — it must be cleared so the
    // badge disappears without waiting for a remount.
    expect(stopped.tiles.every((t) => t.recordingId === undefined)).to.equal(true);
  });

  it('STOP_RECORDING keeps groupId so the proof-bundle download stays available', () => {
    const stopped = mosaicReducer(recordingState(), { type: 'STOP_RECORDING' });
    expect(stopped.groupId).to.equal('g1');
  });

  it('a fresh mosaic has no recording state to leak', () => {
    expect(initialMosaicState.recording).to.equal(false);
    expect(initialMosaicState.tiles).to.deep.equal([]);
  });
});

describe('effectiveLayout', () => {
  it('resolves auto by tile count and passes explicit layouts through', () => {
    expect(effectiveLayout('auto', 1)).to.equal('1');
    expect(effectiveLayout('auto', 2)).to.equal('2x1');
    expect(effectiveLayout('auto', 4)).to.equal('2x2');
    expect(effectiveLayout('auto', 6)).to.equal('3x2');
    expect(effectiveLayout('2x2', 1)).to.equal('2x2');
  });
});
