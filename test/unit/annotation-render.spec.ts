import { expect } from 'chai';
import * as sinon from 'sinon';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AnnotationRenderService } from '../../src/services/recording/annotation-render';

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
    expect(parts[0]).to.include("text='bug\\: can\\'t click'");
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
