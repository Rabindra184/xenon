# Recordings library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Recordings page that lists past Live Devices recordings, and a recording page that plays every phone's video side by side, in sync, with bookmarks, annotations, downloads and delete.

**Architecture:**
- **Server.** A pure module, `recordingSummary.ts`, turns `Recording` rows into group summaries and does the library's filtering and paging. The store gains the queries it needs, and a guarded file-removal helper serves delete. The recordings router gains four routes:
  - the list;
  - the richer detail;
  - delete;
  - a raw, range-capable video stream for the in-browser player.
- **Dashboard.** Pure modules (`playback.ts`, `libraryFilters.ts`, `recordingActions.ts`) hold the rules. A `useSyncedPlayback` hook drives N `<video>` elements from one clock. Two pages, `RecordingsPage` and `RecordingPage`, render them.

**Tech Stack:**
- Server: Express, Prisma (SQLite), Mocha + Chai + Sinon + supertest.
- Dashboard: React 17, react-router 6, Vitest + Testing Library, and the shared UI kit (`PageHeader`, `Table`, `FilterMenu`, `Popover`/`Menu`, `Modal`, `EmptyState`, `Button`) plus the mosaic's `AnnotationOverlay`.

Spec: `docs/superpowers/specs/2026-09-27-recordings-library-design.md`

## Global Constraints

- **Model.** A library recording is a **group**: the `Recording` rows sharing a `group_id`, one per phone. There is no new table.
- **Status.** `recording` if any row is `RECORDING`. `failed` if every row is `FAILED` or `DISCARDED`. Otherwise `done`.
- **Group time.**
  - The group's **t=0** is the dashboard's t=0: the `groupT0Ms` of the recording's `timing.json` (`readRecordingTiming`), or the earliest `started_at` when no row has a timing file. `startedAt` in a summary is that t=0.
  - A phone's **offset** is `spawnedAtMs − groupT0Ms` from its timing file. Without one, it is `started_at − t0`. It can be negative, since initial phones start before t=0.
  - Bookmark and annotation `timecode_ms` values are group times. A phone's video time is `groupTime − offset`.
  - The group's length is the maximum over phones of `offset + duration_ms`.
- **Access.**
  - Visibility is today's download rule: `filterRowsByVisibleDevice(rows, req.auth.teamIds, 'device_udid')`, where `teamIds === undefined` means admin, who sees all. A group with no visible rows is left out, or answers 404.
  - Delete is allowed for the user in `started_by` (`resolveActor(req).userId`) or an admin (`resolveActor(req).isAdmin`). A group with no `started_by` is admin-only.
  - Delete refusals:
    - 403 `not_owner`;
    - 409 `recording_in_progress`, checked before ownership, so the owner hears it too;
    - 404 `not_found`.
  - Success is 204.
- **Retention numbers** come from `PluginContext.pluginArgs`. The defaults are exactly CleanupService's: `recordingCleanupDays` 30, `recordingCleanupMaxCount` 100, `recordingFailedCleanupDays` 2.
- **Copy (exact strings):**
  - Sidebar and page:
    - sidebar item "Recordings" (icon `Film`), placed after "Live devices";
    - tab titles "Recordings · Xenon" and "Recording · Xenon".
  - Library:
    - empty states "No recordings yet" with "Record phones from Live devices.", and "No recordings match" with a **Clear filters** button;
    - footnote "Recordings are kept for {days} days, up to the newest {maxCount}.";
    - status cells "Recording…" and "Failed";
    - "Load more".
  - Recording page, messages:
    - "Joined at {m:ss}";
    - "Recording failed: {reason}";
    - "Video no longer available";
    - "Still recording";
    - "This recording isn't available" with "It may have been deleted, or it's on phones you can't see.".
  - Recording page, Delete dialog:
    - title "Delete this recording?";
    - body "Its videos, bookmarks and annotations are removed for everyone.";
    - buttons **Cancel** and **Delete**;
    - the delete-error messages in Task 6.
  - Live devices: "Open in Recordings".
- **Dashboard rules:**
  - Tokens only: `web/src/design/color-literals.test.ts` ratchets literals, and there are no rules on shared Button classes.
  - The web tsconfig targets ES5, so never spread or `for-of` a Set or Map (use `Array.from`).
  - The supported width is 1280–1440 px, with no sideways scroll.
  - Dialogs use `ui/Modal`.
- **Repo rules:**
  - Never run `eslint --fix` or `prettier --write` on an existing file; compare lint counts with the base.
  - Stage explicit paths.
  - No attribution lines.
  - Server specs that touch `CommandInterceptor`/`SessionManager` need `import 'reflect-metadata'`.
  - Never declare top-level `before`/`after` hooks.
  - Register `ARTIFACT_STORE` with `useArtifactStore()` from `test/helpers/artifact-store.ts`.

**Adjustments to the spec, made here on purpose** (each is reported in the PR):
1. **Offsets use `timing.json`, not `started_at`.** The annotated export already shifts marks by `markShiftMs(readRecordingTiming(...))` (`recordingTiming.ts`), so playback lines up with it. The spec's "Not in this version" item about the export's time shift for late phones is already handled, except for a phone added more than 5 minutes in, where `markShiftMs` clamps to 0. That remainder goes in the PR as a follow-up.
2. **A raw, range-capable video route for the player:** `GET /recordings/:groupId/source.mp4?recordingId=`. Today's `video.mp4` returns the **annotated** file whenever marks exist (`resolveVideoFile` → `resolvePlayablePath`). It streams the whole file without honouring `Range`, and it is keyed by `?udid=`. The page draws marks itself, so it needs the clean video, and it needs seeking. `&download=1` serves the same file as an attachment, and that is the per-phone **Video** download. **Video with annotations** stays `exports/annotated.mp4?recordingId=`.
3. **The list response adds `total`, `facets` and `retention`** beside `recordings` and `nextCursor`. The Phone, Recorded-by and When menus need their options and counts across every visible recording, not just the loaded page. The header's count needs the filtered total.
4. **The cursor is opaque:** `"<startedAt ms>_<groupId>"`. This breaks ties between groups started in the same millisecond.
5. **`GET /recordings/:groupId` answers 404 for a group with no rows,** for admins too. Today it returns `{ recordings: [] }`, and nothing in the dashboard calls it.
6. **The list reads every row, then filters and pages in memory.** Retention bounds the table (`recordingCleanupMaxCount` finished rows, 100 by default, plus running and recently failed ones), and grouping, visibility and `q` over bookmark labels are awkward in SQL.

---

### Task 1: Who started a recording (`started_by`)

**Files:**
- Modify: `prisma/schema.prisma` (model `Recording`); `src/services/recording/recording-store.ts` (`CreateRecordingInput`, `create`); `src/services/recording/RecordingOrchestrator.ts` (both `store.create` calls)
- Create: `prisma/migrations/20260927120000_recording_started_by/migration.sql` (generated)
- Regenerate: `src/generated/client` (committed)
- Test: `test/unit/recording-store.spec.ts`, `test/unit/recording-orchestrator.spec.ts`

**Interfaces (produces):** a `Recording.started_by String?` column, and `CreateRecordingInput.startedBy?: string | null`.

- [ ] **Step 1: Failing tests.**

In `recording-store.spec.ts`, inside the existing `describe`:

```ts
  it('keeps who started a recording, and null when nobody is known', async () => {
    const a = await store.create({
      id: 'test-rec-by-1',
      groupId: 'test-g-by',
      deviceUdid: 'TEST-BY1',
      deviceHost: '127.0.0.1',
      filePath: '/tmp/by1.mp4',
      sessionId: null,
      deviceSnapshot: null,
      startedBy: 'usr_alice',
    });
    const b = await store.create({
      id: 'test-rec-by-2',
      groupId: 'test-g-by',
      deviceUdid: 'TEST-BY2',
      deviceHost: '127.0.0.1',
      filePath: '/tmp/by2.mp4',
      sessionId: null,
      deviceSnapshot: null,
    });
    expect(a.started_by).to.equal('usr_alice');
    expect(b.started_by).to.equal(null);
  });
```

In `recording-orchestrator.spec.ts`, add to the test that asserts `store.create.callCount` equals 2 after `orch.start({ udids: ['U1', 'U2'], actorId: 'actor-1' })`:

```ts
    expect(store.create.getCalls().map((c: any) => c.args[0].startedBy)).to.deep.equal([
      'actor-1',
      'actor-1',
    ]);
```

In the test that calls `orch.addDevice('grp-1', 'U3', 'actor-1')`, assert that the last `store.create` call's `args[0].startedBy` equals `'actor-1'`. Read the file first: `store` is the stub object `makeOrch` returns, so match how it is asserted there.

