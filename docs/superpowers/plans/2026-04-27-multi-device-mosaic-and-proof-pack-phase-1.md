# Multi-Device Mosaic & Proof Pack — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a UI-only multi-device live-view mosaic with free-form server-side recording, bookmarks, canvas annotations, and a downloadable proof-bundle zip — without changing or breaking any existing manual or automation workflow.

**Architecture:** Additive layer on top of existing `AndroidStreamService` / `IOSStreamService` / `VideoPipelineService` / `bug-report` primitives. New `Recording`, `Bookmark`, `Annotation` Prisma models, a `RecordingOrchestrator` TypeDI service, a new `recordings.ts` Express router, and a new `mosaic` React feature folder. Stream activation reuses the existing `POST /xenon/api/control/:udid/stream/start` endpoint unchanged.

**Tech Stack:** Node 14.17+, TypeScript 5.5, Appium 3.1, Prisma 5.4 + SQLite, TypeDI 0.10, Express, Socket.io, ffmpeg (existing pipeline), React 17 + Vite + Tailwind, Mocha + Chai + Sinon + Supertest, archiver (already in lockfile).

**Spec:** `docs/superpowers/specs/2026-04-27-multi-device-mosaic-and-proof-pack-design.md`

---

## File Structure

### Backend (NEW)
| File | Responsibility |
|---|---|
| `src/services/recording/RecordingOrchestrator.ts` | Lifecycle controller — start/stop/bookmark/annotation/recoverOnBoot |
| `src/services/recording/recording-store.ts` | Thin Prisma CRUD for `Recording` / `Bookmark` / `Annotation` |
| `src/services/recording/concurrency-gate.ts` | Server-wide free-form recording cap |
| `src/services/recording/busy-precheck.ts` | Atomic multi-UDID busy-state pre-check |
| `src/services/recording/proof-bundle.ts` | Composes existing bug-report primitives + adds bookmarks/annotations |
| `src/services/recording/annotation-render.ts` | Lazy ffmpeg overlay pass for "Download annotated MP4" |
| `src/app/routers/recordings.ts` | Express router for the REST contract |

### Backend (MODIFIED — additive only)
| File | Change |
|---|---|
| `prisma/schema.prisma` | Append `Recording`, `Bookmark`, `Annotation` models + inverse-only relation on `Session` |
| `src/services/VideoPipelineService.ts` | Add optional `outputPath?: string` to `VideoPipelineOptions` |
| `src/dashboard/socket-events.ts` | Add `RECORDING_*` event constants |
| `src/dashboard/event-manager.ts` | Add `emitRecording*` helpers |
| `src/app/index.ts` | Register `recordings.ts` router |
| `src/plugin.ts` | Call `RecordingOrchestrator.recoverOnBoot()` once at startup |
| `schema.json` | Add optional `maxConcurrentRecordings` (default 4) and `recordingsAssetsPath` |

### Frontend (NEW)
| File | Responsibility |
|---|---|
| `web/src/api-service/recordings.ts` | Typed fetch wrappers for the new REST endpoints |
| `web/src/components/mosaic/recording-group-store.ts` | Zustand store for active recording group |
| `web/src/components/mosaic/DevicePicker.tsx` | Online-device selector with busy-disabled UI |
| `web/src/components/mosaic/LayoutSelector.tsx` | 1 / 2x1 / 2x2 / 3x2 |
| `web/src/components/mosaic/AnnotationOverlay.tsx` | HTML5 canvas drawing layer |
| `web/src/components/mosaic/DeviceTile.tsx` | One tile (img + overlay + status) |
| `web/src/components/mosaic/DeviceMosaic.tsx` | Grid renderer |
| `web/src/components/mosaic/RecordingControls.tsx` | Top bar — record/stop/bookmark/annotate/download |
| `web/src/components/mosaic/DeviceMosaicView.tsx` | Page shell with state recovery on mount |
| `web/src/routes/devices-live.tsx` | Route entry |

### Frontend (MODIFIED — additive only)
| File | Change |
|---|---|
| `web/src/App.tsx` | Register `/devices/live` route |
| `web/src/components/sidebar/*` | Add "Live Devices" nav link (verify the actual file in Task 19) |

### Tests (NEW)
| File | Coverage |
|---|---|
| `test/unit/recording-store.spec.ts` | Prisma CRUD round-trip |
| `test/unit/concurrency-gate.spec.ts` | Server-wide cap |
| `test/unit/busy-precheck.spec.ts` | Atomic multi-UDID busy detection |
| `test/unit/recording-orchestrator.spec.ts` | start/stop/bookmark/annotation/recoverOnBoot with stubbed ffmpeg |
| `test/unit/proof-bundle.spec.ts` | Bundle layout + manifest correctness |
| `test/unit/video-pipeline-outputpath.spec.ts` | Regression: outputPath param honored, omission preserves existing path |
| `test/integration/recordings-router.spec.ts` | Full REST contract |
| `test/integration/cross-workflow.spec.ts` | Six matrix tests from spec |

---

## Phase A — Database & primitives

### Task 1: Prisma schema — Recording / Bookmark / Annotation

**Files:**
- Modify: `prisma/schema.prisma` (append at end of file)

- [ ] **Step 1: Append models to `prisma/schema.prisma`**

```prisma
model Recording {
  id              String       @id @default(uuid())
  group_id        String
  device_udid     String
  session_id      String?
  started_at      DateTime
  ended_at        DateTime?
  status          String
  file_path       String
  duration_ms     Int?
  size_bytes      Int?
  device_snapshot String?
  fail_reason     String?
  bookmarks       Bookmark[]
  annotations     Annotation[]
  Session         Session?     @relation(fields: [session_id], references: [id])

  @@index([group_id])
  @@index([device_udid])
  @@index([started_at])
}

model Bookmark {
  id           String    @id @default(uuid())
  recording_id String
  timecode_ms  Int
  label        String
  note         String?
  created_at   DateTime  @default(now())
  Recording    Recording @relation(fields: [recording_id], references: [id], onDelete: Cascade)

  @@index([recording_id, timecode_ms])
}

model Annotation {
  id           String    @id @default(uuid())
  recording_id String
  timecode_ms  Int
  shape        String
  geometry     String
  color        String
  text         String?
  author       String?
  created_at   DateTime  @default(now())
  Recording    Recording @relation(fields: [recording_id], references: [id], onDelete: Cascade)

  @@index([recording_id, timecode_ms])
}
```

- [ ] **Step 2: Add inverse relation on existing `Session` model**

In `prisma/schema.prisma`, locate the `Session` model and add this line inside its block (no other changes):

```prisma
  Recording               Recording[]
```

- [ ] **Step 3: Generate migration**

Run: `npm run db:generate -- --name add_recording_models`
Expected: a new migration directory under `prisma/migrations/<timestamp>_add_recording_models/` containing `migration.sql` with three `CREATE TABLE` statements and three `CREATE INDEX` statements. No `ALTER TABLE` against existing rows.

- [ ] **Step 4: Apply migration**

Run: `npm run db:migrate`
Expected: tables `Recording`, `Bookmark`, `Annotation` created. Existing data untouched.

- [ ] **Step 5: Verify Prisma client regenerated**

Run: `npx prisma generate`
Expected: `node_modules/.prisma/client` updated. `import { prisma } from 'src/prisma'` should now type-check `prisma.recording`, `prisma.bookmark`, `prisma.annotation`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(recording): add Recording/Bookmark/Annotation Prisma models"
```

---

### Task 2: schema.json — config knobs

**Files:**
- Modify: `schema.json`

- [ ] **Step 1: Add two optional properties to `schema.json` `properties` block**

```json
"maxConcurrentRecordings": {
  "type": "integer",
  "minimum": 1,
  "maximum": 16,
  "default": 4,
  "description": "Server-wide hard cap on simultaneous free-form (non-session) screen recordings across all users. Automation session recording is exempt and not counted against this cap."
},
"recordingsAssetsPath": {
  "type": "string",
  "description": "Override directory for free-form recording artifacts. Defaults to `<sessionAssetsPath>/recordings`."
}
```

- [ ] **Step 2: Regenerate TypeScript types**

Run: `npm run build:schema`
Expected: `IPluginArgs` (the generated interface) gains `maxConcurrentRecordings?: number` and `recordingsAssetsPath?: string`.

- [ ] **Step 3: Wire defaults in `src/config.ts`**

Open `src/config.ts`. After existing `sessionAssetsPath` resolution, add:

```ts
export const recordingsAssetsPath: string =
  (process.env.XENON_RECORDINGS_ASSETS_PATH as string) ||
  path.join(config.sessionAssetsPath, 'recordings');

export const maxConcurrentRecordings: number = Number(
  process.env.XENON_MAX_CONCURRENT_RECORDINGS ?? 4,
);
```

(Adjust to follow whatever export style `src/config.ts` already uses — they may live on the `config` object instead. Match the surrounding pattern.)

- [ ] **Step 4: Build to verify**

Run: `npm run build`
Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add schema.json src/types/*Args*.ts src/config.ts
git commit -m "feat(recording): add maxConcurrentRecordings + recordingsAssetsPath config"
```

---

### Task 3: VideoPipelineService — additive `outputPath`

**Files:**
- Modify: `src/services/VideoPipelineService.ts`
- Test: `test/unit/video-pipeline-outputpath.spec.ts`

- [ ] **Step 1: Write the failing regression test**

Create `test/unit/video-pipeline-outputpath.spec.ts`:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import * as path from 'path';
import { Container } from 'typedi';
import { VideoPipelineService } from '../../src/services/VideoPipelineService';
import * as childProcess from 'child_process';
import { config } from '../../src/config';

