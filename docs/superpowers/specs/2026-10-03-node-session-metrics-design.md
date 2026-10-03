# Performance figures for sessions on a node's phones

Date: 2026-10-03
Status: design agreed in conversation, in two parts: what runs where, then
failures and tests. Live figures were chosen over figures after the session
ends.

## Who it is for, and what done means

- **Test engineers on a hub-and-node lab.** They watch a session's CPU and
  memory on the hub's session page, as the test runs, whichever server's
  phone it runs on.
- **Done means:**
  - a session on a node's phone shows the same Performance panel as one on
    the hub's own phone: device CPU and memory, and the app's, on Android;
    device CPU on an iPhone;
  - the chart fills in while the session runs, at most about 10 s behind;
  - the figures stay on the hub after the session ends, after the node
    restarts or goes away, and after the hub restarts;
  - an older node, or a node that doesn't sample, says "isn't recorded",
    never "Collecting…" for ever.

## What is wrong today

- **Only a hub or a standalone server samples.** Sampling starts in
  `EventManager.onSessionStarted`, which only a hub runs
  (`SessionLifecycleService.finalizeSession`, `isHub`: no `hub` setting). A
  node never runs it.
- **A hub samples only its own phones.** `SessionMetricsService.appliesTo`
  checks `isOwnDevice`, and a hub has no adb or go-ios path to a node's
  phone.
- **A node can't simply store samples.** `SessionMetric.session_id` points at
  a `Session` row, and a node writes no Session row for a session the hub
  created.
- So the hub's panel shows every session on a node's phone as "isn't
  recorded". In a lab built from nodes, that is most sessions.

## Approach: the hub collects from the node

The node samples its own phones and keeps the samples in memory. The hub
asks the node for new samples every 10 s, with the session token it already
sends with every call about that session, and stores them in its own
`SessionMetric` table. The session page reads the hub's table, unchanged.

Rejected:

- **The node sends to the hub.** The node's credential for the hub is an
  access-key pair, which is a user's key, not the node's identity. The hub
  would have to decide which node may write samples for which session: new
  trust to get right. Collecting uses the direction of trust that exists
  already, hub to node.
- **The hub forwards the page's read to the node.** The node would need
  Session rows of its own, and the figures would go when the node restarts,
  is cleaned up or is down. The hub's page would depend on the node being up.

## On the node

### Sampling a session the hub created

- In `finalizeSession`, a node (a `hub` setting) starts
  `SessionMetricsService` for a local session on one of its own phones,
  whatever its dashboard setting. A hub and a standalone server keep starting
  it in `onSessionStarted`, as now.
- `appliesTo` is unchanged: Android phones and emulators, real iPhones, this
  server's own phones, and `sessionMetrics` not false.
- On a node the service keeps the samples in memory instead of writing them
  (`NodeMetricsStore`, below). The sampler, the 2 s interval and the give-up
  rule (five failures in a row) are the same code as on a standalone server.
- It stops when the session ends on the node, whatever its dashboard setting:
  `deleteSession` (before its "is the session still in SESSION_MANAGER"
  check, which a dashboard-off node fails), `onUnexpectedShutdown`, and
  shutdown. `stop` is idempotent, so a second call does nothing.

### `NodeMetricsStore` (in memory)

One entry per session this node samples:

- **`samples`**: in time order. At most the newest 900 (30 minutes, as
  `MAX_BUFFERED_SAMPLES`).
- **`state`**: `sampling`, `stopped` (the sampler gave up) or `ended` (the
  session ended here).
- **`platform`**: the phone's.
- **`acknowledged`**: the newest `after` the hub has asked with. Samples at
  or before it are dropped, since the hub has them.
- **`endedAt`**: when the session ended. The entry is dropped 10 minutes
  after, so a hub's last collection still finds it, and a node whose hub
  never asks (an older hub) frees it.

### `GET /xenon/api/node/sessions/:sessionId/metrics?after=<ms>`

Mounted only on a node, beside the session-status route
(`registerNodeSessionStatus`), ahead of the login, with the same access rule:

- **With per-command auth on** (`XENON_REQUIRE_COMMAND_AUTH`, auth enabled),
  it needs the hub's session token for that session (`x-xenon-hub-token`,
  audience `xenon-node`, claim `sid`). Anyone else gets the unknown-session
  answer, `404`. A JWKS that can't be fetched is `503`.
- **With it off**, nothing, as for a command to the session.

It answers `200`:

```json
{ "value": { "platform": "android", "state": "sampling", "samples": [ ... ] } }
```

- `samples` are those newer than `after` (all of them without `after`), in
  the shape the samplers produce (`MetricSample`: `at`, `deviceCpuPct`,
  `deviceMemMb`, `deviceMemTotalMb`, `appCpuPct`, `appMemMb`, `appId`), so
  neither side converts them.
- `state` is the entry's, or `off` for a session the node has no entry for: one
  it doesn't sample (sampling off, a simulator), or doesn't know.
- Every answer carries `x-xenon-node-metrics: 1`, so a hub can tell a node
  that has the route from an older one (a `404` or a `401` from its login,
  without the header).

The samples carry the app's package name, so the route is guarded exactly
like a command to the session, never less.

## On the hub

