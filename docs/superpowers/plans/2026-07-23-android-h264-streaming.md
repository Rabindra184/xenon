# Android H.264 Live Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ~1 fps Android screencap preview with a smooth (~30–90 fps) continuous H.264 stream from scrcpy, decoded in-browser with WebCodecs, feature-flagged with MJPEG fallback.

**Architecture:** A new backend `AndroidH264StreamService` starts scrcpy on the device via `@yume-chan/adb-scrcpy` and fans its H.264 access units out through an `H264Multiplexer` to browser clients over an authenticated WebSocket. The frontend `DeviceTile` picks a WebCodecs `<canvas>` player for Android when the flag is on, scrcpy started, and the browser supports `VideoDecoder`; otherwise it uses the existing MJPEG `<img>`. iOS and recording are untouched.

**Tech Stack:** TypeScript (CommonJS), TypeDI, Express, `ws`, `@yume-chan/{adb,adb-server-node-tcp,adb-scrcpy,scrcpy,fetch-scrcpy-server}` (ESM — loaded via dynamic `import()`), React 17, browser WebCodecs.

## Global Constraints

- **@yume-chan packages are ESM-only** (`type: module`); Xenon is CommonJS. Import them **only** via `await import('@yume-chan/…')` inside async methods. Never `require()` or top-level `import` them.
- **Feature flag default OFF.** `pluginArgs.streaming.androidH264` defaults `false`. With it off, behavior is byte-for-byte the current MJPEG path.
- **Do not touch the iOS path** (`IOSStreamService`, WDA MJPEG) or the recording pipeline (`RecordingOrchestrator`). A recording device uses MJPEG preview (spec phase-1 rule).
- **WS auth:** every video WebSocket must `StreamTicketService.redeem(ticket, udid)` before streaming — no unauthenticated video socket.
- **scrcpy-server binary** is fetched/bundled via `@yume-chan/fetch-scrcpy-server`, pinned to the `@yume-chan/scrcpy` version in `package.json`. Record the pin in code comments.
- Preserve the raw-pixels contract of the existing MJPEG path; H.264 is an additive, parallel service.

## File Structure

- Create `src/device-managers/android/AndroidH264StreamService.ts` — scrcpy lifecycle + per-device H.264 upstream. One responsibility: own scrcpy for a udid and expose an `H264Multiplexer`.
- Create `src/device-managers/android/H264Multiplexer.ts` — one-upstream→many-clients fan-out with config/keyframe-gated join + backpressure drop. Pure/testable; no scrcpy or socket types.
- Create `src/app/ws/h264StreamWs.ts` — attaches a `ws` server to the plugin HTTP server for `GET /xenon/api/control/:udid/stream/h264`, redeems the ticket, bridges a client to the multiplexer.
- Modify `schema.json` — add `streaming.androidH264`. Regenerate `src/types/*` via `npm run build:schema`.
- Modify `src/app/routers/control.ts` — `stream/status` reports `type` + `h264Path`; `stream/start` starts H.264 when eligible.
- Create `web/src/components/mosaic/WsH264Player.tsx` — WebCodecs `VideoDecoder` → `<canvas>` player.
- Create `web/src/components/mosaic/pickStreamPlayer.ts` — pure selection: `(platform, backendType, hasWebCodecs) → 'h264' | 'mjpeg'`.
- Modify `web/src/components/mosaic/DeviceTile.tsx` — use `pickStreamPlayer`; render `WsH264Player` or the existing `<img>`.
- Test files alongside each (`test/unit/…`, `web/test/…`).

---

## Phase 1 — Feature flag + stream-type advertisement

Delivers: the flag exists (default off) and `stream/status` reports a `type` field. No behavior change yet. Safe to ship alone.

### Task 1: Add `streaming.androidH264` schema flag

**Files:**
- Modify: `schema.json` (add a `streaming` object property, sibling of `autowait`)
- Modify (generated): `src/types/*` via `npm run build:schema`

**Interfaces:**
- Produces: `pluginArgs.streaming?.androidH264?: boolean` on `IPluginArgs`.

- [ ] **Step 1:** In `schema.json`, add alongside `autowait`:

