# Phone identity by udid and host, part 1: the server

Status: approved design, 2026-11-13. Part 2 (the dashboard) gets its own spec.

## Problem

A phone is a Device row keyed by udid **and** host, but most of the server
finds one by udid alone, and the first row wins. Two servers can report the
same udid: `emulator-5554` is every machine's first emulator, so a hub with
its own emulator and a node with one is an ordinary lab. Then:

- **Device control** (`/control/:udid/...`, 28 routes): the team guard, the
  ownership guard and the hub's forwarding gate (`nodePhoneControl`) all look
  the phone up with `findControlDeviceInStore` (`findDevice({ udid })`), and
  the handlers again with `getDeviceInfo(udid)`. A tap meant for the node's
  emulator can go to the hub's own, or the reverse.
- **Stream tickets** are bound to a udid only, and their sockets (H.264,
  logcat, the MJPEG `?ticket=` route, the hub's relay to a node) resolve the
  phone the same way.
- **Recordings** look phones up by udid in the busy check, the source
  (`recordingSourceFor`, `ensureMjpegForRecording`), `isRecording`, the
  active-recordings list and the group's maps. Recording a test's own
  sessions (2.33) refuses such a phone (`409 shared_udid`) for that reason.
- **`PUT /device/:udid/team`** moves every phone of the udid.

Already host-aware: leases (`udid@host`), `/block` and `/unblock`, tags,
reservations, device settings, discovery, and the stream services' own row
(`findOwnDevice`).

## The rule

One resolver, `findPhone(udid, { host?, teamIds })`, in
`src/middleware/controlDevice.ts` beside the lookup it replaces:

- **With a host:** the row with exactly that udid and host, or none. The host
  is the row's `host` string as the device list reports it.
- **Without a host:** among the rows with that udid the caller's teams can see
  (`isDeviceVisible`, `teamIds === undefined` sees all):
  - one: that phone;
  - none: none (the unknown answer);
  - two or more: **ambiguous**.
- A row the caller can't see is never returned and never named. A host that
  names a hidden phone is the unknown answer, as a hidden udid is today.

**Ambiguous** answers `409 { error: 'ambiguous_phone', message, hosts }`.
`hosts` lists the visible rows' hosts, so the caller can repeat the request
with one. The message, for testers: "Two servers have a phone named
<udid>. Name the one you mean with its host."

A lab where every udid is on one server sees no difference anywhere.

## Device control

- `?host=` on any `/control/<udid>/...` request is read with the udid
  (`readControlUdid` returns both; the memo keys on both). A host that isn't
  a non-empty string is `400 { error: 'invalid_host' }`.
- The team guard resolves through `findPhone`. Hidden or unknown: the
  existing `HIDDEN_DEVICE_UDID` swap, so every later layer gives its unknown
  answer. Ambiguous: the `409`, answered by the team guard itself, before the
  ownership guard (whose 409 names a holder).
- The ownership guard, the hub's gate and every handler use the one resolved
  row (memoized on `res.locals`). `getDeviceInfo(udid)` reads it instead of
  querying by udid.
- **On a hub**, the gate forwards to the resolved row's node and drops `host`
  from the forwarded query: a node's own phones are unique on that node, so
  nodes of any 2.x version keep working.
- This server's own phone is driven by udid with this server's own adb and
  go-ios. Udids are unique among one server's own phones, so that is exact.

## Tickets and sockets

- `stream/ticket` runs behind the resolver, so the ticket carries the
  resolved host as a signed claim (`host`) beside `udid`.
- Redeeming takes udid and the ticket's host: the MJPEG `GET stream?ticket=`,
  the H.264 and logcat sockets and the hub's socket relay all resolve the
  phone with `findPhone(udid, { host })`. A ticket must match both.
- A ticket without a `host` claim (minted before the update; they live 60 s)
  resolves by the udid-only rule.

## Recordings

- `POST /recordings` `udids` entries are a udid string or `{ udid, host }`.
  A string follows the udid-only rule (one visible phone, or the `409` for the
  whole request, nothing started). `add-device` takes `udid` and an optional
  `host` the same way.
- Inside, a recorded phone is `udid@host` everywhere:
  - the busy check (`findBusy` takes phones, reads each row by udid and host;
    `isRecording(udid, host)` counts `RECORDING` rows on `device_udid` and
    `device_host`);
  - the source: another server's phone gets a relay to the named host's node
    (`recordingSourceFor` takes the row); this server's own phone its own
    stream, as today;
  - holds (`blockDeviceFn` / `unblockDeviceFn` already take a host);
  - the group's maps, the composite's inputs, `add-device`'s checks;
  - `GET /recordings/active`'s hold lookup (`device_udid` and `device_host`);
  - `stream/stop`'s "being recorded" check, by udid and host.
- Recording a test's own sessions already resolves exact phones; its
  `shared_udid` refusal is removed, with its dependency and docs.
- A recording is visible to a member by its own phone's team: the Device row
  of its udid on its `device_host`, else the udid's only row (so a lab with
  unique udids sees no change), never the other same-named phone's. The
  owner's fallback for a phone with no row asks the same.
