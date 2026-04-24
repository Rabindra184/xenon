# Xenon Redesign — Build Export (Phase 4B-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the `Export` button in the Builds-page header to a real backend endpoint that streams a build's sessions as JSON or CSV. This is the first half of Phase 4B — `Retry failed` remains a stub pending a separate plan (4B-2) because it requires bridging REST into the Appium WebDriver session-creation flow, which is a materially larger design task than a simple router endpoint.

**Architecture:** New `POST /build/:buildId/export` endpoint on the existing dashboard router that reuses the `prisma.session.findMany({ where: { build_id } })` query already used by `GET /session`. Formats the result as a JSON array or a CSV flat-file and streams it with `Content-Disposition: attachment`. Frontend `XenonApiService.exportBuild()` triggers a browser-download via a temporary `<a download>` on a Blob URL.

**Tech Stack:** Express 4, Prisma 5, Mocha + Chai + Sinon for tests, `clsx`-free vanilla frontend.

**Parent spec:** `docs/superpowers/specs/2026-04-24-builds-session-detail-redesign-design.md` §7.2.

**Scope note:** Retry deferred to Plan 4B-2. Runbook endpoint is part of Plan 4C (bundled with Session Detail).

---

## File Structure

**Modify:**
- `src/app/routers/dashboard.ts` — add `buildExport` handler + route wiring.
- `web/src/api-service/index.ts` — add `exportBuild(buildId, format, sessionIds?)`.
- `web/src/components/builds/builds-page.tsx` — replace the `onExport` toast stub with a real call.

**Create:**
- `src/app/routers/build-export.ts` — pure export helpers (sessionsToCsv, sessionsToJson) + the handler. Keeps `dashboard.ts` lean.
- `test/unit/build-export.spec.ts` — unit tests for the helpers + a sinon-stubbed handler test.

**Untouched:**
- All other backend files. No Prisma schema change.
- All other frontend files.

---

## Task 1: Add export helper module (TDD)

**Files:** Create `src/app/routers/build-export.ts`, `test/unit/build-export.spec.ts`

- [ ] **Step 1: Inspect existing test patterns for reference**

Run: `cat /Users/rabindrabiswal/Workspace/XAenon/xenon/test/unit/apiKeyMiddleware.test.ts`

Note the sinon stubbing style and how test files import from `src/`.

- [ ] **Step 2: Write failing tests first**

Write `test/unit/build-export.spec.ts`:

```ts
import { expect } from 'chai';
import { sessionsToJson, sessionsToCsv } from '../../src/app/routers/build-export';

const FIXTURE = [
  {
    id: 'orphan-fresh-sess-001',
    build_id: 'b1',
    status: 'failed',
    failure_category: 'hub_restart',
    failure_reason: 'Session heartbeat timeout',
    device_platform: 'android',
    device_version: '13',
    device_name: 'Pixel 6',
    node_id: 'node-a',
    startTime: '2026-04-23T06:53:25.000Z',
    endTime:   '2026-04-23T13:00:38.000Z',
    name: null,
  },
  {
    id: 'orphan-stale-sess-001',
    build_id: 'b1',
    status: 'ended',
    failure_category: null,
    failure_reason: null,
    device_platform: 'ios',
    device_version: '17.4',
    device_name: "Rabindra's iPhone",
    node_id: 'node-b',
    startTime: '2026-04-23T00:00:00.000Z',
    endTime:   '2026-04-23T01:00:00.000Z',
    name: 'smoke-login',
  },
] as any[];

describe('sessionsToJson', () => {
  it('returns a pretty-printed JSON array', () => {
    const out = sessionsToJson(FIXTURE);
    const parsed = JSON.parse(out);
    expect(parsed).to.have.lengthOf(2);
    expect(parsed[0].id).to.equal('orphan-fresh-sess-001');
  });

  it('is stable — identical input produces identical output', () => {
    expect(sessionsToJson(FIXTURE)).to.equal(sessionsToJson(FIXTURE));
  });
});

describe('sessionsToCsv', () => {
  it('emits a header row matching the schema', () => {
    const csv = sessionsToCsv(FIXTURE);
    const firstLine = csv.split('\n')[0];
    expect(firstLine).to.equal(
      'id,build_id,status,failure_category,failure_reason,device_platform,device_version,device_name,node_id,startTime,endTime,name',
    );
  });

  it('emits one row per session', () => {
    const csv = sessionsToCsv(FIXTURE);
    const lines = csv.trim().split('\n');
    expect(lines).to.have.lengthOf(3); // header + 2 rows
  });

  it('escapes quotes, commas, and newlines in cell values', () => {
    const tricky = [
      {
        id: 's1',
        build_id: 'b1',
        status: 'failed',
        failure_category: null,
        failure_reason: 'line1\nline2 with "quotes" and, commas',
        device_platform: 'android',
        device_version: '13',
        device_name: null,
        node_id: 'node-a',
        startTime: '2026-04-23T00:00:00.000Z',
        endTime: null,
        name: null,
      },
    ] as any[];
    const csv = sessionsToCsv(tricky);
    const dataRow = csv.split('\n')[1];
    expect(dataRow).to.include('"line1\nline2 with ""quotes"" and, commas"');
  });

  it('renders null as empty cell', () => {
    const csv = sessionsToCsv(FIXTURE);
    const row2 = csv.split('\n')[2]; // second data row
    // FIXTURE[1] has failure_category = null; 4th column should be empty
    const cells = row2.split(',');
    expect(cells[3]).to.equal('');
  });

  it('ends with a single trailing newline', () => {
    const csv = sessionsToCsv(FIXTURE);
    expect(csv.endsWith('\n')).to.equal(true);
    expect(csv.endsWith('\n\n')).to.equal(false);
  });
});
```