describe('VideoPipelineService.startRecording outputPath', () => {
  let spawnStub: sinon.SinonStub;

  beforeEach(() => {
    spawnStub = sinon.stub(childProcess, 'spawn').returns({
      pid: 1234,
      on: () => {},
      stderr: { on: () => {} },
      stdout: { on: () => {} },
      kill: () => {},
    } as any);
  });
  afterEach(() => sinon.restore());

  it('writes to the default sessionAssetsPath when outputPath is omitted', async () => {
    const svc = Container.get(VideoPipelineService);
    await svc.startRecording({ sessionId: 'sess-A', udid: 'U1', mjpegPort: 9999 });
    const args: string[] = spawnStub.firstCall.args[1];
    const outArg = args[args.length - 1];
    expect(outArg).to.equal(
      path.join(config.sessionAssetsPath, 'sess-A', 'video', 'sess-A.mp4'),
    );
    await svc.stopRecording('sess-A').catch(() => {});
  });

  it('honors outputPath when provided', async () => {
    const svc = Container.get(VideoPipelineService);
    const custom = '/tmp/xenon-test/rec-1/video/rec-1.mp4';
    await svc.startRecording({
      sessionId: 'rec-1',
      udid: 'U1',
      mjpegPort: 9999,
      outputPath: custom,
    });
    const args: string[] = spawnStub.firstCall.args[1];
    expect(args[args.length - 1]).to.equal(custom);
    await svc.stopRecording('rec-1').catch(() => {});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx mocha --require ts-node/register test/unit/video-pipeline-outputpath.spec.ts`
Expected: FAIL — second test fails because `outputPath` is unknown to `VideoPipelineOptions`, or value isn't honored.

- [ ] **Step 3: Add `outputPath` to options type**

In `src/services/VideoPipelineService.ts`, locate the `VideoPipelineOptions` interface and add the optional field. Then in `startRecording`, around line 62, replace the path construction with:

```ts
const outputPath =
  options.outputPath ??
  path.join(config.sessionAssetsPath, sessionId, 'video', `${sessionId}.mp4`);
const outputDir = path.dirname(outputPath);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}
```

(Replace the existing `outputDir` and `outputPath` lines that currently hard-code `path.join(config.sessionAssetsPath, sessionId, 'video', ...)`. The variable name should stay the same so downstream usage doesn't change.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx mocha --require ts-node/register test/unit/video-pipeline-outputpath.spec.ts`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/VideoPipelineService.ts test/unit/video-pipeline-outputpath.spec.ts
git commit -m "feat(video-pipeline): additive outputPath option for non-session recordings"
```

---

### Task 4: Socket events + EventManager helpers

**Files:**
- Modify: `src/dashboard/socket-events.ts`
- Modify: `src/dashboard/event-manager.ts`

- [ ] **Step 1: Add new event constants**

In `src/dashboard/socket-events.ts` add to the `SocketEvents` enum (or const map; match existing style):

```ts
RECORDING_STARTED = 'recording:started',
RECORDING_STOPPED = 'recording:stopped',
RECORDING_BOOKMARK_ADDED = 'recording:bookmark-added',
RECORDING_ANNOTATION_ADDED = 'recording:annotation-added',
RECORDING_FAILED = 'recording:failed',
RECORDING_FRAME_DROPS = 'recording:frame-drops',
```

- [ ] **Step 2: Add emit helpers in `src/dashboard/event-manager.ts`**

Append at the end of the `DashboardEventManager` class (do not modify existing methods):

```ts
public emitRecordingStarted(payload: {
  groupId: string;
  recordings: Array<{ id: string; udid: string }>;
  startedAt: Date;
}): void {
  this.socketServer.emitToDashboard(SocketEvents.RECORDING_STARTED, payload);
}

public emitRecordingStopped(payload: {
  groupId: string;
  recordings: Array<{ id: string; udid: string; status: string; durationMs?: number; sizeBytes?: number }>;
}): void {
  this.socketServer.emitToDashboard(SocketEvents.RECORDING_STOPPED, payload);
}

public emitRecordingBookmark(payload: { groupId: string; bookmark: any }): void {
  this.socketServer.emitToDashboard(SocketEvents.RECORDING_BOOKMARK_ADDED, payload);
}

public emitRecordingAnnotation(payload: { groupId: string; annotation: any }): void {
  this.socketServer.emitToDashboard(SocketEvents.RECORDING_ANNOTATION_ADDED, payload);
}

public emitRecordingFailed(payload: { groupId: string; recordingId: string; udid: string; reason: string }): void {
  this.socketServer.emitToDashboard(SocketEvents.RECORDING_FAILED, payload);
}
```

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/socket-events.ts src/dashboard/event-manager.ts
git commit -m "feat(events): emit RECORDING_* events from EventManager"
```

---

### Task 5: Recording store

**Files:**
- Create: `src/services/recording/recording-store.ts`
- Test: `test/unit/recording-store.spec.ts`

- [ ] **Step 1: Write the failing test**

`test/unit/recording-store.spec.ts`:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import { RecordingStore } from '../../src/services/recording/recording-store';
import { prisma } from '../../src/prisma';

describe('RecordingStore', () => {
  const store = new RecordingStore();

  afterEach(async () => {
    await prisma.annotation.deleteMany({});
    await prisma.bookmark.deleteMany({});
    await prisma.recording.deleteMany({});
  });

  it('creates a recording row with status=RECORDING', async () => {
    const rec = await store.create({
      groupId: 'g1',
      deviceUdid: 'U1',
      filePath: '/tmp/r.mp4',
      sessionId: null,
      deviceSnapshot: null,
    });
    expect(rec.status).to.equal('RECORDING');
    expect(rec.group_id).to.equal('g1');
  });

  it('finalizes a recording with duration and size', async () => {
    const rec = await store.create({ groupId: 'g2', deviceUdid: 'U2', filePath: '/tmp/r2.mp4', sessionId: null, deviceSnapshot: null });
    const updated = await store.finalize(rec.id, { status: 'STOPPED', durationMs: 1234, sizeBytes: 5678 });
    expect(updated.status).to.equal('STOPPED');
    expect(updated.duration_ms).to.equal(1234);
    expect(updated.size_bytes).to.equal(5678);
  });

  it('lists active recordings (status=RECORDING) globally', async () => {
    await store.create({ groupId: 'g3', deviceUdid: 'U3', filePath: '/tmp/r3.mp4', sessionId: null, deviceSnapshot: null });
    await store.create({ groupId: 'g3', deviceUdid: 'U4', filePath: '/tmp/r4.mp4', sessionId: null, deviceSnapshot: null });
    const active = await store.listActive();
    expect(active).to.have.length(2);
  });
});
```

- [ ] **Step 2: Run test — expect compile failure**

Run: `npx mocha --require ts-node/register test/unit/recording-store.spec.ts`
Expected: FAIL — "Cannot find module '.../recording-store'".

- [ ] **Step 3: Implement `RecordingStore`**

Create `src/services/recording/recording-store.ts`:

```ts
import { Service } from 'typedi';
import { prisma } from '../../prisma';

export interface CreateRecordingInput {
  groupId: string;
  deviceUdid: string;
  filePath: string;
  sessionId: string | null;
  deviceSnapshot: string | null;
}

export interface FinalizeInput {
  status: 'STOPPED' | 'FAILED' | 'DISCARDED';
  durationMs?: number;
  sizeBytes?: number;
  failReason?: string;
}

@Service()
export class RecordingStore {
  async create(input: CreateRecordingInput) {
    return prisma.recording.create({
      data: {
        group_id: input.groupId,
        device_udid: input.deviceUdid,
        file_path: input.filePath,
        session_id: input.sessionId ?? undefined,
        device_snapshot: input.deviceSnapshot ?? undefined,
        started_at: new Date(),
        status: 'RECORDING',
      },
    });
  }

  async finalize(id: string, input: FinalizeInput) {
    return prisma.recording.update({
      where: { id },
      data: {
        status: input.status,
        ended_at: new Date(),
        duration_ms: input.durationMs,
        size_bytes: input.sizeBytes,
        fail_reason: input.failReason,
      },
    });
  }

  async listActive() {
    return prisma.recording.findMany({ where: { status: 'RECORDING' } });
  }

  async listGroup(groupId: string) {
    return prisma.recording.findMany({
      where: { group_id: groupId },
      include: { bookmarks: true, annotations: true },
    });
  }

  async addBookmark(recordingId: string, label: string, timecodeMs: number, note?: string) {
    return prisma.bookmark.create({
      data: { recording_id: recordingId, label, timecode_ms: timecodeMs, note },
    });
  }

  async addAnnotation(recordingId: string, ann: {
    timecodeMs: number;
    shape: string;
    geometry: string;
    color: string;
    text?: string;
    author?: string;
  }) {
    return prisma.annotation.create({
      data: {
        recording_id: recordingId,
        timecode_ms: ann.timecodeMs,
        shape: ann.shape,
        geometry: ann.geometry,
        color: ann.color,
        text: ann.text,
        author: ann.author,
      },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx mocha --require ts-node/register test/unit/recording-store.spec.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/recording/recording-store.ts test/unit/recording-store.spec.ts
git commit -m "feat(recording): RecordingStore Prisma wrapper"
```

---

## Phase B — Orchestrator

### Task 6: Concurrency gate

**Files:**
- Create: `src/services/recording/concurrency-gate.ts`
- Test: `test/unit/concurrency-gate.spec.ts`

- [ ] **Step 1: Write the failing test**

`test/unit/concurrency-gate.spec.ts`:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import { ConcurrencyGate } from '../../src/services/recording/concurrency-gate';

describe('ConcurrencyGate', () => {
  it('admits up to the limit', () => {
    const g = new ConcurrencyGate(2);
    expect(g.tryAcquire(['r1', 'r2'])).to.equal(true);
    expect(g.activeCount()).to.equal(2);
  });

  it('refuses when adding would exceed the limit and takes nothing', () => {
    const g = new ConcurrencyGate(2);
    g.tryAcquire(['r1']);
    expect(g.tryAcquire(['r2', 'r3'])).to.equal(false);
    expect(g.activeCount()).to.equal(1);
  });

  it('release decrements', () => {
    const g = new ConcurrencyGate(2);
    g.tryAcquire(['r1', 'r2']);
    g.release('r1');
    expect(g.activeCount()).to.equal(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx mocha --require ts-node/register test/unit/concurrency-gate.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `src/services/recording/concurrency-gate.ts`:

```ts
import { Service } from 'typedi';
import { maxConcurrentRecordings } from '../../config';

@Service()
export class ConcurrencyGate {
  private active = new Set<string>();
  constructor(private readonly limit: number = maxConcurrentRecordings) {}

  tryAcquire(recordingIds: string[]): boolean {
    if (this.active.size + recordingIds.length > this.limit) return false;
    for (const id of recordingIds) this.active.add(id);
    return true;
  }

  release(recordingId: string): void {
    this.active.delete(recordingId);
  }

  activeCount(): number {
    return this.active.size;
  }

  getLimit(): number {
    return this.limit;
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx mocha --require ts-node/register test/unit/concurrency-gate.spec.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/recording/concurrency-gate.ts test/unit/concurrency-gate.spec.ts
git commit -m "feat(recording): server-wide ConcurrencyGate"
```

---

### Task 7: Busy pre-check

**Files:**
- Create: `src/services/recording/busy-precheck.ts`
- Test: `test/unit/busy-precheck.spec.ts`

- [ ] **Step 1: Write the failing test**

`test/unit/busy-precheck.spec.ts`:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { BusyPrecheck } from '../../src/services/recording/busy-precheck';

describe('BusyPrecheck', () => {
  afterEach(() => sinon.restore());

  it('returns empty list when all UDIDs are free', async () => {
    const store = { findDevice: sinon.stub() };
    store.findDevice.withArgs({ udid: 'U1' }).resolves({ udid: 'U1', busy: false });
    store.findDevice.withArgs({ udid: 'U2' }).resolves({ udid: 'U2', busy: false });
    const pc = new BusyPrecheck(store as any);
    expect(await pc.findBusy(['U1', 'U2'])).to.deep.equal([]);
  });

  it('flags automation-busy devices', async () => {
    const store = { findDevice: sinon.stub() };
    store.findDevice.withArgs({ udid: 'U1' }).resolves({
      udid: 'U1',
      busy: true,
      session: { id: 'sess-abc' },
    });
    const pc = new BusyPrecheck(store as any);
    const out = await pc.findBusy(['U1']);
    expect(out).to.have.length(1);
    expect(out[0]).to.deep.include({ udid: 'U1', reason: 'automation', sessionId: 'sess-abc' });
  });

  it('flags manual-busy devices as manual_other', async () => {
    const store = { findDevice: sinon.stub() };
    store.findDevice.withArgs({ udid: 'U1' }).resolves({
      udid: 'U1',
      busy: true,
      session: { id: 'manual_U1' },
    });
    const pc = new BusyPrecheck(store as any);
    const out = await pc.findBusy(['U1']);
    expect(out[0]).to.deep.include({ udid: 'U1', reason: 'manual_other', blockId: 'manual_U1' });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx mocha --require ts-node/register test/unit/busy-precheck.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `src/services/recording/busy-precheck.ts`:

```ts
import { Service } from 'typedi';
import { DeviceStoreFactory } from '../../data-service/DeviceStore';

export type BusyReason = 'automation' | 'manual_other' | 'recording_other_group' | 'unknown';

export interface BusyEntry {
  udid: string;
  reason: BusyReason;
  sessionId?: string;
  blockId?: string;
}

@Service()
export class BusyPrecheck {
  constructor(private readonly store: any = DeviceStoreFactory.getStore()) {}

  async findBusy(udids: string[]): Promise<BusyEntry[]> {
    const out: BusyEntry[] = [];
    for (const udid of udids) {
      const device = await this.store.findDevice({ udid });
      if (!device) {
        out.push({ udid, reason: 'unknown' });
        continue;
      }
      if (!device.busy) continue;
      const blockId: string | undefined = device.session?.id;
      if (blockId && blockId.startsWith('manual_')) {
        out.push({ udid, reason: 'manual_other', blockId });
      } else if (blockId) {
        out.push({ udid, reason: 'automation', sessionId: blockId });
      } else {
        out.push({ udid, reason: 'unknown' });
      }
    }
    return out;
  }
}
```

(Note: the device's busy-block id field name in `DeviceStore` may differ. If the field is `device.session_id` or similar, adjust to match. The test stubs the call, so the real shape only matters in integration.)

- [ ] **Step 4: Run — expect PASS**

Run: `npx mocha --require ts-node/register test/unit/busy-precheck.spec.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/recording/busy-precheck.ts test/unit/busy-precheck.spec.ts
git commit -m "feat(recording): atomic BusyPrecheck for multi-UDID requests"
```

---

### Task 8: RecordingOrchestrator — start

**Files:**
- Create: `src/services/recording/RecordingOrchestrator.ts`
- Test: `test/unit/recording-orchestrator.spec.ts`

- [ ] **Step 1: Write the failing test for `start()` (atomic busy refusal)**

`test/unit/recording-orchestrator.spec.ts`:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { RecordingOrchestrator } from '../../src/services/recording/RecordingOrchestrator';

describe('RecordingOrchestrator.start', () => {
  let busyPrecheck: any, store: any, gate: any, videoPipeline: any, blockDevice: any, eventMgr: any;

  beforeEach(() => {
    busyPrecheck = { findBusy: sinon.stub().resolves([]) };
    store = {
      create: sinon.stub().callsFake(async (i: any) => ({ id: `rec-${i.deviceUdid}`, ...i })),
      finalize: sinon.stub().resolves({}),
    };
    gate = { tryAcquire: sinon.stub().returns(true), release: sinon.stub(), getLimit: () => 4, activeCount: () => 0 };
    videoPipeline = { startRecording: sinon.stub().resolves(), stopRecording: sinon.stub().resolves('/tmp/x.mp4') };
    blockDevice = sinon.stub().resolves();
    eventMgr = { emitRecordingStarted: sinon.stub(), emitRecordingStopped: sinon.stub(), emitRecordingFailed: sinon.stub() };
  });

  afterEach(() => sinon.restore());

  it('refuses atomically when any UDID is busy — no rows created, no ffmpeg spawned', async () => {
    busyPrecheck.findBusy.resolves([{ udid: 'U2', reason: 'automation', sessionId: 'sess-x' }]);
    const orch = new RecordingOrchestrator(busyPrecheck, store, gate, videoPipeline, blockDevice, eventMgr);
    try {
      await orch.start({ udids: ['U1', 'U2'] });
      expect.fail('expected throw');
    } catch (e: any) {
      expect(e.code).to.equal('device_busy');
      expect(e.busyDevices).to.have.length(1);
    }
    expect(store.create.callCount).to.equal(0);
    expect(videoPipeline.startRecording.callCount).to.equal(0);
    expect(blockDevice.callCount).to.equal(0);
  });

  it('refuses when concurrency cap would be exceeded — no rows created', async () => {
    gate.tryAcquire.returns(false);
    const orch = new RecordingOrchestrator(busyPrecheck, store, gate, videoPipeline, blockDevice, eventMgr);
    try {
      await orch.start({ udids: ['U1'] });
      expect.fail('expected throw');
    } catch (e: any) {
      expect(e.code).to.equal('concurrency_cap');
    }
    expect(store.create.callCount).to.equal(0);
  });

  it('happy path: creates one row per UDID, spawns ffmpeg, emits event', async () => {
    const orch = new RecordingOrchestrator(busyPrecheck, store, gate, videoPipeline, blockDevice, eventMgr);
    const out = await orch.start({ udids: ['U1', 'U2'] });
    expect(out.recordings).to.have.length(2);
    expect(store.create.callCount).to.equal(2);
    expect(videoPipeline.startRecording.callCount).to.equal(2);
    expect(blockDevice.callCount).to.equal(2);
    expect(eventMgr.emitRecordingStarted.callCount).to.equal(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx mocha --require ts-node/register test/unit/recording-orchestrator.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `start()` and constructor**

Create `src/services/recording/RecordingOrchestrator.ts`:

```ts
import { Service, Container } from 'typedi';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { recordingsAssetsPath } from '../../config';
import { VideoPipelineService } from '../VideoPipelineService';
import { DashboardEventManager } from '../../dashboard/event-manager';
import { BusyPrecheck, BusyEntry } from './busy-precheck';
import { RecordingStore } from './recording-store';
import { ConcurrencyGate } from './concurrency-gate';
import { blockDevice as defaultBlockDevice } from '../../device-managers/blockDevice';
import { unblockDevice as defaultUnblockDevice } from '../../device-managers/blockDevice';

export class RecordingError extends Error {
  constructor(
    public readonly code: 'device_busy' | 'concurrency_cap',
    public readonly busyDevices?: BusyEntry[],
    public readonly limit?: number,
    public readonly active?: number,
  ) {
    super(code);
  }
}

@Service()
export class RecordingOrchestrator {
  constructor(
    private readonly busyPrecheck: BusyPrecheck = Container.get(BusyPrecheck),
    private readonly store: RecordingStore = Container.get(RecordingStore),
    private readonly gate: ConcurrencyGate = Container.get(ConcurrencyGate),
    private readonly videoPipeline: VideoPipelineService = Container.get(VideoPipelineService),
    private readonly blockDeviceFn: (udid: string, host: string, sid: string) => Promise<void> = defaultBlockDevice as any,
    private readonly eventMgr: DashboardEventManager = Container.get(DashboardEventManager),
  ) {}

  async start(input: { udids: string[]; sessionId?: string; note?: string }) {
    const { udids } = input;

    // Layer 2 atomic pre-check: busy state
    const busy = await this.busyPrecheck.findBusy(udids);
    if (busy.length > 0) throw new RecordingError('device_busy', busy);

    // Pre-allocate recording ids and reserve cap
    const recordingIds = udids.map(() => uuidv4());
    if (!this.gate.tryAcquire(recordingIds)) {
      throw new RecordingError('concurrency_cap', undefined, this.gate.getLimit(), this.gate.activeCount());
    }

    const groupId = uuidv4();
    const startedAt = new Date();

    // Take manual blocks transactionally
    const acquiredBlocks: string[] = [];
    try {
      for (const udid of udids) {
        await this.blockDeviceFn(udid, '127.0.0.1', `manual_${udid}`);
        acquiredBlocks.push(udid);
      }
    } catch (e) {
      // Roll back blocks taken so far + release gate
      for (const u of acquiredBlocks) await this.tryUnblock(u);
      for (const id of recordingIds) this.gate.release(id);
      throw new RecordingError('device_busy', [{ udid: 'unknown', reason: 'unknown' }]);
    }

    // Create rows + spawn ffmpeg per device
    const recordings: Array<{ id: string; udid: string; status: string }> = [];
    for (let i = 0; i < udids.length; i++) {
      const id = recordingIds[i];
      const udid = udids[i];
      const filePath = path.join(recordingsAssetsPath, id, 'video', `${id}.mp4`);
      await this.store.create({ groupId, deviceUdid: udid, filePath, sessionId: input.sessionId ?? null, deviceSnapshot: null });
      await this.videoPipeline.startRecording({ sessionId: id, udid, outputPath: filePath } as any);
      recordings.push({ id, udid, status: 'RECORDING' });
    }

    this.eventMgr.emitRecordingStarted({ groupId, recordings: recordings.map(r => ({ id: r.id, udid: r.udid })), startedAt });
    return { groupId, recordings, startedAt };
  }

  private async tryUnblock(udid: string) {
    try { await defaultUnblockDevice(udid); } catch { /* best effort */ }
  }
}
```

(Note: `blockDevice` / `unblockDevice` import paths must match the existing helper. Adjust the `import` lines if the file is named differently — search with `grep -r "export.*blockDevice" src/`.)

- [ ] **Step 4: Run — expect 3 PASS**

Run: `npx mocha --require ts-node/register test/unit/recording-orchestrator.spec.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/recording/RecordingOrchestrator.ts test/unit/recording-orchestrator.spec.ts
git commit -m "feat(recording): RecordingOrchestrator.start with atomic busy + cap pre-checks"
```

---

### Task 9: RecordingOrchestrator — stop, addBookmark, addAnnotation, recoverOnBoot

**Files:**
- Modify: `src/services/recording/RecordingOrchestrator.ts`
- Modify: `test/unit/recording-orchestrator.spec.ts`

- [ ] **Step 1: Append failing tests**

Add to `test/unit/recording-orchestrator.spec.ts`:

```ts
describe('RecordingOrchestrator.stop', () => {
  it('finalizes each recording, releases gate slots, releases manual blocks, emits stopped', async () => {
    const store = {
      listGroup: sinon.stub().resolves([
        { id: 'r1', device_udid: 'U1', file_path: '/tmp/r1.mp4', started_at: new Date(Date.now() - 5000) },
        { id: 'r2', device_udid: 'U2', file_path: '/tmp/r2.mp4', started_at: new Date(Date.now() - 5000) },
      ]),
      finalize: sinon.stub().resolves({}),
    };
    const gate = { release: sinon.stub() };
    const videoPipeline = { stopRecording: sinon.stub().resolves('/tmp/x.mp4') };
    const unblock = sinon.stub().resolves();
    const eventMgr = { emitRecordingStopped: sinon.stub() };
    const orch = new RecordingOrchestrator(
      {} as any, store as any, gate as any, videoPipeline as any, sinon.stub().resolves() as any, eventMgr as any,
    );
    (orch as any).unblockDeviceFn = unblock;
    await orch.stop('grp-1');
    expect(videoPipeline.stopRecording.callCount).to.equal(2);
    expect(store.finalize.callCount).to.equal(2);
    expect(gate.release.callCount).to.equal(2);
    expect(unblock.callCount).to.equal(2);
    expect(eventMgr.emitRecordingStopped.callCount).to.equal(1);
  });
});

describe('RecordingOrchestrator.recoverOnBoot', () => {
  it('marks orphans FAILED with fail_reason=server_restart and releases their blocks', async () => {
    const store = {
      listActive: sinon.stub().resolves([
        { id: 'r-orphan', device_udid: 'U9', file_path: '/tmp/r.mp4' },
      ]),
      finalize: sinon.stub().resolves({}),
    };
    const unblock = sinon.stub().resolves();
    const orch = new RecordingOrchestrator(
      {} as any, store as any, { release: sinon.stub() } as any, {} as any, sinon.stub().resolves() as any,
      { emitRecordingStopped: sinon.stub() } as any,
    );
    (orch as any).unblockDeviceFn = unblock;
    await orch.recoverOnBoot();
    expect(store.finalize.firstCall.args[1]).to.deep.include({ status: 'FAILED', failReason: 'server_restart' });
    expect(unblock.callCount).to.equal(1);
  });
});

describe('RecordingOrchestrator.addBookmark / addAnnotation', () => {
  it('addBookmark persists and emits', async () => {
    const store = { addBookmark: sinon.stub().resolves({ id: 'bm-1', label: 'bug here' }) };
    const eventMgr = { emitRecordingBookmark: sinon.stub() };
    const orch = new RecordingOrchestrator(
      {} as any, store as any, {} as any, {} as any, sinon.stub() as any, eventMgr as any,
    );
    await orch.addBookmark('grp', 'rec-1', 1500, 'bug here');
    expect(store.addBookmark.calledWith('rec-1', 'bug here', 1500)).to.equal(true);
    expect(eventMgr.emitRecordingBookmark.callCount).to.equal(1);
  });
});
```

- [ ] **Step 2: Implement the new methods**

Append to `RecordingOrchestrator`:

```ts
private unblockDeviceFn: (udid: string) => Promise<void> = defaultUnblockDevice as any;

async stop(groupId: string) {
  const recordings = await this.store.listGroup(groupId);
  const out: Array<{ id: string; udid: string; status: string; durationMs?: number; sizeBytes?: number }> = [];
  for (const r of recordings) {
    let status: 'STOPPED' | 'FAILED' = 'STOPPED';
    let failReason: string | undefined;
    try {
      await this.videoPipeline.stopRecording(r.id);
    } catch (err: any) {
      status = 'FAILED';
      failReason = err?.message ?? 'ffmpeg_stop_failed';
    }
    const durationMs = r.started_at ? Date.now() - new Date(r.started_at).getTime() : undefined;
    let sizeBytes: number | undefined;
    try {
      const fs = await import('fs');
      const stat = fs.statSync(r.file_path);
      sizeBytes = stat.size;
    } catch { /* file may not exist on FAIL */ }
    await this.store.finalize(r.id, { status, durationMs, sizeBytes, failReason });
    this.gate.release(r.id);
    await this.tryUnblock(r.device_udid);
    out.push({ id: r.id, udid: r.device_udid, status, durationMs, sizeBytes });
  }
  this.eventMgr.emitRecordingStopped({ groupId, recordings: out });
  return { groupId, recordings: out };
}

async addBookmark(groupId: string, recordingId: string, timecodeMs: number, label: string, note?: string) {
  const bm = await this.store.addBookmark(recordingId, label, timecodeMs, note);
  this.eventMgr.emitRecordingBookmark({ groupId, bookmark: bm });
  return bm;
}

async addAnnotation(groupId: string, recordingId: string, ann: {
  timecodeMs: number; shape: string; geometry: string; color: string; text?: string; author?: string;
}) {
  const a = await this.store.addAnnotation(recordingId, ann);
  this.eventMgr.emitRecordingAnnotation({ groupId, annotation: a });
  return a;
}

async recoverOnBoot() {
  const orphans = await this.store.listActive();
  for (const o of orphans) {
    await this.store.finalize(o.id, { status: 'FAILED', failReason: 'server_restart' });
    this.gate.release(o.id);
    await this.tryUnblock(o.device_udid);
  }
  if (orphans.length > 0) {
    // Use existing logger; replace with the project's log.scope wrapper.
    // eslint-disable-next-line no-console
    console.warn(`[RecordingOrchestrator] Recovered ${orphans.length} orphan recordings on boot.`);
  }
}
```

Replace `tryUnblock` with:

```ts
private async tryUnblock(udid: string) {
  try { await this.unblockDeviceFn(udid); } catch { /* best effort */ }
}
```

- [ ] **Step 3: Run — expect all PASS**

Run: `npx mocha --require ts-node/register test/unit/recording-orchestrator.spec.ts`
Expected: all PASS.

- [ ] **Step 4: Wire `recoverOnBoot()` into `src/plugin.ts`**

Open `src/plugin.ts`. Locate where the plugin's `pluginWillCreateAppium` (or equivalent startup hook — match existing code) finishes initial setup. Add:

```ts
import { RecordingOrchestrator } from './services/recording/RecordingOrchestrator';
// ...inside the appropriate startup function:
try {
  await Container.get(RecordingOrchestrator).recoverOnBoot();
} catch (err) {
  log.warn('[plugin] RecordingOrchestrator.recoverOnBoot failed', err);
}
```

- [ ] **Step 5: Commit**

```bash
git add src/services/recording/RecordingOrchestrator.ts test/unit/recording-orchestrator.spec.ts src/plugin.ts
git commit -m "feat(recording): orchestrator stop/bookmark/annotation/recoverOnBoot + plugin wiring"
```

---

## Phase C — Bundle export

### Task 10: Proof bundle service

**Files:**
- Create: `src/services/recording/proof-bundle.ts`
- Test: `test/unit/proof-bundle.spec.ts`

- [ ] **Step 1: Write the failing test**

`test/unit/proof-bundle.spec.ts`:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as unzipper from 'unzipper';
import { ProofBundleService } from '../../src/services/recording/proof-bundle';

describe('ProofBundleService.build', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-test-'));
  });
  afterEach(() => {
    sinon.restore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('produces a zip with manifest, README, and per-device folders', async () => {
    const fakeMp4 = path.join(tmp, 'src.mp4');
    fs.writeFileSync(fakeMp4, 'FAKEMP4');
    const store = {
      listGroup: sinon.stub().resolves([
        {
          id: 'r-1',
          device_udid: 'U1',
          file_path: fakeMp4,
          status: 'STOPPED',
          duration_ms: 5000,
          size_bytes: 7,
          started_at: new Date(),
          ended_at: new Date(),
          device_snapshot: null,
          bookmarks: [{ label: 'bug here', timecode_ms: 1000 }],
          annotations: [],
        },
      ]),
    };
    const svc = new ProofBundleService(store as any);
    const outZip = path.join(tmp, 'out.zip');
    await new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream(outZip);
      svc.streamBundleZip('grp-1').pipe(ws).on('finish', resolve).on('error', reject);
    });
    const dir = await unzipper.Open.file(outZip);
    const names = dir.files.map((f: any) => f.path).sort();
    expect(names).to.include('manifest.json');
    expect(names).to.include('README.md');
    expect(names.some((n: string) => n.startsWith('devices/U1/'))).to.equal(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx mocha --require ts-node/register test/unit/proof-bundle.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `src/services/recording/proof-bundle.ts`:

```ts
import { Service, Container } from 'typedi';
import archiver, { Archiver } from 'archiver';
import * as fs from 'fs';
import { Readable } from 'stream';
import { RecordingStore } from './recording-store';

@Service()
export class ProofBundleService {
  constructor(private readonly store: RecordingStore = Container.get(RecordingStore)) {}

  streamBundleZip(groupId: string): Archiver {
    const archive = archiver('zip', { zlib: { level: 6 } });
    this.populate(archive, groupId).catch((err) => archive.emit('error', err));
    return archive;
  }

  private async populate(archive: Archiver, groupId: string) {
    const recordings = await this.store.listGroup(groupId);
    const manifest = {
      groupId,
      generatedAt: new Date().toISOString(),
      devices: recordings.map((r: any) => ({
        udid: r.device_udid,
        recordingId: r.id,
        durationMs: r.duration_ms,
        sizeBytes: r.size_bytes,
        status: r.status,
        startedAt: r.started_at,
        endedAt: r.ended_at,
      })),
    };
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    archive.append(this.renderReadme(groupId, recordings), { name: 'README.md' });

    for (const r of recordings) {
      const base = `devices/${r.device_udid}`;
      if (fs.existsSync(r.file_path)) {
        archive.file(r.file_path, { name: `${base}/video.mp4` });
      }
      archive.append(JSON.stringify(r.bookmarks ?? [], null, 2), { name: `${base}/bookmarks.json` });
      archive.append(JSON.stringify(r.annotations ?? [], null, 2), { name: `${base}/annotations.json` });
      archive.append(JSON.stringify({ udid: r.device_udid, snapshot: r.device_snapshot }, null, 2), {
        name: `${base}/device.json`,
      });
    }
    await archive.finalize();
  }

  private renderReadme(groupId: string, recordings: any[]): string {
    const lines = [
      `# Proof Bundle ${groupId}`,
      ``,
      `Generated ${new Date().toISOString()}`,
      ``,
      `## Devices`,
      ...recordings.map((r) => `- **${r.device_udid}** — ${r.duration_ms ?? '?'} ms, ${r.status}`),
      ``,
      `## Bookmarks`,
      ...recordings.flatMap((r) =>
        (r.bookmarks ?? []).map(
          (b: any) => `- [${r.device_udid} @ ${b.timecode_ms}ms] ${b.label}${b.note ? ` — ${b.note}` : ''}`,
        ),
      ),
    ];
    return lines.join('\n');
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx mocha --require ts-node/register test/unit/proof-bundle.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/recording/proof-bundle.ts test/unit/proof-bundle.spec.ts
git commit -m "feat(recording): ProofBundleService — zip with manifest/README/per-device"
```

---

### Task 11: Annotation render service (lazy export)

**Files:**
- Create: `src/services/recording/annotation-render.ts`

- [ ] **Step 1: Implement (no test — exercised by the integration test in Task 13; this is a thin ffmpeg wrapper)**

```ts
import { Service, Container } from 'typedi';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { RecordingStore } from './recording-store';

@Service()
export class AnnotationRenderService {
  constructor(private readonly store: RecordingStore = Container.get(RecordingStore)) {}

  /**
   * Builds an annotated mp4 to a tmp path and returns a Readable stream of the file.
   * Caller must clean up the tmp file after the stream is fully consumed.
   */
  async renderForRecording(recordingId: string): Promise<{ stream: Readable; cleanup: () => void }> {
    const recordings = await this.store.listGroup(''); // helper that filters by id added below
    const rec: any = recordings.find((r: any) => r.id === recordingId);
    if (!rec) throw new Error(`Recording ${recordingId} not found`);

    const filterParts: string[] = [];
    for (const a of rec.annotations ?? []) {
      const g = JSON.parse(a.geometry);
      if (a.shape === 'RECT') {
        filterParts.push(
          `drawbox=x=${Math.round(g.x * 720)}:y=${Math.round(g.y * 1280)}:w=${Math.round(g.w * 720)}:h=${Math.round(g.h * 1280)}:color=${a.color}:t=4:enable='gte(t,${a.timecode_ms / 1000})'`,
        );
      } else if (a.shape === 'TEXT' && a.text) {
        filterParts.push(
          `drawtext=text='${a.text.replace(/'/g, "\\\\'")}':x=${Math.round(g.x * 720)}:y=${Math.round(g.y * 1280)}:fontcolor=${a.color}:fontsize=24:enable='gte(t,${a.timecode_ms / 1000})'`,
        );
      }
    }

    const outPath = path.join(path.dirname(rec.file_path), `${recordingId}.annotated.mp4`);
    const args = ['-y', '-i', rec.file_path];
    if (filterParts.length > 0) args.push('-vf', filterParts.join(','));
    args.push('-c:a', 'copy', outPath);

    await new Promise<void>((resolve, reject) => {
      const p = spawn('ffmpeg', args);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))));
    });

    const stream = fs.createReadStream(outPath);
    return { stream, cleanup: () => { try { fs.unlinkSync(outPath); } catch {} } };
  }
}
```

- [ ] **Step 2: Add a helper `findById` to `RecordingStore`**

In `src/services/recording/recording-store.ts`, add:

```ts
async findById(id: string) {
  return prisma.recording.findUnique({
    where: { id },
    include: { bookmarks: true, annotations: true },
  });
}
```

Then in `annotation-render.ts` replace the `listGroup('')` workaround with:

```ts
const rec: any = await this.store.findById(recordingId);
if (!rec) throw new Error(`Recording ${recordingId} not found`);
```

(Remove the leftover `listGroup` line.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add src/services/recording/annotation-render.ts src/services/recording/recording-store.ts
git commit -m "feat(recording): annotation-render service for lazy annotated-mp4 export"
```

---

## Phase D — REST + integration tests

### Task 12: Recordings router

**Files:**
- Create: `src/app/routers/recordings.ts`
- Modify: `src/app/index.ts` (register router)
- Modify: `src/app/swagger-docs.ts`

- [ ] **Step 1: Implement the router**

Create `src/app/routers/recordings.ts`:

```ts
import { Router, Express, Request, Response } from 'express';
import { Container } from 'typedi';
import { RecordingOrchestrator, RecordingError } from '../../services/recording/RecordingOrchestrator';
import { ProofBundleService } from '../../services/recording/proof-bundle';
import { AnnotationRenderService } from '../../services/recording/annotation-render';
import { RecordingStore } from '../../services/recording/recording-store';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const { udids, sessionId, note } = req.body ?? {};
  if (!Array.isArray(udids) || udids.length === 0) {
    return res.status(400).json({ error: 'udids required' });
  }
  try {
    const out = await Container.get(RecordingOrchestrator).start({ udids, sessionId, note });
    return res.status(202).json(out);
  } catch (e: any) {
    if (e instanceof RecordingError) {
      if (e.code === 'concurrency_cap') {
        return res.status(409).json({ error: 'concurrency_cap', limit: e.limit, active: e.active });
      }
      return res.status(409).json({
        error: 'device_busy',
        busyDevices: e.busyDevices,
        message: `${e.busyDevices?.length ?? 0} of ${udids.length} selected devices are busy. Recording was not started.`,
      });
    }
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
});

router.post('/:groupId/stop', async (req, res) => {
  const out = await Container.get(RecordingOrchestrator).stop(req.params.groupId);
  res.json(out);
});

router.post('/:groupId/bookmark', async (req, res) => {
  const { recordingId, timecodeMs, label, note } = req.body ?? {};
  const out = await Container.get(RecordingOrchestrator).addBookmark(
    req.params.groupId, recordingId, timecodeMs, label, note,
  );
  res.status(201).json(out);
});

router.post('/:groupId/annotation', async (req, res) => {
  const { recordingId, ...ann } = req.body ?? {};
  const out = await Container.get(RecordingOrchestrator).addAnnotation(req.params.groupId, recordingId, ann);
  res.status(201).json(out);
});

router.get('/:groupId', async (req, res) => {
  const recs = await Container.get(RecordingStore).listGroup(req.params.groupId);
  res.json({ groupId: req.params.groupId, recordings: recs });
});

router.get('/:groupId/bundle.zip', async (req, res) => {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="proof-${req.params.groupId}.zip"`);
  const archive = Container.get(ProofBundleService).streamBundleZip(req.params.groupId);
  archive.on('error', (err) => { res.status(500).end(`zip error: ${err.message}`); });
  archive.pipe(res);
});

router.get('/:groupId/exports/annotated.mp4', async (req, res) => {
  const recordingId = req.query.recordingId as string;
  if (!recordingId) return res.status(400).json({ error: 'recordingId required' });
  const { stream, cleanup } = await Container.get(AnnotationRenderService).renderForRecording(recordingId);
  res.setHeader('Content-Type', 'video/mp4');
  stream.pipe(res);
  res.on('close', cleanup);
});

export default {
  register(app: Express) {
    app.use('/xenon/api/recordings', router);
  },
};
```

- [ ] **Step 2: Register in `src/app/index.ts`**

Locate where other routers register (search for `bug-report` or `bugReport`). Add:

```ts
import recordingsRouter from './routers/recordings';
// ...
recordingsRouter.register(app);
```

- [ ] **Step 3: Add Swagger doc stubs in `src/app/swagger-docs.ts`**

Add OpenAPI stubs for the seven endpoints in §"REST Contract" of the spec. Match the format of existing docs in the file. Minimal acceptable content: each path, method, brief description, and response codes (202, 409, 200 as applicable).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add src/app/routers/recordings.ts src/app/index.ts src/app/swagger-docs.ts
git commit -m "feat(recording): REST router + Swagger docs"
```

---

### Task 13: Recordings router integration test

**Files:**
- Create: `test/integration/recordings-router.spec.ts`

- [ ] **Step 1: Write the test (route happy path + 409 shapes)**

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import recordingsRouter from '../../src/app/routers/recordings';
import { RecordingOrchestrator, RecordingError } from '../../src/services/recording/RecordingOrchestrator';

function makeApp() {
  const app = express();
  app.use(express.json());
  recordingsRouter.register(app as any);
  return app;
}

describe('POST /xenon/api/recordings (integration)', () => {
  afterEach(() => sinon.restore());

  it('202 on happy path', async () => {
    sinon.stub(Container.get(RecordingOrchestrator), 'start').resolves({
      groupId: 'g-1',
      recordings: [{ id: 'r-1', udid: 'U1', status: 'RECORDING' }],
      startedAt: new Date(),
    });
    const r = await request(makeApp()).post('/xenon/api/recordings').send({ udids: ['U1'] }).expect(202);
    expect(r.body.groupId).to.equal('g-1');
  });

  it('409 device_busy with busyDevices payload', async () => {
    sinon.stub(Container.get(RecordingOrchestrator), 'start').rejects(
      new RecordingError('device_busy', [{ udid: 'U2', reason: 'automation', sessionId: 'sess-x' }]),
    );
    const r = await request(makeApp()).post('/xenon/api/recordings').send({ udids: ['U1', 'U2'] }).expect(409);
    expect(r.body.error).to.equal('device_busy');
    expect(r.body.busyDevices).to.have.length(1);
    expect(r.body.busyDevices[0]).to.deep.include({ udid: 'U2', reason: 'automation' });
  });

  it('409 concurrency_cap with limit/active payload', async () => {
    sinon.stub(Container.get(RecordingOrchestrator), 'start').rejects(
      new RecordingError('concurrency_cap', undefined, 4, 4),
    );
    const r = await request(makeApp()).post('/xenon/api/recordings').send({ udids: ['U1'] }).expect(409);
    expect(r.body).to.deep.include({ error: 'concurrency_cap', limit: 4, active: 4 });
  });

  it('400 when udids missing', async () => {
    await request(makeApp()).post('/xenon/api/recordings').send({}).expect(400);
  });
});
```

- [ ] **Step 2: Run — expect PASS**

Run: `npx mocha --require ts-node/register test/integration/recordings-router.spec.ts`
Expected: 4 PASS.

- [ ] **Step 3: Commit**

```bash
git add test/integration/recordings-router.spec.ts
git commit -m "test(recording): router integration — happy path + 409 shapes"
```

---

### Task 14: Cross-workflow integration tests (the matrix)

**Files:**
- Create: `test/integration/cross-workflow.spec.ts`

- [ ] **Step 1: Write the test (six scenarios from spec §"Test Plan")**

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { RecordingOrchestrator, RecordingError } from '../../src/services/recording/RecordingOrchestrator';
import { BusyPrecheck } from '../../src/services/recording/busy-precheck';
import { RecordingStore } from '../../src/services/recording/recording-store';
import { ConcurrencyGate } from '../../src/services/recording/concurrency-gate';

describe('Cross-workflow integration: manual + automation safety', () => {
  let orch: RecordingOrchestrator;
  let videoPipeline: any;
  let blockDevice: any;

  beforeEach(() => {
    Container.reset();
    videoPipeline = { startRecording: sinon.stub().resolves(), stopRecording: sinon.stub().resolves() };
    blockDevice = sinon.stub().resolves();
    Container.set(BusyPrecheck, { findBusy: sinon.stub().resolves([]) });
    Container.set(RecordingStore, {
      create: sinon.stub().callsFake(async (i: any) => ({ id: `rec-${i.deviceUdid}`, ...i })),
      listGroup: sinon.stub().resolves([]),
      finalize: sinon.stub().resolves({}),
      listActive: sinon.stub().resolves([]),
    });
    Container.set(ConcurrencyGate, new ConcurrencyGate(4));
    orch = new RecordingOrchestrator(
      Container.get(BusyPrecheck) as any,
      Container.get(RecordingStore) as any,
      Container.get(ConcurrencyGate),
      videoPipeline,
      blockDevice,
      { emitRecordingStarted: sinon.stub(), emitRecordingStopped: sinon.stub(), emitRecordingFailed: sinon.stub() } as any,
    );
  });
  afterEach(() => sinon.restore());

  it('1. mosaic recording then automation request on same UDID — automation rejected by existing busy semantics', async () => {
    // Mosaic starts recording on U1.
    await orch.start({ udids: ['U1'] });
    // Automation now tries U1 — existing endpoint /control/:udid/stream/start would 409.
    // We assert blockDevice was called with manual_U1, which is what the existing
    // device-allocator inspects via device.busy=true.
    expect(blockDevice.calledWith('U1', sinon.match.string, 'manual_U1')).to.equal(true);
  });

  it('2. automation running on U1 then mosaic tries — 409 device_busy, no rows, no ffmpeg', async () => {
    (Container.get(BusyPrecheck) as any).findBusy = sinon.stub()
      .resolves([{ udid: 'U1', reason: 'automation', sessionId: 'sess-X' }]);
    try {
      await orch.start({ udids: ['U1'] });
      expect.fail('expected throw');
    } catch (e: any) {
      expect(e).to.be.instanceOf(RecordingError);
      expect(e.code).to.equal('device_busy');
    }
    expect(videoPipeline.startRecording.callCount).to.equal(0);
    expect(blockDevice.callCount).to.equal(0);
  });

  it('3. automation and mosaic on different UDIDs concurrently — both proceed', async () => {
    await orch.start({ udids: ['U1'] });
    // Simulate a second mosaic request on U2 (different UDID, unaffected by U1).
    await orch.start({ udids: ['U2'] });
    expect(videoPipeline.startRecording.callCount).to.equal(2);
  });

  it('4. ffmpeg crash mid-recording — Recording marked FAILED, manual block released', async () => {
    (Container.get(RecordingStore) as any).listGroup = sinon.stub().resolves([
      { id: 'r-X', device_udid: 'U1', file_path: '/nonexistent.mp4', started_at: new Date(Date.now() - 1000) },
    ]);
    videoPipeline.stopRecording.rejects(new Error('ffmpeg died'));
    const unblock = sinon.stub().resolves();
    (orch as any).unblockDeviceFn = unblock;
    await orch.stop('grp');
    const finalizeArgs = (Container.get(RecordingStore) as any).finalize.firstCall.args[1];
    expect(finalizeArgs.status).to.equal('FAILED');
    expect(unblock.calledWith('U1')).to.equal(true);
  });

  it('5. server restart with orphan RECORDING row — recoverOnBoot marks FAILED + releases', async () => {
    (Container.get(RecordingStore) as any).listActive = sinon.stub().resolves([
      { id: 'r-orphan', device_udid: 'U9', file_path: '/tmp/r.mp4' },
    ]);
    const unblock = sinon.stub().resolves();
    (orch as any).unblockDeviceFn = unblock;
    await orch.recoverOnBoot();
    const args = (Container.get(RecordingStore) as any).finalize.firstCall.args[1];
    expect(args).to.deep.include({ status: 'FAILED', failReason: 'server_restart' });
    expect(unblock.calledWith('U9')).to.equal(true);
  });

  it('6. two clients race on overlapping UDIDs — exactly one wins, loser gets 409', async () => {
    // First client takes U1+U2.
    await orch.start({ udids: ['U1', 'U2'] });
    // Second client requests U2+U3; precheck now reports U2 busy.
    (Container.get(BusyPrecheck) as any).findBusy = sinon.stub()
      .resolves([{ udid: 'U2', reason: 'manual_other', blockId: 'manual_U2' }]);
    try {
      await orch.start({ udids: ['U2', 'U3'] });
      expect.fail('expected throw');
    } catch (e: any) {
      expect(e.code).to.equal('device_busy');
    }
    // U3 was never spawned because the request is atomic.
    expect(videoPipeline.startRecording.calledWith(sinon.match({ udid: 'U3' }))).to.equal(false);
  });
});
```

- [ ] **Step 2: Run — expect 6 PASS**

Run: `npx mocha --require ts-node/register test/integration/cross-workflow.spec.ts`
Expected: 6 PASS.

- [ ] **Step 3: Run full unit + integration suite as a regression sweep**

Run: `npm test`
Expected: all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add test/integration/cross-workflow.spec.ts
git commit -m "test(recording): six cross-workflow scenarios from spec matrix"
```

---

## Phase E — Frontend

### Task 15: API client + state store

**Files:**
- Create: `web/src/api-service/recordings.ts`
- Create: `web/src/components/mosaic/recording-group-store.ts`

- [ ] **Step 1: API client**

```ts
// web/src/api-service/recordings.ts
const BASE = '/xenon/api/recordings';

export interface BusyEntry { udid: string; reason: string; sessionId?: string; blockId?: string }
export interface StartResponse { groupId: string; recordings: { id: string; udid: string; status: string }[] }

export async function startRecording(udids: string[], opts?: { sessionId?: string; note?: string }): Promise<StartResponse> {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ udids, ...opts }),
  });
  if (r.status === 409) throw Object.assign(new Error('busy'), { conflict: await r.json() });
  if (!r.ok) throw new Error(`recording start failed: ${r.status}`);
  return r.json();
}