- A group's zips (videos and proof bundle) name a udid two of its phones
  share `<udid>@<host>`, so neither replaces the other; a unique udid keeps
  its name.
- A `device_busy` entry names the phone's `host` beside its `udid`.

## The team route

`PUT /device/:udid/team` takes an optional `host` (body or query). With it,
only that phone (connected or saved) moves. Without it, the udid moves as
today when one host has it, and gets the `409` when two do.

## Reported

- `/sdk/version` lists `phone-host`; `GET /capabilities` reports
  `features.phoneIdentity: { hostParameter: true }`.
- The API reference documents `host` on `/control`, the ticket route,
  recordings and the team route, and the `ambiguous_phone` answer.
- A docs section on phones two servers name alike: how to see them (the
  device list shows each with its host), how to address one, and that the
  dashboard handles them in a later release.

## Until part 2

The dashboard sends no host yet. In a lab with same-named phones, opening or
controlling one answers the `409`. The dashboard shows its message as an
error toast and doesn't open the phone: Live devices takes the tile back,
device control shows the message where the picture would be and opens no
stream, the Logs tab stops at it, and a team change shows it. It never acts
on the other phone. Everything else in the dashboard is unchanged.

## Not in scope

Appium sessions by `appium:udid` (allocation may give either same-named
phone; the session stays on the one it got). The dashboard (part 2). Live
events (part 2 makes them name the phone).

## Tests

- `findPhone`: host given (match, other host, hidden); no host with one,
  none, two visible, two with one hidden (resolves to the visible one).
- The team guard: `409 ambiguous_phone` with visible hosts only; `?host=`
  reaching the right row; an invalid host `400`; a hidden host the unknown
  answer, identical to an unknown udid.
- The hub's gate: `?host=` of a node's phone forwards to that node without
  `host`; `?host=` of the hub's own same-named phone is handled locally.
- Handlers read the resolved row (one handler that reads the row, e.g.
  `display`, on two same-named rows).
- Tickets: minted with the host, redeemed only with it; an old ticket
  without a host follows the udid-only rule; the sockets resolve by both.
- Recordings: two phones of one udid on two hosts in one group, each read
  from its own source; `isRecording` per host; a string udid of a duplicate
  is `409` and starts nothing; `add-device` with a host; the observer path
  records a same-named node phone.
- The team route with and without a host.
- Lab: a scratch hub and a scratch node on the lab Mac share its adb, so
  both list the same physical `emulator-5554`, each under its own host: the
  duplicate case. A screen can't tell them apart, so the check reads which
  server handled each request: with `?host=` of the node, the hub forwards
  (the node's log shows the tap); with the hub's own host, the hub handles it
  (the node's log doesn't); without a host, `409 ambiguous_phone`. The same
  for a recording's source (relay to the node, or the hub's own stream).