```json
"streaming": {
  "type": "object",
  "description": "Live-streaming options.",
  "properties": {
    "androidH264": {
      "type": "boolean",
      "default": false,
      "description": "Use scrcpy H.264 for Android live preview (WebCodecs in the browser) instead of the MJPEG screencap loop. Falls back to MJPEG when unsupported."
    }
  },
  "additionalProperties": false
}
```

- [ ] **Step 2:** Run `npm run build:schema`. Expected: `IPluginArgs` gains `streaming?: { androidH264?: boolean }`. Verify: `grep -n "androidH264" src/types/*.ts`.
- [ ] **Step 3:** Commit: `git add schema.json src/types && git commit -m "feat(streaming): add streaming.androidH264 flag (default off)"`.

### Task 2: `stream/status` advertises a stream `type`

**Files:**
- Modify: `src/app/routers/control.ts` (the `GET /:udid/stream/status` handler at ~637)
- Test: `test/unit/stream-status-type.spec.ts`

**Interfaces:**
- Produces: `stream/status` JSON gains `type: 'mjpeg' | 'h264'` and, when `h264`, `h264Path: '/xenon/api/control/<udid>/stream/h264'`.
- Consumes: `pluginArgs.streaming?.androidH264` (Task 1).

- [ ] **Step 1: Write the failing test** — a helper `resolveStreamType(platform, flagOn, recording)` returns `'mjpeg'` for iOS, `'mjpeg'` when the flag is off, `'mjpeg'` when the device is recording, and `'h264'` for Android when flag on and not recording.

```ts
import { resolveStreamType } from '../../src/app/routers/streamType';
import { expect } from 'chai';
describe('resolveStreamType', () => {
  it('iOS is always mjpeg', () => expect(resolveStreamType('ios', true, false)).to.equal('mjpeg'));
  it('flag off => mjpeg', () => expect(resolveStreamType('android', false, false)).to.equal('mjpeg'));
  it('recording => mjpeg', () => expect(resolveStreamType('android', true, true)).to.equal('mjpeg'));
  it('android + flag on + not recording => h264', () => expect(resolveStreamType('android', true, false)).to.equal('h264'));
});
```

- [ ] **Step 2:** Run `npx mocha test/unit/stream-status-type.spec.ts` — FAIL (`streamType` missing).
- [ ] **Step 3:** Create `src/app/routers/streamType.ts`:

```ts
export type StreamType = 'mjpeg' | 'h264';
export function resolveStreamType(platform: string, flagOn: boolean, recording: boolean): StreamType {
  const isAndroid = platform === 'android' || platform === 'androidtv' || platform === 'android-tv';
  if (!isAndroid || !flagOn || recording) return 'mjpeg';
  return 'h264';
}
```

- [ ] **Step 4:** In `control.ts` `stream/status`, compute `type` via `resolveStreamType(device.platform, !!pluginArgs.streaming?.androidH264, isRecording(device))` and include `type` (+ `h264Path` when `h264`) in the response. Use the existing recording check the route already has access to; if none, treat `recording=false` for now.
- [ ] **Step 5:** Run the test — PASS. Build: `npm run build`.
- [ ] **Step 6:** Commit: `git add -A && git commit -m "feat(streaming): stream/status advertises mjpeg|h264 type"`.

---

## Phase 2 — Backend H.264 acquisition (scrcpy via @yume-chan)

Delivers: `AndroidH264StreamService.start(udid)` produces H.264 access units and an `H264Multiplexer`. Highest integration risk — **starts with an API-verification spike**.

### Task 3: Install deps + pin scrcpy-server + verify the @yume-chan v2 API (spike)

**Files:**
- Modify: `package.json` (deps)
- Create: `scripts/spikes/yume-scrcpy-api.mjs` (throwaway verification, ESM)

