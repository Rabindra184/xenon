# Bug Report Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click button that bundles a session's video, logs, HAR, AI summary, and metadata into a downloadable zip suitable for attaching to a Jira/Linear/GitHub ticket.

**Architecture:** A `BugReportService` orchestrates artifact collection, applies `redactSecrets()`, and streams a zip via `archiver` to the HTTP response. A new `POST /api/sessions/:sessionId/bug-report` route exposes it. Frontend mounts a button in two places: floating on the live device-control view (slice mode, last 60s) and inline on the session-detail header (full mode).

**Tech Stack:** TypeScript, Express, TypeDI, Prisma, `archiver@7.0.1`, `ffmpeg` (already a runtime dep), Mocha + Chai + Sinon, React 17.

**Spec:** `docs/superpowers/specs/2026-04-26-bug-report-button-design.md`

---

## File Structure

| File | Purpose |
|---|---|
| `src/services/bug-report/BugReportService.ts` | Orchestrator. Has `generate(sessionId, opts)` that produces a stream + filename. |
| `src/services/bug-report/manifest.ts` | Pure function `buildManifest(inputs): Manifest`. No I/O. |
| `src/services/bug-report/window.ts` | Pure function `resolveWindow(session, mode, windowSec): { startedAt, endedAt, durationMs, requestedDurationMs }`. |
| `src/services/bug-report/readme.ts` | Pure function `buildReadme(manifest): string`. |
| `src/services/bug-report/video-slice.ts` | Wraps ffmpeg invocation. Returns `{ tmpPath } \| { error }`. |
| `src/services/bug-report/har-collector.ts` | Reads HAR from `InterceptorService` (live) or `loadArchivedHar` (archived). Returns redacted JSON string. |
| `src/services/bug-report/types.ts` | Shared types: `BugReportMode`, `BugReportOptions`, `Manifest`, `Window`, `Warning`. |
| `src/app/routers/bug-report.ts` | Express route + zod-style param validation. Mirrors `interceptor.ts` shape. |
| `src/app/index.ts` | Register the new router (1 import + 1 line in `createRouter`). |
| `src/app/swagger-docs.ts` | Add `/sessions/{sessionId}/bug-report` JSDoc block. |
| `src/enums/SocketEvents.ts` | Add `BUG_REPORT_GENERATED = 'bug_report_generated'`. |
| `web/src/api-service/bug-report.ts` | `downloadBugReport(opts)` — fetch + blob + `<a>` download. |
| `web/src/components/bug-report/BugReportButton.tsx` | Single React component, two variants (`floating` / `inline`). |
| `web/src/components/device-control/device-control.tsx` | Mount `<BugReportButton variant="floating" mode="slice" />`. |
| `web/src/components/session-detail/breadcrumb-header.tsx` | Mount `<BugReportButton variant="inline" mode="full" />`. |
| `test/unit/bug-report/window.spec.ts` | Unit tests for `resolveWindow`. |
| `test/unit/bug-report/manifest.spec.ts` | Unit tests for `buildManifest`. |
| `test/unit/bug-report/redact.spec.ts` | Unit tests for redaction surface. |
| `test/integration/bug-report-route.spec.ts` | End-to-end zip generation against fixture session. |

---

## Conventions (read first)

- **TDD:** every code task = (a) write failing test, (b) run + see fail, (c) write minimal impl, (d) run + see pass, (e) commit.
- **Run a single test file:** `npx mocha --require ts-node/register test/unit/<path>.spec.ts`
- **Run all unit tests:** `npm test`
- **Lint:** `npm run lint` after each task.
- **Branch:** all work goes on `docs/bug-report-button-spec` (already created by the spec PR).
- **Commits:** Conventional Commits (`feat(bug-report): ...`, `test(bug-report): ...`).
- **Never bypass hooks** with `--no-verify`.

---

## Task 1: Shared types

**Files:**
- Create: `src/services/bug-report/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/services/bug-report/types.ts
export type BugReportMode = 'slice' | 'full';

export interface BugReportOptions {
  sessionId: string;
  mode: BugReportMode;
  windowSec?: number;        // slice only; default 60
}

export interface ResolvedWindow {
  startedAt: string;          // ISO-8601
  endedAt: string;            // ISO-8601
  durationMs: number;
  requestedDurationMs: number;
}

export interface ManifestArtifacts {
  video: string | null;
  logs: string;
  network: string | null;
  aiSummary: string | null;
  screenshots: string[];
}

export interface Manifest {
  schemaVersion: '1.0';
  generatedAt: string;        // ISO-8601
  xenonVersion: string;
  mode: BugReportMode;
  window: ResolvedWindow;
  session: {
    id: string;
    status: string;
    startedAt: string | null;
    endedAt: string | null;
    durationMs: number | null;
  };
  device: {
    udid: string;
    platform: string;
    name: string | null;
    osVersion: string;
  };
  capabilities: Record<string, unknown>;
  lastCommand: { name: string; args: unknown; errorMessage: string | null } | null;
  artifacts: ManifestArtifacts;
  warnings: string[];
}

export const SLICE_DEFAULT_SEC = 60;
export const SLICE_MIN_SEC = 5;
export const SLICE_MAX_SEC = 600;
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/services/bug-report/types.ts`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add src/services/bug-report/types.ts
git commit -m "feat(bug-report): add shared types"
```

---

## Task 2: `resolveWindow()` pure function

**Files:**
- Create: `src/services/bug-report/window.ts`
- Test: `test/unit/bug-report/window.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/unit/bug-report/window.spec.ts
import { expect } from 'chai';
import { resolveWindow } from '../../../src/services/bug-report/window';

const FIXED_NOW = new Date('2026-04-26T10:00:00.000Z').getTime();

function session(overrides: Partial<{ startTime: string; endTime: string | null }>) {
  return {
    startTime: '2026-04-26T09:50:00.000Z',
    endTime: '2026-04-26T09:55:00.000Z',
    ...overrides,
  } as any;
}