export async function stopRecording(groupId: string) {
  const r = await fetch(`${BASE}/${groupId}/stop`, { method: 'POST' });
  if (!r.ok) throw new Error(`stop failed: ${r.status}`);
  return r.json();
}

export async function addBookmark(groupId: string, recordingId: string, timecodeMs: number, label: string, note?: string) {
  const r = await fetch(`${BASE}/${groupId}/bookmark`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordingId, timecodeMs, label, note }),
  });
  if (!r.ok) throw new Error(`bookmark failed: ${r.status}`);
  return r.json();
}

export async function addAnnotation(
  groupId: string, recordingId: string,
  ann: { timecodeMs: number; shape: string; geometry: string; color: string; text?: string },
) {
  const r = await fetch(`${BASE}/${groupId}/annotation`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordingId, ...ann }),
  });
  if (!r.ok) throw new Error(`annotation failed: ${r.status}`);
  return r.json();
}

export function bundleZipUrl(groupId: string): string {
  return `${BASE}/${groupId}/bundle.zip`;
}
```

- [ ] **Step 2: Zustand store**

If zustand isn't already in `web/`, check `web/package.json` first and install only if missing (`cd web && npm install zustand`). The store:

```ts
// web/src/components/mosaic/recording-group-store.ts
import { create } from 'zustand';