- [ ] **Step 1:** `npm i @yume-chan/adb @yume-chan/adb-server-node-tcp @yume-chan/adb-scrcpy @yume-chan/scrcpy @yume-chan/fetch-scrcpy-server @yume-chan/stream-extra`.
- [ ] **Step 2:** Write `scripts/spikes/yume-scrcpy-api.mjs` that: connects to the local adb server (`@yume-chan/adb-server-node-tcp` `AdbServerNodeTcpConnector`, default 127.0.0.1:5037), gets the device by serial (env `UDID`), starts scrcpy via `AdbScrcpyClient.start(...)` with the bundled server bin from `@yume-chan/fetch-scrcpy-server`, options `{ videoCodec:'h264', maxSize:720, maxFps:30 }`, control disabled, audio disabled; reads the video stream and logs: the config packet (codec + SPS/PPS bytes) and the first 30 frame packets (keyframe flag, byteLength).
- [ ] **Step 3:** Run `UDID=08121FDD40001U node scripts/spikes/yume-scrcpy-api.mjs`. Expected: logs a config packet then ~30 frame packets, keyframe flag on the first. **Record in the plan/PR the exact class names, method signatures, and packet shape observed** — Tasks 4–5 use these verbatim.
- [ ] **Step 4:** Commit: `git add package.json package-lock.json scripts/spikes && git commit -m "chore(streaming): add @yume-chan scrcpy deps + API spike"`.

### Task 4: `H264Multiplexer` (pure, tested)

**Files:**
- Create: `src/device-managers/android/H264Multiplexer.ts`
- Test: `test/unit/h264-multiplexer.spec.ts`

**Interfaces:**
- Produces:
  - `type H264Packet = { type: 'config' | 'key' | 'delta'; data: Buffer; ptsMs: number }`
  - `class H264Multiplexer { setConfig(p: H264Packet): void; push(p: H264Packet): void; addClient(send: (p: H264Packet) => void): () => void /* returns removeClient */; get clientCount(): number }`
- Behavior: a newly added client immediately receives the latest `config` (if any), then receives packets **starting at the next `key`** (delta packets before the first key after join are withheld). `push` fans out to all joined clients.

- [ ] **Step 1: Write failing tests:**

```ts
import { H264Multiplexer } from '../../src/device-managers/android/H264Multiplexer';
import { expect } from 'chai';
const P = (type: any, n: number) => ({ type, data: Buffer.from([n]), ptsMs: n });
describe('H264Multiplexer', () => {
  it('new client gets config, then waits for the next keyframe (no mid-GOP delta)', () => {
    const m = new H264Multiplexer();
    m.setConfig(P('config', 0));
    const got: any[] = [];
    m.addClient((p) => got.push(p.type));
    m.push(P('delta', 1)); // before first key -> withheld
    m.push(P('key', 2));
    m.push(P('delta', 3));
    expect(got).to.deep.equal(['config', 'key', 'delta']);
  });
  it('removeClient stops delivery and drops clientCount', () => {
    const m = new H264Multiplexer();
    m.setConfig(P('config', 0));
    const got: any[] = [];
    const remove = m.addClient((p) => got.push(p.type));
    expect(m.clientCount).to.equal(1);
    remove();
    m.push(P('key', 1));
    expect(m.clientCount).to.equal(0);
    expect(got).to.deep.equal(['config']);
  });
});
```

- [ ] **Step 2:** Run `npx mocha test/unit/h264-multiplexer.spec.ts` — FAIL.
- [ ] **Step 3:** Implement:

```ts
export type H264Packet = { type: 'config' | 'key' | 'delta'; data: Buffer; ptsMs: number };
type Client = { send: (p: H264Packet) => void; started: boolean };
export class H264Multiplexer {
  private clients = new Set<Client>();
  private config?: H264Packet;
  setConfig(p: H264Packet) { this.config = p; }
  get clientCount() { return this.clients.size; }
  addClient(send: (p: H264Packet) => void): () => void {
    const c: Client = { send, started: false };
    this.clients.add(c);
    if (this.config) send(this.config);
    return () => this.clients.delete(c);
  }
  push(p: H264Packet) {
    if (p.type === 'config') { this.config = p; }
    for (const c of this.clients) {
      if (!c.started) {
        if (p.type === 'key') c.started = true; else continue; // wait for keyframe
      }
      c.send(p);
    }
  }
}
```

- [ ] **Step 4:** Run tests — PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat(streaming): H264Multiplexer with keyframe-gated join"`.

### Task 5: `AndroidH264StreamService` (scrcpy lifecycle, dynamic import)

