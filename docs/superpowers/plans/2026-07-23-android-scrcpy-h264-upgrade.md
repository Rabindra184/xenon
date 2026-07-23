# Android scrcpy H.264 Capture Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Android H.264 live-preview capture source (`adb screenrecord`) with a directly-driven, vendored **scrcpy-server** — near-instant first frame, no ~3-min restart hiccup — reusing the entire existing downstream pipeline unchanged, with `screenrecord` kept as a selectable rollback source.

**Architecture:** A new `ScrcpyServerSession` pushes a vendored `scrcpy-server.jar` with Xenon's resolved adb, starts it via `app_process` in raw-stream mode (`send_frame_meta=false` → Annex-B bytes identical in shape to `screenrecord` stdout), and exposes the byte stream. `AndroidH264StreamService.openCapture` selects the source from config and feeds either source through the **existing** `H264NalParser` → `H264Multiplexer` → WS → `WsH264Player`. Nothing downstream of the producer changes.

**Tech Stack:** TypeScript 5.5 (CommonJS, ES2016), TypeDI `@Service`, Node `child_process`/`net`, Mocha + Chai. **No new npm dependencies.** Vendored `scrcpy-server` jar (~60 KB).

## Global Constraints

- **No new npm dependency.** scrcpy is driven as a device-side server binary only.
- **Never spawn a bare `adb`.** Resolve via `AndroidDeviceManager.getAdbForDevice(udid)` → `executable.path` + host args (the 1.8.2 GUI-PATH-trap fix). Applies to push, shell, forward.
- **Feature flag default OFF.** `streaming.androidH264` absent/`false` → pure MJPEG, new code inert.
- **iOS, recording, the WS transport, `WsH264Player`, `H264Multiplexer`, `H264NalParser` are untouched.** This swaps only the capture producer.
- **One version constant** (`SCRCPY_SERVER_VERSION`) is the single source of truth for both the vendored jar filename and the `app_process` `<version>` argument.
- Tests that construct `AndroidH264StreamService` (pulls TypeDI) MUST start with `import 'reflect-metadata';` (per CLAUDE.md).
- Ship as **minor 1.10.0**, flag still OFF by default (release is a separate step outside this plan, per the project release process).

---

### Task 1: Vendor the pinned scrcpy-server jar + version module

**Files:**
- Create: `src/device-managers/android/vendor/scrcpy-server-<ver>.jar` (downloaded)
- Create: `src/device-managers/android/vendor/README.md`
- Create: `src/device-managers/android/scrcpyVersion.ts`
- Create: `test/unit/scrcpy-version.spec.ts`
- Modify: `package.json` (`build:copy` script — copy the vendor dir into `lib/`)

**Interfaces:**
- Produces: `SCRCPY_SERVER_VERSION: string`, `scrcpyServerJarFilename(): string`, `scrcpyServerJarPath(): string` (absolute path to the jar at runtime, resolved from `__dirname`).

- [ ] **Step 1: Download the pinned jar.** Pick a stable scrcpy release whose server uses `key=value` args and `video_codec`/`video_bit_rate` (scrcpy ≥ 2.0). Download `scrcpy-server-v<ver>` from the official GitHub release (`https://github.com/Genymobile/scrcpy/releases`), rename to `scrcpy-server-<ver>.jar`, place under `src/device-managers/android/vendor/`. Record its SHA256.

  > Execution note: this is a file download (~60 KB, official scrcpy GitHub release). Confirm with the user before downloading, per the download-permission rule.

- [ ] **Step 2: Write the version module.**

```typescript
// src/device-managers/android/scrcpyVersion.ts
import path from 'path';

/**
 * Pinned scrcpy-server version. The vendored jar filename AND the `app_process`
 * <version> argument both derive from this — they must always agree, so this is
 * the single source of truth. Bump procedure: see vendor/README.md.
 */
export const SCRCPY_SERVER_VERSION = '<ver>';

export function scrcpyServerJarFilename(): string {
  return `scrcpy-server-${SCRCPY_SERVER_VERSION}.jar`;
}

/** Absolute path to the vendored jar, valid in src (ts-node) and lib (built). */
export function scrcpyServerJarPath(): string {
  return path.join(__dirname, 'vendor', scrcpyServerJarFilename());
}
```

