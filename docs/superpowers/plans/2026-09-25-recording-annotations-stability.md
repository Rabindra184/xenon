# Recording Annotations Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Live Devices recording annotations stable. The downloaded video
must show exactly what the preview showed: every shape, real freehand, and
Clear marks honoured. A recording must survive a page reload, and a device can
be recorded only once at a time. Remove the Bookmark UI.

**Architecture:**
- **Server.** Adds a nullable `Annotation.end_timecode_ms` and a group-level
  clear route. Adds an active-recordings route for rehydration, and a
  "recording in progress" busy reason. The renderer composites
  browser-rasterised PNGs per mark with `scale2ref` + `overlay`, and keeps
  `drawbox` as a fallback.
- **Client.** Rasterises each mark with the same `paintAnnotation` the overlay
  uses, and sends all mark and clear writes through one ordered queue. It
  rehydrates a running recording on mount, and keeps a toolbar whose buttons
  never move.

**Tech Stack:** TypeScript, Express, Prisma (SQLite + Postgres), bundled
ffmpeg 4.4 (`@ffmpeg-installer`), React 17, Vitest + jsdom, Mocha + Chai +
Sinon.

**Specs:**
- `docs/superpowers/specs/2026-09-25-annotation-clear-marks-design.md`
- `docs/superpowers/specs/2026-09-25-recording-annotations-stability-design.md`

## Global Constraints

- **ffmpeg filters:** `scale2ref=w=iw:h=ih`, where `iw/ih` mean the
  *reference* dimensions; this was verified on the bundled 4.4, where
  `main_w` does not scale. Time windows use `enable='gte(t\,S)*lt(t\,E)'`,
  with the half-open `lt`, never `between`.
- **Raster:** the long side is 1600px. A decoded PNG may be at most 2 MB. A
  data URL must start with `data:image/png;base64,`.
- **Freehand:** keep a point only after the pointer moves at least 2 CSS px,
  and at most 2000 points.
- **Copy:** the hint chip reads `Annotating · drag to mark`. The Clear button
  title reads `Clear marks from the preview and the recording`. The failure
  banner reads `Couldn't clear marks from the recording. They will still
  appear in the video.`
- **Mocha:** hooks go inside `describe`, never at the top level. Import
  `reflect-metadata` when TypeDI is touched. Every spec must pass on its own
  with `npx mocha <file>`.
- **Colour literals:** no new hex or `rgba()` literals, except in
  `AnnotationOverlay.tsx`, which is exempt as canvas code.
- **Lint and format:** never run a broad `eslint --fix`. Run
  `npx prettier --check <changed files>` only.
- **Git:** stage explicit paths only.
- **Build:** the running server serves `lib/`. After a backend change run
  `npm run build`. After a web change run
  `npm run build:xenon && npm run build:copy`.
- **Schema change:** restart the real Postgres-backed server and grep its log
  for `Fatal` and `[DBMigrate]` before claiming success.

---

### Task 1: One recording per device

**Files:**
- Modify: `src/services/recording/busy-precheck.ts`
- Test: `test/unit/busy-precheck.spec.ts`

**Interfaces:**
- Produces: `new BusyPrecheck(store?, isRecording?: (udid: string) => Promise<boolean>)`.
  `findBusy` reports `{ udid, reason: 'recording_other_group' }` for any
  device with an active recording. The reason already exists in `BusyReason`
  and the picker already labels it "Recording in another group".

- [ ] **Step 1: Route every construction in the spec through a helper that injects `isRecording`**

In `test/unit/busy-precheck.spec.ts`, directly under `afterEach(() => sinon.restore());`, add:

```ts
  // The recording check defaults to Prisma; unit tests must never reach it.
  const precheck = (store: any, recording: string[] = []) =>
    new BusyPrecheck(store, async (udid: string) => recording.includes(udid));
```

Then replace every `new BusyPrecheck(` in that file with `precheck(`
(`sed -i '' 's/new BusyPrecheck(/precheck(/g' test/unit/busy-precheck.spec.ts`,
then restore the one inside the helper to `new BusyPrecheck(`).

- [ ] **Step 2: Add the failing tests**

```ts
  it('refuses a self-locked device that is already recording (no duplicate capture)', async () => {
    // A reload used to forget the running recording; Record then started a
    // second ffmpeg on the same device because the lock was the caller's own.
    const pc = precheck(
      withDevices({ U1: { udid: 'U1', busy: true, session_id: 'manual_actor-1_U1' } }),
      ['U1'],
    );
    expect(await pc.findBusy(['U1'], 'actor-1')).to.deep.equal([
      { udid: 'U1', reason: 'recording_other_group' },
    ]);
  });

  it('refuses a device with an active recording even if it is not marked busy', async () => {
    const pc = precheck(withDevices({ U1: { udid: 'U1', busy: false } }), ['U1']);
    expect((await pc.findBusy(['U1']))[0]).to.deep.include({
      udid: 'U1',
      reason: 'recording_other_group',
    });
  });
```

- [ ] **Step 3: Run the spec and check that only the two new tests fail**

Run: `npx mocha test/unit/busy-precheck.spec.ts`
Expected: the 2 new tests FAIL, and every existing test passes.

- [ ] **Step 4: Implement**

In `busy-precheck.ts`, add the imports `import { Container } from 'typedi';` and
`import { RecordingStore } from './recording-store';`. Then change the
constructor and the loop:

```ts
  private readonly storeProvider: () => any;
  private readonly isRecording: (udid: string) => Promise<boolean>;
  constructor(store?: any, isRecording?: (udid: string) => Promise<boolean>) {
    this.storeProvider = store ? () => store : () => DeviceStoreFactory.getStore();
    this.isRecording =
      isRecording ?? ((udid: string) => Container.get(RecordingStore).isRecording(udid));
  }
```

In `findBusy`, directly after the `if (!device) { … continue; }` block and
before `if (!device.busy) continue;`, add:

```ts
      // One capture per device. Checked before the lock rules: the owner of
      // the lock is exactly who a lost page state lets start a duplicate.
      if (await this.isRecording(udid)) {
        out.push({ udid, reason: 'recording_other_group' });
        continue;
      }
```

- [ ] **Step 5: Run the spec, expecting a pass**