**Files:**
- Create: `src/device-managers/android/AndroidH264StreamService.ts`
- Test: `test/unit/android-h264-service.spec.ts` (lifecycle/state only; scrcpy stubbed)

**Interfaces:**
- Produces (TypeDI `@Service`):
  - `start(udid: string): Promise<H264Multiplexer>` — idempotent per udid (dedupe concurrent starts like `IOSStreamService.startPromises`), starts scrcpy, wires its packets into a per-udid multiplexer, resolves once the config packet arrives.
  - `getMultiplexer(udid: string): H264Multiplexer | undefined`
  - `stop(udid: string): Promise<void>` — kills scrcpy, clears state.
  - Idle watchdog: stop when `multiplexer.clientCount === 0` for N minutes (unless device busy), mirroring `AndroidStreamService`.
- Consumes: `H264Multiplexer` (Task 4); the verified @yume-chan API (Task 3); `AndroidDeviceManager.getAdbForDevice` for the adb server host/port.

- [ ] **Step 1: Write failing test** (stub the scrcpy start via a protected `openScrcpy(udid)` seam so the test drives packet flow without a device):

```ts
import 'reflect-metadata';
import { expect } from 'chai';
import AndroidH264StreamService from '../../src/device-managers/android/AndroidH264StreamService';
function make() { return Object.create(AndroidH264StreamService.prototype) as any; }
describe('AndroidH264StreamService', () => {
  it('exposes the multiplexer created for a udid', async () => {
    const svc = make(); svc.sessions = new Map(); svc.startPromises = new Map();
    // stub the scrcpy seam to emit a config packet then hand back a killer
    svc.openScrcpy = async (_udid: string, onPacket: any) => { onPacket({ type: 'config', data: Buffer.from([0]), ptsMs: 0 }); return { kill: () => {} }; };
    const mux = await svc.start('udid-x');
    expect(mux).to.equal(svc.getMultiplexer('udid-x'));
    expect(mux.clientCount).to.equal(0);
  });
});
```

- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement the service. `start()` dedupes via `startPromises`, creates an `H264Multiplexer`, calls the protected `openScrcpy(udid, onPacket)` seam, resolves on first `config`. `openScrcpy` is where the **dynamic `import()`** lives:

```ts
protected async openScrcpy(udid: string, onPacket: (p: H264Packet) => void): Promise<{ kill: () => void }> {
  const { AdbServerClient } = await import('@yume-chan/adb');
  const { AdbServerNodeTcpConnector } = await import('@yume-chan/adb-server-node-tcp');
  const { AdbScrcpyClient, AdbScrcpyOptionsLatest } = await import('@yume-chan/adb-scrcpy');
  const { ScrcpyOptions3_1 /* or the version Task-3 pins */ } = await import('@yume-chan/scrcpy');
  const { BIN } = await import('@yume-chan/fetch-scrcpy-server');
  // …connect to adb server, select device by serial=udid, start scrcpy,
  //   iterate the video stream; map each packet to H264Packet and call onPacket;
  //   return { kill } that stops the client. Exact calls per Task-3 spike output.
}
```

- [ ] **Step 4:** Run test — PASS. Build: `npm run build`.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat(streaming): AndroidH264StreamService scrcpy lifecycle"`.

---

## Phase 3 — Authenticated WebSocket video endpoint

Delivers: `GET /…/stream/h264?ticket=…` upgrades to a WS that redeems the ticket and streams multiplexer packets as binary frames.

### Task 6: `h264StreamWs` upgrade handler

**Files:**
- Create: `src/app/ws/h264StreamWs.ts`
- Modify: wherever the plugin creates its HTTP server (attach the upgrade handler)
- Test: `test/unit/h264-ws-frame.spec.ts` (frame encoding is pure)

**Interfaces:**
- Produces: `encodeWsFrame(p: H264Packet): Buffer` — `[1 byte type: 0=config,1=key,2=delta][8 bytes LE double ptsMs][data]`; and `attachH264Ws(server, { redeem, getService })` that on `upgrade` for `/xenon/api/control/:udid/stream/h264` parses `udid`+`ticket`, `await redeem(ticket, udid)`, then `service.start(udid)` and `addClient(p => ws.send(encodeWsFrame(p)))`; drops the client if `ws.bufferedAmount` exceeds a bound (backpressure); removes the client on close.
- Consumes: `StreamTicketService.redeem`, `AndroidH264StreamService`, `H264Multiplexer`.

