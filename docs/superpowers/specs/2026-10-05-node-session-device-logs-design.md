# Device logs for sessions on a node's phones

Date: 2026-10-05
Status: direction set by the request (mirror the node metrics path); the
details below are this design's.

## Who it is for, and what done means

- **Test engineers on a hub-and-node lab** reading a session's Device logs on
  the hub's session page, whichever server's phone it ran on.
- **Done means:**
  - an Android session on a node's phone, through a hub with the dashboard
    on, has the same Device logs as one on the hub's own phone: each line
    once, its own time and level, the same 10,000 + 2,000 limit and notes;
  - the lines arrive while the session runs, about 10 s behind, and the last
    ones when it ends, before the failure analysis reads them;
  - they survive a hub restart mid-session (collection goes on from the
    newest line stored) and the node restarting or going away afterwards;
  - an older node is named once in the hub's log, and its sessions keep an
    empty tab, as today;
  - a cloud provider's phone is never asked.

## What is wrong today

- `SessionDeviceLogs` records only a phone this server drives (`appliesTo` →
  `isOwnDevice`): the hub has no adb for a node's phone.
- The node has the phone, but writes no Session row for a session its hub
  created, so it has nowhere to put the lines.
- So on a hub, every node session's Device logs tab is empty, and its failure
  analysis is sent no device log.

## Approach: the hub collects from the node, as for CPU and memory

The node records the session with the same `DeviceLogBook` and holds the rows
in memory; the hub asks for new rows every 10 s with the session token it
already sends, and writes them to its own `Log` table with its own ordered
`createdAt`. The session page reads the hub's table, unchanged.

Rejected, for the reasons the metrics design gives: the node pushing to the
hub (new trust), and the hub forwarding the page's read to the node (the
lines would go with the node).

### Generalising what metrics has

The reply rule (an older node is a 401, a 404 or a 2xx without the header,
anything else without it an outage) and the "older node, said once, asked
again after 10 minutes" memory are the same for both routes. They move to
`src/gateway/nodeAsk.ts` (`readNodeReply`, `OlderNodes`); `nodeMetrics.ts`
keeps its names on top of them. `RemoteSession` asks both routes through one
helper.

## On the node

- **Start.** In `registerSession`, beside the node's metrics start: a node
  starts `SessionDeviceLogs` for a local session on its own phone, whatever
  its dashboard setting, from the node's own allocation time. On a node it
  holds the rows (`NodeDeviceLogStore`) instead of writing them.
- **The cap stays here.** The node's book applies the 10,000 + 2,000 limit,
  so a node never sends a hub more than that per session, and its memory for
  one session is bounded by it.
- **Unclaimed sessions stop.** A hub with its dashboard off (the default) or
  an older hub never asks. Recording every such session in full would run a
  log stream and hold up to 12,000 lines per busy phone for nothing. So if no
  hub has asked about a session within `UNCLAIMED_MS` (2 minutes) of its
  start, the node stops recording it and forgets its rows (answers `off`).
  Once asked, it records to the end, whatever happens to the hub.
  Recording from the start (not from the first ask) keeps a session that
  ends at once: its rows stay for the hub's last ask.
- **Stop.** Wherever the node's metrics stop: `deleteSession` (before its
  "still in memory?" check), `onUnexpectedShutdown`, the shutdown drain. The
  book's last note is held, the entry marked `ended`, kept 10 minutes for the
  hub's last ask, then dropped.

### `NodeDeviceLogStore`

Per session: the rows in order, each with a `seq` (1, 2, 3, …), the state
(`recording`, `ended`), whether a hub asked, and when it ended.
`read(sessionId, after)` drops the rows at or before `after` (the hub has
them) and answers up to `NODE_DEVICE_LOG_PAGE` (2,000) more, with `more`
when there are others.

### `GET /xenon/api/node/sessions/:sessionId/device-logs?after=<seq>`

Beside the metrics route, ahead of the login, through the same
`answerForHub`: with per-command auth on, only the hub's session token for
that session; with it off, nothing, as for a command to the session (which
could read the same lines with `getLog('logcat')`).

