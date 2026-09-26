import { expect } from 'chai';
import {
  buildCompositeFilterGraph,
  cellOrigin,
  compositeGrid,
  COMPOSITE_CELL_H,
  COMPOSITE_CELL_W,
} from '../../src/services/VideoPipelineService';
import { parseFfmpegFrameSize } from '../../src/services/recording/probeDuration';
import { containBoxPx } from '../../src/services/recording/annotation-render';

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

describe('containBoxPx (where ffmpeg puts a picture in a composite cell)', () => {
  // Each expected box was measured from the bundled ffmpeg running the
  // composite's own scale+pad on a white source: offsets truncate
  // (1024x768 lands at y=277, odd), sizes round to nearest.
  const measured: Array<[number, number, { x: number; y: number; w: number; h: number }]> = [
    [720, 1480, { x: 36, y: 0, w: 467, h: 960 }],
    [1480, 720, { x: 0, y: 348, w: 540, h: 263 }],
    [540, 960, { x: 0, y: 0, w: 540, h: 960 }],
    [1170, 2532, { x: 48, y: 0, w: 444, h: 960 }],
    [1080, 2220, { x: 36, y: 0, w: 467, h: 960 }],
    [1024, 768, { x: 0, y: 277, w: 540, h: 405 }],
  ];
  for (const [w, h, box] of measured) {
    it(`matches ffmpeg for a ${w}x${h} source`, () => {
      expect(containBoxPx(540, 960, w, h)).to.deep.equal(box);
    });
  }
});

describe('parseFfmpegFrameSize', () => {
  it('reads the size from the video stream line, not the codec tag', () => {
    const stderr =
      '  Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, ' +
      'smpte170m/unknown/unknown), 720x1480, 61 kb/s, 25 fps, 25 tbr, 12800 tbn (default)';
    expect(parseFfmpegFrameSize(stderr)).to.deep.equal({ w: 720, h: 1480 });
  });

  it('handles a size followed by a sample-aspect bracket', () => {
    const stderr =
      '  Stream #0:0: Video: mjpeg, yuvj420p(pc), 1080x2220 [SAR 1:1 DAR 18:37], 15 fps';
    expect(parseFfmpegFrameSize(stderr)).to.deep.equal({ w: 1080, h: 2220 });
  });

  it('returns undefined when there is no video stream', () => {
    expect(parseFfmpegFrameSize('Input #0, mp3, from x.mp3:\n  Stream #0:0: Audio: mp3')).to.equal(
      undefined,
    );
  });
});