- [ ] **Step 1: Write failing test** for `encodeWsFrame`:

```ts
import { encodeWsFrame } from '../../src/app/ws/h264StreamWs';
import { expect } from 'chai';
describe('encodeWsFrame', () => {
  it('encodes type + ptsMs + payload', () => {
    const f = encodeWsFrame({ type: 'key', data: Buffer.from([9, 9]), ptsMs: 5 });
    expect(f.readUInt8(0)).to.equal(1);
    expect(f.readDoubleLE(1)).to.equal(5);
    expect(f.subarray(9)).to.deep.equal(Buffer.from([9, 9]));
  });
});
```

- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement `encodeWsFrame` + `attachH264Ws` (using `ws` `WebSocketServer({ noServer: true })` and `server.on('upgrade')`, path-matched; reject/close on redeem failure). **Step 4:** Run — PASS. Build.
- [ ] **Step 5:** Attach `attachH264Ws` where the plugin HTTP server is created (same server that serves `/xenon`). Redeem via `Container.get(StreamTicketService)`.
- [ ] **Step 6:** Commit: `git add -A && git commit -m "feat(streaming): authenticated H.264 WebSocket endpoint"`.

---

## Phase 4 — Frontend WebCodecs player + selection + fallback

Delivers: Android tiles render H.264 via WebCodecs when eligible; otherwise the existing MJPEG `<img>`. (WebCodecs decode proven in the prototype.)

### Task 7: `pickStreamPlayer` (pure selection)

**Files:**
- Create: `web/src/components/mosaic/pickStreamPlayer.ts`
- Test: `web/test/pickStreamPlayer.spec.ts`

**Interfaces:**
- Produces: `pickStreamPlayer(platform: string, backendType: 'mjpeg' | 'h264' | undefined, hasWebCodecs: boolean): 'h264' | 'mjpeg'` — `'h264'` only when `backendType === 'h264'` and `hasWebCodecs`; else `'mjpeg'`.

- [ ] **Step 1: Failing test:**

```ts
import { pickStreamPlayer } from '../src/components/mosaic/pickStreamPlayer';
import { expect } from 'chai';
describe('pickStreamPlayer', () => {
  it('h264 only when backend=h264 and WebCodecs present', () => {
    expect(pickStreamPlayer('android', 'h264', true)).to.equal('h264');
    expect(pickStreamPlayer('android', 'h264', false)).to.equal('mjpeg');
    expect(pickStreamPlayer('android', 'mjpeg', true)).to.equal('mjpeg');
    expect(pickStreamPlayer('ios', 'h264', true)).to.equal('mjpeg'); // backend never sends h264 for iOS
  });
});
```

- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement (one-liner per interface). **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat(streaming): pickStreamPlayer selection"`.

### Task 8: `WsH264Player` component (WebCodecs → canvas)

**Files:**
- Create: `web/src/components/mosaic/WsH264Player.tsx`

**Interfaces:**
- Produces: `<WsH264Player udid={string} wsUrl={string} onFatal={() => void} />` — opens `wsUrl`, decodes with `VideoDecoder`, draws to a `<canvas>`; calls `onFatal` on config/decode/WS failure so the tile can fall back to MJPEG.
- Consumes: the WS wire format from Task 6 (type byte + ptsMs + H.264 Annex-B). Adapt the proven prototype code (`scratchpad/scrcpy-proto/index.html`): server sends a `{type:'codec',codec}` text message first, then binary frames.

- [ ] **Step 1:** Implement the component: on mount create `VideoDecoder`, connect WS (`binaryType='arraybuffer'`), configure on the codec message (`optimizeForLatency:true`), decode `EncodedVideoChunk` per frame (monotonic timestamps), `ctx.drawImage(frame); frame.close()`, resize canvas to `frame.displayWidth/Height`. On any error or WS close-before-config, call `onFatal`. Clean up decoder + WS on unmount.
- [ ] **Step 2:** Smoke-verify against the running spike server (or Task-6 endpoint) that a frame renders (manual; component render loop is not unit-tested — the selection/fallback logic is).
- [ ] **Step 3:** Commit: `git add -A && git commit -m "feat(streaming): WsH264Player WebCodecs canvas player"`.

