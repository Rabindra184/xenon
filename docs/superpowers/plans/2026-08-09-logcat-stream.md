# Logcat Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Debug Logs tab's 3-second dump-poll with a continuous `logcat` stream over a WebSocket, delivering parsed, package-attributed records that the UI can filter and colour like Android Studio.

**Architecture:** Mirrors the existing H.264 stack one-for-one — a per-device child process owned by a service, fanned out through a multiplexer with a replay buffer, exposed on a path-scoped WebSocket upgrade authenticated by a single-use stream ticket. Parsing and PID→package resolution happen server-side so every client receives structured records; filtering happens client-side so one shared process can serve viewers with different filters.

**Tech Stack:** TypeScript 5.5, Node `child_process.spawn`, `ws`, TypeDI, React 17, Mocha + Chai + Sinon (backend), vitest (frontend).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-09-logcat-stream-design.md`. Read it before Task 1.
- Branch `feat/logcat-stream` already exists and holds the spec commit (`96e7508`). Work on it.
- **Never run the full test suite** (`npm test` or a broad mocha glob) — it crashes this repo. Run only the exact spec file named in each step.
- **Never run `eslint --fix`.** Scope any lint to files you touched, no `--fix`, and compare the error count against `main` before claiming you added none.
- **`git add` explicit paths only.** Never `git add -A` or `git add .`.
- **Never spawn a bare `adb`.** Resolve the binary via `Container.get(AndroidDeviceManager).getAdbForDevice(udid)` and use `adb.executable.path` — a GUI-launched server has no shell PATH and a bare name ENOENTs. Precedent: `ScrcpyServerSession.ts:131-136`.
- **Every `ChildProcess` must have an `'error'` listener.** A ChildProcess emitting `'error'` with zero listeners crashes the whole process. Precedent and comment: `ScrcpyServerSession.ts:156`.
- `schema.json` must not be modified. This adds no plugin args.
- `npx tsc --noEmit` clean before every commit. CI has no build or test gate — only Schema Drift Check and Publish.
- Verify each new test is non-vacuous: mutate the behaviour it pins, confirm red, restore. Suggested mutations in this repo have twice been inert or uncompilable; if one does not exercise the path, build a faithful one and say so.
- Do not bump the version. Releasing is a separate PR.
- Sizing constants come from the spec's "Sizing and timing" table. Use those exact values.

---

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `src/services/logcat/logcatParse.ts` | Pure. `threadtime` line → `LogcatRecord`. No I/O. |
| `src/device-managers/android/LogcatMultiplexer.ts` | Fan-out + replay ring buffer + visible drop accounting. |
| `src/services/logcat/PackageResolver.ts` | PID → process name, cached, reuse-safe. |
| `src/device-managers/android/LogcatStreamService.ts` | One `adb logcat` child per device; wires parse + resolver + mux; idle watchdog. |
| `src/app/ws/logcatWs.ts` | `attachLogcatWs` — ticket + ownership, path-scoped upgrade. |
| `web/src/components/device-control/logcat/logcatFilter.ts` | Pure. Query parse + apply. |
| `web/src/components/device-control/logcat/useLogcatStream.ts` | Ticket → WS → bounded buffer, bounded reconnect. |
| `web/src/components/device-control/logcat/LogcatView.tsx` | Columns, badges, toolbar. |
| `web/src/components/device-control/logcat/logcat.css` | Styles for the above. |
| Tests | `test/unit/logcat-parse.spec.ts`, `logcat-multiplexer.spec.ts`, `package-resolver.spec.ts`, `logcat-ws.spec.ts`, `web/src/components/device-control/logcat/logcatFilter.test.ts` |

**Modify:**

| Path | Change |
|---|---|
| `src/services/ServerManager.ts:~87` | Mount `attachLogcatWs` beside `attachH264Ws`. |
| `web/src/components/device-control/device-control.tsx` | Remove the log polling effect, `renderLogLines`, and the `deviceLogs`/`logStreamActive`/`logPollCount` state; render `<LogcatView>`. |

---

### Task 1: Pure threadtime parser

**Files:**
- Create: `src/services/logcat/logcatParse.ts`
- Test: `test/unit/logcat-parse.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LogLevel`, `LogcatRecord`, `parseThreadtimeLine(line: string, now?: Date): LogcatRecord | null`. Tasks 2, 4 and 7 import these types.

- [ ] **Step 1: Write the failing test**

Create `test/unit/logcat-parse.spec.ts`:

```ts
import { expect } from 'chai';
import { parseThreadtimeLine } from '../../src/services/logcat/logcatParse';

// `adb logcat -v threadtime` emits:
//   MM-DD HH:MM:SS.mmm   PID   TID L TAG: message
// There is no year, and lines can wrap without a timestamp prefix.

const NOW = new Date('2026-08-09T16:11:00.000Z');

