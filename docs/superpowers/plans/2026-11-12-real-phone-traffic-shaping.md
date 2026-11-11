# Real-phone traffic shaping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shape a real Android phone's proxy-aware traffic (HTTP, HTTPS, WebSocket) to the `4G`, `3G` and `Edge` profiles, at session start and through `xenon: setNetworkProfile`, alongside network capture.

**Architecture:** A per-phone TCP relay on the host (`ShapingRelay`) throttles and delays bytes through a shared `LinkShaper`, and forwards to the capture proxy or to a minimal loopback `ForwardProxy`. The phone reaches it over `adb reverse` with its global `http_proxy` pointed at it. One owner per session (`PhoneProxy`) reads, records, points and restores that setting for both capture and shaping.

**Tech Stack:** TypeScript, Node `net`/`http`/`stream`, TypeDI, Mocha + Chai + Sinon, the existing `PhoneNetworkLedger`, `PortAllocator` and fake adb (`test/helpers/fake-adb.ts`).

**Spec:** `docs/superpowers/specs/2026-11-12-real-phone-traffic-shaping-design.md`

## Global Constraints

- Profile figures are `NETWORK_PROFILES` in `src/services/NetworkConditioningService.ts`: 4G 15000/7500 kbps and 20 ms, 3G 2000/1000 and 100 ms, Edge 250/150 and 400 ms. kbps means 1000 bits/s.
- Each direction delays its chunks by half the profile's `latencyMs`.
- Token bucket burst: 50 ms worth of bytes (`BURST_MS = 50`).
- Queued bytes per connection per direction: at most 256 KB (`MAX_QUEUED_BYTES = 256 * 1024`).
- Relay ports come from the `proxy` range (`PortAllocator.acquire('proxy', udid)`, 11100–11199), so boot clean-up's dead-proxy rule covers a crashed relay.
- The relay binds 127.0.0.1 when `adb reverse` is established, 0.0.0.0 only on the LAN fallback. `ForwardProxy` always binds 127.0.0.1.
- Only a real Android phone this server drives: `platform` android, `realDevice` true, no `adbRemoteHost`. Emulators keep part 1's console path.
- No session is ever failed for shaping: a failure logs once per phone and answers `appTraffic: 'none'`.
- The proxy setting is written to the ledger before it is changed, and restored once, under `withPhoneNetworkLock`.
- Ledger rows written by 2.31 and earlier carry `proxy.reversePort` (one number): still read.
- Flag `real-phone-shaping`; `features.networkProfiles.appTraffic.androidDevice` = `['Normal', '4G', '3G', 'Edge', 'Offline']`; `features.networkProfiles.proxyShaped` = `['androidDevice']`.
- Never `eslint --fix` broadly; run prettier only on files you touch, after checking they were clean before.

## Review Focus

- **A phone that closes a connection while bytes still wait in the shaper:** the relay must close the upstream side and free that connection's queue, not keep sending. Test in Task 3.
- **A target that refuses (the capture proxy stopped first at session end):** the relay closes the phone's socket and keeps serving other connections. Test in Task 3.
- **`Normal` set before any shaping profile on a real phone:** no relay, no proxy change, `appTraffic: 'radios'` as today. Test in Task 5.
- **The session ends while a profile change is in flight:** `reset` and `setProfile` share the phone lock, so the relay is either never started or stopped. Test in Task 5.
- **Two sessions on two phones at once:** separate relays, separate shapers, one shared `ForwardProxy` that stops only when both end. Test in Task 2 and Task 5.

---

### Task 1: `LinkShaper`: rate limit and delay per direction

**Files:**
- Create: `src/services/network/LinkShaper.ts`
- Test: `test/unit/phone-network/link-shaper.spec.ts`

**Interfaces:**
- Produces:
  - `export interface ShapeLimits { downKbps: number; upKbps: number; latencyMs: number }` (0 kbps = no limit)
  - `export const UNLIMITED: ShapeLimits`, `export const BURST_MS = 50`, `export const MAX_QUEUED_BYTES = 256 * 1024`
  - `export type Direction = 'down' | 'up'` (`down` = toward the phone)
  - `export class LinkShaper { constructor(limits?: ShapeLimits); setLimits(limits: ShapeLimits): void; limits(): ShapeLimits; throttle(direction: Direction): Transform }`
  - No import from `NetworkConditioningService` (it imports this module).