Run: `npx mocha test/unit/busy-precheck.spec.ts`. Expected: all pass.
Also run `npx mocha test/unit/recording-orchestrator.spec.ts test/unit/recording-instrumentation.spec.ts`, which inject their own `findBusy`. Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/recording/busy-precheck.ts test/unit/busy-precheck.spec.ts
git commit -m "fix(recording): refuse a second recording of a device already recording"
```

---

### Task 2: Clear marks (server side)

**Files:**
- Modify: `prisma/schema.prisma` (model `Annotation`)
- Create: `prisma/migrations/20260925120000_annotation_end_timecode/migration.sql`
- Modify: `src/generated/**` (regenerated client, committed)
- Modify: `src/services/recording/recording-store.ts`
- Modify: `src/services/recording/RecordingOrchestrator.ts`
- Create: `src/app/routers/recordingRequests.ts`
- Modify: `src/app/routers/recordings.ts`
- Test: `test/unit/recording-store.spec.ts`, `test/unit/recording-requests.spec.ts`

**Interfaces:**
- Produces:
  - `RecordingStore.clearAnnotations(recordingIds: string[], timecodeMs: number): Promise<number>`
  - `RecordingOrchestrator.clearAnnotations(groupId: string, timecodeMs: number): Promise<{ cleared: number }>`
  - `parseClearBody(body: unknown): { ok: true; timecodeMs: number } | { ok: false; error: string }`
  - `POST /xenon/api/recordings/:groupId/annotations/clear` with body
    `{ timecodeMs }`, returning `200 { cleared }`, `400`, `404` or `500`.
  - Column `Annotation.end_timecode_ms Int?`.

- [ ] **Step 1: Schema, migration, client**

In `prisma/schema.prisma` `model Annotation`, below `timecode_ms  Int`, add
`end_timecode_ms Int?` and align it with its neighbours. Then create the
migration:

```sql
-- AlterTable
ALTER TABLE "Annotation" ADD COLUMN "end_timecode_ms" INTEGER;
```

Run: `node scripts/generate-prisma.js`, then `git status --short src/generated prisma`.
Expected: `schema.prisma`, the new migration and `src/generated/client/*` are
modified. **Check that `schema.prisma` still says `provider = "sqlite"`**, because
`preparePrismaSchema` can rewrite it at runtime, and that must not be committed.

Push the column to the local test DB used by the Prisma round-trip specs:
`npx prisma db push --skip-generate`. Expected: "Your database is now in sync".

- [ ] **Step 2: Write the failing store test** (real Prisma round-trip, as the file already does)

Append inside `describe('RecordingStore (Prisma round-trip)', …)`:

```ts
  it('clearAnnotations closes only open marks that started by the clear time', async () => {
    await store.create({ id: 'test-rec-clr', groupId: 'test-gclr', deviceUdid: 'TEST-UC', deviceHost: '127.0.0.1', filePath: '/tmp/c.mp4', sessionId: null, deviceSnapshot: null });
    await store.create({ id: 'test-rec-oth', groupId: 'test-goth', deviceUdid: 'TEST-UO', deviceHost: '127.0.0.1', filePath: '/tmp/o.mp4', sessionId: null, deviceSnapshot: null });
    const base = { shape: 'RECT', geometry: '{}', color: 'red' };
    const before = await store.addAnnotation('test-rec-clr', { ...base, timecodeMs: 1000 });
    const after = await store.addAnnotation('test-rec-clr', { ...base, timecodeMs: 9000 });
    const other = await store.addAnnotation('test-rec-oth', { ...base, timecodeMs: 1000 });

    expect(await store.clearAnnotations(['test-rec-clr'], 5000)).to.equal(1);
    // A second clear must not move an already-closed mark.
    expect(await store.clearAnnotations(['test-rec-clr'], 7000)).to.equal(0);

    const rows = await prisma.annotation.findMany({ where: { id: { in: [before.id, after.id, other.id] } } });
    const byId = Object.fromEntries(rows.map((r: any) => [r.id, r.end_timecode_ms]));
    expect(byId[before.id]).to.equal(5000);
    expect(byId[after.id]).to.equal(null); // started after the clear
    expect(byId[other.id]).to.equal(null); // other group
  });

  it('clearAnnotations with no recordings is a no-op', async () => {
    expect(await store.clearAnnotations([], 5000)).to.equal(0);
  });
```

- [ ] **Step 3: Write the failing request-parsing test**

Create `test/unit/recording-requests.spec.ts`:

```ts
import { expect } from 'chai';
import { parseClearBody } from '../../src/app/routers/recordingRequests';

describe('parseClearBody', () => {
  it('accepts a finite, non-negative timecode', () => {
    expect(parseClearBody({ timecodeMs: 1234 })).to.deep.equal({ ok: true, timecodeMs: 1234 });
    expect(parseClearBody({ timecodeMs: 0 })).to.deep.equal({ ok: true, timecodeMs: 0 });
  });
  it('rounds a fractional timecode to whole ms (the column is INTEGER)', () => {
    expect(parseClearBody({ timecodeMs: 12.6 })).to.deep.equal({ ok: true, timecodeMs: 13 });
  });
  for (const bad of [undefined, null, {}, { timecodeMs: '5' }, { timecodeMs: -1 }, { timecodeMs: Infinity }, { timecodeMs: NaN }]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      expect(parseClearBody(bad).ok).to.equal(false);
    });
  }
});
```

- [ ] **Step 4: Run both, and check that they fail**

Run: `npx mocha test/unit/recording-store.spec.ts test/unit/recording-requests.spec.ts`
Expected: FAIL (`clearAnnotations is not a function`, and the module is not found).

- [ ] **Step 5: Implement the store, orchestrator, parser and route**

Add to `RecordingStore`:

```ts
  /**
   * End every still-open mark in these recordings at `timecodeMs`. Marks that
   * started after it, or were already closed, are left alone, so repeating a
   * clear changes nothing.
   */
  async clearAnnotations(recordingIds: string[], timecodeMs: number): Promise<number> {
    if (recordingIds.length === 0) return 0;
    const out = await prisma.annotation.updateMany({
      where: {
        recording_id: { in: recordingIds },
        end_timecode_ms: null,
        timecode_ms: { lte: timecodeMs },
      },
      data: { end_timecode_ms: timecodeMs },
    });
    return out.count;
  }
```

Add to `RecordingOrchestrator`, after `addAnnotation`:

```ts
  /** "Clear marks" for the whole group, which is what the button does. */
  async clearAnnotations(groupId: string, timecodeMs: number): Promise<{ cleared: number }> {
    const rows = await this.store.listGroup(groupId);
    const cleared = await this.store.clearAnnotations(
      rows.map((r: any) => r.id),
      timecodeMs,
    );
    return { cleared };
  }