describe('resolveWindow', () => {
  it('mode=full returns the entire session', () => {
    const w = resolveWindow(session({}), 'full', undefined, FIXED_NOW);
    expect(w.startedAt).to.equal('2026-04-26T09:50:00.000Z');
    expect(w.endedAt).to.equal('2026-04-26T09:55:00.000Z');
    expect(w.durationMs).to.equal(5 * 60 * 1000);
    expect(w.requestedDurationMs).to.equal(5 * 60 * 1000);
  });

  it('mode=full uses now() if endTime is null', () => {
    const w = resolveWindow(session({ endTime: null }), 'full', undefined, FIXED_NOW);
    expect(w.endedAt).to.equal('2026-04-26T10:00:00.000Z');
    expect(w.durationMs).to.equal(10 * 60 * 1000);
  });

  it('mode=slice anchors to endTime, default 60s', () => {
    const w = resolveWindow(session({}), 'slice', undefined, FIXED_NOW);
    expect(w.endedAt).to.equal('2026-04-26T09:55:00.000Z');
    expect(w.startedAt).to.equal('2026-04-26T09:54:00.000Z');
    expect(w.durationMs).to.equal(60 * 1000);
    expect(w.requestedDurationMs).to.equal(60 * 1000);
  });

  it('mode=slice uses now() if endTime is null (live session)', () => {
    const w = resolveWindow(session({ endTime: null }), 'slice', 30, FIXED_NOW);
    expect(w.endedAt).to.equal('2026-04-26T10:00:00.000Z');
    expect(w.startedAt).to.equal('2026-04-26T09:59:30.000Z');
    expect(w.durationMs).to.equal(30 * 1000);
  });

  it('mode=slice clamps to session.startTime when window is larger than session', () => {
    const w = resolveWindow(
      session({ startTime: '2026-04-26T09:54:30.000Z', endTime: '2026-04-26T09:55:00.000Z' }),
      'slice',
      60,
      FIXED_NOW,
    );
    expect(w.startedAt).to.equal('2026-04-26T09:54:30.000Z'); // clamped
    expect(w.endedAt).to.equal('2026-04-26T09:55:00.000Z');
    expect(w.durationMs).to.equal(30 * 1000);
    expect(w.requestedDurationMs).to.equal(60 * 1000);
  });

  it('throws on invalid windowSec', () => {
    expect(() => resolveWindow(session({}), 'slice', 0, FIXED_NOW)).to.throw(/windowSec/);
    expect(() => resolveWindow(session({}), 'slice', 1000, FIXED_NOW)).to.throw(/windowSec/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx mocha --require ts-node/register test/unit/bug-report/window.spec.ts`
Expected: FAIL with `Cannot find module ... window`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/services/bug-report/window.ts
import {
  BugReportMode,
  ResolvedWindow,
  SLICE_DEFAULT_SEC,
  SLICE_MIN_SEC,
  SLICE_MAX_SEC,
} from './types';

interface SessionLike {
  startTime: string | Date;
  endTime: string | Date | null;
}

export function resolveWindow(
  session: SessionLike,
  mode: BugReportMode,
  windowSec: number | undefined,
  nowMs: number = Date.now(),
): ResolvedWindow {
  const startMs = new Date(session.startTime).getTime();
  const endMs = session.endTime ? new Date(session.endTime).getTime() : nowMs;

  if (mode === 'full') {
    return {
      startedAt: new Date(startMs).toISOString(),
      endedAt: new Date(endMs).toISOString(),
      durationMs: endMs - startMs,
      requestedDurationMs: endMs - startMs,
    };
  }

  const sec = windowSec ?? SLICE_DEFAULT_SEC;
  if (sec < SLICE_MIN_SEC || sec > SLICE_MAX_SEC) {
    throw new Error(`windowSec must be between ${SLICE_MIN_SEC} and ${SLICE_MAX_SEC}, got ${sec}`);
  }
  const requestedMs = sec * 1000;
  const sliceStartMs = Math.max(endMs - requestedMs, startMs);
  return {
    startedAt: new Date(sliceStartMs).toISOString(),
    endedAt: new Date(endMs).toISOString(),
    durationMs: endMs - sliceStartMs,
    requestedDurationMs: requestedMs,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx mocha --require ts-node/register test/unit/bug-report/window.spec.ts`
Expected: 6 passing.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint -- src/services/bug-report/window.ts test/unit/bug-report/window.spec.ts
git add src/services/bug-report/window.ts test/unit/bug-report/window.spec.ts
git commit -m "feat(bug-report): add resolveWindow() for slice/full mode"
```

---

## Task 3: `buildManifest()` pure function

**Files:**
- Create: `src/services/bug-report/manifest.ts`
- Test: `test/unit/bug-report/manifest.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/unit/bug-report/manifest.spec.ts
import { expect } from 'chai';
import { buildManifest } from '../../../src/services/bug-report/manifest';
import { ResolvedWindow } from '../../../src/services/bug-report/types';

const window: ResolvedWindow = {
  startedAt: '2026-04-26T09:54:00.000Z',
  endedAt: '2026-04-26T09:55:00.000Z',
  durationMs: 60000,
  requestedDurationMs: 60000,
};

const session = {
  id: 'sess-1',
  status: 'failed',
  startTime: new Date('2026-04-26T09:50:00.000Z'),
  endTime: new Date('2026-04-26T09:55:00.000Z'),
  device_udid: 'PIXEL7-ABC',
  device_platform: 'android',
  device_name: 'Pixel 7',
  device_version: '14',
  desired_capabilities: JSON.stringify({ app: 'foo.apk', apiKey: 'sk-secret' }),
  failure_reason: 'TimeoutError: element not found',
  ai_analysis: 'The app stalled before login.',
};

describe('buildManifest', () => {
  it('produces schema-stable output', () => {
    const m = buildManifest({
      session: session as any,
      window,
      mode: 'slice',
      xenonVersion: '0.0.0-test',
      generatedAt: '2026-04-26T10:00:00.000Z',
      artifacts: {
        video: 'video.mp4',
        logs: 'logs.txt',
        network: 'network.har',
        aiSummary: 'ai-summary.txt',
        screenshots: ['screenshots/last-frame.png'],
      },
      warnings: [],
    });
    expect(m.schemaVersion).to.equal('1.0');
    expect(m.session.id).to.equal('sess-1');
    expect(m.device.platform).to.equal('android');
    expect(m.window.durationMs).to.equal(60000);
    expect(m.lastCommand?.errorMessage).to.equal('TimeoutError: element not found');
  });

  it('redacts capability secrets', () => {
    const m = buildManifest({
      session: session as any,
      window,
      mode: 'slice',
      xenonVersion: '0.0.0-test',
      generatedAt: '2026-04-26T10:00:00.000Z',
      artifacts: {
        video: null, logs: 'logs.txt', network: null, aiSummary: null, screenshots: [],
      },
      warnings: [],
    });
    expect(JSON.stringify(m.capabilities)).to.not.include('sk-secret');
  });

  it('handles null endTime / status=running', () => {
    const m = buildManifest({
      session: { ...session, endTime: null, status: 'running' } as any,
      window,
      mode: 'slice',
      xenonVersion: '0.0.0-test',
      generatedAt: '2026-04-26T10:00:00.000Z',
      artifacts: {
        video: null, logs: 'logs.txt', network: null, aiSummary: null, screenshots: [],
      },
      warnings: ['video slice failed: ffmpeg exited 1'],
    });
    expect(m.session.endedAt).to.equal(null);
    expect(m.session.durationMs).to.equal(null);
    expect(m.warnings).to.deep.equal(['video slice failed: ffmpeg exited 1']);
  });

  it('passes JSON.stringify round-trip without throwing', () => {
    const m = buildManifest({
      session: session as any,
      window,
      mode: 'full',
      xenonVersion: '0.0.0-test',
      generatedAt: '2026-04-26T10:00:00.000Z',
      artifacts: {
        video: 'video.mp4', logs: 'logs.txt', network: null, aiSummary: null, screenshots: [],
      },
      warnings: [],
    });
    expect(() => JSON.parse(JSON.stringify(m))).to.not.throw();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx mocha --require ts-node/register test/unit/bug-report/manifest.spec.ts`
Expected: FAIL — `Cannot find module ... manifest`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/services/bug-report/manifest.ts
import { redactSecrets } from '../../logger';
import {
  BugReportMode,
  Manifest,
  ManifestArtifacts,
  ResolvedWindow,
} from './types';

interface SessionRow {
  id: string;
  status: string;
  startTime: Date | string;
  endTime: Date | string | null;
  device_udid: string;
  device_platform: string;
  device_name: string | null;
  device_version: string;
  desired_capabilities: string | null;
  failure_reason: string | null;
  ai_analysis: string | null;
}

export interface BuildManifestInput {
  session: SessionRow;
  window: ResolvedWindow;
  mode: BugReportMode;
  xenonVersion: string;
  generatedAt: string;
  artifacts: ManifestArtifacts;
  warnings: string[];
}

function parseCaps(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function iso(d: Date | string | null): string | null {
  if (!d) return null;
  return new Date(d).toISOString();
}

export function buildManifest(input: BuildManifestInput): Manifest {
  const startedAt = iso(input.session.startTime);
  const endedAt = iso(input.session.endTime);
  const durationMs =
    startedAt && endedAt
      ? new Date(endedAt).getTime() - new Date(startedAt).getTime()
      : null;

  const caps = redactSecrets(parseCaps(input.session.desired_capabilities));

  const lastCommand = input.session.failure_reason
    ? { name: 'unknown', args: null, errorMessage: input.session.failure_reason }
    : null;

  return {
    schemaVersion: '1.0',
    generatedAt: input.generatedAt,
    xenonVersion: input.xenonVersion,
    mode: input.mode,
    window: input.window,
    session: {
      id: input.session.id,
      status: input.session.status,
      startedAt,
      endedAt,
      durationMs,
    },
    device: {
      udid: input.session.device_udid,
      platform: input.session.device_platform,
      name: input.session.device_name,
      osVersion: input.session.device_version,
    },
    capabilities: caps,
    lastCommand,
    artifacts: input.artifacts,
    warnings: input.warnings,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx mocha --require ts-node/register test/unit/bug-report/manifest.spec.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
npm run lint -- src/services/bug-report/manifest.ts test/unit/bug-report/manifest.spec.ts
git add src/services/bug-report/manifest.ts test/unit/bug-report/manifest.spec.ts
git commit -m "feat(bug-report): add buildManifest() with redacted capabilities"
```

---

## Task 4: README generator

**Files:**
- Create: `src/services/bug-report/readme.ts`
- Test: `test/unit/bug-report/readme.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/unit/bug-report/readme.spec.ts
import { expect } from 'chai';
import { buildReadme } from '../../../src/services/bug-report/readme';
import { Manifest } from '../../../src/services/bug-report/types';

const M: Manifest = {
  schemaVersion: '1.0',
  generatedAt: '2026-04-26T10:00:00.000Z',
  xenonVersion: '1.2.3',
  mode: 'slice',
  window: {
    startedAt: '2026-04-26T09:59:00.000Z',
    endedAt: '2026-04-26T10:00:00.000Z',
    durationMs: 60000,
    requestedDurationMs: 60000,
  },
  session: { id: 'sess-1', status: 'failed', startedAt: '2026-04-26T09:50:00.000Z', endedAt: '2026-04-26T10:00:00.000Z', durationMs: 600000 },
  device: { udid: 'X', platform: 'android', name: 'Pixel 7', osVersion: '14' },
  capabilities: {},
  lastCommand: { name: 'click', args: null, errorMessage: 'TimeoutError' },
  artifacts: { video: 'video.mp4', logs: 'logs.txt', network: 'network.har', aiSummary: 'ai-summary.txt', screenshots: [] },
  warnings: [],
};

describe('buildReadme', () => {
  it('renders core fields', () => {
    const out = buildReadme(M, 'The app stalled before login.');
    expect(out).to.include('# Xenon Bug Report');
    expect(out).to.include('sess-1');
    expect(out).to.include('Pixel 7');
    expect(out).to.include('Android 14');
    expect(out).to.include('slice');
    expect(out).to.include('The app stalled before login.');
    expect(out).to.include('TimeoutError');
  });

  it('handles missing AI summary', () => {
    const out = buildReadme(M, null);
    expect(out).to.include('(not available)');
  });
});
```

- [ ] **Step 2: Run to fail**

Run: `npx mocha --require ts-node/register test/unit/bug-report/readme.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/services/bug-report/readme.ts
import { Manifest } from './types';

function platformDisplay(p: string): string {
  if (p === 'android') return 'Android';
  if (p === 'ios') return 'iOS';
  return p;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export function buildReadme(m: Manifest, aiSummary: string | null): string {
  const lines: string[] = [];
  lines.push('# Xenon Bug Report');
  lines.push('');
  lines.push(`**Session:** ${m.session.id} (${m.session.status}, ${formatDuration(m.session.durationMs)})`);
  lines.push(`**Device:** ${m.device.name ?? m.device.udid} / ${platformDisplay(m.device.platform)} ${m.device.osVersion}`);
  lines.push(`**Generated:** ${m.generatedAt}`);
  lines.push(`**Mode:** ${m.mode}${m.mode === 'slice' ? ` (last ${Math.round(m.window.requestedDurationMs / 1000)}s)` : ''}`);
  lines.push('');
  lines.push('## AI Summary');
  lines.push('');
  lines.push(aiSummary ?? '(not available)');
  lines.push('');
  lines.push('## Last command');
  lines.push('');
  lines.push(m.lastCommand?.errorMessage ?? '(no error captured)');
  lines.push('');
  lines.push('## Artifacts');
  lines.push('');
  if (m.artifacts.video) lines.push(`- ${m.artifacts.video}`);
  lines.push(`- ${m.artifacts.logs}`);
  if (m.artifacts.network) lines.push(`- ${m.artifacts.network}`);
  if (m.artifacts.aiSummary) lines.push(`- ${m.artifacts.aiSummary}`);
  for (const s of m.artifacts.screenshots) lines.push(`- ${s}`);
  if (m.warnings.length) {
    lines.push('');
    lines.push('## Warnings');
    lines.push('');
    for (const w of m.warnings) lines.push(`- ${w}`);
  }
  lines.push('');
  return lines.join('\n');
}
```

- [ ] **Step 4: Run to pass**

Run: `npx mocha --require ts-node/register test/unit/bug-report/readme.spec.ts`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
npm run lint -- src/services/bug-report/readme.ts test/unit/bug-report/readme.spec.ts
git add src/services/bug-report/readme.ts test/unit/bug-report/readme.spec.ts
git commit -m "feat(bug-report): add README generator"
```

---

## Task 5: HAR collector

**Files:**
- Create: `src/services/bug-report/har-collector.ts`
- Test: `test/unit/bug-report/har-collector.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/unit/bug-report/har-collector.spec.ts
import { expect } from 'chai';
import sinon from 'sinon';
import * as fs from 'fs';
import { collectHar } from '../../../src/services/bug-report/har-collector';
import { InterceptorService } from '../../../src/services/InterceptorService';
import { Container } from 'typedi';

describe('collectHar', () => {
  afterEach(() => sinon.restore());

  it('returns null when interceptor inactive and no archive', () => {
    sinon.stub(InterceptorService.prototype, 'isActive').returns(false);
    sinon.stub(fs, 'existsSync').returns(false);
    const out = collectHar('sess-1', '/tmp/assets');
    expect(out).to.equal(null);
  });

  it('returns redacted HAR JSON when interceptor active (regex-matched API key in header value)', () => {
    // Note: redactSecrets matches: (a) sensitive key names like "password"/"apikey" (deep object walk)
    // and (b) API-key-shaped substrings inside string values (sk-[a-zA-Z0-9]{32,} or AIza[...]{35}).
    // HAR headers are an array of {name, value}, so name-based redaction doesn't fire — we rely on
    // the regex catching realistically-shaped keys.
    const realisticKey = 'sk-' + 'a'.repeat(48); // matches sk-[a-zA-Z0-9]{32,}
    sinon.stub(InterceptorService.prototype, 'isActive').returns(true);
    sinon.stub(InterceptorService.prototype, 'exportHar').returns({
      log: {
        version: '1.2',
        creator: { name: 'Xenon', version: '1.0' },
        entries: [
          {
            startedDateTime: '2026-04-26T09:55:00.000Z',
            time: 100,
            request: {
              method: 'POST',
              url: 'https://example.com/login',
              headers: [{ name: 'Authorization', value: `Bearer ${realisticKey}` }],
              postData: { mimeType: 'application/json', text: `{"apiKey":"${realisticKey}"}` },
            },
            response: { status: 200, headers: [], content: { mimeType: 'application/json', text: '{}' } },
          },
        ],
      } as any,
    } as any);
    Container.set(InterceptorService, new InterceptorService());
    const out = collectHar('sess-1', '/tmp/assets');
    expect(out).to.be.a('string');
    expect(out).to.not.include(realisticKey);
    expect(out).to.include('***REDACTED***');
  });
});
```

- [ ] **Step 2: Run to fail**

Run: `npx mocha --require ts-node/register test/unit/bug-report/har-collector.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/services/bug-report/har-collector.ts
import { Container } from 'typedi';
import { InterceptorService } from '../../services/InterceptorService';
import { loadArchivedHar } from '../../services/interceptor/SessionArchive';
import { redactSecrets } from '../../logger';

export function collectHar(sessionId: string, assetsBase: string): string | null {
  try {
    const svc = Container.get(InterceptorService);
    if (svc.isActive(sessionId)) {
      const har = svc.exportHar(sessionId);
      const redacted = redactSecrets(har);
      return JSON.stringify(redacted, null, 2);
    }
  } catch {
    // fall through to archive
  }
  const archived = loadArchivedHar(assetsBase, sessionId);
  if (archived) {
    try {
      const parsed = JSON.parse(archived);
      return JSON.stringify(redactSecrets(parsed), null, 2);
    } catch {
      return archived;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run to pass**

Run: `npx mocha --require ts-node/register test/unit/bug-report/har-collector.spec.ts`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
npm run lint -- src/services/bug-report/har-collector.ts test/unit/bug-report/har-collector.spec.ts
git add src/services/bug-report/har-collector.ts test/unit/bug-report/har-collector.spec.ts
git commit -m "feat(bug-report): add HAR collector with redaction"
```

---

## Task 6: Video slicer (ffmpeg wrapper)

**Files:**
- Create: `src/services/bug-report/video-slice.ts`
- Test: `test/unit/bug-report/video-slice.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/unit/bug-report/video-slice.spec.ts
import { expect } from 'chai';
import sinon from 'sinon';
import * as childProcess from 'child_process';
import { EventEmitter } from 'events';
import { sliceVideo } from '../../../src/services/bug-report/video-slice';

class FakeProc extends EventEmitter {
  stderr = new EventEmitter();
}

describe('sliceVideo', () => {
  afterEach(() => sinon.restore());

  it('returns ok=true when ffmpeg exits 0', async () => {
    const proc = new FakeProc();
    sinon.stub(childProcess, 'spawn').returns(proc as any);
    const p = sliceVideo('/in.mp4', 0, 60, '/tmp/out.mp4');
    setImmediate(() => proc.emit('exit', 0));
    const result = await p;
    expect(result.ok).to.equal(true);
  });

  it('returns ok=false with reason on non-zero exit', async () => {
    const proc = new FakeProc();
    sinon.stub(childProcess, 'spawn').returns(proc as any);
    const p = sliceVideo('/in.mp4', 0, 60, '/tmp/out.mp4');
    setImmediate(() => {
      proc.stderr.emit('data', Buffer.from('codec error'));
      proc.emit('exit', 1);
    });
    const result = await p;
    expect(result.ok).to.equal(false);
    if (!result.ok) expect(result.error).to.include('exit 1');
  });

  it('returns ok=false on spawn error', async () => {
    const proc = new FakeProc();
    sinon.stub(childProcess, 'spawn').returns(proc as any);
    const p = sliceVideo('/in.mp4', 0, 60, '/tmp/out.mp4');
    setImmediate(() => proc.emit('error', new Error('ENOENT')));
    const result = await p;
    expect(result.ok).to.equal(false);
  });
});
```

- [ ] **Step 2: Run to fail**

Run: `npx mocha --require ts-node/register test/unit/bug-report/video-slice.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/services/bug-report/video-slice.ts
import { spawn } from 'child_process';
import log from '../../logger';

export type SliceResult = { ok: true } | { ok: false; error: string };

export function sliceVideo(
  inputPath: string,
  startSec: number,
  endSec: number,
  outPath: string,
): Promise<SliceResult> {
  return new Promise((resolve) => {
    const args = [
      '-y',
      '-ss', String(startSec),
      '-to', String(endSec),
      '-i', inputPath,
      '-c', 'copy',
      outPath,
    ];
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', (err) => {
      log.warn(`[BugReport] ffmpeg spawn failed: ${err.message}`);
      resolve({ ok: false, error: err.message });
    });
    proc.on('exit', (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        const tail = stderr.split('\n').slice(-3).join(' ').trim();
        resolve({ ok: false, error: `ffmpeg exit ${code}${tail ? `: ${tail}` : ''}` });
      }
    });
  });
}
```

- [ ] **Step 4: Run to pass**

Run: `npx mocha --require ts-node/register test/unit/bug-report/video-slice.spec.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
npm run lint -- src/services/bug-report/video-slice.ts test/unit/bug-report/video-slice.spec.ts
git add src/services/bug-report/video-slice.ts test/unit/bug-report/video-slice.spec.ts
git commit -m "feat(bug-report): add ffmpeg slice wrapper"
```

---

## Task 7: BugReportService — orchestrator skeleton

**Files:**
- Create: `src/services/bug-report/BugReportService.ts`
- Test: `test/unit/bug-report/service.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/unit/bug-report/service.spec.ts
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { BugReportService } from '../../../src/services/bug-report/BugReportService';
import { prisma } from '../../../src/prisma';

const FIXTURE_SESSION = {
  id: 'sess-1',
  status: 'failed',
  startTime: new Date('2026-04-26T09:50:00.000Z'),
  endTime: new Date('2026-04-26T09:55:00.000Z'),
  device_udid: 'PIXEL7-ABC',
  device_platform: 'android',
  device_name: 'Pixel 7',
  device_version: '14',
  desired_capabilities: '{"app":"foo.apk"}',
  failure_reason: 'TimeoutError',
  ai_analysis: 'AI says bad UI.',
  video_recording: null,
};

describe('BugReportService', () => {
  afterEach(() => sinon.restore());

  it('throws when session not found', async () => {
    sinon.stub(prisma.session as any, 'findUnique').resolves(null);
    const svc = Container.get(BugReportService);
    let err: Error | null = null;
    try {
      await svc.assemble({ sessionId: 'missing', mode: 'full' });
    } catch (e) {
      err = e as Error;
    }
    expect(err?.message).to.include('not found');
  });

  it('returns assembled bundle with manifest, README, logs entry', async () => {
    sinon.stub(prisma.session as any, 'findUnique').resolves(FIXTURE_SESSION);
    sinon.stub(prisma.sessionLog as any, 'findMany').resolves([
      { createdAt: new Date('2026-04-26T09:54:30.000Z'), title: 'click', response: 'ok' },
    ]);
    const svc = Container.get(BugReportService);
    const bundle = await svc.assemble({ sessionId: 'sess-1', mode: 'full' });

    expect(bundle.filename).to.match(/^bugreport-sess-1-\d{4}-\d{2}-\d{2}T.*\.zip$/);
    expect(bundle.entries.find((e) => e.name === 'manifest.json')).to.exist;
    expect(bundle.entries.find((e) => e.name === 'README.md')).to.exist;
    expect(bundle.entries.find((e) => e.name === 'logs.txt')).to.exist;
    expect(bundle.entries.find((e) => e.name === 'ai-summary.txt')).to.exist;
  });
});
```

- [ ] **Step 2: Run to fail**

Run: `npx mocha --require ts-node/register test/unit/bug-report/service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the service**

```typescript
// src/services/bug-report/BugReportService.ts
import { Service } from 'typedi';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import pkg from '../../../package.json';
import log from '../../logger';
import { prisma } from '../../prisma';
import { config } from '../../config';
import { resolveWindow } from './window';
import { buildManifest } from './manifest';
import { buildReadme } from './readme';
import { collectHar } from './har-collector';
import { sliceVideo } from './video-slice';
import { redactSecrets } from '../../logger';
import {
  BugReportMode,
  BugReportOptions,
  Manifest,
  ManifestArtifacts,
  SLICE_DEFAULT_SEC,
} from './types';

export interface BundleEntry {
  name: string;
  source: { kind: 'buffer'; data: Buffer } | { kind: 'file'; path: string };
}

export interface AssembledBundle {
  filename: string;
  manifest: Manifest;
  entries: BundleEntry[];
  cleanup: () => Promise<void>;
}

@Service()
export class BugReportService {
  private logger = log.scope('BugReportService');

  async assemble(opts: BugReportOptions): Promise<AssembledBundle> {
    const session = await prisma.session.findUnique({ where: { id: opts.sessionId } }) as any;
    if (!session) throw new Error(`Session ${opts.sessionId} not found`);

    const warnings: string[] = [];
    const window = resolveWindow(session, opts.mode, opts.windowSec ?? SLICE_DEFAULT_SEC);

    // Logs
    const logs = await this.collectLogs(opts.sessionId, window.startedAt, window.endedAt);

    // HAR
    const harText = collectHar(opts.sessionId, config.sessionAssetsPath);
    if (!harText) warnings.push('no network capture for this session');

    // AI summary (read existing field; never block)
    const aiSummary = session.ai_analysis as string | null;

    // Video
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xenon-bugreport-'));
    const cleanups: Array<() => Promise<void>> = [
      async () => fs.promises.rm(tmpDir, { recursive: true, force: true }),
    ];
    let videoEntryPath: string | null = null;
    if (session.video_recording) {
      const fullVideoPath = path.join(config.sessionAssetsPath, session.video_recording);
      if (fs.existsSync(fullVideoPath)) {
        if (opts.mode === 'full') {
          videoEntryPath = fullVideoPath;
        } else {
          const startMs = new Date(session.startTime).getTime();
          const sliceStart = (new Date(window.startedAt).getTime() - startMs) / 1000;
          const sliceEnd = (new Date(window.endedAt).getTime() - startMs) / 1000;
          const out = path.join(tmpDir, 'video.mp4');
          const result = await sliceVideo(fullVideoPath, Math.max(0, sliceStart), sliceEnd, out);
          if (result.ok) {
            videoEntryPath = out;
          } else {
            warnings.push(`video slice failed: ${result.error}`);
          }
        }
      } else {
        warnings.push('recorded video not found on disk');
      }
    }

    const artifacts: ManifestArtifacts = {
      video: videoEntryPath ? 'video.mp4' : null,
      logs: 'logs.txt',
      network: harText ? 'network.har' : null,
      aiSummary: aiSummary ? 'ai-summary.txt' : null,
      screenshots: [],
    };

    const manifest = buildManifest({
      session,
      window,
      mode: opts.mode,
      xenonVersion: (pkg as any).version ?? '0.0.0',
      generatedAt: new Date().toISOString(),
      artifacts,
      warnings,
    });

    const readme = buildReadme(manifest, aiSummary);

    const entries: BundleEntry[] = [
      { name: 'manifest.json', source: { kind: 'buffer', data: Buffer.from(JSON.stringify(manifest, null, 2)) } },
      { name: 'README.md', source: { kind: 'buffer', data: Buffer.from(readme) } },
      { name: 'logs.txt', source: { kind: 'buffer', data: Buffer.from(logs) } },
    ];
    if (videoEntryPath) entries.push({ name: 'video.mp4', source: { kind: 'file', path: videoEntryPath } });
    if (harText) entries.push({ name: 'network.har', source: { kind: 'buffer', data: Buffer.from(harText) } });
    if (aiSummary) entries.push({ name: 'ai-summary.txt', source: { kind: 'buffer', data: Buffer.from(aiSummary) } });

    const filename = `bugreport-${opts.sessionId}-${manifest.generatedAt.replace(/[:.]/g, '-')}.zip`;

    return {
      filename,
      manifest,
      entries,
      cleanup: async () => {
        for (const c of cleanups) {
          try { await c(); } catch (e: any) { this.logger.warn(`cleanup failed: ${e.message}`); }
        }
      },
    };
  }

  private async collectLogs(sessionId: string, startIso: string, endIso: string): Promise<string> {
    const start = new Date(startIso);
    const end = new Date(endIso);
    const rows = await prisma.sessionLog.findMany({
      where: { session_id: sessionId, createdAt: { gte: start, lte: end } },
      orderBy: { createdAt: 'asc' },
    }) as Array<{ createdAt: Date; title: string | null; response: string | null }>;
    const lines = rows.map((r) =>
      `${r.createdAt.toISOString()}  ${r.title ?? ''}  ${r.response ?? ''}`,
    );
    return redactSecrets(lines.join('\n'));
  }
}
```

- [ ] **Step 4: Run to pass**

Run: `npx mocha --require ts-node/register test/unit/bug-report/service.spec.ts`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
npm run lint -- src/services/bug-report/BugReportService.ts test/unit/bug-report/service.spec.ts
git add src/services/bug-report/BugReportService.ts test/unit/bug-report/service.spec.ts
git commit -m "feat(bug-report): add BugReportService orchestrator"
```

---

## Task 8: Streaming archiver helper

**Files:**
- Create: `src/services/bug-report/archive.ts`
- Test: `test/unit/bug-report/archive.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/unit/bug-report/archive.spec.ts
import { expect } from 'chai';
import { PassThrough } from 'stream';
import * as unzipper from 'unzipper';
import { streamBundleToZip } from '../../../src/services/bug-report/archive';
import { BundleEntry } from '../../../src/services/bug-report/BugReportService';

describe('streamBundleToZip', () => {
  it('writes all entries into a valid zip', async () => {
    const entries: BundleEntry[] = [
      { name: 'a.txt', source: { kind: 'buffer', data: Buffer.from('hello') } },
      { name: 'b.json', source: { kind: 'buffer', data: Buffer.from('{"ok":true}') } },
    ];
    const sink = new PassThrough();
    const chunks: Buffer[] = [];
    sink.on('data', (c) => chunks.push(c));

    await streamBundleToZip(entries, sink);
    const buf = Buffer.concat(chunks);

    const dir = await unzipper.Open.buffer(buf);
    const names = dir.files.map((f) => f.path).sort();
    expect(names).to.deep.equal(['a.txt', 'b.json']);
  });
});
```

Note: this test uses `unzipper`. If not installed, install as dev dep first:

```bash
npm install --save-dev unzipper @types/unzipper
```

- [ ] **Step 2: Run to fail**

Run: `npx mocha --require ts-node/register test/unit/bug-report/archive.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/services/bug-report/archive.ts
import archiver from 'archiver';
import { Writable } from 'stream';
import { BundleEntry } from './BugReportService';

export function streamBundleToZip(entries: BundleEntry[], sink: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', reject);
    archive.on('end', resolve);
    archive.pipe(sink);
    for (const e of entries) {
      if (e.source.kind === 'buffer') {
        archive.append(e.source.data, { name: e.name });
      } else {
        archive.file(e.source.path, { name: e.name });
      }
    }
    archive.finalize().catch(reject);
  });
}
```

- [ ] **Step 4: Run to pass**

Run: `npx mocha --require ts-node/register test/unit/bug-report/archive.spec.ts`
Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
npm run lint -- src/services/bug-report/archive.ts test/unit/bug-report/archive.spec.ts
git add src/services/bug-report/archive.ts test/unit/bug-report/archive.spec.ts package.json package-lock.json
git commit -m "feat(bug-report): add archiver streaming helper"
```

---

## Task 9: Express route + param validation

**Files:**
- Create: `src/app/routers/bug-report.ts`
- Test: `test/unit/bug-report/route.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/unit/bug-report/route.spec.ts
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import sinon from 'sinon';
import { Container } from 'typedi';
import { BugReportService } from '../../../src/services/bug-report/BugReportService';
import bugReportRouter from '../../../src/app/routers/bug-report';

function makeApp() {
  const app = express();
  bugReportRouter.register(app as any);
  return app;
}

describe('bug-report route', () => {
  afterEach(() => sinon.restore());

  it('400 on invalid mode', async () => {
    const res = await request(makeApp()).post('/sessions/sess-1/bug-report?mode=bogus');
    expect(res.status).to.equal(400);
  });

  it('400 on out-of-range windowSec', async () => {
    const res = await request(makeApp()).post('/sessions/sess-1/bug-report?mode=slice&windowSec=9999');
    expect(res.status).to.equal(400);
  });

  it('404 when service throws not-found', async () => {
    sinon.stub(BugReportService.prototype, 'assemble').rejects(new Error('Session sess-1 not found'));
    const res = await request(makeApp()).post('/sessions/sess-1/bug-report?mode=full');
    expect(res.status).to.equal(404);
  });

  it('200 streams zip on success', async () => {
    sinon.stub(BugReportService.prototype, 'assemble').resolves({
      filename: 'bugreport-sess-1.zip',
      manifest: {} as any,
      entries: [{ name: 'a.txt', source: { kind: 'buffer', data: Buffer.from('hi') } }],
      cleanup: async () => {},
    });
    const res = await request(makeApp())
      .post('/sessions/sess-1/bug-report?mode=full')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).to.equal(200);
    expect(res.headers['content-type']).to.equal('application/zip');
    expect(res.headers['content-disposition']).to.include('bugreport-sess-1.zip');
  });
});
```

Note: install `supertest` if missing: `npm install --save-dev supertest @types/supertest`.

- [ ] **Step 2: Run to fail**

Run: `npx mocha --require ts-node/register test/unit/bug-report/route.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/app/routers/bug-report.ts
import { Request, Response, Router } from 'express';
import { Container } from 'typedi';
import { BugReportService } from '../../services/bug-report/BugReportService';
import { streamBundleToZip } from '../../services/bug-report/archive';
import {
  BugReportMode,
  SLICE_DEFAULT_SEC,
  SLICE_MAX_SEC,
  SLICE_MIN_SEC,
} from '../../services/bug-report/types';
import log from '../../logger';
import { SocketServer } from '../../services/SocketServer';
import { SocketEvents } from '../../enums/SocketEvents';

const router = Router();

function parseMode(raw: unknown): BugReportMode | null {
  if (raw === 'slice' || raw === 'full') return raw;
  return null;
}

function parseWindowSec(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return SLICE_DEFAULT_SEC;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < SLICE_MIN_SEC || n > SLICE_MAX_SEC) return null;
  return n;
}

router.post('/sessions/:sessionId/bug-report', async (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;
  const mode = parseMode(req.query.mode);
  if (!mode) return res.status(400).json({ error: 'mode must be "slice" or "full"' });

  let windowSec: number | undefined;
  if (mode === 'slice') {
    const parsed = parseWindowSec(req.query.windowSec);
    if (parsed === null) {
      return res.status(400).json({
        error: `windowSec must be between ${SLICE_MIN_SEC} and ${SLICE_MAX_SEC}`,
      });
    }
    windowSec = parsed;
  }

  const svc = Container.get(BugReportService);
  let bundle;
  try {
    bundle = await svc.assemble({ sessionId, mode, windowSec });
  } catch (err: any) {
    if (/not found/i.test(err.message)) {
      return res.status(404).json({ error: err.message });
    }
    log.error(`[BugReport] assemble failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${bundle.filename}"`);

  const startedAt = Date.now();
  let bytesSent = 0;
  res.on('finish', () => {
    try {
      Container.get(SocketServer).broadcast(SocketEvents.BUG_REPORT_GENERATED, {
        sessionId,
        mode,
        durationMs: Date.now() - startedAt,
        bytes: bytesSent,
        warnings: bundle.manifest.warnings,
      });
    } catch (e: any) {
      log.warn(`[BugReport] broadcast failed: ${e.message}`);
    }
  });

  res.on('close', async () => { await bundle.cleanup(); });

  try {
    await streamBundleToZip(bundle.entries, res);
  } catch (err: any) {
    log.error(`[BugReport] stream failed mid-write: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.destroy();
    }
  }
});

function register(parentRouter: Router) {
  parentRouter.use('/', router);
}

export default { register };
```

- [ ] **Step 4: Run to pass**

Run: `npx mocha --require ts-node/register test/unit/bug-report/route.spec.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
npm run lint -- src/app/routers/bug-report.ts test/unit/bug-report/route.spec.ts
git add src/app/routers/bug-report.ts test/unit/bug-report/route.spec.ts package.json package-lock.json
git commit -m "feat(bug-report): add Express route with validation"
```

---

## Task 10: Add `BUG_REPORT_GENERATED` socket event

**Files:**
- Modify: `src/enums/SocketEvents.ts`

- [ ] **Step 1: Edit `src/enums/SocketEvents.ts`**

Add the new line just before the closing `}` of the `SocketEvents` enum:

```typescript
  BUG_REPORT_GENERATED = 'bug_report_generated',
```

The block should look like:
```typescript
  INTERCEPTOR_REQUEST = 'interceptor_request',
  INTERCEPTOR_SESSION_STARTED = 'interceptor_session_started',
  INTERCEPTOR_SESSION_STOPPED = 'interceptor_session_stopped',
  BUG_REPORT_GENERATED = 'bug_report_generated',
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/enums/SocketEvents.ts
git commit -m "feat(bug-report): add BUG_REPORT_GENERATED socket event"
```

---

## Task 11: Wire route into `src/app/index.ts`

**Files:**
- Modify: `src/app/index.ts`

- [ ] **Step 1: Add import**

Find the existing imports block (around line 22):

```typescript
import InterceptorRouter from './routers/interceptor';
```

Add immediately after:

```typescript
import BugReportRouter from './routers/bug-report';
```

- [ ] **Step 2: Register the router**

Find the registration block in `createRouter()` near line 248:

```typescript
  InterceptorRouter.register(apiRouter);
  apiRouter.use('/reservation', reservationRouter);
```

Add `BugReportRouter.register(apiRouter);` between them so the auth middleware and rate-limiter (already applied above) cover it:

```typescript
  InterceptorRouter.register(apiRouter);
  BugReportRouter.register(apiRouter);
  apiRouter.use('/reservation', reservationRouter);
```

- [ ] **Step 3: Run all unit tests**

Run: `npm test`
Expected: previous suites + new bug-report suites all pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/index.ts
git commit -m "feat(bug-report): register router under /api"
```

---

## Task 12: Integration test for the full route

**Files:**
- Create: `test/integration/bug-report-route.spec.ts`
- Create: `test/integration/fixtures/bug-report/recording.mp4` (a small MP4 — 2-3s of black, ≤200KB; commit as binary)

- [ ] **Step 1: Generate the fixture MP4**

```bash
mkdir -p test/integration/fixtures/bug-report
ffmpeg -y -f lavfi -i "color=black:s=320x240:d=3:r=10" -c:v libx264 -pix_fmt yuv420p \
  test/integration/fixtures/bug-report/recording.mp4
ls -lh test/integration/fixtures/bug-report/recording.mp4
```

Expected: file is ~5–30KB.

- [ ] **Step 2: Write the failing test**

```typescript
// test/integration/bug-report-route.spec.ts
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import sinon from 'sinon';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as unzipper from 'unzipper';
import { prisma } from '../../src/prisma';
import { config } from '../../src/config';
import bugReportRouter from '../../src/app/routers/bug-report';

describe('POST /sessions/:id/bug-report (integration)', () => {
  let tmpAssets: string;
  const fixtureMp4 = path.join(__dirname, 'fixtures/bug-report/recording.mp4');

  beforeEach(() => {
    tmpAssets = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-it-'));
    (config as any).sessionAssetsPath = tmpAssets;
    const sessionDir = path.join(tmpAssets, 'sess-it', 'video');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.copyFileSync(fixtureMp4, path.join(sessionDir, 'sess-it.mp4'));
  });

  afterEach(() => {
    sinon.restore();
    fs.rmSync(tmpAssets, { recursive: true, force: true });
  });

  function makeApp() {
    const app = express();
    bugReportRouter.register(app as any);
    return app;
  }

  it('returns a valid zip with manifest, README, logs, video for mode=full', async () => {
    sinon.stub(prisma.session as any, 'findUnique').resolves({
      id: 'sess-it',
      status: 'failed',
      startTime: new Date(Date.now() - 60_000),
      endTime: new Date(),
      device_udid: 'X', device_platform: 'android', device_name: 'Pixel', device_version: '14',
      desired_capabilities: '{"app":"foo.apk","apiKey":"sk-secret"}',
      failure_reason: 'TimeoutError',
      ai_analysis: 'AI says bad UI.',
      video_recording: 'sess-it/video/sess-it.mp4',
    });
    sinon.stub(prisma.sessionLog as any, 'findMany').resolves([
      { createdAt: new Date(), title: 'click', response: 'fail' },
    ]);

    const res = await request(makeApp())
      .post('/sessions/sess-it/bug-report?mode=full')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c as Buffer));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).to.equal(200);
    const dir = await unzipper.Open.buffer(res.body);
    const names = dir.files.map((f) => f.path).sort();
    expect(names).to.include.members(['README.md', 'ai-summary.txt', 'logs.txt', 'manifest.json', 'video.mp4']);

    const manifestEntry = dir.files.find((f) => f.path === 'manifest.json')!;
    const manifestBuf = await manifestEntry.buffer();
    const manifest = JSON.parse(manifestBuf.toString('utf8'));
    expect(manifest.schemaVersion).to.equal('1.0');
    expect(manifest.session.id).to.equal('sess-it');
    expect(JSON.stringify(manifest.capabilities)).to.not.include('sk-secret');

    const videoEntry = dir.files.find((f) => f.path === 'video.mp4')!;
    expect(videoEntry.uncompressedSize).to.be.greaterThan(0);
  });
});
```

- [ ] **Step 3: Run to fail (route exists, but assertions may need tweaking)**

Run: `npx mocha --require ts-node/register test/integration/bug-report-route.spec.ts`
Expected: PASS if Tasks 1–11 are correct.

- [ ] **Step 4: Commit**

```bash
git add test/integration/bug-report-route.spec.ts test/integration/fixtures/bug-report/recording.mp4
git commit -m "test(bug-report): integration test for full-mode route"
```

---

## Task 13: Swagger documentation

**Files:**
- Modify: `src/app/swagger-docs.ts`

- [ ] **Step 1: Add the JSDoc swagger block**

Open `src/app/swagger-docs.ts`. At the bottom (or alongside other route docs), add:

```typescript
/**
 * @swagger
 * /sessions/{sessionId}/bug-report:
 *   post:
 *     summary: Generate a bug-report bundle for a session
 *     description: |
 *       Streams a zip archive containing the session's video, logs, HAR, AI summary,
 *       and a manifest.json. In `slice` mode, the video is trimmed to the last
 *       `windowSec` seconds (default 60). In `full` mode the entire session is
 *       included verbatim.
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: mode
 *         required: true
 *         schema: { type: string, enum: [slice, full] }
 *       - in: query
 *         name: windowSec
 *         required: false
 *         schema: { type: integer, minimum: 5, maximum: 600, default: 60 }
 *         description: Slice window length in seconds. Ignored when mode=full.
 *     responses:
 *       200:
 *         description: zip archive (application/zip)
 *         content:
 *           application/zip:
 *             schema: { type: string, format: binary }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
```

- [ ] **Step 2: Verify swagger renders**

Run: `npm run server &` then `curl http://localhost:4723/xenon/api-docs/swagger.json | jq '.paths."/sessions/{sessionId}/bug-report"'`
Expected: JSON with summary "Generate a bug-report bundle for a session". Kill the server after.

- [ ] **Step 3: Commit**

```bash
git add src/app/swagger-docs.ts
git commit -m "docs(swagger): document /sessions/:id/bug-report endpoint"
```

---

## Task 14: Frontend api-service helper

**Files:**
- Create: `web/src/api-service/bug-report.ts`

- [ ] **Step 1: Implement**

```typescript
// web/src/api-service/bug-report.ts
export interface DownloadOptions {
  sessionId: string;
  mode: 'slice' | 'full';
  windowSec?: number;
}

export async function downloadBugReport(opts: DownloadOptions): Promise<void> {
  const params = new URLSearchParams({ mode: opts.mode });
  if (opts.mode === 'slice' && opts.windowSec) {
    params.set('windowSec', String(opts.windowSec));
  }
  const url = `/xenon/api/sessions/${encodeURIComponent(opts.sessionId)}/bug-report?${params.toString()}`;

  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && body.error) msg = body.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const cd = res.headers.get('content-disposition') || '';
  const match = /filename="([^"]+)"/.exec(cd);
  const filename = match ? match[1] : `bugreport-${opts.sessionId}.zip`;

  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objUrl);
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/api-service/bug-report.ts
git commit -m "feat(bug-report): add frontend downloadBugReport helper"
```

---

## Task 15: `BugReportButton` React component

**Files:**
- Create: `web/src/components/bug-report/BugReportButton.tsx`
- Create: `web/src/components/bug-report/BugReportButton.module.css` (only if a floating-style sheet doesn't already exist)

- [ ] **Step 1: Implement**

```tsx
// web/src/components/bug-report/BugReportButton.tsx
import React, { useState } from 'react';
import { Bug, Loader2 } from 'lucide-react';
import { downloadBugReport } from '../../api-service/bug-report';
import { useToast } from '../ui/toast';

interface Props {
  sessionId: string;
  mode: 'slice' | 'full';
  windowSec?: number;
  variant: 'floating' | 'inline';
}

export const BugReportButton: React.FC<Props> = ({ sessionId, mode, windowSec, variant }) => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function onClick() {
    if (loading) return;
    setLoading(true);
    try {
      await downloadBugReport({ sessionId, mode, windowSec });
      toast('Bug report downloaded', 'success');
    } catch (err: any) {
      toast(`Bug report failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  if (variant === 'floating') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        title={`Capture last ${windowSec ?? 60}s as bug report`}
        aria-label="Generate bug report"
        className="fixed bottom-4 right-4 z-30 inline-flex items-center gap-2 px-3 py-2 rounded-full
                   bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--text)]
                   shadow-lg hover:bg-[var(--surface-raised)] disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bug className="h-3.5 w-3.5" />}
        Bug report
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      title="Download a zip of this session for ticketing"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs
                 bg-[var(--surface-2)] hover:bg-[var(--surface-raised)] border border-[var(--border)]
                 text-[var(--text)] disabled:opacity-50"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bug className="h-3.5 w-3.5" />}
      Download bug report
    </button>
  );
};
```

- [ ] **Step 2: Build the frontend**

Run: `npm run build:xenon`
Expected: Vite build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/bug-report/BugReportButton.tsx
git commit -m "feat(bug-report): add BugReportButton component"
```

---

## Task 16: Mount button in device-control (live, slice mode)

**Files:**
- Modify: `web/src/components/device-control/device-control.tsx`

- [ ] **Step 1: Add import**

Near the existing imports at the top (after `import OmniInspector from '../omni-inspector/OmniInspector';`):

```typescript
import { BugReportButton } from '../bug-report/BugReportButton';
```

- [ ] **Step 2: Render the button**

The active session ID lives on `currentDevice.session_id` (snake_case from the backend, see line ~375 of `device-control.tsx`). Manual sessions (id starts with `manual_`) are not persisted in the DB and must be excluded.

Find the JSX root element returned by `DeviceControl` (the outer container that wraps the device viewport). Inside that root, add as the last child (so it floats over the rest):

```tsx
{currentDevice.session_id &&
  !String(currentDevice.session_id).startsWith('manual_') && (
    <BugReportButton
      sessionId={String(currentDevice.session_id)}
      mode="slice"
      windowSec={60}
      variant="floating"
    />
  )}
```

- [ ] **Step 3: Build + manual smoke test**

Run: `npm run build:all && npm run server`
Expected: Server starts. Open dashboard, start a session, click into the device control view — button visible bottom-right. Click it, verify a zip downloads.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/device-control/device-control.tsx
git commit -m "feat(bug-report): mount floating button on live session view"
```

---

## Task 17: Mount button in session-detail header (post, full mode)

**Files:**
- Modify: `web/src/components/session-detail/breadcrumb-header.tsx`

- [ ] **Step 1: Add the button**

At the top of the file:

```typescript
import { BugReportButton } from '../bug-report/BugReportButton';
```

Inside the `<header>` JSX, after the existing copy-id button (line ~53), add a wrapper div pushing it to the right:

```tsx
<div className="ml-auto">
  <BugReportButton sessionId={sessionId} mode="full" variant="inline" />
</div>
```

The `<header>` block's final shape should be:

```tsx
<header className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
  {/* ...existing breadcrumbs and copy button... */}
  <button type="button" onClick={copySessionId} aria-label="Copy session ID" className="...">
    <Copy className="h-3 w-3" />
  </button>
  <div className="ml-auto">
    <BugReportButton sessionId={sessionId} mode="full" variant="inline" />
  </div>
</header>
```

- [ ] **Step 2: Build + manual smoke test**

Run: `npm run build:all`
Expected: clean build. Open a finished session in the dashboard, click "Download bug report" in the header, verify the zip downloads and contains `manifest.json`, `README.md`, `logs.txt`, `video.mp4` (if recorded), `network.har` (if any), `ai-summary.txt` (if any).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/session-detail/breadcrumb-header.tsx
git commit -m "feat(bug-report): mount inline button in session-detail header"
```

---

## Task 18: Final verification + push

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: all tests pass, including new `test/unit/bug-report/*.spec.ts` and `test/integration/bug-report-route.spec.ts`.

- [ ] **Step 2: Run lint + format**

Run: `npm run lint && npm run format`
Expected: no errors.

- [ ] **Step 3: Run the full build**

Run: `npm run build:all`
Expected: TypeScript compiles, Vite builds, no warnings about missing types.

- [ ] **Step 4: Push the branch**

Run: `git push origin docs/bug-report-button-spec`

- [ ] **Step 5: Convert spec PR to ready-for-review (or update its body to include implementation)**

Run: `gh pr ready 55` (if currently draft).

Update the PR description with a checklist of what shipped:
- [x] Spec doc
- [x] BugReportService + manifest + window + readme + har-collector + video-slice (TDD-covered)
- [x] Express route under `/api/sessions/:id/bug-report`
- [x] Swagger docs
- [x] Frontend button (floating + inline)
- [x] Integration test producing valid zip

---

## Spec Coverage Check

| Spec section | Covered by task |
|---|---|
| Architecture diagram | Tasks 7, 8, 9 |
| Bundle layout | Task 7 (entries assembled) |
| `manifest.json` schema | Task 3 |
| README content | Task 4 |
| Mode resolution | Task 2 |
| Video slicing + ffmpeg failure handling | Tasks 6, 7 |
| AI summary read-only (5s timeout simplified to "read existing field") | Task 7 — see assumption note below |
| Redaction (caps, HAR, logs) | Tasks 3 (caps), 5 (HAR), 7 (logs) |
| Streaming via archiver | Tasks 8, 9 |
| Endpoint params + validation | Task 9 |
| Error handling matrix | Task 9 (400/404/500); Task 7 (warnings for missing artifacts) |
| Frontend button (two variants) | Tasks 14, 15, 16, 17 |
| Telemetry (`BUG_REPORT_GENERATED`) | Tasks 10, 9 |
| Swagger docs | Task 13 |
| Unit + integration tests | Tasks 2, 3, 4, 5, 6, 7, 8, 9, 12 |

**Implementation deviations from spec:**

1. **AI summary** — spec described a 5s sync timeout to trigger generation. Implementation reads `session.ai_analysis` directly because `failure-analysis-service.ts` already runs asynchronously after every session ends; triggering it again would duplicate work and rarely complete in 5s. If a session has no `ai_analysis` yet, we omit it (consistent with spec error handling).

2. **"Flush in-flight buffers" before reading live HAR** — spec asked for an explicit flush. Verified that `InterceptorService.getRequests()` reads directly from an in-memory `RequestBuffer`, so the data is always current; no flush API exists or is needed. Spec assumption was overcautious.

---
