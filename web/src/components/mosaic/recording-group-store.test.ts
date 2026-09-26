import { describe, expect, it } from 'vitest';
import {
  effectiveLayout,
  formatElapsed,
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
    compositeEnabled: true,
  });
}

describe('mosaicReducer — recording lifecycle', () => {
  it('START_RECORDING sets the group flag and per-tile recordingIds', () => {
    const s = recordingState();
    expect(s.recording).to.equal(true);
    expect(s.groupId).to.equal('g1');
    expect(s.compositeEnabled).to.equal(true);
    expect(s.annotateMode).to.equal(true);
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
    expect(stopped.compositeEnabled).to.equal(true);
    expect(stopped.recordingPhase).to.equal('idle');
  });

  it('REMOVE_TILE is ignored while recording', () => {
    const s = recordingState();
    const next = mosaicReducer(s, { type: 'REMOVE_TILE', udid: 'u1' });
    expect(next.tiles).to.have.length(2);
  });

  it('formatElapsed pads minutes and seconds', () => {
    expect(formatElapsed(0)).to.equal('0:00');
    expect(formatElapsed(65_000)).to.equal('1:05');
    expect(formatElapsed(3_661_000)).to.equal('1:01:01');
  });

  it('a fresh mosaic has no recording state to leak', () => {
    expect(initialMosaicState.recording).to.equal(false);
    expect(initialMosaicState.tiles).to.deep.equal([]);
  });
});

describe('mosaicReducer — PATCH_TILE_DIMS', () => {
  const withTile = mosaicReducer(initialMosaicState, {
    type: 'ADD_TILE',
    tile: { udid: 'u1', mjpegPort: 0 },
  });

  it('fills in screen dimensions that were unknown at tile creation', () => {
    const next = mosaicReducer(withTile, {
      type: 'PATCH_TILE_DIMS',
      udid: 'u1',
      screenWidth: 1080,
      screenHeight: 2220,
    });
    const t = next.tiles.find((x) => x.udid === 'u1');
    expect(t?.screenWidth).to.equal(1080);
    expect(t?.screenHeight).to.equal(2220);
  });

  it('does NOT overwrite dimensions that are already known', () => {
    const seeded = mosaicReducer(initialMosaicState, {
      type: 'ADD_TILE',
      tile: { udid: 'u1', mjpegPort: 0, screenWidth: 100, screenHeight: 200 },
    });
    const next = mosaicReducer(seeded, {
      type: 'PATCH_TILE_DIMS',
      udid: 'u1',
      screenWidth: 1080,
      screenHeight: 2220,
    });
    const t = next.tiles.find((x) => x.udid === 'u1');
    expect(t?.screenWidth).to.equal(100);
    expect(t?.screenHeight).to.equal(200);
  });

  it('returns the SAME state reference when nothing changes (avoids re-render)', () => {
    // No matching tile, and a tile that already has dims → identity return.
    const noMatch = mosaicReducer(withTile, {
      type: 'PATCH_TILE_DIMS',
      udid: 'nope',
      screenWidth: 1,
      screenHeight: 2,
    });
    expect(noMatch).to.equal(withTile);
  });
});

describe('effectiveLayout', () => {
  // A fixed 2x2 grid gave two portrait phones about a third of the space.
  it('starts on the Auto layout', () => {
    expect(initialMosaicState.layout).to.equal('auto');
  });

  it('resolves auto by tile count and passes explicit layouts through', () => {
    expect(effectiveLayout('auto', 1)).to.equal('1');
    expect(effectiveLayout('auto', 2)).to.equal('2x1');
    expect(effectiveLayout('auto', 4)).to.equal('2x2');
    expect(effectiveLayout('auto', 6)).to.equal('3x2');
    expect(effectiveLayout('2x2', 1)).to.equal('2x2');
  });
});

describe('mosaicReducer — REHYDRATE_RECORDING', () => {
  it('restores the running recording, its timer origin and its open marks', () => {
    const base = mosaicReducer(initialMosaicState, { type: 'ADD_TILE', tile: tile('u1') });
    const marks = {
      'rec-1': [
        { shape: 'RECT' as const, color: 'red', geometry: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
      ],
    };
    const s = mosaicReducer(base, {
      type: 'REHYDRATE_RECORDING',
      groupId: 'g1',
      startedAt: 5000,
      tileIds: { u1: 'rec-1' },
      compositeEnabled: false,
      overlayAnnotations: marks,
    });
    expect(s.recording).to.equal(true);
    expect(s.recordingPhase).to.equal('recording');
    expect(s.groupId).to.equal('g1');
    expect(s.startedAt).to.equal(5000);
    expect(s.tiles[0].recordingId).to.equal('rec-1');
    expect(s.overlayAnnotations).to.deep.equal(marks);
    // A reload lands you able to tap the device; Annotate is one click away.
    expect(s.annotateMode).to.equal(false);
  });
});

describe('mosaicReducer — PATCH_TILE_DIMS', () => {
  it('replaces the fallback aspect once the real screen size is known', () => {
    // A tile added before the device reported its size got the 9/16 fallback;
    // keeping it letterboxed the preview for the tile's whole life.
    const added = mosaicReducer(initialMosaicState, {
      type: 'ADD_TILE',
      tile: { udid: 'u1', mjpegPort: 0, aspect: '9 / 16' },
    });
    const s = mosaicReducer(added, {
      type: 'PATCH_TILE_DIMS',
      udid: 'u1',
      screenWidth: 1080,
      screenHeight: 2220,
      aspect: '1080 / 2220',
    });
    expect(s.tiles[0].aspect).to.equal('1080 / 2220');
    expect(s.tiles[0].screenWidth).to.equal(1080);
  });
});