```

Create `src/app/routers/recordingRequests.ts`:

```ts
/** Pure request parsing for the recordings router, kept testable without Express. */
export function parseClearBody(
  body: unknown,
): { ok: true; timecodeMs: number } | { ok: false; error: string } {
  const t = (body as { timecodeMs?: unknown } | null | undefined)?.timecodeMs;
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) {
    return { ok: false, error: 'timecodeMs must be a finite number >= 0' };
  }
  return { ok: true, timecodeMs: Math.round(t) };
}
```

In `recordings.ts`, import `parseClearBody` and add the route after the
`/annotation` route:

```ts
router.post('/recordings/:groupId/annotations/clear', async (req: Request, res: Response) => {
  const parsed = parseClearBody(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const auth = (req as Request & { auth?: { teamIds?: string[] } }).auth;
  if (!(await isGroupVisibleToAuth(req.params.groupId, auth?.teamIds))) {
    return res.status(404).json({ error: 'not_found' });
  }
  try {
    const out = await Container.get(RecordingOrchestrator).clearAnnotations(
      req.params.groupId,
      parsed.timecodeMs,
    );
    return res.json(out);
  } catch (e: any) {
    recLog.error(`annotations/clear failed: ${e?.message}`);
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
});
```

- [ ] **Step 6: Run the tests, expecting a pass**

Run: `npx mocha test/unit/recording-store.spec.ts test/unit/recording-requests.spec.ts test/unit/recording-orchestrator.spec.ts`
Expected: all pass. Run `npx tsc --noEmit -p .` as well, and expect exit 0.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260925120000_annotation_end_timecode src/generated src/services/recording/recording-store.ts src/services/recording/RecordingOrchestrator.ts src/app/routers/recordingRequests.ts src/app/routers/recordings.ts test/unit/recording-store.spec.ts test/unit/recording-requests.spec.ts
git commit -m "feat(recording): Clear marks ends open annotations at the clear time"
```

---

### Task 3: Renderer — time windows, image overlays, text fallback

**Files:**
- Create: `src/services/recording/annotationImage.ts`
- Modify: `src/services/recording/annotation-render.ts`
- Test: `test/unit/annotation-render.spec.ts`, `test/unit/annotation-image.spec.ts`

**Interfaces:**
- Consumes: `Annotation.end_timecode_ms` from Task 2.
- Produces:
  - `annotationImagePath(videoFilePath: string, annotationId: string): string`,
    which maps `<root>/<rec>/video/<rec>.mp4` to `<root>/<rec>/annotations/<id>.png`.
  - `decodeAnnotationImage(image: unknown): null | { ok: true; png: Buffer } | { ok: false; error: string }`
  - `AnnotationRenderService.buildRenderGraph(annotations: RenderAnnotation[], durationSec: number | undefined, imageFor: (a: RenderAnnotation) => string | undefined): RenderGraph | null`
  - `RenderGraph = { inputs: string[]; graph: string; output: string; hasText: boolean }`

- [ ] **Step 1: Write the failing tests**

Create `test/unit/annotation-image.spec.ts`:

```ts
import { expect } from 'chai';
import { annotationImagePath, decodeAnnotationImage, MAX_ANNOTATION_PNG_BYTES } from '../../src/services/recording/annotationImage';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const dataUrl = (buf: Buffer) => `data:image/png;base64,${buf.toString('base64')}`;

describe('annotationImage', () => {
  it('puts the image beside the video directory so recording cleanup removes it', () => {
    expect(annotationImagePath('/r/rec-1/video/rec-1.mp4', 'ann-9')).to.equal('/r/rec-1/annotations/ann-9.png');
  });
  it('returns null when no image was sent (API clients, legacy callers)', () => {
    expect(decodeAnnotationImage(undefined)).to.equal(null);
    expect(decodeAnnotationImage(null)).to.equal(null);
  });
  it('decodes a PNG data URL', () => {
    const png = Buffer.concat([PNG_SIG, Buffer.from('rest')]);
    const out = decodeAnnotationImage(dataUrl(png));
    expect(out).to.deep.equal({ ok: true, png });
  });
  it('rejects a non-PNG prefix, a bad signature, and an oversize image', () => {
    expect((decodeAnnotationImage('data:image/jpeg;base64,AAAA') as any).ok).to.equal(false);
    expect((decodeAnnotationImage(dataUrl(Buffer.from('notapng!'))) as any).ok).to.equal(false);
    const big = Buffer.concat([PNG_SIG, Buffer.alloc(MAX_ANNOTATION_PNG_BYTES)]);
    expect((decodeAnnotationImage(dataUrl(big)) as any).ok).to.equal(false);
    expect((decodeAnnotationImage(42) as any).ok).to.equal(false);
  });
});
```

Append to `test/unit/annotation-render.spec.ts`:

```ts
describe('AnnotationRenderService — time windows (Clear marks)', () => {
  const svc = new AnnotationRenderService({} as any);
  const rect = (extra: any) => ({ shape: 'RECT', geometry: JSON.stringify({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }), color: 'red', timecode_ms: 1000, ...extra });

  it('closes a cleared mark with a half-open window', () => {
    const parts = svc.buildFilterParts([rect({ end_timecode_ms: 4000 })]);
    expect(parts[0]).to.include("enable='gte(t\\,1)*lt(t\\,4)'");
  });
  it('leaves an open mark exactly as before', () => {
    expect(svc.buildFilterParts([rect({ end_timecode_ms: null })])[0]).to.include("enable='gte(t\\,1)'");
  });
  it('drops a mark that ends before it starts (never visible)', () => {
    expect(svc.buildFilterParts([rect({ end_timecode_ms: 1000 })])).to.deep.equal([]);
  });
});

describe('AnnotationRenderService.buildRenderGraph', () => {
  const svc = new AnnotationRenderService({} as any);
  const mark = (id: string, extra: any = {}) => ({ id, shape: 'CIRCLE', geometry: JSON.stringify({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }), color: 'red', timecode_ms: 1000, ...extra });

  it('overlays an image mark scaled to the frame, inside its window', () => {
    const g = svc.buildRenderGraph([mark('a', { end_timecode_ms: 3000 })], 10, () => '/x/a.png')!;
    expect(g.inputs).to.deep.equal(['/x/a.png']);
    expect(g.graph).to.equal(
      "[1:v][0:v]scale2ref=w=iw:h=ih[o1][b1];[b1][o1]overlay=0:0:enable='gte(t\\,1)*lt(t\\,3)'[v1]",
    );
    expect(g.output).to.equal('[v1]');
  });
  it('chains drawbox fallback marks first, then image overlays', () => {
    const g = svc.buildRenderGraph(
      [mark('a'), { ...mark('b'), shape: 'RECT' }],
      10,
      (a) => (a.id === 'a' ? '/x/a.png' : undefined),
    )!;
    expect(g.graph.startsWith('[0:v]drawbox=')).to.equal(true);
    expect(g.graph).to.include('[d0];[1:v][d0]scale2ref=w=iw:h=ih[o1][b1]');
    expect(g.output).to.equal('[v1]');
  });
  it('flags graphs that contain text so the caller can retry without it', () => {
    const g = svc.buildRenderGraph([{ ...mark('t'), shape: 'TEXT', text: 'hi', geometry: JSON.stringify({ x: 0.1, y: 0.1 }) }], 10, () => undefined)!;
    expect(g.hasText).to.equal(true);
  });
  it('returns null when nothing is drawable', () => {
    expect(svc.buildRenderGraph([mark('a', { end_timecode_ms: 500 })], 10, () => '/x/a.png')).to.equal(null);
  });
});
```

- [ ] **Step 2: Run the tests and check that they fail**

Run: `npx mocha test/unit/annotation-image.spec.ts test/unit/annotation-render.spec.ts`
Expected: FAIL (the module is not found, and `buildRenderGraph` is not a function).

- [ ] **Step 3: Implement `annotationImage.ts`**

```ts
import * as path from 'path';

/** Decoded-size cap for one mark's PNG. A full-frame freehand scribble is far below it. */
export const MAX_ANNOTATION_PNG_BYTES = 2 * 1024 * 1024;
const PREFIX = 'data:image/png;base64,';
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Where a mark's rendered image lives: beside the recording's `video/` dir,
 * so the cleanup that removes `<recordings>/<id>/` takes the images with it.
 */
export function annotationImagePath(videoFilePath: string, annotationId: string): string {
  return path.join(path.dirname(path.dirname(videoFilePath)), 'annotations', `${annotationId}.png`);
}

/** `null` = no image sent. Otherwise a decoded PNG or the reason it was refused. */
export function decodeAnnotationImage(
  image: unknown,
): null | { ok: true; png: Buffer } | { ok: false; error: string } {
  if (image === undefined || image === null) return null;
  if (typeof image !== 'string' || !image.startsWith(PREFIX)) {
    return { ok: false, error: 'image must be a data:image/png;base64 URL' };
  }
  const png = Buffer.from(image.slice(PREFIX.length), 'base64');
  if (png.length > MAX_ANNOTATION_PNG_BYTES) {
    return { ok: false, error: `image exceeds ${MAX_ANNOTATION_PNG_BYTES} bytes` };
  }
  if (png.length < PNG_SIG.length || !png.subarray(0, PNG_SIG.length).equals(PNG_SIG)) {
    return { ok: false, error: 'image is not a PNG' };
  }
  return { ok: true, png };
}
```

- [ ] **Step 4: Implement the renderer changes in `annotation-render.ts`**

1. Extend the row type and add a window helper:

```ts
export interface AnnotationRow {
  id?: string;
  shape: string;
  geometry: string;
  color?: string | null;
  text?: string | null;
  timecode_ms?: number | null;
  end_timecode_ms?: number | null;
}

export interface RenderGraph {
  /** Extra ffmpeg inputs after the source video, in order (input index = position + 1). */
  inputs: string[];
  graph: string;
  /** Label of the final video stream to `-map`. */
  output: string;
  /** True when a drawtext is present; the bundled ffmpeg has no fontconfig. */
  hasText: boolean;
}
```

Add this private method, and use it in `buildFilterParts` instead of building
`enable` from `tStart` alone. Skip the mark when it returns `null`:

```ts
  /** `enable=` expression for a mark, or null when its window is empty. */
  private enableExpr(a: AnnotationRow, videoDurationSec?: number): string | null {
    const start = this.clampTimecodeSec((a.timecode_ms ?? 0) / 1000, videoDurationSec);
    if (a.end_timecode_ms === null || a.end_timecode_ms === undefined) {
      return `enable='gte(t\\,${start})'`;
    }
    const end = Math.max(0, a.end_timecode_ms / 1000);
    // Half-open: `between` would still show the mark on the frame it was cleared.
    if (end <= start) return null;
    return `enable='gte(t\\,${start})*lt(t\\,${end})'`;
  }
```

In `buildFilterParts`, replace the two lines computing `tStart` and `enable`
with:

```ts
      const enable = this.enableExpr(a, videoDurationSec);
      if (!enable) continue;
```

2. Add `buildRenderGraph`:

```ts
  /**
   * The full filtergraph. Marks with an image are composited exactly as the
   * preview drew them. Marks without one (API clients, rows from before
   * images) fall back to drawbox. The fallback runs first so image marks,
   * which are what the user saw, sit on top.
   */
  buildRenderGraph(
    annotations: AnnotationRow[],
    videoDurationSec: number | undefined,
    imageFor: (a: AnnotationRow) => string | undefined,
  ): RenderGraph | null {
    const withImage: Array<{ a: AnnotationRow; file: string; enable: string }> = [];
    const drawn: AnnotationRow[] = [];
    for (const a of annotations) {
      const file = imageFor(a);
      if (!file) {
        drawn.push(a);
        continue;
      }
      const enable = this.enableExpr(a, videoDurationSec);
      if (enable) withImage.push({ a, file, enable });
    }
    const parts = this.buildFilterParts(drawn, videoDurationSec);
    const hasText = parts.some((p) => p.startsWith('drawtext='));
    const chunks: string[] = [];
    let cur = '[0:v]';
    if (parts.length > 0) {
      chunks.push(`[0:v]${parts.join(',')}[d0]`);
      cur = '[d0]';
    }
    withImage.forEach(({ enable }, i) => {
      const k = i + 1;
      // In scale2ref, iw/ih are the REFERENCE's size. main_w/main_h did not
      // scale on the bundled ffmpeg 4.4.
      chunks.push(`[${k}:v]${cur}scale2ref=w=iw:h=ih[o${k}][b${k}]`);
      chunks.push(`[b${k}][o${k}]overlay=0:0:${enable}[v${k}]`);
      cur = `[v${k}]`;
    });
    if (cur === '[0:v]') return null;
    return { inputs: withImage.map((w) => w.file), graph: chunks.join(';'), output: cur, hasText };
  }
```

3. Replace `renderToFile` so it uses the graph through a script file and
retries once without text:

```ts
  private async renderToFile(
    sourcePath: string,
    outPath: string,
    annotations: AnnotationRow[],
  ): Promise<void> {
    const durationSec = await this.probeDurationSec(sourcePath);
    const imageFor = (a: AnnotationRow) => this.imageFor(sourcePath, a);
    const plan = this.buildRenderGraph(annotations, durationSec, imageFor);
    if (!plan) {
      fs.copyFileSync(sourcePath, outPath);
      return;
    }
    try {
      await this.runGraph(sourcePath, outPath, plan);
    } catch (err: any) {
      if (!plan.hasText) throw err;
      // One undrawable text mark must not cost every other mark: the bundled
      // ffmpeg has freetype but no fontconfig, so drawtext cannot find a font.
      renderLog.warn(`Text marks could not be drawn, rendering without them: ${err?.message ?? err}`);
      const noText = annotations.filter((a) => a.shape !== 'TEXT' || !!imageFor(a));
      const retry = this.buildRenderGraph(noText, durationSec, imageFor);
      if (!retry) {
        fs.copyFileSync(sourcePath, outPath);
        return;
      }
      await this.runGraph(sourcePath, outPath, retry);
    }
  }

  private imageFor(sourcePath: string, a: AnnotationRow): string | undefined {
    if (!a.id) return undefined;
    const p = annotationImagePath(sourcePath, a.id);
    return fs.existsSync(p) ? p : undefined;
  }

  private async runGraph(sourcePath: string, outPath: string, plan: RenderGraph): Promise<void> {
    // A script file: no argv length limit with many marks, no shell quoting.
    const scriptPath = `${outPath}.filter.txt`;
    fs.writeFileSync(scriptPath, plan.graph, 'utf8');
    const args = ['-y', '-loglevel', 'error', '-i', sourcePath];
    for (const input of plan.inputs) args.push('-i', input);
    args.push(
      '-filter_complex_script', scriptPath,
      '-map', plan.output,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
      outPath,
    );
    try {
      await new Promise<void>((resolve, reject) => {
        const p = this.spawnFfmpeg(args, `annotate:${path.basename(outPath)}`);
        let stderr = '';
        p.stderr?.on('data', (d) => (stderr += d.toString()));
        p.on('error', reject);
        p.on('close', (code) => {
          if (code === 0) resolve();
          else {
            renderLog.warn(`ffmpeg exited ${code}: ${stderr.slice(-400)}`);
            reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-200)}`));
          }
        });
      });
    } finally {
      fs.rmSync(scriptPath, { force: true });
    }
  }