- [ ] **Step 3: Write the failing test.**

```typescript
// test/unit/scrcpy-version.spec.ts
import { expect } from 'chai';
import fs from 'fs';
import {
  SCRCPY_SERVER_VERSION,
  scrcpyServerJarFilename,
  scrcpyServerJarPath,
} from '../../src/device-managers/android/scrcpyVersion';

describe('scrcpyVersion', () => {
  it('derives the jar filename from the single version constant', () => {
    expect(scrcpyServerJarFilename()).to.equal(`scrcpy-server-${SCRCPY_SERVER_VERSION}.jar`);
  });
  it('the vendored jar exists on disk at the resolved path', () => {
    expect(fs.existsSync(scrcpyServerJarPath()), scrcpyServerJarPath()).to.equal(true);
  });
});
```

- [ ] **Step 4: Run it, confirm it passes.** `npx mocha test/unit/scrcpy-version.spec.ts` → 2 passing (the jar must already be in place from Step 1).

- [ ] **Step 5: Wire the build copy.** In `package.json` `build:copy`, after the existing copies, add a copy of the vendor dir into the built tree so the jar ships in the npm tarball (`files` already includes `lib`):

```
&& mkdir -p lib/src/device-managers/android/vendor && cp src/device-managers/android/vendor/*.jar lib/src/device-managers/android/vendor/
```

  Verify: `npm run build && ls lib/src/device-managers/android/vendor/` shows the jar.

- [ ] **Step 6: Write `vendor/README.md`** documenting: the pinned version, its SHA256, the source URL, and the **bump procedure** (replace jar → update `SCRCPY_SERVER_VERSION` → re-run `test/unit/scrcpy-server-session.spec.ts` (Task 2) → re-run the on-device spike (Task 8)).

- [ ] **Step 7: Commit.**

```bash
git add src/device-managers/android/vendor src/device-managers/android/scrcpyVersion.ts test/unit/scrcpy-version.spec.ts package.json
git commit -m "feat(streaming): vendor pinned scrcpy-server jar + version module"
```

---

### Task 2: scrcpy launch-arg builder (pure)

**Files:**
- Create: `src/device-managers/android/ScrcpyServerSession.ts` (arg builder only in this task)
- Create: `test/unit/scrcpy-server-session.spec.ts`

**Interfaces:**
- Consumes: `SCRCPY_SERVER_VERSION` (Task 1).
- Produces: `buildScrcpyServerArgs(opts: { version: string; jarDevicePath: string; maxSize: number }): string[]` — the argv passed to adb **after** `[-s <udid>]`, i.e. starting at `'shell'`. Also `SCRCPY_DEVICE_JAR_PATH = '/data/local/tmp/scrcpy-server-manual.jar'` constant.

- [ ] **Step 1: Write the failing test.** Asserts the exact argv — this is the guard against silent arg drift on a version bump.

```typescript
// test/unit/scrcpy-server-session.spec.ts
import { expect } from 'chai';
import { buildScrcpyServerArgs, SCRCPY_DEVICE_JAR_PATH } from '../../src/device-managers/android/ScrcpyServerSession';

describe('buildScrcpyServerArgs', () => {
  it('builds the exact video-only app_process argv', () => {
    const argv = buildScrcpyServerArgs({ version: '3.3.4', jarDevicePath: SCRCPY_DEVICE_JAR_PATH, maxSize: 1560 });
    expect(argv).to.deep.equal([
      'shell',
      `CLASSPATH=${SCRCPY_DEVICE_JAR_PATH}`,
      'app_process',
      '/',
      'com.genymobile.scrcpy.Server',
      '3.3.4',
      'tunnel_forward=true',
      'audio=false',
      'control=false',
      'video=true',
      'video_codec=h264',
      'max_size=1560',
      'video_bit_rate=4000000',
      'max_fps=30',
      'send_device_meta=false',
      'send_codec_meta=false',
      'send_frame_meta=false',
      'send_dummy_byte=true',
      'cleanup=true',
    ]);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails** (module not found). `npx mocha test/unit/scrcpy-server-session.spec.ts`.

- [ ] **Step 3: Implement the builder.**

```typescript
// src/device-managers/android/ScrcpyServerSession.ts
export const SCRCPY_DEVICE_JAR_PATH = '/data/local/tmp/scrcpy-server-manual.jar';