- [ ] **Step 2: Run** `npx mocha test/unit/recording-store.spec.ts test/unit/recording-orchestrator.spec.ts`. They should FAIL, from a TS error on `startedBy` and missing args.
- [ ] **Step 3: Implement.**
  1. Schema, in `model Recording`, after `fail_reason     String?`:

     ```prisma
       /// The user who started the recording (User.id); null on rows from before 1.29.
       started_by      String?
     ```

  2. Generate the SQL (don't hand-write it):

     ```bash
     mkdir -p prisma/migrations/20260927120000_recording_started_by
     npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20260927120000_recording_started_by/migration.sql
     cat prisma/migrations/20260927120000_recording_started_by/migration.sql
     ```

     Expected: `-- AlterTable` and `ALTER TABLE "Recording" ADD COLUMN "started_by" TEXT;`.
  3. Regenerate the client with `node scripts/generate-prisma.js`, then apply the migration to the local DB with `npm run db:migrate`. The store spec round-trips through it.
  4. In `recording-store.ts`, add `startedBy?: string | null;` to `CreateRecordingInput`, after `deviceSnapshot`, commented "Who started it (User.id).". In `create`, add `started_by: input.startedBy ?? undefined,`.
  5. In `RecordingOrchestrator.ts`, add `startedBy: actorId,` to both `this.store.create({ … })` calls: the one in `start` (~line 321) and the one in `_addDeviceInternal` (~line 881).
- [ ] **Step 4: Verify.**
  - `npx mocha test/unit/recording-store.spec.ts test/unit/recording-orchestrator.spec.ts` should PASS.
  - The gates:

    ```bash
    npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code; echo "exit $?"
    node scripts/check-client-freshness.js
    npx tsc --noEmit -p . ; echo tsc=$?
    ```

    Expected: `exit 0`, "Generated client is fresh.", and `tsc=0`.
- [ ] **Step 5: Commit** `feat(recordings): remember who started a recording`. Stage `prisma/schema.prisma`, the migration directory, `src/generated/client`, the two source files and the two specs.

---

### Task 2: Group summaries, filters and paging (pure)

**Files:**
- Create: `src/services/recording/recordingSummary.ts`
- Test: `test/unit/recording-summary.spec.ts`

**Interfaces (produces):**

```ts
export type GroupStatus = 'recording' | 'done' | 'failed';
export interface PhoneSummary {
  recordingId: string; udid: string; name: string; platform: string | null;
  status: string; offsetMs: number; durationMs: number | null;
  failReason: string | null; annotationCount: number;
}
export interface RecordingSummary {
  groupId: string; startedAt: string; endedAt: string | null; durationMs: number | null;
  status: GroupStatus; phones: PhoneSummary[]; startedBy: { id: string; name: string } | null;
  bookmarkCount: number; annotationCount: number; keptUntil: string; sizeBytes: number;
  hasComposite: boolean;
}
export interface SummaryRow {
  id: string; group_id: string; device_udid: string; status: string;
  started_at: Date; ended_at: Date | null; duration_ms: number | null; size_bytes: number | null;
  fail_reason: string | null; started_by: string | null;
  timing?: RecordingTiming; bookmarkLabels: string[]; annotationCount: number;
}
export interface Retention { days: number; failedDays: number; maxCount: number }
export interface SummaryContext {
  devices: Map<string, { name: string; platform: string | null }>;
  users: Map<string, string>;
  retention: Retention;
  hasComposite: (groupId: string) => boolean;
}
export interface LibraryFilter { udid?: string; startedBy?: string; since?: number; q?: string }
export interface LibraryFacets {
  phones: Array<{ udid: string; name: string; count: number }>;
  people: Array<{ id: string; name: string; count: number }>;
  unknownCount: number;
  when: { any: number; '24h': number; '7d': number; '30d': number };
}
export interface LibraryPage {
  recordings: RecordingSummary[]; nextCursor: string | null; total: number; facets: LibraryFacets;
}
export function groupStatus(rows: Array<Pick<SummaryRow, 'status'>>): GroupStatus;
export function summarizeGroup(rows: SummaryRow[], ctx: SummaryContext): RecordingSummary;
export function cursorOf(s: RecordingSummary): string;
export function buildLibrary(
  rows: SummaryRow[], ctx: SummaryContext, filter: LibraryFilter,
  page: { limit: number; cursor?: string; now: number },
): LibraryPage;
```

- [ ] **Step 1: Failing tests** in `test/unit/recording-summary.spec.ts`:

```ts
import { expect } from 'chai';
import {
  buildLibrary,
  cursorOf,
  groupStatus,
  summarizeGroup,
  type SummaryContext,
  type SummaryRow,
} from '../../src/services/recording/recordingSummary';

const T0 = Date.parse('2026-09-20T10:00:00.000Z');
const DAY = 86_400_000;

function row(over: Partial<SummaryRow> = {}): SummaryRow {
  return {
    id: 'r1',
    group_id: 'g1',
    device_udid: 'U1',
    status: 'STOPPED',
    started_at: new Date(T0 - 1000),
    ended_at: new Date(T0 + 60_000),
    duration_ms: 61_000,
    size_bytes: 1000,
    fail_reason: null,
    started_by: 'usr_alice',
    timing: { version: 1, spawnedAtMs: T0 - 1000, groupT0Ms: T0 },
    bookmarkLabels: [],
    annotationCount: 0,
    ...over,
  };
}

const ctx: SummaryContext = {
  devices: new Map([
    ['U1', { name: 'Galaxy S9+', platform: 'android' }],
    ['U2', { name: 'iPhone 17', platform: 'ios' }],
  ]),
  users: new Map([['usr_alice', 'Alice']]),
  retention: { days: 30, failedDays: 2, maxCount: 100 },
  hasComposite: (g) => g === 'g1',
};

describe('recording summaries', () => {
  it('reads a group’s status from its rows', () => {
    expect(groupStatus([{ status: 'STOPPED' }, { status: 'RECORDING' }])).to.equal('recording');
    expect(groupStatus([{ status: 'FAILED' }, { status: 'DISCARDED' }])).to.equal('failed');
    expect(groupStatus([{ status: 'FAILED' }, { status: 'STOPPED' }])).to.equal('done');
  });

  it('puts each phone on the group’s timeline from its timing file', () => {
    const s = summarizeGroup(
      [
        row(),
        row({
          id: 'r2',
          device_udid: 'U2',
          started_at: new Date(T0 + 41_000),
          duration_ms: 20_000,
          timing: { version: 1, spawnedAtMs: T0 + 42_000, groupT0Ms: T0 },
        }),
      ],
      ctx,
    );
    expect(s.startedAt).to.equal(new Date(T0).toISOString());
    expect(s.phones.map((p) => [p.name, p.offsetMs])).to.deep.equal([
      ['Galaxy S9+', -1000],
      ['iPhone 17', 42_000],
    ]);
    // max(-1000 + 61000, 42000 + 20000)
    expect(s.durationMs).to.equal(62_000);
  });

  it('falls back to started_at when a recording has no timing file', () => {
    const s = summarizeGroup(
      [
        row({ timing: undefined, started_at: new Date(T0) }),
        row({ id: 'r2', device_udid: 'U2', timing: undefined, started_at: new Date(T0 + 5000) }),
      ],
      ctx,
    );
    expect(s.startedAt).to.equal(new Date(T0).toISOString());
    expect(s.phones.map((p) => p.offsetMs)).to.deep.equal([0, 5000]);
  });

  it('ignores a timing file that puts the video impossibly early', () => {
    const s = summarizeGroup(
      [row({ timing: { version: 1, spawnedAtMs: T0 - 10 * 60_000, groupT0Ms: T0 }, started_at: new Date(T0) })],
      ctx,
    );
    expect(s.phones[0].offsetMs).to.equal(0);
  });

  it('names phones and people, falling back to the UDID and "Unknown user"', () => {
    const s = summarizeGroup(
      [row({ device_udid: 'GONE-1', started_by: 'usr_deleted' })],
      ctx,
    );
    expect(s.phones[0].name).to.equal('GONE-1');
    expect(s.phones[0].platform).to.equal(null);
    expect(s.startedBy).to.deep.equal({ id: 'usr_deleted', name: 'Unknown user' });
    expect(summarizeGroup([row({ started_by: null })], ctx).startedBy).to.equal(null);
  });

  it('has no end or length while recording', () => {
    const s = summarizeGroup([row({ status: 'RECORDING', ended_at: null, duration_ms: null })], ctx);
    expect(s.status).to.equal('recording');
    expect(s.endedAt).to.equal(null);
    expect(s.durationMs).to.equal(null);
  });

  it('keeps a done group for `days` and a failed one for `failedDays`, from its first start', () => {
    const done = summarizeGroup([row()], ctx);
    expect(done.keptUntil).to.equal(new Date(T0 - 1000 + 30 * DAY).toISOString());
    const failed = summarizeGroup([row({ status: 'FAILED', fail_reason: 'no frames' })], ctx);
    expect(failed.keptUntil).to.equal(new Date(T0 - 1000 + 2 * DAY).toISOString());
    expect(failed.phones[0].failReason).to.equal('no frames');
  });

  it('adds up bookmarks, marks and bytes, and says whether there is a composite', () => {
    const s = summarizeGroup(
      [
        row({ bookmarkLabels: ['login'], annotationCount: 2, size_bytes: 1000 }),
        row({ id: 'r2', device_udid: 'U2', bookmarkLabels: ['pay', 'done'], annotationCount: 1, size_bytes: null }),
      ],
      ctx,
    );
    expect([s.bookmarkCount, s.annotationCount, s.sizeBytes, s.hasComposite]).to.deep.equal([3, 3, 1000, true]);
    expect(s.phones.map((p) => p.annotationCount)).to.deep.equal([2, 1]);
  });
});

describe('the library', () => {
  // Three groups, a day apart: g3 newest.
  const rows = [
    row({ group_id: 'g1', id: 'a', started_at: new Date(T0), timing: undefined }),
    row({ group_id: 'g2', id: 'b', device_udid: 'U2', started_at: new Date(T0 + DAY), timing: undefined, started_by: null, bookmarkLabels: ['Checkout button'] }),
    row({ group_id: 'g3', id: 'c', started_at: new Date(T0 + 2 * DAY), timing: undefined }),
  ];
  const now = T0 + 2 * DAY + 1000;
  const all = (filter = {}, limit = 50, cursor?: string) =>
    buildLibrary(rows, ctx, filter, { limit, cursor, now });

  it('lists groups newest first', () => {
    expect(all().recordings.map((s) => s.groupId)).to.deep.equal(['g3', 'g2', 'g1']);
    expect(all().total).to.equal(3);
  });

  it('filters by phone, by who recorded (or unknown), by time, and by text', () => {
    expect(all({ udid: 'U2' }).recordings.map((s) => s.groupId)).to.deep.equal(['g2']);
    expect(all({ startedBy: 'usr_alice' }).recordings.map((s) => s.groupId)).to.deep.equal(['g3', 'g1']);
    expect(all({ startedBy: 'unknown' }).recordings.map((s) => s.groupId)).to.deep.equal(['g2']);
    expect(all({ since: T0 + DAY }).recordings.map((s) => s.groupId)).to.deep.equal(['g3', 'g2']);
    expect(all({ q: 'checkout' }).recordings.map((s) => s.groupId)).to.deep.equal(['g2']);
    expect(all({ q: 'IPHONE' }).recordings.map((s) => s.groupId)).to.deep.equal(['g2']);
    expect(all({ q: 'u1' }).recordings.map((s) => s.groupId)).to.deep.equal(['g3', 'g1']);
    expect(all({ udid: 'U2' }).total).to.equal(1);
  });

  it('pages with a cursor, and ends with a null cursor', () => {
    const first = all({}, 2);
    expect(first.recordings.map((s) => s.groupId)).to.deep.equal(['g3', 'g2']);
    expect(first.nextCursor).to.equal(cursorOf(first.recordings[1]));
    const second = all({}, 2, first.nextCursor as string);
    expect(second.recordings.map((s) => s.groupId)).to.deep.equal(['g1']);
    expect(second.nextCursor).to.equal(null);
    expect(second.total).to.equal(3);
  });

  it('continues after a cursor whose group was deleted meanwhile', () => {
    const gone = `${T0 + DAY}_g2`;
    const out = buildLibrary(rows.filter((r) => r.group_id !== 'g2'), ctx, {}, { limit: 50, cursor: gone, now });
    expect(out.recordings.map((s) => s.groupId)).to.deep.equal(['g1']);
  });

  it('counts the menus’ options across every recording, whatever is filtered', () => {
    const f = all({ udid: 'U2' }).facets;
    expect(f.phones).to.deep.equal([
      { udid: 'U1', name: 'Galaxy S9+', count: 2 },
      { udid: 'U2', name: 'iPhone 17', count: 1 },
    ]);
    expect(f.people).to.deep.equal([{ id: 'usr_alice', name: 'Alice', count: 2 }]);
    expect(f.unknownCount).to.equal(1);
    expect(f.when).to.deep.equal({ any: 3, '24h': 1, '7d': 3, '30d': 3 });
  });
});
```

- [ ] **Step 2: Run** `npx mocha test/unit/recording-summary.spec.ts`. It should FAIL because the module is missing.
- [ ] **Step 3: Implement** `src/services/recording/recordingSummary.ts`:

```ts
import type { RecordingTiming } from './recordingTiming';

/**
 * The recordings library's view of a recording: a group (the rows sharing a
 * group_id, one per phone), summarized, filtered and paged. Pure — the router
 * gathers the rows, names and retention settings; everything else is decided
 * here, where it can be tested without a DB.
 */

export type GroupStatus = 'recording' | 'done' | 'failed';

export interface PhoneSummary {
  recordingId: string;
  udid: string;
  name: string;
  platform: string | null;
  /** The row's own status: RECORDING, STOPPED, FAILED or DISCARDED. */
  status: string;
  /** Where this phone's video starts on the group's timeline; negative if before t=0. */
  offsetMs: number;
  durationMs: number | null;
  failReason: string | null;
  annotationCount: number;
}

export interface RecordingSummary {
  groupId: string;
  /** The group's t=0: the moment marks and bookmarks count from. */
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  status: GroupStatus;
  phones: PhoneSummary[];
  startedBy: { id: string; name: string } | null;
  bookmarkCount: number;
  annotationCount: number;
  keptUntil: string;
  sizeBytes: number;
  hasComposite: boolean;
}

export interface SummaryRow {
  id: string;
  group_id: string;
  device_udid: string;
  status: string;
  started_at: Date;
  ended_at: Date | null;
  duration_ms: number | null;
  size_bytes: number | null;
  fail_reason: string | null;
  started_by: string | null;
  /** The recording's timing.json, when it has one. */
  timing?: RecordingTiming;
  bookmarkLabels: string[];
  annotationCount: number;
}

export interface Retention {
  days: number;
  failedDays: number;
  maxCount: number;
}

export interface SummaryContext {
  devices: Map<string, { name: string; platform: string | null }>;
  users: Map<string, string>;
  retention: Retention;
  hasComposite: (groupId: string) => boolean;
}

export interface LibraryFilter {
  udid?: string;
  /** A user id, or 'unknown' for recordings nobody is recorded as starting. */
  startedBy?: string;
  /** Epoch ms; groups that started at or after it. */
  since?: number;
  q?: string;
}

export interface LibraryFacets {
  phones: Array<{ udid: string; name: string; count: number }>;
  people: Array<{ id: string; name: string; count: number }>;
  unknownCount: number;
  when: { any: number; '24h': number; '7d': number; '30d': number };
}

export interface LibraryPage {
  recordings: RecordingSummary[];
  nextCursor: string | null;
  /** Groups matching the filter, across all pages. */
  total: number;
  facets: LibraryFacets;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * A video starts at most a few seconds before t=0 (each phone's ffmpeg spawn,
 * then the composite's settle). A timing file claiming more is corrupt.
 */
const MAX_PREROLL_MS = 5 * 60 * 1000;
const FAILED_STATUSES = ['FAILED', 'DISCARDED'];

function timingOffset(t: RecordingTiming | undefined): number | undefined {
  if (!t) return undefined;
  const off = Math.round(t.spawnedAtMs - t.groupT0Ms);
  return off < -MAX_PREROLL_MS ? undefined : off;
}

export function groupStatus(rows: Array<Pick<SummaryRow, 'status'>>): GroupStatus {
  if (rows.some((r) => r.status === 'RECORDING')) return 'recording';
  if (rows.every((r) => FAILED_STATUSES.includes(r.status))) return 'failed';
  return 'done';
}

export function summarizeGroup(rows: SummaryRow[], ctx: SummaryContext): RecordingSummary {
  const byStart = rows.slice().sort((a, b) => a.started_at.getTime() - b.started_at.getTime());
  const first = byStart[0];
  const timed = byStart.find((r) => timingOffset(r.timing) !== undefined);
  const t0 = timed?.timing ? timed.timing.groupT0Ms : first.started_at.getTime();
  const status = groupStatus(rows);

  const phones: PhoneSummary[] = byStart
    .map((r) => {
      const device = ctx.devices.get(r.device_udid);
      return {
        recordingId: r.id,
        udid: r.device_udid,
        name: device?.name || r.device_udid,
        platform: device?.platform ?? null,
        status: r.status,
        offsetMs: timingOffset(r.timing) ?? r.started_at.getTime() - t0,
        durationMs: r.duration_ms,
        failReason: r.fail_reason,
        annotationCount: r.annotationCount,
      };
    })
    .sort((a, b) => a.offsetMs - b.offsetMs || a.name.localeCompare(b.name));

  const ends = phones
    .filter((p) => p.durationMs !== null)
    .map((p) => p.offsetMs + (p.durationMs as number));
  const endedAts = rows
    .map((r) => r.ended_at)
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());
  const owner = byStart.find((r) => r.started_by)?.started_by ?? null;
  const days = status === 'failed' ? ctx.retention.failedDays : ctx.retention.days;

  return {
    groupId: first.group_id,
    startedAt: new Date(t0).toISOString(),
    endedAt:
      status === 'recording' || endedAts.length === 0
        ? null
        : new Date(Math.max(...endedAts)).toISOString(),
    durationMs: status === 'recording' || ends.length === 0 ? null : Math.max(0, ...ends),
    status,
    phones,
    startedBy: owner ? { id: owner, name: ctx.users.get(owner) ?? 'Unknown user' } : null,
    bookmarkCount: rows.reduce((n, r) => n + r.bookmarkLabels.length, 0),
    annotationCount: rows.reduce((n, r) => n + r.annotationCount, 0),
    // CleanupService ages each row from its own started_at.
    keptUntil: new Date(first.started_at.getTime() + days * DAY_MS).toISOString(),
    sizeBytes: rows.reduce((n, r) => n + (r.size_bytes ?? 0), 0),
    hasComposite: ctx.hasComposite(first.group_id),
  };
}

/** Opaque to clients: "<startedAt ms>_<groupId>", so same-millisecond groups keep their order. */
export function cursorOf(s: RecordingSummary): string {
  return `${Date.parse(s.startedAt)}_${s.groupId}`;
}

function newestFirst(a: RecordingSummary, b: RecordingSummary): number {
  const d = Date.parse(b.startedAt) - Date.parse(a.startedAt);
  if (d !== 0) return d;
  return a.groupId < b.groupId ? 1 : a.groupId > b.groupId ? -1 : 0;
}

/** Strictly after the cursor in newest-first order. */
function afterCursor(s: RecordingSummary, cursor: string): boolean {
  const i = cursor.indexOf('_');
  const ms = Number(cursor.slice(0, i));
  if (i < 0 || !Number.isFinite(ms)) return true;
  const gid = cursor.slice(i + 1);
  const t = Date.parse(s.startedAt);
  return t < ms || (t === ms && s.groupId < gid);
}

function matches(s: RecordingSummary, labels: string[], f: LibraryFilter): boolean {
  if (f.udid && !s.phones.some((p) => p.udid === f.udid)) return false;
  if (f.startedBy === 'unknown') {
    if (s.startedBy !== null) return false;
  } else if (f.startedBy && s.startedBy?.id !== f.startedBy) {
    return false;
  }
  if (f.since !== undefined && Date.parse(s.startedAt) < f.since) return false;
  const q = f.q?.trim().toLowerCase();
  if (q) {
    const haystack = s.phones
      .map((p) => `${p.name}\n${p.udid}`)
      .concat(labels)
      .join('\n')
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

function facetsOf(all: RecordingSummary[], now: number): LibraryFacets {
  const phones = new Map<string, { udid: string; name: string; count: number }>();
  const people = new Map<string, { id: string; name: string; count: number }>();
  let unknownCount = 0;
  const when = { any: all.length, '24h': 0, '7d': 0, '30d': 0 };
  for (const s of all) {
    s.phones.forEach((p) => {
      const f = phones.get(p.udid);
      if (f) f.count++;
      else phones.set(p.udid, { udid: p.udid, name: p.name, count: 1 });
    });
    if (s.startedBy) {
      const f = people.get(s.startedBy.id);
      if (f) f.count++;
      else people.set(s.startedBy.id, { ...s.startedBy, count: 1 });
    } else {
      unknownCount++;
    }
    const age = now - Date.parse(s.startedAt);
    if (age <= DAY_MS) when['24h']++;
    if (age <= 7 * DAY_MS) when['7d']++;
    if (age <= 30 * DAY_MS) when['30d']++;
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    phones: Array.from(phones.values()).sort(byName),
    people: Array.from(people.values()).sort(byName),
    unknownCount,
    when,
  };
}

export function buildLibrary(
  rows: SummaryRow[],
  ctx: SummaryContext,
  filter: LibraryFilter,
  page: { limit: number; cursor?: string; now: number },
): LibraryPage {
  const groups = new Map<string, SummaryRow[]>();
  rows.forEach((r) => {
    const list = groups.get(r.group_id);
    if (list) list.push(r);
    else groups.set(r.group_id, [r]);
  });
  const all = Array.from(groups.values()).map((g) => ({
    summary: summarizeGroup(g, ctx),
    labels: g.reduce<string[]>((acc, r) => acc.concat(r.bookmarkLabels), []),
  }));
  const matching = all
    .filter((x) => matches(x.summary, x.labels, filter))
    .map((x) => x.summary)
    .sort(newestFirst);
  const rest = page.cursor ? matching.filter((s) => afterCursor(s, page.cursor as string)) : matching;
  const recordings = rest.slice(0, page.limit);
  return {
    recordings,
    nextCursor: rest.length > page.limit ? cursorOf(recordings[recordings.length - 1]) : null,
    total: matching.length,
    facets: facetsOf(
      all.map((x) => x.summary),
      page.now,
    ),
  };
}
```

- [ ] **Step 4: Run** the spec; it should PASS. Also run `npx tsc --noEmit -p . ; echo tsc=$?` (expect 0) and `npx eslint src/services/recording/recordingSummary.ts test/unit/recording-summary.spec.ts` (expect 0 problems; hand-fix Prettier line breaks).
- [ ] **Step 5: Commit** `feat(recordings): summarize, filter and page recording groups`.

---

### Task 3: Store queries and file removal

**Files:**
- Modify: `src/services/recording/recording-store.ts`
- Create: `src/services/recording/recordingFiles.ts`
- Test: `test/unit/recording-store.spec.ts`, `test/unit/recording-files.spec.ts`

**Interfaces (produces):**

```ts
// RecordingStore
libraryRows(): Promise<Array<Recording & { bookmarks: { label: string }[]; _count: { annotations: number } }>>;
deleteGroupRows(groupId: string): Promise<number>;
deviceNames(udids: string[]): Promise<Map<string, { name: string; platform: string | null }>>;
userNames(ids: string[]): Promise<Map<string, string>>;
// recordingFiles.ts
export function recordingDirOf(videoFilePath: string): string;
export function removeRecordingFiles(filePaths: string[], groupDir: string, base: string): string[];
```

- [ ] **Step 1: Failing tests.**

In `recording-store.spec.ts`, inside the existing describe, which already cleans `test-` rows in its `afterEach`:

```ts
  it('libraryRows carries bookmark labels and a mark count', async () => {
    await store.create({
      id: 'test-lib-1', groupId: 'test-g-lib', deviceUdid: 'TEST-L1', deviceHost: '127.0.0.1',
      filePath: '/tmp/l1.mp4', sessionId: null, deviceSnapshot: null, startedBy: 'usr_a',
    });
    await store.addBookmark('test-lib-1', 'Login', 1000);
    await store.addAnnotation('test-lib-1', { timecodeMs: 5, shape: 'RECT', geometry: '{}', color: 'red' });
    const rows = await store.libraryRows();
    const r = rows.find((x) => x.id === 'test-lib-1')!;
    expect(r.bookmarks.map((b) => b.label)).to.deep.equal(['Login']);
    expect(r._count.annotations).to.equal(1);
    expect(r.started_by).to.equal('usr_a');
  });

  it('deleteGroupRows removes the group’s rows, and their bookmarks and marks with them', async () => {
    for (const id of ['test-del-1', 'test-del-2']) {
      await store.create({
        id, groupId: 'test-g-del', deviceUdid: id.toUpperCase(), deviceHost: '127.0.0.1',
        filePath: `/tmp/${id}.mp4`, sessionId: null, deviceSnapshot: null,
      });
    }
    await store.addBookmark('test-del-1', 'x', 1);
    await store.addAnnotation('test-del-2', { timecodeMs: 1, shape: 'RECT', geometry: '{}', color: 'red' });
    expect(await store.deleteGroupRows('test-g-del')).to.equal(2);
    expect(await store.listGroup('test-g-del')).to.deep.equal([]);
    expect(await prisma.bookmark.count({ where: { recording_id: 'test-del-1' } })).to.equal(0);
    expect(await prisma.annotation.count({ where: { recording_id: 'test-del-2' } })).to.equal(0);
  });

  it('names users by name, then email', async () => {
    const names = await store.userNames([]);
    expect(names.size).to.equal(0);
  });
```

(`userNames` and `deviceNames` are thin `findMany` wrappers. Their mapping is tested in the router spec through a fake store; the DB round-trip above only proves the empty case doesn't query.)

`test/unit/recording-files.spec.ts`:

```ts
import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { recordingDirOf, removeRecordingFiles } from '../../src/services/recording/recordingFiles';

describe('recording file removal', () => {
  let base: string;
  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-files-'));
  });
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  const make = (...parts: string[]) => {
    const p = path.join(base, ...parts);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'x');
    return p;
  };

  it('finds a recording’s directory from its video path', () => {
    expect(recordingDirOf(path.join(base, 'abc', 'video', 'abc.mp4'))).to.equal(path.join(base, 'abc'));
  });

  it('removes each phone’s directory and the group’s composite directory', () => {
    const v1 = make('r1', 'video', 'r1.mp4');
    make('r1', 'annotations', 'a.png');
    make('r1', 'timing.json');
    const v2 = make('r2', 'video', 'r2.mp4');
    make('_groups', 'g1', 'composite.mp4');
    const keep = make('r3', 'video', 'r3.mp4');
    const removed = removeRecordingFiles([v1, v2], path.join(base, '_groups', 'g1'), base);
    expect(removed.sort()).to.deep.equal(
      [path.join(base, 'r1'), path.join(base, 'r2'), path.join(base, '_groups', 'g1')].sort(),
    );
    expect(fs.existsSync(path.join(base, 'r1'))).to.equal(false);
    expect(fs.existsSync(path.join(base, '_groups', 'g1'))).to.equal(false);
    expect(fs.existsSync(keep)).to.equal(true);
    expect(fs.existsSync(path.join(base, '_groups'))).to.equal(true);
  });

  it('refuses anything outside the recordings tree, the tree itself and _groups itself', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-outside-'));
    try {
      make('_groups', 'other', 'composite.mp4');
      const removed = removeRecordingFiles(
        ['/tmp/r.mp4', path.join(outside, 'video', 'x.mp4'), path.join(base, 'video', 'y.mp4')],
        path.join(base, '_groups'),
        base,
      );
      expect(removed).to.deep.equal([]);
      expect(fs.existsSync(outside)).to.equal(true);
      expect(fs.existsSync(path.join(base, '_groups', 'other'))).to.equal(true);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('skips directories that are already gone', () => {
    expect(removeRecordingFiles([path.join(base, 'nope', 'video', 'n.mp4')], path.join(base, '_groups', 'g9'), base)).to.deep.equal([]);
  });
});
```

- [ ] **Step 2: Run** `npx mocha test/unit/recording-store.spec.ts test/unit/recording-files.spec.ts`. It should FAIL.
- [ ] **Step 3: Implement.**

`recording-store.ts`, new methods:

```ts
  /** Every recording, with what the library lists: bookmark labels and a mark count. */
  async libraryRows() {
    return prisma.recording.findMany({
      include: {
        bookmarks: { select: { label: true } },
        _count: { select: { annotations: true } },
      },
    });
  }

  /** Delete a group's rows; bookmarks and annotations cascade. Returns how many went. */
  async deleteGroupRows(groupId: string): Promise<number> {
    const out = await prisma.recording.deleteMany({ where: { group_id: groupId } });
    return out.count;
  }

  /** What to call each device: its marketing name, else its own name. */
  async deviceNames(
    udids: string[],
  ): Promise<Map<string, { name: string; platform: string | null }>> {
    const out = new Map<string, { name: string; platform: string | null }>();
    if (udids.length === 0) return out;
    const rows = await prisma.device.findMany({
      where: { udid: { in: udids } },
      select: { udid: true, name: true, marketingName: true, platform: true },
    });
    rows.forEach((d) => {
      if (out.has(d.udid)) return;
      const name = d.marketingName?.trim() || (d.name && d.name !== 'unknown' ? d.name : d.udid);
      out.set(d.udid, { name, platform: d.platform && d.platform !== 'unknown' ? d.platform : null });
    });
    return out;
  }

  /** What to call each user: their name, else their email. */
  async userNames(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    const rows = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true },
    });
    rows.forEach((u) => out.set(u.id, u.name?.trim() || u.email));
    return out;
  }
```

(Check the Device model's `marketingName` field name in `prisma/schema.prisma`. It was added by migration `20260926120000_device_identity`.)

`src/services/recording/recordingFiles.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';

/**
 * `<recordings>/<id>/` for a video at `<recordings>/<id>/video/<file>.mp4`:
 * the directory that also holds the marks' images, timing.json and the
 * annotated-export cache. Derived from file_path, never from the row id —
 * see selectOrphanDirectories for why the id is not a safe key.
 */
export function recordingDirOf(videoFilePath: string): string {
  return path.dirname(path.dirname(videoFilePath));
}

/**
 * Remove a deleted group's files: each phone's recording directory and the
 * group's composite directory. Refuses anything that is not strictly inside
 * `base`, and the `_groups` parent itself. Best effort — a directory that
 * can't be removed is left for CleanupService's orphan sweep, which will find
 * no row pointing into it. Returns the directories removed.
 */
export function removeRecordingFiles(
  filePaths: string[],
  groupDir: string,
  base: string,
): string[] {
  const root = path.resolve(base);
  const groupsParent = path.join(root, '_groups');
  const targets = filePaths
    .filter(Boolean)
    .map(recordingDirOf)
    .concat(groupDir)
    .map((d) => path.resolve(d));
  const removed: string[] = [];
  Array.from(new Set(targets)).forEach((dir) => {
    if (!dir.startsWith(root + path.sep) || dir === groupsParent) return;
    if (!fs.existsSync(dir)) return;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    } catch {
      // Left for the orphan sweep.
    }
  });
  return removed;
}
```

There is one guard the test above doesn't cover. `path.join(base, 'video', 'y.mp4')` maps to `base` itself, which is refused because it isn't strictly inside `base`. The test includes that path.

- [ ] **Step 4: Run** both specs (they should PASS), plus tsc and eslint on the touched files: 0 for the new files, and the base count for `recording-store.ts` and its spec.
- [ ] **Step 5: Commit** `feat(recordings): store queries and guarded file removal for the library`.

---

### Task 4: Routes: list, detail, delete, source video

**Files:**
- Modify: `src/app/routers/recordings.ts`, `src/app/routers/recordingRequests.ts` (add `parseLibraryQuery`)
- Test: `test/unit/recordings-library-routes.spec.ts` (new), `test/unit/recording-requests.spec.ts` (add cases)

**Interfaces:**
- Consumes: Task 2's `buildLibrary`, `summarizeGroup`, `SummaryRow`, `Retention`, `SummaryContext`; Task 3's store methods and `removeRecordingFiles`; the existing `compositeOutputPath`, `readRecordingTiming`, `resolveActor`, `filterRowsByVisibleDevice`, `PluginContext` and `config.recordingsAssetsPath`.
- Produces the HTTP contract the dashboard uses:
  - `GET /xenon/api/recordings?limit&cursor&udid&startedBy&since&q` → `200 { recordings: RecordingSummary[], nextCursor: string|null, total: number, facets: LibraryFacets, retention: { days: number, maxCount: number } }`, or `400 { error }`.
  - `GET /xenon/api/recordings/:groupId` → `200 { groupId, recordings (unchanged), summary: RecordingSummary, bookmarks: [{ id, recordingId, timecodeMs, label, note }], annotations: [{ id, recordingId, timecodeMs, endTimecodeMs, shape, geometry, color, text }] }`, or `404 { error: 'not_found' }`. Bookmarks and annotations are sorted by `timecodeMs`.
  - `DELETE /xenon/api/recordings/:groupId` → `204`, `403 { error: 'not_owner' }`, `409 { error: 'recording_in_progress' }` or `404 { error: 'not_found' }`.
  - `GET /xenon/api/recordings/:groupId/source.mp4?recordingId=…[&download=1]` → the clean mp4 via `res.sendFile` (which honours `Range` and answers 206), `400` without `recordingId`, and `404` when the recording is missing, belongs to another group, is invisible, or its file is gone.

- [ ] **Step 1: Failing tests.**

`recording-requests.spec.ts`, add:

```ts
describe('parseLibraryQuery', () => {
  it('reads the filters and a bounded limit', () => {
    const out = parseLibraryQuery({ limit: '10', cursor: 'c', udid: 'U1', startedBy: 'unknown', since: '2026-09-20T00:00:00Z', q: ' pay ' });
    expect(out).to.deep.equal({
      ok: true,
      limit: 10,
      cursor: 'c',
      filter: { udid: 'U1', startedBy: 'unknown', since: Date.parse('2026-09-20T00:00:00Z'), q: 'pay' },
    });
    expect((parseLibraryQuery({}) as any).limit).to.equal(50);
    expect((parseLibraryQuery({ limit: '999' }) as any).limit).to.equal(200);
  });

  it('refuses a bad limit or time', () => {
    expect(parseLibraryQuery({ limit: '0' })).to.deep.equal({ ok: false, error: 'limit must be a whole number from 1' });
    expect(parseLibraryQuery({ limit: 'x' })).to.deep.equal({ ok: false, error: 'limit must be a whole number from 1' });
    expect(parseLibraryQuery({ since: 'yesterday' })).to.deep.equal({ ok: false, error: 'since must be an ISO time' });
  });
});
```

`test/unit/recordings-library-routes.spec.ts` builds the app like `test/unit/stream-stop-recording.spec.ts`: an injected `req.auth`, then `RecordingsRouter.register(apiRouter)` mounted at `/xenon/api`. Put every hook inside the `describe`.

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Container } from 'typedi';
import RecordingsRouter from '../../src/app/routers/recordings';
import { RecordingStore } from '../../src/services/recording/recording-store';
import * as deviceService from '../../src/data-service/device-service';
import * as recordingFiles from '../../src/services/recording/recordingFiles';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import { useArtifactStore } from '../helpers/artifact-store';

type Role = 'MEMBER' | 'ADMIN' | 'SUPER_ADMIN';
const T0 = Date.parse('2026-09-20T10:00:00.000Z');

function rec(over: any = {}) {
  return {
    id: 'r1', group_id: 'g1', device_udid: 'U1', device_host: '127.0.0.1', session_id: null,
    status: 'STOPPED', started_at: new Date(T0), ended_at: new Date(T0 + 60_000),
    duration_ms: 60_000, size_bytes: 10, fail_reason: null, started_by: 'usr_alice',
    file_path: '/nonexistent/r1/video/r1.mp4', device_snapshot: null,
    bookmarks: [], annotations: [], _count: { annotations: 0 },
    ...over,
  };
}

function buildApp(caller: { userId: string; role?: Role; teamIds?: string[] }) {
  const app = express();
  app.use(express.json());
  const api = express.Router();
  api.use((req, _res, next) => {
    const role = caller.role ?? 'MEMBER';
    (req as any).auth = {
      kind: 'user-session', userId: caller.userId, role, scopes: scopesForRole(role),
      teamIds: caller.teamIds, rateLimit: 100,
    };
    next();
  });
  RecordingsRouter.register(api);
  app.use('/xenon/api', api);
  return app;
}

describe('recordings library routes', () => {
  useArtifactStore();
  let rows: any[];
  let visible: Set<string>;
  let store: any;
  let remove: sinon.SinonStub;

  beforeEach(() => {
    rows = [];
    visible = new Set(['U1', 'U2']);
    store = {
      libraryRows: async () => rows,
      listGroup: async (g: string) => rows.filter((r) => r.group_id === g),
      findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
      deleteGroupRows: sinon.stub().callsFake(async (g: string) => {
        const n = rows.filter((r) => r.group_id === g).length;
        rows = rows.filter((r) => r.group_id !== g);
        return n;
      }),
      deviceNames: async () => new Map([['U1', { name: 'Galaxy S9+', platform: 'android' }]]),
      userNames: async () => new Map([['usr_alice', 'Alice']]),
    };
    Container.set(RecordingStore, store);
    sinon.stub(deviceService, 'filterRowsByVisibleDevice').callsFake(async (list: any[], teamIds: any) =>
      teamIds === undefined ? list : list.filter((r) => visible.has(r.device_udid)),
    );
    remove = sinon.stub(recordingFiles, 'removeRecordingFiles').returns([]);
  });

  afterEach(() => {
    sinon.restore();
    Container.remove(RecordingStore);
  });

  const alice = { userId: 'usr_alice', teamIds: ['t1'] };
  const bob = { userId: 'usr_bob', teamIds: ['t1'] };
  const admin = { userId: 'usr_root', role: 'ADMIN' as Role };

  describe('GET /recordings', () => {
    it('lists visible groups, newest first, with retention', async () => {
      rows = [
        rec({ id: 'a', group_id: 'g1' }),
        rec({ id: 'b', group_id: 'g2', started_at: new Date(T0 + 1000) }),
        rec({ id: 'c', group_id: 'g3', device_udid: 'HIDDEN' }),
      ];
      const res = await request(buildApp(alice)).get('/xenon/api/recordings');
      expect(res.status, JSON.stringify(res.body)).to.equal(200);
      expect(res.body.recordings.map((s: any) => s.groupId)).to.deep.equal(['g2', 'g1']);
      expect(res.body.recordings[0].phones[0].name).to.equal('Galaxy S9+');
      expect(res.body.recordings[0].startedBy).to.deep.equal({ id: 'usr_alice', name: 'Alice' });
      expect(res.body.total).to.equal(2);
      expect(res.body.retention).to.deep.equal({ days: 30, maxCount: 100 });
    });

    it('passes the filters and the page through', async () => {
      rows = [rec({ id: 'a', group_id: 'g1' }), rec({ id: 'b', group_id: 'g2', device_udid: 'U2', started_at: new Date(T0 + 1000) })];
      const one = await request(buildApp(alice)).get('/xenon/api/recordings?limit=1');
      expect(one.body.recordings.map((s: any) => s.groupId)).to.deep.equal(['g2']);
      const two = await request(buildApp(alice)).get(`/xenon/api/recordings?limit=1&cursor=${encodeURIComponent(one.body.nextCursor)}`);
      expect(two.body.recordings.map((s: any) => s.groupId)).to.deep.equal(['g1']);
      const byPhone = await request(buildApp(alice)).get('/xenon/api/recordings?udid=U2');
      expect(byPhone.body.recordings.map((s: any) => s.groupId)).to.deep.equal(['g2']);
    });

    it('answers 400 for a bad query', async () => {
      const res = await request(buildApp(alice)).get('/xenon/api/recordings?since=nope');
      expect(res.status).to.equal(400);
      expect(res.body.error).to.equal('since must be an ISO time');
    });
  });

  describe('GET /recordings/:groupId', () => {
    it('adds the summary, and bookmarks and marks with their recording', async () => {
      rows = [
        rec({
          bookmarks: [{ id: 'b1', recording_id: 'r1', timecode_ms: 4000, label: 'Pay', note: null }],
          annotations: [{ id: 'a1', recording_id: 'r1', timecode_ms: 2000, end_timecode_ms: 3000, shape: 'RECT', geometry: '{"x":0.1,"y":0.1,"w":0.2,"h":0.2}', color: 'red', text: null }],
        }),
      ];
      const res = await request(buildApp(alice)).get('/xenon/api/recordings/g1');
      expect(res.status).to.equal(200);
      expect(res.body.summary.groupId).to.equal('g1');
      expect(res.body.recordings).to.have.length(1);
      expect(res.body.bookmarks).to.deep.equal([{ id: 'b1', recordingId: 'r1', timecodeMs: 4000, label: 'Pay', note: null }]);
      expect(res.body.annotations[0]).to.deep.include({ id: 'a1', recordingId: 'r1', timecodeMs: 2000, endTimecodeMs: 3000, shape: 'RECT' });
    });

    it('answers 404 for a group that does not exist or is not visible', async () => {
      expect((await request(buildApp(admin)).get('/xenon/api/recordings/nope')).status).to.equal(404);
      rows = [rec({ device_udid: 'HIDDEN' })];
      expect((await request(buildApp(alice)).get('/xenon/api/recordings/g1')).status).to.equal(404);
    });
  });

  describe('DELETE /recordings/:groupId', () => {
    const del = (who: any) => request(buildApp(who)).delete('/xenon/api/recordings/g1');

    it('lets the person who recorded it delete it: rows, then files', async () => {
      rows = [rec(), rec({ id: 'r2', device_udid: 'U2', file_path: '/nonexistent/r2/video/r2.mp4' })];
      const res = await del(alice);
      expect(res.status, JSON.stringify(res.body)).to.equal(204);
      expect(store.deleteGroupRows.calledOnceWith('g1')).to.equal(true);
      expect(remove.calledOnce).to.equal(true);
      expect(remove.firstCall.args[0]).to.deep.equal(['/nonexistent/r1/video/r1.mp4', '/nonexistent/r2/video/r2.mp4']);
      expect(remove.firstCall.args[1]).to.match(/_groups[\\/]g1$/);
      expect(store.deleteGroupRows.calledBefore(remove)).to.equal(true);
    });

    it('lets an admin delete anyone’s', async () => {
      rows = [rec()];
      expect((await del(admin)).status).to.equal(204);
    });

    it('refuses someone else with 403 not_owner', async () => {
      rows = [rec()];
      const res = await del(bob);
      expect(res.status).to.equal(403);
      expect(res.body.error).to.equal('not_owner');
      expect(store.deleteGroupRows.called).to.equal(false);
    });

    it('keeps a recording with no known owner for admins', async () => {
      rows = [rec({ started_by: null })];
      expect((await del(alice)).status).to.equal(403);
      expect((await del(admin)).status).to.equal(204);
    });

    it('refuses a running recording with 409, even to its owner', async () => {
      rows = [rec({ status: 'RECORDING', ended_at: null, duration_ms: null })];
      const res = await del(alice);
      expect(res.status).to.equal(409);
      expect(res.body.error).to.equal('recording_in_progress');
    });

    it('answers 404 for a group the caller cannot see, or that is gone', async () => {
      rows = [rec({ device_udid: 'HIDDEN' })];
      expect((await del(alice)).status).to.equal(404);
      rows = [];
      expect((await del(admin)).status).to.equal(404);
    });
  });

  describe('GET /recordings/:groupId/source.mp4', () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-src-'));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('streams the clean video with range support', async () => {
      const file = path.join(dir, 'r1.mp4');
      fs.writeFileSync(file, Buffer.from('0123456789'));
      rows = [rec({ file_path: file })];
      const res = await request(buildApp(alice))
        .get('/xenon/api/recordings/g1/source.mp4?recordingId=r1')
        .set('Range', 'bytes=2-5')
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).to.equal(206);
      expect(res.headers['content-type']).to.match(/video\/mp4/);
      expect(res.body.toString()).to.equal('2345');
      expect(res.headers['content-disposition']).to.equal(undefined);
    });

    it('serves it as an attachment for download', async () => {
      const file = path.join(dir, 'r1.mp4');
      fs.writeFileSync(file, 'x');
      rows = [rec({ file_path: file })];
      const res = await request(buildApp(alice)).get('/xenon/api/recordings/g1/source.mp4?recordingId=r1&download=1');
      expect(res.status).to.equal(200);
      expect(res.headers['content-disposition']).to.match(/attachment; filename="U1\.mp4"/);
    });

    it('answers 400 without a recording, and 404 for another group, an invisible phone or a missing file', async () => {
      rows = [rec(), rec({ id: 'rx', group_id: 'g2' }), rec({ id: 'rh', device_udid: 'HIDDEN' })];
      const get = (q: string) => request(buildApp(alice)).get(`/xenon/api/recordings/g1/source.mp4${q}`);
      expect((await get('')).status).to.equal(400);
      expect((await get('?recordingId=rx')).status).to.equal(404);
      expect((await get('?recordingId=rh')).status).to.equal(404);
      expect((await get('?recordingId=r1')).status).to.equal(404);
    });
  });
});
```

- [ ] **Step 2: Run** `npx mocha test/unit/recording-requests.spec.ts test/unit/recordings-library-routes.spec.ts`. It should FAIL.
- [ ] **Step 3: Implement.**

`recordingRequests.ts`, add:

```ts
import type { LibraryFilter } from '../../services/recording/recordingSummary';

