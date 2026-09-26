import { expect } from 'chai';
import {
  buildCompositeFilterGraph,
  cellOrigin,
  compositeGrid,
  COMPOSITE_CELL_H,
  COMPOSITE_CELL_W,
} from '../../src/services/VideoPipelineService';

describe('composite geometry', () => {
  it('uses the grid the stack filter builds for each input count', () => {
    expect(compositeGrid(2)).to.deep.equal({ cols: 2, rows: 1 });
    expect(compositeGrid(3)).to.deep.equal({ cols: 2, rows: 2 });
    expect(compositeGrid(4)).to.deep.equal({ cols: 2, rows: 2 });
    expect(compositeGrid(5)).to.deep.equal({ cols: 3, rows: 2 });
    expect(compositeGrid(6)).to.deep.equal({ cols: 3, rows: 2 });
  });

  // Row-major, matching hstack and the xstack layout strings
  // 0_0|w0_0|0_h0|w0_h0 (2x2) and 0_0|w0_0|w0+w1_0|0_h0|w0_h0|w0+w1_h0 (3x2).
  it('places each cell where the stack filter puts it', () => {
    const W = COMPOSITE_CELL_W;
    const H = COMPOSITE_CELL_H;
    expect([0, 1].map((i) => cellOrigin(i, 2, W, H))).to.deep.equal([
      { x: 0, y: 0 },
      { x: W, y: 0 },
    ]);
    expect([0, 1, 2, 3].map((i) => cellOrigin(i, 2, W, H))).to.deep.equal([
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: 0, y: H },
      { x: W, y: H },
    ]);
    expect([0, 1, 2, 3, 4, 5].map((i) => cellOrigin(i, 3, W, H))).to.deep.equal([
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: 2 * W, y: 0 },
      { x: 0, y: H },
      { x: W, y: H },
      { x: 2 * W, y: H },
    ]);
  });

  // Captured from startComposite before the graph was extracted: the refactor
  // must not change what ffmpeg runs.
  it('builds exactly the graph startComposite has always run', () => {
    const cell = (i: number) =>
      `[${i}:v]scale=540:960:force_original_aspect_ratio=decrease,` +
      `pad=540:960:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v${i}]`;
    expect(buildCompositeFilterGraph(2, 540, 960)).to.equal(
      `${cell(0)};${cell(1)};[v0][v1]hstack=inputs=2[v]`,
    );
    expect(buildCompositeFilterGraph(3, 540, 960)).to.equal(
      `${cell(0)};${cell(1)};${cell(2)};color=c=black:s=540x960:r=15[blank3];` +
        `[v0][v1][v2][blank3]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0[v]`,
    );
  });
});