```json
{ "value": { "state": "recording", "lines": [{ "seq": 1, "message": "…", "timestamp": 1730000000000 }], "more": false } }
```

`state` is `off` for a session the node doesn't record. Every answer carries
`x-xenon-node-device-logs: 1`.

## On the hub

- `SessionDeviceLogs.appliesTo(device, source)` adds a node's Android phone
  whose session is a `RemoteSession`; never a cloud provider's, never on a
  node. `onSessionStarted` passes the session as the source.
- A `NodeDeviceLogsCollector` asks at once (so the node knows it is wanted),
  then every 10 s, after the newest `seq` it has, through `RemoteSession`'s
  own call (the node's origin, the session token), 5 s timeout. While the
  node says `more`, it asks again at once, at most 10 pages a round. Each
  answer's rows go into the service's buffer and are written right away,
  each `createdAt` a millisecond after the one before.
- **When the session ends** `stop` asks once more (the node ended it first:
  the hub's DELETE forward has returned), unless the node wasn't answering.
  The service then writes what is left, before the failure analysis.
- `state` `off` or `ended` with nothing more, a refusal (404 with the header)
  or an older node: stop asking. Unreachable or 503: ask again, logged once
  per outage.

### After a hub restart

`recoverActiveSessions`, with the hub's dashboard on, starts collection for
each recovered node session with `resume`: the service reads the newest
`DEVICE` row stored (`(session_id, log_type, createdAt)` index) for two
things:

- its `createdAt`, so new rows sort after it;
- its message and timestamp. The node still holds the last page the hub
  received (it drops rows only when the next ask names them), so the first
  answer after a restart can repeat rows the hub wrote. The collector drops
  that answer's rows up to the stored newest one, if it is among them.

Rows the hub received and hadn't written when its process died are lost; they
are written as soon as they arrive, so that is one write's worth.

## Failures

| Situation | What happens |
|---|---|
| Node unreachable or slow | Rows wait on the node (bounded by the book); asked again; one log line per outage. |
| Node refuses the token | Stop asking. |
| Hub's write fails | Rows wait in the buffer for the next write (5 s timer); the node's cap bounds them. |
| Node restarts mid-session | The session dies with it; nothing more to collect. |
| Hub and node clocks differ | A row's time is the node's clock (the node already corrects the phone's). Lab servers keep NTP time; not corrected here. |
| A hub that never asks | The node stops recording the session after 2 minutes. |

## Cost

- One `GET` per running node session every 10 s, beside the metrics one.
- Node memory: at most the book's 12,000 lines a session, in practice 10 s
  of them; nothing after 2 minutes for a session no hub collects.
- Hub writes: the same as for its own phone.

## Compatibility

- Both sides need this release. An older node: the hub logs it once and asks
  again after 10 minutes. An older hub: the node stops after 2 minutes.
- No configuration, no migration.

## Out of scope

- iPhones and simulators on a node: the node records what its
  `SessionDeviceLogs` records, so they follow when it does (another branch).
- `xe:save_device_logs`: its meaning is being changed on another branch; its
  gate belongs at both start calls (the hub's in `onSessionStarted`, the
  node's in `registerSession`).

## Testing

- `NodeDeviceLogStore`: seq, `after`, paging, end and pruning, unknown is
  `off`, claimed.
- The route: the token rule, 503, the header, only on a node.
- The reply reader: older node, outage, refusal, malformed rows dropped.
- The collector against a fake node: the first ask at once, `after`, paging,
  the last ask, `off`/`ended`/refused/older node, outage logged once, the
  resume skip.
- The service: hub mode writes collected rows in order; node mode holds, ends,
  and stops an unclaimed session.
- Lifecycle: the node starts and stops on every ending; the hub resumes.
- Hub and node in one process (Appium's own server, the real gateway and
  routes, per-command auth on), the node's log stream fake.
- Live: hub and node on scratch ports with the lab S9+ on the node.