const DEFAULT_LIBRARY_LIMIT = 50;
const MAX_LIBRARY_LIMIT = 200;

/** GET /recordings's query: filters, a bounded page size and the cursor. */
export function parseLibraryQuery(
  q: Record<string, unknown>,
): { ok: true; limit: number; cursor?: string; filter: LibraryFilter } | { ok: false; error: string } {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
  let limit = DEFAULT_LIBRARY_LIMIT;
  if (q.limit !== undefined) {
    const n = Number(q.limit);
    if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'limit must be a whole number from 1' };
    limit = Math.min(n, MAX_LIBRARY_LIMIT);
  }
  let since: number | undefined;
  const s = str(q.since);
  if (s !== undefined) {
    since = Date.parse(s);
    if (!Number.isFinite(since)) return { ok: false, error: 'since must be an ISO time' };
  }
  const filter: LibraryFilter = {};
  if (str(q.udid)) filter.udid = str(q.udid);
  if (str(q.startedBy)) filter.startedBy = str(q.startedBy);
  if (since !== undefined) filter.since = since;
  if (str(q.q)) filter.q = str(q.q);
  const out: { ok: true; limit: number; cursor?: string; filter: LibraryFilter } = { ok: true, limit, filter };
  if (str(q.cursor)) out.cursor = str(q.cursor);
  return out;
}
```

Match the deep-equal in the test: keys absent when unset, `cursor` only when given.

`recordings.ts` changes:
1. **Imports:** `path`; `summarizeGroup`, `buildLibrary`, `type SummaryRow`, `type SummaryContext`, `type Retention` from `recordingSummary`; `removeRecordingFiles` from `recordingFiles`; `parseLibraryQuery` from `./recordingRequests`; `PluginContext` (import it the way `control.ts` does); `config` (import it the way `CleanupService.ts` does). Call `removeRecordingFiles` through the module so the spec's stub takes effect: `import * as recordingFiles from '../../services/recording/recordingFiles'`, then `recordingFiles.removeRecordingFiles(...)`. Do the same for `filterRowsByVisibleDevice`: change the existing named import to `import * as deviceService from '../../data-service/device-service'` and call `deviceService.filterRowsByVisibleDevice(...)` everywhere in the file. That includes `isGroupVisibleToAuth`, whose behaviour must stay unchanged.
2. **Helpers** above the routes:

```ts
type AuthLike = { teamIds?: string[] };
const authOf = (req: Request) => (req as Request & { auth?: AuthLike }).auth;

