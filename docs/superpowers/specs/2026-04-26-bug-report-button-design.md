# Bug Report Button (Design Spec)

**Date:** 2026-04-26
**Scope:** New feature — one-click bundling of session artifacts (video, logs, network, AI summary, metadata) into a downloadable zip suitable for attaching to a Jira/Linear/GitHub ticket.
**Out of scope (deferred):** Direct ticketing-system integrations (Jira/Linear/GitHub adapters), S3 upload, shareable URLs, custom bundle templates per team. These are Phase 2.

## Goal

Close the test-fail → bug-ticket loop. When a tester sees a failure (live or post-session), one click produces a self-contained zip that another engineer can open and reproduce the failure context from — no Slack-thread artifact-hunting required.

The audit confirmed all underlying data already exists: ffmpeg-recorded MP4, `InterceptorService` HAR, persisted logs, `failure-analysis-service` AI summary, session/device metadata in Prisma. This feature orchestrates those into a coherent, redacted, manifest-ed bundle.

## Architecture

```
┌─────────────── FRONTEND (web/) ───────────────┐
│ BugReportButton.tsx                           │
│   • Live session view  → floating, mode=slice │
│   • Post-session view  → header,   mode=full  │
│   • Click → POST /api/sessions/:id/bug-report │
│   • Receives zip stream → triggers download   │
└───────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────── BACKEND (src/) ────────────────┐
│ POST /xenon/api/sessions/:sessionId/bug-report│
│   ?mode=slice&windowSec=60 | ?mode=full       │
│        │                                      │
│        ▼                                      │
│ BugReportService                              │
│   ├─ collectVideo()  — ffmpeg slice or copy   │
│   ├─ collectLogs()   — Prisma SessionLog      │
│   ├─ collectHAR()    — InterceptorService     │
│   ├─ collectMeta()   — Session + Device + Caps│
│   ├─ collectAISummary() — failure-analysis    │
│   ├─ redact() — redactSecrets() from logger   │
│   └─ archive() — archiver streams zip → res   │
└───────────────────────────────────────────────┘
```

## Files Touched

| File | Why |
|---|---|
| `src/services/BugReportService.ts` | NEW — orchestration service (~250 LOC) |
| `src/app/routers/bug-report.ts` | NEW — Express route handler (~60 LOC) |
| `src/app/index.ts` | Register new router alongside existing ones (~+2 lines) |
| `src/app/swagger-docs.ts` | Document the endpoint |
| `web/src/components/bug-report/BugReportButton.tsx` | NEW — React component (~120 LOC) |
| `web/src/api-service/bug-report.ts` | NEW — fetch wrapper that triggers download (~40 LOC) |
| `web/src/components/device-control/device-control.tsx` | Mount button (floating, slice mode) (~+5 lines) |
| `web/src/components/session-detail/breadcrumb-header.tsx` | Mount button (inline, full mode) (~+5 lines) |
| `test/unit/services/bug-report-service.spec.ts` | NEW — unit coverage |
| `test/integration/bug-report.spec.ts` | NEW — endpoint integration test |

No schema changes. No new npm dependencies — `archiver@7.0.1` and `@types/archiver@6.0.2` already in `package-lock.json`.

## Endpoint

```
POST /xenon/api/sessions/:sessionId/bug-report
Query params:
  mode       slice | full              (default depends on session state — live → slice, ended → full)
  windowSec  integer 5..600            (slice mode only; default 60)

Response:
  200 application/zip — streamed, Content-Disposition: attachment;
       filename="bugreport-<sessionId>-<ISO8601>.zip"
  404  session not found
  400  invalid params (e.g., windowSec out of range, mode=slice but session has no recording)
  500  unrecoverable error before any artifact written
```

Note: partial artifact failures (e.g., ffmpeg fails) do **not** 500 — the bundle still ships with `null` entries in the manifest and a warning logged server-side.

## Bundle Layout

```
bugreport-<sessionId>-<ISO8601>.zip
├── manifest.json          ← machine-readable
├── README.md              ← human-readable summary
├── video.mp4              ← sliced or full (omitted if no recording)
├── logs.txt               ← redacted
├── network.har            ← redacted; omitted if InterceptorService had no captures
├── ai-summary.txt         ← omitted if not available
└── screenshots/
    └── last-frame.png     ← single frame at slice end (best-effort)
```

### `manifest.json` schema

