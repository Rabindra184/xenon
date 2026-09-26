import { expect } from 'chai';
import * as sinon from 'sinon';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  AnnotationRenderService,
  ANNOTATION_FONT_PATH,
  escapeFilterValue,
} from '../../src/services/recording/annotation-render';
import { resolveFfmpegPath } from '../../src/helpers/ffmpegPath';

describe('AnnotationRenderService.buildFilterParts', () => {
  const svc = new AnnotationRenderService({} as any);

  it('emits drawbox for RECT', () => {
    const parts = svc.buildFilterParts([
      {
        shape: 'RECT',
        geometry: JSON.stringify({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }),
        color: '#ff0000',
        timecode_ms: 1500,
      },
    ]);
    expect(parts).to.have.length(2);
    expect(parts[0]).to.include('drawbox=');
    expect(parts[0]).to.include('0xff0000');
    expect(parts[0]).to.include('t=fill');
    expect(parts[1]).to.include("enable='gte(t\\,1.5)'");
  });

  it('emits drawbox for CIRCLE (drawellipse not assumed)', () => {
    const parts = svc.buildFilterParts([
      {
        shape: 'CIRCLE',
        geometry: JSON.stringify({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }),
        color: 'red',
        timecode_ms: 0,
      },
    ]);
    expect(parts[0]).to.include('drawbox=');
    expect(parts[0]).to.include('iw*0.4000'); // 0.5 - 0.1
    expect(parts.length).to.equal(2);
  });

  it('emits bounding drawbox + tip for ARROW', () => {
    const parts = svc.buildFilterParts([
      {
        shape: 'ARROW',
        geometry: JSON.stringify({ x: 0.2, y: 0.2, w: 0.3, h: 0.1 }),
        color: 'yellow',
        timecode_ms: 0,
      },
    ]);
    expect(parts.length).to.be.at.least(3);
    expect(parts[0]).to.include('drawbox=');
    expect(parts[2]).to.include('t=fill');
  });

  it('emits drawtext for TEXT', () => {
    const parts = svc.buildFilterParts([
      {
        shape: 'TEXT',
        geometry: JSON.stringify({ x: 0.1, y: 0.1 }),
        color: 'white',
        text: "bug: can't click",
        timecode_ms: 0,
      },
    ]);
    expect(parts[0]).to.include('drawtext=');
    // Two levels, no quotes: drawtext's option parser, then the graph parser.
    // The old quoted form ended the quote at the apostrophe and crashed ffmpeg.
    expect(parts[0]).to.include(`text=${escapeFilterValue("bug: can't click")}`);
  });

  it('positions TEXT with drawtext variables (w/h), which it accepts, not iw/ih', () => {
    const parts = svc.buildFilterParts([
      {
        shape: 'TEXT',
        geometry: JSON.stringify({ x: 0.1, y: 0.95 }),
        color: 'white',
        text: 'hi',
        timecode_ms: 0,
      },
    ]);
    expect(parts[0]).to.include(':x=w*0.1000:y=h*0.9500:');
    expect(parts[0]).to.not.match(/[:=]i[wh]\*/);
  });

  it('gives drawtext the vendored font, since the bundled ffmpeg has no fontconfig', () => {
    const parts = svc.buildFilterParts([
      {
        shape: 'TEXT',
        geometry: JSON.stringify({ x: 0.1, y: 0.1 }),
        color: 'white',
        text: 'hi',
        timecode_ms: 0,
      },
    ]);
    expect(parts[0]).to.include(`fontfile=${escapeFilterValue(ANNOTATION_FONT_PATH)}:`);
    const sfnt = fs.readFileSync(ANNOTATION_FONT_PATH).readUInt32BE(0);
    expect(sfnt, 'a TrueType font').to.equal(0x00010000);
  });

  it('skips malformed geometry', () => {
    const parts = svc.buildFilterParts([
      { shape: 'RECT', geometry: 'not-json', color: 'red', timecode_ms: 0 },
    ]);
    expect(parts).to.deep.equal([]);
  });

  it('disables drawtext expansion so % / %{...} in text render literally', () => {
    const parts = svc.buildFilterParts([
      {
        shape: 'TEXT',
        geometry: JSON.stringify({ x: 0.1, y: 0.1 }),
        color: 'white',
        text: '50% done %{pts}',
        timecode_ms: 0,
      },
    ]);
    expect(parts[0]).to.include('expansion=none');
  });

  // D2 — clamp late annotation timecodes into the recorded video's span.
  // A mark drawn after the (possibly short) capture ended would otherwise use
  // enable='gte(t,15)' on a 10s video and never render.
  describe('timecode clamp (D2)', () => {
    const lateRect = () => [
      {
        shape: 'RECT',
        geometry: JSON.stringify({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }),
        color: 'red',
        timecode_ms: 15000, // 15s — beyond the 10s video
      },
    ];

    it('clamps a timecode past the duration to just before the end', () => {
      const parts = svc.buildFilterParts(lateRect(), 10);
      expect(parts).to.have.length(2);
      // Clamped to duration minus the late-mark margin (10 - 0.5 = 9.5),
      // not the raw 15s.
      expect(parts[1]).to.include("enable='gte(t\\,9.5)'");
      expect(parts[1]).to.not.include('gte(t\\,15)');
    });

    it('leaves an in-range timecode unchanged when duration is provided', () => {
      const parts = svc.buildFilterParts(
        [
          {
            shape: 'RECT',
            geometry: JSON.stringify({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }),
            color: 'red',
            timecode_ms: 3000,
          },
        ],
        10,
      );
      expect(parts[1]).to.include("enable='gte(t\\,3)'");
    });

    it('does not shift an in-range annotation in the final seconds', () => {
      // 9.8s on a 10s video is a real, renderable frame — keep its timecode,
      // do NOT pull it back to duration-margin (that would move a legit mark).
      const parts = svc.buildFilterParts(
        [
          {
            shape: 'RECT',
            geometry: JSON.stringify({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }),
            color: 'red',
            timecode_ms: 9800,
          },
        ],
        10,
      );
      expect(parts[1]).to.include("enable='gte(t\\,9.8)'");
    });

    it('does not clamp when no duration is provided (back-compat)', () => {
      const parts = svc.buildFilterParts(lateRect());
      expect(parts[1]).to.include("enable='gte(t\\,15)'");
    });

    it('ignores a non-finite / zero duration (no clamp)', () => {
      const parts = svc.buildFilterParts(lateRect(), 0);
      expect(parts[1]).to.include("enable='gte(t\\,15)'");
    });
  });
});