/** CleanupService's defaults, so the page's footnote says what the sweep does. */
function retention(): Retention {
  const a = Container.get(PluginContext).pluginArgs ?? {};
  return {
    days: a.recordingCleanupDays ?? 30,
    failedDays: a.recordingFailedCleanupDays ?? 2,
    maxCount: a.recordingCleanupMaxCount ?? 100,
  };
}

function toSummaryRow(r: any): SummaryRow {
  return {
    id: r.id,
    group_id: r.group_id,
    device_udid: r.device_udid,
    status: r.status,
    started_at: new Date(r.started_at),
    ended_at: r.ended_at ? new Date(r.ended_at) : null,
    duration_ms: r.duration_ms ?? null,
    size_bytes: r.size_bytes ?? null,
    fail_reason: r.fail_reason ?? null,
    started_by: r.started_by ?? null,
    timing: r.file_path ? readRecordingTiming(r.file_path) : undefined,
    bookmarkLabels: (r.bookmarks ?? []).map((b: { label: string }) => b.label),
    annotationCount: r._count?.annotations ?? (r.annotations ?? []).length,
  };
}

async function summaryContext(rows: any[]): Promise<SummaryContext> {
  const store = Container.get(RecordingStore);
  const udids = Array.from(new Set(rows.map((r) => r.device_udid as string)));
  const users = Array.from(
    new Set(rows.map((r) => r.started_by as string | null).filter((u): u is string => !!u)),
  );
  return {
    devices: await store.deviceNames(udids),
    users: await store.userNames(users),
    retention: retention(),
    hasComposite: (g) => fs.existsSync(compositeOutputPath(g)),
  };
}
```

3. **`GET /recordings`**, registered right after the router's `router.use(roleGuard('MEMBER'))`:

```ts
router.get('/recordings', async (req: Request, res: Response) => {
  const parsed = parseLibraryQuery(req.query as Record<string, unknown>);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const rows = await Container.get(RecordingStore).libraryRows();
    const visible = await deviceService.filterRowsByVisibleDevice(rows, authOf(req)?.teamIds, 'device_udid');
    const ctx = await summaryContext(visible);
    const page = buildLibrary(visible.map(toSummaryRow), ctx, parsed.filter, {
      limit: parsed.limit,
      cursor: parsed.cursor,
      now: Date.now(),
    });
    return res.json({ ...page, retention: { days: ctx.retention.days, maxCount: ctx.retention.maxCount } });
  } catch (e: any) {
    recLog.error(`GET /recordings failed: ${e?.message}`);
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
});
```

4. **`GET /recordings/:groupId`**, in place of the current handler:

```ts
router.get('/recordings/:groupId', async (req: Request, res: Response) => {
  try {
    const recs = await Container.get(RecordingStore).listGroup(req.params.groupId);
    const visibleRecs = await deviceService.filterRowsByVisibleDevice(recs, authOf(req)?.teamIds, 'device_udid');
    if (visibleRecs.length === 0) return res.status(404).json({ error: 'not_found' });
    const summary = summarizeGroup(visibleRecs.map(toSummaryRow), await summaryContext(visibleRecs));
    const bookmarks = visibleRecs
      .reduce<any[]>((acc, r: any) =>
        acc.concat((r.bookmarks ?? []).map((b: any) => ({
          id: b.id, recordingId: r.id, timecodeMs: b.timecode_ms, label: b.label, note: b.note ?? null,
        }))), [])
      .sort((a, b) => a.timecodeMs - b.timecodeMs);
    const annotations = visibleRecs
      .reduce<any[]>((acc, r: any) =>
        acc.concat((r.annotations ?? []).map((a: any) => ({
          id: a.id, recordingId: r.id, timecodeMs: a.timecode_ms, endTimecodeMs: a.end_timecode_ms ?? null,
          shape: a.shape, geometry: a.geometry, color: a.color, text: a.text ?? null,
        }))), [])
      .sort((a, b) => a.timecodeMs - b.timecodeMs);
    return res.json({ groupId: req.params.groupId, recordings: visibleRecs, summary, bookmarks, annotations });
  } catch (e: any) {
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
});
```

5. **`DELETE /recordings/:groupId`:**

```ts
router.delete('/recordings/:groupId', async (req: Request, res: Response) => {
  const { groupId } = req.params;
  try {
    const store = Container.get(RecordingStore);
    const recs: any[] = await store.listGroup(groupId);
    const visible = await deviceService.filterRowsByVisibleDevice(recs, authOf(req)?.teamIds, 'device_udid');
    if (visible.length === 0) return res.status(404).json({ error: 'not_found' });
    if (recs.some((r) => r.status === 'RECORDING')) {
      return res.status(409).json({
        error: 'recording_in_progress',
        message: 'Stop the recording on Live devices before deleting it.',
      });
    }
    const owner = recs
      .slice()
      .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
      .find((r) => r.started_by)?.started_by;
    const actor = resolveActor(req);
    if (!actor.isAdmin && (!owner || owner !== actor.userId)) {
      return res.status(403).json({
        error: 'not_owner',
        message: 'Only the person who recorded it, or an admin, can delete it.',
      });
    }
    // Rows first: if removing a file fails, no row points at it and the
    // orphan sweep reclaims it; the reverse would leave rows with no videos.
    await store.deleteGroupRows(groupId);
    const removed = recordingFiles.removeRecordingFiles(
      recs.map((r) => r.file_path),
      path.dirname(compositeOutputPath(groupId)),
      config.recordingsAssetsPath,
    );
    recLog.info(`Deleted recording ${groupId} (${recs.length} video(s), ${removed.length} dir(s)) for ${actor.userId}`);
    return res.status(204).end();
  } catch (e: any) {
    recLog.error(`DELETE /recordings/:groupId failed: ${e?.message}`);
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
});
```

6. **`GET /recordings/:groupId/source.mp4`**, registered before any other `/:groupId/...` catch. It can sit beside `video.mp4`:

```ts
/**
 * The clean video, for the recording page's player: no burned-in marks (the
 * page draws them), and Range support so it can seek. `download=1` makes it
 * an attachment — the per-phone "Video" download.
 */
router.get('/recordings/:groupId/source.mp4', async (req: Request, res: Response) => {
  const recordingId = typeof req.query.recordingId === 'string' ? req.query.recordingId : '';
  if (!recordingId) return res.status(400).json({ error: 'recordingId query param is required' });
  try {
    const rec: any = await Container.get(RecordingStore).findById(recordingId);
    if (!rec || rec.group_id !== req.params.groupId) return res.status(404).json({ error: 'not_found' });
    const visible = await deviceService.filterRowsByVisibleDevice([rec], authOf(req)?.teamIds, 'device_udid');
    if (visible.length === 0) return res.status(404).json({ error: 'not_found' });
    if (!rec.file_path || !fs.existsSync(rec.file_path)) {
      return res.status(404).json({ error: 'video_not_found' });
    }
    if (req.query.download === '1') {
      const stem = String(rec.device_udid).replace(/[^A-Za-z0-9._-]/g, '_');
      res.setHeader('Content-Disposition', `attachment; filename="${stem}.mp4"`);
    }
    return res.sendFile(path.resolve(rec.file_path), { headers: { 'Content-Type': 'video/mp4' } }, (err) => {
      if (err && !res.headersSent) res.status(500).json({ error: 'internal', message: err.message });
    });
  } catch (e: any) {
    recLog.error(`source.mp4 failed: ${e?.message}`);
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
});
```

`res.sendFile` needs an absolute path, answers `Range` with 206 and sets `Accept-Ranges`. Keep the existing `video.mp4`, `videos.zip`, `bundle.zip`, `composite.mp4` and `exports/annotated.mp4` routes as they are.

- [ ] **Step 4: Run** both specs (they should PASS). Then run the whole recordings area: `npx mocha test/unit/recording-*.spec.ts test/unit/recordings-*.spec.ts test/unit/active-recordings.spec.ts test/unit/stream-stop-recording.spec.ts`. Then `npx tsc --noEmit -p . ; echo tsc=$?` (expect 0), and eslint on `recordings.ts`, `recordingRequests.ts` and the specs (≤ the base count; 0 for the new spec).
- [ ] **Step 5: Commit** `feat(recordings): list, detail, delete and a seekable video for the library`.

---

### Task 5: Dashboard rules (pure) and the API client

**Files:**
- Modify: `web/src/api-service/recordings.ts`
- Create: `web/src/components/recordings/playback.ts`, `web/src/components/recordings/libraryFilters.ts`, `web/src/components/recordings/recordingActions.ts`
- Test: `web/src/api-service/recordings.test.ts`, `web/src/components/recordings/playback.test.ts`, `web/src/components/recordings/libraryFilters.test.ts`, `web/src/components/recordings/recordingActions.test.ts`

**Interfaces (produces):**

```ts
// api-service/recordings.ts (additions)
export type GroupStatus = 'recording' | 'done' | 'failed';
export interface PhoneSummary { recordingId: string; udid: string; name: string; platform: string | null; status: string; offsetMs: number; durationMs: number | null; failReason: string | null; annotationCount: number }
export interface RecordingSummary { groupId: string; startedAt: string; endedAt: string | null; durationMs: number | null; status: GroupStatus; phones: PhoneSummary[]; startedBy: { id: string; name: string } | null; bookmarkCount: number; annotationCount: number; keptUntil: string; sizeBytes: number; hasComposite: boolean }
export interface LibraryFacets { phones: Array<{ udid: string; name: string; count: number }>; people: Array<{ id: string; name: string; count: number }>; unknownCount: number; when: { any: number; '24h': number; '7d': number; '30d': number } }
export interface LibraryResponse { recordings: RecordingSummary[]; nextCursor: string | null; total: number; facets: LibraryFacets; retention: { days: number; maxCount: number } }
export interface LibraryQuery { udid?: string; startedBy?: string; since?: string; q?: string; cursor?: string; limit?: number }
export interface GroupBookmark { id: string; recordingId: string; timecodeMs: number; label: string; note: string | null }
export interface GroupAnnotation { id: string; recordingId: string; timecodeMs: number; endTimecodeMs: number | null; shape: string; geometry: string; color: string; text: string | null }
export interface RecordingDetail { groupId: string; summary: RecordingSummary; bookmarks: GroupBookmark[]; annotations: GroupAnnotation[] }
export class RecordingRequestError extends Error { readonly status: number; readonly code?: string }
export function listRecordings(q?: LibraryQuery): Promise<LibraryResponse>;
export function getRecording(groupId: string): Promise<RecordingDetail>;
export function deleteRecording(groupId: string): Promise<void>;
export function sourceMp4Url(groupId: string, recordingId: string, download?: boolean): string;
// playback.ts
export function formatClock(ms: number): string;
export type TilePhase = 'before' | 'playing' | 'after';
export function tilePhase(groupMs: number, offsetMs: number, durationMs: number | null): TilePhase;
export function videoTimeMs(groupMs: number, offsetMs: number): number;
export const RESYNC_MS = 250;
export function needsResync(actualMs: number, expectedMs: number): boolean;
export function positionPct(ms: number, durationMs: number): number;
export function visibleAt<T extends { timecodeMs: number; endTimecodeMs: number | null }>(list: T[], groupMs: number): T[];
export function toOverlay(a: GroupAnnotation): OverlayAnnotation | null;
export const SKIP_MS = 5000;
export function clampTime(ms: number, durationMs: number): number;
// libraryFilters.ts
export type WhenFilter = 'any' | '24h' | '7d' | '30d';
export interface LibraryFilters { phone: string; by: string; when: WhenFilter; q: string }
export const NO_LIBRARY_FILTERS: LibraryFilters;
export const WHEN_LABEL: Record<WhenFilter, string>;
export function parseLibraryFilters(params: URLSearchParams): LibraryFilters;
export function libraryFiltersToParams(f: LibraryFilters): URLSearchParams;
export function isLibraryFiltered(f: LibraryFilters): boolean;
export function libraryQuery(f: LibraryFilters, now: number): LibraryQuery;
// recordingActions.ts
export interface DownloadItem { key: string; label: string; url: string }
export function downloadItems(summary: RecordingSummary): DownloadItem[];
export function canDelete(summary: RecordingSummary, me: { userId?: string | null; role?: string | null } | null): boolean;
export function deleteErrorMessage(e: unknown): string;
export function startDownload(url: string): void;
```

- [ ] **Step 1: Failing tests.**

`web/src/components/recordings/playback.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  clampTime, formatClock, needsResync, positionPct, tilePhase, toOverlay, videoTimeMs, visibleAt,
} from './playback';

describe('playback rules', () => {
  it('formats a clock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(42_900)).toBe('0:42');
    expect(formatClock(252_000)).toBe('4:12');
    expect(formatClock(3_723_000)).toBe('1:02:03');
    expect(formatClock(-5)).toBe('0:00');
  });

  it('places a phone before, inside or after its video', () => {
    expect(tilePhase(10_000, 42_000, 20_000)).toBe('before');
    expect(tilePhase(42_000, 42_000, 20_000)).toBe('playing');
    expect(tilePhase(62_000, 42_000, 20_000)).toBe('after');
    expect(tilePhase(0, -1000, null)).toBe('playing');
    expect(videoTimeMs(50_000, 42_000)).toBe(8000);
    expect(videoTimeMs(0, -1000)).toBe(1000);
  });

  it('resyncs only past 250 ms of drift', () => {
    expect(needsResync(1000, 1250)).toBe(false);
    expect(needsResync(1000, 1251)).toBe(true);
    expect(needsResync(1300, 1000)).toBe(true);
  });

  it('positions a time on the timeline, clamped', () => {
    expect(positionPct(30_000, 120_000)).toBe(25);
    expect(positionPct(200_000, 120_000)).toBe(100);
    expect(positionPct(5, 0)).toBe(0);
    expect(clampTime(-3, 100)).toBe(0);
    expect(clampTime(300, 100)).toBe(100);
  });

  it('shows a mark from its time until its end, or to the end when it has none', () => {
    const marks = [
      { id: 'a', timecodeMs: 1000, endTimecodeMs: 3000 },
      { id: 'b', timecodeMs: 2000, endTimecodeMs: null },
    ];
    expect(visibleAt(marks, 999).map((m) => m.id)).toEqual([]);
    expect(visibleAt(marks, 1000).map((m) => m.id)).toEqual(['a']);
    expect(visibleAt(marks, 2500).map((m) => m.id)).toEqual(['a', 'b']);
    expect(visibleAt(marks, 3000).map((m) => m.id)).toEqual(['b']);
  });

  it('turns a stored mark into an overlay mark, skipping bad geometry', () => {
    const base = { id: 'a', recordingId: 'r', timecodeMs: 0, endTimecodeMs: null, shape: 'RECT', color: 'red', text: null };
    expect(toOverlay({ ...base, geometry: '{"x":0.1,"y":0.2,"w":0.3,"h":0.4}' })).toEqual({
      shape: 'RECT', color: 'red', geometry: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, text: undefined,
    });
    expect(toOverlay({ ...base, geometry: 'not json' })).toBeNull();
    expect(toOverlay({ ...base, geometry: '{"w":1}' })).toBeNull();
  });
});
```

`libraryFilters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  isLibraryFiltered, libraryFiltersToParams, libraryQuery, NO_LIBRARY_FILTERS, parseLibraryFilters,
} from './libraryFilters';

