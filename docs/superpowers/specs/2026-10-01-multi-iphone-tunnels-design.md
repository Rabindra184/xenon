# Several iOS 17+ iPhones streaming on one Mac: a tunnel per phone

Date: 2026-10-01
Status: design approved in conversation, section by section. Awaiting review
of this written spec.

## Why

On iOS 17 and later, every go-ios command that talks to a phone (`runwda`,
`syslog`, `screenshot`) goes through a go-ios tunnel, found through that
tunnel's info API. Today:

1. **Every phone's tunnel takes the same ports.** `IOSStreamService.ensureTunnel`
   starts `ios tunnel start --udid <phone> --userspace` with no info port. go-ios
   then serves the info API on its default, 60105 (`defaultHttpApiPort`,
   `ios/connect.go`), and the phone's userspace tunnel on 60106.
2. **A second phone kills the first one's tunnel.** Before starting a tunnel,
   `cleanupOrphanTunnels` kills whatever listens on 60105 and 60106. When a
   second iOS 17+ iPhone starts a stream, that is the first iPhone's live
   tunnel. Its WDA loses the phone, and so does its preview or recording.
3. **The second phone's other commands go to the wrong tunnel.** `syslog` and
   `screenshot` for any phone look the phone up on 60105, which serves only the
   phone whose tunnel took it.

So only one iOS 17+ iPhone per Mac can stream at a time. That is the main
limit for an iOS-heavy lab.

**What go-ios 1.2.1 (the version Xenon bundles) supports.**
- `ios tunnel start --udid X --tunnel-info-port P` runs an isolated per-device
  agent (`NewTunnelManagerForDevice`). Its usage text says to "run one per
  device on its own --tunnel-info-port".
- go-ios derives that agent's userspace port from its info port: P + 1
  (`basePort + portOffset`).
- Every command finds a phone's tunnel through `--tunnel-info-port`, or the
  `GO_IOS_AGENT_PORT` environment variable (`ios.HttpApiPort()`), defaulting to
  60105.
- `GET :P/tunnel/<udid>` answers 404 until the phone's tunnel exists, then 200
  with its address, RSD port and userspace port.
- Xenon sets `ENABLE_GO_IOS_AGENT=yes`, which does not start go-ios's
  auto-agent (only `user` or `kernel` do). Each `tunnel start` is its own
  process.

## Decisions

| Question | Decision |
|---|---|
| One tunnel per phone, or one shared tunnel for all | **One per phone** (approach A). A phone's failure, restart or unplug can't disturb another's, and it matches how streams already start and stop per phone. A shared agent would put every iPhone in one failure domain and pair every connected phone. |
| How a command finds its phone's tunnel | **`GO_IOS_AGENT_PORT` in the command's environment.** go-ios reads it for every command, so no argument changes. |
| A phone's tunnel ports | **A pair leased from a new `tunnel` range, 12100–12199** (up to 50 phones): an even port P for the info API, and P + 1, which go-ios uses for the phone's traffic. |
| When a phone has a tunnel | **While it streams**, as today. Logs and screenshots use the phone's tunnel if one runs; they don't start one. |
| How to prove it | **On two real iOS 17+ phones**: the lab iPhone and a second device the user connects. Nothing ships before that check. |

## Design

### `IOSTunnels` (new, `src/device-managers/ios/IOSTunnels.ts`)

It owns every go-ios tunnel this server runs, one per iOS 17+ phone, keyed by
udid.

- **`ensure(udid): Promise<number | null>`.** Returns the phone's info port,
  or null for a phone below iOS 17 (it reads the version with `ios info`, as
  `ensureTunnel` does today). If the phone has a live tunnel, it returns that
  tunnel's port. Otherwise:
  1. It reaps that phone's own leftover tunnel processes (`reapTunnelsForUdid`),
     unless an Appium session holds the phone (see Cleanup).
  2. It leases a pair: `PortAllocator.acquirePair('tunnel', udid, ttl)`.
  3. It starts `ios tunnel start --udid <udid> --userspace --tunnel-info-port <P>`,
     detached so it leads its own process group (`tunnelSpawnOptions`), and
     tracks it in `ProcessRegistry` as today.
  4. It waits up to 20 s for `GET http://127.0.0.1:<P>/tunnel/<udid>` to answer
     200. If it doesn't, it logs a warning and returns P anyway, as today's start
     goes on; `runwda` then reports the failure.
- **`portFor(udid): number | undefined`.** The phone's info port while its
  tunnel runs.
- **`envFor(udid): NodeJS.ProcessEnv`.** `process.env` with
  `ENABLE_GO_IOS_AGENT=yes` and, when the phone has a tunnel,
  `GO_IOS_AGENT_PORT=<P>`. Every go-ios spawn for a phone uses it.
- **`stop(udid)`.** Kills the phone's tunnel process group
  (`killProcessGroup`), releases its pair and forgets it.
- **A tunnel that exits on its own** (phone unplugged, go-ios crash): its exit
  handler releases the pair and forgets it. The next `ensure` starts a new one.