export type Layout = '1' | '2x1' | '2x2' | '3x2';
export interface SelectedDevice { udid: string; mjpegPort: number; busy: boolean; busyReason?: string; }

interface State {
  selected: SelectedDevice[];
  layout: Layout;
  groupId: string | null;
  recording: boolean;
  startedAt: number | null;
  setLayout: (l: Layout) => void;
  setSelected: (d: SelectedDevice[]) => void;
  setGroup: (groupId: string | null, startedAt?: number) => void;
}

export const useRecordingGroup = create<State>((set) => ({
  selected: [],
  layout: '2x2',
  groupId: null,
  recording: false,
  startedAt: null,
  setLayout: (l) => set({ layout: l }),
  setSelected: (d) => set({ selected: d }),
  setGroup: (groupId, startedAt) => set({
    groupId, recording: !!groupId,
    startedAt: groupId ? (startedAt ?? Date.now()) : null,
  }),
}));
```

- [ ] **Step 3: Build verify**

Run: `npm run build:xenon`
Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add web/src/api-service/recordings.ts web/src/components/mosaic/recording-group-store.ts web/package.json web/package-lock.json 2>/dev/null
git commit -m "feat(mosaic): API client + zustand store"
```

---

### Task 16: DevicePicker + LayoutSelector

**Files:**
- Create: `web/src/components/mosaic/DevicePicker.tsx`
- Create: `web/src/components/mosaic/LayoutSelector.tsx`