describe('library filters', () => {
  it('reads and writes the link', () => {
    const f = parseLibraryFilters(new URLSearchParams('phone=U1&by=unknown&when=7d&q=pay'));
    expect(f).toEqual({ phone: 'U1', by: 'unknown', when: '7d', q: 'pay' });
    expect(libraryFiltersToParams(f).toString()).toBe('phone=U1&by=unknown&when=7d&q=pay');
    expect(parseLibraryFilters(new URLSearchParams('when=forever'))).toEqual(NO_LIBRARY_FILTERS);
    expect(libraryFiltersToParams(NO_LIBRARY_FILTERS).toString()).toBe('');
  });

  it('knows when anything is filtered', () => {
    expect(isLibraryFiltered(NO_LIBRARY_FILTERS)).toBe(false);
    expect(isLibraryFiltered({ ...NO_LIBRARY_FILTERS, q: '  ' })).toBe(false);
    expect(isLibraryFiltered({ ...NO_LIBRARY_FILTERS, when: '24h' })).toBe(true);
  });

  it('builds the server query, with When as a start time', () => {
    const now = Date.parse('2026-09-27T12:00:00.000Z');
    expect(libraryQuery({ phone: 'U1', by: '', when: '24h', q: ' pay ' }, now)).toEqual({
      udid: 'U1', startedBy: undefined, since: '2026-09-26T12:00:00.000Z', q: 'pay',
    });
    expect(libraryQuery(NO_LIBRARY_FILTERS, now)).toEqual({
      udid: undefined, startedBy: undefined, since: undefined, q: undefined,
    });
  });
});
```

`recordingActions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { RecordingSummary } from '../../api-service/recordings';
import { RecordingRequestError } from '../../api-service/recordings';
import { canDelete, deleteErrorMessage, downloadItems } from './recordingActions';

const summary = (over: Partial<RecordingSummary> = {}): RecordingSummary => ({
  groupId: 'g1', startedAt: '2026-09-27T10:00:00.000Z', endedAt: '2026-09-27T10:04:12.000Z',
  durationMs: 252_000, status: 'done',
  phones: [
    { recordingId: 'r1', udid: 'U1', name: 'Galaxy S9+', platform: 'android', status: 'STOPPED', offsetMs: 0, durationMs: 252_000, failReason: null, annotationCount: 2 },
    { recordingId: 'r2', udid: 'U2', name: 'iPhone 17', platform: 'ios', status: 'STOPPED', offsetMs: 42_000, durationMs: 200_000, failReason: null, annotationCount: 0 },
    { recordingId: 'r3', udid: 'U3', name: 'Pixel', platform: 'android', status: 'FAILED', offsetMs: 0, durationMs: null, failReason: 'no frames', annotationCount: 0 },
  ],
  startedBy: { id: 'usr_alice', name: 'Alice' }, bookmarkCount: 1, annotationCount: 2,
  keptUntil: '2026-10-27T10:00:00.000Z', sizeBytes: 100, hasComposite: true, ...over,
});

describe('recording actions', () => {
  it('offers the group downloads, and per phone the video and, with marks, the annotated one', () => {
    expect(downloadItems(summary()).map((i) => [i.label, i.url])).toEqual([
      ['All videos (zip)', '/xenon/api/recordings/g1/videos.zip'],
      ['Side-by-side video', '/xenon/api/recordings/g1/composite.mp4'],
      ['Proof bundle', '/xenon/api/recordings/g1/bundle.zip'],
      ['Galaxy S9+: video', '/xenon/api/recordings/g1/source.mp4?recordingId=r1&download=1'],
      ['Galaxy S9+: video with annotations', '/xenon/api/recordings/g1/exports/annotated.mp4?recordingId=r1'],
      ['iPhone 17: video', '/xenon/api/recordings/g1/source.mp4?recordingId=r2&download=1'],
    ]);
    expect(downloadItems(summary({ hasComposite: false })).map((i) => i.key)).not.toContain('composite');
  });

  it('lets the person who recorded it, or an admin, delete', () => {
    expect(canDelete(summary(), { userId: 'usr_alice', role: 'MEMBER' })).toBe(true);
    expect(canDelete(summary(), { userId: 'usr_bob', role: 'MEMBER' })).toBe(false);
    expect(canDelete(summary(), { userId: 'usr_bob', role: 'ADMIN' })).toBe(true);
    expect(canDelete(summary(), { userId: 'usr_bob', role: 'SUPER_ADMIN' })).toBe(true);
    expect(canDelete(summary({ startedBy: null }), { userId: 'usr_alice', role: 'MEMBER' })).toBe(false);
    expect(canDelete(summary(), null)).toBe(false);
  });

  it('says why a delete failed', () => {
    expect(deleteErrorMessage(new RecordingRequestError(403, 'not_owner'))).toBe(
      'Only the person who recorded it, or an admin, can delete it.',
    );
    expect(deleteErrorMessage(new RecordingRequestError(409, 'recording_in_progress'))).toBe(
      'It’s still recording. Stop it on Live devices first.',
    );
    expect(deleteErrorMessage(new RecordingRequestError(404, 'not_found'))).toBe(
      'It was already deleted, or it’s on phones you can’t see.',
    );
    expect(deleteErrorMessage(new Error('boom'))).toBe('Couldn’t delete the recording: boom');
  });
});
```

`web/src/api-service/recordings.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteRecording, getRecording, listRecordings, RecordingRequestError, sourceMp4Url } from './recordings';

const reply = (status: number, body?: unknown) =>
  vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });

describe('recordings library API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists with only the filters that are set', async () => {
    const f = reply(200, { recordings: [] });
    vi.stubGlobal('fetch', f);
    await listRecordings({ udid: 'U1', q: '', cursor: 'c1', limit: 50 });
    expect(f).toHaveBeenCalledWith('/xenon/api/recordings?udid=U1&cursor=c1&limit=50');
    await listRecordings();
    expect(f).toHaveBeenLastCalledWith('/xenon/api/recordings');
  });

  it('turns a refusal into a RecordingRequestError with its code', async () => {
    vi.stubGlobal('fetch', reply(404, { error: 'not_found' }));
    await expect(getRecording('g1')).rejects.toMatchObject({ status: 404, code: 'not_found' });
    vi.stubGlobal('fetch', reply(403, { error: 'not_owner' }));
    const err = await deleteRecording('g1').catch((e) => e);
    expect(err).toBeInstanceOf(RecordingRequestError);
    expect(err.code).toBe('not_owner');
  });

  it('deletes with DELETE', async () => {
    const f = reply(204);
    vi.stubGlobal('fetch', f);
    await deleteRecording('g 1');
    expect(f).toHaveBeenCalledWith('/xenon/api/recordings/g%201', { method: 'DELETE' });
  });

  it('builds the player’s and the download’s video URLs', () => {
    expect(sourceMp4Url('g1', 'r1')).toBe('/xenon/api/recordings/g1/source.mp4?recordingId=r1');
    expect(sourceMp4Url('g1', 'r1', true)).toBe('/xenon/api/recordings/g1/source.mp4?recordingId=r1&download=1');
  });
});
```

- [ ] **Step 2: Run** from `web/`: `npx vitest run src/components/recordings src/api-service/recordings.test.ts`. It should FAIL.
- [ ] **Step 3: Implement.**

**`web/src/api-service/recordings.ts`:** append the types from the Interfaces block, then:

```ts
/** A request the server refused; `code` is its `error` field when it sent one. */
export class RecordingRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(code ?? `HTTP ${status}`);
  }
}

async function refusal(r: Response): Promise<RecordingRequestError> {
  let code: string | undefined;
  try {
    code = (await r.json())?.error;
  } catch {
    // Not JSON.
  }
  return new RecordingRequestError(r.status, code);
}

export async function listRecordings(q: LibraryQuery = {}): Promise<LibraryResponse> {
  const params = new URLSearchParams();
  (Object.keys(q) as Array<keyof LibraryQuery>).forEach((k) => {
    const v = q[k];
    if (v !== undefined && v !== '') params.set(k, String(v));
  });
  const qs = params.toString();
  const r = await fetch(qs ? `${BASE}?${qs}` : BASE);
  if (!r.ok) throw await refusal(r);
  return r.json();
}

export async function getRecording(groupId: string): Promise<RecordingDetail> {
  const r = await fetch(`${BASE}/${encodeURIComponent(groupId)}`);
  if (!r.ok) throw await refusal(r);
  return r.json();
}

export async function deleteRecording(groupId: string): Promise<void> {
  const r = await fetch(`${BASE}/${encodeURIComponent(groupId)}`, { method: 'DELETE' });
  if (!r.ok) throw await refusal(r);
}

/** The clean video (no burned-in marks), seekable; `download` makes it an attachment. */
export function sourceMp4Url(groupId: string, recordingId: string, download = false): string {
  return `${BASE}/${encodeURIComponent(groupId)}/source.mp4?recordingId=${encodeURIComponent(recordingId)}${download ? '&download=1' : ''}`;
}
```

**`playback.ts`:**

```ts
import type { GroupAnnotation } from '../../api-service/recordings';
import type { AnnotationShape, OverlayAnnotation } from '../mosaic/recording-group-store';

/** Every phone follows one clock; a video further off it than this is moved back. */
export const RESYNC_MS = 250;
/** ← and → skip this far. */
export const SKIP_MS = 5000;

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

/** "0:42", "4:12", "1:02:03". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export type TilePhase = 'before' | 'playing' | 'after';

/** Where a phone is at a group time: not joined yet, playing, or finished. */
export function tilePhase(groupMs: number, offsetMs: number, durationMs: number | null): TilePhase {
  if (groupMs < offsetMs) return 'before';
  if (durationMs !== null && groupMs >= offsetMs + durationMs) return 'after';
  return 'playing';
}

/** A phone's own video time at a group time. */
export function videoTimeMs(groupMs: number, offsetMs: number): number {
  return groupMs - offsetMs;
}

export function needsResync(actualMs: number, expectedMs: number): boolean {
  return Math.abs(actualMs - expectedMs) > RESYNC_MS;
}

export function positionPct(ms: number, durationMs: number): number {
  if (!(durationMs > 0)) return 0;
  return Math.min(100, Math.max(0, (ms / durationMs) * 100));
}

export function clampTime(ms: number, durationMs: number): number {
  return Math.min(Math.max(0, ms), Math.max(0, durationMs));
}

/** Marks on screen at a group time: from their time until their end, or to the end. */
export function visibleAt<T extends { timecodeMs: number; endTimecodeMs: number | null }>(
  list: T[],
  groupMs: number,
): T[] {
  return list.filter(
    (a) => a.timecodeMs <= groupMs && (a.endTimecodeMs === null || groupMs < a.endTimecodeMs),
  );
}

/** A stored mark as the overlay draws it; null when its geometry can't be read. */
export function toOverlay(a: GroupAnnotation): OverlayAnnotation | null {
  let geometry: OverlayAnnotation['geometry'];
  try {
    geometry = JSON.parse(a.geometry);
  } catch {
    return null;
  }
  if (!geometry || typeof geometry.x !== 'number' || typeof geometry.y !== 'number') return null;
  return {
    shape: a.shape as AnnotationShape,
    color: a.color,
    geometry,
    text: a.text ?? undefined,
  };
}
```

**`libraryFilters.ts`:**

```ts
import type { LibraryQuery } from '../../api-service/recordings';

export type WhenFilter = 'any' | '24h' | '7d' | '30d';

/** The library's filters, as the link carries them ('' = any). */
export interface LibraryFilters {
  phone: string;
  by: string;
  when: WhenFilter;
  q: string;
}

export const NO_LIBRARY_FILTERS: LibraryFilters = { phone: '', by: '', when: 'any', q: '' };

const WHENS: WhenFilter[] = ['any', '24h', '7d', '30d'];
const DAY = 86_400_000;
const WHEN_MS: Record<Exclude<WhenFilter, 'any'>, number> = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY };

export const WHEN_LABEL: Record<WhenFilter, string> = {
  any: 'Any time',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

export function parseLibraryFilters(params: URLSearchParams): LibraryFilters {
  const when = params.get('when') as WhenFilter | null;
  return {
    phone: params.get('phone') ?? '',
    by: params.get('by') ?? '',
    when: when && WHENS.includes(when) ? when : 'any',
    q: params.get('q') ?? '',
  };
}

export function libraryFiltersToParams(f: LibraryFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.phone) p.set('phone', f.phone);
  if (f.by) p.set('by', f.by);
  if (f.when !== 'any') p.set('when', f.when);
  if (f.q.trim()) p.set('q', f.q);
  return p;
}

export function isLibraryFiltered(f: LibraryFilters): boolean {
  return !!(f.phone || f.by || f.when !== 'any' || f.q.trim());
}

export function libraryQuery(f: LibraryFilters, now: number): LibraryQuery {
  return {
    udid: f.phone || undefined,
    startedBy: f.by || undefined,
    since: f.when === 'any' ? undefined : new Date(now - WHEN_MS[f.when]).toISOString(),
    q: f.q.trim() || undefined,
  };
}
```

**`recordingActions.ts`:**

```ts
import {
  annotatedMp4Url,
  bundleZipUrl,
  compositeMp4Url,
  RecordingRequestError,
  sourceMp4Url,
  videosZipUrl,
  type RecordingSummary,
} from '../../api-service/recordings';

export interface DownloadItem {
  key: string;
  label: string;
  url: string;
}