/**
 * The argv passed to the resolved adb AFTER any `-s <udid>` — a headless,
 * video-only scrcpy-server launch. All three metadata channels are disabled
 * (`send_device_meta=false`, `send_codec_meta=false`, `send_frame_meta=false`)
 * so the socket carries plain Annex-B H.264 that the existing H264NalParser
 * consumes unchanged. `send_dummy_byte=true` (the tunnel_forward readiness byte)
 * is explicit because the socket reader skips exactly one leading byte.
 * Arg NAMES verified against the vendored scrcpy 3.3.4 jar's dex; the version
 * constant and this argv move together (see scrcpyVersion.ts / vendor/README.md).
 * No `scid` → the server listens on `localabstract:scrcpy` (per-device namespace).
 */
export function buildScrcpyServerArgs(opts: {
  version: string;
  jarDevicePath: string;
  maxSize: number;
}): string[] {
  return [
    'shell',
    `CLASSPATH=${opts.jarDevicePath}`,
    'app_process',
    '/',
    'com.genymobile.scrcpy.Server',
    opts.version,
    'tunnel_forward=true',
    'audio=false',
    'control=false',
    'video=true',
    'video_codec=h264',
    `max_size=${opts.maxSize}`,
    'video_bit_rate=4000000',
    'max_fps=30',
    'send_device_meta=false',
    'send_codec_meta=false',
    'send_frame_meta=false',
    'send_dummy_byte=true',
    'cleanup=true',
  ];
}
```

- [ ] **Step 4: Run it, confirm it passes.**

- [ ] **Step 5: Commit.**

```bash
git add src/device-managers/android/ScrcpyServerSession.ts test/unit/scrcpy-server-session.spec.ts
git commit -m "feat(streaming): scrcpy server launch-arg builder (pure)"
```

---

### Task 3: Pure helpers — max-size math + adb-forward port parse

**Files:**
- Modify: `src/device-managers/android/ScrcpyServerSession.ts` (add two exported pure fns)
- Modify: `test/unit/scrcpy-server-session.spec.ts`

**Interfaces:**
- Produces: `scrcpyMaxSizeFromDims(sw: number, sh: number, targetShortEdge?: number): number` (default `targetShortEdge = 720`); `parseAdbForwardPort(stdout: string): number` (throws on unparseable).

- [ ] **Step 1: Write the failing tests.**

```typescript
// add to test/unit/scrcpy-server-session.spec.ts
import { scrcpyMaxSizeFromDims, parseAdbForwardPort } from '../../src/device-managers/android/ScrcpyServerSession';

describe('scrcpyMaxSizeFromDims', () => {
  it('caps the LONGER edge so the shorter edge lands near the target', () => {
    // 1080x2340: short=1080 → scale 720/1080; long=2340*0.6667 ≈ 1560
    expect(scrcpyMaxSizeFromDims(1080, 2340)).to.equal(1560);
  });
  it('is orientation-agnostic (landscape same result)', () => {
    expect(scrcpyMaxSizeFromDims(2340, 1080)).to.equal(1560);
  });
  it('never upscales when the short edge is already below target', () => {
    expect(scrcpyMaxSizeFromDims(480, 800)).to.equal(800);
  });
});

describe('parseAdbForwardPort', () => {
  it('reads the assigned port from `adb forward tcp:0` output', () => {
    expect(parseAdbForwardPort('41337\n')).to.equal(41337);
  });
  it('throws on non-numeric output', () => {
    expect(() => parseAdbForwardPort('error: device offline')).to.throw();
  });
});
```

- [ ] **Step 2: Run, confirm fail.**

- [ ] **Step 3: Implement.**

```typescript
// add to src/device-managers/android/ScrcpyServerSession.ts

/**
 * scrcpy `max_size` caps the device's LONGER edge (single int, aspect preserved).
 * Derive it so the SHORTER edge lands near `targetShortEdge` (matches today's
 * ~720-wide screenrecord downscale). Never upscales.
 */