- **`touch(udid, ttl)`.** Extends the pair's lease. The stream watchdog calls
  it each tick, as it does for the WDA and MJPEG ports.

### `PortAllocator.acquirePair(purpose, udid, ttl)` (new)

It leases two adjacent ports, an even P and P + 1, both in the purpose's range,
both free in the lease table and at the OS (the same `isOsFree` probe
`acquire` uses). It skips a pair if either port is taken and releases a
half-taken pair. The new `tunnel` purpose has the range `[12100, 12199]`.
`release` and `touch` work on each port as they do now.

### The commands that need a tunnel

They get `IOSTunnels.envFor(udid)` as their environment:
- `runwda` in `IOSStreamService` (the stream's WDA);
- `syslog` in `IOSLogStreamService` (live logs);
- `screenshot` in `WDAClient` (device control's fallback screenshot).

With no tunnel for the phone, `envFor` returns today's environment, so they
behave as today.

### `IOSStreamService`

- **Start:** it calls `IOSTunnels.ensure(udid)` where it calls `ensureTunnel`
  today. `ensureTunnel` and the fixed-port constants go.
- **Stop:** `stopStream` calls `IOSTunnels.stop(udid)` in place of
  `killProcessGroup(session.tunnelProcess?.pid)`.
- **Watchdog:** each tick it also `touch`es the phone's tunnel pair.

### Cleanup

- **`cleanupOrphanTunnels(udid)`** reaps only that phone's own leftover
  processes. The kill of whatever listens on 60105 and 60106 is removed. It is
  still skipped while an Appium session holds the phone or its row can't be read
  (`appiumSessionMayUse`). That session may drive the stream's WDA through the
  phone's tunnel. The rule stays the same; it now only ever concerns that phone.
- **`stopStream(udid, { forViewer: true })`** still stops nothing, the tunnel
  included, while an Appium session holds the phone and the stream launched its
  own WDA.
- **Boot:** it still reaps every process running the bundled go-ios binary,
  since a fresh server owns no tunnels. That also clears a single-port tunnel
  left by an earlier Xenon. It then deletes this server's `tunnel` leases.
- **Shutdown:** unchanged. `ProcessRegistry` SIGKILLs the tunnel's process
  group on exit.

### Two Xenon servers on one Mac

Each has its own lease table. The OS probe in `acquirePair` stops them taking
the same pair, and nothing uses go-ios's fixed default ports any more.

## Out of scope

- Starting a tunnel for logs or a screenshot on a phone that isn't streaming.
- go-ios's shared agent mode (`ENABLE_GO_IOS_AGENT=user`) and kernel tunnels.
- Pre-iOS 17 phones: they need no tunnel and are unaffected.

## Testing

**Unit tests, written to fail first, with go-ios, HTTP and the allocator
faked:**

- **`IOSTunnels`:**
  - a phone below iOS 17 gets no tunnel;
  - `ensure` leases a pair and starts `tunnel start --udid X --userspace --tunnel-info-port P`, detached;
  - it is ready only once `/tunnel/<udid>` answers 200, and it times out with a warning;
  - a second phone gets a different pair;
  - a live tunnel is reused;
  - `stop` kills only that phone's group and releases its pair;
  - a tunnel that exits on its own releases its pair;
  - `envFor` sets `GO_IOS_AGENT_PORT` only while the phone has a tunnel.
- **Cleanup:** the per-phone sweep never touches another phone's processes or ports, and it is skipped while an Appium session holds the phone.
- **Boot:** it drops the `tunnel` leases.
- **`PortAllocator.acquirePair`:**
  - it takes an even P and P + 1;
  - it skips a pair whose second port is leased or held at the OS;
  - it throws when the range is exhausted.
- **`runwda`, `syslog` and `screenshot`:** each runs with its own phone's `GO_IOS_AGENT_PORT`, and with today's environment when there is no tunnel.
- **Regression:** the full unit suite and the existing iOS stream specs.

**On two real iOS 17+ phones**, through a scratch server built from the
branch. The lab server isn't touched, but it must not be streaming an iPhone,
since the scratch server's boot reap would end that stream.

1. Preview both in Live Devices for a few minutes, with frames advancing on
   both. Two tunnel processes on distinct ports; `ios tunnel ls
   --tunnel-info-port P` on each lists only its phone.
2. Record both as a group. Both videos and the composite are valid, each
   covering the whole recording.
3. Stop, then restart, one phone's preview. The other keeps streaming, and its
   tunnel's process id doesn't change.
4. Unplug one phone (the user, physically). The other keeps streaming.
   Replugged, the first streams again.
5. Run an Appium session on one phone while the other previews. Both work, and
   ending the session leaves the other phone alone.
6. Live logs and a screenshot on each phone.
7. Regressions:
   - a single iPhone previews and records as before;
   - the Android S9+ preview is unaffected;
   - the server log shows no fixed-port kills.

## Risks

- **A port held outside Xenon** can make `acquirePair` skip a pair. With a
  50-pair range, that only matters past about 50 phones.
- **The 20 s readiness wait** may be short for a first pairing, which shows a
  trust prompt on the phone. A timeout only warns, as today, and the start goes
  on.