- [ ] **Step 3: Run tests (expect fail — module missing)**

Run: `cd /Users/rabindrabiswal/Workspace/XAenon/xenon && npx mocha --require ts-node/register test/unit/build-export.spec.ts 2>&1 | tail -15`

Expected: FAIL with "Cannot find module".

- [ ] **Step 4: Implement the helpers**

Write `src/app/routers/build-export.ts`:

```ts
import { Request, Response } from 'express';
import prisma from '../../data-service/prisma-client';

const CSV_COLUMNS = [
  'id',
  'build_id',
  'status',
  'failure_category',
  'failure_reason',
  'device_platform',
  'device_version',
  'device_name',
  'node_id',
  'startTime',
  'endTime',
  'name',
] as const;

type CsvCell = string | number | boolean | null | undefined;

function escapeCsvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function sessionsToJson(sessions: any[]): string {
  return JSON.stringify(sessions, null, 2);
}

export function sessionsToCsv(sessions: any[]): string {
  const header = CSV_COLUMNS.join(',');
  const rows = sessions.map((s) =>
    CSV_COLUMNS.map((col) => escapeCsvCell(s[col])).join(','),
  );
  return [header, ...rows].join('\n') + '\n';
}

interface ExportBody {
  format?: 'json' | 'csv';
  sessionIds?: string[];
}

export async function buildExport(req: Request, res: Response): Promise<void> {
  const { buildId } = req.params;
  const { format = 'json', sessionIds } = (req.body || {}) as ExportBody;

  if (!buildId) {
    res.status(400).json({ error: 'buildId required' });
    return;
  }
  if (format !== 'json' && format !== 'csv') {
    res.status(400).json({ error: "format must be 'json' or 'csv'" });
    return;
  }

  const where: Record<string, unknown> = { build_id: buildId };
  if (Array.isArray(sessionIds) && sessionIds.length > 0) {
    if (sessionIds.length > 5000) {
      res.status(413).json({ error: 'sessionIds too large (max 5000)' });
      return;
    }
    where.id = { in: sessionIds };
  }

  const sessions = await prisma.session.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="build-${buildId}-sessions.csv"`);
    res.send(sessionsToCsv(sessions));
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="build-${buildId}-sessions.json"`);
    res.send(sessionsToJson(sessions));
  }
}
```

NOTE: the import path `../../data-service/prisma-client` is a guess — Task 3 Step 1 has a grep to find the real path if this is wrong.

- [ ] **Step 5: Run tests (expect pass for helper tests)**

Run: `cd /Users/rabindrabiswal/Workspace/XAenon/xenon && npx mocha --require ts-node/register test/unit/build-export.spec.ts 2>&1 | tail -15`

Expected: 6 tests pass. If import paths fail, grep for the real module path and adjust.

- [ ] **Step 6: Commit**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
git add src/app/routers/build-export.ts test/unit/build-export.spec.ts
git commit -m "feat(server): add build-export helpers + buildExport handler" -m "Pure helpers: sessionsToJson (pretty JSON array) and sessionsToCsv (column-fixed CSV with quote/comma/newline escaping). Handler POST /build/:buildId/export reads build + optional sessionIds, fetches from Prisma, sets a Content-Disposition attachment, and returns the formatted payload. Fully unit-tested (6 cases)." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Wire the export route into dashboard.ts

**Files:** Modify `src/app/routers/dashboard.ts`

- [ ] **Step 1: Inspect the current router**

Run: `grep -n 'router.get\|router.post\|router.use' /Users/rabindrabiswal/Workspace/XAenon/xenon/src/app/routers/dashboard.ts | head -20`

Identify where other POST routes are declared and confirm the router export pattern.