describe('AnnotationRenderService.resolvePlayablePath — concurrency', () => {
  let tmpDir: string;
  let source: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'annrender-'));
    source = path.join(tmpDir, 'video.mp4');
    fs.writeFileSync(source, 'x'.repeat(2048));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('coalesces concurrent renders into a single ffmpeg pass (no double -y writer)', async () => {
    // The E prewarm and a user Download can both hit resolvePlayablePath before
    // the annotated mp4 is finalized. Without an in-flight guard both would spawn
    // `ffmpeg -y` to the same path → a corrupt/truncated download.
    const store = {
      findById: async () => ({
        id: 'rec1',
        file_path: source,
        annotations: [
          { shape: 'RECT', geometry: JSON.stringify({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }), timecode_ms: 0 },
        ],
      }),
    };
    const svc = new AnnotationRenderService(store as any);
    // Stub the actual ffmpeg burn-in so no real process runs; make it slow so the
    // two calls genuinely overlap.
    const renderStub = sinon
      .stub(svc as any, 'renderToFile')
      .callsFake(() => new Promise((r) => setTimeout(r, 40)));

    const [a, b] = await Promise.all([
      svc.resolvePlayablePath('rec1'),
      svc.resolvePlayablePath('rec1'),
    ]);

    expect(renderStub.calledOnce).to.equal(true);
    expect(a.filePath).to.equal(b.filePath);
    expect(a.annotated).to.equal(true);
  });
});

describe('AnnotationRenderService — time windows (Clear marks)', () => {
  const svc = new AnnotationRenderService({} as any);
  const rect = (extra: any) => ({
    shape: 'RECT',
    geometry: JSON.stringify({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }),
    color: 'red',
    timecode_ms: 1000,
    ...extra,
  });

  it('closes a cleared mark with a half-open window', () => {
    const parts = svc.buildFilterParts([rect({ end_timecode_ms: 4000 })]);
    expect(parts[0]).to.include("enable='gte(t\\,1)*lt(t\\,4)'");
  });

  it('leaves an open mark exactly as before', () => {
    expect(svc.buildFilterParts([rect({ end_timecode_ms: null })])[0]).to.include(
      "enable='gte(t\\,1)'",
    );
  });

  it('drops a mark that ends when it starts (never visible)', () => {
    expect(svc.buildFilterParts([rect({ end_timecode_ms: 1000 })])).to.deep.equal([]);
  });
});