```json
{
  "schemaVersion": "1.0",
  "generatedAt": "2026-04-26T10:23:45.123Z",
  "xenonVersion": "from package.json",
  "mode": "slice",
  "window": {
    "startedAt": "2026-04-26T10:22:45.000Z",
    "endedAt":   "2026-04-26T10:23:45.000Z",
    "durationMs": 60000,
    "requestedDurationMs": 60000
  },
  "session": {
    "id": "abc-123",
    "status": "finished",
    "startedAt": "...",
    "endedAt": "...",
    "durationMs": 184000
  },
  "device": {
    "udid": "...",
    "platform": "android",
    "name": "Pixel 7",
    "osVersion": "14"
  },
  "capabilities": { "...redacted via redactSecrets()": "..." },
  "lastCommand": { "name": "click", "args": [...], "errorMessage": "..." } | null,
  "artifacts": {
    "video":       "video.mp4" | null,
    "logs":        "logs.txt",
    "network":     "network.har" | null,
    "aiSummary":   "ai-summary.txt" | null,
    "screenshots": ["screenshots/last-frame.png"] | []
  },
  "warnings": ["video slice failed: <message>"]
}
```

`requestedDurationMs` vs. `durationMs` lets consumers see when the session was shorter than the requested slice window.

### `README.md` (human-readable)

Auto-generated, ~15 lines:

```
# Xenon Bug Report

**Session:** abc-123 (finished, 3m 04s)
**Device:** Pixel 7 / Android 14
**Generated:** 2026-04-26 10:23 UTC
**Mode:** slice (last 60s)

## AI Summary
<contents of ai-summary.txt, or "(not available)">

## Last command
click — TimeoutError: element not found

## Artifacts
- video.mp4 (60s slice)
- logs.txt
- network.har (12 requests captured)
- screenshots/last-frame.png
```

## Data Flow & Edge Cases

1. **Mode resolution**
   - `mode=slice` (default in live view): anchor the window to "now" if session is live, or to `endedAt` if finished. Compute `windowStart = anchor - windowSec`.
   - `mode=full` (default in post-session view): take everything between `session.startedAt` and `session.endedAt`.
   - If a live session has run for less than `windowSec`, slice from `session.startedAt` and surface `requestedDurationMs > durationMs` in manifest.

2. **Video slicing**
   - Use `ffmpeg -ss <windowStart> -to <windowEnd> -i <recording.mp4> -c copy <out.mp4>` for fast keyframe-aligned trim. No re-encode.
   - Resolve recording path via existing recording lookup used by `recording-card.tsx`.
   - On any ffmpeg failure: log warning, omit `video.mp4`, set `artifacts.video = null`, push reason into `warnings[]`. Bundle still ships.
   - `mode=full`: copy the existing MP4 verbatim — no ffmpeg invocation needed.

3. **Live session flush**
   - Before reading logs/HAR for a live session, fire a small "flush" call into `InterceptorService` and the log subsystem so any in-flight buffers are persisted. Without this, the last 1–2 seconds may be missing.

4. **AI Summary**
   - Read from `failure-analysis-service` if it has already produced one.
   - If not, trigger generation synchronously with a **5-second hard timeout**. On timeout, omit and add a warning. Never block the bundle waiting on an LLM.
   - For sessions that haven't failed (status = finished, no error), AI summary is omitted by design.

5. **Redaction**
   - Apply `redactSecrets()` (already exported from `src/logger.ts`) to:
     - capabilities object before writing manifest
     - HAR request/response headers + bodies (parse JSON-content-type bodies; leave binary bodies intact)
     - logs.txt (the logger already redacts before persisting; we still pass it through as defense-in-depth)
   - Never write raw env vars or auth tokens into manifest.

6. **Streaming**
   - Use `archiver` in `zip` mode, piped directly to the Express `res`. Set `Content-Type: application/zip` and `Content-Disposition` headers before the first chunk.
   - Never buffer the full zip to memory or disk. This keeps memory bounded for `mode=full` on long sessions with large recordings.

7. **Concurrency / cleanup**
   - ffmpeg slice writes to a tempfile; pipe into archiver; delete tempfile in `finally`.
   - If the client cancels the download mid-stream, the archiver close + tempfile cleanup run via the `res` `close` event handler.

## Frontend Behavior

### `BugReportButton.tsx`

Props:
```ts
{
  sessionId: string;
  mode: 'slice' | 'full';
  windowSec?: number;       // slice only, default 60
  variant: 'floating' | 'inline';
}
```

- `floating`: bottom-right of device-control viewport, semi-transparent, only visible while session is live. Tooltip: "Capture last 60s as bug report". Single-click triggers download.
- `inline`: regular button in session-detail header. Label: "Download bug report". Default mode = `full`. Has a small popover with a "slice last N seconds" override.
- During the download: button shows a spinner and disables. On error: inline error toast.
- Uses existing `Button` primitive, no new design tokens.