- [ ] **Step 2: Add the route**

Edit `src/app/routers/dashboard.ts`. Near the existing `GET /session`, `GET /build` declarations, add:

```ts
import { buildExport } from './build-export';

// ... existing routes ...

router.post('/build/:buildId/export', buildExport);
```

Match the existing file's import style (default vs named exports, relative paths).

- [ ] **Step 3: Build**

Run: `cd /Users/rabindrabiswal/Workspace/XAenon/xenon && npm run build 2>&1 | tail -10`

Expected: build succeeds. If the import path for prisma was wrong in Task 1 Step 4, fix it now.

- [ ] **Step 4: Manual smoke test**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon && npm run build:xenon
pkill -f 'appium' 2>/dev/null || true
APPIUM_HOME=/tmp/xenon-home npx appium server -ka 800 --use-plugins=xenon -pa /wd/hub --plugin-xenon-platform=both --plugin-xenon-enable-dashboard >/tmp/xenon-server.log 2>&1 &
```

Wait for ready, then:

```bash
# Get API key cookie
curl -s -c /tmp/cookies.txt -X POST http://localhost:4723/xenon/api/auth/dashboard-session \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:4723" \
  -d "{\"apiKey\":\"$(cat ~/.cache/xenon/bootstrap-key.txt)\"}"

# Export in JSON
curl -s -b /tmp/cookies.txt -X POST http://localhost:4723/xenon/api/build/a70ac97a-54ab-4ed4-9fba-206e1355fe34/export \
  -H "Content-Type: application/json" -d '{"format":"json"}' | head -c 500

echo; echo "--- CSV ---"

# Export in CSV
curl -s -b /tmp/cookies.txt -X POST http://localhost:4723/xenon/api/build/a70ac97a-54ab-4ed4-9fba-206e1355fe34/export \
  -H "Content-Type: application/json" -d '{"format":"csv"}' | head -c 500
```

Expected: JSON response shows sessions array; CSV shows the header row + session rows. No 500 errors.

Stop server: `pkill -f 'appium' 2>/dev/null || true`

- [ ] **Step 5: Commit**

```bash
git add src/app/routers/dashboard.ts
git commit -m "feat(server): wire POST /build/:buildId/export route" -m "Registers the buildExport handler at /build/:buildId/export on the dashboard router. Manual-verified end-to-end: JSON and CSV both stream with correct Content-Disposition headers." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Add `exportBuild` to XenonApiService

**Files:** Modify `web/src/api-service/index.ts`

- [ ] **Step 1: Read the existing file**

Run: `grep -n 'public static\|makePOSTRequest\|formatUrl' /Users/rabindrabiswal/Workspace/XAenon/xenon/web/src/api-service/index.ts | head -15`

Confirm the POST helper signature. Note the pattern used for existing POST methods.

- [ ] **Step 2: Read api-client to understand makePOSTRequest**

Run: `cat /Users/rabindrabiswal/Workspace/XAenon/xenon/web/src/api-service/api-client.ts`

Note whether makePOSTRequest returns parsed JSON or a raw Response. The new `exportBuild` needs the raw blob (binary-safe), so it may require a new method `makePOSTBlobRequest` or `fetch` directly.

- [ ] **Step 3: Add exportBuild method**

At the end of the class body in `web/src/api-service/index.ts`, add:

```ts
/**
 * Export a build's sessions as a downloadable file.
 *
 * Returns a { blob, filename } pair suitable for a browser-download trigger.
 * `sessionIds` is optional — when omitted the server returns every session in the build.
 */
public static async exportBuild(
  buildId: string,
  format: 'json' | 'csv',
  sessionIds?: string[],
): Promise<{ blob: Blob; filename: string }> {
  const resp = await fetch(`/xenon/api/build/${encodeURIComponent(buildId)}/export`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format, ...(sessionIds ? { sessionIds } : {}) }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`Export failed (${resp.status}): ${text || resp.statusText}`);
  }
  const disposition = resp.headers.get('Content-Disposition') || '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match ? match[1] : `build-${buildId}-sessions.${format}`;
  const blob = await resp.blob();
  return { blob, filename };
}
```

Keep the method next to the other `getBuilds`/`getSessions` methods.

- [ ] **Step 4: Build**

Run: `cd /Users/rabindrabiswal/Workspace/XAenon/xenon/web && npm run build 2>&1 | tail -3`

Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
git add web/src/api-service/index.ts
git commit -m "feat(web): add XenonApiService.exportBuild" -m "Blob-returning fetch helper that reads the server's Content-Disposition filename and returns { blob, filename } so the caller can trigger a browser download. Bypasses makePOSTRequest because the response is binary, not JSON." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire the Export dropdown to the real endpoint

