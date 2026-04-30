---
title: Remote Execution
hide:
  - navigation
---

# Remote Execution (Hub & Node)

Xenon scales horizontally by separating two concerns onto two roles:

- **Hub** — a coordinator that holds the global device registry, routes session requests, and serves the dashboard.
- **Node** — a worker that plugs in physical devices, simulators, and emulators and pushes its inventory to a hub.

Both run the same Xenon plugin under Appium. The role is decided at startup by a single flag (`--plugin-xenon-hub`).

---

## Transport

The hub-node channel is **HTTP REST** for the control plane (registration, device updates, unblocks) and **Socket.IO** for real-time fan-out (session state, device state, healing events) to the dashboard.

| Path | Direction | Purpose |
|---|---|---|
| `POST /xenon/api/register?type=add` | Node → Hub | Push newly discovered devices |
| `POST /xenon/api/register?type=remove` | Node → Hub | Remove a device that disappeared |
| `POST /xenon/api/register?type=unregister` | Node → Hub | Pull a node out of the grid |
| `POST /xenon/api/unblock` | Node → Hub | Release a manually-blocked device |
| Socket.IO (default namespace) | Hub ⇄ Dashboard, Hub ⇄ Node | Live state broadcasts — see [Real-time Events](real-time-events.md) |

All node→hub requests authenticate with the per-node `(X-Xenon-Access-Key, X-Xenon-Token)` pair the node was provisioned with on the hub. See [Security](enterprise-security.md#hub-node-channel-authentication) for the provisioning flow.

---

## Starting a Hub

A hub is an Appium server with the Xenon plugin and **no `--plugin-xenon-hub` flag**:

```bash
appium server --use-plugins=xenon -pa /wd/hub \
  --plugin-xenon-platform=both \
  --plugin-xenon-enable-dashboard \
  --plugin-xenon-database-provider=postgresql \
  --plugin-xenon-database-url="postgresql://user:pass@db:5432/xenon"
```

The hub listens on `4723` by default. The dashboard is served at `http://<hub-host>:4723/xenon`. Sign in as the bootstrap super-admin (see [Security → First-run bootstrap](enterprise-security.md#first-run-bootstrap)) and provision a User per node before bringing any nodes up.

---

## Starting a Node

A node points at the hub via `--plugin-xenon-hub` and authenticates with the pair-auth env vars the hub provisioned:

```bash
export XENON_HUB_ACCESS_KEY="xen_..."   # access key from /profile on the hub
export XENON_HUB_TOKEN="..."             # token minted under the node's user

appium server --use-plugins=xenon -pa /wd/hub \
  --plugin-xenon-platform=android \
  --plugin-xenon-hub=http://hub.internal:4723
```

Both REST `/register` calls and the Socket.IO handshake use this pair. On startup the node:

1. Discovers locally connected devices — USB-attached real devices, booted simulators or emulators, plus remote ADB hosts when `adbRemote` is set.
2. Posts the inventory to `<hub>/xenon/api/register?type=add`.
3. Re-syncs the inventory every `sendNodeDevicesToHubIntervalMs` (default `30000` ms).
4. Posts removals as devices disappear.

If the node is behind a NAT or is reachable at a public address different from its local bind, set `remoteMachineProxyIP` so the hub knows which URL to hand to clients when it forwards a session.

---

## Hub-side liveness

The hub prunes silent nodes by checking `lastSeen` timestamps every `checkStaleDevicesIntervalMs` (default `30000` ms). If a node misses several intervals — host crash, network partition, container restart — its devices are removed from the registry and any in-flight sessions on that node are released back to the queue.

`checkBlockedDevicesIntervalMs` (default `30000` ms) re-evaluates manually-blocked devices on the same cadence, so they re-enter the pool when a maintainer unblocks them via the dashboard or API.

### Tuning the timers

Four interval primitives govern how quickly state propagates between node, hub, and dashboard. The defaults work for most labs; tune them when you need either tighter detection (paid-per-minute cloud devices) or quieter networks (low-bandwidth links, expensive metered hosts).

| Setting | Where it runs | Default | Drives |
|---|---|---|---|
| `sendNodeDevicesToHubIntervalMs` | node (outbound) | 30 s | How often the node *re-asserts* its device inventory to the hub — the heartbeat that the hub's stale-detector watches for. Lower = faster recovery from a node restart but more REST calls; higher = quieter network but slower recovery. |
| `checkStaleDevicesIntervalMs` | hub (sweep) | 30 s | How often the hub *examines* each registered node's `lastSeen` to decide whether to evict its devices. Lower = faster eviction of crashed nodes but more DB reads; higher = stale devices linger but the hub does less work. |
| `checkBlockedDevicesIntervalMs` | hub (sweep) | 30 s | How often the manual-block reconciler runs (releases manual locks whose actor is gone, surfaces "still blocked" devices in the picker). |
| `sessionHeartbeatIntervalMs` | both (per-session) | 30 s | How often a session's `last_heartbeat_at` is bumped while running. The `OrphanSweeper` fails sessions older than `3 × sessionHeartbeatIntervalMs`. Lower = faster orphan detection (e.g. ~120 s worst-case at default) but more writes; higher = slower detection of crashed Appium drivers. |

#### "Heartbeat" vs "node monitor" — which timer detects what

These primitives interlock. A node going dark surfaces in two places:

1. **Node-level** — the node stops calling `POST /api/register?type=add` (controlled by `sendNodeDevicesToHubIntervalMs`). The hub's stale-detector (controlled by `checkStaleDevicesIntervalMs`) eventually evicts the node's devices.
2. **Session-level** — any in-flight Appium session on that node stops bumping its heartbeat (controlled by `sessionHeartbeatIntervalMs`). The `OrphanSweeper` fails the session and releases the device.

In a clean single-node failure, *both* clocks fire — and whichever expires first determines worst-case detection latency. Default-tuned, the floor is around `2 × 30 s + max(checkStaleDevicesIntervalMs, 3 × sessionHeartbeatIntervalMs)` ≈ ~150 s. Halving the heartbeat to 15 s without halving the node-side push only buys you faster *session* failure; the *device* still hangs around until the stale-detector catches up.

Recommended pairings:

- **Tight CI labs** — `sendNodeDevicesToHubIntervalMs: 10000`, `checkStaleDevicesIntervalMs: 10000`, `sessionHeartbeatIntervalMs: 10000`. Detects in ~30 s at the cost of 3× network and DB pressure.
- **Quiet metered networks** — keep all four at the default 30 s; that's already conservative.
- **Soak labs / overnight CI** — push everything to 60 s. Saves visible network traffic; worst-case detection is ~5 min, which is fine when no one is watching.

Don't tune one timer in isolation — the lopsided tuning above (only `sessionHeartbeatIntervalMs` halved) is the most common foot-gun.

---

## Shared state (PostgreSQL)

For multi-hub deployments — or a single hub that needs to survive restarts without losing build, session, healing, or selector-health history — point `databaseProvider` at PostgreSQL and share a single `DATABASE_URL` across all hub instances.

```yaml
plugin:
  xenon:
    databaseProvider: postgresql
    databaseUrl: postgresql://user:pass@db.internal:5432/xenon
```

Every hub then reads and writes the same registry, session log, healing history, and selector-health lifecycle. Workers are pinned to a single hub at a time but can be moved by simply pointing the node's `--plugin-xenon-hub` at a different hub.

---

## Outbound TLS

When a node talks to a hub over HTTPS, the node verifies the hub's TLS certificate by default. For dev/test against self-signed certs, set `tlsRejectUnauthorized: false` on the node — and only there.

```yaml
plugin:
  xenon:
    hub: https://hub.internal
    tlsRejectUnauthorized: false   # development only
```

---

## Dashboard

Once the hub is running, point a browser at `http://<hub-host>:<port>/xenon`. The dashboard lists every device the hub has heard about, grouped by node, with live status and session activity. There is no separate "node dashboard" — nodes are headless workers.

---

## Test execution

Point your Appium client at the hub, not the node:

```javascript
const opts = {
  hostname: 'hub.internal',
  port: 4723,
  path: '/wd/hub',
  capabilities: { platformName: 'Android', /* ... */ },
};
```

The hub picks an eligible device, holds a server-side proxy to the owning node for the lifetime of the session, and forwards every Appium command transparently. The client never talks to the node directly.
