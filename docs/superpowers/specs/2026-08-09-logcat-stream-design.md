# Logcat streaming — an Android Studio-grade Debug Logs tab

**Date:** 2026-08-09
**Status:** approved, ready for planning
**Scope:** Android only. The Debug Logs tab's transport and rendering.

## Problem

The Debug Logs tab already has a filter box, FOLLOW/FREEZE, EXPORT, CLEAR, a
LIVE indicator and a 1000-line ring buffer. Two things undermine it.

### 1. The buffer fills with duplicates

`AndroidDeviceManager.getLogs` (`src/device-managers/AndroidDeviceManager.ts:1093`)
runs:

```
adb -s <udid> shell logcat -d -t 500 -v threadtime
```

`-d` dumps the last 500 lines and exits. The frontend polls it every 3 seconds
(`device-control.tsx:154`) and appends without deduplication
(`device-control.tsx:132-136`):

```ts
const combined = [...prev, ...cleanLines];
return combined.slice(-1000);
```

Unless the device emits 500+ new lines within 3 seconds — effectively never —
each poll re-appends lines already in the buffer. After two polls the 1000-line
buffer holds roughly the same 500 lines twice. Filtering, exporting and reading
are all built on top of that.

### 2. Lines are never parsed

`renderLogLines` (`device-control.tsx:160`) renders raw strings and colours them
by substring sniffing. There is no level, tag, PID or package as data, so there
can be no level badges, no per-tag colouring, no columns, and no field-aware
filtering — the filter is `line.toLowerCase().includes(...)`.

`-v threadtime` already emits a parseable shape:

```
08-09 16:11:00.005  1408  1408 D KeyguardUpdateMonitor: received broadcast …
MM-DD HH:MM:SS.mmm   PID   TID L TAG: message
```

The package (`com.android.systemui` in Android Studio) is the exception —
logcat does not emit it. Android Studio resolves PID → process name separately.

## Decisions

| Question | Decision |
|---|---|
| Transport | Replace the 3s dump-poll with a continuous `logcat` process streamed over a WebSocket, mirroring the existing H.264 stream. |
| Where lines are parsed | Server-side. Clients receive structured records. |
| Package column | In scope. Resolved server-side at emit time. |
| Filtering | Client-side only. |
| iOS | Out of scope; the tab shows an explicit unsupported state. |

## Architecture

Modelled one-for-one on the H.264 stack, which already solved this shape:
`src/app/ws/h264StreamWs.ts`, `H264Multiplexer`, `AndroidH264StreamService`.
Reusing that structure means reusing its lifecycle lessons rather than
rediscovering them.

### Backend

| File | Responsibility |
|---|---|
| `src/services/logcat/logcatParse.ts` | **Pure.** `parseThreadtimeLine(line) -> LogcatRecord \| null`. No I/O, no Container. |
| `src/device-managers/android/LogcatStreamService.ts` | `@Service()`. One `adb … logcat -v threadtime` child per device. `start(udid) -> LogcatMultiplexer`, `stop(udid)`, `getMultiplexer(udid)`. Idle watchdog stops the process at zero clients. |
| `src/device-managers/android/LogcatMultiplexer.ts` | One upstream, many clients, plus a replay ring buffer for late joiners. |
| `src/services/logcat/PackageResolver.ts` | PID → process name via `adb shell ps`, cached, consulted at emit time. |
| `src/app/ws/logcatWs.ts` | `attachLogcatWs(server, deps)` claiming `/xenon/api/control/:udid/logcat?ticket=`. |
| `src/services/ServerManager.ts` | Mount `attachLogcatWs` beside the existing `attachH264Ws` call (line ~87). |

### Frontend

| File | Responsibility |
|---|---|
| `web/src/components/device-control/logcat/useLogcatStream.ts` | Mints a ticket, opens the WS, keeps a bounded record array, reconnects with bounded backoff. |
| `web/src/components/device-control/logcat/logcatFilter.ts` | **Pure.** Parses and applies the filter query. |
| `web/src/components/device-control/logcat/LogcatView.tsx` | Columns, level badges, tag colouring, follow/freeze, export, clear. |

`device-control.tsx` loses the log polling effect, `renderLogLines`, and the
`deviceLogs` / `logStreamActive` / `logPollCount` state; the tab renders
`<LogcatView udid={…} platform={…} />`.

### The record

```ts
export type LogLevel = 'V' | 'D' | 'I' | 'W' | 'E' | 'F';

export interface LogcatRecord {
  /** Epoch ms. logcat threadtime has no year; see "Year inference" below. */
  ts: number;
  pid: number;
  tid: number;
  level: LogLevel;
  tag: string;
  message: string;
  /** Process name for pid, resolved at emit time. Absent when unknown. */
  pkg?: string;
  /** True for records Xenon injected rather than read from the device. */
  synthetic?: boolean;
}
```

## Parsing

`parseThreadtimeLine` handles four inputs:

1. **A well-formed line** — returns a record.
2. **A continuation line** (a message wrapping onto the next line, no leading
   timestamp) — returns `null`; the caller appends it to the previous record's
   message. Keeping this decision in the caller keeps the parser pure and
   single-purpose.