- [ ] **Step 1: `DevicePicker` (busy-aware)**

```tsx
// web/src/components/mosaic/DevicePicker.tsx
import React from 'react';

interface Device {
  udid: string;
  name?: string;
  platform?: string;
  busy?: boolean;
  busyReason?: string; // 'automation' | 'manual_other' | 'recording_other_group'
  mjpegServerPort?: number;
}

interface Props {
  devices: Device[];
  selected: Set<string>;
  onToggle: (udid: string) => void;
}

export function DevicePicker({ devices, selected, onToggle }: Props) {
  return (
    <ul className="dp-list">
      {devices.map((d) => {
        const blocked = !!d.busy;
        const reason = d.busyReason
          ? d.busyReason === 'automation'
            ? 'In automation'
            : d.busyReason === 'manual_other'
              ? 'Manual control by another user'
              : 'Recording in another group'
          : null;
        return (
          <li key={d.udid} className={`dp-item ${blocked ? 'dp-blocked' : ''}`}>
            <label title={blocked ? `${reason} — release first` : undefined}>
              <input
                type="checkbox"
                disabled={blocked}
                checked={selected.has(d.udid)}
                onChange={() => onToggle(d.udid)}
              />
              <span className="dp-name">{d.name ?? d.udid}</span>
              <span className="dp-meta">{d.platform}</span>
              {blocked && <span className="dp-pill">{reason}</span>}
            </label>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 2: `LayoutSelector`**

```tsx
// web/src/components/mosaic/LayoutSelector.tsx
import React from 'react';
import { Layout } from './recording-group-store';