```

Import `annotationImagePath` from `./annotationImage`.

4. Stamp: the image, and whether and when a mark was cleared, must bust the
cache:

```ts
  private cacheStamp(sourcePath: string, annotations: AnnotationRow[]): string {
    const srcMtime = fs.statSync(sourcePath).mtimeMs;
    const parts = annotations.map((a) => {
      const img = this.imageFor(sourcePath, a);
      const imgMtime = img ? fs.statSync(img).mtimeMs : 0;
      return `${a.id ?? ''}:${a.timecode_ms ?? 0}:${a.end_timecode_ms ?? ''}:${a.shape}:${a.geometry}:${a.color ?? ''}:${a.text ?? ''}:${imgMtime}`;
    });
    // v3: time windows + image overlays.
    return `v3|${srcMtime}|${parts.join('|')}`;
  }
```

- [ ] **Step 5: Run the tests, expecting a pass**

Run: `npx mocha test/unit/annotation-image.spec.ts test/unit/annotation-render.spec.ts`. Expected: all pass (the existing tests are unchanged).

- [ ] **Step 6: Real ffmpeg smoke test**

Run the graph that `buildRenderGraph` produces for one image mark against the
bundled ffmpeg, using the scratch ring PNG and base video from the design
check. Frames at 0.5s and 2.5s must not show the ring. The frame at 1.5s must
show it centred.

- [ ] **Step 7: Commit**

```bash
git add src/services/recording/annotationImage.ts src/services/recording/annotation-render.ts test/unit/annotation-image.spec.ts test/unit/annotation-render.spec.ts
git commit -m "feat(recording): burn marks in exactly as drawn, and honour Clear marks"
```

---

### Task 4: Accept and store a mark's image

**Files:**
- Modify: `src/services/recording/RecordingOrchestrator.ts` (`addAnnotation`)
- Modify: `src/app/routers/recordings.ts` (`POST /recordings/:groupId/annotation`)
- Test: `test/unit/recording-orchestrator.spec.ts`

**Interfaces:**
- Consumes: `decodeAnnotationImage` and `annotationImagePath` (Task 3).
- Produces: `POST /annotation` accepts an optional `image` data URL, and a bad
  image returns `400`. `RecordingOrchestrator.addAnnotation(groupId, recordingId, ann, png?: Buffer)`.

- [ ] **Step 1: Write the failing test**

Append to `test/unit/recording-orchestrator.spec.ts`. Use its own
`makeOrchestrator` / fake store pattern; the existing test at the
`addBookmark` block shows the shape:

```ts
  it('addAnnotation writes the image beside the recording video', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ann-'));
    const video = path.join(dir, 'rec-1', 'video', 'rec-1.mp4');
    const store = {
      addAnnotation: sinon.stub().resolves({ id: 'ann-1', recording_id: 'rec-1' }),
      findById: sinon.stub().resolves({ id: 'rec-1', file_path: video }),
    };
    const orch = new RecordingOrchestrator({ store: store as any, eventMgr: { emitRecordingAnnotation: sinon.stub() } as any, busyPrecheck: {} as any, gate: {} as any, videoPipeline: {} as any });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
    await orch.addAnnotation('g', 'rec-1', { timecodeMs: 1, shape: 'RECT', geometry: '{}', color: 'red' }, png);
    expect(fs.readFileSync(path.join(dir, 'rec-1', 'annotations', 'ann-1.png')).equals(png)).to.equal(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
```

Add `import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';`
if they are not already imported.

- [ ] **Step 2: Run the test and check that it fails**

Run: `npx mocha test/unit/recording-orchestrator.spec.ts -g "writes the image"`. Expected: FAIL (the file does not exist).

- [ ] **Step 3: Implement**

`RecordingOrchestrator.addAnnotation` gets `png?: Buffer`:

```ts
    const a = await this.store.addAnnotation(recordingId, ann);
    if (png) {
      try {
        const rec: any = await this.store.findById(recordingId);
        if (rec?.file_path) {
          const file = annotationImagePath(rec.file_path, a.id);
          await fs.promises.mkdir(path.dirname(file), { recursive: true });
          await fs.promises.writeFile(file, png);
        }
      } catch (err: any) {
        // The row is saved, so the mark still renders, just with the drawbox fallback.
        recLog.warn(`annotation image not saved for ${a.id}: ${err?.message ?? err}`);
      }
    }
    this.eventMgr.emitRecordingAnnotation({ groupId, annotation: a });
    return a;
```

Use the file's existing logger name. If none exists, use
`log.scope('RecordingOrchestrator')`. Import `annotationImagePath`, plus
`fs`/`path` if they are missing.

In the route, before `try {`:

```ts
  const decoded = decodeAnnotationImage(req.body?.image);
  if (decoded && !decoded.ok) return res.status(400).json({ error: decoded.error });
```

Then pass `decoded?.ok ? decoded.png : undefined` as the 4th argument.

- [ ] **Step 4: Run the tests, expecting a pass**

Run: `npx mocha test/unit/recording-orchestrator.spec.ts`. Expected: all pass. Also run `npx tsc --noEmit -p .`.

- [ ] **Step 5: Commit**

```bash
git add src/services/recording/RecordingOrchestrator.ts src/app/routers/recordings.ts test/unit/recording-orchestrator.spec.ts
git commit -m "feat(recording): store each mark's rendered image with the recording"
```

---

### Task 5: Active-recordings endpoint

**Files:**
- Create: `src/services/recording/activeRecordings.ts`
- Modify: `src/app/routers/recordings.ts` (register `GET /recordings/active` **before** `GET /recordings/:groupId`)
- Test: `test/unit/active-recordings.spec.ts`

**Interfaces:**
- Produces:
  - `selectOwnActiveGroups(rows: ActiveRow[], lockOf: (udid: string) => string | null | undefined, actor: { userId?: string; apiKeyId?: string }): ActiveGroup[]`
  - `ActiveGroup = { groupId: string; startedAt: string; recordings: Array<{ id: string; udid: string }>; annotations: Array<{ recordingId: string; shape: string; geometry: string; color: string; text: string | null; timecodeMs: number }> }`
  - `GET /xenon/api/recordings/active` returns
    `{ serverNow: number; groups: Array<ActiveGroup & { compositeEnabled: boolean }> }`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/active-recordings.spec.ts`:

```ts
import { expect } from 'chai';
import { selectOwnActiveGroups } from '../../src/services/recording/activeRecordings';

const row = (id: string, group: string, udid: string, startedIso: string, annotations: any[] = []) => ({
  id, group_id: group, device_udid: udid, started_at: new Date(startedIso), annotations,
});

describe('selectOwnActiveGroups', () => {
  const locks: Record<string, string> = { U1: 'manual_alice_U1', U2: 'manual_bob_U2' };
  const lockOf = (u: string) => locks[u];

  it('returns only groups on devices the caller holds, admins included', () => {
    const out = selectOwnActiveGroups(
      [row('r1', 'g1', 'U1', '2026-09-25T10:00:00Z'), row('r2', 'g2', 'U2', '2026-09-25T10:00:00Z')],
      lockOf,
      { userId: 'alice' },
    );
    expect(out.map((g) => g.groupId)).to.deep.equal(['g1']);
  });

  it('reports the earliest start and only still-open marks', () => {
    const out = selectOwnActiveGroups(
      [
        row('r1', 'g1', 'U1', '2026-09-25T10:00:05Z', [
          { recording_id: 'r1', shape: 'RECT', geometry: '{"x":0}', color: 'red', text: null, timecode_ms: 100, end_timecode_ms: null },
          { recording_id: 'r1', shape: 'RECT', geometry: '{"x":1}', color: 'red', text: null, timecode_ms: 50, end_timecode_ms: 90 },
        ]),
      ],
      lockOf,
      { userId: 'alice' },
    );
    expect(out[0].startedAt).to.equal('2026-09-25T10:00:05.000Z');
    expect(out[0].recordings).to.deep.equal([{ id: 'r1', udid: 'U1' }]);
    expect(out[0].annotations).to.deep.equal([
      { recordingId: 'r1', shape: 'RECT', geometry: '{"x":0}', color: 'red', text: null, timecodeMs: 100 },
    ]);
  });

  it('recognises a lock keyed on the caller api-key id (upgrade tolerance)', () => {
    const out = selectOwnActiveGroups([row('r1', 'g1', 'U9', '2026-09-25T10:00:00Z')], () => 'manual_key1_U9', { userId: 'alice', apiKeyId: 'key1' });
    expect(out).to.have.length(1);
  });
});
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `npx mocha test/unit/active-recordings.spec.ts`. Expected: FAIL (the module is not found).

- [ ] **Step 3: Implement**

`src/services/recording/activeRecordings.ts`:

```ts
import { isSelfManualLock } from '../device-access/deviceAccessPolicy';

export interface ActiveRow {
  id: string;
  group_id: string;
  device_udid: string;
  started_at: Date;
  annotations?: Array<{
    recording_id: string;
    shape: string;
    geometry: string;
    color: string;
    text: string | null;
    timecode_ms: number;
    end_timecode_ms?: number | null;
  }>;
}

export interface ActiveGroup {
  groupId: string;
  startedAt: string;
  recordings: Array<{ id: string; udid: string }>;
  annotations: Array<{
    recordingId: string;
    shape: string;
    geometry: string;
    color: string;
    text: string | null;
    timecodeMs: number;
  }>;
}

/**
 * Recording groups the caller can pick back up after a reload. A group is the
 * caller's when they hold the manual lock on any of its devices. Admins are not
 * special here, as in tile rehydration: a mosaic must never adopt another
 * user's recording. Only open marks come back, because a cleared mark is no
 * longer on screen.
 */
export function selectOwnActiveGroups(
  rows: ActiveRow[],
  lockOf: (udid: string) => string | null | undefined,
  actor: { userId?: string; apiKeyId?: string },
): ActiveGroup[] {
  const groups = new Map<string, ActiveRow[]>();
  for (const r of rows) {
    const list = groups.get(r.group_id) ?? [];
    list.push(r);
    groups.set(r.group_id, list);
  }
  const out: ActiveGroup[] = [];
  for (const [groupId, list] of groups) {
    const mine = list.some((r) =>
      isSelfManualLock(lockOf(r.device_udid), r.device_udid, actor.userId, actor.apiKeyId),
    );
    if (!mine) continue;
    const started = Math.min(...list.map((r) => new Date(r.started_at).getTime()));
    out.push({
      groupId,
      startedAt: new Date(started).toISOString(),
      recordings: list.map((r) => ({ id: r.id, udid: r.device_udid })),
      annotations: list.flatMap((r) =>
        (r.annotations ?? [])
          .filter((a) => a.end_timecode_ms === null || a.end_timecode_ms === undefined)
          .map((a) => ({
            recordingId: a.recording_id,
            shape: a.shape,
            geometry: a.geometry,
            color: a.color,
            text: a.text ?? null,
            timecodeMs: a.timecode_ms,
          })),
      ),
    });
  }
  return out;
}
```

The route goes in `recordings.ts` **above** `router.get('/recordings/:groupId', …)`:

```ts
router.get('/recordings/active', async (req: Request, res: Response) => {
  try {
    const actor = resolveActor(req);
    const rows = await prisma.recording.findMany({
      where: { status: 'RECORDING' },
      include: { annotations: true },
    });
    const locks = new Map<string, string | null>();
    for (const udid of new Set(rows.map((r) => r.device_udid))) {
      const d = await DeviceStoreFactory.getStore().findDevice({ udid });
      locks.set(udid, d?.session_id ?? null);
    }
    const groups = selectOwnActiveGroups(rows as any, (u) => locks.get(u), actor).map((g) => ({
      ...g,
      compositeEnabled: fs.existsSync(compositeOutputPath(g.groupId)),
    }));
    return res.json({ serverNow: Date.now(), groups });
  } catch (e: any) {
    recLog.error(`GET /recordings/active failed: ${e?.message}`);
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
});
```

Import `DeviceStoreFactory` from `../../data-service/device-store` and
`selectOwnActiveGroups`.

- [ ] **Step 4: Run the tests, expecting a pass**

Run: `npx mocha test/unit/active-recordings.spec.ts`, then `npx tsc --noEmit -p .`. Expected: pass, and exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/services/recording/activeRecordings.ts src/app/routers/recordings.ts test/unit/active-recordings.spec.ts
git commit -m "feat(recording): list the caller's running recordings so a reload can resume them"
```

---

### Task 6: Client API and ordered writes, plus Clear marks wiring

**Files:**
- Modify: `web/src/api-service/recordings.ts`
- Create: `web/src/components/mosaic/writeQueue.ts`
- Test: `web/src/components/mosaic/writeQueue.test.ts`
- Modify: `web/src/components/mosaic/DeviceMosaicView.tsx` (`onAnnotation`, a new `onClearMarks`, passing it to `RecordingControls`)
- Modify: `web/src/components/mosaic/RecordingControls.tsx` (the `onClearMarks` prop, and the title copy)

**Interfaces:**
- Produces:
  - `createWriteQueue(): { enqueue<T>(task: () => Promise<T>): Promise<T> }`
  - `clearAnnotations(groupId: string, timecodeMs: number): Promise<{ cleared: number }>`
  - `getActiveRecordings(): Promise<ActiveRecordingsResponse>`
  - `AnnotationInput.image?: string`
  - `RecordingControls` props `{ selectedUdids: string[]; onClearMarks: () => void }`

- [ ] **Step 1: Write the failing queue test**

`web/src/components/mosaic/writeQueue.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createWriteQueue } from './writeQueue';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('createWriteQueue', () => {
  it('runs writes strictly in order, so a clear cannot overtake a mark', async () => {
    const q = createWriteQueue();
    const order: string[] = [];
    const mark = deferred();
    const a = q.enqueue(async () => { await mark.promise; order.push('mark'); });
    const b = q.enqueue(async () => { order.push('clear'); });
    await Promise.resolve();
    expect(order).toEqual([]); // the clear waits for the in-flight mark
    mark.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(['mark', 'clear']);
  });

  it('keeps going after a failed write', async () => {
    const q = createWriteQueue();
    const failed = q.enqueue(async () => { throw new Error('boom'); });
    const next = q.enqueue(async () => 'ok');
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });
});
```

- [ ] **Step 2: Run it and check that it fails**

Run (in `web/`): `npx vitest run src/components/mosaic/writeQueue.test.ts`. Expected: FAIL (the module is not found).

- [ ] **Step 3: Implement the queue and the API**

`web/src/components/mosaic/writeQueue.ts`:

```ts
/**
 * Serialises recording writes (marks, clears) in the order the user made them.
 * A Clear sent while a mark's POST is still in flight could otherwise reach the
 * server first, and the mark, created after the clear, would stay in the video
 * until the end. A failed write does not stall the ones after it.
 */
export function createWriteQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      const run = tail.then(task, task);
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}
```

In `api-service/recordings.ts`: add `image?: string` to `AnnotationInput`, then
append:

```ts
export function clearAnnotations(groupId: string, timecodeMs: number): Promise<{ cleared: number }> {
  return postJson(`${BASE}/${encodeURIComponent(groupId)}/annotations/clear`, { timecodeMs });
}