3. **A logcat banner** (`--------- beginning of main`) — returns `null`.
4. **Anything else** — returns `null` rather than guessing.

**Year inference.** `threadtime` emits `MM-DD`, no year. Assume the current
year, except when that would place the record more than a day in the future —
then use the previous year. Without this, logs read on 1 January from a device
that logged on 31 December jump forward twelve months.

## PID → package

This is the part most likely to be subtly wrong, because PIDs are reused when a
process dies. A wrong package label is worse than none: it is silently
plausible and will send someone debugging the wrong app.

- Resolve **at emit time**, server-side, so the label reflects the moment the
  line was produced. Resolving later — in the client, against a map that has
  since refreshed — can attribute a line to whatever process inherited the PID.
- Cache with a short TTL. On a miss, refresh once; if the PID still is not
  listed, mark it **unknown** and leave `pkg` absent.
- On refresh, drop entries whose PID is no longer listed. Never carry a stale
  entry forward.

## Multiplexing and backpressure

`LogcatMultiplexer` mirrors `H264Multiplexer`: a `Set` of client sinks, and a
ring buffer replayed to each new client so opening the tab shows recent history
immediately rather than an empty pane. Where H.264 replays the current GOP,
this replays the last N records (N = 2000).

**Dropped records must be visible.** `h264StreamWs` drops frames when a socket's
buffered amount exceeds 4MB — correct for video, wrong here. A missing log line
is data loss the reader cannot detect. When the guard fires, emit a synthetic
record in its place:

```
W/xenon  47 lines dropped (slow client)
```

so the gap appears in the log rather than being hidden. Coalesce consecutive
drops into one record with a running count rather than one record per drop.

## Authorisation

The WS upgrade is handled by a listener on the HTTP server, not by the Express
stack, so `deviceAccessGuard` never sees it — the same as `h264StreamWs`.
Authentication is the single-use, udid-bound stream ticket.

**Device logs are treated as an ownership-checked read.** Reads are open by
default under the guard, with `clipboard` carved out because it returns
whatever the holder last copied. Logcat is at least as exposing: it routinely
carries auth tokens, deep-link URLs and PII from whatever app is under test. So
after redeeming the ticket, the WS handler evaluates the same policy the guard
uses (`evaluateDeviceAccess`) and closes with 1008 when the device is held by
another user. Admins bypass, exactly as elsewhere.

This means the ticket alone is not sufficient — a ticket minted before someone
else took the device does not grant a log stream.

## Sizing and timing

Values are stated here so they are not reinvented per file:

| Constant | Value | Reason |
|---|---|---|
| Server replay buffer | 2000 records | Enough that opening the tab shows useful history; bounded so a chatty device cannot grow it without limit. |
| Client buffer | 5000 records | Beyond this the oldest are dropped. Rendering is windowed, so the cost is memory, not frame rate. |
| Idle watchdog | stop 30s after the last client leaves | Long enough to survive a tab reload, short enough not to hold an adb channel per device indefinitely. |
| Package cache TTL | 10s | Short enough that a respawned process is picked up quickly; long enough to avoid a `ps` per line. |
| Reconnect backoff | 500ms doubling to 10s, max 10 attempts | Mirrors `UniversalMjpegProxy`'s bounded retry, for the same reason. |

## Filtering

Client-side only, over the local buffer — instant, and no round trip.

Server-side filtering is deliberately rejected: one `logcat` process serves
every viewer of a device, so pushing a level down to logcat's `*:D` spec would
silently change what other viewers see.

Query grammar, all terms ANDed:

| Term | Effect |
|---|---|
| `level:W` | Minimum level (V < D < I < W < E < F). |
| `tag:Wifi` | Case-insensitive substring on tag. |
| `package:com.android.systemui` | Case-insensitive substring on `pkg`. |
| bare text | Case-insensitive substring on the message. |

A level dropdown in the toolbar writes `level:` into the same query, so the
control and the text box cannot disagree.

## Error handling

| Situation | Behaviour |
|---|---|
| `adb logcat` exits (cable pulled, reboot, adb restart) | Emit synthetic `E/xenon  log stream ended (<reason>)`, close clients, drop the multiplexer so the next viewer starts clean. |
| Ticket invalid or missing | Close with 1008, exactly as `h264StreamWs` does. |
| Client disconnects mid-handshake | Cleanup is registered **before** the `redeem`/`start` awaits. This is the trap already documented in `h264StreamWs.ts`: without it `clientCount` stays inflated and the idle watchdog never stops the process. |
| WS closes unexpectedly | Hook reconnects with bounded exponential backoff. Unbounded retry against a dead device wedges the lab. |
| Non-Android device | The tab renders an unsupported state. Today it shows "Connecting to device syslog…" forever on an iPhone. |
| `adb shell ps` fails | Records still flow with `pkg` absent. Package resolution must never block or drop a log line. |

## Testing