/** The Download menu: the group's files, then each phone's video (and annotated one). */
export function downloadItems(s: RecordingSummary): DownloadItem[] {
  const items: DownloadItem[] = [
    { key: 'zip', label: 'All videos (zip)', url: videosZipUrl(s.groupId) },
  ];
  if (s.hasComposite) {
    items.push({ key: 'composite', label: 'Side-by-side video', url: compositeMp4Url(s.groupId) });
  }
  items.push({ key: 'bundle', label: 'Proof bundle', url: bundleZipUrl(s.groupId) });
  s.phones
    .filter((p) => p.status !== 'FAILED' && p.status !== 'DISCARDED')
    .forEach((p) => {
      items.push({
        key: `video-${p.recordingId}`,
        label: `${p.name}: video`,
        url: sourceMp4Url(s.groupId, p.recordingId, true),
      });
      if (p.annotationCount > 0) {
        items.push({
          key: `annotated-${p.recordingId}`,
          label: `${p.name}: video with annotations`,
          url: annotatedMp4Url(s.groupId, p.recordingId),
        });
      }
    });
  return items;
}

/** The server decides; this only hides a button that would be refused. */
export function canDelete(
  s: RecordingSummary,
  me: { userId?: string | null; role?: string | null } | null,
): boolean {
  if (!me) return false;
  if (me.role === 'ADMIN' || me.role === 'SUPER_ADMIN') return true;
  return !!s.startedBy && !!me.userId && s.startedBy.id === me.userId;
}

export function deleteErrorMessage(e: unknown): string {
  if (e instanceof RecordingRequestError) {
    if (e.code === 'not_owner') return 'Only the person who recorded it, or an admin, can delete it.';
    if (e.code === 'recording_in_progress') return 'It’s still recording. Stop it on Live devices first.';
    if (e.status === 404) return 'It was already deleted, or it’s on phones you can’t see.';
  }
  return `Couldn’t delete the recording: ${e instanceof Error ? e.message : String(e)}`;
}

