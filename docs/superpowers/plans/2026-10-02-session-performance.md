# Session CPU and Memory (Performance view) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record CPU and memory every 2 s for each session on this server's own phones, and chart them in a Performance panel on the session page.

**Architecture:**
- **`SessionMetricsService`** (TypeDI) starts a per-session sampler when `EventManager` writes the session's row, buffers its samples and writes them every 10 s to a new `SessionMetric` table.
- **Android** samples with one `adb shell` call reading `/proc`. **iPhone** runs `ios sysmontap` through the phone's go-ios tunnel.
- **Dashboard:** `GET /session/:id/metrics` feeds a `PerformancePanel` with two hand-drawn SVG line charts.

**Tech Stack:** TypeScript, Express, Prisma 5 (SQLite), TypeDI, Mocha/Chai/Sinon; React 17, Tailwind, Vitest + Testing Library; Playwright (viewport spec).

**Spec:** `docs/superpowers/specs/2026-10-02-session-performance-design.md`

## Global Constraints

- **Timing:** a sample every `2000` ms, a write every `10000` ms, and a sampler stops after `5` failures in a row. The foreground app is re-read every `10000` ms, and an iPhone sampler asks for its tunnel every `30000` ms.
- **What is recorded:** Android records app CPU %, app memory (`VmRSS`), device CPU % and device memory used and total. An iPhone records device CPU only.
- **Which phones:** this server's own phones only (`isOwnDevice`). A node session's figures are on the node's dashboard.
- **Setting:** `sessionMetrics` is an optional boolean plugin argument (not in `required`, default `true`). `false` turns sampling off.
- **No new dependencies.** The charts are SVG in React.
- **No raw hex or `rgba()` in `web/src`** (the `color-literals` ratchet). Use role tokens: `var(--color-info)`, `var(--color-accent)`, `var(--border-strong)`, `var(--text*)`.
- **adb:** the resolved adb only (`AndroidDeviceManager.getAdbForDevice`), never a bare `adb`.
- **Builds:** don't run `npm run build` in a worktree. The Prisma client is regenerated with `node scripts/generate-prisma.js`, then its two embedded absolute paths are put back (Task 1).
- **Formatting:**
  - Never run `eslint --fix` or prettier on an existing file. Run prettier only on new files, and hand-format edits.
  - ESLint counts per changed file must not rise against `origin/main`.
- **Tests:**
  - Mocha hooks go inside `describe`.
  - Specs that touch TypeDI start with `import 'reflect-metadata'`.
  - Stub `process.kill` in any spec that can reach `ProcessRegistry`.
- **Node:** v22.19 (`source ~/.nvm/nvm.sh && nvm use 22.19.0`).
- **Git:** stage explicit paths only (never `git add -A`, never `temp-appium/*.json`), and add no attribution lines to commits.

## Review Focus

1. **Unsafe `appPackage`.** A session's `appPackage` that isn't a package name (`com.x;reboot`, `$(id)`, spaces) must never reach the phone's shell. Sampling uses the foreground app instead. Tests: Task 2 (`isSafePackage`, `androidSampleCommand` throws) and Task 3 (no command ever contains it).
2. **App restarted mid-session.** When the app under test crashes or restarts (a new pid), that sample's app CPU is empty, not a spike. Test: Task 2.
3. **Writes that keep failing** (no session row, a locked database) must not grow memory without bound. The newest 900 samples wait for the next write. Test: Task 4.
4. **Very long sessions.** Thousands of samples must still draw quickly: at most 600 points per line, always ending at the last sample. Test: Task 6.
5. **A session ending mid-sample** must not report that sample after `stop()`, or write it after the final write. Tests: Task 3 (Android sampler) and Task 4 (service drops a late sample).

---

## File structure

**Server, new (`src/services/metrics/`):**

| File | What it holds |
|---|---|
| `types.ts` | `MetricSample`, the timing constants, the `SamplerHooks` / `MetricsSampler` interfaces, `round1`, `clamp` |
| `androidMetrics.ts` | Pure Android logic: `isSafePackage`, `appPackageOf`, `androidSampleCommand`, `parseAndroidReading`, `androidSample`, `parseForegroundPackage` |
| `iosMetrics.ts` | Pure `parseSysmontapCpu` |
| `AndroidMetricsSampler.ts` | The 2 s loop over an injected `shell` |
| `IOSMetricsSampler.ts` | The sysmontap child, tunnel renewal and the 2 s report |
| `SessionMetricsService.ts` | `appliesTo`, `start`, `stop`, buffering and writes; seams `context`, `writeSamples`, `samplerFor` |
| `metricsBody.ts` | Pure `sessionMetricsBody` for the API |

**Server, changed:**
- `prisma/schema.prisma`, plus a new migration and the regenerated `src/generated/client`.
- `src/prisma.ts` (model list) and `test/helpers/scratch-database.ts` (model list).
- `src/services/CleanupService.ts` (delete metrics).
- `schema.json` and `src/interfaces/IPluginArgs.ts` (the `sessionMetrics` setting).
- `src/dashboard/event-manager.ts` (start and stop sampling; the old profiler goes).
- `src/profiling/AndroidAppProfiler.ts` is deleted.
- `src/app/routers/dashboard.ts` (the route).

**Dashboard (`web/`):**
- `web/src/api-service/index.ts`: `getSessionMetrics`.
- New `web/src/components/session-detail/performance.ts`: types and formatting.
- New `web/src/components/session-detail/line-chart.tsx`.
- New `web/src/components/session-detail/performance-panel.tsx`.
- `web/src/components/session-detail/session-detail-page.tsx`: placement.
- `web/test/viewport/overflow.spec.ts`: the metrics mock and content check.

**Docs:** `CLAUDE.md`.

---

### Task 1: Storage, the setting, and cleanup

**Files:**
- Modify: `prisma/schema.prisma` (Session relations near line 53; new model)
- Create: `prisma/migrations/20261002120000_session_metric/migration.sql`
- Regenerate: `src/generated/client/*`
- Modify: `src/prisma.ts:33-39`, `test/helpers/scratch-database.ts` (the `MODELS` list)
- Modify: `src/services/CleanupService.ts` (`deleteSessionChildren`)
- Modify: `schema.json`, then regenerate `src/interfaces/IPluginArgs.ts`
- Test: `test/unit/CleanupService.spec.ts`

**Interfaces:**
- Produces: the Prisma model `SessionMetric`, with fields `id`, `session_id`, `at` (Float, epoch ms), `device_cpu_pct`, `device_mem_mb`, `device_mem_total`, `app_cpu_pct`, `app_mem_mb` (Float?), `app_id` (String?). Reached as `prisma.sessionMetric` (stubbable, scratch-redirectable).
- Produces: `IPluginArgs.sessionMetrics?: boolean`.

- [ ] **Step 1: Add the model and the Session relation**

In `prisma/schema.prisma`, add to `model Session`, beside `Profiling Profiling[]`:

```prisma
  SessionMetric           SessionMetric[]
```

Append the new model after `model Profiling { ... }`:

```prisma
/// CPU and memory sampled every 2 s while a session runs (SessionMetricsService).
model SessionMetric {
  id               Int     @id @default(autoincrement())
  session_id       String
  /// epoch ms
  at               Float
  device_cpu_pct   Float?
  device_mem_mb    Float?
  device_mem_total Float?
  app_cpu_pct      Float?
  app_mem_mb       Float?
  /// The package the app figures are for (Android), else null.
  app_id           String?
  session          Session @relation(fields: [session_id], references: [id], onDelete: Cascade)

  @@index([session_id, at])
}
```

- [ ] **Step 2: Write the migration from Prisma's own diff**

```bash
mkdir -p prisma/migrations/20261002120000_session_metric
DATABASE_URL='file:./ci-check.db' npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261002120000_session_metric/migration.sql
cat prisma/migrations/20261002120000_session_metric/migration.sql
```

Expected: a `CREATE TABLE "SessionMetric"` with a `FOREIGN KEY ("session_id") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE`, and `CREATE INDEX "SessionMetric_session_id_at_idx"`. Nothing else.

Then:

```bash
DATABASE_URL='file:./ci-check.db' npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code; echo "exit $?"; rm -f ci-check.db
```

Expected: `exit 0`.

- [ ] **Step 3: Regenerate the client and put back the main checkout's paths**

```bash
node scripts/generate-prisma.js
WT="$(pwd)"; MAIN=/Users/rabindrabiswal/Workspace/XAenon/xenon
sed -i '' "s#${WT}/#${MAIN}/#g" src/generated/client/edge.js src/generated/client/index.js
grep -c ".claude/worktrees" src/generated/client/*.js | grep -v ':0' || echo "no worktree paths"
git diff --stat src/generated
```

Expected: "no worktree paths". The diff touches the generated client files (`index.d.ts`, `index.js`, `edge.js`, `schema.prisma`, `wasm.js`, `index-browser.js`, `package.json`) and nothing outside `src/generated`.

- [ ] **Step 4: Expose the model through the wrapper and the scratch helper**

`src/prisma.ts`, in `MODEL_DELEGATES`, change the last line `  'annotation',` to:

```ts
  'annotation', 'sessionMetric',
```

`test/helpers/scratch-database.ts`, in `MODELS`, after `'annotation',` add:

```ts
  'sessionMetric',
```

- [ ] **Step 5: Write the failing cleanup test**

Replace `test/unit/CleanupService.spec.ts` with:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { CleanupService } from '../../src/services/CleanupService';
import { prisma } from '../../src/prisma';