export function scrcpyMaxSizeFromDims(sw: number, sh: number, targetShortEdge = 720): number {
  const shortE = Math.min(sw, sh);
  const longE = Math.max(sw, sh);
  if (!Number.isFinite(shortE) || !Number.isFinite(longE) || shortE <= 0 || longE <= 0) {
    return targetShortEdge * 2; // safe default longer-edge cap
  }
  if (shortE <= targetShortEdge) return longE; // no upscale
  return Math.round(longE * (targetShortEdge / shortE));
}

/** Parse the local TCP port that `adb forward tcp:0 …` prints on stdout. */
export function parseAdbForwardPort(stdout: string): number {
  const port = parseInt(String(stdout).trim(), 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Unparseable adb forward port: ${JSON.stringify(stdout)}`);
  }
  return port;
}
```

- [ ] **Step 4: Run, confirm pass.**

- [ ] **Step 5: Commit.**

```bash
git add src/device-managers/android/ScrcpyServerSession.ts test/unit/scrcpy-server-session.spec.ts
git commit -m "feat(streaming): scrcpy max-size + adb-forward-port pure helpers"
```

---

### Task 4: Config normalizer + schema union (boolean | { source })

**Files:**
- Create: `src/app/routers/androidH264Config.ts`
- Create: `test/unit/android-h264-config.spec.ts`
- Modify: `schema.json` (`definitions.StreamingConfig.androidH264` → union)
- Modify: `src/interfaces/IPluginArgs.ts` (regenerated)

**Interfaces:**
- Produces: `type H264Source = 'scrcpy' | 'screenrecord'`; `type AndroidH264Config = boolean | { source?: H264Source }`; `resolveAndroidH264(cfg: AndroidH264Config | undefined): { enabled: boolean; source: H264Source }`.

- [ ] **Step 1: Write the failing test.**

```typescript
// test/unit/android-h264-config.spec.ts
import { expect } from 'chai';
import { resolveAndroidH264 } from '../../src/app/routers/androidH264Config';

describe('resolveAndroidH264', () => {
  it('undefined/false → disabled', () => {
    expect(resolveAndroidH264(undefined)).to.deep.equal({ enabled: false, source: 'scrcpy' });
    expect(resolveAndroidH264(false)).to.deep.equal({ enabled: false, source: 'scrcpy' });
  });
  it('true → enabled with scrcpy (the new meaning of true)', () => {
    expect(resolveAndroidH264(true)).to.deep.equal({ enabled: true, source: 'scrcpy' });
  });
  it('object → enabled; source defaults to scrcpy, honored when explicit', () => {
    expect(resolveAndroidH264({})).to.deep.equal({ enabled: true, source: 'scrcpy' });
    expect(resolveAndroidH264({ source: 'screenrecord' })).to.deep.equal({
      enabled: true,
      source: 'screenrecord',
    });
  });
});
```

- [ ] **Step 2: Run, confirm fail.**

- [ ] **Step 3: Implement.**

```typescript
// src/app/routers/androidH264Config.ts
export type H264Source = 'scrcpy' | 'screenrecord';
export type AndroidH264Config = boolean | { source?: H264Source };

/**
 * Normalize the three accepted flag shapes to one:
 *   false | undefined        → { enabled:false }         (pure MJPEG — default)
 *   true                     → { enabled:true, scrcpy }  (new default source)
 *   { source }               → { enabled:true, source }  (explicit; scrcpy default)
 */
export function resolveAndroidH264(
  cfg: AndroidH264Config | undefined,
): { enabled: boolean; source: H264Source } {
  if (!cfg) return { enabled: false, source: 'scrcpy' };
  if (cfg === true) return { enabled: true, source: 'scrcpy' };
  return { enabled: true, source: cfg.source === 'screenrecord' ? 'screenrecord' : 'scrcpy' };
}
```

- [ ] **Step 4: Run, confirm pass.**

- [ ] **Step 5: Update the schema union.** In `schema.json`, `definitions.StreamingConfig.properties.androidH264` becomes a union (schema.json's top-level `streaming` property stays opaque — the appium workaround — so this only affects generated TS types):

```json
"androidH264": {
    "default": false,
    "description": "Android live preview: false/omitted = MJPEG; true = H.264 via scrcpy; { \"source\": \"scrcpy\" | \"screenrecord\" } to pick the capture source explicitly. Falls back to MJPEG when unsupported.",
    "oneOf": [
        { "type": "boolean" },
        {
            "type": "object",
            "additionalProperties": false,
            "properties": { "source": { "type": "string", "enum": ["scrcpy", "screenrecord"] } }
        }
    ]
}
```

- [ ] **Step 6: Regenerate types + confirm.** `npm run build:schema`, then verify `src/interfaces/IPluginArgs.ts` shows `androidH264?: boolean | { source?: ... }`. If the generator flattens the union imperfectly, hand-edit the `StreamingConfig` interface to `androidH264?: import('../app/routers/androidH264Config').AndroidH264Config;` (keep the generated file compiling). Run `tsc -b` to confirm no type errors.

- [ ] **Step 7: Commit.**

```bash
git add src/app/routers/androidH264Config.ts test/unit/android-h264-config.spec.ts schema.json src/interfaces/IPluginArgs.ts
git commit -m "feat(streaming): androidH264 flag accepts { source } union + normalizer"
```

---

### Task 5: `ScrcpyServerSession` lifecycle (push / start / forward / connect / stop)

**Files:**
- Modify: `src/device-managers/android/ScrcpyServerSession.ts`

**Interfaces:**
- Consumes: `buildScrcpyServerArgs`, `parseAdbForwardPort`, `SCRCPY_DEVICE_JAR_PATH` (this file); `scrcpyServerJarPath`, `SCRCPY_SERVER_VERSION` (Task 1); `AndroidDeviceManager.getAdbForDevice` (resolved adb).
- Produces: `class ScrcpyServerSession extends EventEmitter` with `async start(maxSize: number): Promise<void>`, events `'data' (Buffer)` and `'close'`, and `stop(): void`. (`maxSize` passed in so the class stays free of DeviceStore; the service resolves it — Task 6.)

- [ ] **Step 1: Implement the lifecycle** (impure; validated by the Task 8 spike + manual run, not a host unit test).

```typescript
import { spawn, ChildProcess, execFile } from 'child_process';
import { EventEmitter } from 'events';
import net from 'net';
import { promisify } from 'util';
import { Container } from 'typedi';
import log from '../../logger';
import { SCRCPY_SERVER_VERSION, scrcpyServerJarPath } from './scrcpyVersion';

const execFileAsync = promisify(execFile);
const LOCAL_ABSTRACT = 'scrcpy'; // device-side socket name scrcpy listens on

export class ScrcpyServerSession extends EventEmitter {
  private proc?: ChildProcess;
  private socket?: net.Socket;
  private forwardSpec?: string; // e.g. 'tcp:41337'
  private stopped = false;
  private adbPath = 'adb';
  private hostArgs: string[] = [];
  private base: string[] = []; // [...hostArgs, '-s', udid]

  constructor(private udid: string) {
    super();
  }

  async start(maxSize: number): Promise<void> {
    const { default: AndroidDeviceManager } = await import('../AndroidDeviceManager');
    const adb: any = await Container.get(AndroidDeviceManager).getAdbForDevice(this.udid);
    this.adbPath = adb?.executable?.path || 'adb';
    this.hostArgs = adb?.adbHost && adb?.adbPort ? ['-H', adb.adbHost, '-P', String(adb.adbPort)] : [];
    this.base = [...this.hostArgs, '-s', this.udid];

    // 1) push jar (idempotent enough; overwrite is cheap and safe)
    await execFileAsync(this.adbPath, [...this.base, 'push', scrcpyServerJarPath(), '/data/local/tmp/scrcpy-server-manual.jar']);

    // 2) app_process (long-lived). Import the builder lazily to avoid a cycle.
    const { buildScrcpyServerArgs, SCRCPY_DEVICE_JAR_PATH } = await import('./ScrcpyServerSession');
    const serverArgs = buildScrcpyServerArgs({
      version: SCRCPY_SERVER_VERSION,
      jarDevicePath: SCRCPY_DEVICE_JAR_PATH,
      maxSize,
    });
    this.proc = spawn(this.adbPath, [...this.base, ...serverArgs]);
    this.proc.stderr?.on('data', (d: Buffer) => log.debug(`[${this.udid}] scrcpy-server: ${d.toString().trim()}`));
    this.proc.on('close', () => { if (!this.stopped) this.emit('close'); });

    // 3) forward a local port to the device socket, then connect
    const { parseAdbForwardPort } = await import('./ScrcpyServerSession');
    const { stdout } = await execFileAsync(this.adbPath, [...this.base, 'forward', 'tcp:0', `localabstract:${LOCAL_ABSTRACT}`]);
    const port = parseAdbForwardPort(stdout);
    this.forwardSpec = `tcp:${port}`;

    await this.connectWithRetry(port);
  }

  private connectWithRetry(port: number, attempt = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = net.connect(port, '127.0.0.1');
      let dummySkipped = false;
      sock.once('connect', () => { this.socket = sock; resolve(); });
      sock.on('data', (chunk: Buffer) => {
        // tunnel_forward=true sends a single readiness dummy byte (0x00) first.
        if (!dummySkipped) { dummySkipped = true; chunk = chunk.subarray(1); }
        if (chunk.length) this.emit('data', chunk);
      });
      sock.on('close', () => { if (!this.stopped) this.emit('close'); });
      sock.on('error', (e) => {
        // The server may not be listening yet immediately after spawn — retry briefly.
        if (attempt < 20 && !this.stopped) {
          setTimeout(() => this.connectWithRetry(port, attempt + 1).then(resolve, reject), 100);
        } else reject(e);
      });
    });
  }

  stop(): void {
    this.stopped = true;
    try { this.socket?.destroy(); } catch { /* best-effort */ }
    try { this.proc?.kill('SIGKILL'); } catch { /* best-effort */ }
    if (this.forwardSpec) {
      execFile(this.adbPath, [...this.base, 'forward', '--remove', this.forwardSpec], () => undefined);
    }
  }
}
```

  > **Handshake note (finalize from Task 8 spike):** the single dummy-byte skip above matches `tunnel_forward=true` + `send_device_meta=false`. If the spike shows a codec-id preamble or a different readiness signal for the pinned version, adjust `connectWithRetry`'s first-chunk handling here — this is the one spot the design defers to on-device verification.

- [ ] **Step 2: Confirm it compiles.** `npx tsc -b` → no errors. (No new unit test here; the pure pieces are covered by Tasks 2–3, the socket path by the spike/manual.)

- [ ] **Step 3: Commit.**

```bash
git add src/device-managers/android/ScrcpyServerSession.ts
git commit -m "feat(streaming): ScrcpyServerSession push/start/forward/connect lifecycle"
```

---

### Task 6: Route `openCapture` through the selected source

**Files:**
- Modify: `src/device-managers/android/AndroidH264StreamService.ts`
- Modify: `test/unit/android-h264-service.spec.ts`

**Interfaces:**
- Consumes: `ScrcpyServerSession`, `scrcpyMaxSizeFromDims` (Tasks 3, 5); `H264Source` (Task 4).
- Produces: `AndroidH264StreamService.start(udid: string, opts?: { source?: H264Source }): Promise<H264Multiplexer>` (backward-compatible — no opts ⇒ `scrcpy`). Adds `private async openScrcpyCapture(udid, onPacket): Promise<{ kill }>`; renames the current body to `openScreenrecordCapture`; `openCapture(udid, onPacket, source)` dispatches.

- [ ] **Step 1: Write the failing test** — source routing (seams stubbed so no device is touched).

```typescript
// add to test/unit/android-h264-service.spec.ts
it('start({source:"scrcpy"}) uses the scrcpy capture seam', async () => {
  const svc = make();
  let used = '';
  svc.openScrcpyCapture = async (_u: string, onPacket: any) => {
    used = 'scrcpy';
    onPacket({ type: 'config', data: Buffer.from([0]), ptsMs: 0 });
    return { kill: () => undefined };
  };
  svc.openScreenrecordCapture = async () => { used = 'screenrecord'; return { kill: () => undefined }; };
  await svc.start('udid-s', { source: 'scrcpy' });
  expect(used).to.equal('scrcpy');
});

it('start({source:"screenrecord"}) uses the legacy capture seam', async () => {
  const svc = make();
  let used = '';
  svc.openScrcpyCapture = async () => { used = 'scrcpy'; return { kill: () => undefined }; };
  svc.openScreenrecordCapture = async (_u: string, onPacket: any) => {
    used = 'screenrecord';
    onPacket({ type: 'config', data: Buffer.from([0]), ptsMs: 0 });
    return { kill: () => undefined };
  };
  await svc.start('udid-r', { source: 'screenrecord' });
  expect(used).to.equal('screenrecord');
});
```

- [ ] **Step 2: Run, confirm fail.**

- [ ] **Step 3: Refactor `openCapture` to dispatch + add the scrcpy producer.** Rename the current `openCapture` body to `openScreenrecordCapture(udid, onPacket)`. Add:

```typescript
// thread source through start()
async start(udid: string, opts?: { source?: H264Source }): Promise<H264Multiplexer> {
  // ... unchanged inflight/existing checks ...
  // inside the async IIFE, replace the openCapture call:
  session.capture = await this.openCapture(udid, onPacket, opts?.source ?? 'scrcpy');
  // ...
}

protected async openCapture(
  udid: string,
  onPacket: (p: H264Packet) => void,
  source: H264Source,
): Promise<{ kill: () => void }> {
  return source === 'screenrecord'
    ? this.openScreenrecordCapture(udid, onPacket)
    : this.openScrcpyCapture(udid, onPacket);
}

protected async openScrcpyCapture(
  udid: string,
  onPacket: (p: H264Packet) => void,
): Promise<{ kill: () => void }> {
  const { ScrcpyServerSession, scrcpyMaxSizeFromDims } = await import('./ScrcpyServerSession');
  const device = await DeviceStoreFactory.getStore().findDevice({ udid });
  const maxSize = scrcpyMaxSizeFromDims(Number(device?.screenWidth), Number(device?.screenHeight));
  const parser = new H264NalParser();
  const session = new ScrcpyServerSession(udid);
  session.on('data', (b: Buffer) => { for (const p of parser.push(b)) onPacket(p); });
  session.on('close', () => {
    // Crash recovery: scrcpy has no time cap, so a close while running is unexpected.
    if (this.sessions.get(udid)?.status === 'running') {
      log.warn(`[${udid}] scrcpy stream closed unexpectedly; stopping H.264 session.`);
      this.stop(udid);
    }
  });
  await session.start(maxSize);
  return { kill: () => session.stop() };
}
```

  Add `import { H264Source } from '../../app/routers/androidH264Config';` at the top. Keep `openScreenrecordCapture` (the current screenrecord body, including its restart-on-cap loop) verbatim.

- [ ] **Step 4: Run the service tests, confirm pass.** `npx mocha test/unit/android-h264-service.spec.ts` — the new routing tests plus the existing lifecycle tests all green.

- [ ] **Step 5: Commit.**

```bash
git add src/device-managers/android/AndroidH264StreamService.ts test/unit/android-h264-service.spec.ts
git commit -m "feat(streaming): select scrcpy|screenrecord capture source in openCapture"
```

---

### Task 7: Thread the source from config through `control.ts`

**Files:**
- Modify: `src/app/routers/control.ts`

**Interfaces:**
- Consumes: `resolveAndroidH264` (Task 4); `AndroidH264StreamService.start(udid, {source})` (Task 6).

- [ ] **Step 1: Replace both flag reads** with the normalizer. At the two `const flagOn = !!Container.get(PluginContext).pluginArgs.streaming?.androidH264;` sites (stream/start ~L524 and stream/status ~L674):

```typescript
import { resolveAndroidH264 } from './androidH264Config';
// ...
const h264Cfg = resolveAndroidH264(Container.get(PluginContext).pluginArgs.streaming?.androidH264);
const flagOn = h264Cfg.enabled;
```

- [ ] **Step 2: Pass the source at start.** At the start call (~L536):

```typescript
await Container.get(AndroidH264StreamService).start(udid, { source: h264Cfg.source });
```

  Leave the existing `try/catch` that falls back to MJPEG on start failure exactly as-is (unchanged fallback contract). The stream/status handler needs no source — only `enabled`.

- [ ] **Step 3: Type-check.** `npx tsc -b` → clean. If `pluginArgs.streaming?.androidH264` now types as the union, `resolveAndroidH264` accepts it directly (no cast).

- [ ] **Step 4: Run the full unit suite.** `npm test` → all green (nothing else touched the H.264 path).

- [ ] **Step 5: Commit.**

```bash
git add src/app/routers/control.ts
git commit -m "feat(streaming): drive capture source from androidH264 config in control routes"
```

---

### Task 8: On-device spike, perf validation, and docs

**Files:**
- Modify: `CLAUDE.md` (streaming section), `src/device-managers/android/vendor/README.md` (confirm handshake notes)
- Possibly: `src/device-managers/android/ScrcpyServerSession.ts` (finalize handshake per spike)

- [ ] **Step 1: Handshake spike.** Build (`npm run build`), then on the real Pixel 5 with the resolved adb, run a throwaway script that constructs a `ScrcpyServerSession`, logs the first 64 bytes received, and pipes the rest into a file. Confirm: (a) exactly one dummy byte precedes the stream (no codec-id preamble with `send_frame_meta=false`); (b) `ffprobe`/the H264NalParser sees valid SPS/PPS + IDR at the start. If (a) differs, adjust `connectWithRetry` in `ScrcpyServerSession` and re-run.

- [ ] **Step 2: End-to-end + perf on the Pixel 5.** Launch a flagged server (`--plugin-xenon-streaming='{"androidH264":true}'`, android-only, auth disabled, scratch home — the validated harness from the 1.9.x work). Open the real dashboard → Live Devices → add the Pixel 5. Confirm via the WebCodecs canvas player (not MJPEG). Measure and record in the PR:
  - **First-frame time** (target: sub-second vs the 6–9s screenrecord cold start).
  - **No ~3-min hiccup** over a >5-minute continuous watch.
  - fps + rough glass-to-glass latency vs `--plugin-xenon-streaming='{"source":"screenrecord"}'`.
- [ ] **Step 3: Fallback drills.** (a) Force scrcpy start failure (temporarily break the jar path) → tile silently uses MJPEG. (b) `{"source":"screenrecord"}` → exact 1.9.x behavior. (c) flag off → pure MJPEG. (d) confirm iOS tile unaffected.

- [ ] **Step 4: Update `CLAUDE.md`.** In the Android streaming section, note the H.264 source is now scrcpy (continuous, forced initial keyframe, no cap), with `screenrecord` selectable via `{ source: 'screenrecord' }`, MJPEG fallback unchanged.

- [ ] **Step 5: Commit + open PR.**

```bash
git add CLAUDE.md src/device-managers/android/vendor/README.md src/device-managers/android/ScrcpyServerSession.ts
git commit -m "feat(streaming): finalize scrcpy handshake + docs; validated on Pixel 5"
```

  Then open a PR to `main` (feature branch `feat/android-scrcpy-h264`). Release as **1.10.0** is a separate step per the project release process (version bump committed BEFORE opening the release PR).

---

## Self-Review

- **Spec coverage:** vendored jar + version pin (T1); minimal-jar acquisition, no npm dep (T1, T2, T5); raw-stream → existing parser (T5→T6); source-selectable rollback (T4, T6, T7); `max_size` longer-edge fix (T3); config union backward-compat (T4); fallback-to-MJPEG unchanged (T7 leaves the catch intact); on-device handshake verification (T8); perf/limitation payoff measured (T8). iOS/recording/WS/player untouched (no tasks touch them).
- **Placeholder scan:** `<ver>` is the one intentional deferral — the exact pinned version is chosen in T1 Step 1 and flows through `SCRCPY_SERVER_VERSION`; every other step has concrete code/commands.
- **Type consistency:** `H264Source`/`AndroidH264Config`/`resolveAndroidH264` defined in T4 and consumed by T6/T7; `ScrcpyServerSession` (events `data`/`close`, `start(maxSize)`, `stop()`) defined T5, consumed T6; `buildScrcpyServerArgs`/`scrcpyMaxSizeFromDims`/`parseAdbForwardPort` defined T2/T3, consumed T5; `start(udid, {source})` signature consistent T6↔T7.