describe('parseThreadtimeLine', () => {
  it('parses a well-formed line into fields', () => {
    const r = parseThreadtimeLine(
      '08-09 16:11:00.005  1408  1408 D KeyguardUpdateMonitor: received broadcast',
      NOW,
    );
    expect(r).to.not.equal(null);
    expect(r!.pid).to.equal(1408);
    expect(r!.tid).to.equal(1408);
    expect(r!.level).to.equal('D');
    expect(r!.tag).to.equal('KeyguardUpdateMonitor');
    expect(r!.message).to.equal('received broadcast');
  });

  it('keeps a message containing colons intact', () => {
    const r = parseThreadtimeLine(
      '08-09 16:11:00.006  1408  1408 D QSClock: status_bar_clock notify: a:b:c',
      NOW,
    );
    expect(r!.tag).to.equal('QSClock');
    expect(r!.message).to.equal('status_bar_clock notify: a:b:c');
  });

  it('handles differing pid and tid', () => {
    const r = parseThreadtimeLine('08-09 16:11:02.651  1408  1813 W NetworkCon: x', NOW);
    expect(r!.pid).to.equal(1408);
    expect(r!.tid).to.equal(1813);
    expect(r!.level).to.equal('W');
  });

  it('accepts every level', () => {
    for (const lvl of ['V', 'D', 'I', 'W', 'E', 'F']) {
      const r = parseThreadtimeLine(`08-09 16:11:00.000  1  1 ${lvl} T: m`, NOW);
      expect(r, lvl).to.not.equal(null);
      expect(r!.level, lvl).to.equal(lvl);
    }
  });

  it('tolerates a tag containing dots and dollars', () => {
    const r = parseThreadtimeLine('08-09 16:11:00.000  1  1 D Tile.WifiTile$1: m', NOW);
    expect(r!.tag).to.equal('Tile.WifiTile$1');
  });

  it('returns null for a continuation line (no timestamp prefix)', () => {
    expect(parseThreadtimeLine('    mTa=0 mLevel=4 more wrapped text', NOW)).to.equal(null);
  });

  it("returns null for logcat's own banner", () => {
    expect(parseThreadtimeLine('--------- beginning of main', NOW)).to.equal(null);
  });

  it('returns null for empty and malformed input', () => {
    expect(parseThreadtimeLine('', NOW)).to.equal(null);
    expect(parseThreadtimeLine('   ', NOW)).to.equal(null);
    expect(parseThreadtimeLine('not a log line at all', NOW)).to.equal(null);
  });

  it('assumes the current year', () => {
    const r = parseThreadtimeLine('08-09 16:11:00.005  1  1 D T: m', NOW);
    expect(new Date(r!.ts).getFullYear()).to.equal(2026);
  });

  // Without this, a log written on 31 Dec and read on 1 Jan lands twelve
  // months in the future.
  it('rolls back a year when the date would be in the future', () => {
    const jan1 = new Date('2026-01-01T00:05:00.000Z');
    const r = parseThreadtimeLine('12-31 23:59:00.000  1  1 D T: m', jan1);
    expect(new Date(r!.ts).getFullYear()).to.equal(2025);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx mocha test/unit/logcat-parse.spec.ts
```

Expected: FAIL — `Cannot find module '../../src/services/logcat/logcatParse'`.

- [ ] **Step 3: Write the implementation**

Create `src/services/logcat/logcatParse.ts`:

```ts
/**
 * Parser for `adb logcat -v threadtime` output.
 *
 * Pure: no I/O, no Container, no clock of its own — the caller passes `now` so
 * year inference is testable.
 *
 *   MM-DD HH:MM:SS.mmm   PID   TID L TAG: message
 *   08-09 16:11:00.005  1408  1408 D KeyguardUpdateMonitor: received broadcast
 */
export type LogLevel = 'V' | 'D' | 'I' | 'W' | 'E' | 'F';

export interface LogcatRecord {
  /** Epoch ms. threadtime carries no year — see inferYear below. */
  ts: number;
  pid: number;
  tid: number;
  level: LogLevel;
  tag: string;
  message: string;
  /** Process name for pid, attached later by the stream service. */
  pkg?: string;
  /** True for records Xenon injected rather than read from the device. */
  synthetic?: boolean;
}

const LINE =
  /^(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(.*?):\s?(.*)$/;

/**
 * logcat gives MM-DD with no year. Assume the current one, unless that lands
 * more than a day in the future — which means the log crossed a New Year
 * boundary and belongs to the previous one.
 */
function inferYear(month: number, day: number, now: Date): number {
  const year = now.getFullYear();
  const candidate = new Date(year, month - 1, day);
  const oneDayMs = 24 * 60 * 60 * 1000;
  return candidate.getTime() - now.getTime() > oneDayMs ? year - 1 : year;
}

export function parseThreadtimeLine(line: string, now: Date = new Date()): LogcatRecord | null {
  const m = LINE.exec(line);
  if (!m) return null; // continuation line, banner, or noise — caller decides

  const [, mo, d, h, mi, s, ms, pid, tid, level, tag, message] = m;
  const month = Number(mo);
  const day = Number(d);
  const ts = new Date(
    inferYear(month, day, now),
    month - 1,
    day,
    Number(h),
    Number(mi),
    Number(s),
    Number(ms),
  ).getTime();

  return {
    ts,
    pid: Number(pid),
    tid: Number(tid),
    level: level as LogLevel,
    tag: tag.trim(),
    message,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx mocha test/unit/logcat-parse.spec.ts
```

Expected: PASS, 10 passing.

- [ ] **Step 5: Verify the tests are not vacuous**

Temporarily change `inferYear`'s comparison from `> oneDayMs` to `> 0`. Re-run. Expected: the "assumes the current year" test FAILS (a record microseconds old rolls back a year). Restore and confirm 10 passing.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/services/logcat/logcatParse.ts test/unit/logcat-parse.spec.ts
git commit -m "feat(logcat): pure threadtime parser"
```

---

### Task 2: Multiplexer with visible drop accounting

**Files:**
- Create: `src/device-managers/android/LogcatMultiplexer.ts`
- Test: `test/unit/logcat-multiplexer.spec.ts`

**Interfaces:**
- Consumes: `LogcatRecord` from Task 1.
- Produces: `LogcatMultiplexer` with `push(r: LogcatRecord): void`, `addClient(send: (r: LogcatRecord) => void, canAccept: () => boolean): () => void`, `get clientCount(): number`, and the exported constant `REPLAY_BUFFER_SIZE = 2000`. Tasks 4 and 5 use these.

- [ ] **Step 1: Write the failing test**

Create `test/unit/logcat-multiplexer.spec.ts`:

```ts
import { expect } from 'chai';
import { LogcatMultiplexer } from '../../src/device-managers/android/LogcatMultiplexer';
import type { LogcatRecord } from '../../src/services/logcat/logcatParse';

const rec = (message: string): LogcatRecord => ({
  ts: 1,
  pid: 1,
  tid: 1,
  level: 'D',
  tag: 'T',
  message,
});

describe('LogcatMultiplexer', () => {
  it('fans a record out to every client', () => {
    const mux = new LogcatMultiplexer();
    const a: LogcatRecord[] = [];
    const b: LogcatRecord[] = [];
    mux.addClient((r) => a.push(r), () => true);
    mux.addClient((r) => b.push(r), () => true);

    mux.push(rec('hello'));

    expect(a.map((r) => r.message)).to.deep.equal(['hello']);
    expect(b.map((r) => r.message)).to.deep.equal(['hello']);
  });

  it('reports clientCount and stops sending after the remover runs', () => {
    const mux = new LogcatMultiplexer();
    const seen: LogcatRecord[] = [];
    const remove = mux.addClient((r) => seen.push(r), () => true);
    expect(mux.clientCount).to.equal(1);

    remove();
    expect(mux.clientCount).to.equal(0);
    mux.push(rec('after removal'));
    expect(seen).to.have.length(0);
  });

  // Opening the tab should show recent history, not an empty pane.
  it('replays the buffered history to a late joiner', () => {
    const mux = new LogcatMultiplexer();
    mux.push(rec('one'));
    mux.push(rec('two'));

    const late: LogcatRecord[] = [];
    mux.addClient((r) => late.push(r), () => true);

    expect(late.map((r) => r.message)).to.deep.equal(['one', 'two']);
  });

  it('bounds the replay buffer', () => {
    const mux = new LogcatMultiplexer();
    for (let i = 0; i < 2500; i++) mux.push(rec(`m${i}`));

    const late: LogcatRecord[] = [];
    mux.addClient((r) => late.push(r), () => true);

    expect(late).to.have.length(2000);
    expect(late[0].message).to.equal('m500');
    expect(late[late.length - 1].message).to.equal('m2499');
  });

  // A dropped video frame is invisible; a dropped log line is data loss the
  // reader cannot detect. The gap must appear IN the log.
  it('emits a synthetic warning instead of dropping silently', () => {
    const mux = new LogcatMultiplexer();
    const seen: LogcatRecord[] = [];
    let accepting = true;
    mux.addClient((r) => seen.push(r), () => accepting);

    accepting = false;
    mux.push(rec('lost one'));
    mux.push(rec('lost two'));
    accepting = true;
    mux.push(rec('delivered'));

    const messages = seen.map((r) => r.message);
    expect(messages).to.not.include('lost one');
    expect(messages).to.include('delivered');
    const warning = seen.find((r) => r.synthetic);
    expect(warning, 'a synthetic drop record must be emitted').to.not.equal(undefined);
    expect(warning!.level).to.equal('W');
    expect(warning!.tag).to.equal('xenon');
    expect(warning!.message).to.contain('2');
    expect(warning!.message.toLowerCase()).to.contain('dropped');
  });

  it('coalesces consecutive drops into one record', () => {
    const mux = new LogcatMultiplexer();
    const seen: LogcatRecord[] = [];
    let accepting = true;
    mux.addClient((r) => seen.push(r), () => accepting);

    accepting = false;
    for (let i = 0; i < 10; i++) mux.push(rec(`lost ${i}`));
    accepting = true;
    mux.push(rec('delivered'));

    expect(seen.filter((r) => r.synthetic)).to.have.length(1);
    expect(seen.find((r) => r.synthetic)!.message).to.contain('10');
  });

  it('does not put synthetic drop records in the replay buffer', () => {
    const mux = new LogcatMultiplexer();
    let accepting = true;
    const remove = mux.addClient(() => undefined, () => accepting);
    accepting = false;
    mux.push(rec('lost'));
    accepting = true;
    mux.push(rec('delivered'));
    remove();

    const late: LogcatRecord[] = [];
    mux.addClient((r) => late.push(r), () => true);
    // The drop was that one slow client's problem, not history.
    expect(late.filter((r) => r.synthetic)).to.have.length(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx mocha test/unit/logcat-multiplexer.spec.ts
```

Expected: FAIL — `Cannot find module '../../src/device-managers/android/LogcatMultiplexer'`.

- [ ] **Step 3: Write the implementation**

Create `src/device-managers/android/LogcatMultiplexer.ts`:

```ts
import type { LogcatRecord } from '../../services/logcat/logcatParse';

/**
 * One upstream logcat stream fanned out to many WebSocket clients — the log
 * analogue of H264Multiplexer.
 *
 * Join semantics: a new client immediately receives the replay buffer, so
 * opening the Debug Logs tab shows recent history instead of an empty pane.
 * (H264Multiplexer replays the current GOP for the same reason.)
 *
 * Drop semantics differ from video on purpose. H264Multiplexer drops frames
 * silently when a socket is backed up, which is right for video — the picture
 * simply stutters. A missing log line is data loss the reader cannot detect,
 * so a slow client gets a synthetic record in place of what it missed.
 */
export const REPLAY_BUFFER_SIZE = 2000;

interface Client {
  send: (r: LogcatRecord) => void;
  /** False when the socket is backed up; the mux then counts a drop. */
  canAccept: () => boolean;
  dropped: number;
}

export class LogcatMultiplexer {
  private clients = new Set<Client>();
  private replay: LogcatRecord[] = [];

  get clientCount(): number {
    return this.clients.size;
  }

  /** Register a client sink. Returns a remover. */
  addClient(send: (r: LogcatRecord) => void, canAccept: () => boolean): () => void {
    const c: Client = { send, canAccept, dropped: 0 };
    this.clients.add(c);
    for (const r of this.replay) send(r);
    return () => {
      this.clients.delete(c);
    };
  }

  push(record: LogcatRecord): void {
    this.replay.push(record);
    if (this.replay.length > REPLAY_BUFFER_SIZE) {
      this.replay.splice(0, this.replay.length - REPLAY_BUFFER_SIZE);
    }

    for (const c of this.clients) {
      if (!c.canAccept()) {
        c.dropped += 1;
        continue;
      }
      if (c.dropped > 0) {
        // Report the gap before the record that closes it, so the log reads in
        // order. Coalesced: one record per run of drops, not one per drop.
        const n = c.dropped;
        c.dropped = 0;
        c.send({
          ts: Date.now(),
          pid: 0,
          tid: 0,
          level: 'W',
          tag: 'xenon',
          message: `${n} lines dropped (slow client)`,
          synthetic: true,
        });
      }
      c.send(record);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx mocha test/unit/logcat-multiplexer.spec.ts
```

Expected: PASS, 7 passing.

- [ ] **Step 5: Verify the tests are not vacuous**

Temporarily change `if (c.dropped > 0) {` to `if (false && c.dropped > 0) {`. Re-run. Expected: the two drop tests FAIL. Restore and confirm 7 passing.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/device-managers/android/LogcatMultiplexer.ts test/unit/logcat-multiplexer.spec.ts
git commit -m "feat(logcat): multiplexer with replay and visible drop accounting"
```

---

### Task 3: PID → package resolver

**Files:**
- Create: `src/services/logcat/PackageResolver.ts`
- Test: `test/unit/package-resolver.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `PackageResolver` with `constructor(runPs: () => Promise<string>, ttlMs?: number, now?: () => number)` and `resolve(pid: number): Promise<string | undefined>`. Task 4 constructs it with a real `adb shell ps` runner.

- [ ] **Step 1: Write the failing test**

Create `test/unit/package-resolver.spec.ts`:

```ts
import { expect } from 'chai';
import { PackageResolver } from '../../src/services/logcat/PackageResolver';

// `adb shell ps -A -o PID,NAME` output shape.
const psOutput = (rows: Array<[number, string]>) =>
  ['  PID NAME', ...rows.map(([pid, name]) => `${String(pid).padStart(5)} ${name}`)].join('\n');

describe('PackageResolver', () => {
  it('resolves a pid to its process name', async () => {
    const r = new PackageResolver(async () => psOutput([[1408, 'com.android.systemui']]));
    expect(await r.resolve(1408)).to.equal('com.android.systemui');
  });

  it('caches, so repeated lookups do not re-run ps', async () => {
    let calls = 0;
    const r = new PackageResolver(async () => {
      calls += 1;
      return psOutput([[1408, 'com.android.systemui']]);
    });
    await r.resolve(1408);
    await r.resolve(1408);
    expect(calls).to.equal(1);
  });

  it('refreshes once on a miss, then gives up rather than guessing', async () => {
    let calls = 0;
    const r = new PackageResolver(async () => {
      calls += 1;
      return psOutput([[1408, 'com.android.systemui']]);
    });
    expect(await r.resolve(9999)).to.equal(undefined);
    expect(calls, 'one refresh attempt for the unknown pid').to.equal(1);
  });

  // The trap: pids are reused. Serving the previous process's name is worse
  // than serving nothing — it is silently plausible and sends someone
  // debugging the wrong app.
  it('does NOT serve a stale package after a pid is reused', async () => {
    let table: Array<[number, string]> = [[1408, 'com.old.app']];
    let clock = 0;
    const r = new PackageResolver(async () => psOutput(table), 10_000, () => clock);

    expect(await r.resolve(1408)).to.equal('com.old.app');

    table = [[1408, 'com.new.app']];
    clock += 10_001; // TTL expired

    expect(await r.resolve(1408)).to.equal('com.new.app');
  });

  it('drops an entry whose pid disappears on refresh', async () => {
    let table: Array<[number, string]> = [[1408, 'com.old.app']];
    let clock = 0;
    const r = new PackageResolver(async () => psOutput(table), 10_000, () => clock);

    expect(await r.resolve(1408)).to.equal('com.old.app');
    table = [[2000, 'com.other.app']];
    clock += 10_001;

    expect(await r.resolve(1408)).to.equal(undefined);
  });

  // Package resolution must never block or drop a log line.
  it('returns undefined when ps fails, without throwing', async () => {
    const r = new PackageResolver(async () => {
      throw new Error('device offline');
    });
    expect(await r.resolve(1408)).to.equal(undefined);
  });

  it('tolerates unparseable ps output', async () => {
    const r = new PackageResolver(async () => 'total nonsense\n');
    expect(await r.resolve(1408)).to.equal(undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx mocha test/unit/package-resolver.spec.ts
```

Expected: FAIL — `Cannot find module '../../src/services/logcat/PackageResolver'`.

- [ ] **Step 3: Write the implementation**

Create `src/services/logcat/PackageResolver.ts`:

```ts
/**
 * Resolves a logcat PID to the process that produced the line.
 *
 * logcat does not emit a package; Android Studio shows one by resolving the
 * pid separately. This does the same, at emit time, so the label reflects the
 * moment the line was produced.
 *
 * Correctness note: pids are reused when a process dies. A stale label is
 * WORSE than no label — it is silently plausible. So the whole table is
 * replaced on every refresh and entries whose pid is gone are dropped, rather
 * than merged forward.
 */
export const DEFAULT_TTL_MS = 10_000;

export class PackageResolver {
  private table = new Map<number, string>();
  private loadedAt = -Infinity;
  private inflight?: Promise<void>;

  constructor(
    private readonly runPs: () => Promise<string>,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async resolve(pid: number): Promise<string | undefined> {
    // Track whether THIS call already refreshed, rather than re-reading the
    // clock. Comparing `now() - loadedAt > 0` after a refresh is 0 under an
    // injected clock but a small positive under the real one, which would make
    // the refresh count non-deterministic between tests and production.
    const wasStale = this.now() - this.loadedAt > this.ttlMs;
    if (wasStale) await this.refresh();

    const hit = this.table.get(pid);
    if (hit) return hit;
    if (wasStale) return undefined; // already refreshed this call; genuinely unknown

    // Table was fresh but the pid is missing — the process may have started
    // since. Try exactly once more, then accept that it is unknown.
    await this.refresh();
    return this.table.get(pid);
  }

  private async refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const out = await this.runPs();
        this.table = parsePs(out);
        this.loadedAt = this.now();
      } catch {
        // Never let package resolution block or drop a log line. Keep whatever
        // table we had and try again after the TTL.
        this.loadedAt = this.now();
      } finally {
        this.inflight = undefined;
      }
    })();
    return this.inflight;
  }
}

/** `  PID NAME` rows from `ps -A -o PID,NAME`. Unparseable rows are skipped. */
function parsePs(out: string): Map<number, string> {
  const table = new Map<number, string>();
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\S+)\s*$/.exec(line);
    if (m) table.set(Number(m[1]), m[2]);
  }
  return table;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx mocha test/unit/package-resolver.spec.ts
```

Expected: PASS, 7 passing.

- [ ] **Step 5: Verify the pid-reuse test is not vacuous**

Temporarily change `this.table = parsePs(out);` to merge instead of replace:

```ts
for (const [k, v] of parsePs(out)) this.table.set(k, v);
```

Re-run. Expected: "drops an entry whose pid disappears on refresh" FAILS. Restore and confirm 7 passing.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/services/logcat/PackageResolver.ts test/unit/package-resolver.spec.ts
git commit -m "feat(logcat): pid to package resolution, reuse-safe"
```

---

### Task 4: Logcat stream service

**Files:**
- Create: `src/device-managers/android/LogcatStreamService.ts`
- Test: `test/unit/logcat-stream-service.spec.ts`

**Interfaces:**
- Consumes: `parseThreadtimeLine`, `LogcatRecord` (Task 1); `LogcatMultiplexer` (Task 2); `PackageResolver` (Task 3).
- Produces: `@Service() LogcatStreamService` with `start(udid: string): Promise<LogcatMultiplexer>`, `stop(udid: string): Promise<void>`, `getMultiplexer(udid: string): LogcatMultiplexer | undefined`, and `IDLE_TIMEOUT_MS = 30_000`. Task 5 calls `start`.

Constructor takes injectable seams so the test never spawns a real process:

```ts
constructor(
  spawnLogcat: (udid: string) => Promise<ChildProcessLike> = defaultSpawnLogcat,
  makeResolver: (udid: string) => PackageResolver = defaultResolver,
)
```

where `ChildProcessLike = { stdout: NodeJS.ReadableStream | null; on(ev: 'close' | 'error', cb: (arg?: unknown) => void): void; kill(): void }`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/logcat-stream-service.spec.ts`:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import { PassThrough } from 'stream';
import { LogcatStreamService } from '../../src/device-managers/android/LogcatStreamService';
import { PackageResolver } from '../../src/services/logcat/PackageResolver';
import type { LogcatRecord } from '../../src/services/logcat/logcatParse';

function fakeProc() {
  const stdout = new PassThrough();
  const handlers: Record<string, ((a?: unknown) => void)[]> = {};
  let killed = false;
  return {
    stdout,
    killed: () => killed,
    on(ev: string, cb: (a?: unknown) => void) {
      (handlers[ev] ||= []).push(cb);
    },
    emit(ev: string, a?: unknown) {
      (handlers[ev] || []).forEach((h) => h(a));
    },
    kill() {
      killed = true;
    },
  };
}

const wait = () => new Promise((r) => setImmediate(r));

describe('LogcatStreamService', () => {
  it('parses stdout lines into records and pushes them to the mux', async () => {
    const proc = fakeProc();
    const svc = new LogcatStreamService(
      async () => proc as any,
      () => new PackageResolver(async () => ''),
    );
    const mux = await svc.start('DEV-1');
    const seen: LogcatRecord[] = [];
    mux.addClient((r) => seen.push(r), () => true);

    proc.stdout.write('08-09 16:11:00.005  1408  1408 D Tag: hello\n');
    await wait();

    expect(seen.map((r) => r.message)).to.deep.equal(['hello']);
    await svc.stop('DEV-1');
  });

  // A wrapped message must not be lost, and must not become its own record.
  it('appends a continuation line to the previous record', async () => {
    const proc = fakeProc();
    const svc = new LogcatStreamService(
      async () => proc as any,
      () => new PackageResolver(async () => ''),
    );
    const mux = await svc.start('DEV-1');
    const seen: LogcatRecord[] = [];
    mux.addClient((r) => seen.push(r), () => true);

    proc.stdout.write('08-09 16:11:00.005  1408  1408 D Tag: first\n');
    proc.stdout.write('   wrapped remainder\n');
    proc.stdout.write('08-09 16:11:00.006  1408  1408 D Tag: second\n');
    await wait();

    expect(seen).to.have.length(2);
    expect(seen[0].message).to.contain('wrapped remainder');
    expect(seen[1].message).to.equal('second');
    await svc.stop('DEV-1');
  });

  it('attaches the resolved package', async () => {
    const proc = fakeProc();
    const svc = new LogcatStreamService(
      async () => proc as any,
      () => new PackageResolver(async () => '  PID NAME\n 1408 com.android.systemui'),
    );
    const mux = await svc.start('DEV-1');
    const seen: LogcatRecord[] = [];
    mux.addClient((r) => seen.push(r), () => true);

    proc.stdout.write('08-09 16:11:00.005  1408  1408 D Tag: hello\n');
    await wait();
    await wait();

    expect(seen[0].pkg).to.equal('com.android.systemui');
    await svc.stop('DEV-1');
  });

  it('reuses one process for concurrent starts on the same udid', async () => {
    let spawns = 0;
    const proc = fakeProc();
    const svc = new LogcatStreamService(
      async () => {
        spawns += 1;
        return proc as any;
      },
      () => new PackageResolver(async () => ''),
    );
    const [a, b] = await Promise.all([svc.start('DEV-1'), svc.start('DEV-1')]);
    expect(spawns).to.equal(1);
    expect(a).to.equal(b);
    await svc.stop('DEV-1');
  });

  it('emits a synthetic end-of-stream record when the process exits', async () => {
    const proc = fakeProc();
    const svc = new LogcatStreamService(
      async () => proc as any,
      () => new PackageResolver(async () => ''),
    );
    const mux = await svc.start('DEV-1');
    const seen: LogcatRecord[] = [];
    mux.addClient((r) => seen.push(r), () => true);

    proc.emit('close');
    await wait();

    const end = seen.find((r) => r.synthetic);
    expect(end, 'an end-of-stream record must be emitted').to.not.equal(undefined);
    expect(end!.level).to.equal('E');
    expect(end!.message.toLowerCase()).to.contain('ended');
    // The session is dropped so the next viewer starts clean.
    expect(svc.getMultiplexer('DEV-1')).to.equal(undefined);
  });

  it('kills the process on stop and forgets the session', async () => {
    const proc = fakeProc();
    const svc = new LogcatStreamService(
      async () => proc as any,
      () => new PackageResolver(async () => ''),
    );
    await svc.start('DEV-1');
    await svc.stop('DEV-1');
    expect(proc.killed()).to.equal(true);
    expect(svc.getMultiplexer('DEV-1')).to.equal(undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx mocha test/unit/logcat-stream-service.spec.ts
```

Expected: FAIL — `Cannot find module '../../src/device-managers/android/LogcatStreamService'`.

- [ ] **Step 3: Write the implementation**

Create `src/device-managers/android/LogcatStreamService.ts`:

```ts
import { Service, Container } from 'typedi';
import { spawn } from 'child_process';
import readline from 'readline';
import log from '../../logger';
import { LogcatMultiplexer } from './LogcatMultiplexer';
import { PackageResolver } from '../../services/logcat/PackageResolver';
import { parseThreadtimeLine, type LogcatRecord } from '../../services/logcat/logcatParse';
import { AndroidDeviceManager } from '../AndroidDeviceManager';

export const IDLE_TIMEOUT_MS = 30_000;

export interface ChildProcessLike {
  stdout: NodeJS.ReadableStream | null;
  on(ev: 'close' | 'error', cb: (arg?: unknown) => void): void;
  kill(): void;
}

interface Session {
  mux: LogcatMultiplexer;
  proc: ChildProcessLike;
  resolver: PackageResolver;
  emptyAt?: number;
  /** The record a continuation line appends to. */
  last?: LogcatRecord;
}

/** Resolve adb the same way ScrcpyServerSession does — never a bare `adb`. */
async function adbFor(udid: string): Promise<{ path: string; base: string[] }> {
  const adb: any = await Container.get(AndroidDeviceManager).getAdbForDevice(udid);
  if (!adb?.executable?.path) throw new Error(`[${udid}] adb executable path not resolved`);
  const host = adb?.adbHost && adb?.adbPort ? ['-H', adb.adbHost, '-P', String(adb.adbPort)] : [];
  return { path: adb.executable.path, base: [...host, '-s', udid] };
}

async function defaultSpawnLogcat(udid: string): Promise<ChildProcessLike> {
  const { path, base } = await adbFor(udid);
  const proc = spawn(path, [...base, 'logcat', '-v', 'threadtime']);
  // A ChildProcess emitting 'error' with zero listeners crashes the process —
  // always have one (same guard as ScrcpyServerSession).
  proc.on('error', (e) => log.warn(`[${udid}] logcat process error: ${e.message}`));
  proc.stderr?.on('data', (d: Buffer) => log.debug(`[${udid}] logcat: ${d.toString().trim()}`));
  return proc as unknown as ChildProcessLike;
}

function defaultResolver(udid: string): PackageResolver {
  return new PackageResolver(async () => {
    const { path, base } = await adbFor(udid);
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const run = promisify(execFile);
    const { stdout } = await run(path, [...base, 'shell', 'ps', '-A', '-o', 'PID,NAME']);
    return stdout;
  });
}

@Service()
export class LogcatStreamService {
  private sessions = new Map<string, Session>();
  private startPromises = new Map<string, Promise<LogcatMultiplexer>>();

  constructor(
    private readonly spawnLogcat: (udid: string) => Promise<ChildProcessLike> = defaultSpawnLogcat,
    private readonly makeResolver: (udid: string) => PackageResolver = defaultResolver,
  ) {
    this.startWatchdog();
  }

  private startWatchdog() {
    setInterval(() => {
      const now = Date.now();
      for (const [udid, s] of this.sessions.entries()) {
        if (s.mux.clientCount > 0) {
          s.emptyAt = undefined;
        } else if (s.emptyAt === undefined) {
          s.emptyAt = now;
        } else if (now - s.emptyAt > IDLE_TIMEOUT_MS) {
          log.info(`[${udid}] Stopping idle logcat stream (no viewers for ${IDLE_TIMEOUT_MS}ms)`);
          this.stop(udid);
        }
      }
    }, 10_000);
  }

  getMultiplexer(udid: string): LogcatMultiplexer | undefined {
    return this.sessions.get(udid)?.mux;
  }

  async start(udid: string): Promise<LogcatMultiplexer> {
    const inflight = this.startPromises.get(udid);
    if (inflight) return inflight;
    const existing = this.sessions.get(udid);
    if (existing) return existing.mux;

    const promise = (async () => {
      const mux = new LogcatMultiplexer();
      const proc = await this.spawnLogcat(udid);
      const resolver = this.makeResolver(udid);
      const session: Session = { mux, proc, resolver };
      this.sessions.set(udid, session);

      if (proc.stdout) {
        const rl = readline.createInterface({ input: proc.stdout });
        rl.on('line', (line: string) => this.onLine(session, line));
      }

      const end = (reason: string) => {
        mux.push({
          ts: Date.now(),
          pid: 0,
          tid: 0,
          level: 'E',
          tag: 'xenon',
          message: `log stream ended (${reason})`,
          synthetic: true,
        });
        // Drop the session so the next viewer starts a fresh process.
        this.sessions.delete(udid);
      };
      proc.on('close', () => end('process exited'));
      proc.on('error', () => end('process error'));

      return mux;
    })();

    this.startPromises.set(udid, promise);
    try {
      return await promise;
    } finally {
      this.startPromises.delete(udid);
    }
  }

  private onLine(session: Session, line: string): void {
    const rec = parseThreadtimeLine(line);
    if (!rec) {
      // Continuation of the previous message. Banners and noise arrive here
      // too; appending them to the last record is harmless and keeps wrapped
      // messages whole, which is what a reader needs.
      if (session.last && line.trim().length > 0 && !line.startsWith('---------')) {
        session.last.message += `\n${line.trim()}`;
      }
      return;
    }
    session.last = rec;
    // Resolve the package without blocking the line: push immediately, and let
    // the resolver fill pkg in before the record is serialised for the wire.
    session.resolver
      .resolve(rec.pid)
      .then((pkg) => {
        if (pkg) rec.pkg = pkg;
      })
      .catch(() => undefined)
      .finally(() => session.mux.push(rec));
  }

  async stop(udid: string): Promise<void> {
    const s = this.sessions.get(udid);
    if (!s) return;
    this.sessions.delete(udid);
    try {
      s.proc.kill();
    } catch {
      /* best-effort */
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx mocha test/unit/logcat-stream-service.spec.ts
```

Expected: PASS, 6 passing.

If the continuation test fails because the record is pushed before the continuation arrives, that is a real ordering problem, not a test bug — the record is pushed asynchronously after package resolution, so a continuation line can land first. Fix it by buffering the record until the next parsed line or a short flush, and say so in your report. Do not weaken the test.

- [ ] **Step 5: Verify the tests are not vacuous**

Temporarily change `proc.on('close', () => end('process exited'));` to a no-op. Re-run. Expected: the end-of-stream test FAILS. Restore and confirm 6 passing.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/device-managers/android/LogcatStreamService.ts test/unit/logcat-stream-service.spec.ts
git commit -m "feat(logcat): per-device logcat process with parse, package and watchdog"
```

---

### Task 5: WebSocket endpoint with ticket + ownership

**Files:**
- Create: `src/app/ws/logcatWs.ts`
- Modify: `src/services/ServerManager.ts` (beside the existing `attachH264Ws` block, ~line 87)
- Test: `test/unit/logcat-ws.spec.ts`

**Interfaces:**
- Consumes: `LogcatMultiplexer` (Task 2), `LogcatStreamService.start` (Task 4).
- Produces: `attachLogcatWs(server, deps)` and `parseLogcatWsPath(url): { udid, ticket } | null`.

Deps shape:

```ts
export interface LogcatWsDeps {
  redeem: (ticket: string, udid: string) => Promise<{ actorId: string }>;
  /** Resolve the ownership decision for this actor + device. Throws on lookup failure. */
  authorize: (udid: string, actorId: string) => Promise<boolean>;
  startStream: (udid: string) => Promise<LogcatMultiplexer>;
  maxBufferedBytes?: number;
}
```

- [ ] **Step 1: Write the failing test**

Create `test/unit/logcat-ws.spec.ts`:

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import { parseLogcatWsPath } from '../../src/app/ws/logcatWs';

describe('parseLogcatWsPath', () => {
  it('extracts udid and ticket from the logcat path', () => {
    const p = parseLogcatWsPath('/xenon/api/control/DEV-1/logcat?ticket=abc');
    expect(p).to.deep.equal({ udid: 'DEV-1', ticket: 'abc' });
  });

  it('url-decodes the udid', () => {
    const p = parseLogcatWsPath('/xenon/api/control/A%2FB/logcat?ticket=t');
    expect(p!.udid).to.equal('A/B');
  });

  it('returns null without a ticket, so the upgrade is left alone', () => {
    expect(parseLogcatWsPath('/xenon/api/control/DEV-1/logcat')).to.equal(null);
  });

  it('does not claim the h264 path', () => {
    expect(parseLogcatWsPath('/xenon/api/control/DEV-1/stream/h264?ticket=t')).to.equal(null);
  });

  it('does not claim an unrelated path', () => {
    expect(parseLogcatWsPath('/socket.io/?EIO=4')).to.equal(null);
  });
});
```

Then, in the same file, the handshake itself. Path parsing alone would leave
the security boundary untested — this drives a real HTTP server and a real
client socket:

```ts
import http from 'http';
import WebSocket from 'ws';
import { attachLogcatWs } from '../../src/app/ws/logcatWs';
import { LogcatMultiplexer } from '../../src/device-managers/android/LogcatMultiplexer';

interface Harness {
  port: number;
  close: () => Promise<void>;
  mux: LogcatMultiplexer;
  startCalls: number;
}

async function harness(over: {
  redeem?: () => Promise<{ actorId: string }>;
  authorize?: () => Promise<boolean>;
}): Promise<Harness> {
  const mux = new LogcatMultiplexer();
  const state = { startCalls: 0 };
  const server = http.createServer();
  attachLogcatWs(server, {
    redeem: over.redeem ?? (async () => ({ actorId: 'usr_alice' })),
    authorize: over.authorize ?? (async () => true),
    startStream: async () => {
      state.startCalls += 1;
      return mux;
    },
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as import('net').AddressInfo).port;
  return {
    port,
    mux,
    get startCalls() {
      return state.startCalls;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  } as Harness;
}

/** Resolves with the close code, or 'open' if the socket stays up. */
const connect = (port: number, ticket = 'tok') =>
  new Promise<number | 'open'>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/xenon/api/control/DEV-1/logcat?ticket=${ticket}`);
    ws.on('close', (code) => resolve(code));
    ws.on('open', () => setTimeout(() => resolve('open'), 150));
  });

describe('attachLogcatWs handshake', () => {
  it('accepts a valid ticket for a device the caller may use', async () => {
    const h = await harness({});
    expect(await connect(h.port)).to.equal('open');
    await h.close();
  });

  it('closes 1008 when the ticket cannot be redeemed', async () => {
    const h = await harness({
      redeem: async () => {
        throw new Error('bad ticket');
      },
    });
    expect(await connect(h.port)).to.equal(1008);
    await h.close();
  });

  // Device logs carry tokens and PII, so they are an ownership-checked read.
  it('closes 1008 when the device is held by another user', async () => {
    const h = await harness({ authorize: async () => false });
    expect(await connect(h.port)).to.equal(1008);
    expect(h.startCalls, 'must not start a logcat process for a refused caller').to.equal(0);
    await h.close();
  });

  it('closes 1011 when ownership cannot be determined', async () => {
    const h = await harness({
      authorize: async () => {
        throw new Error('store down');
      },
    });
    expect(await connect(h.port)).to.equal(1011);
    await h.close();
  });

  it('forwards records to a connected client', async () => {
    const h = await harness({});
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}/xenon/api/control/DEV-1/logcat?ticket=t`);
    const got: any[] = [];
    ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.on('open', r));
    h.mux.push({ ts: 1, pid: 1, tid: 1, level: 'D', tag: 'T', message: 'hello' });
    await new Promise((r) => setTimeout(r, 100));
    expect(got.map((r) => r.message)).to.deep.equal(['hello']);
    ws.close();
    await h.close();
  });

  // The trap documented in h264StreamWs: without cleanup registered before the
  // awaits, clientCount stays inflated and the idle watchdog never fires.
  it('leaves no client registered when the socket drops mid-handshake', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const h = await harness({
      redeem: async () => {
        await gate;
        return { actorId: 'usr_alice' };
      },
    });
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}/xenon/api/control/DEV-1/logcat?ticket=t`);
    await new Promise((r) => setTimeout(r, 50));
    ws.terminate(); // disconnect while redeem is still pending
    release();
    await new Promise((r) => setTimeout(r, 150));
    expect(h.mux.clientCount).to.equal(0);
    await h.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx mocha test/unit/logcat-ws.spec.ts
```

Expected: FAIL — `Cannot find module '../../src/app/ws/logcatWs'`.

- [ ] **Step 3: Write the implementation**

Create `src/app/ws/logcatWs.ts`. Read `src/app/ws/h264StreamWs.ts` first and mirror its structure exactly — especially registering `onClose` **before** the awaits.

```ts
import type { Server } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import log from '../../logger';
import type { LogcatMultiplexer } from '../../device-managers/android/LogcatMultiplexer';

const PATH = /^\/xenon\/api\/control\/([^/]+)\/logcat(?:\?|$)/;

export function parseLogcatWsPath(url: string): { udid: string; ticket: string } | null {
  const m = PATH.exec(url);
  if (!m) return null;
  const q = url.indexOf('?');
  const ticket = q < 0 ? null : new URLSearchParams(url.slice(q + 1)).get('ticket');
  if (!ticket) return null;
  return { udid: decodeURIComponent(m[1]), ticket };
}

export interface LogcatWsDeps {
  redeem: (ticket: string, udid: string) => Promise<{ actorId: string }>;
  authorize: (udid: string, actorId: string) => Promise<boolean>;
  startStream: (udid: string) => Promise<LogcatMultiplexer>;
  maxBufferedBytes?: number;
}

/**
 * Attach the logcat WebSocket upgrade handler. Only claims
 * `/xenon/api/control/:udid/logcat` — other upgrades (socket.io, the h264
 * stream) are left for their own listeners.
 *
 * Unlike the h264 stream, this also checks device ownership after redeeming
 * the ticket: device logs routinely carry auth tokens and PII, so they are
 * treated as an ownership-checked read rather than an open one.
 */
export function attachLogcatWs(server: Server, deps: LogcatWsDeps): void {
  const wss = new WebSocketServer({ noServer: true });
  const maxBuffered = deps.maxBufferedBytes ?? 4 * 1024 * 1024;

  server.on('upgrade', (req, socket, head) => {
    const parsed = req.url ? parseLogcatWsPath(req.url) : null;
    if (!parsed) return; // not our path

    wss.handleUpgrade(req, socket as any, head, async (ws: WebSocket) => {
      // Register cleanup BEFORE the awaits: redeem/authorize/start can take
      // seconds, and a client that disconnects in that window must still be
      // removed, or clientCount stays inflated and the watchdog never stops
      // the process. Same trap as h264StreamWs.
      let closed = false;
      let cleanup: () => void = () => undefined;
      const onClose = () => {
        closed = true;
        cleanup();
      };
      ws.on('close', onClose);
      ws.on('error', onClose);

      let actorId: string;
      try {
        ({ actorId } = await deps.redeem(parsed.ticket, parsed.udid));
      } catch {
        try {
          ws.close(1008, 'unauthorized');
        } catch {
          /* noop */
        }
        return;
      }
      if (closed) return;

      try {
        if (!(await deps.authorize(parsed.udid, actorId))) {
          ws.close(1008, 'device held by another user');
          return;
        }
      } catch (e: any) {
        // Ownership could not be determined — fail closed, as the REST guard does.
        log.warn(`[${parsed.udid}] logcat WS authorize failed: ${e?.message ?? e}`);
        try {
          ws.close(1011, 'ownership unavailable');
        } catch {
          /* noop */
        }
        return;
      }
      if (closed) return;

      let mux: LogcatMultiplexer;
      try {
        mux = await deps.startStream(parsed.udid);
      } catch (e: any) {
        log.warn(`[${parsed.udid}] logcat WS start failed: ${e?.message ?? e}`);
        try {
          ws.close(1011, 'stream failed');
        } catch {
          /* noop */
        }
        return;
      }
      if (closed) return;

      cleanup = mux.addClient(
        (r) => {
          try {
            ws.send(JSON.stringify(r));
          } catch {
            /* socket went away between the check and the send */
          }
        },
        () => ws.bufferedAmount < maxBuffered,
      );
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx mocha test/unit/logcat-ws.spec.ts
```

Expected: PASS, 11 passing (5 path + 6 handshake).

- [ ] **Step 4b: Verify the ownership test is not vacuous**

Temporarily change the authorize check to `if (false && !(await deps.authorize(...)))`. Re-run. Expected: "closes 1008 when the device is held by another user" FAILS. Restore and confirm 11 passing. This is the security boundary — a guard that passes whether or not it runs is worthless.

- [ ] **Step 5: Mount it**

In `src/services/ServerManager.ts`, directly after the existing `attachH264Ws({...})` block (~line 87), add:

```ts
      attachLogcatWs(httpServer, {
        redeem: (ticket, udid) => Container.get(StreamTicketService).redeem(ticket, udid),
        authorize: async (udid, actorId) => {
          const device = await DeviceStoreFactory.getStore().findDevice({ udid });
          if (!device) return true; // unknown device: the stream start will fail on its own
          const sessionOwner =
            device.busy && device.session_id && !isManualLock(device.session_id)
              ? await Container.get(SessionOwnerResolver).ownerOf(device.session_id)
              : null;
          return evaluateDeviceAccess({
            udid,
            busy: !!device.busy,
            sessionId: device.session_id,
            sessionOwnerUserId: sessionOwner,
            actorUserId: actorId,
            isAdmin: false,
          }).allow;
        },
        startStream: (udid) => Container.get(LogcatStreamService).start(udid),
      });
```

with the matching imports at the top of the file:

```ts
import { attachLogcatWs } from '../app/ws/logcatWs';
import { LogcatStreamService } from '../device-managers/android/LogcatStreamService';
import { DeviceStoreFactory } from '../data-service/device-store';
import { isManualLock } from './recording/manualLock';
import { SessionOwnerResolver } from './device-access/SessionOwnerResolver';
import { evaluateDeviceAccess } from './device-access/deviceAccessPolicy';
```

Note `isAdmin: false`: a stream ticket carries a userId, not a role. An admin holding their own device still passes via the self-lock branch; an admin wanting to watch **another** user's device over WS is not supported in this task. Say so in your report rather than inventing a role lookup.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/ws/logcatWs.ts src/services/ServerManager.ts test/unit/logcat-ws.spec.ts
git commit -m "feat(logcat): ticket- and ownership-authenticated WebSocket endpoint"
```

---

### Task 6: Pure client-side filter

**Files:**
- Create: `web/src/components/device-control/logcat/logcatFilter.ts`
- Test: `web/src/components/device-control/logcat/logcatFilter.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LEVEL_ORDER`, `parseQuery(q: string): LogcatQuery`, `matches(r: LogRecordLike, q: LogcatQuery): boolean`, and the local type `LogRecordLike = { level: string; tag: string; message: string; pkg?: string }`. Task 7 imports these.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/device-control/logcat/logcatFilter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { matches, parseQuery } from './logcatFilter';

const rec = (over: Partial<Parameters<typeof matches>[0]> = {}) => ({
  level: 'D',
  tag: 'Tile.WifiTile',
  message: 'handleUpdateState isTransient=false',
  pkg: 'com.android.systemui',
  ...over,
});

describe('logcat filter', () => {
  it('matches everything on an empty query', () => {
    expect(matches(rec(), parseQuery(''))).toBe(true);
    expect(matches(rec(), parseQuery('   '))).toBe(true);
  });

  it('filters by minimum level', () => {
    const q = parseQuery('level:W');
    expect(matches(rec({ level: 'E' }), q)).toBe(true);
    expect(matches(rec({ level: 'W' }), q)).toBe(true);
    expect(matches(rec({ level: 'D' }), q)).toBe(false);
  });

  it('filters by tag substring, case-insensitively', () => {
    expect(matches(rec(), parseQuery('tag:wifi'))).toBe(true);
    expect(matches(rec(), parseQuery('tag:bluetooth'))).toBe(false);
  });

  it('filters by package substring', () => {
    expect(matches(rec(), parseQuery('package:systemui'))).toBe(true);
    expect(matches(rec(), parseQuery('package:com.example'))).toBe(false);
  });

  it('treats a record with no package as not matching a package term', () => {
    expect(matches(rec({ pkg: undefined }), parseQuery('package:systemui'))).toBe(false);
  });

  it('matches bare text against the message', () => {
    expect(matches(rec(), parseQuery('isTransient'))).toBe(true);
    expect(matches(rec(), parseQuery('nonsense'))).toBe(false);
  });

  it('ANDs all terms together', () => {
    const q = parseQuery('level:D tag:wifi handleUpdate');
    expect(matches(rec(), q)).toBe(true);
    expect(matches(rec({ tag: 'Other' }), q)).toBe(false);
    expect(matches(rec({ message: 'something else' }), q)).toBe(false);
  });

  it('joins multiple bare words into one message term', () => {
    expect(matches(rec(), parseQuery('handleUpdateState isTransient'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run src/components/device-control/logcat/logcatFilter.test.ts
```

Expected: FAIL — cannot resolve `./logcatFilter`.

- [ ] **Step 3: Write the implementation**

Create `web/src/components/device-control/logcat/logcatFilter.ts`:

```ts
/**
 * Client-side log filtering.
 *
 * Deliberately not server-side: one logcat process serves every viewer of a
 * device, so pushing a level down to logcat's own `*:D` spec would silently
 * change what other viewers see.
 */
export const LEVEL_ORDER = ['V', 'D', 'I', 'W', 'E', 'F'] as const;

export interface LogRecordLike {
  level: string;
  tag: string;
  message: string;
  pkg?: string;
}

export interface LogcatQuery {
  minLevel?: string;
  tag?: string;
  pkg?: string;
  text?: string;
}

export function parseQuery(raw: string): LogcatQuery {
  const q: LogcatQuery = {};
  const words: string[] = [];
  for (const token of raw.trim().split(/\s+/).filter(Boolean)) {
    const [key, ...rest] = token.split(':');
    const value = rest.join(':');
    if (value && key.toLowerCase() === 'level') q.minLevel = value.toUpperCase();
    else if (value && key.toLowerCase() === 'tag') q.tag = value.toLowerCase();
    else if (value && key.toLowerCase() === 'package') q.pkg = value.toLowerCase();
    else words.push(token);
  }
  if (words.length) q.text = words.join(' ').toLowerCase();
  return q;
}

export function matches(r: LogRecordLike, q: LogcatQuery): boolean {
  if (q.minLevel) {
    const want = LEVEL_ORDER.indexOf(q.minLevel as (typeof LEVEL_ORDER)[number]);
    const have = LEVEL_ORDER.indexOf(r.level as (typeof LEVEL_ORDER)[number]);
    if (want >= 0 && have >= 0 && have < want) return false;
  }
  if (q.tag && !r.tag.toLowerCase().includes(q.tag)) return false;
  if (q.pkg && !(r.pkg ?? '').toLowerCase().includes(q.pkg)) return false;
  if (q.text && !r.message.toLowerCase().includes(q.text)) return false;
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && npx vitest run src/components/device-control/logcat/logcatFilter.test.ts
```

Expected: PASS, 8 passing.

- [ ] **Step 5: Verify the tests are not vacuous**

Temporarily change `if (have < want) return false;` to `if (false) return false;`. Re-run. Expected: the level test FAILS. Restore and confirm 8 passing.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/device-control/logcat/logcatFilter.ts web/src/components/device-control/logcat/logcatFilter.test.ts
git commit -m "feat(web): pure logcat filter query"
```

---

### Task 7: Stream hook, view, and cutover

**Files:**
- Create: `web/src/components/device-control/logcat/useLogcatStream.ts`
- Create: `web/src/components/device-control/logcat/LogcatView.tsx`
- Create: `web/src/components/device-control/logcat/logcat.css`
- Modify: `web/src/components/device-control/device-control.tsx`

**Interfaces:**
- Consumes: `parseQuery`, `matches`, `LogRecordLike` (Task 6); the wire records produced by Task 5.
- Produces: `<LogcatView udid={string} platform={string} />`.

- [ ] **Step 1: Write the hook**

Create `web/src/components/device-control/logcat/useLogcatStream.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

export interface LogcatRecord {
  ts: number;
  pid: number;
  tid: number;
  level: string;
  tag: string;
  message: string;
  pkg?: string;
  synthetic?: boolean;
}

const CLIENT_BUFFER = 5000;
const BACKOFF_START_MS = 500;
const BACKOFF_MAX_MS = 10_000;
const MAX_ATTEMPTS = 10;

/**
 * Opens the logcat WebSocket for a device: mint a single-use ticket, connect,
 * keep a bounded buffer. Reconnects with bounded backoff — an unbounded retry
 * loop against a dead device wedges the lab (same reason UniversalMjpegProxy
 * caps its retries).
 */
export function useLogcatStream(udid: string, enabled: boolean) {
  const [records, setRecords] = useState<LogcatRecord[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const attemptsRef = useRef(0);
  const cancelledRef = useRef(false);

  const clear = useCallback(() => setRecords([]), []);

  useEffect(() => {
    if (!enabled) return;
    cancelledRef.current = false;
    let timer: number | undefined;

    const connect = async () => {
      if (cancelledRef.current) return;
      try {
        const res = await fetch(`/xenon/api/control/${encodeURIComponent(udid)}/stream/ticket`, {
          method: 'POST',
          credentials: 'include',
        });
        const { ticket } = await res.json();
        if (cancelledRef.current || !ticket) return;

        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(
          `${proto}://${window.location.host}/xenon/api/control/${encodeURIComponent(
            udid,
          )}/logcat?ticket=${encodeURIComponent(ticket)}`,
        );
        wsRef.current = ws;

        ws.onopen = () => {
          attemptsRef.current = 0;
          setConnected(true);
        };
        ws.onmessage = (e) => {
          try {
            const r: LogcatRecord = JSON.parse(e.data);
            setRecords((prev) => {
              const next = prev.length >= CLIENT_BUFFER ? prev.slice(-(CLIENT_BUFFER - 1)) : prev;
              return [...next, r];
            });
          } catch {
            /* ignore a malformed frame rather than tearing down the stream */
          }
        };
        ws.onclose = () => {
          setConnected(false);
          scheduleRetry();
        };
        ws.onerror = () => ws.close();
      } catch {
        scheduleRetry();
      }
    };

    const scheduleRetry = () => {
      if (cancelledRef.current) return;
      if (attemptsRef.current >= MAX_ATTEMPTS) return;
      const delay = Math.min(BACKOFF_START_MS * 2 ** attemptsRef.current, BACKOFF_MAX_MS);
      attemptsRef.current += 1;
      timer = window.setTimeout(connect, delay);
    };

    connect();
    return () => {
      cancelledRef.current = true;
      if (timer) window.clearTimeout(timer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [udid, enabled]);

  return { records, connected, clear };
}
```

- [ ] **Step 2: Write the view**

Create `web/src/components/device-control/logcat/LogcatView.tsx`:

```tsx
import * as React from 'react';
import { useMemo, useRef, useState, useEffect } from 'react';
import { Download, Trash2, Wifi } from 'lucide-react';
import { Select } from '../../ui/select';
import { useLogcatStream } from './useLogcatStream';
import { matches, parseQuery, LEVEL_ORDER } from './logcatFilter';
import './logcat.css';

interface Props {
  udid: string;
  platform?: string;
}

export default function LogcatView({ udid, platform }: Props) {
  const isAndroid = (platform || '').toLowerCase() === 'android';
  const { records, connected, clear } = useLogcatStream(udid, isAndroid);
  const [query, setQuery] = useState('');
  const [minLevel, setMinLevel] = useState('');
  const [following, setFollowing] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  const effectiveQuery = useMemo(
    () => parseQuery(minLevel ? `level:${minLevel} ${query}` : query),
    [minLevel, query],
  );
  const visible = useMemo(
    () => records.filter((r) => matches(r, effectiveQuery)),
    [records, effectiveQuery],
  );

  useEffect(() => {
    if (following) endRef.current?.scrollIntoView({ block: 'end' });
  }, [visible.length, following]);

  if (!isAndroid) {
    return (
      <div className="log-empty-state">
        <p className="log-empty-title">Live logs are Android only</p>
        <p className="log-empty-subtitle">
          logcat streaming is not available for this device&apos;s platform.
        </p>
      </div>
    );
  }

  return (
    <div className="logcat-root">
      <div className="log-toolbar">
        <div className="log-filter-group">
          <div className="log-stat-pill">
            <span className={`log-live-dot ${connected ? 'active' : ''}`} />
            {connected ? 'LIVE' : 'CONNECTING'}
          </div>
          <div className="log-stat-pill logcat-count">
            {visible.length} / {records.length}
          </div>
          <Select
            selectSize="sm"
            value={minLevel}
            onChange={(e) => setMinLevel(e.target.value)}
            aria-label="Minimum log level"
          >
            <option value="">All levels</option>
            {LEVEL_ORDER.map((l) => (
              <option key={l} value={l}>
                {l} and above
              </option>
            ))}
          </Select>
          <input
            type="text"
            className="type-input-field tiny logcat-query"
            placeholder="tag:Wifi package:com.android.systemui free text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter logs"
          />
        </div>
        <div className="log-actions-group">
          <button
            className={`btn-secondary btn-sm ${following ? 'active' : ''}`}
            onClick={() => setFollowing(!following)}
          >
            <Wifi size={14} /> {following ? 'FREEZE' : 'FOLLOW'}
          </button>
          <button
            className="btn-premium btn-sm"
            disabled={visible.length === 0}
            onClick={() => {
              const text = visible
                .map((r) => `${new Date(r.ts).toISOString()} ${r.pid} ${r.level}/${r.tag}: ${r.message}`)
                .join('\n');
              const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
              const a = document.createElement('a');
              a.href = url;
              a.download = `logcat-${udid}-${Date.now()}.txt`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download size={14} /> EXPORT
          </button>
          <button className="btn-secondary btn-sm" onClick={clear}>
            <Trash2 size={14} /> CLEAR
          </button>
        </div>
      </div>

      <div className="logcat-rows">
        {visible.map((r, i) => (
          <div className={`logcat-row ${r.synthetic ? 'is-synthetic' : ''}`} key={i}>
            <span className="logcat-time">
              {new Date(r.ts).toLocaleTimeString([], { hour12: false })}
            </span>
            <span className="logcat-pid">
              {r.pid}-{r.tid}
            </span>
            <span className="logcat-pkg" title={r.pkg}>
              {r.pkg ?? ''}
            </span>
            <span className={`logcat-level lvl-${r.level}`}>{r.level}</span>
            <span className="logcat-tag" title={r.tag}>
              {r.tag}
            </span>
            <span className="logcat-msg">{r.message}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write the styles**

Create `web/src/components/device-control/logcat/logcat.css`:

```css
.logcat-root {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.logcat-query {
  flex: 1;
  min-width: 160px;
}

.logcat-count {
  opacity: 0.6;
}

.logcat-rows {
  flex: 1;
  overflow-y: auto;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11.5px;
  line-height: 1.6;
  padding: 8px 12px;
}

.logcat-row {
  display: grid;
  grid-template-columns: 68px 84px 150px 18px 150px 1fr;
  gap: 10px;
  align-items: baseline;
}

.logcat-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.logcat-time,
.logcat-pid,
.logcat-pkg,
.logcat-tag {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.logcat-tag {
  color: #7dd3fc;
}

/* Message wraps; every other column is fixed so the grid stays aligned. */
.logcat-msg {
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}

.logcat-level {
  font-weight: 700;
  text-align: center;
  border-radius: 3px;
}

.lvl-V,
.lvl-D {
  color: var(--text-muted);
}
.lvl-I {
  color: var(--green);
}
.lvl-W {
  color: #fbbf24;
}
.lvl-E,
.lvl-F {
  color: #f87171;
}

/* Records Xenon injected (drops, end-of-stream) — visibly not device output. */
.logcat-row.is-synthetic .logcat-msg {
  color: #fbbf24;
  font-style: italic;
}
```

- [ ] **Step 4: Cut the tab over**

In `web/src/components/device-control/device-control.tsx`:

1. Add the import beside the other component imports:

```ts
import LogcatView from './logcat/LogcatView';
```

2. Delete the log polling `useEffect` (currently `device-control.tsx:108-158`), the `renderLogLines` function (`:160`–the end of that function), and the auto-scroll effect that references `deviceLogs` (`:217-220`).

3. Delete these state declarations: `deviceLogs`, `isFollowing`, `logFilter`, `logStreamActive`, `logPollCount`, and the `logContainerRef` if nothing else uses it. Verify with `grep -n "deviceLogs\|logStreamActive\|logPollCount\|logFilter\|isFollowing\|logContainerRef" web/src/components/device-control/device-control.tsx` — the only remaining hits should be none.

4. Replace the whole `{activeTab === 'logs' && ( … )}` block with:

```tsx
              {activeTab === 'logs' && (
                <div className="action-card screenshot-card logcat-card">
                  <LogcatView udid={currentDevice.udid} platform={currentDevice.platform} />
                </div>
              )}
```

5. Remove any imports that are now unused (`Wifi`, `Search`, `Download` and `Terminal as TerminalIcon` may still be used elsewhere — check each with grep before deleting; `tsc` will not flag unused imports but eslint will).

- [ ] **Step 5: Typecheck, lint, build**

```bash
cd web && npx tsc --noEmit
cd .. && npx eslint web/src/components/device-control/device-control.tsx web/src/components/device-control/logcat
npm run build:xenon && npm run build:copy
```

Expected: tsc clean; the eslint count on `device-control.tsx` must be **no higher** than on `main` (check by stashing); the new `logcat/` files should be clean. Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/device-control/logcat web/src/components/device-control/device-control.tsx
git commit -m "feat(web): stream logcat into a parsed, filterable Debug Logs tab"
```

---

### Task 8: Full verification

**Files:** none modified.

- [ ] **Step 1: Typecheck and run every spec this change touches**

```bash
npx tsc --noEmit
npx mocha test/unit/logcat-parse.spec.ts test/unit/logcat-multiplexer.spec.ts test/unit/package-resolver.spec.ts test/unit/logcat-stream-service.spec.ts test/unit/logcat-ws.spec.ts
cd web && npx vitest run src/components/device-control/logcat/logcatFilter.test.ts
```

Expected: no type errors, 0 failing.

- [ ] **Step 2: Confirm no new lint**

```bash
npx eslint src/services/logcat src/device-managers/android/LogcatMultiplexer.ts src/device-managers/android/LogcatStreamService.ts src/app/ws/logcatWs.ts src/services/ServerManager.ts web/src/components/device-control/logcat web/src/components/device-control/device-control.tsx
```

Count the errors, `git stash`, re-run, `git stash pop`, compare. Counts must match for pre-existing files; new files must be clean. **Do not pass `--fix`.**

- [ ] **Step 3: Confirm no schema drift**

```bash
npm run build:schema
git diff --stat schema.json src/
node scripts/check-client-freshness.js
```

Expected: empty diff, and `Generated client is fresh.` Both CI gates.

- [ ] **Step 4: Run the viewport guard**

The Debug Logs tab is on the device-control route, which `web/test/viewport/overflow.spec.ts` covers at both breakpoints. Start a repo-built server and point the suite at it:

```bash
XENON_BASE_URL=http://127.0.0.1:<port> npx playwright test test/viewport/overflow.spec.ts
```

Expected: all passing. A layout change on this route has already broken landscape once in this repo; do not skip it.

- [ ] **Step 5: Hardware validation**

Isolated auth-enabled server, real Android device, two browser tabs:

1. Lines stream live, and **no duplicates appear over several minutes** — the defect this replaces.
2. `package:com.android.systemui` filters to that process; `level:W` hides debug lines.
3. Two tabs on the same device share **one** `adb logcat` process (`pgrep -fl "logcat"` shows one).
4. Closing both tabs stops the process within ~30s (idle watchdog).
5. `adb reboot` produces the synthetic end-of-stream record, then the hook reconnects cleanly and streaming resumes.
6. A second user who does not hold the device is refused (WS closes 1008), while the holder streams normally.
7. Open the tab on an iPhone: the unsupported state renders, no socket is opened.

- [ ] **Step 6: Push and open the PR**

```bash
git status --porcelain
git push -u origin feat/logcat-stream
gh pr create --title "feat(logcat): stream device logs over WebSocket" --body-file <path to a body file you write>
```

Do not merge, and do not bump the version.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Replace dump-poll with continuous stream | 4, 7 |
| Duplication fixed by construction | 4 (one process, no re-dump) |
| Parse threadtime into fields | 1 |
| Year inference | 1 |
| Continuation lines appended, banners dropped | 1 (returns null), 4 (appends) |
| Multiplexer + replay buffer (2000) | 2 |
| Dropped records visible + coalesced | 2 |
| PID → package at emit time, reuse-safe | 3, 4 |
| `ps` failure never blocks a line | 3 |
| WS path-scoped upgrade, ticket auth | 5 |
| Ownership-checked read | 5 |
| Cleanup registered before awaits | 5 |
| Idle watchdog (30s) | 4 |
| End-of-stream synthetic record | 4 |
| Client buffer (5000), bounded backoff | 7 |
| Client-side filtering, level+tag+package+text | 6, 7 |
| Level dropdown writes into the same query | 7 |
| iOS unsupported state | 7 |
| All five test specs | 1, 2, 3, 4, 5, 6 |
| Hardware validation incl. shared process and reboot | 8 |
| `schema.json` untouched | Global Constraints, 8 |

**Type consistency:** `LogcatRecord` is defined once in Task 1 and imported by Tasks 2 and 4. The frontend re-declares a structurally identical `LogcatRecord` in Task 7's hook (the frontend cannot import from `src/`), and Task 6's `LogRecordLike` is the narrower shape the filter needs — `matches` accepts the hook's record because it is structurally compatible. `LogcatMultiplexer.addClient(send, canAccept)` has the same two-argument shape in Tasks 2 and 5. `IDLE_TIMEOUT_MS`, `REPLAY_BUFFER_SIZE` and `DEFAULT_TTL_MS` are each exported from exactly one file.

**Placeholder scan:** none — every step carries its code or its exact command.

**Known deliberate gaps, stated rather than hidden:**
- `authorize` passes `isAdmin: false` (Task 5, Step 5): a stream ticket carries a userId, not a role, so an admin cannot watch another user's device over this WS. Called out in the task.
- `LogcatView` has no component test — the repo has no component-test harness for this view, and the behaviour is covered by Task 6's pure filter tests plus Task 8's hardware pass. Do not add a snapshot test to fill the gap.
- Ordering risk flagged inline in Task 4, Step 4: records are pushed after an async package resolution, so a continuation line can arrive before its parent is pushed. The test will catch it; the fix is to buffer, not to weaken the test.