describe('CleanupService Unit Tests', () => {
  let cleanupService: CleanupService;

  beforeEach(() => {
    cleanupService = Container.get(CleanupService);
  });

  afterEach(() => sinon.restore());

  it('should be instantiable via TypeDI', () => {
    expect(cleanupService).to.be.an.instanceOf(CleanupService);
  });

  it('should have runCleanup method', () => {
    expect(cleanupService.runCleanup).to.be.a('function');
  });

  it('should have purgeBuild method', () => {
    expect(cleanupService.purgeBuild).to.be.a('function');
  });

  it("deletes a session's CPU and memory samples with its other rows", async () => {
    const deleted: string[] = [];
    for (const model of ['sessionLog', 'log', 'profiling', 'sessionMetric']) {
      sinon.stub((prisma as any)[model], 'deleteMany').callsFake(async (args: any) => {
        deleted.push(`${model}:${args.where.session_id}`);
        return { count: 0 };
      });
    }

    await (cleanupService as any).deleteSessionChildren('s-cleanup-1');

    expect(deleted).to.include('sessionMetric:s-cleanup-1');
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npx mocha test/unit/CleanupService.spec.ts`
Expected: FAIL, `expected [ …(3) ] to include 'sessionMetric:s-cleanup-1'`.

- [ ] **Step 7: Delete metrics with the session**

`src/services/CleanupService.ts`, in `deleteSessionChildren`, after the `profiling` line add:

```ts
      prisma.sessionMetric.deleteMany({ where: { session_id: sessionId } }),
```

- [ ] **Step 8: Run it and watch it pass**

Run: `npx mocha test/unit/CleanupService.spec.ts`
Expected: 4 passing.

- [ ] **Step 9: Add the setting**

In `schema.json`, under `properties`, after `"streaming"`'s entry (it must not go in `required`), add:

```json
    "sessionMetrics": {
      "type": "boolean",
      "default": true,
      "description": "Record CPU and memory every 2 s for each session on this server's own phones (Android: the app under test and the device; iPhone: device CPU), shown in the session page's Performance panel. Needs the dashboard."
    },
```

Then:

```bash
npm run build:schema
git diff src/interfaces/IPluginArgs.ts
python3 -c "import json; s=json.load(open('schema.json')); assert 'sessionMetrics' not in s['required']; print('optional')"
```

Expected: one new line, `sessionMetrics?: boolean;`, with its description comment, and `optional`. If the generator changed anything else, revert those other hunks by hand.

- [ ] **Step 10: Check types and commit**

```bash
npx tsc --noEmit -p . && echo "types ok"
git add prisma/schema.prisma prisma/migrations/20261002120000_session_metric/migration.sql src/generated src/prisma.ts test/helpers/scratch-database.ts src/services/CleanupService.ts test/unit/CleanupService.spec.ts schema.json src/interfaces/IPluginArgs.ts
git commit -m "feat(metrics): a SessionMetric table, the sessionMetrics setting, and cleanup"
```

---

### Task 2: Pure parsers and maths

**Files:**
- Create: `src/services/metrics/types.ts`, `src/services/metrics/androidMetrics.ts`, `src/services/metrics/iosMetrics.ts`
- Test: `test/unit/session-metrics-parse.spec.ts`

**Interfaces:**
- Produces (`types.ts`):

  ```ts
  interface MetricSample {
    at: number;
    deviceCpuPct: number | null;
    deviceMemMb: number | null;
    deviceMemTotalMb: number | null;
    appCpuPct: number | null;
    appMemMb: number | null;
    appId: string | null;
  }
  ```

  - Constants: `SAMPLE_INTERVAL_MS`, `FLUSH_INTERVAL_MS`, `MAX_CONSECUTIVE_FAILURES`, `FOREGROUND_REFRESH_MS`, `TUNNEL_RENEW_MS`, `MAX_BUFFERED_SAMPLES`.
  - `interface SamplerHooks { onSample(s: MetricSample): void; onGiveUp(reason: string): void }`
  - `interface MetricsSampler { start(): void; stop(): Promise<void> }`
  - `round1(n)`, `clamp(n, lo, hi)`.
- Produces (`androidMetrics.ts`): `AndroidReading`, `isSafePackage(pkg: unknown): pkg is string`, `appPackageOf(caps): unknown`, `androidSampleCommand(pkg: string | null): string`, `parseAndroidReading(out: string): AndroidReading | null`, `androidSample(prev, cur, appId, at): MetricSample`, `parseForegroundPackage(dumpsys: string): string | null`.
- Produces (`iosMetrics.ts`): `parseSysmontapCpu(line: string): number | null`.

- [ ] **Step 1: Write the failing tests**

Create `test/unit/session-metrics-parse.spec.ts`:

```ts
import { expect } from 'chai';
import {
  androidSample,
  androidSampleCommand,
  appPackageOf,
  isSafePackage,
  parseAndroidReading,
  parseForegroundPackage,
} from '../../src/services/metrics/androidMetrics';
import { parseSysmontapCpu } from '../../src/services/metrics/iosMetrics';

/**
 * Recorded on the S9+ (Android 10) with the command androidSampleCommand
 * builds; the second reading is the first plus 1000 jiffies, 800 of them
 * idle, and 50 for the app.
 */
const FIRST = [
  'cpu  4842746 1486246 9435122 410569805 191176 0 106298 0 0 0',
  'MemTotal:        5755748 kB',
  'MemAvailable:    2839168 kB',
  'pid=1404',
  'stat=211391 93546',
  'VmRSS:\t  334480 kB',
].join('\n');
const SECOND = [
  'cpu  4842846 1486246 9435222 410570595 191186 0 106298 0 0 0',
  'MemTotal:        5755748 kB',
  'MemAvailable:    2838144 kB',
  'pid=1404',
  'stat=211421 93566',
  'VmRSS:\t  335504 kB',
].join('\n');

describe('session metrics: Android readings', () => {
  it('reads device CPU jiffies, memory, and the app process', () => {
    expect(parseAndroidReading(FIRST)).to.deep.equal({
      cpuTotal: 4842746 + 1486246 + 9435122 + 410569805 + 191176 + 0 + 106298 + 0,
      cpuIdle: 410569805 + 191176,
      memTotalKb: 5755748,
      memAvailableKb: 2839168,
      pid: 1404,
      appJiffies: 211391 + 93546,
      appRssKb: 334480,
    });
  });

  it('reads a device with no app process as device figures only', () => {
    const out = [FIRST.split('\n')[0], FIRST.split('\n')[1], FIRST.split('\n')[2], 'pid='].join('\n');
    expect(parseAndroidReading(out)).to.include({ pid: null, appJiffies: null, appRssKb: null });
  });

  it('reads output with CRLF line ends', () => {
    expect(parseAndroidReading(FIRST.replace(/\n/g, '\r\n'))).to.include({ pid: 1404, appRssKb: 334480 });
  });

  it('gives up on output without the cpu line', () => {
    expect(parseAndroidReading('MemTotal: 5755748 kB')).to.equal(null);
  });

  it('records no CPU on the first sample, only memory', () => {
    const s = androidSample(null, parseAndroidReading(FIRST)!, 'com.android.systemui', 1000);
    expect(s).to.deep.equal({
      at: 1000,
      deviceCpuPct: null,
      deviceMemMb: 2848.2,
      deviceMemTotalMb: 5620.8,
      appCpuPct: null,
      appMemMb: 326.6,
      appId: 'com.android.systemui',
    });
  });

  it('turns two readings into device and app CPU as shares of the whole device', () => {
    const s = androidSample(
      parseAndroidReading(FIRST),
      parseAndroidReading(SECOND)!,
      'com.android.systemui',
      3000,
    );
    expect(s.deviceCpuPct).to.equal(20);
    expect(s.appCpuPct).to.equal(5);
    expect(s.appMemMb).to.equal(327.6);
  });

  it('records no app CPU, not a spike, when the app restarted between samples', () => {
    const restarted = SECOND.replace('pid=1404', 'pid=2210').replace('stat=211421 93566', 'stat=12 8');
    const s = androidSample(parseAndroidReading(FIRST), parseAndroidReading(restarted)!, 'com.android.systemui', 3000);
    expect(s.appCpuPct).to.equal(null);
    expect(s.deviceCpuPct).to.equal(20);
    expect(s.appMemMb).to.equal(327.6);
  });

  it('names no app when the app has no process', () => {
    const none = [SECOND.split('\n')[0], SECOND.split('\n')[1], SECOND.split('\n')[2], 'pid='].join('\n');
    const s = androidSample(parseAndroidReading(FIRST), parseAndroidReading(none)!, 'com.acme.shop', 3000);
    expect(s).to.include({ appId: null, appCpuPct: null, appMemMb: null, deviceCpuPct: 20 });
  });
});

describe('session metrics: Android package names', () => {
  it('accepts package names and nothing else', () => {
    for (const ok of ['com.acme.shop', 'com.sec.android.app.launcher', 'io.x_y.App2']) {
      expect(isSafePackage(ok), ok).to.equal(true);
    }
    for (const bad of ['', 'shop', 'com.acme;reboot', '$(id).x', 'com.acme shop', 'com..x', '1com.x', undefined, 42]) {
      expect(isSafePackage(bad), String(bad)).to.equal(false);
    }
  });

  it("reads a session's appPackage from either capability spelling", () => {
    expect(appPackageOf({ 'appium:appPackage': 'com.a.b' })).to.equal('com.a.b');
    expect(appPackageOf({ appPackage: 'com.c.d' })).to.equal('com.c.d');
    expect(appPackageOf({})).to.equal(undefined);
    expect(appPackageOf(undefined)).to.equal(undefined);
  });

  it('builds a device-only command with no package, and refuses anything but a package', () => {
    expect(androidSampleCommand(null)).to.not.include('pidof');
    expect(androidSampleCommand('com.acme.shop')).to.include('pidof com.acme.shop');
    expect(() => androidSampleCommand('com.acme;reboot')).to.throw(/not a package name/);
  });

  it('reads the foreground app from dumpsys, before and after Android 10', () => {
    expect(
      parseForegroundPackage(
        '    mResumedActivity: ActivityRecord{c51fd83 u0 com.sec.android.app.launcher/.activities.LauncherActivity t2}',
      ),
    ).to.equal('com.sec.android.app.launcher');
    expect(
      parseForegroundPackage('  topResumedActivity=ActivityRecord{a1b2c3 u0 com.acme.shop/.MainActivity t12}'),
    ).to.equal('com.acme.shop');
    expect(parseForegroundPackage('nothing resumed')).to.equal(null);
  });
});

describe('session metrics: iPhone sysmontap lines', () => {
  it('reads device CPU, the load divided over the cores', () => {
    const line =
      '{"time":"2026-10-02T11:56:46.322036+05:30","level":"INFO","msg":"received CPU usage data","cpu_count":6,"enabled_cpus":6,"end_time":1301586447413,"cpu_total_load":77.48226950354608}';
    expect(parseSysmontapCpu(line)).to.equal(12.9);
  });

  it('reads nothing from other lines', () => {
    expect(parseSysmontapCpu('{"level":"WARN","msg":"go-ios agent is not running."}')).to.equal(null);
    expect(parseSysmontapCpu('not json')).to.equal(null);
  });

  it('never reports more than 100%', () => {
    expect(parseSysmontapCpu('{"enabled_cpus":2,"cpu_total_load":450}')).to.equal(100);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx mocha test/unit/session-metrics-parse.spec.ts`
Expected: FAIL, `Cannot find module '../../src/services/metrics/androidMetrics'`.

- [ ] **Step 3: Write `types.ts`**

```ts
/**
 * One CPU and memory reading of a session's phone. CPU is a share of the
 * whole device (0–100); memory is in MB. A figure the platform can't give,
 * or the first sample's CPU (it needs a previous reading), is null.
 */
export interface MetricSample {
  at: number;
  deviceCpuPct: number | null;
  deviceMemMb: number | null;
  deviceMemTotalMb: number | null;
  appCpuPct: number | null;
  appMemMb: number | null;
  /** The package the app figures are for (Android), else null. */
  appId: string | null;
}

/** How often a session's phone is sampled. */
export const SAMPLE_INTERVAL_MS = 2_000;
/** How often a session's samples are written; a crash loses at most this much. */
export const FLUSH_INTERVAL_MS = 10_000;
/** A sampler that fails this many times in a row stops for its session. */
export const MAX_CONSECUTIVE_FAILURES = 5;
/** How long a looked-up foreground app is trusted (Android, no appPackage). */
export const FOREGROUND_REFRESH_MS = 10_000;
/** How often an iPhone sampler asks for its phone's tunnel again. */
export const TUNNEL_RENEW_MS = 30_000;
/** Samples waiting for a write that keeps failing: the newest 30 minutes. */
export const MAX_BUFFERED_SAMPLES = 900;

export interface SamplerHooks {
  onSample(sample: MetricSample): void;
  /** The sampler stopped itself after repeated failures. */
  onGiveUp(reason: string): void;
}

export interface MetricsSampler {
  start(): void;
  stop(): Promise<void>;
}

export const round1 = (n: number): number => Math.round(n * 10) / 10;
export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
```

- [ ] **Step 4: Write `androidMetrics.ts`**

```ts
import { MetricSample, clamp, round1 } from './types';

/** What one `adb shell` sample reads. Jiffies are cumulative since boot. */
export interface AndroidReading {
  cpuTotal: number;
  cpuIdle: number;
  memTotalKb: number | null;
  memAvailableKb: number | null;
  pid: number | null;
  appJiffies: number | null;
  appRssKb: number | null;
}

/**
 * An Android package name: two or more dot-separated identifiers. A session's
 * appPackage is client input and goes into a shell command, so nothing else
 * is ever used.
 */
export function isSafePackage(pkg: unknown): pkg is string {
  return typeof pkg === 'string' && /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(pkg);
}

/** A session's appPackage capability, in either spelling. Not yet validated. */
export function appPackageOf(caps: Record<string, unknown> | undefined): unknown {
  return caps?.['appium:appPackage'] ?? caps?.appPackage;
}

/** The one shell command a sample runs: device CPU and memory, then the app's. */
export function androidSampleCommand(pkg: string | null): string {
  const device = "head -1 /proc/stat; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo";
  if (pkg === null) return device;
  if (!isSafePackage(pkg)) throw new Error(`not a package name: ${pkg}`);
  return (
    `${device}; p=$(pidof ${pkg} | cut -d' ' -f1); echo "pid=$p"; ` +
    `if [ -n "$p" ]; then echo "stat=$(cut -d' ' -f14,15 /proc/$p/stat)"; grep VmRSS /proc/$p/status; fi`
  );
}

const num = (m: RegExpMatchArray | null): number | null => (m ? Number(m[1]) : null);

export function parseAndroidReading(out: string): AndroidReading | null {
  const cpu = out.match(/^cpu\s+([\d\s]+)$/m);
  if (!cpu) return null;
  const f = cpu[1].trim().split(/\s+/).map(Number);
  if (f.length < 4 || f.some((n) => !Number.isFinite(n))) return null;
  // user nice system idle iowait irq softirq steal; guest time is already in user.
  const cpuTotal = f.slice(0, 8).reduce((a, b) => a + b, 0);
  const cpuIdle = f[3] + (f[4] ?? 0);
  const pid = num(out.match(/^pid=(\d+)\s*$/m));
  const stat = out.match(/^stat=(\d+) (\d+)\s*$/m);
  return {
    cpuTotal,
    cpuIdle,
    memTotalKb: num(out.match(/^MemTotal:\s+(\d+) kB/m)),
    memAvailableKb: num(out.match(/^MemAvailable:\s+(\d+) kB/m)),
    pid,
    appJiffies: pid !== null && stat ? Number(stat[1]) + Number(stat[2]) : null,
    appRssKb: pid !== null ? num(out.match(/^VmRSS:\s+(\d+) kB/m)) : null,
  };
}

const pct = (share: number): number => round1(clamp(share * 100, 0, 100));
const mb = (kb: number): number => round1(kb / 1024);

/**
 * A sample from this reading and the one before it. CPU needs both: the
 * first sample has none, and the app's needs the same process in both, so a
 * restarted app shows no CPU for one sample rather than a spike.
 */
export function androidSample(
  prev: AndroidReading | null,
  cur: AndroidReading,
  appId: string | null,
  at: number,
): MetricSample {
  let deviceCpuPct: number | null = null;
  let appCpuPct: number | null = null;
  const dTotal = prev ? cur.cpuTotal - prev.cpuTotal : 0;
  if (prev && dTotal > 0) {
    deviceCpuPct = pct(1 - (cur.cpuIdle - prev.cpuIdle) / dTotal);
    if (
      cur.pid !== null &&
      cur.pid === prev.pid &&
      cur.appJiffies !== null &&
      prev.appJiffies !== null
    ) {
      appCpuPct = pct((cur.appJiffies - prev.appJiffies) / dTotal);
    }
  }
  const hasApp = cur.pid !== null;
  return {
    at,
    deviceCpuPct,
    deviceMemMb:
      cur.memTotalKb !== null && cur.memAvailableKb !== null
        ? mb(cur.memTotalKb - cur.memAvailableKb)
        : null,
    deviceMemTotalMb: cur.memTotalKb !== null ? mb(cur.memTotalKb) : null,
    appCpuPct,
    appMemMb: hasApp && cur.appRssKb !== null ? mb(cur.appRssKb) : null,
    appId: hasApp ? appId : null,
  };
}

/** The foreground app from `dumpsys activity activities`, before and after Android 10. */
export function parseForegroundPackage(dumpsys: string): string | null {
  const m = dumpsys.match(
    /(?:topResumedActivity|mResumedActivity)[:=]\s*ActivityRecord\{\S+ u\d+ ([^\s/]+)\//,
  );
  return m && isSafePackage(m[1]) ? m[1] : null;
}
```

- [ ] **Step 5: Write `iosMetrics.ts`**

```ts
import { clamp, round1 } from './types';

/**
 * Device CPU % from one line of `ios sysmontap`, or null for any other line.
 * go-ios logs JSON lines; a reading is {"msg":"received CPU usage data",
 * "enabled_cpus":6,"cpu_total_load":77.5,...}. The load is summed over the
 * cores (an idle 6-core iPhone 14 Plus read 77 to 125), so it is divided by
 * them.
 */
export function parseSysmontapCpu(line: string): number | null {
  let o: any;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (!o || typeof o.cpu_total_load !== 'number' || !Number.isFinite(o.cpu_total_load)) {
    return null;
  }
  const cores = [o.enabled_cpus, o.cpu_count].find((n) => typeof n === 'number' && n > 0) ?? 1;
  return round1(clamp(o.cpu_total_load / cores, 0, 100));
}
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx mocha test/unit/session-metrics-parse.spec.ts`
Expected: 15 passing.

Check: `npx prettier --check src/services/metrics/*.ts test/unit/session-metrics-parse.spec.ts`. These are new files: if it reports issues, run `npx prettier --write` on exactly these files.

- [ ] **Step 7: Commit**

```bash
git add src/services/metrics/types.ts src/services/metrics/androidMetrics.ts src/services/metrics/iosMetrics.ts test/unit/session-metrics-parse.spec.ts
git commit -m "feat(metrics): parse Android /proc and iPhone sysmontap readings"
```

---

### Task 3: The two samplers

**Files:**
- Create: `src/services/metrics/AndroidMetricsSampler.ts`, `src/services/metrics/IOSMetricsSampler.ts`
- Test: `test/unit/session-metrics-samplers.spec.ts`

**Interfaces:**
- Consumes: everything from Task 2.
- Produces:
  - `new AndroidMetricsSampler({ shell: (command: string) => Promise<string>; appPackage: unknown; hooks: SamplerHooks; now?: () => number })`.
  - `new IOSMetricsSampler({ udid: string; tunnels: { borrow(udid: string): Promise<number | null>; envFor(udid: string): NodeJS.ProcessEnv }; spawnSysmontap: (env: NodeJS.ProcessEnv) => ChildProcess; hooks: SamplerHooks })`.
  - Both implement `MetricsSampler`.

- [ ] **Step 1: Write the failing tests**

Create `test/unit/session-metrics-samplers.spec.ts`:

```ts
import { expect } from 'chai';
import { EventEmitter } from 'events';
import sinon from 'sinon';
import { AndroidMetricsSampler } from '../../src/services/metrics/AndroidMetricsSampler';
import { IOSMetricsSampler } from '../../src/services/metrics/IOSMetricsSampler';
import {
  FOREGROUND_REFRESH_MS,
  MAX_CONSECUTIVE_FAILURES,
  MetricSample,
  SAMPLE_INTERVAL_MS,
  TUNNEL_RENEW_MS,
} from '../../src/services/metrics/types';

const reading = (jiffies: number, idle: number, app: number) =>
  [
    `cpu  ${jiffies - idle} 0 0 ${idle} 0 0 0 0 0 0`,
    'MemTotal:        5755748 kB',
    'MemAvailable:    2839168 kB',
    'pid=1404',
    `stat=${app} 0`,
    'VmRSS:\t  334480 kB',
  ].join('\n');

describe('session metrics: AndroidMetricsSampler', () => {
  let clock: sinon.SinonFakeTimers;
  let samples: MetricSample[];
  let gaveUp: string[];
  const hooks = () => ({
    onSample: (s: MetricSample) => samples.push(s),
    onGiveUp: (r: string) => gaveUp.push(r),
  });

  beforeEach(() => {
    clock = sinon.useFakeTimers({ now: 1_000_000 });
    samples = [];
    gaveUp = [];
  });
  afterEach(() => clock.restore());

  it("samples the session's app every 2 s, with CPU from the second sample", async () => {
    const commands: string[] = [];
    let n = 0;
    const s = new AndroidMetricsSampler({
      appPackage: 'com.acme.shop',
      hooks: hooks(),
      shell: async (c) => {
        commands.push(c);
        n += 1;
        return reading(1000 * n, 800 * n, 50 * n);
      },
    });
    s.start();
    await clock.tickAsync(0);
    await clock.tickAsync(SAMPLE_INTERVAL_MS);
    await s.stop();

    expect(commands).to.have.length(2);
    expect(commands.every((c) => c.includes('pidof com.acme.shop'))).to.equal(true);
    expect(samples.map((x) => x.deviceCpuPct)).to.deep.equal([null, 20]);
    expect(samples.map((x) => x.appCpuPct)).to.deep.equal([null, 5]);
    expect(samples[1].appId).to.equal('com.acme.shop');
  });

  it('with no appPackage, samples the foreground app, looked up once per 10 s', async () => {
    const commands: string[] = [];
    const s = new AndroidMetricsSampler({
      appPackage: undefined,
      hooks: hooks(),
      shell: async (c) => {
        commands.push(c);
        return c.startsWith('dumpsys')
          ? '  topResumedActivity=ActivityRecord{a1 u0 com.acme.shop/.Main t3}'
          : reading(1000, 800, 50);
      },
    });
    s.start();
    await clock.tickAsync(0);
    await clock.tickAsync(SAMPLE_INTERVAL_MS);
    await clock.tickAsync(FOREGROUND_REFRESH_MS);
    await s.stop();

    const lookups = commands.filter((c) => c.startsWith('dumpsys'));
    expect(lookups).to.have.length(2);
    expect(commands.filter((c) => c.includes('pidof com.acme.shop')).length).to.be.greaterThan(2);
  });

  it("never puts an appPackage that isn't a package name into a command", async () => {
    const commands: string[] = [];
    const s = new AndroidMetricsSampler({
      appPackage: 'com.acme;reboot',
      hooks: hooks(),
      shell: async (c) => {
        commands.push(c);
        return c.startsWith('dumpsys') ? '' : reading(1000, 800, 50);
      },
    });
    s.start();
    await clock.tickAsync(0);
    await s.stop();

    expect(commands.some((c) => c.includes('reboot'))).to.equal(false);
    expect(samples[0].appId).to.equal(null);
  });

  it('stops itself after 5 failures in a row, and says so once', async () => {
    let calls = 0;
    const s = new AndroidMetricsSampler({
      appPackage: 'com.acme.shop',
      hooks: hooks(),
      shell: async () => {
        calls += 1;
        throw new Error('device offline');
      },
    });
    s.start();
    await clock.tickAsync(0);
    await clock.tickAsync(SAMPLE_INTERVAL_MS * (MAX_CONSECUTIVE_FAILURES + 3));

    expect(calls).to.equal(MAX_CONSECUTIVE_FAILURES);
    expect(gaveUp).to.deep.equal(['device offline']);
  });

  it('starts counting failures again after a good sample', async () => {
    let n = 0;
    const s = new AndroidMetricsSampler({
      appPackage: 'com.acme.shop',
      hooks: hooks(),
      shell: async () => {
        n += 1;
        if (n % 4 === 0) return reading(1000 * n, 800 * n, 50 * n);
        throw new Error('flaky');
      },
    });
    s.start();
    await clock.tickAsync(0);
    await clock.tickAsync(SAMPLE_INTERVAL_MS * 12);
    await s.stop();

    expect(gaveUp).to.deep.equal([]);
    expect(samples.length).to.equal(3);
  });

  it('reports nothing that was in flight when it stopped', async () => {
    let release: (out: string) => void = () => undefined;
    const s = new AndroidMetricsSampler({
      appPackage: 'com.acme.shop',
      hooks: hooks(),
      shell: () => new Promise<string>((r) => (release = r)),
    });
    s.start();
    await clock.tickAsync(0);
    await s.stop();
    release(reading(1000, 800, 50));
    await clock.tickAsync(SAMPLE_INTERVAL_MS * 3);

    expect(samples).to.deep.equal([]);
  });
});

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 4321;
  killed: string[] = [];
  kill(sig: string) {
    this.killed.push(sig);
    return true;
  }
}

describe('session metrics: IOSMetricsSampler', () => {
  let clock: sinon.SinonFakeTimers;
  let samples: MetricSample[];
  let gaveUp: string[];
  let children: FakeChild[];
  let envs: NodeJS.ProcessEnv[];
  let borrows: number;
  const line = (load: number) =>
    JSON.stringify({ msg: 'received CPU usage data', enabled_cpus: 6, cpu_total_load: load }) + '\n';

  function sampler() {
    return new IOSMetricsSampler({
      udid: 'iphone-1',
      tunnels: {
        borrow: async () => {
          borrows += 1;
          return 12100;
        },
        envFor: () => ({ GO_IOS_AGENT_PORT: '12100' }),
      },
      spawnSysmontap: (env) => {
        envs.push(env);
        const c = new FakeChild();
        children.push(c);
        return c as any;
      },
      hooks: { onSample: (s) => samples.push(s), onGiveUp: (r) => gaveUp.push(r) },
    });
  }

  beforeEach(() => {
    clock = sinon.useFakeTimers({ now: 1_000_000 });
    samples = [];
    gaveUp = [];
    children = [];
    envs = [];
    borrows = 0;
  });
  afterEach(() => clock.restore());

  it("runs sysmontap through the phone's tunnel and reports device CPU every 2 s", async () => {
    const s = sampler();
    s.start();
    await clock.tickAsync(0);
    expect(envs).to.deep.equal([{ GO_IOS_AGENT_PORT: '12100' }]);
    children[0].stderr.emit('data', line(60) + line(120));
    await clock.tickAsync(SAMPLE_INTERVAL_MS);
    await s.stop();

    expect(samples).to.have.length(1);
    expect(samples[0]).to.include({
      deviceCpuPct: 20,
      deviceMemMb: null,
      appCpuPct: null,
      appMemMb: null,
      appId: null,
    });
    expect(children[0].killed).to.deep.equal(['SIGTERM']);
  });

  it('reports nothing when no reading came for 4 s', async () => {
    const s = sampler();
    s.start();
    await clock.tickAsync(0);
    children[0].stdout.emit('data', line(60));
    await clock.tickAsync(SAMPLE_INTERVAL_MS * 4);
    await s.stop();

    expect(samples.length).to.be.lessThan(3);
  });

  it('asks for the tunnel again every 30 s', async () => {
    const s = sampler();
    s.start();
    await clock.tickAsync(0);
    await clock.tickAsync(TUNNEL_RENEW_MS * 2);
    await s.stop();

    expect(borrows).to.equal(3);
  });

  it('starts sysmontap again when it exits, and gives up after 5 exits with no reading', async () => {
    const s = sampler();
    s.start();
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i += 1) {
      await clock.tickAsync(0);
      children[children.length - 1].emit('exit', 1);
      await clock.tickAsync(30_000);
    }

    expect(children).to.have.length(MAX_CONSECUTIVE_FAILURES);
    expect(gaveUp).to.deep.equal(['ios sysmontap kept exiting']);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx mocha test/unit/session-metrics-samplers.spec.ts`
Expected: FAIL, `Cannot find module '../../src/services/metrics/AndroidMetricsSampler'`.

- [ ] **Step 3: Write `AndroidMetricsSampler.ts`**

```ts
import {
  AndroidReading,
  androidSample,
  androidSampleCommand,
  isSafePackage,
  parseAndroidReading,
  parseForegroundPackage,
} from './androidMetrics';
import {
  FOREGROUND_REFRESH_MS,
  MAX_CONSECUTIVE_FAILURES,
  MetricsSampler,
  SAMPLE_INTERVAL_MS,
  SamplerHooks,
} from './types';

export interface AndroidSamplerOptions {
  /** Runs a command in the phone's shell (the resolved adb) and returns its output. */
  shell: (command: string) => Promise<string>;
  /** The session's appPackage capability; anything but a package name is ignored. */
  appPackage: unknown;
  hooks: SamplerHooks;
  now?: () => number;
}

/**
 * Samples an Android phone every SAMPLE_INTERVAL_MS with one `adb shell`
 * call. The app is the session's package, else the app in the foreground.
 * Samples never overlap: the next is scheduled when one finishes.
 */
export class AndroidMetricsSampler implements MetricsSampler {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private prev: AndroidReading | null = null;
  private failures = 0;
  private foreground: { pkg: string | null; at: number } | null = null;
  private readonly pkg: string | null;

  constructor(private readonly opts: AndroidSamplerOptions) {
    this.pkg = isSafePackage(opts.appPackage) ? opts.appPackage : null;
  }

  start(): void {
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.sample().finally(() => this.schedule(SAMPLE_INTERVAL_MS));
    }, delay);
    this.timer.unref?.();
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private async sample(): Promise<void> {
    try {
      const appId = await this.appId();
      const reading = parseAndroidReading(await this.opts.shell(androidSampleCommand(appId)));
      if (!reading) throw new Error('unreadable /proc output');
      const sample = androidSample(this.prev, reading, appId, this.now());
      this.prev = reading;
      this.failures = 0;
      if (!this.stopped) this.opts.hooks.onSample(sample);
    } catch (err: any) {
      this.failures += 1;
      if (this.failures >= MAX_CONSECUTIVE_FAILURES && !this.stopped) {
        this.stopped = true;
        this.opts.hooks.onGiveUp(err?.message ?? String(err));
      }
    }
  }

  private async appId(): Promise<string | null> {
    if (this.pkg) return this.pkg;
    const now = this.now();
    if (this.foreground && now - this.foreground.at < FOREGROUND_REFRESH_MS) {
      return this.foreground.pkg;
    }
    let pkg: string | null = null;
    try {
      pkg = parseForegroundPackage(await this.opts.shell('dumpsys activity activities'));
    } catch {
      // Device figures still count; the app waits for the next lookup.
    }
    this.foreground = { pkg, at: now };
    return pkg;
  }
}
```

- [ ] **Step 4: Write `IOSMetricsSampler.ts`**

```ts
import type { ChildProcess } from 'child_process';
import { parseSysmontapCpu } from './iosMetrics';
import {
  MAX_CONSECUTIVE_FAILURES,
  MetricsSampler,
  SAMPLE_INTERVAL_MS,
  SamplerHooks,
  TUNNEL_RENEW_MS,
} from './types';

export interface IOSSamplerOptions {
  udid: string;
  tunnels: {
    borrow(udid: string): Promise<number | null>;
    envFor(udid: string): NodeJS.ProcessEnv;
  };
  /** Starts `ios sysmontap --udid <udid>` with this environment. */
  spawnSysmontap: (env: NodeJS.ProcessEnv) => ChildProcess;
  hooks: SamplerHooks;
}

/** A reading older than this is not reported again. */
const STALE_MS = 2 * SAMPLE_INTERVAL_MS;

/**
 * Device CPU of an iPhone, from a long-running `ios sysmontap` through the
 * phone's tunnel (borrowed, and asked for again so it outlives the 2-minute
 * idle stop). Reports the latest reading every SAMPLE_INTERVAL_MS.
 */
export class IOSMetricsSampler implements MetricsSampler {
  private stopped = false;
  private proc?: ChildProcess;
  private latest?: { cpu: number; at: number };
  private failures = 0;
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private relaunch?: ReturnType<typeof setTimeout>;

  constructor(private readonly opts: IOSSamplerOptions) {}

  start(): void {
    void this.launch();
    this.every(SAMPLE_INTERVAL_MS, () => this.report());
    this.every(TUNNEL_RENEW_MS, () => {
      void this.opts.tunnels.borrow(this.opts.udid).catch(() => null);
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.timers.forEach((t) => clearInterval(t));
    if (this.relaunch) clearTimeout(this.relaunch);
    this.proc?.kill('SIGTERM');
    this.proc = undefined;
  }

  private every(ms: number, fn: () => void): void {
    const t = setInterval(fn, ms);
    t.unref?.();
    this.timers.push(t);
  }

  private async launch(): Promise<void> {
    if (this.stopped) return;
    // Below iOS 17 there is no tunnel (null), and sysmontap needs none.
    await this.opts.tunnels.borrow(this.opts.udid).catch(() => null);
    if (this.stopped) return;
    const proc = this.opts.spawnSysmontap(this.opts.tunnels.envFor(this.opts.udid));
    this.proc = proc;
    let rest = '';
    const read = (chunk: Buffer | string) => {
      const lines = (rest + chunk.toString()).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) {
        const cpu = parseSysmontapCpu(line);
        if (cpu !== null) {
          this.latest = { cpu, at: Date.now() };
          this.failures = 0;
        }
      }
    };
    proc.stdout?.on('data', read);
    proc.stderr?.on('data', read);
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      this.exited(proc);
    };
    proc.once('exit', end);
    proc.once('error', end);
  }

  private exited(proc: ChildProcess): void {
    if (this.proc === proc) this.proc = undefined;
    if (this.stopped) return;
    this.failures += 1;
    if (this.failures >= MAX_CONSECUTIVE_FAILURES) {
      void this.stop();
      this.opts.hooks.onGiveUp('ios sysmontap kept exiting');
      return;
    }
    const delay = Math.min(30_000, SAMPLE_INTERVAL_MS * 2 ** (this.failures - 1));
    this.relaunch = setTimeout(() => void this.launch(), delay);
    this.relaunch.unref?.();
  }

  private report(): void {
    if (this.stopped || !this.latest || Date.now() - this.latest.at > STALE_MS) return;
    this.opts.hooks.onSample({
      at: Date.now(),
      deviceCpuPct: this.latest.cpu,
      deviceMemMb: null,
      deviceMemTotalMb: null,
      appCpuPct: null,
      appMemMb: null,
      appId: null,
    });
  }
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx mocha test/unit/session-metrics-samplers.spec.ts`
Expected: 10 passing.

Check: `npx prettier --check` on the three new files, and `--write` them if needed (they are new).

- [ ] **Step 6: Commit**

```bash
git add src/services/metrics/AndroidMetricsSampler.ts src/services/metrics/IOSMetricsSampler.ts test/unit/session-metrics-samplers.spec.ts
git commit -m "feat(metrics): Android and iPhone samplers"
```

---

### Task 4: `SessionMetricsService`, wired into `EventManager`

**Files:**
- Create: `src/services/metrics/SessionMetricsService.ts`
- Modify: `src/dashboard/event-manager.ts`
- Delete: `src/profiling/AndroidAppProfiler.ts` (and the now empty `src/profiling/`)
- Test: `test/unit/session-metrics-service.spec.ts`, `test/unit/dashboard-events-metrics.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–3 (`prisma.sessionMetric.createMany`, both samplers, `appPackageOf`, the constants).
- Produces: `SessionMetricsService` (TypeDI) with:
  - `appliesTo(device: IDevice | undefined): boolean`
  - `start(input: { sessionId: string; device: IDevice; capabilities: Record<string, any> }): void`
  - `stop(sessionId: string): Promise<void>`
  - protected seams: `context(): PluginContext`, `writeSamples(sessionId: string, samples: MetricSample[]): Promise<void>`, `samplerFor(sessionId, device, capabilities, hooks): MetricsSampler`

- [ ] **Step 1: Write the failing service tests**

Create `test/unit/session-metrics-service.spec.ts`:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import {
  FLUSH_INTERVAL_MS,
  MAX_BUFFERED_SAMPLES,
  MetricSample,
  MetricsSampler,
  SamplerHooks,
} from '../../src/services/metrics/types';

class FakeSampler implements MetricsSampler {
  started = false;
  stopped = false;
  constructor(public hooks: SamplerHooks) {}
  start() {
    this.started = true;
  }
  async stop() {
    this.stopped = true;
  }
}

class TestMetrics extends SessionMetricsService {
  args: Record<string, unknown> = {};
  written: Array<{ sessionId: string; ats: number[] }> = [];
  failWrites = 0;
  samplers: FakeSampler[] = [];
  caps: unknown[] = [];
  protected context(): any {
    return { pluginArgs: { bindHostOrIp: '127.0.0.1', ...this.args }, port: 4723, nodeId: 'node-1' };
  }
  protected async writeSamples(sessionId: string, samples: MetricSample[]): Promise<void> {
    if (this.failWrites > 0) {
      this.failWrites -= 1;
      throw new Error('FOREIGN KEY constraint failed');
    }
    this.written.push({ sessionId, ats: samples.map((s) => s.at) });
  }
  protected samplerFor(_id: string, _d: any, caps: Record<string, any>, hooks: SamplerHooks) {
    this.caps.push(caps);
    const f = new FakeSampler(hooks);
    this.samplers.push(f);
    return f;
  }
}

const phone = (over: Record<string, unknown> = {}): any => ({
  udid: 'phone-1',
  platform: 'android',
  realDevice: true,
  host: 'http://127.0.0.1:4723',
  nodeId: 'node-1',
  ...over,
});
const sample = (at: number): MetricSample => ({
  at,
  deviceCpuPct: 10,
  deviceMemMb: 1,
  deviceMemTotalMb: 2,
  appCpuPct: null,
  appMemMb: null,
  appId: null,
});

describe('SessionMetricsService', () => {
  let clock: sinon.SinonFakeTimers;
  let m: TestMetrics;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ now: 1_000_000 });
    m = new TestMetrics();
  });
  afterEach(() => clock.restore());

  it("samples this server's Android phones (emulators too) and iPhones, not simulators", () => {
    expect(m.appliesTo(phone())).to.equal(true);
    expect(m.appliesTo(phone({ realDevice: false }))).to.equal(true);
    expect(m.appliesTo(phone({ platform: 'ios' }))).to.equal(true);
    expect(m.appliesTo(phone({ platform: 'ios', realDevice: false }))).to.equal(false);
    expect(m.appliesTo(undefined)).to.equal(false);
  });

  it("doesn't sample another server's phone, or anything when sessionMetrics is off", () => {
    expect(m.appliesTo(phone({ nodeId: 'node-2' }))).to.equal(false);
    m.args = { sessionMetrics: false };
    expect(m.appliesTo(phone())).to.equal(false);
  });

  it('writes the samples every 10 s, and the rest when the session stops', async () => {
    m.start({ sessionId: 's1', device: phone(), capabilities: { 'appium:appPackage': 'com.a.b' } });
    const hooks = m.samplers[0].hooks;
    expect(m.samplers[0].started).to.equal(true);
    expect(m.caps).to.deep.equal([{ 'appium:appPackage': 'com.a.b' }]);
    [1, 2, 3].forEach((t) => hooks.onSample(sample(t)));
    await clock.tickAsync(FLUSH_INTERVAL_MS);
    [4, 5].forEach((t) => hooks.onSample(sample(t)));
    await m.stop('s1');

    expect(m.written).to.deep.equal([
      { sessionId: 's1', ats: [1, 2, 3] },
      { sessionId: 's1', ats: [4, 5] },
    ]);
    expect(m.samplers[0].stopped).to.equal(true);
  });

  it('keeps samples whose write failed, in order, for the next write', async () => {
    m.start({ sessionId: 's1', device: phone(), capabilities: {} });
    const hooks = m.samplers[0].hooks;
    m.failWrites = 1;
    [1, 2].forEach((t) => hooks.onSample(sample(t)));
    await clock.tickAsync(FLUSH_INTERVAL_MS);
    hooks.onSample(sample(3));
    await clock.tickAsync(FLUSH_INTERVAL_MS);
    await m.stop('s1');

    expect(m.written).to.deep.equal([{ sessionId: 's1', ats: [1, 2, 3] }]);
  });

  it('keeps only the newest samples while writes keep failing', async () => {
    m.start({ sessionId: 's1', device: phone(), capabilities: {} });
    const hooks = m.samplers[0].hooks;
    m.failWrites = 1;
    for (let t = 1; t <= MAX_BUFFERED_SAMPLES + 5; t += 1) hooks.onSample(sample(t));
    await clock.tickAsync(FLUSH_INTERVAL_MS);
    await m.stop('s1');

    const ats = m.written[0].ats;
    expect(ats).to.have.length(MAX_BUFFERED_SAMPLES);
    expect(ats[0]).to.equal(6);
    expect(ats[ats.length - 1]).to.equal(MAX_BUFFERED_SAMPLES + 5);
  });

  it('drops a sample that arrives after the session stopped', async () => {
    m.start({ sessionId: 's1', device: phone(), capabilities: {} });
    const hooks = m.samplers[0].hooks;
    await m.stop('s1');
    hooks.onSample(sample(9));
    await clock.tickAsync(FLUSH_INTERVAL_MS * 2);

    expect(m.written).to.deep.equal([]);
  });

  it('stops twice, or a session it never sampled, without complaint', async () => {
    m.start({ sessionId: 's1', device: phone(), capabilities: {} });
    await m.stop('s1');
    await m.stop('s1');
    await m.stop('never-started');
    expect(m.samplers).to.have.length(1);
  });

  it("doesn't start a sampler for a phone it doesn't apply to", () => {
    m.start({ sessionId: 's2', device: phone({ nodeId: 'node-2' }), capabilities: {} });
    expect(m.samplers).to.deep.equal([]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx mocha test/unit/session-metrics-service.spec.ts`
Expected: FAIL, `Cannot find module '../../src/services/metrics/SessionMetricsService'`.

- [ ] **Step 3: Write `SessionMetricsService.ts`**

```ts
import { spawn } from 'child_process';
import { Container, Service } from 'typedi';
import log from '../../logger';
import { prisma } from '../../prisma';
import type { IDevice } from '../../interfaces/IDevice';
import { PluginContext } from '../../PluginContext';
import { isOwnDevice, localDeviceHosts } from '../../device-managers/localDeviceHosts';
import { XenonManager } from '../../device-managers';
import AndroidDeviceManager from '../../device-managers/AndroidDeviceManager';
import { IOSTunnels } from '../../device-managers/ios/IOSTunnels';
import { goIosBinaryPath } from '../../device-managers/ios/goIosBinary';
import { ProcessRegistry } from '../ProcessRegistry';
import { appPackageOf } from './androidMetrics';
import { AndroidMetricsSampler } from './AndroidMetricsSampler';
import { IOSMetricsSampler } from './IOSMetricsSampler';
import {
  FLUSH_INTERVAL_MS,
  MAX_BUFFERED_SAMPLES,
  MetricSample,
  MetricsSampler,
  SamplerHooks,
} from './types';

export interface MetricsStart {
  sessionId: string;
  device: IDevice;
  capabilities: Record<string, any>;
}

interface Running {
  sampler: MetricsSampler;
  buffer: MetricSample[];
  flushTimer: ReturnType<typeof setInterval>;
  /** Writes run one after another. */
  writing: Promise<void>;
}

/**
 * CPU and memory for the session page's Performance panel. A sampler per
 * session on this server's own phones, from EventManager's start (once the
 * session's row exists) to its stop; samples are written every
 * FLUSH_INTERVAL_MS. Sampling never fails a session.
 */
@Service()
export class SessionMetricsService {
  private log = log.scope('SessionMetrics');
  private running = new Map<string, Running>();

  /** Whether a session on this phone is sampled. */
  appliesTo(device: IDevice | undefined): boolean {
    if (!device) return false;
    const ctx = this.context();
    if (ctx.pluginArgs?.sessionMetrics === false) return false;
    const platform = String(device.platform ?? '').toLowerCase();
    // An emulator's /proc reads like a phone's; a simulator has no sysmontap.
    if (platform !== 'android' && !(platform === 'ios' && device.realDevice === true)) {
      return false;
    }
    return isOwnDevice(localDeviceHosts(ctx.pluginArgs, ctx.port), ctx.nodeId, device);
  }

  start({ sessionId, device, capabilities }: MetricsStart): void {
    if (this.running.has(sessionId) || !this.appliesTo(device)) return;
    const hooks: SamplerHooks = {
      onSample: (s) => this.running.get(sessionId)?.buffer.push(s),
      onGiveUp: (reason) =>
        this.log.warn(`[${sessionId}] Stopped sampling ${device.udid}: ${reason}`),
    };
    let sampler: MetricsSampler;
    try {
      sampler = this.samplerFor(sessionId, device, capabilities, hooks);
    } catch (err: any) {
      this.log.warn(`[${sessionId}] Can't sample ${device.udid}: ${err?.message ?? err}`);
      return;
    }
    const flushTimer = setInterval(() => void this.flush(sessionId), FLUSH_INTERVAL_MS);
    flushTimer.unref?.();
    this.running.set(sessionId, { sampler, buffer: [], flushTimer, writing: Promise.resolve() });
    sampler.start();
    this.log.info(`[${sessionId}] Sampling CPU and memory on ${device.udid}`);
  }

  /** Stops the session's sampler and writes what it buffered. Idempotent. */
  async stop(sessionId: string): Promise<void> {
    const entry = this.running.get(sessionId);
    if (!entry) return;
    this.running.delete(sessionId);
    clearInterval(entry.flushTimer);
    await entry.sampler.stop().catch(() => undefined);
    await this.write(sessionId, entry);
  }

  private async flush(sessionId: string): Promise<void> {
    const entry = this.running.get(sessionId);
    if (entry) await this.write(sessionId, entry);
  }

  /** On failure the samples wait for the next write; the newest MAX_BUFFERED_SAMPLES are kept. */
  private write(sessionId: string, entry: Running): Promise<void> {
    entry.writing = entry.writing.then(async () => {
      const batch = entry.buffer.splice(0);
      if (batch.length === 0) return;
      try {
        await this.writeSamples(sessionId, batch);
      } catch (err: any) {
        entry.buffer.unshift(...batch);
        const over = entry.buffer.length - MAX_BUFFERED_SAMPLES;
        if (over > 0) entry.buffer.splice(0, over);
        this.log.debug(`[${sessionId}] Writing ${batch.length} samples failed: ${err?.message ?? err}`);
      }
    });
    return entry.writing;
  }

  // ---------------------------------------------------------------------
  // Seams. Overridden by tests; the defaults are the real thing.
  // ---------------------------------------------------------------------

  protected context(): PluginContext {
    return Container.get(PluginContext);
  }

  protected async writeSamples(sessionId: string, samples: MetricSample[]): Promise<void> {
    await prisma.sessionMetric.createMany({
      data: samples.map((s) => ({
        session_id: sessionId,
        at: s.at,
        device_cpu_pct: s.deviceCpuPct,
        device_mem_mb: s.deviceMemMb,
        device_mem_total: s.deviceMemTotalMb,
        app_cpu_pct: s.appCpuPct,
        app_mem_mb: s.appMemMb,
        app_id: s.appId,
      })),
    });
  }

  protected samplerFor(
    sessionId: string,
    device: IDevice,
    capabilities: Record<string, any>,
    hooks: SamplerHooks,
  ): MetricsSampler {
    if (String(device.platform).toLowerCase() === 'android') {
      let adb: Promise<{ shell(command: string): Promise<unknown> }> | undefined;
      return new AndroidMetricsSampler({
        appPackage: appPackageOf(capabilities),
        hooks,
        shell: async (command) => {
          if (!adb) adb = this.adbFor(device.udid);
          try {
            return String(await (await adb).shell(command));
          } catch (err) {
            adb = undefined; // looked up again next time
            throw err;
          }
        },
      });
    }
    return new IOSMetricsSampler({
      udid: device.udid,
      tunnels: Container.get(IOSTunnels),
      hooks,
      spawnSysmontap: (env) => {
        const proc = spawn(goIosBinaryPath(), ['sysmontap', '--udid', device.udid], {
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        Container.get(ProcessRegistry).track({
          sessionId,
          udid: device.udid,
          kind: 'other',
          process: proc,
        });
        return proc;
      },
    });
  }

  private async adbFor(udid: string): Promise<{ shell(command: string): Promise<unknown> }> {
    const managers = await Container.get(XenonManager).deviceInstances();
    const android = managers.find((m) => m instanceof AndroidDeviceManager) as
      | AndroidDeviceManager
      | undefined;
    if (!android) throw new Error('no Android device manager');
    return android.getAdbForDevice(udid);
  }
}
```

- [ ] **Step 4: Run the service tests and watch them pass**

Run: `npx mocha test/unit/session-metrics-service.spec.ts`
Expected: 8 passing.

Then: `npx tsc --noEmit -p .` must be clean. If `AndroidDeviceManager` isn't the default export, or `deviceInstances` returns another shape, use the import and call `src/dashboard/event-manager.ts` uses for the same lookup (around line 730).

- [ ] **Step 5: Write the failing `EventManager` wiring tests**

Create `test/unit/dashboard-events-metrics.spec.ts`:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import * as assets from '../../src/dashboard/asset-manager';
import * as sessionService from '../../src/dashboard/services/session-service';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { SocketServer } from '../../src/services/SocketServer';
import { TracingService } from '../../src/services/TracingService';
import { MetricsService } from '../../src/services/MetricsService';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { prisma } from '../../src/prisma';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * EventManager starts a session's sampling once the session's row exists (the
 * samples point at it) and stops it however the session ends, in memory or
 * not.
 */
describe('EventManager: CPU and memory sampling', () => {
  let restore: () => void;
  let metrics: { appliesTo: sinon.SinonStub; start: sinon.SinonStub; stop: sinon.SinonStub };
  let order: string[];

  beforeEach(() => {
    restore = saveRegistrations(SessionMetricsService, SocketServer);
    order = [];
    metrics = {
      appliesTo: sinon.stub().returns(true),
      start: sinon.stub().callsFake(() => order.push('metrics')),
      stop: sinon.stub().resolves(),
    };
    Container.set(SessionMetricsService, metrics as any);
    Container.set(SocketServer, {
      emitToDashboard: sinon.stub(),
      emitToDashboardForDevices: sinon.stub().resolves(),
      hasScopedDashboard: sinon.stub().returns(false),
    } as any);
  });

  afterEach(() => {
    sinon.restore();
    restore();
  });

  function startSession() {
    sinon.stub(assets, 'prepareDirectory');
    sinon.stub(sessionService, 'getOrCreateNewBuild').resolves({ id: 'b-metrics' } as any);
    sinon.stub(TracingService.prototype, 'getTraceId').returns('t-1' as any);
    sinon.stub(MetricsService.prototype, 'incrementSessionStart');
    const create = sinon.stub(prisma.session, 'create').callsFake(async () => {
      order.push('row');
      return {} as any;
    });
    const session = {
      getId: () => 's-metrics-1',
      getCapabilities: () => ({ platformName: 'Android' }),
      getLiveVideoUrl: () => null,
      startPerformanceRecording: sinon.stub().resolves(),
      apiKeyId: null,
      userId: null,
    };
    const device = { udid: 'phone-m', platform: 'android', realDevice: true, host: 'h', name: 'S9', sdk: '10' };
    return { create, session, device };
  }

  it("starts sampling once the session's row is written, and says so on the row", async () => {
    const { create, session, device } = startSession();

    await DASHBORD_EVENT_MANAGER.onSessionStarted({}, session as any, device as any);

    expect(order).to.deep.equal(['row', 'metrics']);
    expect(metrics.start.firstCall.args[0]).to.deep.equal({
      sessionId: 's-metrics-1',
      device,
      capabilities: { platformName: 'Android' },
    });
    expect(create.firstCall.args[0].data.is_profiling_available).to.equal(true);
  });

  it("doesn't sample a phone the service doesn't apply to", async () => {
    metrics.appliesTo.returns(false);
    const { session, device } = startSession();

    await DASHBORD_EVENT_MANAGER.onSessionStarted({}, session as any, device as any);

    expect(metrics.start.called).to.equal(false);
  });

  it('stops sampling when the session stops, even one no longer in memory', async () => {
    sinon.stub(SESSION_MANAGER, 'getSession').returns(undefined as any);
    sinon.stub(DeviceStoreFactory, 'getStore').returns({ getDevices: async () => [] } as any);
    sinon
      .stub(prisma.session, 'findFirst')
      .resolves({ id: 's-metrics-2', status: 'running', device_udid: 'phone-m' } as any);
    sinon.stub(prisma.session, 'update').resolves({} as any);
    sinon.stub(prisma.sessionLog, 'findFirst').resolves(null);

    await DASHBORD_EVENT_MANAGER.onSessionStopped('s-metrics-2');

    expect(metrics.stop.calledOnceWithExactly('s-metrics-2')).to.equal(true);
  });
});
```

- [ ] **Step 6: Run them and watch them fail**

Run: `npx mocha test/unit/dashboard-events-metrics.spec.ts`
Expected:
- The first and third tests FAIL: `metrics.start` is never called (the order is `['row']`), and `metrics.stop` is never called.
- The second passes, since nothing calls `start` yet.

- [ ] **Step 7: Wire the service into `EventManager` and remove the old profiler**

In `src/dashboard/event-manager.ts`:

1. Remove these imports:

   ```ts
   import { AndroidAppProfiler } from '../profiling/AndroidAppProfiler';
   import { ADB } from 'appium-adb';
   ```

   Add:

   ```ts
   import { SessionMetricsService } from '../services/metrics/SessionMetricsService';
   ```

2. Remove the field and its comment:

   ```ts
     // Store app profilers for Android sessions
     private appProfilers: Map<string, AndroidAppProfiler> = new Map();
   ```

3. In `onSessionStarted`, replace:

   ```ts
       // Initialize app profiling for Android sessions
       const { is_profiling_available, device_info } = await this.startAppProfiling(
         session.getId(),
         device,
         session.getCapabilities(),
       );
   ```

   with:

   ```ts
       // CPU and memory for the session page's Performance panel; sampling
       // starts once the session's row exists, since the samples point at it.
       const metrics = Container.get(SessionMetricsService);
       const sampled = metrics.appliesTo(device);
   ```

4. In `createData`, replace:

   ```ts
         is_profiling_available: is_profiling_available || isIosProfilingStarted,
         device_info: device_info ? JSON.stringify(device_info) : null,
   ```

   with:

   ```ts
         is_profiling_available: sampled || isIosProfilingStarted,
   ```

5. Right after:

   ```ts
       await prisma.session.create({
         data: createData,
       });
   ```

   add:

   ```ts
       if (sampled) {
         metrics.start({
           sessionId: session.getId(),
           device,
           capabilities: session.getCapabilities(),
         });
       }
   ```

6. In `onSessionStopped`, inside `try {`, right after `log.info(\`🟢 onSessionStopped called for session ${sessionId}\`);`, add:

   ```ts
         // However the session ended, in memory or not, its sampler stops here.
         await Container.get(SessionMetricsService).stop(sessionId);
   ```

   Then remove:

   ```ts
           // Save Android profiling data before cleanup
           await this.saveAppProfilingData(sessionId);
   ```

7. Delete the methods `startAppProfiling` and `saveAppProfilingData` entirely.

Then:

```bash
git rm src/profiling/AndroidAppProfiler.ts
grep -rn "AndroidAppProfiler\|startAppProfiling\|saveAppProfilingData\|appProfilers" src test || echo "old profiler gone"
npx tsc --noEmit -p . && echo "types ok"
```

Expected: "old profiler gone" and "types ok". If `tsc` reports `XenonManager` or `AndroidDeviceManager` unused in `event-manager.ts`, they aren't: log collection uses them near line 730. Remove only what `tsc` and ESLint report unused.

- [ ] **Step 8: Run both specs and watch them pass**

Run: `npx mocha test/unit/session-metrics-service.spec.ts test/unit/dashboard-events-metrics.spec.ts test/unit/dashboard-events-team-scope.spec.ts`
Expected: all passing (8 + 3, plus the existing team-scope spec).

Check: `npx prettier --check` on the three new files. Then compare ESLint counts for `src/dashboard/event-manager.ts` against `origin/main`:

```bash
f=src/dashboard/event-manager.ts; echo "main=$(git show origin/main:$f | npx eslint --stdin --stdin-filename $f -f unix 2>/dev/null | grep -c ':[0-9]*:[0-9]*:') branch=$(npx eslint $f -f unix 2>/dev/null | grep -c ':[0-9]*:[0-9]*:')"
```

Expected: branch ≤ main.

- [ ] **Step 9: Commit**

```bash
git add src/services/metrics/SessionMetricsService.ts src/dashboard/event-manager.ts test/unit/session-metrics-service.spec.ts test/unit/dashboard-events-metrics.spec.ts
git commit -m "feat(metrics): sample every session on this server's phones; drop AndroidAppProfiler"
```

(`git rm` already staged the deleted profiler.)

---

### Task 5: The metrics API

**Files:**
- Create: `src/services/metrics/metricsBody.ts`
- Modify: `src/app/routers/dashboard.ts` (handler, plus `register` after the `/profiling` route), `web/src/api-service/index.ts` (after `getProfilingData`)
- Modify: `test/integration/team-visibility-sessions.spec.ts` (the route list)
- Test: `test/unit/session-metrics-route.spec.ts`

**Interfaces:**
- Consumes: `prisma.sessionMetric` (Task 1), `SAMPLE_INTERVAL_MS` (Task 2).
- Produces: `GET /xenon/api/session/:sessionId/metrics` answering `SessionMetricsBody`:

  ```ts
  {
    platform: string;
    intervalMs: number;
    appId: string | null;
    series: { deviceCpu: boolean; deviceMem: boolean; appCpu: boolean; appMem: boolean };
    samples: Array<{
      t: number;
      deviceCpu: number | null;
      deviceMemMb: number | null;
      deviceMemTotalMb: number | null;
      appCpu: number | null;
      appMemMb: number | null;
    }>;
  }
  ```

- Produces (web): `XenonApiService.getSessionMetrics(sessionId: string): Promise<unknown>`.

- [ ] **Step 1: Write the failing tests**

Create `test/unit/session-metrics-route.spec.ts`:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import DashboardRouter from '../../src/app/routers/dashboard';
import { seriesFor, sessionMetricsBody } from '../../src/services/metrics/metricsBody';
import { useScratchDatabase } from '../helpers/scratch-database';

const row = (at: number, over: Record<string, unknown> = {}) => ({
  at,
  device_cpu_pct: 20,
  device_mem_mb: 2800,
  device_mem_total: 5620.8,
  app_cpu_pct: 5,
  app_mem_mb: 300,
  app_id: 'com.acme.shop',
  ...over,
});

describe('session metrics: the response', () => {
  it('says what each platform can record', () => {
    expect(seriesFor('Android')).to.deep.equal({ deviceCpu: true, deviceMem: true, appCpu: true, appMem: true });
    expect(seriesFor('ios')).to.deep.equal({ deviceCpu: true, deviceMem: false, appCpu: false, appMem: false });
    expect(seriesFor('')).to.deep.equal({ deviceCpu: false, deviceMem: false, appCpu: false, appMem: false });
  });

  it('answers samples in time order, named by the last app recorded', () => {
    const body = sessionMetricsBody('android', [
      row(4000, { app_id: null, app_cpu_pct: null, app_mem_mb: null }),
      row(0, { app_id: 'com.old.app' }),
      row(2000),
    ]);
    expect(body.samples.map((s) => s.t)).to.deep.equal([0, 2000, 4000]);
    expect(body.appId).to.equal('com.acme.shop');
    expect(body.intervalMs).to.equal(2000);
    expect(body.samples[1]).to.deep.equal({
      t: 2000,
      deviceCpu: 20,
      deviceMemMb: 2800,
      deviceMemTotalMb: 5620.8,
      appCpu: 5,
      appMemMb: 300,
    });
  });
});

describe('GET /session/:sessionId/metrics', function () {
  this.timeout(60_000);
  const scratch = useScratchDatabase();

  function app() {
    const a = express();
    a.use((req, _res, next) => {
      (req as any).auth = {
        kind: 'user',
        userId: 'sa',
        role: 'SUPER_ADMIN',
        scopes: ['admin', 'devices', 'sessions', 'read'],
        teamIds: undefined,
      };
      next();
    });
    DashboardRouter.register(a as any);
    return a;
  }

  beforeEach(async () => {
    await scratch.db.sessionMetric.deleteMany({});
    await scratch.db.session.deleteMany({});
  });

  it("answers a session's samples", async () => {
    await scratch.db.session.create({
      data: {
        id: 'metrics-1',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'n',
        has_live_video: false,
        device_udid: 'phone-m',
        device_platform: 'android',
        device_version: '10',
      },
    });
    await scratch.db.sessionMetric.createMany({
      data: [
        { session_id: 'metrics-1', ...row(2000) },
        { session_id: 'metrics-1', ...row(0) },
      ],
    });

    const res = await request(app()).get('/session/metrics-1/metrics');

    expect(res.status).to.equal(200);
    expect(res.body.platform).to.equal('android');
    expect(res.body.samples.map((s: any) => s.t)).to.deep.equal([0, 2000]);
    expect(res.body.series.appMem).to.equal(true);
  });
});
```

In `test/integration/team-visibility-sessions.spec.ts`, in the route list of "answers every session route for another team's session exactly as for an unknown one", after `'/profiling',` add:

```ts
      '/metrics',
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx mocha test/unit/session-metrics-route.spec.ts`
Expected: FAIL, `Cannot find module '../../src/services/metrics/metricsBody'`.

- [ ] **Step 3: Write `metricsBody.ts`**

```ts
import { SAMPLE_INTERVAL_MS } from './types';

export interface SessionMetricRow {
  at: number;
  device_cpu_pct: number | null;
  device_mem_mb: number | null;
  device_mem_total: number | null;
  app_cpu_pct: number | null;
  app_mem_mb: number | null;
  app_id: string | null;
}

export interface MetricSeries {
  deviceCpu: boolean;
  deviceMem: boolean;
  appCpu: boolean;
  appMem: boolean;
}

export interface SessionMetricsBody {
  platform: string;
  intervalMs: number;
  appId: string | null;
  series: MetricSeries;
  samples: Array<{
    t: number;
    deviceCpu: number | null;
    deviceMemMb: number | null;
    deviceMemTotalMb: number | null;
    appCpu: number | null;
    appMemMb: number | null;
  }>;
}

/** What a session on this platform can have: Android everything, an iPhone device CPU. */
export function seriesFor(platform: string): MetricSeries {
  const p = platform.toLowerCase();
  const android = p === 'android';
  return { deviceCpu: android || p === 'ios', deviceMem: android, appCpu: android, appMem: android };
}

export function sessionMetricsBody(platform: string, rows: SessionMetricRow[]): SessionMetricsBody {
  const sorted = [...rows].sort((a, b) => a.at - b.at);
  const lastApp = [...sorted].reverse().find((r) => r.app_id);
  return {
    platform: platform.toLowerCase(),
    intervalMs: SAMPLE_INTERVAL_MS,
    appId: lastApp?.app_id ?? null,
    series: seriesFor(platform),
    samples: sorted.map((r) => ({
      t: r.at,
      deviceCpu: r.device_cpu_pct,
      deviceMemMb: r.device_mem_mb,
      deviceMemTotalMb: r.device_mem_total,
      appCpu: r.app_cpu_pct,
      appMemMb: r.app_mem_mb,
    })),
  };
}
```

- [ ] **Step 4: Add the route**

In `src/app/routers/dashboard.ts`, add the import beside the other service imports:

```ts
import { sessionMetricsBody } from '../../services/metrics/metricsBody';
```

Add the handler after `getProfilingData`:

```ts
/** A session's CPU and memory samples, for the Performance panel. */
async function getSessionMetrics(request: Request, response: Response) {
  const sessionId = request.params.sessionId;
  const [session, rows] = await Promise.all([
    prisma.session.findFirst({ where: { id: sessionId }, select: { device_platform: true } }),
    prisma.sessionMetric.findMany({ where: { session_id: sessionId }, orderBy: { at: 'asc' } }),
  ]);
  return response.status(200).json(sessionMetricsBody(session?.device_platform ?? '', rows));
}
```

In `register`, after `router.get('/session/:sessionId/profiling', getProfilingData);` add:

```ts
  router.get('/session/:sessionId/metrics', getSessionMetrics);
```

The existing `router.use('/session/:sessionId', isValidSession)` already gives a hidden or unknown session the unknown-id answer.

In `web/src/api-service/index.ts`, after `getProfilingData`:

```ts
  public static getSessionMetrics(sessionId: string) {
    return apiClient.makeGETRequest(`/session/${sessionId}/metrics`);
  }
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx mocha test/unit/session-metrics-route.spec.ts`
Expected: 3 passing.

The visibility integration spec writes to the default database, so it runs in the full suite (Task 8).

- [ ] **Step 6: Commit**

```bash
git add src/services/metrics/metricsBody.ts src/app/routers/dashboard.ts web/src/api-service/index.ts test/unit/session-metrics-route.spec.ts test/integration/team-visibility-sessions.spec.ts
git commit -m "feat(metrics): GET /session/:id/metrics"
```

---

### Task 6: The line chart

**Files:**
- Create: `web/src/components/session-detail/performance.ts`, `web/src/components/session-detail/line-chart.tsx`
- Test: `web/src/components/session-detail/performance.test.ts`, `web/src/components/session-detail/line-chart.test.tsx`

**Interfaces:**
- Produces (`performance.ts`): `MetricPoint`, `SessionMetrics` (the API body), `asSessionMetrics(body: unknown): SessionMetrics | null`, `stats(values: Array<number | null>): { peak: number; average: number } | null`, `formatElapsed(ms: number): string`, `formatPct(p: number): string`, `formatMb(mb: number): string`.
- Produces (`line-chart.tsx`):
  - `interface ChartSeries { key: string; label: string; color: string; values: Array<number | null>; dashed?: boolean }`
  - `LineChart` component, with props `{ times: number[]; series: ChartSeries[]; yMax?: number; formatValue: (v: number) => string; ariaLabel: string; height?: number }`
  - helpers `niceMax`, `nearestIndex`, `sampleIndexes`, `linePath`, and `MAX_POINTS = 600`

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/session-detail/performance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { asSessionMetrics, formatElapsed, formatMb, formatPct, stats } from './performance';

describe('performance helpers', () => {
  it('accepts only the metrics answer', () => {
    expect(asSessionMetrics([])).toBeNull();
    expect(asSessionMetrics({ error: true, message: 'Session not found' })).toBeNull();
    expect(asSessionMetrics(null)).toBeNull();
    const ok = asSessionMetrics({
      platform: 'android',
      intervalMs: 2000,
      appId: 'com.acme.shop',
      series: { deviceCpu: true, deviceMem: true, appCpu: true, appMem: true },
      samples: [{ t: 1, deviceCpu: null, deviceMemMb: 1, deviceMemTotalMb: 2, appCpu: null, appMemMb: 3 }],
    });
    expect(ok?.samples).toHaveLength(1);
    expect(ok?.appId).toBe('com.acme.shop');
  });

  it('gives peak and average over recorded values only', () => {
    expect(stats([null, null])).toBeNull();
    expect(stats([1, null, 3])).toEqual({ peak: 3, average: 2 });
  });

  it('formats elapsed time, percentages and memory', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(3_723_000)).toBe('1:02:03');
    expect(formatPct(0)).toBe('0%');
    expect(formatPct(5.12)).toBe('5.1%');
    expect(formatPct(20)).toBe('20%');
    expect(formatMb(326.6)).toBe('327 MB');
    expect(formatMb(2848.2)).toBe('2.8 GB');
  });
});
```

Create `web/src/components/session-detail/line-chart.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LineChart, MAX_POINTS, linePath, nearestIndex, niceMax, sampleIndexes } from './line-chart';

describe('line chart maths', () => {
  it('rounds the axis up to a round number', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(8);
    expect(niceMax(12)).toBe(15);
    expect(niceMax(21)).toBe(25);
    expect(niceMax(100)).toBe(100);
    expect(niceMax(326.6)).toBe(400);
    expect(niceMax(5620.8)).toBe(6000);
  });

  it('finds the sample nearest a time', () => {
    const times = [0, 2000, 4000];
    expect(nearestIndex(times, 2900)).toBe(1);
    expect(nearestIndex(times, 3100)).toBe(2);
    expect(nearestIndex(times, -5)).toBe(0);
    expect(nearestIndex(times, 99_999)).toBe(2);
    expect(nearestIndex([], 5)).toBe(-1);
  });

  it('draws a long session with at most 600 points, always ending at the last sample', () => {
    expect(sampleIndexes(5)).toEqual([0, 1, 2, 3, 4]);
    const idx = sampleIndexes(5000);
    expect(idx.length).toBeLessThanOrEqual(MAX_POINTS);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(4999);
  });

  it('breaks a line where a value is missing', () => {
    expect(linePath([10, null, 30, 40], [0, 1, 2, 3], [0, 1, 2, 3], 3, 40, 300, 100)).toBe(
      'M0 75 M200 25 L300 0',
    );
  });
});

describe('LineChart', () => {
  const series = [
    { key: 'device', label: 'Device', color: 'var(--color-info)', values: [10, 20, 30] },
    { key: 'app', label: 'App', color: 'var(--color-accent)', values: [1, null, 3] },
  ];

  it('draws a line per series', () => {
    render(
      <LineChart ariaLabel="CPU over the session" times={[0, 2000, 4000]} series={series} yMax={100} formatValue={(v) => `${v}%`} />,
    );
    expect(screen.getByRole('img', { name: 'CPU over the session' }).querySelectorAll('path')).toHaveLength(2);
  });

  it("shows each line's value at the hovered time, and hides it on leaving", () => {
    render(
      <LineChart ariaLabel="CPU over the session" times={[0, 2000, 4000]} series={series} yMax={100} formatValue={(v) => `${v}%`} />,
    );
    const box = screen.getByTestId('line-chart');
    box.getBoundingClientRect = () =>
      ({ left: 0, width: 400, top: 0, height: 140, right: 400, bottom: 140, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    fireEvent.mouseMove(box, { clientX: 200 });
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('0:02');
    expect(tip.textContent).toContain('Device20%');
    expect(tip.textContent).toContain('App—');

    fireEvent.mouseLeave(box);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run (alone, from `web/`): `cd web && npx vitest run src/components/session-detail/performance.test.ts src/components/session-detail/line-chart.test.tsx`
Expected: FAIL, the modules `./performance` and `./line-chart` don't exist.

- [ ] **Step 3: Write `performance.ts`**

```ts
export interface MetricPoint {
  t: number;
  deviceCpu: number | null;
  deviceMemMb: number | null;
  deviceMemTotalMb: number | null;
  appCpu: number | null;
  appMemMb: number | null;
}

export interface SessionMetrics {
  platform: string;
  intervalMs: number;
  appId: string | null;
  series: { deviceCpu: boolean; deviceMem: boolean; appCpu: boolean; appMem: boolean };
  samples: MetricPoint[];
}

/** The metrics endpoint's answer, or null for anything else (an error body, a `[]`). */
export function asSessionMetrics(body: unknown): SessionMetrics | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Partial<SessionMetrics>;
  if (!Array.isArray(b.samples) || !b.series || typeof b.series !== 'object') return null;
  return {
    platform: String(b.platform ?? ''),
    intervalMs: Number(b.intervalMs) || 2000,
    appId: typeof b.appId === 'string' ? b.appId : null,
    series: {
      deviceCpu: !!b.series.deviceCpu,
      deviceMem: !!b.series.deviceMem,
      appCpu: !!b.series.appCpu,
      appMem: !!b.series.appMem,
    },
    samples: b.samples,
  };
}

export function stats(values: Array<number | null>): { peak: number; average: number } | null {
  let peak = -Infinity;
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue;
    peak = Math.max(peak, v);
    sum += v;
    n += 1;
  }
  return n === 0 ? null : { peak, average: sum / n };
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function formatPct(p: number): string {
  if (p === 0) return '0%';
  return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`;
}

export function formatMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
```

- [ ] **Step 4: Write `line-chart.tsx`**

```tsx
import React, { useMemo, useRef, useState } from 'react';
import { formatElapsed } from './performance';

export interface ChartSeries {
  key: string;
  label: string;
  /** A design token, e.g. `var(--color-info)`; never a literal colour. */
  color: string;
  values: Array<number | null>;
  dashed?: boolean;
}

export interface LineChartProps {
  /** Milliseconds from the first sample, one per value. */
  times: number[];
  series: ChartSeries[];
  /** Top of the y axis; the data's own maximum, rounded up, when absent. */
  yMax?: number;
  formatValue: (v: number) => string;
  ariaLabel: string;
  height?: number;
}

/** The viewBox is this wide; the svg stretches to its box and strokes keep their width. */
const VIEW_W = 1000;
/** A long session draws at most this many points per line. */
export const MAX_POINTS = 600;

/** A round number at or above `max`, for the top of the axis. */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (m * p >= max) return m * p;
  }
  return 10 * p;
}

/** The index of the time nearest `t` in ascending `times`; -1 when empty. */
export function nearestIndex(times: number[], t: number): number {
  if (times.length === 0) return -1;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && t - times[lo - 1] <= times[lo] - t) return lo - 1;
  return lo;
}

/** Evenly spread indexes, at most `max`, always including the first and the last. */
export function sampleIndexes(n: number, max = MAX_POINTS): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const step = Math.ceil((n - 1) / (max - 1));
  const out: number[] = [];
  for (let i = 0; i < n - 1; i += step) out.push(i);
  out.push(n - 1);
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** An SVG path through the values at `indexes`; a missing value breaks the line. */
export function linePath(
  values: Array<number | null>,
  times: number[],
  indexes: number[],
  tMax: number,
  yMax: number,
  width: number,
  height: number,
): string {
  const parts: string[] = [];
  let pen = false;
  for (const i of indexes) {
    const v = values[i];
    if (v === null || v === undefined) {
      pen = false;
      continue;
    }
    const x = (times[i] / tMax) * width;
    const y = height - (Math.min(v, yMax) / yMax) * height;
    parts.push(`${pen ? 'L' : 'M'}${r2(x)} ${r2(y)}`);
    pen = true;
  }
  return parts.join(' ');
}

export const LineChart: React.FC<LineChartProps> = ({
  times,
  series,
  yMax,
  formatValue,
  ariaLabel,
  height = 140,
}) => {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const tMax = Math.max(times.length ? times[times.length - 1] : 0, 1);
  const top = useMemo(() => {
    if (yMax !== undefined) return yMax;
    let max = 0;
    for (const s of series) for (const v of s.values) if (v !== null && v > max) max = v;
    return niceMax(max);
  }, [series, yMax]);
  const indexes = useMemo(() => sampleIndexes(times.length), [times.length]);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || r.width <= 0 || times.length === 0) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHover(nearestIndex(times, frac * tMax));
  };

  const hoverPct = hover !== null ? (times[hover] / tMax) * 100 : 0;
  return (
    <div className="flex gap-2">
      <div
        className="flex w-14 flex-col justify-between text-right text-[10px] tabular-nums text-[var(--text-dim)]"
        style={{ height }}
      >
        <span>{formatValue(top)}</span>
        <span>{formatValue(0)}</span>
      </div>
      <div
        ref={box}
        data-testid="line-chart"
        className="relative min-w-0 flex-1"
        style={{ height }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <svg
          role="img"
          aria-label={ariaLabel}
          viewBox={`0 0 ${VIEW_W} ${height}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
        >
          {[0, 0.5, 1].map((g) => (
            <line
              key={g}
              x1={0}
              x2={VIEW_W}
              y1={g * height}
              y2={g * height}
              stroke="var(--border)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {series.map((s) => (
            <path
              key={s.key}
              data-series={s.key}
              d={linePath(s.values, times, indexes, tMax, top, VIEW_W, height)}
              fill="none"
              stroke={s.color}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeDasharray={s.dashed ? '4 3' : undefined}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {hover !== null && (
            <line
              x1={(hoverPct / 100) * VIEW_W}
              x2={(hoverPct / 100) * VIEW_W}
              y1={0}
              y2={height}
              stroke="var(--text-muted)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {hover !== null && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-1 z-10 whitespace-nowrap rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--text)]"
            style={hoverPct > 60 ? { right: `${100 - hoverPct}%`, marginRight: 8 } : { left: `${hoverPct}%`, marginLeft: 8 }}
          >
            <div className="tabular-nums text-[var(--text-dim)]">{formatElapsed(times[hover])}</div>
            {series.map((s) => {
              const v = s.values[hover];
              return (
                <div key={s.key} className="flex items-center gap-1.5 tabular-nums">
                  <span className="inline-block h-0.5 w-3" style={{ background: s.color }} />
                  <span className="text-[var(--text-muted)]">{s.label}</span>
                  <span className="ml-auto pl-3">{v === null || v === undefined ? '—' : formatValue(v)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 5: Run the tests and watch them pass**

Run (alone, from `web/`): `npx vitest run src/components/session-detail/performance.test.ts src/components/session-detail/line-chart.test.tsx`
Expected: 9 passing.

Then: `npx prettier --write src/components/session-detail/performance.ts src/components/session-detail/line-chart.tsx src/components/session-detail/performance.test.ts src/components/session-detail/line-chart.test.tsx` (new files), and `npx vitest run src/design/color-literals.test.ts`, which must pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/session-detail/performance.ts web/src/components/session-detail/line-chart.tsx web/src/components/session-detail/performance.test.ts web/src/components/session-detail/line-chart.test.tsx
git commit -m "feat(web): an SVG line chart and the performance helpers"
```

---

### Task 7: The Performance panel on the session page

**Files:**
- Create: `web/src/components/session-detail/performance-panel.tsx`
- Modify: `web/src/components/session-detail/session-detail-page.tsx` (after `<HealingPanel commands={commands} />`)
- Modify: `web/test/viewport/overflow.spec.ts` (`mockSessionDetail` and the session route's content check)
- Test: `web/src/components/session-detail/performance-panel.test.tsx`

**Interfaces:**
- Consumes: `XenonApiService.getSessionMetrics` (Task 5), and `LineChart`, `ChartSeries` and the `performance.ts` helpers (Task 6).
- Produces: `PerformancePanel`, with props `{ sessionId: string; running: boolean; hasTrace: boolean }`, and `METRICS_REFRESH_MS = 10_000`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/session-detail/performance-panel.test.tsx`:

```tsx
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import XenonApiService from '../../api-service';
import { METRICS_REFRESH_MS, PerformancePanel } from './performance-panel';

const android = (n: number) => ({
  platform: 'android',
  intervalMs: 2000,
  appId: 'com.acme.shop',
  series: { deviceCpu: true, deviceMem: true, appCpu: true, appMem: true },
  samples: Array.from({ length: n }, (_, i) => ({
    t: 1_000_000 + i * 2000,
    deviceCpu: i === 0 ? null : 20 + i,
    deviceMemMb: 2800 + i,
    deviceMemTotalMb: 5620.8,
    appCpu: i === 0 ? null : 5,
    appMemMb: 300 + i,
  })),
});
const ios = (n: number) => ({
  ...android(n),
  platform: 'ios',
  appId: null,
  series: { deviceCpu: true, deviceMem: false, appCpu: false, appMem: false },
});

const answer = (body: unknown) => vi.spyOn(XenonApiService, 'getSessionMetrics').mockResolvedValue(body as any);

describe('PerformancePanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("charts an Android session's CPU and memory, with the app named", async () => {
    answer(android(5));
    render(<PerformancePanel sessionId="s1" running={false} hasTrace={false} />);

    expect(await screen.findByRole('img', { name: 'CPU over the session' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Memory over the session' })).toBeTruthy();
    expect(screen.getAllByText('com.acme.shop').length).toBeGreaterThan(0);
    expect(screen.getByText(/peak 304 MB/)).toBeTruthy();
  });

  it("charts only an iPhone's device CPU, and says why", async () => {
    answer(ios(5));
    render(<PerformancePanel sessionId="s1" running={false} hasTrace />);

    expect(await screen.findByRole('img', { name: 'CPU over the session' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Memory over the session' })).toBeNull();
    expect(screen.getByText(/iPhone: device CPU only/)).toBeTruthy();
    expect(screen.getByText(/Instruments trace is under Details/)).toBeTruthy();
  });

  it('says why an ended session has no figures', async () => {
    answer({ ...android(0) });
    render(<PerformancePanel sessionId="s1" running={false} hasTrace={false} />);

    expect(await screen.findByText('No performance figures for this session')).toBeTruthy();
  });

  it('treats an answer that is not the metrics shape as no figures', async () => {
    answer([]);
    render(<PerformancePanel sessionId="s1" running={false} hasTrace={false} />);

    expect(await screen.findByText('No performance figures for this session')).toBeTruthy();
  });

  it('says it is collecting while a running session has under two samples', async () => {
    answer(android(1));
    render(<PerformancePanel sessionId="s1" running hasTrace={false} />);

    expect(await screen.findByText(/Collecting/)).toBeTruthy();
  });

  it('asks again every 10 s while the session runs', async () => {
    vi.useFakeTimers();
    const spy = answer(android(3));
    render(<PerformancePanel sessionId="s1" running hasTrace={false} />);
    expect(spy).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(METRICS_REFRESH_MS);
    });

    expect(spy).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run (alone, from `web/`): `npx vitest run src/components/session-detail/performance-panel.test.tsx`
Expected: FAIL, the module `./performance-panel` doesn't exist.

- [ ] **Step 3: Write `performance-panel.tsx`**

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import XenonApiService from '../../api-service';
import { ChartSeries, LineChart } from './line-chart';
import { SessionMetrics, asSessionMetrics, formatMb, formatPct, stats } from './performance';

/** How often a running session's figures are asked for: one write's worth. */
export const METRICS_REFRESH_MS = 10_000;

const DEVICE = 'var(--color-info)';
const APP = 'var(--color-accent)';
const TOTAL = 'var(--border-strong)';

interface Props {
  sessionId: string;
  running: boolean;
  hasTrace: boolean;
}

const ChartBlock: React.FC<{
  title: string;
  series: ChartSeries[];
  times: number[];
  yMax?: number;
  format: (v: number) => string;
  ariaLabel: string;
}> = ({ title, series, times, yMax, format, ariaLabel }) => (
  <section aria-label={title}>
    <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <h3 className="text-xs font-semibold text-[var(--text)]">{title}</h3>
      {series.map((s) => {
        const st = stats(s.values);
        return (
          <span
            key={s.key}
            className="flex min-w-0 items-center gap-1.5 text-[11px] tabular-nums text-[var(--text-muted)]"
          >
            <span className="inline-block h-0.5 w-3 shrink-0" style={{ background: s.color }} />
            <span className="max-w-[16rem] truncate" title={s.label}>
              {s.label}
            </span>
            {st &&
              (s.dashed ? (
                <span>{format(st.peak)}</span>
              ) : (
                <span>
                  peak {format(st.peak)} · avg {format(st.average)}
                </span>
              ))}
          </span>
        );
      })}
    </div>
    <LineChart times={times} series={series} yMax={yMax} formatValue={format} ariaLabel={ariaLabel} />
  </section>
);

/**
 * CPU and memory over the session (SessionMetricsService). Android: the app
 * under test and the device; an iPhone: device CPU only.
 */
export const PerformancePanel: React.FC<Props> = ({ sessionId, running, hasTrace }) => {
  const [metrics, setMetrics] = useState<SessionMetrics | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      XenonApiService.getSessionMetrics(sessionId)
        .then((body: unknown) => {
          if (!alive) return;
          setMetrics(asSessionMetrics(body));
          setLoaded(true);
        })
        .catch(() => {
          if (alive) setLoaded(true);
        });
    void load();
    if (!running) {
      return () => {
        alive = false;
      };
    }
    const id = setInterval(() => void load(), METRICS_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [sessionId, running]);

  const samples = metrics?.samples ?? [];
  const times = useMemo(() => samples.map((s) => s.t - (samples[0]?.t ?? 0)), [samples]);
  const appLabel = metrics?.appId ?? 'App';

  const cpu: ChartSeries[] = [];
  const mem: ChartSeries[] = [];
  if (metrics) {
    if (metrics.series.deviceCpu) {
      cpu.push({ key: 'deviceCpu', label: 'Device', color: DEVICE, values: samples.map((s) => s.deviceCpu) });
    }
    if (metrics.series.appCpu) {
      cpu.push({ key: 'appCpu', label: appLabel, color: APP, values: samples.map((s) => s.appCpu) });
    }
    if (metrics.series.appMem) {
      mem.push({ key: 'appMem', label: appLabel, color: APP, values: samples.map((s) => s.appMemMb) });
    }
    if (metrics.series.deviceMem) {
      mem.push({ key: 'deviceMem', label: 'Device used', color: DEVICE, values: samples.map((s) => s.deviceMemMb) });
      mem.push({
        key: 'deviceTotal',
        label: 'Device total',
        color: TOTAL,
        values: samples.map((s) => s.deviceMemTotalMb),
        dashed: true,
      });
    }
  }

  let body: React.ReactNode;
  if (!loaded) {
    body = <div className="text-xs text-[var(--text-dim)]">Loading performance…</div>;
  } else if (samples.length === 0 && !running) {
    body = (
      <EmptyState
        title="No performance figures for this session"
        description="Xenon records CPU and memory for sessions on its own Android phones and iPhones (an iPhone: device CPU only). This session ran on a simulator, on another server's phone, before Xenon recorded them, or with sessionMetrics turned off."
      />
    );
  } else if (samples.length < 2) {
    body = (
      <div className="text-xs text-[var(--text-dim)]">
        {running
          ? 'Collecting… The first figures appear within 10 seconds.'
          : 'Too few figures were recorded to draw a chart.'}
      </div>
    );
  } else {
    body = (
      <div className="space-y-4">
        {metrics?.platform === 'ios' && (
          <p className="text-xs text-[var(--text-dim)]">
            iPhone: device CPU only. go-ios can't read an iPhone's memory or one app's figures.
            {hasTrace ? ' The Instruments trace is under Details.' : ''}
          </p>
        )}
        {cpu.length > 0 && (
          <ChartBlock title="CPU" series={cpu} times={times} yMax={100} format={formatPct} ariaLabel="CPU over the session" />
        )}
        {mem.length > 0 && (
          <ChartBlock title="Memory" series={mem} times={times} format={formatMb} ariaLabel="Memory over the session" />
        )}
      </div>
    );
  }

  return (
    <Card
      header={
        <span className="flex items-center gap-2">
          <Activity size={14} /> Performance
        </span>
      }
    >
      {body}
    </Card>
  );
};
```

- [ ] **Step 4: Place it on the session page**

In `web/src/components/session-detail/session-detail-page.tsx`, add the import beside the other panel imports:

```tsx
import { PerformancePanel } from './performance-panel';
```

and after `<HealingPanel commands={commands} />`:

```tsx
          <PerformancePanel
            sessionId={s.id}
            running={s.status === 'running'}
            hasTrace={!!s.performance_trace}
          />
```

- [ ] **Step 5: Run the panel tests and the session-detail tests**

Run (alone, from `web/`): `npx vitest run src/components/session-detail`
Expected: all passing (6 new).

Then:
- `npx prettier --write src/components/session-detail/performance-panel.tsx src/components/session-detail/performance-panel.test.tsx` (new files);
- check `session-detail-page.tsx` formatting by hand;
- `npx vitest run src/design/color-literals.test.ts` must pass.

- [ ] **Step 6: Mock the metrics in the viewport spec**

In `web/test/viewport/overflow.spec.ts`, add this beside the other `WIDE_` constants:

```ts
// A long package name and an hour-scale run: the Performance panel's legend
// truncates, and its charts draw at most 600 points.
const WIDE_METRICS = {
  platform: 'android',
  intervalMs: 2000,
  appId: 'com.acme.enterprise.superapp.with.an.unusually.long.package.name.for.layout',
  series: { deviceCpu: true, deviceMem: true, appCpu: true, appMem: true },
  samples: Array.from({ length: 1800 }, (_, i) => ({
    t: 1_790_000_000_000 + i * 2000,
    deviceCpu: i === 0 ? null : 15 + (i % 30),
    deviceMemMb: 2800 + (i % 200),
    deviceMemTotalMb: 5620.8,
    appCpu: i === 0 ? null : 4 + (i % 7),
    appMemMb: 300 + (i % 50),
  })),
};
```

In `mockSessionDetail`, after the catch-all `**/xenon/api/session/${WIDE_SESSION_ID}/**` route (a later route wins), add:

```ts
  await page.route(`**/xenon/api/session/${WIDE_SESSION_ID}/metrics*`, (route) =>
    route.fulfill({ json: WIDE_METRICS }),
  );
```

In `ROUTE_CONTENT_CHECKS` for `` `/xenon/builds/${BUILD_ID}/sessions/${WIDE_SESSION_ID}` ``, add:

```ts
    await expect(page.getByRole('img', { name: 'CPU over the session' })).toBeVisible();
```

- [ ] **Step 7: Commit**

```bash
git add web/src/components/session-detail/performance-panel.tsx web/src/components/session-detail/performance-panel.test.tsx web/src/components/session-detail/session-detail-page.tsx web/test/viewport/overflow.spec.ts
git commit -m "feat(web): a Performance panel on the session page"
```

---

### Task 8: Docs, full checks, and the real phones

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document it**

In `CLAUDE.md`, add after the "Recording Subsystem" section (before "### Logcat Streaming"):

```markdown
### Session performance (`src/services/metrics/`)

CPU and memory every 2 s for each session on this server's own phones,
charted in the session page's Performance panel. Through 2.9 the Android
profiler ran only with an `appPackage`, read `top -m 20` (an idle app never
appears there) and saved nothing; iOS had only the Instruments trace download.

- `SessionMetricsService` starts a sampler in `EventManager.onSessionStarted`,
  after the session's row is written (the samples point at it), and stops it
  in `onSessionStopped` whether or not the session is still in memory. It
  writes every 10 s (`SessionMetric`), keeps the newest 900 samples while
  writes fail, and never fails a session: five failures in a row stop that
  session's sampler. `sessionMetrics: false` turns it off.
- **Android** (`AndroidMetricsSampler`): one `adb shell` call per sample
  through the resolved adb, reading `/proc/stat`, `/proc/meminfo`, and the
  app's `/proc/<pid>/stat` and `VmRSS`. CPU comes from the change since the
  previous sample, as a share of the whole device; a new pid shows no app CPU
  for one sample, never a spike. The app is `appPackage` if it is a package
  name (it goes into a shell command; anything else is ignored), else the
  foreground app, re-read every 10 s.
- **iPhone** (`IOSMetricsSampler`): `ios sysmontap` through the phone's tunnel
  (`IOSTunnels.borrow`, asked again every 30 s), tracked in `ProcessRegistry`
  for the session. go-ios 1.2.1 gives device CPU only: `cpu_total_load` is
  summed over cores and divided by `enabled_cpus`.
- `GET /session/:id/metrics` (`metricsBody.ts`) says what the platform can
  record (`series`) beside the samples. A node session's figures are on the
  node's dashboard.
- The charts are SVG (`line-chart.tsx`), at most 600 points per line, in
  role-token colours.
```

Add to the Key Files table, after the `IOSTunnels.ts` row:

```markdown
| `src/services/metrics/SessionMetricsService.ts` | A CPU and memory sampler per session on this server's phones, buffered and written every 10 s to `SessionMetric`; Android via `/proc`, iPhone via go-ios `sysmontap` |
```

- [ ] **Step 2: Run the full suites**

```bash
ANDROID_HOME=$HOME/Library/Android/sdk npm run test:all > /tmp/perf-suite.log 2>&1; echo "exit $?"; grep -E "passing|failing|pending" /tmp/perf-suite.log | tail -3
```

Expected: exit 0, with no failures.

Then, run alone and from `web/`: `npx vitest run`. Expected: all passing.

Then:

```bash
npx tsc --noEmit -p . && echo "types ok"
DATABASE_URL='file:./ci-check.db' npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code; echo "migrate diff $?"; rm -f ci-check.db
node mac-app/scripts/sync-tokens.mjs --check; echo "tokens $?"
for f in $(git diff --name-only origin/main -- '*.ts' '*.tsx' | grep -v '^src/generated'); do a=$(git show origin/main:$f 2>/dev/null | npx eslint --stdin --stdin-filename $f -f unix 2>/dev/null | grep -c ':[0-9]*:[0-9]*:'); b=$(npx eslint $f -f unix 2>/dev/null | grep -c ':[0-9]*:[0-9]*:'); [ "$b" -gt "${a:-0}" ] && echo "LINT UP $f $a -> $b"; done; echo "lint compared"
```

Expected: "types ok", "migrate diff 0", "tokens 0", and no "LINT UP" line.

The client-freshness gate regenerates with the worktree's paths, so run it from the main checkout after merge, as part of the release gates.

- [ ] **Step 3: Build a scratch server from the branch**

```bash
npm run build:xenon
npx tsc -b && npm run build:copy
S=/private/tmp/claude-501/-Users-rabindrabiswal-Workspace-XAenon-xenon/9a8ed34b-ba86-40d6-a815-6a0ce62ed9a7/scratchpad
sed -i '' 's#\.claude/worktrees/[a-z]*#.claude/worktrees/perf#g' $S/sessions/home/node_modules/.cache/appium/extensions.yaml
grep -c "worktrees/perf" $S/sessions/home/node_modules/.cache/appium/extensions.yaml
bash $S/ios/start-ios.sh
```

Expected: `2`, then "up on :4726".

- [ ] **Step 4: An Android session with `appPackage`, then without**

From the browser pane at `http://127.0.0.1:4726/xenon/`:

```js
const caps = (extra) => ({ capabilities: { alwaysMatch: { platformName: 'Android', 'appium:automationName': 'UiAutomator2', 'appium:udid': '381103b720057ece', ...extra }, firstMatch: [{}] } });
const r = await fetch('/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(caps({ 'appium:appPackage': 'com.android.settings', 'appium:appActivity': '.Settings' })) });
(await r.json()).value?.sessionId
```

Wait 30 s, then end the session with `fetch('/session/<id>', { method: 'DELETE' })`.

Check:

```bash
sqlite3 $S/ios/ios.db "select count(*), min(app_id), round(avg(device_cpu_pct),1), round(avg(app_mem_mb),1) from SessionMetric where session_id='<id>';"
```

Expected: about 15 rows with `app_id` `com.android.settings`, and CPU and memory filled in.

Repeat without `appPackage` and `appActivity`. Expected: `app_id` is the launcher (`com.sec.android.app.launcher`).

Time one sample command while Settings is open and the screen is scrolled:

```bash
ADB=~/Library/Android/sdk/platform-tools/adb
time $ADB -s 381103b720057ece shell "head -1 /proc/stat; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo; p=\$(pidof com.android.settings | cut -d' ' -f1); echo pid=\$p; cut -d' ' -f14,15 /proc/\$p/stat; grep VmRSS /proc/\$p/status"
```

Expected: well under 2 s (310 ms idle). Report the figure.

- [ ] **Step 5: An iPhone session**

Do the same with `{ platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': '00008110-00084CE80E51401E' }`. If the create fails, check the server log; Xenon starts the stream and WDA for the session.

While the session runs, open the Camera:

```js
fetch('/session/<id>/execute/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ script: 'mobile: launchApp', args: [{ bundleId: 'com.apple.camera' }] }) })
```

That loads the phone. After 30 s, end the session.

Expected:
- rows have only `device_cpu_pct` filled in, between 0 and 100, higher while the Camera ran;
- the session still has its Instruments trace (`performance_trace` set), so the two Instruments clients didn't conflict.

If the trace is missing or sysmontap logged errors, stop and report it: the spec's first risk.

- [ ] **Step 6: Look at the panel**

Open each session's page (`/xenon/builds/<buildId>/sessions/<id>`, from the Sessions list) in the browser pane:
- at 1440×900 and at 1280×800, in dark;
- then in light (account menu, Light).

Check:
- both charts on Android and the CPU chart and note on the iPhone;
- the hover tooltip;
- no overflow;
- the legend truncating a long name.

Take a screenshot of each.

Then run the viewport spec against the scratch server, alone, from `web/`:

```bash
XENON_BASE_URL=http://127.0.0.1:4726 npx playwright test test/viewport/overflow.spec.ts
```

Expected: all passing.

- [ ] **Step 7: Stop the scratch server and commit the docs**

```bash
kill -TERM $(lsof -tiTCP:4726 -sTCP:LISTEN)
git add CLAUDE.md
git commit -m "docs: session performance"
```