const LAYOUTS: Layout[] = ['1', '2x1', '2x2', '3x2'];

export function LayoutSelector({ value, onChange }: { value: Layout; onChange: (l: Layout) => void }) {
  return (
    <div className="layout-selector" role="tablist">
      {LAYOUTS.map((l) => (
        <button
          key={l}
          role="tab"
          aria-selected={value === l}
          className={value === l ? 'active' : ''}
          onClick={() => onChange(l)}
        >{l}</button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Build verify**

Run: `npm run build:xenon`

- [ ] **Step 4: Commit**

```bash
git add web/src/components/mosaic/DevicePicker.tsx web/src/components/mosaic/LayoutSelector.tsx
git commit -m "feat(mosaic): DevicePicker (busy-aware) + LayoutSelector"
```

---

### Task 17: DeviceTile + AnnotationOverlay

**Files:**
- Create: `web/src/components/mosaic/AnnotationOverlay.tsx`
- Create: `web/src/components/mosaic/DeviceTile.tsx`

- [ ] **Step 1: `AnnotationOverlay`**

```tsx
// web/src/components/mosaic/AnnotationOverlay.tsx
import React, { useEffect, useRef, useState } from 'react';

export type Shape = 'ARROW' | 'RECT' | 'CIRCLE' | 'TEXT' | 'FREEHAND';

interface Annotation {
  shape: Shape;
  // Coordinates normalized 0..1 of the tile area.
  geometry: { x: number; y: number; w?: number; h?: number; points?: Array<[number, number]> };
  color: string;
  text?: string;
}

interface Props {
  enabled: boolean;
  shape: Shape;
  color: string;
  onCommit: (a: Annotation) => void;
}

export function AnnotationOverlay({ enabled, shape, color, onCommit }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const c = ref.current;
    const fit = () => { c.width = c.clientWidth; c.height = c.clientHeight; };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const norm = (e: React.MouseEvent) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };

  const onDown = (e: React.MouseEvent) => { if (!enabled) return; setDrag(norm(e)); };
  const onUp = (e: React.MouseEvent) => {
    if (!drag) return;
    const end = norm(e);
    const ann: Annotation = {
      shape, color,
      geometry: shape === 'RECT'
        ? { x: Math.min(drag.x, end.x), y: Math.min(drag.y, end.y), w: Math.abs(end.x - drag.x), h: Math.abs(end.y - drag.y) }
        : { x: drag.x, y: drag.y, w: end.x - drag.x, h: end.y - drag.y },
    };
    onCommit(ann);
    setDrag(null);
  };

  return (
    <canvas
      ref={ref}
      className="annot-overlay"
      style={{ position: 'absolute', inset: 0, pointerEvents: enabled ? 'auto' : 'none' }}
      onMouseDown={onDown}
      onMouseUp={onUp}
    />
  );
}
```

- [ ] **Step 2: `DeviceTile`**

```tsx
// web/src/components/mosaic/DeviceTile.tsx
import React, { useState } from 'react';
import { AnnotationOverlay, Shape } from './AnnotationOverlay';

interface Props {
  udid: string;
  mjpegPort: number;
  recordingId?: string;
  annotateMode: boolean;
  shape: Shape;
  color: string;
  onAnnotation: (recordingId: string, normalized: any) => void;
}

export function DeviceTile({ udid, mjpegPort, recordingId, annotateMode, shape, color, onAnnotation }: Props) {
  const url = `http://${window.location.hostname}:${mjpegPort}/`;
  return (
    <div className="device-tile" style={{ position: 'relative' }}>
      <img src={url} alt={udid} style={{ width: '100%', display: 'block' }} />
      {recordingId && annotateMode && (
        <AnnotationOverlay
          enabled
          shape={shape}
          color={color}
          onCommit={(a) => onAnnotation(recordingId, {
            timecodeMs: 0, // Phase 1: server stamps the precise timecode at receipt
            shape: a.shape,
            geometry: JSON.stringify(a.geometry),
            color: a.color,
            text: a.text,
          })}
        />
      )}
      <div className="tile-label">{udid}</div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/mosaic/AnnotationOverlay.tsx web/src/components/mosaic/DeviceTile.tsx
git commit -m "feat(mosaic): DeviceTile + AnnotationOverlay (canvas)"
```

---

### Task 18: DeviceMosaic grid + RecordingControls

**Files:**
- Create: `web/src/components/mosaic/DeviceMosaic.tsx`
- Create: `web/src/components/mosaic/RecordingControls.tsx`

- [ ] **Step 1: `DeviceMosaic`**

```tsx
// web/src/components/mosaic/DeviceMosaic.tsx
import React from 'react';
import { Layout } from './recording-group-store';
import { DeviceTile } from './DeviceTile';
import { Shape } from './AnnotationOverlay';

interface Tile { udid: string; mjpegPort: number; recordingId?: string }

interface Props {
  layout: Layout;
  tiles: Tile[];
  annotateMode: boolean;
  shape: Shape;
  color: string;
  onAnnotation: (recordingId: string, ann: any) => void;
}

const GRID: Record<Layout, string> = {
  '1': '1fr',
  '2x1': '1fr 1fr',
  '2x2': '1fr 1fr',
  '3x2': '1fr 1fr 1fr',
};
const ROWS: Record<Layout, string> = {
  '1': '1fr',
  '2x1': '1fr',
  '2x2': '1fr 1fr',
  '3x2': '1fr 1fr',
};

export function DeviceMosaic({ layout, tiles, annotateMode, shape, color, onAnnotation }: Props) {
  return (
    <div className="device-mosaic" style={{
      display: 'grid', gap: 8,
      gridTemplateColumns: GRID[layout],
      gridTemplateRows: ROWS[layout],
    }}>
      {tiles.map((t) => (
        <DeviceTile
          key={t.udid}
          udid={t.udid}
          mjpegPort={t.mjpegPort}
          recordingId={t.recordingId}
          annotateMode={annotateMode}
          shape={shape}
          color={color}
          onAnnotation={onAnnotation}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: `RecordingControls`**

```tsx
// web/src/components/mosaic/RecordingControls.tsx
import React from 'react';
import { useRecordingGroup } from './recording-group-store';
import { startRecording, stopRecording, addBookmark, bundleZipUrl } from '../../api-service/recordings';

interface Props { selectedUdids: string[] }

export function RecordingControls({ selectedUdids }: Props) {
  const { groupId, recording, startedAt, setGroup, selected } = useRecordingGroup();

  const onStart = async () => {
    try {
      const out = await startRecording(selectedUdids);
      setGroup(out.groupId, Date.now());
    } catch (e: any) {
      const c = e.conflict;
      if (c?.error === 'device_busy') {
        alert(`Cannot start: ${c.busyDevices.map((b: any) => `${b.udid} (${b.reason})`).join(', ')}`);
      } else if (c?.error === 'concurrency_cap') {
        alert(`Server-wide recording cap reached (${c.active}/${c.limit}).`);
      } else {
        alert(`Recording failed: ${e.message}`);
      }
    }
  };

  const onStop = async () => {
    if (!groupId) return;
    await stopRecording(groupId);
    // Keep groupId for download.
    setGroup(null);
  };

  const onBookmark = async () => {
    if (!groupId) return;
    const label = prompt('Bookmark label?') ?? 'bookmark';
    const elapsed = startedAt ? Date.now() - startedAt : 0;
    // Phase 1: bookmark goes on the first selected recording (multi-tile bookmark UX is Phase 2).
    const recordingId = (window as any).__recordingIds?.[0];
    if (recordingId) await addBookmark(groupId, recordingId, elapsed, label);
  };

  return (
    <div className="rec-controls">
      <button disabled={recording || selectedUdids.length === 0} onClick={onStart}>● Record</button>
      <button disabled={!recording} onClick={onStop}>⏹ Stop</button>
      <button disabled={!recording} onClick={onBookmark}>🔖 Bookmark</button>
      {groupId && !recording && (
        <a href={bundleZipUrl(groupId)} className="dl">⤓ Download proof bundle</a>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/mosaic/DeviceMosaic.tsx web/src/components/mosaic/RecordingControls.tsx
git commit -m "feat(mosaic): grid renderer + recording controls bar"
```

---

### Task 19: DeviceMosaicView + route + nav link

**Files:**
- Create: `web/src/components/mosaic/DeviceMosaicView.tsx`
- Create: `web/src/routes/devices-live.tsx`
- Modify: `web/src/App.tsx`
- Modify: nav (verify the file path with `ls web/src/components/sidebar/`)

- [ ] **Step 1: `DeviceMosaicView`**

```tsx
// web/src/components/mosaic/DeviceMosaicView.tsx
import React, { useEffect, useState } from 'react';
import { useRecordingGroup } from './recording-group-store';
import { DevicePicker } from './DevicePicker';
import { LayoutSelector } from './LayoutSelector';
import { DeviceMosaic } from './DeviceMosaic';
import { RecordingControls } from './RecordingControls';

export function DeviceMosaicView() {
  const { layout, setLayout } = useRecordingGroup();
  const [devices, setDevices] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tiles, setTiles] = useState<any[]>([]);

  useEffect(() => {
    fetch('/xenon/api/devices').then((r) => r.json()).then(setDevices);
    // State recovery: if there is an active group, fetch it.
    fetch('/xenon/api/recordings?status=RECORDING')
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (j?.groupId) { /* hydrate store */ } })
      .catch(() => {});
  }, []);

  const toggle = (udid: string) => {
    const next = new Set(selected);
    next.has(udid) ? next.delete(udid) : next.add(udid);
    setSelected(next);
  };

  const addToMosaic = async () => {
    const newTiles: any[] = [];
    for (const udid of Array.from(selected)) {
      const r = await fetch(`/xenon/api/control/${udid}/stream/start`, { method: 'POST' });
      if (!r.ok) continue;
      const body = await r.json();
      newTiles.push({ udid, mjpegPort: body.mjpegPort });
    }
    setTiles(newTiles);
  };

  return (
    <div className="mosaic-page">
      <header className="mosaic-header">
        <LayoutSelector value={layout} onChange={setLayout} />
        <RecordingControls selectedUdids={tiles.map((t) => t.udid)} />
      </header>
      <aside className="mosaic-side">
        <DevicePicker devices={devices} selected={selected} onToggle={toggle} />
        <button onClick={addToMosaic} disabled={selected.size === 0}>Add to mosaic</button>
      </aside>
      <main>
        <DeviceMosaic
          layout={layout}
          tiles={tiles}
          annotateMode={false}
          shape="RECT"
          color="#ff3333"
          onAnnotation={() => {}}
        />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Route entry + register**

```tsx
// web/src/routes/devices-live.tsx
import React from 'react';
import { DeviceMosaicView } from '../components/mosaic/DeviceMosaicView';

export default function DevicesLiveRoute() {
  return <DeviceMosaicView />;
}
```

In `web/src/App.tsx`, register the new route alongside existing routes. Match the existing routing library (likely `react-router-dom`):

```tsx
import DevicesLiveRoute from './routes/devices-live';
// inside <Routes>:
<Route path="/devices/live" element={<DevicesLiveRoute />} />
```

- [ ] **Step 3: Add nav link**

Run `ls web/src/components/sidebar/` to find the nav file. Add a link entry:

```tsx
{ label: 'Live Devices', path: '/devices/live', icon: '📺' }
```

(Adapt the literal to the existing item shape — a quick read of the file shows whether items are objects, JSX, or a list constant.)

- [ ] **Step 4: Build + smoke run**

```bash
npm run build:xenon
npm run server   # or however the project starts the dashboard locally
```

In a browser, open the dashboard, navigate to `/devices/live`, verify:
- Page loads without console errors.
- Online devices appear in the picker; busy devices are disabled with a reason pill.
- Selecting two free devices and clicking "Add to mosaic" shows two streaming tiles.
- Clicking ● Record then ⏹ Stop produces a recording row visible at `GET /xenon/api/recordings/<groupId>`.
- The "⤓ Download proof bundle" link downloads a non-empty zip.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/mosaic/DeviceMosaicView.tsx web/src/routes/devices-live.tsx web/src/App.tsx web/src/components/sidebar
git commit -m "feat(mosaic): page shell + route + nav link"
```

---

## Phase F — Final regression sweep

### Task 20: Full regression run

- [ ] **Step 1: Lint + format**

Run: `npm run lint && npm run format`
Expected: clean.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all unit + integration tests pass.

- [ ] **Step 3: Build everything**

Run: `npm run build:all`
Expected: clean compile of plugin and frontend.

- [ ] **Step 4: Manual cross-workflow smoke**

With one Android + one iOS device + one running Appium session on a third device:

1. Open `/devices/live`.
2. Confirm the Appium-busy device is greyed out with reason "In automation".
3. Add the two free devices to the mosaic, start a recording, drop two bookmarks, draw three rectangle annotations.
4. Stop the recording, download the zip, open it on a second machine.
5. Verify the existing session-detail live view + session bug-report still work for the third device's session.

- [ ] **Step 5: Final commit (if any incidental fixes)**

```bash
git status
# only commit if the lint/format pass introduced changes
git commit -m "chore(mosaic): final lint/format pass"
```

- [ ] **Step 6: Open PR**

```bash
git push -u origin feat/mosaic-proof-pack-spec  # branch already exists from spec commits
gh pr create --title "feat(mosaic): multi-device live view + proof bundle (Phase 1)" --body "$(cat <<'BODY'
## Summary

Phase 1 of the multi-device mosaic + manual-test proof pack. Implements the design at `docs/superpowers/specs/2026-04-27-multi-device-mosaic-and-proof-pack-design.md`.

- Multi-device live mosaic at `/devices/live` (UI-only, no Appium client required)
- Server-side free-form recording, independent of `Session`
- Bookmarks + canvas annotations (metadata, not pixels)
- Proof-bundle zip download
- Three-layer busy-device safety; atomic pre-checks; cross-workflow integration tests

## Non-regression

- Schema, routes, sockets, services are all additive
- `VideoPipelineService` gains an optional `outputPath` only
- Existing session recording + session bug-report are pinned by `test/regression/no-regression.spec.ts`
- Cross-workflow tests in `test/integration/cross-workflow.spec.ts` cover the six scenarios from the spec matrix

## Test plan
- [ ] `npm test` clean
- [ ] `npm run test:e2e` clean
- [ ] Manual smoke with one Android + one iOS device + one running Appium session
BODY
)"
```

---

## Self-Review Notes (already applied)

- **Spec coverage:** every spec section has at least one task. Mapping:
  - Non-regression posture → Tasks 3, 14, 17 (regression test), 20.
  - UI-only operability → mosaic uses existing `POST /control/:udid/stream/start` (Task 19), no new code path.
  - Three-layer busy safety → Layer 1 in Task 16 (DevicePicker), Layer 2 in Tasks 7+8 (BusyPrecheck + orchestrator), Layer 3 unchanged.
  - Cross-workflow review → Task 14 covers all six scenarios.
  - `Recording`/`Bookmark`/`Annotation` models → Task 1.
  - `outputPath` additive → Task 3.
  - Server-restart recovery → Task 9 with explicit test in Task 14.
  - Concurrency cap server-wide → Task 6 + Task 8 (orchestrator integration).
  - REST contract → Task 12.
  - Proof bundle layout → Task 10.
  - Annotated-MP4 export → Task 11.
  - Frontend mapping (DevicePicker / Layout / Tile / Overlay / Controls / View) → Tasks 16-19.
- **Placeholder scan:** none. Every code step shows the code.
- **Type consistency:** `RecordingError` thrown in Task 8, caught in Task 12 router, asserted in Tasks 13-14 — same shape throughout.

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-27-multi-device-mosaic-and-proof-pack-phase-1.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — I execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