### `api-service/bug-report.ts`

```ts
export async function downloadBugReport(opts: {
  sessionId: string;
  mode: 'slice' | 'full';
  windowSec?: number;
}): Promise<void>;
```

Internally fetches the endpoint, reads the response as a blob, creates a temporary `<a>` with `href = URL.createObjectURL(blob)` and `download = filename-from-Content-Disposition`, clicks it, revokes the URL. No new state library.

## Error Handling Matrix

| Failure | Behavior |
|---|---|
| Session not found | 404 JSON error, button shows toast |
| `mode=slice`, no recording on disk | 400 with `{ error: "no recording" }`; button suggests `mode=full` |
| `mode=full`, no recording on disk | Bundle ships without video.mp4 (don't 400 — logs/HAR may still be valuable) |
| ffmpeg slice fails | Bundle ships without video, manifest warning |
| InterceptorService has no data | `network.har` omitted, manifest warning |
| AI summary generation times out | omitted, manifest warning |
| Redaction throws on a single value | Replace value with `"<redaction-error>"` and continue |
| Disk full / write error during streaming | 500 only if no bytes sent; if streaming has begun, abort the response (client sees truncated download) and log server-side |
| Client disconnects mid-stream | Archiver `abort()`, tempfile cleanup, no error logged |

## Testing

### Unit (`test/unit/services/bug-report-service.spec.ts`)

- `BugReportService.collectMeta()` — given a fixture session, produces the expected manifest shape.
- `redact()` — capabilities containing `accessKey`, `password`, `Bearer ...` come out redacted; other fields unchanged.
- `resolveWindow()` — correct behavior for: live session shorter than window, live session longer than window, finished session, finished session with no `endedAt`.
- Missing-artifact graceful handling — when ffmpeg returns non-zero, `collectVideo()` returns `null` with a warning, doesn't throw.

### Integration (`test/integration/bug-report.spec.ts`)

- Seed Prisma with a fixture finished session + a small recorded MP4 + 3 HAR entries + 50 log lines.
- Hit the endpoint with `mode=slice&windowSec=30`.
- Unzip the streamed response in-memory.
- Assert: 5 expected entries present, manifest validates against a JSON-schema fixture, `video.mp4` is non-empty, `network.har` parses as valid HAR 1.2.

### Skipped

- No mobile e2e (this is plugin-internal).
- No frontend visual snapshot test (button is a thin wrapper around existing primitives).

## Implementation Phases

For the writing-plans skill to expand:

1. **Backend: BugReportService skeleton + manifest assembly + route** (no video slicing yet, no streaming — return JSON manifest only). Unit tests pass.
2. **Backend: archiver streaming + log/HAR/screenshot collection.** Integration test passes for `mode=full`.
3. **Backend: ffmpeg slice path.** `mode=slice` integration test passes.
4. **Backend: AI summary integration + redaction.** Manifest correctness test extended.
5. **Frontend: api-service + BugReportButton primitive.** Storybook-style isolated render.
6. **Frontend: mount in device-control (floating, slice).**
7. **Frontend: mount in session-detail (inline, full + popover override).**
8. **Polish: swagger docs, error toasts, telemetry event emission (`BUG_REPORT_GENERATED`).**

Each phase is independently mergeable.

## Open questions / assumptions made

- **Default slice window: 60s.** Configurable later via plugin arg if needed.
- **Bundle size cap: none.** A long full session could be 100MB+. We rely on the user's browser to handle large downloads; we never buffer in memory anyway.
- **No auth gating beyond what existing `/xenon/api` routes already enforce.** If the user can hit the dashboard, they can download bundles for sessions they can already see.
- **Telemetry: emit `BUG_REPORT_GENERATED` socket event** (size, mode, durationMs, success/failure) for dashboard analytics. Cheap, optional in v1.

## Acceptance criteria

1. From a live session, clicking the floating button downloads a `bugreport-*.zip` containing the last 60s of video, logs, HAR, and a manifest within 5 seconds of click.
2. From a finished session detail page, clicking "Download bug report" downloads the full session bundle.
3. The "slice last N seconds" override on the post-session button works for any value 5..600.
4. Capabilities, HAR headers, and logs in the bundle have no plaintext API keys, bearer tokens, or password fields when checked against `redactSecrets()` patterns.
5. ffmpeg failure does not block the bundle — manifest reflects the missing artifact.
6. Manifest validates against the JSON schema fixture on every integration run.