- [ ] **Step 1: Write the failing tests**

Loopback only: pipe a `Readable.from` buffer through `throttle(dir)` into a collecting `Writable`, timing with `Date.now()`.

```ts
it('limits each direction to its rate, within 10%', ...)       // 1 MB at 2000 kbps down: ~4.19 s; 1 MB at 1000 kbps up: ~8.39 s
it('delays each chunk by half the latency', ...)               // 3G: a 10-byte chunk arrives 50 ms ± 20 later
it('shares a direction's rate between two throttles', ...)     // two 512 KB transfers down at 2000 kbps finish together in ~4.19 s
it('applies new limits to a transfer under way', ...)          // start at Edge, setLimits(UNLIMITED) at 500 ms: the rest arrives within 100 ms
it('passes bytes untimed when unlimited', ...)                  // 1 MB in under 200 ms, no delay
it('keeps order within one throttle', ...)                      // 100 numbered chunks arrive in order
it('holds at most MAX_QUEUED_BYTES before pausing its writer', ...) // write() returns false once 256 KB are queued at Edge
```

Use smaller payloads (64–128 KB) at a fast profile where a full 1 MB test would take over 10 s; keep the 10% tolerance.

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx mocha test/unit/phone-network/link-shaper.spec.ts`
Expected: FAIL, `Cannot find module '../../../src/services/network/LinkShaper'`

- [ ] **Step 3: Implement `LinkShaper` in `src/services/network/LinkShaper.ts`**

One token bucket per direction on the shaper (bytes/s = kbps × 125; capacity = rate × `BURST_MS`/1000), refilled from `process.hrtime` on use. Each `throttle()` is a `Transform` with `highWaterMark: MAX_QUEUED_BYTES` that, per chunk, waits for tokens (splitting a chunk larger than the burst), then for `latencyMs / 2`, then pushes. Waiters on one bucket are served in arrival order so connections share fairly. `setLimits` takes effect for the next token wait. Timers are `unref()`ed.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx mocha test/unit/phone-network/link-shaper.spec.ts`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/services/network/LinkShaper.ts test/unit/phone-network/link-shaper.spec.ts
git commit -m "feat(network): a shared rate limit and delay per direction (LinkShaper)"
```

### Task 2: `ForwardProxy`: CONNECT and plain HTTP on loopback

**Files:**
- Create: `src/services/network/ForwardProxy.ts`
- Test: `test/unit/phone-network/forward-proxy.spec.ts`

**Interfaces:**
- Produces:
  - `export class ForwardProxy { start(): Promise<number>; stop(): Promise<void> }` (binds 127.0.0.1 on an OS-given port, returns it)
  - `export const sharedForwardProxy: { acquire(): Promise<number>; release(): Promise<void> }` (one instance per process, started on the first acquire, stopped when the last holder releases)

- [ ] **Step 1: Write the failing tests**

```ts
it('tunnels a CONNECT to its target and relays both ways', ...)   // CONNECT 127.0.0.1:<echo server>; reply '200 Connection Established'; bytes echo back
it('forwards a plain HTTP request in absolute form', ...)         // GET http://127.0.0.1:<http server>/x through the proxy: 200 and the body
it('answers 502 to a CONNECT it cannot complete', ...)            // CONNECT 127.0.0.1:1
it('closes the tunnel when either side closes', ...)
it('listens on 127.0.0.1 only', ...)                              // server.address().address === '127.0.0.1'
it('shares one instance and stops it with its last holder', ...)  // acquire twice: same port; release once: still answers; release again: refused
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx mocha test/unit/phone-network/forward-proxy.spec.ts`
Expected: FAIL, module not found

- [ ] **Step 3: Implement `ForwardProxy` and `sharedForwardProxy` in `src/services/network/ForwardProxy.ts`**

`http.createServer` for absolute-form requests (re-issue with `http.request`, pipe both bodies, copy status and headers minus hop-by-hop ones) and its `'connect'` event for tunnels (`net.connect`, write the 200 line, pipe both ways, destroy both on either's close or error). No TLS, no caching. Not the outbound-proxy rule (`outboundProxyFor`): this proxy is the phone's way out, and goes direct.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx mocha test/unit/phone-network/forward-proxy.spec.ts`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/services/network/ForwardProxy.ts test/unit/phone-network/forward-proxy.spec.ts
git commit -m "feat(network): a minimal loopback forward proxy for shaped phones"
```

### Task 3: `ShapingRelay`: the phone's connections, shaped, to a target

**Files:**
- Create: `src/services/network/ShapingRelay.ts`
- Test: `test/unit/phone-network/shaping-relay.spec.ts`

**Interfaces:**
- Consumes: `LinkShaper`, `Direction` (Task 1); `ForwardProxy` (Task 2, in tests)
- Produces: `export class ShapingRelay { constructor(opts: { port: number; bindHost: '127.0.0.1' | '0.0.0.0'; shaper: LinkShaper; target: () => { host: string; port: number } }); start(): Promise<void>; stop(): Promise<void> }`

- [ ] **Step 1: Write the failing tests**

```ts
it('relays a CONNECT through a ForwardProxy target, shaped', ...)   // 3G: a 64 KB echo round trip takes at least the 3G time for 64 KB each way
it('relays to a stand-in capture proxy unchanged', ...)            // target is a raw TCP echo: bytes arrive byte for byte
it('closes the upstream when the phone closes mid-transfer', ...)   // upstream sees 'close' within 100 ms; nothing more written to it
it('closes the phone side when the target refuses, and keeps serving', ...) // target port 1: client closed; a second connection to a good target still works
it('stop() closes every open connection and the listener', ...)
it('binds the host it is given', ...)
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx mocha test/unit/phone-network/shaping-relay.spec.ts`
Expected: FAIL, module not found

- [ ] **Step 3: Implement `ShapingRelay` in `src/services/network/ShapingRelay.ts`**

`net.createServer`; per accepted socket, `net.connect(target())`, then `phone → shaper.throttle('up') → upstream` and `upstream → shaper.throttle('down') → phone` with `stream.pipeline`; destroying either end destroys the rest. Track sockets in a `Set` for `stop()`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx mocha test/unit/phone-network/shaping-relay.spec.ts`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/services/network/ShapingRelay.ts test/unit/phone-network/shaping-relay.spec.ts
git commit -m "feat(network): a per-phone shaping relay"
```

### Task 4: `PhoneProxy`: one owner of the phone's proxy; capture moves onto it

**Files:**
- Create: `src/services/network/PhoneProxy.ts`
- Modify: `src/services/InterceptorService.ts` (`start`, `stop`, `pointPhoneAtProxy`, `putPhoneProxyBack`, `establishDeviceRouting` move out; add `proxyPortOf`)
- Modify: `src/services/network/PhoneNetworkLedger.ts` (`proxy.reversePorts`)
- Modify: `src/services/network/PhoneNetworkRestore.ts` (`undoProxy` removes every reverse port)
- Test: `test/unit/phone-network/phone-proxy.spec.ts`; the existing `interceptor-proxy-restore.spec.ts`, `phone-network-restore.spec.ts`, `boot-clean-up.spec.ts` must pass unchanged except where they read `reversePort`

**Interfaces:**
- Produces:
  - `export interface ProxyRoute { deviceHost: string; reverse: boolean; transport: 'emulator' | 'adb-reverse' | 'lan-fallback' }`
  - `@Service() export class PhoneProxy { route(device: IDevice, port: number): Promise<ProxyRoute>; pointAt(sessionId: string, device: IDevice, port: number, route: ProxyRoute): Promise<void>; release(sessionId: string): Promise<void>; owns(sessionId: string): boolean }`
  - `PhoneNetworkChange['proxy']` = `{ set: string; previous: string | null; reversePorts?: number[] }`; parsing a stored `reversePort: n` yields `reversePorts: [n]`
  - `InterceptorService.proxyPortOf(sessionId: string): number | undefined`

- [ ] **Step 1: Write the failing tests**

```ts
it('records the phone's own proxy before the first change, then points it', ...) // ledger row written before 'settings put global http_proxy 127.0.0.1:11100'
it('a second pointAt changes set only, keeps previous, adds its reverse port', ...)
it('release removes every reverse port and puts previous back, once', ...)        // second release: no adb calls
it('release of a session it never pointed does nothing', ...)
it('reads a ledger row from 2.31 with one reversePort', ...)                       // PhoneNetworkRestore removes that port at boot
it('restore at boot removes every recorded reverse port', ...)
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx mocha test/unit/phone-network/phone-proxy.spec.ts`
Expected: FAIL, module not found

- [ ] **Step 3: Implement `PhoneProxy`, the ledger field, and the restore change**

`route` is `InterceptorService.establishDeviceRouting` moved as is (emulator `10.0.2.2`, else `adb reverse` to `127.0.0.1`, else the LAN address with its warning). `pointAt` and `release` are `pointPhoneAtProxy` and `putPhoneProxyBack` moved, keyed by session, with the dead-capture-proxy leftover rule kept, plus reverse-port removal in `release`. All under `withPhoneNetworkLock`.

- [ ] **Step 4: Move capture onto it**

`InterceptorService.start` calls `route` then `pointAt`; `stop` calls `release` (no own `removeReverse`, no `previousProxy` in its state). Add `proxyPortOf`.

- [ ] **Step 5: Run the new and existing specs**

Run: `npx mocha test/unit/phone-network/*.spec.ts test/unit/interceptor*.spec.ts`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/services/network/PhoneProxy.ts src/services/InterceptorService.ts src/services/network/PhoneNetworkLedger.ts src/services/network/PhoneNetworkRestore.ts test/unit/phone-network/
git commit -m "refactor(network): one owner of a phone's proxy setting (PhoneProxy)"
```

### Task 5: Shaping a real phone in `NetworkConditioningService`

**Files:**
- Modify: `src/services/NetworkConditioningService.ts` (`setShape`, `describe`, `reset`, `ActiveCondition`)
- Modify: `src/services/SessionLifecycleService.ts` (`applyPostSessionLogic`: start capture before `applyProfile`)
- Test: `test/unit/phone-network/real-phone-shaping.spec.ts`

**Interfaces:**
- Consumes: `LinkShaper`, `ShapeLimits`, `UNLIMITED` (Task 1); `sharedForwardProxy` (Task 2); `ShapingRelay` (Task 3); `PhoneProxy`, `InterceptorService.proxyPortOf` (Task 4)
- Produces: `export function limitsFor(profile: NetworkProfile): ShapeLimits` in this file (the profile's figures; `UNLIMITED` for Normal and Offline); `ActiveCondition.relay?: { relay: ShapingRelay; shaper: LinkShaper; port: number; forward: boolean }`; a field `relayFor: (opts) => ShapingRelay` a spec can stand in for, like `consoleFor`

- [ ] **Step 1: Write the failing tests**

With the fake adb and a real `ShapingRelay` on a stand-in target:

```ts
it('limitsFor gives the profile figures', ...)                // limitsFor('3G') deep-equals { downKbps: 2000, upKbps: 1000, latencyMs: 100 }
it('3G at start: one relay, proxy pointed, ledger first, answer shaped', ...)
it('3G, Normal, Edge: one relay and one proxy change, limits swapped', ...)  // Normal: relay.limits() equals UNLIMITED, proxy unchanged
it('Normal before any shaping: no relay, no proxy change, answer radios', ...)
it('Offline keeps the relay; leaving it keeps the limits', ...)
it('with capture on, the relay targets the capture port', ...)
it('the session's end stops the relay, releases the forward proxy and the proxy, once', ...)
it('a reset during a profile change leaves no relay running', ...)
it('a phone on a remote adb server answers none and starts nothing', ...)
it('a relay that cannot start answers none, logged once per phone', ...)
it('describe says shaped for a real phone with a shaping profile', ...)
it('two phones get two relays and share one forward proxy', ...)
it('session start applies capture before the profile', ...)                // SessionLifecycleService order
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx mocha test/unit/phone-network/real-phone-shaping.spec.ts`
Expected: FAIL on the relay assertions

- [ ] **Step 3: Implement the real-phone path**

In `setShape`: an emulator keeps the console path; a real Android phone (`realDevice`, no `adbRemoteHost`) goes to `setRelayShape`. The first shaping profile leases a `proxy` port, takes a `route`, starts a `ShapingRelay` (bind `127.0.0.1` when `route.reverse`, else `0.0.0.0`) targeting `127.0.0.1:proxyPortOf(sessionId)` or `sharedForwardProxy.acquire()`, then `PhoneProxy.pointAt`. Later profiles call `shaper.setLimits(limitsFor(profile))`. `reset` stops the relay, releases the port (`PortAllocator.release(port, udid)`), the forward proxy and `PhoneProxy`. Swap the two calls in `applyPostSessionLogic`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx mocha test/unit/phone-network/*.spec.ts`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/services/NetworkConditioningService.ts src/services/SessionLifecycleService.ts test/unit/phone-network/real-phone-shaping.spec.ts
git commit -m "feat(network): shape a real Android phone's traffic through a relay (ENH-20)"
```

### Task 6: Feature detection, docs, full suite

**Files:**
- Modify: `src/app/routers/capabilities.ts`, `src/app/routers/sdk-version.ts`, `src/app/openapi/identity.yaml`, `website/openapi.json` (`npm run build:openapi`)
- Modify: `test/unit/CapabilitiesRouter.spec.ts`, `test/unit/sdk-version.spec.ts`
- Modify: `website/docs/network-conditioning.md`, `website/docs/capabilities.mdx`, `CLAUDE.md` ("A session's phone network")

- [ ] **Step 1: Update the two specs** to expect `androidDevice: ['Normal', '4G', '3G', 'Edge', 'Offline']`, `proxyShaped: ['androidDevice']` and the flag `real-phone-shaping`; run them and see them fail.
- [ ] **Step 2: Change `capabilities.ts`, `sdk-version.ts` and `identity.yaml`**; run `npm run build:openapi`; run the two specs and `test/unit/openapi-coverage.spec.ts`: pass.
- [ ] **Step 3: Docs.** `network-conditioning.md`: the real-phone row of the table, what is and isn't shaped (the spec's list), capture together, a hub's nodes need this release. `capabilities.mdx`: the profiles' wording. CLAUDE.md: one bullet under "A session's phone network".
- [ ] **Step 4: Mutation check.** For each rule below, break it, run `npx mocha test/unit/phone-network/*.spec.ts`, see a failure, restore: shared bucket per direction; half latency per direction; `Normal` keeps the relay; ledger written before the proxy change; reverse ports removed on release; relay targets capture when on; reset stops the relay.
- [ ] **Step 5: Full suite.** `export ANDROID_HOME=$HOME/Library/Android/sdk; npm test`. Expected: all pass, 0 failing.
- [ ] **Step 6: Commit**

```bash
git add src/app test/unit website CLAUDE.md
git commit -m "feat(network): report real-phone shaping; docs"
```

### Task 7: Live check on a real Android phone

Needs the lab's S9+ (`381103b720057ece`) plugged in. Run a scratch server from the branch build beside the lab (port 4724, a fake `HOME`, its own database), never `adb reconnect`.

- [ ] **Step 1:** Session on the S9+ with no app launched; time `toybox nc` requests from the phone (as part 1's check) at `Normal`, `3G`, `Edge`, `Normal`, then after the session. Expected: `3G` and `Edge` slower by about their latency and bandwidth; `Normal` back to the baseline; after the session the phone's `http_proxy` is what it was before.
- [ ] **Step 2:** The same with `xe:interceptor` on: requests are captured and slowed.
- [ ] **Step 3:** Kill the scratch server mid-session (`kill -9`), restart it: the phone's proxy is put back at boot.
- [ ] **Step 4:** Stop the scratch server, delete its database, push the branch and open the PR with the measurements.