export interface ActiveRecordingGroup {
  groupId: string;
  startedAt: string;
  compositeEnabled: boolean;
  recordings: Array<{ id: string; udid: string }>;
  annotations: Array<{
    recordingId: string;
    shape: string;
    geometry: string;
    color: string;
    text: string | null;
    timecodeMs: number;
  }>;
}

export interface ActiveRecordingsResponse {
  serverNow: number;
  groups: ActiveRecordingGroup[];
}

export async function getActiveRecordings(): Promise<ActiveRecordingsResponse> {
  const r = await fetch(`${BASE}/active`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
```

- [ ] **Step 4: Wire it into `DeviceMosaicView`**

Import `createWriteQueue`, and `clearAnnotations` alongside `addAnnotation`.
Add `const writes = React.useRef(createWriteQueue());` (use the file's React
import style). Then replace `onAnnotation`:

```ts
  const onAnnotation = (recordingId: string, ann: any, image?: string | null) => {
    if (!state.groupId) return;
    const groupId = state.groupId;
    // Stamp at the moment of drawing, not when the queued request finally leaves.
    const timecodeMs = state.startedAt ? Date.now() - state.startedAt : 0;
    const body = {
      recordingId,
      timecodeMs,
      shape: ann.shape,
      geometry: JSON.stringify(ann.geometry),
      color: ann.color,
      text: ann.text,
    };
    void writes.current
      .enqueue(async () => {
        try {
          return await addAnnotation(groupId, image ? { ...body, image } : body);
        } catch (e) {
          // An image the server refuses must not lose the mark: it still renders, as a box.
          if (!image) throw e;
          return addAnnotation(groupId, body);
        }
      })
      .catch((e: any) =>
        dispatch({ type: 'SET_ERROR_BANNER', message: `Annotation failed: ${e.message}` }),
      );
  };

  const onClearMarks = () => {
    if (!state.groupId) return;
    const groupId = state.groupId;
    const timecodeMs = state.startedAt ? Date.now() - state.startedAt : 0;
    dispatch({ type: 'CLEAR_OVERLAY_ANNOTATIONS' });
    void writes.current.enqueue(() => clearAnnotations(groupId, timecodeMs)).catch(() =>
      dispatch({
        type: 'SET_ERROR_BANNER',
        message: "Couldn't clear marks from the recording. They will still appear in the video.",
      }),
    );
  };
```

Pass `onClearMarks={onClearMarks}` wherever `<RecordingControls` is rendered.

- [ ] **Step 5: Update `RecordingControls`**

Change the props to `{ selectedUdids: string[]; onClearMarks: () => void }`.
Replace the body of `clearAnnotations` with `if (!canAnnotate) return; onClearMarks();`,
and change the Clear button `title` to
`"Clear marks from the preview and the recording"`.

- [ ] **Step 6: Run the tests, expecting a pass**

Run (in `web/`): `npx vitest run src/components/mosaic/` and `npx tsc --noEmit -p .`. Expected: pass, and exit 0.

- [ ] **Step 7: Commit**

```bash
git add web/src/api-service/recordings.ts web/src/components/mosaic/writeQueue.ts web/src/components/mosaic/writeQueue.test.ts web/src/components/mosaic/DeviceMosaicView.tsx web/src/components/mosaic/RecordingControls.tsx
git commit -m "feat(web): Clear marks clears the recording too, in order with the marks"
```

---

### Task 7: Resume a running recording after a reload

**Files:**
- Modify: `web/src/components/mosaic/recording-group-store.ts` (the `REHYDRATE_RECORDING` action)
- Test: `web/src/components/mosaic/recording-group-store.test.ts`
- Modify: `web/src/components/mosaic/DeviceMosaicView.tsx` (the mount rehydration effect)

**Interfaces:**
- Consumes: `getActiveRecordings()` (Task 6).
- Produces: the action
  `{ type: 'REHYDRATE_RECORDING'; groupId: string; startedAt: number; tileIds: Record<string, string>; compositeEnabled: boolean; overlayAnnotations: Record<string, OverlayAnnotation[]> }`.

- [ ] **Step 1: Write the failing reducer test**

Append to `recording-group-store.test.ts`:

```ts
describe('mosaicReducer — REHYDRATE_RECORDING', () => {
  it('restores the running recording, its timer origin and its open marks', () => {
    const base = mosaicReducer(initialMosaicState, { type: 'ADD_TILE', tile: tile('u1') });
    const marks = { 'rec-1': [{ shape: 'RECT' as const, color: 'red', geometry: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }] };
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
```

- [ ] **Step 2: Run it and check that it fails**

Run: `npx vitest run src/components/mosaic/recording-group-store.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the action**

Add to the `MosaicAction` union:

```ts
  | {
      type: 'REHYDRATE_RECORDING';
      groupId: string;
      startedAt: number;
      tileIds: Record<string, string>;
      compositeEnabled: boolean;
      overlayAnnotations: Record<string, OverlayAnnotation[]>;
    }
```

Add to the reducer:

```ts
    case 'REHYDRATE_RECORDING': {
      const tiles = state.tiles.map((t) => ({
        ...t,
        recordingId: action.tileIds[t.udid] ?? t.recordingId,
      }));
      return {
        ...state,
        groupId: action.groupId,
        compositeEnabled: action.compositeEnabled,
        downloadableVideoCount: 0,
        recordingPhase: 'recording',
        recording: true,
        annotateMode: false,
        startedAt: action.startedAt,
        overlayAnnotations: action.overlayAnnotations,
        tiles,
      };
    }
```

- [ ] **Step 4: Rework the mount rehydration in `DeviceMosaicView`**

The effect currently returns early when no tile candidates stream. Restructure
it so it always checks for running recordings after the tiles:

```ts
    (async () => {
      let list: DeviceRow[] = [];
      try {
        list = await XenonApiService.getDevices();
      } catch {
        return;
      }
      let tiles: MosaicTile[] = [];
      try {
        /* …the existing candidate + stream/status logic, unchanged, but
           assigning to `tiles` instead of returning early… */
        if (!cancelled && tiles.length > 0) dispatch({ type: 'SET_TILES', tiles });
      } catch {
        /* best-effort */
      }
      try {
        const { serverNow, groups } = await getActiveRecordings();
        const g = groups[0];
        if (cancelled || !g) return;
        // Recording devices may not have been picked up above; add them.
        const known = new Set(tiles.map((t) => t.udid));
        const missing = g.recordings
          .filter((r) => !known.has(r.udid))
          .map((r) => list.find((d) => d.udid === r.udid))
          .filter((d): d is DeviceRow => !!d)
          .map(buildTile);
        if (missing.length > 0) dispatch({ type: 'SET_TILES', tiles: [...tiles, ...missing] });
        const tileIds = Object.fromEntries(g.recordings.map((r) => [r.udid, r.id]));
        const overlayAnnotations: Record<string, OverlayAnnotation[]> = {};
        for (const a of g.annotations) {
          let geometry: OverlayAnnotation['geometry'];
          try {
            geometry = JSON.parse(a.geometry);
          } catch {
            continue;
          }
          (overlayAnnotations[a.recordingId] ??= []).push({
            shape: a.shape as AnnotationShape,
            color: a.color,
            geometry,
            text: a.text ?? undefined,
          });
        }
        dispatch({
          type: 'REHYDRATE_RECORDING',
          groupId: g.groupId,
          // Rebase onto this browser's clock, so skew between client and
          // server cannot shift new marks' timecodes.
          startedAt: Date.now() - (serverNow - Date.parse(g.startedAt)),
          tileIds,
          compositeEnabled: g.compositeEnabled,
          overlayAnnotations,
        });
      } catch {
        /* best-effort: the recording is still stoppable server-side */
      }
    })();
```

Extract the existing inline tile literal (`udid, name, mjpegPort: 0, aspect,
screenWidth, screenHeight, platform`) into a local
`const buildTile = (d: DeviceRow): MosaicTile => ({ … })`, used by both paths.
Import `getActiveRecordings`, `OverlayAnnotation` and `AnnotationShape`.

- [ ] **Step 5: Run the tests, expecting a pass**

Run: `npx vitest run src/components/mosaic/`, then `npx tsc --noEmit -p .`. Expected: pass, and exit 0.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/mosaic/recording-group-store.ts web/src/components/mosaic/recording-group-store.test.ts web/src/components/mosaic/DeviceMosaicView.tsx
git commit -m "fix(web): a reload resumes the running recording instead of orphaning it"
```

---

### Task 8: Exact-match raster and real freehand

**Files:**
- Modify: `web/src/components/mosaic/recording-group-store.ts` (`OverlayAnnotation.geometry.points?`)
- Modify: `web/src/components/mosaic/AnnotationOverlay.tsx`
- Create: `web/src/components/mosaic/rasterizeAnnotation.ts`
- Test: `web/src/components/mosaic/AnnotationOverlay.test.tsx`, `web/src/components/mosaic/rasterizeAnnotation.test.ts`
- Modify: `web/src/components/mosaic/DeviceTile.tsx` (`onCommit` passes the image through)
- Modify: `web/src/components/mosaic/DeviceMosaic.tsx` (prop type)

**Interfaces:**
- Produces:
  - `appendPoint(points: Array<[number, number]>, x: number, y: number): Array<[number, number]>`, which drops a point under 2px and caps the list at 2000.
  - `rasterSize(w: number, h: number): { w: number; h: number }`
  - `rasterizeAnnotation(ann, displayW, displayH, doc?): string | null`
  - `onCommit(ann, image: string | null)`
  - `onAnnotation(recordingId, ann, image?)`

- [ ] **Step 1: Write the failing tests**

Append to `AnnotationOverlay.test.tsx`, and add `appendPoint` and
`paintAnnotation` to the import:

```ts
describe('appendPoint (freehand path)', () => {
  it('drops points closer than 2px to the last one', () => {
    const p = appendPoint([[0, 0]], 1, 1);
    expect(p).toEqual([[0, 0]]);
    expect(appendPoint(p, 3, 0)).toEqual([[0, 0], [3, 0]]);
  });
  it('caps the path at 2000 points', () => {
    const full = Array.from({ length: 2000 }, (_, i) => [i * 3, 0] as [number, number]);
    expect(appendPoint(full, 99999, 0)).toHaveLength(2000);
  });
});

describe('paintAnnotation FREEHAND', () => {
  it('strokes the recorded path instead of a rectangle', () => {
    const calls: string[] = [];
    const ctx: any = new Proxy({}, {
      get: (_t, k) => (typeof k === 'string' && ['beginPath', 'moveTo', 'lineTo', 'stroke', 'strokeRect', 'fillRect'].includes(k) ? () => calls.push(k) : undefined),
      set: () => true,
    });
    paintAnnotation(ctx, 100, 200, {
      shape: 'FREEHAND', color: '#ff0000',
      geometry: { x: 0.1, y: 0.1, w: 0.5, h: 0.5, points: [[0.1, 0.1], [0.3, 0.4], [0.6, 0.6]] },
    });
    expect(calls).toContain('lineTo');
    expect(calls).not.toContain('strokeRect');
  });
});
```

Create `rasterizeAnnotation.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { rasterSize, rasterizeAnnotation } from './rasterizeAnnotation';

describe('rasterizeAnnotation', () => {
  it('sizes the raster to the tile aspect with a 1600px long side', () => {
    expect(rasterSize(277, 572)).toEqual({ w: 775, h: 1600 });
  });

  it('paints through a context scaled from tile CSS px to the raster', () => {
    const ctx: any = new Proxy({ scale: vi.fn() }, {
      get: (t: any, k) => (k in t ? t[k] : () => undefined),
      set: () => true,
    });
    const canvas: any = { width: 0, height: 0, getContext: () => ctx, toDataURL: () => 'data:image/png;base64,AAA' };
    const doc: any = { createElement: () => canvas };
    const out = rasterizeAnnotation(
      { shape: 'RECT', color: '#ff0000', geometry: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
      277, 572, doc,
    );
    expect(out).toBe('data:image/png;base64,AAA');
    expect(canvas.width).toBe(775);
    expect(canvas.height).toBe(1600);
    expect(ctx.scale).toHaveBeenCalledWith(775 / 277, 1600 / 572);
  });

  it('returns null without a 2d context', () => {
    const doc: any = { createElement: () => ({ getContext: () => null }) };
    expect(rasterizeAnnotation({ shape: 'RECT', color: 'red', geometry: { x: 0, y: 0, w: 1, h: 1 } }, 10, 10, doc)).toBe(null);
  });
});
```

- [ ] **Step 2: Run them and check that they fail**

Run: `npx vitest run src/components/mosaic/AnnotationOverlay.test.tsx src/components/mosaic/rasterizeAnnotation.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

In `recording-group-store.ts`, change the `OverlayAnnotation.geometry` type to
`{ x: number; y: number; w?: number; h?: number; points?: Array<[number, number]> }`.

In `AnnotationOverlay.tsx`:

```ts
const MIN_POINT_DIST = 2;
const MAX_POINTS = 2000;

/** Append a freehand point, dropping jitter under 2px and capping the path. */
export function appendPoint(
  points: Array<[number, number]>,
  x: number,
  y: number,
): Array<[number, number]> {
  if (points.length >= MAX_POINTS) return points;
  const last = points[points.length - 1];
  if (last && Math.hypot(x - last[0], y - last[1]) < MIN_POINT_DIST) return points;
  return [...points, [x, y]];
}
```

- Add `points: Array<[number, number]>` to `DragState`.
  - `onPointerDown` starts it as `[[n.px, n.py]]`.
  - `onPointerMove` sets `points: appendPoint(prev.points, n.px, n.py)`.
  - `finishDrag` appends the final point.
- In `annotationFromDrag`, add a FREEHAND branch before the RECT fallthrough:

```ts
  if (shape === 'FREEHAND') {
    if (drag.points.length < 2) return null;
    const xs = drag.points.map((p) => p[0]);
    const ys = drag.points.map((p) => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      shape,
      color,
      geometry: {
        // Bounding box: what the drawbox fallback and older readers use.
        x: minX / canvasW,
        y: minY / canvasH,
        w: Math.max(0.005, (Math.max(...xs) - minX) / canvasW),
        h: Math.max(0.005, (Math.max(...ys) - minY) / canvasH),
        points: drag.points.map(([px, py]) => [px / canvasW, py / canvasH] as [number, number]),
      },
    };
  }
```

- In `paintAnnotation`, add a FREEHAND branch before `// RECT + FREEHAND`. A
  row without points still falls through to the rectangle:

```ts
  if (ann.shape === 'FREEHAND' && (g.points?.length ?? 0) >= 2) {
    const pts = g.points!;
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0] * canvasW, pts[0][1] * canvasH);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * canvasW, pts[i][1] * canvasH);
    };
    ctx.lineWidth = stroke + 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    trace();
    ctx.stroke();
    ctx.lineWidth = stroke;
    ctx.strokeStyle = color;
    trace();
    ctx.stroke();
    return;
  }
```

- In `finishDrag`, **replace** `onCommit(ann);` with
  `onCommit(ann, rasterizeAnnotation(ann, n.w, n.h));`. Change the `Props.onCommit`
  type to `(a: NormalizedAnnotation, image: string | null) => void`.

Create `rasterizeAnnotation.ts`:

```ts
import type { OverlayAnnotation } from './recording-group-store';
import { paintAnnotation } from './AnnotationOverlay';

export const RASTER_LONG_SIDE = 1600;

/** Raster with the tile's aspect ratio and a fixed long side, so strokes stay sharp once scaled to the video. */
export function rasterSize(w: number, h: number): { w: number; h: number } {
  const k = RASTER_LONG_SIDE / Math.max(w, h);
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/**
 * Render one mark to a transparent PNG with the exact code the live overlay
 * uses. The context is scaled from tile CSS px, so stroke width and arrow-head
 * size keep the proportion to the frame that the user saw. The server
 * composites it over the video, so the recording matches the preview.
 */
export function rasterizeAnnotation(
  ann: OverlayAnnotation,
  displayW: number,
  displayH: number,
  doc: Pick<Document, 'createElement'> = document,
): string | null {
  if (displayW <= 0 || displayH <= 0) return null;
  const { w, h } = rasterSize(displayW, displayH);
  const canvas = doc.createElement('canvas') as HTMLCanvasElement;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(w / displayW, h / displayH);
  paintAnnotation(ctx, displayW, displayH, ann);
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
```

`rasterizeAnnotation.ts` imports `paintAnnotation` from `AnnotationOverlay.tsx`,
and `AnnotationOverlay.tsx` imports `rasterizeAnnotation`. That cycle is safe
because neither is used at module-evaluation time. If the linter flags it,
move `paintAnnotation` into `paintAnnotation.ts` and re-export it.

In `DeviceTile.tsx`, change `onCommit={(a) => onAnnotation(recordingId!, a)}` to
`onCommit={(a, image) => onAnnotation(recordingId!, a, image)}`. Widen the
`onAnnotation` prop types in `DeviceTile.tsx` and `DeviceMosaic.tsx` to
`(recordingId: string, ann: NormalizedAnnotation, image?: string | null) => void`.

- [ ] **Step 4: Run the tests, expecting a pass**

Run: `npx vitest run src/components/mosaic/`, then `npx tsc --noEmit -p .`. Expected: pass, and exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/mosaic/recording-group-store.ts web/src/components/mosaic/AnnotationOverlay.tsx web/src/components/mosaic/AnnotationOverlay.test.tsx web/src/components/mosaic/rasterizeAnnotation.ts web/src/components/mosaic/rasterizeAnnotation.test.ts web/src/components/mosaic/DeviceTile.tsx web/src/components/mosaic/DeviceMosaic.tsx
git commit -m "feat(web): real freehand, and every mark rendered into the video exactly as drawn"
```

---

### Task 9: A toolbar that stays put, a smaller hint, no Bookmark

**Files:**
- Modify: `web/src/components/mosaic/RecordingControls.tsx`
- Create: `web/src/components/mosaic/RecordingControls.test.tsx`
- Modify: `web/src/components/mosaic/DeviceMosaicView.tsx` (remove the `B` hotkey and the `addBookmark` import)
- Modify: `web/src/api-service/recordings.ts` (remove the `addBookmark` export)
- Modify: `web/src/components/mosaic/DeviceTile.tsx` (the hint chip)

**Interfaces:**
- Consumes: the `RecordingControls` props from Task 6.

- [ ] **Step 1: Write the failing test**

`RecordingControls.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecordingControls } from './RecordingControls';
import { MosaicContext, initialMosaicState, mosaicReducer, type MosaicState } from './recording-group-store';

function recording(annotateMode: boolean, withMarks: boolean): MosaicState {
  let s = mosaicReducer(initialMosaicState, { type: 'ADD_TILE', tile: { udid: 'u1', mjpegPort: 0 } });
  s = mosaicReducer(s, { type: 'START_RECORDING', groupId: 'g', startedAt: Date.now(), tileIds: { u1: 'r1' } });
  s = mosaicReducer(s, { type: 'SET_ANNOTATE_MODE', enabled: annotateMode });
  if (withMarks) {
    s = mosaicReducer(s, { type: 'SET_OVERLAY_ANNOTATIONS', recordingId: 'r1', annotations: [{ shape: 'RECT', color: 'red', geometry: { x: 0, y: 0, w: 0.1, h: 0.1 } }] });
  }
  return s;
}

const names = () => screen.getAllByRole('button').map((b) => b.textContent?.trim());

function mount(state: MosaicState) {
  return render(
    <MosaicContext.Provider value={{ state, dispatch: vi.fn() }}>
      <RecordingControls selectedUdids={['u1']} onClearMarks={vi.fn()} />
    </MosaicContext.Provider>,
  );
}

describe('RecordingControls toolbar', () => {
  it('renders the same buttons whether or not annotate is on or marks exist', () => {
    const { unmount } = mount(recording(false, false));
    const off = names();
    unmount();
    mount(recording(true, true));
    expect(names()).toEqual(off);
  });

  it('disables rather than hides: shapes when annotate is off, Clear when there are no marks', () => {
    mount(recording(false, false));
    expect((screen.getByRole('button', { name: 'Rect' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Clear marks' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('has no Bookmark option', () => {
    mount(recording(true, true));
    expect(screen.queryByRole('button', { name: /bookmark/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and check that it fails**

Run: `npx vitest run src/components/mosaic/RecordingControls.test.tsx`. Expected: FAIL (the buttons differ, and Bookmark is present).

- [ ] **Step 3: Implement**

In `RecordingControls.tsx`:
- Delete the `addBookmark` import, `onBookmark`, and the Bookmark `<button>`.
- Replace the `{state.annotateMode && canAnnotate && (…shapes + color…)}` block
  and the `{canAnnotate && hasOverlayAnnotations && (…Clear…)}` block with one
  group, rendered whenever `isActivelyRecording`:

```tsx
      {isActivelyRecording && (
        <div className="flex items-center gap-1 ml-1 pl-2 border-l border-[var(--border)]">
          {shapes.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={!canDraw}
              aria-pressed={state.shape === s.id}
              onClick={() => dispatch({ type: 'SET_SHAPE', shape: s.id })}
              className={`px-2 py-1 text-xs rounded border disabled:opacity-40 disabled:cursor-not-allowed ${
                state.shape === s.id
                  ? 'bg-[var(--surface-2)] border-[var(--color-info)] text-[rgb(var(--rgb-fg))]'
                  : 'border-[var(--border)] opacity-80 hover:opacity-100'
              }`}
            >
              {s.label}
            </button>
          ))}
          <input
            type="color"
            value={state.color}
            disabled={!canDraw}
            onChange={(e) => dispatch({ type: 'SET_COLOR', color: e.target.value })}
            title="Annotation color"
            aria-label="Annotation color"
            className="w-7 h-7 rounded border border-[var(--border)] bg-transparent cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          />
          <button
            type="button"
            onClick={clearAnnotations}
            disabled={!canAnnotate || !hasOverlayAnnotations}
            title="Clear marks from the preview and the recording"
            className="px-2 py-1 text-xs rounded border border-[var(--border)] hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Clear marks
          </button>
        </div>
      )}
```

with `const canDraw = canAnnotate && state.annotateMode;` beside `canAnnotate`.

In `DeviceMosaicView.tsx`, delete the `// Hotkey: B to add a bookmark…`
`useEffect`, and drop `addBookmark` from its import. In
`api-service/recordings.ts`, delete `export function addBookmark(…)`. Keep the
`bookmarks` field on the group type: the server still returns it.

In `DeviceTile.tsx`, replace the bottom banner block
(`{recording && annotateMode && streamState === 'live' && ( <div className="absolute bottom-3 …">…</div> )}`) with:

```tsx
        {recording && annotateMode && streamState === 'live' && (
          <div className="absolute top-3 right-3 z-30 pointer-events-none">
            <span className="px-2 py-0.5 rounded-sm bg-[var(--color-info)] text-white text-[10px] font-semibold shadow-lg whitespace-nowrap">
              Annotating · drag to mark
            </span>
          </div>
        )}
```

- [ ] **Step 4: Run the tests, expecting a pass**

Run (in `web/`): `npx vitest run`, then `npx tsc --noEmit -p .`. Expected: all pass with 0 errors, including the colour-literal ratchet, and exit 0. Then run `grep -rn addBookmark web/src`. Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/mosaic/RecordingControls.tsx web/src/components/mosaic/RecordingControls.test.tsx web/src/components/mosaic/DeviceMosaicView.tsx web/src/api-service/recordings.ts web/src/components/mosaic/DeviceTile.tsx
git commit -m "fix(web): annotation toolbar stays put, smaller hint, remove Bookmark"
```

---

### Task 10: Build, restart, verify live

**Files:** none. This task produces evidence only.

- [ ] **Step 1: Full suites**

- Run the backend suite with `npm run test:all`. Expected: green.
- Run the web suite with `cd web && npx vitest run`. Expected: all pass, 0 errors.
- Run `npx tsc --noEmit -p .` at the repo root and in `web/`.
- Run `npx prettier --check` on every changed file.

- [ ] **Step 2: SQLite migration on a scratch DB**

Run: `DATABASE_URL="file:$SCRATCH/mig.db" npx prisma migrate deploy --schema prisma/schema.prisma`, then
`sqlite3 $SCRATCH/mig.db 'PRAGMA table_info("Annotation");' | grep end_timecode_ms`.
Expected: the column is listed.

- [ ] **Step 3: Build and restart the real (Postgres) server**

- Run `npm run build && npm run build:xenon && npm run build:copy`.
- Restart with the prior session's `restart.sh`, the same command the running
  server uses.
- Check the log: `[DBMigrate] Database schema in sync`,
  `listener started`, and no `Fatal`. Check that `curl /wd/hub/status`
  reports ready.

- [ ] **Step 4: Live matrix on the S9+**

Each case must be checked in frames extracted from the downloaded
`video.mp4`, not in the preview.

1. Rect, Circle, Arrow and freehand, each in a distinct colour: the video
   matches the preview in shape, position and colour.
2. Clear marks at time T: marks are gone after T, and a mark drawn after T
   appears.
3. Reload mid-recording: REC and its timer resume, the marks reappear, and
   Stop works. The downloaded video still has the marks.
4. Record again after a reload while recording: it is refused, with a
   `recording_other_group` banner. Exactly one capture ffmpeg is running.
5. Layouts 1, 2×2 and 3×2: marks land on their targets.
6. Stress: 40+ marks. The render finishes, and the download works.
7. POST a `TEXT` mark through the API: the other marks still render.
8. Toolbar: nothing moves when marks appear or clear, or when Annotate
   toggles. There is no Bookmark button, and `B` does nothing.

- [ ] **Step 5: Push and open the PR**

Run `git push -u origin feat/annotation-clear-marks`, then open the PR with a
summary, evidence and test plan.
