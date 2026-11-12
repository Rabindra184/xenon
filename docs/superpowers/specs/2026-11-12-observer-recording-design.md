# Observer-mode recording of automated sessions (ENH-06)

Status: approved design, 2026-11-12. Xenon Test's ENH-06.

## Goal

A multi-device test gets one side-by-side video of its phones (an Android
phone and an iPhone, say) while it runs, with the composite, marks and proof
bundle that recordings already make. Through 2.32 a recording refuses every
phone running an Appium session (`BusyPrecheck`, reason `automation`), so a
test can only collect each session's own video and lay them side by side
itself.

## What the caller does

`POST /xenon/api/recordings` takes `sessionIds` in place of `udids`:

```json
{ "sessionIds": ["<android session>", "<ios session>"], "note": "checkout, two phones" }
```

- Exactly one of `udids` and `sessionIds`, a non-empty array of non-empty
  strings, else `400`. `udids` behaves exactly as today.
- The answer is today's (`202 { groupId, recordings, startedAt,
  compositeEnabled }`), each recording also naming its `sessionId`. Stop,
  marks, annotations, downloads and the library are unchanged.
- `GET /capabilities` reports `features.recording.observer: true`;
  `/sdk/version` lists `observer-recording`.

## Who may

- The `sessions` or the `devices` scope (decided 2026-11-12). It records only
  the caller's own sessions, holds no phone and controls nothing, so the
  session scope fits; a member's own tokens carry `sessions` and `read`
  only. Every write on an observer group (stop, marks, clearing marks,
  delete) takes `sessions` too for the user who started it, or an admin, so
  whoever started it can finish it; anyone else needs `devices`, as for any
  group (decided at the final review: `sessions` alone must not let one
  member stop or mark another's group). A `udids` recording and its group
  keep needing `devices`. Whether a group is an observer group, and who
  started it, is known in memory, for the newest 1,000 observer groups: after
  a restart, or once 1,000 newer ones have started, its writes need
  `devices` again.
- For **every** session: the caller is its owner
  (`SessionOwnerResolver.ownerOf`, which reads `LiveSessionOwners` first, so a
  session with no Session row still has one) or an override admin
  (`canOverrideLease`'s rule, as per-command auth uses).
- All or nothing. A session that is unknown, has ended, is another user's,
  has no owner on record (fail closed, as the device guard does), or runs on a
  phone the caller's teams can't see answers `404 { error: 'not_found' }` for
  the whole request, the answer an unknown udid gets. Nobody can tell another
  user's session from a missing one.
- A cloud provider's phone is refused (`409 device_busy`, reason
  `cloud_phone`): recordings never read a cloud phone.

## Which phone

A session's phone is the device row its claim names (`claimSessionId`, or a
pre-claim row's `session_id`: `deviceClaims.ts`'s rule), on this server
either way: a local session's phone, or on a hub the node phone the hub
claimed for its session. That is the phone the session runs on whatever the
dashboard and video settings, and it needs no Session row. A session id no
claim names is not running here: `404`. Two ids naming one phone: `400`.

## Read-only

- **No hold.** An observer recording writes nothing to the phone's row: no
  `manual_<user>_<udid>` over the session's id in `session_id`, and nothing
  released when it ends (`blockDeviceFn` / `tryUnblock` skipped, and the
  end-of-recording preview leave too). A stream the recording started stays
  until its own idle stop, as one a session's video starts does. A udid recording keeps today's hold.
- **The busy check** (`findBusy`) takes the session the caller named for each
  phone. The `automation` refusal is skipped only when the phone's claim names
  that session. Everything else still refuses: another recording on the phone
  (`recording_other_group`), another user's lease (`leased`), a manual hold.
- **No control.** Nothing on the phone is driven; the test's commands are
  untouched. The recording reads frames only.

## Where the picture comes from

The same source the session's own video uses (`LocalSession.startVideoRecording`):

- **Android**: the MJPEG stream (`ensureMjpegForRecording`, which ends an
  H.264 preview first, as today).
- **iPhone**: `IOSStreamService.startStream`, reused when running. A session's
  video (on by default) already starts it during the session. The lab check
  below must show it leaves the session's WebDriverAgent alone; if it can't,
  an iPhone session with no stream running is refused (reason `no_picture`)
  rather than given a second WebDriverAgent.
- **Simulator**: the session's `mjpegServerPort` (from the driver's options,
  `AppiumUmbrella.driverOptions`), never the stream service.
- **A node's phone**: the hub's relay from the node's `GET stream`
  (`nodeRecordingSource.ts`), as for any node recording. A read, so the
  node's ownership guard lets it through.

The composite reads the same ports as today.

## The session ends first

However a session ends, its recording group is stopped at once, every phone
and the composite, so it doesn't film the next test on that phone. Stopping
only that phone's recording isn't enough: the composite reads each phone's
stream, which goes on after the session, so it would keep filming the phone.
A test's sessions end within moments of each other, so the group lasting until
the first of them ends is what a test asking for "one video of this test"
gets.

- **The hook.** `forgetSessionMemory(sessionId)` (every ending: the test's
  delete, a hub's DELETE of a node session, Appium's timeout or a crash, the
  idle release, `OrphanSweeper`, a shutdown's drain) calls
  `RecordingOrchestrator.sessionEnded(sessionId)`. The test's delete tells
  the recordings first, before it frees the phone (`tellRecordingsSessionEnded`):
  the phone is released before the hook runs there.
- **The backstop.** Every 10 s each observer recording checks that its
  phone's claim still names its session, and ends otherwise: an ending path
  that misses the hook still can't record someone else's test for more than
  that long.
- **Stopped** as the caller's stop is (`RecordingOrchestrator.stop(groupId)`: the composite first, then
  each phone's `finalizeRecording`), every recording `STOPPED` with
  `fail_reason` `session_ended`, as a source that ends keeps its video
  `STOPPED` with `source_ended`. A second ending of the same
  group finds it stopped and does nothing.

## The link to the session

`Recording.session_id` (a column that exists and nothing fills) is written
only when the Session row exists, since it is a foreign key: a local session
with the dashboard off has none. The recording keeps its session id in
memory either way, for the ending. The session page links to its recording,
and the recording page names its sessions where a row exists.

## Hub and nodes

A hub resolves and records its node sessions' phones itself; the node needs
nothing new (its stream route already serves a phone in a session). Hub on
2.33, nodes on any 2.x.

## Errors

| Case | Answer |
|---|---|
| Both or neither of `udids` / `sessionIds`, a bad entry, two ids on one phone | `400` |
| A session unknown, ended, another user's, ownerless, or on a hidden phone | `404 not_found` |
| Its phone has another recording, another user's lease or a hold | `409 device_busy` (today's reasons) |
| A cloud phone | `409 device_busy`, reason `cloud_phone` |
| A phone whose udid another server's row also has (an emulator's name) | `409 device_busy`, reason `shared_udid`: recording finds a phone by udid alone, so it could read the other one (decided at the final review; until recording is host-aware) |
| The cap | `409 concurrency_cap` (unchanged) |
| Adding a phone to an observer group (`add-device`) | `409 observer_group`: its phones are the sessions named at the start |

## Tests

- The route: `sessionIds` resolved by claim; owner allowed; another user,
  ownerless and ended refused with the unknown answer, all or nothing; admin
  allowed; both fields, neither, duplicates `400`; a cloud phone refused.
- The busy check: the named session passes, another session on the same
  phone still refuses, another recording still refuses.
- No hold: the row's `session_id` and `busy` are untouched by start and stop.
- Ending: the hook stops the whole group, composite included, once; the
  backstop stops a group whose phone's claim changed; a second ending does
  nothing.
- A node session through the hub: its phone resolved by the hub's claim, read
  through the relay.
- Lab: an Android session and an iPhone session recorded together into a
  composite while a test drives both; the test's commands all pass; the group
  stops when the first session ends; the iPhone's WebDriverAgent is unaffected.

## Not in scope

A Record button on the session page or the mosaic for phones in one's own
sessions; recording cloud phones; an execute script to start a recording.