### Collecting

- For a session on a node's phone, `SessionMetricsService.start` (from
  `onSessionStarted`, after the session's row is written) runs a
  `NodeMetricsCollector` in place of a phone sampler. It is a
  `MetricsSampler`, so the service's buffer, its 10 s writes, the newest-900
  rule when writes fail, and `recordingState` all work unchanged.
- `appliesTo` grows one case: a node's phone (another server's, not a cloud
  provider's) whose session is a `RemoteSession`. A cloud phone stays
  unsampled. `MetricsStart` gains the session, so the collector can call
  the node through it; `onSessionStarted` has it in hand.
- Every 10 s the collector asks the node for samples after the newest one it
  has, through `RemoteSession`'s own `call` (the node's origin, the session
  token), with a 5 s timeout. Each sample goes to the service's `onSample`.
- **When the session ends**, `stop` asks once more, after the hub's forward of
  the `DELETE` has returned and the node has stopped its sampler, then
  returns. The last seconds are kept.

### What the panel shows for a running node session

`recordingState` maps the node's last answer:

| Node said | Hub reports | Collector |
|---|---|---|
| `sampling` | `sampling` | keeps asking |
| `stopped` | `stopped` | takes what's left, then stops asking |
| `off` | `off` | stops asking |
| `ended` (the node ended it first; the last collection) | `stopped` until the hub ends the session | takes what's left, then stops asking |
| no route (older node) | `off` | stops asking for this session; that node is asked again for a new session after 10 minutes (`NodeMetricsSupport`, as `NodeSessionProbeSupport`) |
| nothing yet | `sampling` | the first answer comes within 10 s |

### After a hub restart

`SessionManager.recoverActiveSessions` rebuilds each node session's
`RemoteSession`. With the dashboard on (the only case with a panel to fill),
it then starts the collector for it, from the newest sample the hub already
stored (`max(at)` in `SessionMetric`). A gap of up to 30 minutes is filled
from the node's memory.

## When something goes wrong

| Situation | What happens |
|---|---|
| Node unreachable, or slow to answer | The collector keeps what it has and asks again next round. It never gives up on its own: whether the session is alive is the heartbeat's call. One log line per outage, not one per round. |
| Node refuses the hub's token (`404`) | The session is gone, or isn't the hub's. Stop asking. |
| Node can't fetch the hub's JWKS (`503`) | Ask again next round. |
| Hub's database write fails | The samples wait in the service's buffer, newest 900, as for a local session. |
| Node restarts mid-session | The Appium session dies with it. Nothing more to collect. |
| Clocks differ | No effect. The hub stores the node's timestamps unchanged, the chart uses times relative to the first sample, and `after` is in the node's own time. |
| The same sample twice | Can't happen: the node answers only samples newer than `after`. |

## Cost

- **Requests:** one small `GET` per running node session every 10 s, so 50
  sessions is 5 requests a second.
- **Node memory:** at most 900 samples a session, about 135 KB, and in
  practice under 10 s worth, since each collection drops what the hub has.
- **Hub writes:** the same as for a local session.

## Compatibility

- **Upgrade both sides.** Figures need the node and the hub on this release.
- **An older node** keeps "isn't recorded" for its sessions.
- **An older hub** never asks, so the new node's entries are dropped 10
  minutes after each session ends.
- **No configuration, and no migration.**

## Out of scope

- Per-app figures on an iPhone (go-ios gives device CPU only), on a node or
  locally.
- Cloud providers' phones.
- Sending figures from a node to a hub that isn't its own.

## Testing

Each test is written first and watched failing.

- **`NodeMetricsStore`:**
  - `after` returns only newer samples;
  - the store keeps at most 900;
  - collected samples are dropped;
  - an ended session is kept 10 minutes, then dropped;
  - an unknown session is `off`.
- **The node route:**
  - with per-command auth on, the right token is accepted, and another
    session's token, a forged token or no token gets the unknown-session
    answer;
  - an unreachable JWKS is `503`;
  - with per-command auth off, no credential is needed;
  - every answer has the support header;
  - the route isn't mounted on a hub or standalone server.
- **Node lifecycle:**
  - a session the hub created is sampled whatever the node's dashboard
    setting;
  - sampling stops on delete, on an unexpected shutdown and at shutdown;
  - a hub and a standalone server start sampling where they did.
- **The collector**, against a fake node:
  - the `after` position;
  - the last collection on stop;
  - each row of the state table above;
  - an unreachable node is asked again and logged once.
- **Hub restart:** collection resumes from the newest stored sample.
- **Hub and node together:** the existing in-process hub-and-node harness,
  with a stub sampler on the node. A session on the node's phone shows
  samples on the hub's `GET /session/:id/metrics` during the run and after
  it ends.
- **Live:** a hub and a node on the lab Mac, the Galaxy S9+ on the node.
  - A session through the hub fills the hub's Performance panel as it runs,
    and keeps the figures after it ends and after the hub restarts.
  - An iPhone on the node shows device CPU.

## Documentation

- **CLAUDE.md:** replace "A node's phones get no figures" with how the hub
  collects them, and add the new route to the node routes beside session
  status.
- **CHANGELOG:** both sides must be upgraded for the figures.