describe('AnnotationRenderService.buildRenderGraph', () => {
  const svc = new AnnotationRenderService({} as any);
  const mark = (id: string, extra: any = {}) => ({
    id,
    shape: 'CIRCLE',
    geometry: JSON.stringify({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }),
    color: 'red',
    timecode_ms: 1000,
    ...extra,
  });

  it('overlays an image mark scaled to the frame, inside its window', () => {
    const g = svc.buildRenderGraph([mark('a', { end_timecode_ms: 3000 })], 10, () => '/x/a.png')!;
    expect(g.inputs).to.deep.equal(['/x/a.png']);
    expect(g.graph).to.equal(
      "[1:v][0:v]scale2ref=w=iw:h=ih[o1][b1];[b1][o1]overlay=0:0:enable='gte(t\\,1)*lt(t\\,3)'[v1]",
    );
    expect(g.output).to.equal('[v1]');
    expect(g.hasText).to.equal(false);
  });

  it('chains drawbox fallback marks first, then image overlays on top', () => {
    const g = svc.buildRenderGraph([mark('a'), mark('b', { shape: 'RECT' })], 10, (a) =>
      a.id === 'a' ? '/x/a.png' : undefined,
    )!;
    expect(g.graph.startsWith('[0:v]drawbox=')).to.equal(true);
    expect(g.graph).to.include('[d0];[1:v][d0]scale2ref=w=iw:h=ih[o1][b1]');
    expect(g.output).to.equal('[v1]');
  });

  it('flags graphs that contain text so the caller can retry without it', () => {
    const text = mark('t', {
      shape: 'TEXT',
      text: 'hi',
      geometry: JSON.stringify({ x: 0.1, y: 0.1 }),
    });
    expect(svc.buildRenderGraph([text], 10, () => undefined)!.hasText).to.equal(true);
  });

  it('returns null when nothing is drawable', () => {
    expect(
      svc.buildRenderGraph([mark('a', { end_timecode_ms: 500 })], 10, () => '/x/a.png'),
    ).to.equal(null);
  });
});

describe('escapeFilterValue', () => {
  it('escapes for the option parser, then again for the graph parser', () => {
    expect(escapeFilterValue('a:b')).to.equal('a\\\\:b');
    expect(escapeFilterValue("it's")).to.equal("it\\\\\\'s");
    expect(escapeFilterValue('a\\b')).to.equal('a\\\\\\\\b');
    expect(escapeFilterValue('[x], y;')).to.equal('\\[x\\]\\, y\\;');
  });

  it('leaves plain text and plain paths alone', () => {
    expect(escapeFilterValue('/opt/xenon/Inter-Regular.ttf')).to.equal(
      '/opt/xenon/Inter-Regular.ttf',
    );
    expect(escapeFilterValue('50% done é')).to.equal('50% done é');
  });
});

describe('AnnotationRenderService — TEXT burn-in on the real ffmpeg', () => {
  // The bundled ffmpeg is the one production uses; skip only if it is absent.
  const ffmpeg = resolveFfmpegPath();
  let dir: string;

  before(function () {
    if (spawnSync(ffmpeg, ['-version']).status !== 0) this.skip();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-text-'));
    fs.mkdirSync(path.join(dir, 'rec-t', 'video'), { recursive: true });
    const made = spawnSync(ffmpeg, [
      ...'-y -loglevel error -f lavfi'.split(' '),
      ...'-i color=c=navy:s=320x640:d=2:r=10 -pix_fmt yuv420p'.split(' '),
      path.join(dir, 'rec-t', 'video', 'rec-t.mp4'),
    ]);
    expect(made.status, String(made.stderr)).to.equal(0);
  });

  after(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('draws a TEXT mark with hostile characters instead of falling back to no text', async () => {
    const file = path.join(dir, 'rec-t', 'video', 'rec-t.mp4');
    const store: any = {
      findById: async () => ({
        id: 'rec-t',
        file_path: file,
        annotations: [
          {
            id: 'ann-t',
            shape: 'TEXT',
            text: "it's 10:30, [ok]; a\\b = 50%",
            geometry: JSON.stringify({ x: 0.05, y: 0.45 }),
            color: '#ffffff',
            timecode_ms: 0,
          },
        ],
      }),
    };
    const out = await new AnnotationRenderService(store).resolvePlayablePath('rec-t');
    expect(out.annotated).to.equal(true);

    // One raw RGB frame: with the text drawn there are bright pixels on navy;
    // the no-text fallback would leave none.
    const frame = spawnSync(ffmpeg, [
      ...'-loglevel error -ss 1 -i'.split(' '),
      out.filePath,
      ...'-frames:v 1 -f rawvideo -pix_fmt rgb24 pipe:1'.split(' '),
    ]);
    expect(frame.status, String(frame.stderr)).to.equal(0);
    let bright = 0;
    for (let i = 0; i + 2 < frame.stdout.length; i += 3) {
      if (frame.stdout[i] > 200 && frame.stdout[i + 1] > 200 && frame.stdout[i + 2] > 200) bright++;
    }
    expect(bright).to.be.greaterThan(200);
  });
});