/** Start a browser download of a same-origin URL (cookies go with it). */
export function startDownload(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
```

- [ ] **Step 4: Run** the four test files (they should PASS). Then run `npx tsc --noEmit -p . ; echo tsc=$?` (expect 0), and eslint from the repo root on the new files (0) and on `recordings.ts` (≤ base).
- [ ] **Step 5: Commit** `feat(recordings): playback, filter and download rules, and the library API client`.

---

### Task 6: The Recordings page, its route, nav item and title, and the Live devices link

**Files:**
- Create: `web/src/components/recordings/RecordingsPage.tsx`, `web/src/components/recordings/recordings.css`
- Modify: `web/src/routes/index.tsx`; `web/src/components/sidebar/sidebar.tsx`; `web/src/lib/document-title.ts`; `web/src/components/mosaic/RecordingControls.tsx`
- Test: `web/src/components/recordings/RecordingsPage.test.tsx`, `web/src/lib/document-title.test.ts` (add cases), `web/src/components/sidebar/sidebar.test.tsx` (add a case), `web/src/components/mosaic/RecordingControls.test.tsx` (add a case)

**Interfaces:**
- Consumes (Task 5): `listRecordings`, `RecordingSummary`, `LibraryResponse`; `parseLibraryFilters`, `libraryFiltersToParams`, `libraryQuery`, `isLibraryFiltered`, `WHEN_LABEL`, `NO_LIBRARY_FILTERS`, `WhenFilter`; `formatClock`. Also the shared `FilterMenu` (`web/src/components/device-explorer/FilterMenu.tsx`: props `name`, `value`, `anyValue`, `options: { value, label, note?, count }[]`, `onChange`), plus `PageHeader`, `Table`/`THead`/`TBody`/`TR`/`TH`/`TD`, `EmptyState`, `Button` and `Input` (from `../ui/input`).
- Produces: default export `RecordingsPage`, plus the exported helpers `phoneNames(s)` and `formatWhen(iso)`.

- [ ] **Step 1: Failing tests.**

`RecordingsPage.test.tsx`: render at a `MemoryRouter` path with a `<Where>` probe, as `device-explorer.test.tsx` does. Mock `../../api-service/recordings`, keeping the real URL helpers via `vi.importActual` and replacing `listRecordings` with `vi.fn()`. Use two summaries:
- `g2`: done, three phones (Galaxy S9+, iPhone 17, Pixel), length 252000, by Alice, 2 bookmarks;
- `g1`: status `recording`, one phone, by nobody.

The tests:
1. Shows "2 recordings" in the header subtitle. Shows one row per recording with:
   - "Galaxy S9+, iPhone 17 +1", with `title` "Galaxy S9+\niPhone 17\nPixel";
   - "4:12";
   - "Alice" and "Unknown";
   - "2";
   - "Recording…" in the running row's Status cell.
2. The first row's When link has `href` `/recordings/g2`, and the running one `/devices/live`. With `MemoryRouter`, assert `getAttribute('href')`.
3. Choosing Phone → Galaxy S9+ (FilterMenu trigger `button` named "Phone", then `menuitemradio` /Galaxy/) writes `?phone=U1` and calls `listRecordings` with `expect.objectContaining({ udid: 'U1' })`. The search box `textbox` named "Search recordings" writes `q` after typing. Use fake timers or `waitFor` for the 250 ms debounce.
4. **Empty states.**
   - With `{ recordings: [], total: 0, … }` and no filters: "No recordings yet" and a link named "Open Live devices" to `/devices/live`.
   - With `?phone=U9` and zero rows: "No recordings match", and **Clear filters** clears the URL (`where()` → `/recordings`).
5. **Load more** (`nextCursor: 'c1'`) calls `listRecordings` with `expect.objectContaining({ cursor: 'c1' })` and appends the rows.
6. **Errors:** a rejected `listRecordings` shows "Couldn't load recordings" and **Retry**, which refetches.
7. **Footnote:** "Recordings are kept for 30 days, up to the newest 100.".

`document-title.test.ts`: add

```ts
  it('titles the recordings pages', () => {
    expect(titleForPath('/recordings')).toBe('Recordings · Xenon');
    expect(titleForPath('/recordings/abc-123')).toBe('Recording · Xenon');
  });
```

`sidebar.test.tsx`: add a case asserting that "Recordings" comes directly after "Live devices" in the nav, and is visible to a MEMBER. Follow the file's existing render helper.

`RecordingControls.test.tsx`: add a case in which, with `groupId: 'g1'` and `recordingPhase: 'idle'` (the state where the download buttons show), a link named "Open in Recordings" has `href` ending `/recordings/g1`. If the file's `mount` doesn't render inside a router, wrap it in `MemoryRouter` in `mount` (that changes no existing assertion).

- [ ] **Step 2: Run** from `web/`: `npx vitest run src/components/recordings src/lib/document-title.test.ts src/components/sidebar src/components/mosaic/RecordingControls.test.tsx`. It should FAIL.
- [ ] **Step 3: Implement.**

**Routes** (`web/src/routes/index.tsx`): lazy imports, then routes after `/devices/live`:

```tsx
const RecordingsPage = lazy(() => import('../components/recordings/RecordingsPage'));
const RecordingPage = lazy(() => import('../components/recordings/RecordingPage'));
…
        <Route path="/recordings" element={<RecordingsPage />} />
        <Route path="/recordings/:groupId" element={<RecordingPage />} />
```

`RecordingPage` arrives in Task 8. So that this task compiles and runs, create `web/src/components/recordings/RecordingPage.tsx` now as a stub (`export default function RecordingPage() { return null; }`). Task 8 replaces it.

**Sidebar:** import `Film` from lucide-react, and add after `live-devices`:

```ts
  { id: 'recordings', label: 'Recordings', icon: Film, path: '/recordings' },
```

**Titles** (`document-title.ts`): add `'/recordings': 'Recordings',` to `EXACT`. In `titleForPath`'s fallback chain, before the `/runbooks/` case, add:

```ts
    else if (/^\/recordings\/[^/]+$/.test(path)) page = 'Recording';
```

**Live devices link** (`RecordingControls.tsx`): after the composite download link, inside the same `showDownload` condition, add:

```tsx
      {showDownload && (
        <Link
          to={`/recordings/${encodeURIComponent(state.groupId!)}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-[var(--border)] hover:bg-[var(--surface-2)]"
        >
          <Film {...icon} />
          Open in Recordings
        </Link>
      )}
```

Import `Link` from `react-router-dom` and `Film` from `lucide-react`.

**`RecordingsPage.tsx`:**

```tsx
import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Film, RefreshCw } from 'lucide-react';
import { PageHeader } from '../ui/page-header';
import { Table, TBody, TD, TH, THead, TR } from '../ui/Table';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { Input } from '../ui/input';
import { FilterMenu } from '../device-explorer/FilterMenu';
import {
  listRecordings,
  type LibraryResponse,
  type RecordingSummary,
} from '../../api-service/recordings';
import { formatClock } from './playback';
import {
  isLibraryFiltered,
  libraryFiltersToParams,
  libraryQuery,
  NO_LIBRARY_FILTERS,
  parseLibraryFilters,
  WHEN_LABEL,
  type LibraryFilters,
  type WhenFilter,
} from './libraryFilters';
import './recordings.css';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;

/** "Galaxy S9+, iPhone 17 +1", with every name for the tooltip. */
export function phoneNames(s: RecordingSummary): { text: string; title: string } {
  const names = s.phones.map((p) => p.name);
  return {
    text:
      names.length > 2
        ? `${names.slice(0, 2).join(', ')} +${names.length - 2}`
        : names.join(', '),
    title: names.join('\n'),
  };
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const hrefFor = (s: RecordingSummary) =>
  s.status === 'recording' ? '/devices/live' : `/recordings/${encodeURIComponent(s.groupId)}`;

export default function RecordingsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters = parseLibraryFilters(params);
  const queryKey = libraryFiltersToParams(filters).toString();
  const [data, setData] = React.useState<LibraryResponse | null>(null);
  const [rows, setRows] = React.useState<RecordingSummary[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const request = React.useRef(0);

  const write = (next: LibraryFilters) => setParams(libraryFiltersToParams(next), { replace: true });

  React.useEffect(() => {
    const id = ++request.current;
    const t = window.setTimeout(() => {
      listRecordings({ ...libraryQuery(filters, Date.now()), limit: PAGE_SIZE })
        .then((res) => {
          if (id !== request.current) return;
          setData(res);
          setRows(res.recordings);
          setError(null);
        })
        .catch((e) => {
          if (id !== request.current) return;
          setError(e instanceof Error ? e.message : String(e));
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
    // queryKey is the filters; reloadKey is Retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, reloadKey]);

  const loadMore = async () => {
    if (!data?.nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await listRecordings({
        ...libraryQuery(filters, Date.now()),
        limit: PAGE_SIZE,
        cursor: data.nextCursor,
      });
      setData(res);
      setRows((prev) => prev.concat(res.recordings));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const f = data?.facets;
  const phoneOptions = [
    { value: '', label: 'Any phone', count: f?.when.any ?? 0 },
    ...(f?.phones ?? []).map((p) => ({ value: p.udid, label: p.name, count: p.count })),
  ];
  const byOptions = [
    { value: '', label: 'Anyone', count: f?.when.any ?? 0 },
    ...(f?.people ?? []).map((p) => ({ value: p.id, label: p.name, count: p.count })),
    ...(f && f.unknownCount > 0 ? [{ value: 'unknown', label: 'Unknown', count: f.unknownCount }] : []),
  ];
  const whenOptions = (['any', '24h', '7d', '30d'] as WhenFilter[]).map((w) => ({
    value: w,
    label: WHEN_LABEL[w],
    count: f?.when[w] ?? 0,
  }));

  const total = data?.total ?? 0;
  return (
    <div className="rec-page">
      <PageHeader
        icon={Film}
        title="Recordings"
        subtitle={data ? `${total} recording${total === 1 ? '' : 's'}` : undefined}
      />
      <div className="rec-toolbar">
        <Input
          type="search"
          className="rec-search"
          aria-label="Search recordings"
          placeholder="Search phones and bookmarks"
          value={filters.q}
          onChange={(e) => write({ ...filters, q: e.target.value })}
        />
        <FilterMenu
          name="Phone"
          value={filters.phone}
          anyValue=""
          options={phoneOptions}
          onChange={(v) => write({ ...filters, phone: v })}
        />
        <FilterMenu
          name="Recorded by"
          value={filters.by}
          anyValue=""
          options={byOptions}
          onChange={(v) => write({ ...filters, by: v })}
        />
        <FilterMenu<WhenFilter>
          name="When"
          value={filters.when}
          anyValue="any"
          options={whenOptions}
          onChange={(v) => write({ ...filters, when: v })}
        />
      </div>

      {error ? (
        <EmptyState
          title="Couldn't load recordings"
          description={error}
          action={
            <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
              <RefreshCw size={14} aria-hidden="true" />
              Retry
            </Button>
          }
        />
      ) : !data ? (
        <EmptyState title="Loading recordings…" />
      ) : rows.length === 0 ? (
        isLibraryFiltered(filters) ? (
          <EmptyState
            title="No recordings match"
            action={
              <Button variant="secondary" onClick={() => write(NO_LIBRARY_FILTERS)}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No recordings yet"
            description="Record phones from Live devices."
            action={
              <Link className="rec-link" to="/devices/live">
                Open Live devices
              </Link>
            }
          />
        )
      ) : (
        <>
          <Table className="rec-table">
            <caption className="sr-only">Recordings, {rows.length} shown</caption>
            <THead>
              <TR>
                <TH scope="col">When</TH>
                <TH scope="col">Phones</TH>
                <TH scope="col">Length</TH>
                <TH scope="col">Recorded by</TH>
                <TH scope="col">Bookmarks</TH>
                <TH scope="col">Status</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((s) => {
                const phones = phoneNames(s);
                const href = hrefFor(s);
                return (
                  <TR
                    key={s.groupId}
                    className="rec-row"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('a')) return;
                      navigate(href);
                    }}
                  >
                    <TD>
                      <Link to={href} className="rec-link">
                        {formatWhen(s.startedAt)}
                      </Link>
                    </TD>
                    <TD title={phones.title}>{phones.text}</TD>
                    <TD className="rec-num">{s.durationMs === null ? '—' : formatClock(s.durationMs)}</TD>
                    <TD>{s.startedBy?.name ?? 'Unknown'}</TD>
                    <TD className="rec-num">{s.bookmarkCount}</TD>
                    <TD>
                      {s.status === 'recording' ? 'Recording…' : s.status === 'failed' ? 'Failed' : ''}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          {data.nextCursor && (
            <div className="rec-more">
              <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
      {data && (
        <p className="rec-footnote">
          Recordings are kept for {data.retention.days} days, up to the newest {data.retention.maxCount}.
        </p>
      )}
    </div>
  );
}
```

Hand-fix Prettier formatting in the lines you write. `FilterMenu`'s generic is inferred as `string` for Phone and Recorded by.

**`recordings.css`** (tokens only; this page's rules, plus the recording page's in Task 8):

```css
.rec-page {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.rec-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
}

.rec-search {
  width: 280px;
}

.rec-table.tbl {
  width: 100%;
}
.rec-table.tbl th:first-child,
.rec-table.tbl td:first-child {
  padding-left: 20px;
}
.rec-table.tbl th:last-child,
.rec-table.tbl td:last-child {
  padding-right: 20px;
}

.rec-row {
  cursor: pointer;
}
.rec-row:hover td {
  background: var(--surface-2);
}

.rec-num {
  font-variant-numeric: tabular-nums;
}

.rec-link {
  color: var(--text);
  text-decoration: none;
}
.rec-link:hover {
  text-decoration: underline;
}
.rec-link:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
  border-radius: 2px;
}

.rec-more {
  display: flex;
  justify-content: center;
  padding: 16px;
}

.rec-footnote {
  margin-top: auto;
  padding: 16px 20px;
  font-size: 12px;
  color: var(--text-muted);
}
```

- [ ] **Step 4: Run** the Step 2 tests (they should PASS), then the whole web suite once with `npx vitest run`, and `npx tsc --noEmit -p . ; echo tsc=$?` (0). Lint new files (0) and changed files (≤ base).
- [ ] **Step 5: Commit** `feat(recordings): the Recordings page, in the sidebar, and linked from Live devices`.

---

### Task 7: One clock for many videos (`useSyncedPlayback`)

**Files:**
- Create: `web/src/components/recordings/useSyncedPlayback.ts`
- Test: `web/src/components/recordings/useSyncedPlayback.test.tsx`

**Interfaces (produces):**

```ts
export interface SyncTarget { offsetMs: number; durationMs: number | null }
export interface PlaybackClock { now(): number; schedule(cb: () => void): number; cancel(id: number): void }
export interface SyncedPlayback {
  timeMs: number; playing: boolean; waiting: boolean;
  play(): void; pause(): void; toggle(): void; seek(ms: number): void;
  /** A ref callback for phone `id`'s <video>; stable per id. */
  bind(id: string, target: SyncTarget): (el: HTMLVideoElement | null) => void;
}
export function useSyncedPlayback(durationMs: number, clock?: PlaybackClock): SyncedPlayback;
```

**Rules:**
- The clock alone decides the group time.
- On every tick, each bound video that has no `error` is driven as follows:
  - **before its offset:** paused at 0;
  - **after its end:** paused at its duration;
  - **otherwise:** it should be at `groupTime − offset`. It is moved there when more than `RESYNC_MS` off, and plays while the clock runs.
- If a video that should be playing has `readyState < 3` (HAVE_FUTURE_DATA), the clock holds and `waiting` is true: every video pauses until it can play, then the clock resumes from the same time.
- At the group's end the clock stops, and `playing` becomes false. `play()` at the end restarts from 0.
- The state renders at most every 100 ms, plus immediately on play, pause, seek, waiting and end.

- [ ] **Step 1: Failing tests** (`useSyncedPlayback.test.tsx`):

```tsx
import * as React from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSyncedPlayback, type PlaybackClock, type SyncedPlayback } from './useSyncedPlayback';

function fakeClock() {
  let now = 0;
  let pending: (() => void) | null = null;
  const clock: PlaybackClock = {
    now: () => now,
    schedule: (cb) => {
      pending = cb;
      return 1;
    },
    cancel: () => {
      pending = null;
    },
  };
  /** Advance time and run one frame. */
  const step = (ms: number) =>
    act(() => {
      now += ms;
      const cb = pending;
      pending = null;
      cb?.();
    });
  return { clock, step };
}

function fakeVideo(over: Partial<HTMLVideoElement> = {}) {
  const v: any = {
    currentTime: 0,
    paused: true,
    readyState: 4,
    error: null,
    play: vi.fn(function (this: any) {
      this.paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn(function (this: any) {
      this.paused = true;
    }),
    ...over,
  };
  v.play = v.play.bind(v);
  v.pause = v.pause.bind(v);
  return v as HTMLVideoElement & { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> };
}

function setup(duration = 60_000) {
  const { clock, step } = fakeClock();
  const api: { current: SyncedPlayback | null } = { current: null };
  function Harness() {
    api.current = useSyncedPlayback(duration, clock);
    return null;
  }
  render(<Harness />);
  const p = () => api.current as SyncedPlayback;
  return { p, step };
}

describe('useSyncedPlayback', () => {
  it('plays each phone at its own time, and holds a late one at 0 until it joins', () => {
    const { p, step } = setup();
    const early = fakeVideo();
    const late = fakeVideo();
    act(() => {
      p().bind('a', { offsetMs: -1000, durationMs: 61_000 })(early);
      p().bind('b', { offsetMs: 10_000, durationMs: 20_000 })(late);
    });
    act(() => p().play());
    expect(early.currentTime).toBeCloseTo(1);
    expect(early.paused).toBe(false);
    expect(late.paused).toBe(true);
    step(5000);
    expect(late.paused).toBe(true);
    expect(late.currentTime).toBe(0);
    step(6000);
    expect(late.paused).toBe(false);
    expect(p().playing).toBe(true);
  });

  it('pulls back a video that drifted past 250 ms, and leaves a small drift alone', () => {
    const { p, step } = setup();
    const v = fakeVideo();
    act(() => p().bind('a', { offsetMs: 0, durationMs: 60_000 })(v));
    act(() => p().play());
    step(10_000);
    v.currentTime = 10.2; // 200 ms ahead of 10.0 s
    step(0);
    expect(v.currentTime).toBeCloseTo(10.2);
    v.currentTime = 11; // 1 s ahead
    step(0);
    expect(v.currentTime).toBeCloseTo(10);
  });

  it('waits for a stalled video, pausing the rest, then carries on from the same time', () => {
    const { p, step } = setup();
    const a = fakeVideo();
    const b = fakeVideo();
    act(() => {
      p().bind('a', { offsetMs: 0, durationMs: 60_000 })(a);
      p().bind('b', { offsetMs: 0, durationMs: 60_000 })(b);
    });
    act(() => p().play());
    step(2000);
    (b as any).readyState = 2;
    step(1000);
    expect(p().waiting).toBe(true);
    expect(a.paused).toBe(true);
    const held = p().timeMs;
    step(5000);
    expect(p().timeMs).toBe(held);
    (b as any).readyState = 4;
    step(0);
    step(1000);
    expect(p().waiting).toBe(false);
    expect(a.paused).toBe(false);
    expect(p().timeMs).toBeGreaterThan(held);
  });

  it('ignores a video that failed to load', () => {
    const { p, step } = setup();
    const ok = fakeVideo();
    const broken = fakeVideo({ readyState: 0, error: {} as MediaError });
    act(() => {
      p().bind('a', { offsetMs: 0, durationMs: 60_000 })(ok);
      p().bind('b', { offsetMs: 0, durationMs: 60_000 })(broken);
    });
    act(() => p().play());
    step(1000);
    expect(p().waiting).toBe(false);
    expect(broken.play).not.toHaveBeenCalled();
  });

  it('stops at the end, and plays again from the start', () => {
    const { p, step } = setup(10_000);
    const v = fakeVideo();
    act(() => p().bind('a', { offsetMs: 0, durationMs: 10_000 })(v));
    act(() => p().play());
    step(12_000);
    expect(p().playing).toBe(false);
    expect(p().timeMs).toBe(10_000);
    act(() => p().play());
    expect(p().timeMs).toBe(0);
    expect(p().playing).toBe(true);
  });

  it('seeks every video while paused, clamped to the recording', () => {
    const { p } = setup(60_000);
    const a = fakeVideo();
    const b = fakeVideo();
    act(() => {
      p().bind('a', { offsetMs: 0, durationMs: 60_000 })(a);
      p().bind('b', { offsetMs: 20_000, durationMs: 30_000 })(b);
    });
    act(() => p().seek(30_000));
    expect(a.currentTime).toBeCloseTo(30);
    expect(b.currentTime).toBeCloseTo(10);
    expect(a.paused).toBe(true);
    act(() => p().seek(99_999));
    expect(p().timeMs).toBe(60_000);
    expect(b.currentTime).toBeCloseTo(30); // finished: held at its end
  });

  it('gives the same ref callback for the same phone', () => {
    const { p } = setup();
    expect(p().bind('a', { offsetMs: 0, durationMs: 1 })).toBe(p().bind('a', { offsetMs: 0, durationMs: 1 }));
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/components/recordings/useSyncedPlayback.test.tsx`. It should FAIL.
- [ ] **Step 3: Implement** `useSyncedPlayback.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { clampTime, needsResync, tilePhase, videoTimeMs } from './playback';

export interface SyncTarget {
  offsetMs: number;
  durationMs: number | null;
}

export interface PlaybackClock {
  now(): number;
  schedule(cb: () => void): number;
  cancel(id: number): void;
}

export interface SyncedPlayback {
  timeMs: number;
  playing: boolean;
  waiting: boolean;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(ms: number): void;
  bind(id: string, target: SyncTarget): (el: HTMLVideoElement | null) => void;
}

const browserClock: PlaybackClock = {
  now: () => performance.now(),
  schedule: (cb) => window.requestAnimationFrame(() => cb()),
  cancel: (id) => window.cancelAnimationFrame(id),
};

/** The transport re-renders this often while playing, not every frame. */
const RENDER_EVERY_MS = 100;
const HAVE_FUTURE_DATA = 3;

/**
 * One clock for every phone's <video>. The clock is the truth; videos follow
 * it (each at its own offset), are corrected when they drift, and a video
 * that stalls holds the clock so the phones never fall out of step.
 */
export function useSyncedPlayback(
  durationMs: number,
  clock: PlaybackClock = browserClock,
): SyncedPlayback {
  const els = useRef(new Map<string, HTMLVideoElement>());
  const targets = useRef(new Map<string, SyncTarget>());
  const refs = useRef(new Map<string, (el: HTMLVideoElement | null) => void>());
  // since: clock time the group time last started advancing; null while held.
  const s = useRef({ baseMs: 0, since: null as number | null, running: false, waiting: false });
  const frame = useRef<number | null>(null);
  const lastRender = useRef(-Infinity);
  const [view, setView] = useState({ timeMs: 0, playing: false, waiting: false });

  const current = () =>
    s.current.since === null ? s.current.baseMs : s.current.baseMs + (clock.now() - s.current.since);

  const drive = (t: number, advancing: boolean) => {
    els.current.forEach((el, id) => {
      const target = targets.current.get(id);
      if (!target || el.error) return;
      const phase = tilePhase(t, target.offsetMs, target.durationMs);
      const wantMs =
        phase === 'before'
          ? 0
          : phase === 'after'
            ? (target.durationMs as number)
            : videoTimeMs(t, target.offsetMs);
      if (needsResync(el.currentTime * 1000, wantMs)) el.currentTime = wantMs / 1000;
      if (advancing && phase === 'playing') {
        if (el.paused) el.play()?.catch(() => undefined);
      } else if (!el.paused) {
        el.pause();
      }
    });
  };

  const stalledAt = (t: number) =>
    Array.from(els.current.entries()).some(([id, el]) => {
      const target = targets.current.get(id);
      return (
        !!target &&
        !el.error &&
        tilePhase(t, target.offsetMs, target.durationMs) === 'playing' &&
        el.readyState < HAVE_FUTURE_DATA
      );
    });

  const render = (force: boolean) => {
    const now = clock.now();
    if (!force && now - lastRender.current < RENDER_EVERY_MS) return;
    lastRender.current = now;
    setView({ timeMs: current(), playing: s.current.running, waiting: s.current.waiting });
  };

  const stopFrames = () => {
    if (frame.current !== null) clock.cancel(frame.current);
    frame.current = null;
  };

  const tick = () => {
    frame.current = null;
    const st = s.current;
    if (!st.running) return;
    const t = current();
    if (t >= durationMs) {
      Object.assign(st, { baseMs: durationMs, since: null, running: false, waiting: false });
      drive(durationMs, false);
      render(true);
      return;
    }
    const stalled = stalledAt(t);
    if (stalled !== st.waiting) {
      st.baseMs = t;
      st.since = stalled ? null : clock.now();
      st.waiting = stalled;
      drive(t, !stalled);
      render(true);
    } else {
      drive(t, !stalled);
      render(false);
    }
    frame.current = clock.schedule(tick);
  };

  const play = () => {
    const st = s.current;
    if (current() >= durationMs) st.baseMs = 0;
    else st.baseMs = current();
    Object.assign(st, { since: clock.now(), running: true, waiting: false });
    drive(st.baseMs, true);
    render(true);
    stopFrames();
    frame.current = clock.schedule(tick);
  };

  const pause = () => {
    const st = s.current;
    Object.assign(st, { baseMs: current(), since: null, running: false, waiting: false });
    stopFrames();
    drive(st.baseMs, false);
    render(true);
  };

  const seek = (ms: number) => {
    const st = s.current;
    const t = clampTime(ms, durationMs);
    st.baseMs = t;
    st.since = st.running && !st.waiting ? clock.now() : null;
    drive(t, st.running && !st.waiting);
    render(true);
  };

  const bind = useCallback((id: string, target: SyncTarget) => {
    targets.current.set(id, target);
    let ref = refs.current.get(id);
    if (!ref) {
      ref = (el: HTMLVideoElement | null) => {
        if (el) {
          els.current.set(id, el);
          const st = s.current;
          drive(current(), st.running && !st.waiting);
        } else {
          els.current.delete(id);
        }
      };
      refs.current.set(id, ref);
    }
    return ref;
    // drive/current read refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => stopFrames, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    ...view,
    play,
    pause,
    toggle: () => (s.current.running ? pause() : play()),
    seek,
    bind,
  };
}
```

The test "plays again from the start" expects `timeMs` 0 right after `play()` at the end. `play` sets `baseMs = 0` and renders with `since` = now, so `current()` is 0. Check this, and every other test, against this implementation. If a test and the Rules disagree, fix the code to match the Rules and report it.

- [ ] **Step 4: Run** the test (it should PASS), tsc (0), and eslint on both files (0; keep the two `exhaustive-deps` disables, each with its comment, only if that rule is enabled in the repo's config).
- [ ] **Step 5: Commit** `feat(recordings): one clock driving every phone's video`.

---

### Task 8: The recording page

**Files:**
- Replace: `web/src/components/recordings/RecordingPage.tsx` (the Task 6 stub)
- Modify: `web/src/components/recordings/recordings.css` (add the page's rules)
- Test: `web/src/components/recordings/RecordingPage.test.tsx`

**Interfaces:**
- Consumes (Task 5): `getRecording`, `deleteRecording`, `sourceMp4Url`, `RecordingDetail`, `RecordingRequestError`, `GroupAnnotation`; `formatClock`, `tilePhase`, `positionPct`, `visibleAt`, `toOverlay`, `SKIP_MS`, `clampTime`; `downloadItems`, `canDelete`, `deleteErrorMessage` and `startDownload`.
- Consumes (Task 7): `useSyncedPlayback`.
- Consumes (Task 6): `formatWhen`.
- Also `AnnotationOverlay` (`web/src/components/mosaic/AnnotationOverlay.tsx`, props `enabled`, `shape`, `color`, `onCommit`, `committed`, `mediaAspect`), `Modal`, `Popover`, `Menu`/`MenuItem`, `Button`, `EmptyState`, `PageHeader`, `useAuth`, `useToast`.

**Layout:**
- A back link, "Recordings", above a `PageHeader`:
  - `title` = `formatWhen(summary.startedAt)`;
  - `subtitle` = phone names joined ", ", then "Length m:ss", then "Recorded by {name}" (or "Recorded by Unknown"), joined " · ";
  - `action` = the **Download** menu button, and **Delete** when `canDelete`.
- The body is a two-column grid: the player (tiles over a transport) and, when there are bookmarks, a 260 px **Bookmarks** list.
- Each tile is a dark island (`className="rec-tile theme-dark"`) holding:
  - the phone's name;
  - `<video muted playsInline preload="auto" src={sourceMp4Url(groupId, recordingId)} ref={bind(recordingId, { offsetMs, durationMs })}>`;
  - the read-only overlay;
  - one of these notes: "Joined at m:ss" (before its offset), "Recording failed: {reason}" (a failed phone, which has no `<video>`), or "Video no longer available" (the video's `error` event).
- The transport: a Play/Pause button (`aria-label` "Play"/"Pause"); the time "m:ss / m:ss"; the timeline; bookmark diamonds on it; an "Annotations" checkbox when there are any; and "Buffering…" (`role="status"`) while waiting.
- The timeline is `<input type="range" aria-label="Timeline" min={0} max={duration} step={100} value={timeMs}>`, with `aria-valuetext` "m:ss of m:ss". Each diamond is a button named "Bookmark: {label}, m:ss", with `title` {label}, and seeks.
- Keyboard, on `document`, ignored while focus is in an input, select, textarea, contenteditable, dialog or menu: Space toggles play, and ← → skip `SKIP_MS`.

- [ ] **Step 1: Failing tests** (`RecordingPage.test.tsx`).
  - **Mocks:**
    - `../../api-service/recordings`: keep the real URL helpers and `RecordingRequestError` via `vi.importActual`; mock `getRecording` and `deleteRecording`.
    - `./useSyncedPlayback`, as a fake whose state the test controls (below).
    - `../mosaic/AnnotationOverlay` as `({ committed }) => <div data-testid="overlay" data-count={committed?.length ?? 0} />`.
    - `../../auth/auth-context`, with `me` switchable per test.
    - `../ui/toast`, with a spy `toast`.
    - `./recordingActions`, keeping the real functions except `startDownload` (a spy).
  - **Render** inside `MemoryRouter initialEntries={['/recordings/g1']}` with `<Routes><Route path="/recordings/:groupId" element={<RecordingPage />} /><Route path="/recordings" element={<Where />} /></Routes>`.
  - **Fake playback:**

```tsx
const pb = vi.hoisted(() => ({
  state: { timeMs: 0, playing: false, waiting: false },
  play: vi.fn(), pause: vi.fn(), toggle: vi.fn(), seek: vi.fn(),
}));
vi.mock('./useSyncedPlayback', () => ({
  useSyncedPlayback: () => ({ ...pb.state, play: pb.play, pause: pb.pause, toggle: pb.toggle, seek: pb.seek, bind: () => () => undefined }),
}));
```

  - **Detail fixture:** phones `r1` (Galaxy S9+, offset 0, duration 252000, 1 annotation), `r2` (iPhone 17, offset 42000, duration 200000) and `r3` (Pixel, FAILED, "no frames"). One bookmark "Checkout", at 30000 on r1. One annotation on r1, from 1000 to 5000, geometry `{"x":0.1,"y":0.1,"w":0.2,"h":0.2}`. Started by `usr_alice` "Alice". `hasComposite: true`.
  - **Tests:**
    1. **Header:** the date; "Galaxy S9+, iPhone 17, Pixel · Length 4:12 · Recorded by Alice"; a back link to `/recordings`; one tile per phone with its name.
    2. **Tile notes at `timeMs` 0:** the iPhone tile shows "Joined at 0:42", the Pixel tile shows "Recording failed: no frames" and has no `video` element, and the S9+ tile has a `video` whose `src` ends `source.mp4?recordingId=r1`. Firing `error` on the S9+ video (`fireEvent.error`) shows "Video no longer available".
    3. **Marks follow the clock.** With `pb.state.timeMs = 2000` the S9+ overlay's `data-count` is "1"; at 6000 it is "0"; the iPhone overlay's is always "0". Unchecking **Annotations** hides the overlays.
    4. **Transport:** the Play button calls `toggle`. The timeline's change calls `seek(30000)`. The diamond "Bookmark: Checkout, 0:30" calls `seek(30000)`, and so does the bookmark list's button. Space on `document.body` calls `toggle`; ArrowRight calls `seek(timeMs + 5000)`; Space inside the timeline input, or on a focused button (the page's handler must leave that to the button's own click), does not call `toggle`. A group whose `status` is `failed` shows no Download button.
    5. **Download menu:** its items are the labels `downloadItems` gives. Clicking "Galaxy S9+: video with annotations" calls `startDownload` with the annotated URL.
    6. **Delete by role.**
       - A MEMBER who isn't Alice sees no Delete.
       - Alice does. Confirming in the dialog titled "Delete this recording?" calls `deleteRecording('g1')`, toasts "Recording deleted" (success) and lands on `/recordings`.
       - A 403 (`RecordingRequestError(403, 'not_owner')`) shows "Only the person who recorded it, or an admin, can delete it." in the dialog, and stays.
    7. **Unavailable:** `getRecording` rejecting with `RecordingRequestError(404, 'not_found')` shows "This recording isn't available" and a link back.
    8. **Still recording:** `summary.status` 'recording' shows "Still recording" with a link to `/devices/live`, no tiles, and a disabled Delete with the reason "Stop the recording on Live devices first." as its accessible description.
- [ ] **Step 2: Run** it. It should FAIL, because the stub renders nothing.
- [ ] **Step 3: Implement** `RecordingPage.tsx`:

```tsx
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Film, Pause, Play, RefreshCw, Trash2 } from 'lucide-react';
import {
  deleteRecording,
  getRecording,
  RecordingRequestError,
  sourceMp4Url,
  type GroupAnnotation,
  type PhoneSummary,
  type RecordingDetail,
} from '../../api-service/recordings';
import { useAuth } from '../../auth/auth-context';
import { PageHeader } from '../ui/page-header';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { Modal } from '../ui/Modal';
import { Popover } from '../ui/Popover';
import { Menu, MenuItem } from '../ui/Menu';
import { useToast } from '../ui/toast';
import AnnotationOverlay from '../mosaic/AnnotationOverlay';
import { formatWhen } from './RecordingsPage';
import { clampTime, formatClock, positionPct, SKIP_MS, tilePhase, toOverlay, visibleAt } from './playback';
import { canDelete, deleteErrorMessage, downloadItems, startDownload } from './recordingActions';
import { useSyncedPlayback } from './useSyncedPlayback';
import './recordings.css';
```

Check how `AnnotationOverlay` is exported (default or named) in `web/src/components/mosaic/AnnotationOverlay.tsx`, and import it the same way the mosaic does.

The components below live in this file:

```tsx
const noop = () => undefined;
const STOP_FIRST = 'Stop the recording on Live devices first.';

/** Focus is somewhere keys mean something else. */
function typingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || !node.closest) return false;
  return (
    !!node.closest('input, select, textarea, [contenteditable="true"], [role="dialog"], [role="menu"]')
  );
}

function PlaybackTile({
  groupId, phone, timeMs, marks, showMarks, bind,
}: {
  groupId: string;
  phone: PhoneSummary;
  timeMs: number;
  marks: GroupAnnotation[];
  showMarks: boolean;
  bind: ReturnType<typeof useSyncedPlayback>['bind'];
}) {
  const [broken, setBroken] = React.useState(false);
  const [aspect, setAspect] = React.useState<number | undefined>(undefined);
  const failed = phone.status === 'FAILED' || phone.status === 'DISCARDED';
  const phase = tilePhase(timeMs, phone.offsetMs, phone.durationMs);
  const overlay = visibleAt(marks, timeMs)
    .map(toOverlay)
    .filter((a): a is NonNullable<ReturnType<typeof toOverlay>> => a !== null);
  let note: string | null = null;
  if (failed) note = `Recording failed: ${phone.failReason ?? 'unknown reason'}`;
  else if (broken) note = 'Video no longer available';
  else if (phase === 'before') note = `Joined at ${formatClock(phone.offsetMs)}`;
  return (
    <figure className="rec-tile theme-dark" aria-label={phone.name}>
      <figcaption className="rec-tile-name" title={phone.name}>
        {phone.name}
      </figcaption>
      <div className="rec-tile-screen">
        {!failed && (
          <video
            className="rec-tile-video"
            muted
            playsInline
            preload="auto"
            src={sourceMp4Url(groupId, phone.recordingId)}
            ref={bind(phone.recordingId, { offsetMs: phone.offsetMs, durationMs: phone.durationMs })}
            onError={() => setBroken(true)}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth > 0 && v.videoHeight > 0) setAspect(v.videoWidth / v.videoHeight);
            }}
          />
        )}
        {!failed && showMarks && (
          <AnnotationOverlay
            enabled={false}
            shape="RECT"
            color="currentColor"
            onCommit={noop}
            committed={overlay}
            mediaAspect={aspect}
          />
        )}
        {note && <div className="rec-tile-note">{note}</div>}
      </div>
    </figure>
  );
}

function DownloadMenu({ detail }: { detail: RecordingDetail }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={ref} variant="secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Download size={14} aria-hidden="true" />
        Download
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref}>
        <Menu>
          {downloadItems(detail.summary).map((item) => (
            <MenuItem
              key={item.key}
              onClick={() => {
                setOpen(false);
                startDownload(item.url);
              }}
            >
              {item.label}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </>
  );
}
```

Match `Popover`'s real props (`open`, `onClose`, `anchorRef`, optional `placement`) against `web/src/components/ui/Popover.tsx`. Also check that `Button` forwards `ref`: it is a `React.forwardRef`.

The page:

```tsx
export default function RecordingPage() {
  const { groupId = '' } = useParams();
  const navigate = useNavigate();
  const { me } = useAuth();
  const { toast } = useToast();
  const [detail, setDetail] = React.useState<RecordingDetail | null>(null);
  const [failure, setFailure] = React.useState<{ missing: boolean; message: string } | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [showMarks, setShowMarks] = React.useState(true);
  const [confirming, setConfirming] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setFailure(null);
    getRecording(groupId)
      .then((d) => live && setDetail(d))
      .catch((e) => {
        if (!live) return;
        setFailure({
          missing: e instanceof RecordingRequestError && e.status === 404,
          message: e instanceof Error ? e.message : String(e),
        });
      });
    return () => {
      live = false;
    };
  }, [groupId, reloadKey]);

  const duration = detail?.summary.durationMs ?? 0;
  const pb = useSyncedPlayback(duration);

  React.useEffect(() => {
    if (!detail || detail.summary.status === 'recording') return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (typingTarget(e.target)) return;
      // Space on a focused button or link is that control's own click; handling
      // it here too would toggle twice.
      if (e.key === ' ' && (e.target as HTMLElement | null)?.closest?.('button, a, label')) return;
      if (e.key === ' ') {
        e.preventDefault();
        pb.toggle();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        pb.seek(clampTime(pb.timeMs + SKIP_MS, duration));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        pb.seek(clampTime(pb.timeMs - SKIP_MS, duration));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [detail, pb, duration]);

  if (failure) {
    return failure.missing ? (
      <EmptyState
        title="This recording isn't available"
        description="It may have been deleted, or it's on phones you can't see."
        action={<Link className="rec-link" to="/recordings">Back to Recordings</Link>}
      />
    ) : (
      <EmptyState
        title="Couldn't load this recording"
        description={failure.message}
        action={
          <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw size={14} aria-hidden="true" />
            Retry
          </Button>
        }
      />
    );
  }
  if (!detail) return <EmptyState title="Loading recording…" />;

  const { summary, bookmarks, annotations } = detail;
  const running = summary.status === 'recording';
  const names = summary.phones.map((p) => p.name).join(', ');
  const nameOf = (recordingId: string) =>
    summary.phones.find((p) => p.recordingId === recordingId)?.name ?? '';
  const subtitle = [
    names,
    summary.durationMs === null ? null : `Length ${formatClock(summary.durationMs)}`,
    `Recorded by ${summary.startedBy?.name ?? 'Unknown'}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const allowDelete = canDelete(summary, me);

  const confirmDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteRecording(groupId);
      toast('Recording deleted', 'success');
      navigate('/recordings');
    } catch (e) {
      setDeleteError(deleteErrorMessage(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="rec-page">
      <nav className="rec-backbar">
        <Link className="rec-link" to="/recordings">
          <ArrowLeft size={14} aria-hidden="true" /> Recordings
        </Link>
      </nav>
      <PageHeader
        icon={Film}
        title={formatWhen(summary.startedAt)}
        subtitle={subtitle}
        action={
          <>
            {!running && summary.status !== 'failed' && <DownloadMenu detail={detail} />}
            {allowDelete && (
              <>
                <Button
                  variant="danger"
                  disabled={running}
                  aria-describedby={running ? 'rec-delete-reason' : undefined}
                  title={running ? STOP_FIRST : undefined}
                  onClick={() => setConfirming(true)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  Delete
                </Button>
                {running && (
                  <span id="rec-delete-reason" className="sr-only">
                    {STOP_FIRST}
                  </span>
                )}
              </>
            )}
          </>
        }
      />
      {running ? (
        <EmptyState
          title="Still recording"
          description="Stop it on Live devices to play it here."
          action={<Link className="rec-link" to="/devices/live">Open Live devices</Link>}
        />
      ) : (
        <div className={`rec-body${bookmarks.length > 0 ? ' rec-body--with-list' : ''}`}>
          <div className="rec-player">
            <div className="rec-grid">
              {summary.phones.map((p) => (
                <PlaybackTile
                  key={p.recordingId}
                  groupId={groupId}
                  phone={p}
                  timeMs={pb.timeMs}
                  marks={annotations.filter((a) => a.recordingId === p.recordingId)}
                  showMarks={showMarks}
                  bind={pb.bind}
                />
              ))}
            </div>
            <div className="rec-transport">
              <Button variant="secondary" size="icon" aria-label={pb.playing ? 'Pause' : 'Play'} onClick={pb.toggle}>
                {pb.playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
              </Button>
              <span className="rec-num rec-clock">
                {formatClock(pb.timeMs)} / {formatClock(duration)}
              </span>
              <div className="rec-timeline">
                <input
                  type="range"
                  className="rec-range"
                  aria-label="Timeline"
                  aria-valuetext={`${formatClock(pb.timeMs)} of ${formatClock(duration)}`}
                  min={0}
                  max={duration}
                  step={100}
                  value={pb.timeMs}
                  onChange={(e) => pb.seek(Number(e.target.value))}
                />
                {bookmarks.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className="rec-mark"
                    style={{ left: `${positionPct(b.timecodeMs, duration)}%` }}
                    title={b.label}
                    aria-label={`Bookmark: ${b.label}, ${formatClock(b.timecodeMs)}`}
                    onClick={() => pb.seek(b.timecodeMs)}
                  />
                ))}
              </div>
              {pb.waiting && (
                <span role="status" className="rec-waiting">
                  Buffering…
                </span>
              )}
              {summary.annotationCount > 0 && (
                <label className="rec-toggle">
                  <input type="checkbox" checked={showMarks} onChange={(e) => setShowMarks(e.target.checked)} />
                  Annotations
                </label>
              )}
            </div>
          </div>
          {bookmarks.length > 0 && (
            <section className="rec-bookmarks" aria-labelledby="rec-bookmarks-title">
              <h2 id="rec-bookmarks-title" className="rec-bookmarks-title">
                Bookmarks
              </h2>
              <ol className="rec-bookmark-list">
                {bookmarks.map((b) => (
                  <li key={b.id}>
                    <button type="button" className="rec-bookmark" onClick={() => pb.seek(b.timecodeMs)}>
                      <span className="rec-bookmark-label">{b.label}</span>
                      <span className="rec-num rec-bookmark-meta">
                        {formatClock(b.timecodeMs)} · {nameOf(b.recordingId)}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
      <Modal
        open={confirming}
        title="Delete this recording?"
        onClose={() => {
          setConfirming(false);
          setDeleteError(null);
        }}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
              Delete
            </Button>
          </>
        }
      >
        <p>Its videos, bookmarks and annotations are removed for everyone.</p>
        {deleteError && (
          <p role="alert" className="rec-error">
            {deleteError}
          </p>
        )}
      </Modal>
    </div>
  );
}
```

Hand-fix Prettier formatting. The keyboard effect depends on `pb`, which changes every render. That is acceptable, since it only re-attaches a listener. Keep it simple.

**`recordings.css`**, append (tokens only; the tiles are a `theme-dark` island, so they need an opaque background):

```css
.rec-backbar {
  padding: 12px 24px 0;
  font-size: 13px;
}
.rec-backbar .rec-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
}

.rec-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  padding: 16px 20px 20px;
}
.rec-body--with-list {
  grid-template-columns: minmax(0, 1fr) 260px;
}

.rec-player {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.rec-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.rec-tile {
  margin: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.rec-tile-name {
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rec-tile-screen {
  position: relative;
  height: min(56vh, 520px);
  background: var(--bg);
}
.rec-tile-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.rec-tile-note {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text);
  background: rgb(var(--rgb-black) / calc(0.55 * var(--shadow-k)));
}

.rec-transport {
  display: flex;
  align-items: center;
  gap: 12px;
}
.rec-clock {
  font-size: 12px;
  color: var(--text-muted);
  min-width: 96px;
}
.rec-timeline {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}
.rec-range {
  width: 100%;
  accent-color: var(--color-accent);
}
.rec-mark {
  position: absolute;
  top: -10px;
  width: 10px;
  height: 10px;
  padding: 0;
  transform: translateX(-50%) rotate(45deg);
  border: 1px solid var(--bg);
  background: var(--color-highlight);
  cursor: pointer;
}
.rec-mark:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}
.rec-waiting {
  font-size: 12px;
  color: var(--text-muted);
}
.rec-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.rec-bookmarks {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px;
  align-self: start;
}
.rec-bookmarks-title {
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 8px;
}
.rec-bookmark-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rec-bookmark {
  width: 100%;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border-radius: var(--radius-md);
  background: transparent;
  border: 0;
  color: var(--text);
  cursor: pointer;
}
.rec-bookmark:hover {
  background: var(--surface-2);
}
.rec-bookmark:focus-visible {
  outline: 2px solid var(--color-focus-ring);
}
.rec-bookmark-label {
  font-size: 13px;
}
.rec-bookmark-meta {
  font-size: 11px;
  color: var(--text-muted);
}
.rec-error {
  color: var(--color-danger);
  margin-top: 8px;
}
```

Check that `--rgb-black`, `--shadow-k`, `--bg`, `--surface`, `--color-highlight`, `--color-danger`, `--radius-md` and `--color-accent` all exist in `web/src/tokens.css`; use the nearest role token if one doesn't. The `.rec-mark` tint is a role token.

- [ ] **Step 4: Run** the page tests (they should PASS), the whole web suite once, and `npx vitest run src/design` (the colour ratchet and button-class guards). Then tsc (0), and eslint on the new and changed files (0, or ≤ base).
- [ ] **Step 5: Commit** `feat(recordings): the recording page — every phone in sync, with bookmarks, marks, downloads and delete`.

---

### Task 9: Viewport coverage, live check, PR (controller)

- [ ] **Viewport** (`web/test/viewport/overflow.spec.ts`):
  - Add `'/xenon/recordings'` and `'/xenon/recordings/g-mock-1'` to `ROUTES`.
  - `ROUTE_DATA_MOCKS`: route `**/xenon/api/recordings?*` and `**/xenon/api/recordings` to a hostile list:
    - three summaries: one with five phones whose names are over 60 characters, a >60-char `startedBy` name, 12 bookmarks, one running and one failed;
    - facets and retention.
  - Route `**/xenon/api/recordings/g-mock-1` to a detail:
    - four phones, one failed and one joined late;
    - 12 bookmarks with long labels, and annotations.
  - Abort `**/source.mp4*`.
  - `ROUTE_CONTENT_CHECKS`: the library has `table.rec-table tbody tr` rows (not zero), and the recording page has `.rec-tile` (4) and `.rec-bookmark` (not zero).
  - Run `npm run test:viewport` against the rebuilt lab server.
- [ ] **Migration gates:**
  - `DATABASE_URL='file:./ci-check.db' npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code`
  - `node scripts/check-client-freshness.js`
  - `node mac-app/scripts/sync-tokens.mjs --check`
- [ ] **Restart a real server** on this build (the schema changed, and Appium validates config at boot). Then run **live on the S9+ and the iPhone together**:
  - record with a bookmark (via `POST /recordings/:groupId/bookmark` from the page context) and an annotation;
  - open the recording from Live devices ("Open in Recordings") and from the library;
  - play in sync, then seek: drag the timeline, press ← and →, and jump to the bookmark;
  - confirm the mark shows on the right phone at the right time;
  - download each item;
  - delete as the owner, and confirm the files are gone from `~/.cache/xenon/assets/sessions/recordings/`;
  - probe contrast in both themes.
- [ ] **Suites:** server `ANDROID_HOME=… npm run test:all`, the whole web suite, tsc for both, lint compared with main.
- [ ] **PR:** push, open it with `--body-file` listing the adjustments to the spec, bind it and report.