**Files:** Modify `web/src/components/builds/builds-page.tsx`

- [ ] **Step 1: Replace the toast stub**

In `BuildsPage`, replace `onExport` with a real call:

```tsx
const onExport = async (fmt: 'json' | 'csv') => {
  if (!data.selectedBuildId) return;
  try {
    const ids = selectedIds.size > 0 ? Array.from(selectedIds) : undefined;
    const { blob, filename } = await XenonApiService.exportBuild(
      data.selectedBuildId,
      fmt,
      ids,
    );
    // Trigger browser download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(
      `Exported ${ids ? ids.length : 'all'} session${(ids?.length ?? 2) === 1 ? '' : 's'} as ${fmt.toUpperCase()}.`,
      'success',
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    toast(`Export failed: ${msg}`, 'error');
  }
};
```

Add the import at the top of the file if not already present:

```tsx
import XenonApiService from '../../api-service';
```

- [ ] **Step 2: Build**

Run: `cd /Users/rabindrabiswal/Workspace/XAenon/xenon/web && npm run build 2>&1 | tail -3`

Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
git add web/src/components/builds/builds-page.tsx
git commit -m "feat(web): wire Export dropdown to real endpoint" -m "Clicking Export as JSON / Export as CSV now calls XenonApiService.exportBuild and triggers a browser download via a temporary <a download>. Respects per-row selection: when 1+ rows are checked, exports only those. Success/error toasts." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Full rebuild**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon && npm run build:all
```

Expected: all green.

- [ ] **Step 2: Run test suites**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon && npx mocha --require ts-node/register test/unit/build-export.spec.ts 2>&1 | tail -5
cd /Users/rabindrabiswal/Workspace/XAenon/xenon/web && npm test -- --run 2>&1 | tail -5
```

Expected: build-export spec 6/6; web vitest 105/105.

- [ ] **Step 3: Manual download via Playwright**

Start the server (see Task 2 Step 4). Then run:

```bash
cat > /tmp/xenon-verify/export-check.mjs <<'EOF'
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = 'http://localhost:4723/xenon';
const BOOT_KEY = fs.readFileSync(process.env.HOME + '/.cache/xenon/bootstrap-key.txt', 'utf8').trim();
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();

await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(500);
const inp = await p.$('input[type="password"]');
if (inp) { await inp.fill(BOOT_KEY); await p.click('button[type="submit"], button:has-text("Sign in")'); await p.waitForTimeout(1500); }

await p.goto(BASE + '/builds', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);
const firstBuild = await p.$('aside.w-\\[280px\\] button[type="button"]');
if (firstBuild) { await firstBuild.click(); await p.waitForTimeout(1500); }

const exportBtn = await p.$('button:has-text("Export")');
await exportBtn.click(); await p.waitForTimeout(300);

const [dlJson] = await Promise.all([
  p.waitForEvent('download'),
  p.click('button:has-text("Export as JSON")'),
]);
const pJson = '/tmp/xenon-verify/exported-build.json';
await dlJson.saveAs(pJson);
console.log('JSON saved:', pJson, fs.statSync(pJson).size, 'bytes');

await exportBtn.click(); await p.waitForTimeout(300);
const [dlCsv] = await Promise.all([
  p.waitForEvent('download'),
  p.click('button:has-text("Export as CSV")'),
]);
const pCsv = '/tmp/xenon-verify/exported-build.csv';
await dlCsv.saveAs(pCsv);
console.log('CSV saved:', pCsv, fs.statSync(pCsv).size, 'bytes');

await b.close();
EOF

node /tmp/xenon-verify/export-check.mjs
head -c 500 /tmp/xenon-verify/exported-build.json
echo; echo "--- CSV ---"
head -5 /tmp/xenon-verify/exported-build.csv
```

Expected: both files > 0 bytes; JSON starts with `[`; CSV header line contains `id,build_id,status,…`.

Stop server: `pkill -f 'appium' 2>/dev/null || true`

- [ ] **Step 4: No commit** — verification only.

---

## Self-Review Notes

1. **Spec coverage** — §7.2 Export endpoint: covered by Tasks 1, 2. §7.2 frontend wiring: covered by Tasks 3, 4. §7.2 Retry endpoint is **out of scope** for this plan — deferred to 4B-2 with an updated scope note at the top of this doc.
2. **Placeholder scan** — Task 1 Step 4 flags the prisma import path as a "guess" — that's load-bearing info for the implementer, not a placeholder. Everything else is concrete.
3. **Type consistency** — `'json' | 'csv'` union used consistently across backend + frontend. `sessionIds?: string[]` optional on both sides.
4. **Risks** — large build (>5000 sessions) responds 413 with JSON, not a CSV error — frontend catches this cleanly via the throw path in `exportBuild`.