| Spec | Covers |
|---|---|
| `test/unit/logcat-parse.spec.ts` | Every level; continuation lines; `--------- beginning of` banners; malformed input; the year-inference boundary. |
| `test/unit/logcat-multiplexer.spec.ts` | Fan-out to N clients; replay to a late joiner; the drop guard **emits the synthetic warning** and coalesces consecutive drops. |
| `test/unit/package-resolver.spec.ts` | Cache hit/miss; TTL expiry; **a reused PID must not serve the previous process's package**; `ps` failure leaves `pkg` absent without throwing. |
| `test/unit/logcat-ws.spec.ts` | Ticket required; **a device held by another user is refused even with a valid ticket**; admin bypasses; disconnect during redeem still cleans up; disconnect during start still cleans up. |
| `web/src/…/logcatFilter.test.ts` | Query parsing and application, including combined terms and level ordering. |

Discipline carried from recent work in this repo:

- Verify each test is non-vacuous by mutating the behaviour it pins and
  confirming red. Suggested mutations have twice been inert here; if one does
  not exercise the path, build a faithful one and say so.
- Targeted `npx mocha <file>` only — the full suite crashes this repo.
- `npx tsc --noEmit` before merge; CI has no build or test gate.

**Hardware validation** on an isolated auth-enabled server against a real
Android device:

1. Lines stream live, with no duplicates across several minutes.
2. `package:com.android.systemui` filters to that process.
3. Two browser tabs on the same device share **one** adb logcat process.
4. Closing both tabs stops the process (idle watchdog).
5. `adb reboot` produces the end-of-stream record, then reconnects cleanly —
   the cable-pull simulation this repo already uses for stream fixes.

## Out of scope

- iOS log streaming.
- The Shell tab.
- ~~`GET /:udid/logs` — left in place; other callers may depend on it.~~
  **Reversed during implementation.** Leaving it open made the WebSocket's
  ownership check decorative — the same `adb logcat` bytes were readable by
  anyone with `devices` scope, so a reader refused at the socket could just GET
  them. `logs` joined `OWNERSHIP_CHECKED_READS`. External SDK clients polling
  logs on someone else's busy device now get 409.
- Persisting logs server-side or attaching them to recordings.
- Regex or saved filters.

---

## Known follow-ups

Raised by review or hardware validation, deliberately not fixed in the
implementation. Recorded here because the working ledger they were tracked in
is git-ignored scratch. Nothing here is a known-broken path — each is a
judgement call someone should make on purpose rather than inherit.

### Needs a decision, not a fix

**Ticket-borne `isAdmin` has a ≤120s revocation lag, and a WS connection is
authorised once.** The stream ticket carries the minting caller's admin flag
(60s TTL plus `jose`'s 60s `clockTolerance`), and the socket's authorisation is
never re-evaluated after connect. So a demoted admin keeps the bypass for that
socket's life, and a device taken *after* a viewer connects keeps streaming to
them. This matches every other stream in the product (h264, MJPEG) and the spec
only ever required the mint-time property — but this codebase deliberately
re-reads the DB per REST request so revocation is instant, and logcat is now
classed with the clipboard. The asymmetry is worth choosing rather than
drifting into.

**The ownership preamble is triplicated.** `findDevice → isManualLock →
ownerOf → evaluateDeviceAccess` now exists in `deviceAccessGuard.ts`,
`control.ts`, and `ticketActorAccess.ts`. It has already drifted once — the WS
copy shipped without `actorApiKeyId`, denying holders of pre-1.13.0 locks their
own device over the socket while `/control` admitted them. Consolidating means
touching two live REST call sites, which is why it wasn't done here.

### Small, safe, unowned

- **`LogcatMultiplexer.addClient`'s replay loop bypasses `canAccept`** — up to
  2000 sends with no backpressure check and no drop accounting, the only path
  in the file with neither. Bounded well under the 4MB guard, and it mirrors
  `H264Multiplexer`.
- **`replay.splice(0, …)` is O(n) per push at steady state** — a 2000-element
  memmove per line where an index-based ring is O(1). The spec's word is "ring
  buffer"; this is an array shift. Not a practical problem at logcat rates.
- **Two class docblocks are anchored to a constant, not the class** —
  `LogcatMultiplexer`'s sits above `REPLAY_BUFFER_SIZE` and `PackageResolver`'s
  above `DEFAULT_TTL_MS`, so editors surface them on hover over the constant.
  `H264Multiplexer` has the same quirk, which is where it was inherited from.
- **A missing (not invalid) ticket leaves the TCP socket open** rather than
  closing 1008. Matches `h264StreamWs` exactly. On a hub engine.io sweeps it
  after ~1s; on a **node** instance `socketServer.initialize` never runs, so
  nothing does. Pre-existing and not worsened here.

### Beyond this feature

**The SIGTERM race is not logcat-specific.** Appium's own handler exits the
process before the plugin's async cleanup phases run, so `cleanup()` and
`ProcessRegistry.terminateAll()` are both unreliable on SIGTERM. Long-lived
sidecars are now killed synchronously from a `process.on('exit')` hook, but the
underlying ordering problem remains — anything added to the async phases in
future will silently not run on SIGTERM. See "Process shutdown" in `CLAUDE.md`.