### Task 9: Wire `DeviceTile` to pick the player + mint a ticket

**Files:**
- Modify: `web/src/components/mosaic/DeviceTile.tsx` (the `<img>` at ~365)
- Test: `web/test/pickStreamPlayer.spec.ts` covers selection; tile wiring is manual/e2e.

**Interfaces:**
- Consumes: `pickStreamPlayer` (Task 7), `WsH264Player` (Task 8), the `type`/`h264Path` from `stream/status` (Task 2), a stream ticket (existing mint endpoint used by the webview MJPEG path).

- [ ] **Step 1:** In `DeviceTile`, read `streamType` from the tile's `stream/status`; compute `const player = pickStreamPlayer(platform, streamType, typeof window.VideoDecoder !== 'undefined')`.
- [ ] **Step 2:** When `player === 'h264'`, mint a ticket (same call the MJPEG webview path uses) and render `<WsH264Player udid={udid} wsUrl={`ws(s)://${host}${h264Path}?ticket=${ticket}`} onFatal={() => setForceMjpeg(true)} />`. When `player === 'mjpeg'` or `forceMjpeg`, render the existing `<img src={proxyUrl}>`.
- [ ] **Step 3:** Verify coordinate mapping for taps still uses the rendered element's client size ↔ device `screenWidth/Height` (unchanged — canvas has the same layout box as the `<img>`); `AnnotationOverlay` still overlays.
- [ ] **Step 4:** Build the web bundle: `npm run build:xenon && npm run build:copy`. Commit: `git add -A && git commit -m "feat(streaming): DeviceTile selects WebCodecs H.264 player with MJPEG fallback"`.

---

## Phase 5 — Wire start path + end-to-end + docs

### Task 10: `stream/start` starts H.264 when eligible; end-to-end validation

**Files:**
- Modify: `src/app/routers/control.ts` (`stream/start`)
- Modify: `docs/` (streaming notes), `CLAUDE.md` streaming section

**Interfaces:**
- Consumes: `AndroidH264StreamService.start` (Task 5), `resolveStreamType` (Task 2).

- [ ] **Step 1:** In `stream/start`, if `resolveStreamType(...) === 'h264'`, call `Container.get(AndroidH264StreamService).start(udid)` (still take the manual lock as today) and return `{ type:'h264', h264Path }`; else the existing MJPEG start. On scrcpy start failure, catch and fall through to MJPEG (report `type:'mjpeg'`).
- [ ] **Step 2:** End-to-end on a real Android device with the flag on: open the tile, confirm the canvas renders at high fps; kill scrcpy mid-stream and confirm the tile falls back to MJPEG; confirm flag-off is pure MJPEG; confirm iOS unaffected. Record fps/latency in the PR.
- [ ] **Step 3:** Update `CLAUDE.md` (streaming section: the H.264 path, flag, fallback) and add a short `docs/` note pinning the scrcpy-server version.
- [ ] **Step 4:** Commit: `git add -A && git commit -m "feat(streaming): start scrcpy H.264 for eligible Android tiles + docs"`.

---

## Self-Review notes

- **Spec coverage:** flag (T1), type advertise (T2), scrcpy acquisition (T3–T5), multiplexer keyframe-gating (T4), WS + ticket auth (T6), WebCodecs player + selection + fallback (T7–T9), start wiring + fallback + docs (T10). Recording untouched (spec phase-1 rule honored in `resolveStreamType`). iOS untouched.
- **ESM/CJS:** all @yume-chan use is behind `await import()` in `openScrcpy` (T5). No top-level import.
- **Type consistency:** `H264Packet` shape is identical across T4/T5/T6; `pickStreamPlayer` return `'h264'|'mjpeg'` matches `stream/status` `type`.
- **Known plan risk:** T5's `openScrcpy` internals are specified against the @yume-chan v2 API and **must be finalized from the T3 spike output** (exact class/option names). This is the one place the plan defers concrete code to a verification step by design.
