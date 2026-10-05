---
title: Real-time events
description: The Socket.IO stream a Xenon hub sends to its dashboards, how a script connects to it, who receives which event, and every event with its payload.
---

A Xenon hub tells the dashboards connected to it what is happening as it happens: phones coming and going, sessions starting and ending, each command, heals, recordings and captured network requests. It sends these over Socket.IO, and a script can listen to the same stream, for a wallboard or a chat bridge. This page explains how to connect, who receives which event, and what each event carries.

## Where the stream runs

- **On a hub, or a standalone server:** any server started without the `hub` option. It runs whether or not `enableDashboard` is set. A node runs no stream of its own; it connects to its hub's as a client.
- **On Appium's port,** at the path `/socket.io/`, in Socket.IO's default namespace. The path doesn't change with Appium's `--base-path`.
- **From what that server does itself.** A hub sends events about its nodes' phones as it learns of them: phones a node reports, sessions it routes to a node, recordings it makes of a node's phone. Network capture and heals for a session on a node's phone happen on the node, and send no events to the hub.

## Connect

The connection has to present one of these credentials. Xenon checks them in this order:

| Credential | How to send it | Joins as |
|---|---|---|
| A bearer token with the audience `xenon-rest`, from `POST /xenon/api/auth/token` | `auth: { bearer: '<token>' }` | A dashboard client |
| An access key and token | `auth: { accessKey, token }`, or the `x-xenon-access-key` and `x-xenon-token` headers | A node |
| The dashboard's sign-in | The `xenon_dashboard_session` cookie, which a browser on the dashboard's own address sends by itself. A cookie that holds an API key instead of a sign-in is accepted too, as the REST API accepts it. | A dashboard client |

- **The user must be Active.** A credential that doesn't check out, or an Inactive user, gets the connect error `unauthorized`, and the server logs why.
- **Register to receive.** After connecting, a client emits `register_dashboard` to receive the dashboard's events. A connection made with an access key and token is a node's: if it emits `register_dashboard` it is disconnected, so a script uses a bearer token. In the same way, a dashboard client that emits `register_node` is disconnected.
- **With sign-in off,** every connection is accepted and may register as either.
- **Credentials are checked when the socket connects.** A bearer token lasts an hour, so give a long-running client a function that fetches a fresh one, which Socket.IO calls each time it reconnects.

```javascript
import { io } from 'socket.io-client';

// Returns a token from POST /xenon/api/auth/token with {"audience":"xenon-rest"}.
async function freshToken() {
  const res = await fetch('http://hub.internal:4723/xenon/api/auth/token', {
    method: 'POST',
    headers: {
      'x-xenon-access-key': process.env.XENON_ACCESS_KEY,
      'x-xenon-token': process.env.XENON_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ audience: 'xenon-rest' }),
  });
  return (await res.json()).token;
}

const socket = io('http://hub.internal:4723', {
  auth: (cb) => freshToken().then((bearer) => cb({ bearer })),
  transports: ['websocket'],
});

// Register on every connect: a reconnect is a new connection.
socket.on('connect', () => socket.emit('register_dashboard'));
socket.on('connect_error', (err) => console.error('refused:', err.message));

socket.on('session_stopped', (e) => console.log(e.id, e.status, e.failure_reason));
socket.on('healing_event', (e) => console.log(e.originalSelector, '->', e.healedSelector));
```

[Authentication](./authentication.md#bearer-tokens) explains bearer tokens.

## Who receives which event

Events go only to registered dashboard clients. Most are about a phone, and go by the phone's team. Network capture events go to admins only, selector events by who may see the selector, and node events to every client:

- **An Admin or a Super admin, or any client with sign-in off,** gets every event.
- **A Member** gets the events about phones in the shared pool and in their teams. A token bound to one team narrows that to the shared pool and that team. See [Teams](./teams.md).
- **The teams are read when the client connects.** A change of membership applies when the client reconnects, which the dashboard does when it is reloaded.
- **An event about a phone** reaches only the clients that can see the phone. If the phone can't be identified, or looking up its team takes longer than 2 seconds, the event goes to admins only. That is every event below except the selector and node events, and the network capture events, which go to admins only.
- **A recording of several phones** reaches each client cut down to the phones it can see, and not at all when it sees none of them.
- **Selector events** reach a Member only for a selector that healed, at any time, in a session they can see: the selectors they may see on the **Selector health** page. If that can't be checked within 2 seconds, the event goes to admins only.
- **Node events** go to every dashboard client.
- **Network capture events go to admins only.** `interceptor_request` carries each captured request's headers and bodies, which can hold sign-in details and personal data, so `interceptor_session_started`, `interceptor_request` and `interceptor_session_stopped` reach Admins and Super admins only, as the REST routes and the session's **Network** panel do. A test's own `getRequests` and `exportHar` commands are unaffected.
- **One phone's events arrive in the order they were sent,** and so do one selector's. Events about different phones, or different selectors, may interleave.

## Events

The payloads below are the fields each event carries. Times are ISO 8601 strings unless the field says otherwise.

### Phones

| Event | Sent when | Payload |
|---|---|---|
| `device_added` | A phone appears on this server, or a node reports a new one. | The phone's record: `udid`, `name`, `platform`, `sdk`, `host`, `busy`, `teamId` and the rest of what the Devices page shows. |
| `device_removed` | A phone goes away. | `udid`, `host` |
| `device_blocked` | A live preview or a recording takes a phone. | `udid`, `host`, `session_id` (the hold, such as `manual_<user id>_<udid>`) |
| `device_unblocked` | A phone is freed. | `udid`, `host` |
| `device_progress` | A step of setting a session up on a phone starts, such as `Allocating node resources...`, or setup ends (an empty `progress`). | `udid`, `host`, `progress` |

### Sessions

`session_started`, `session_command` and `healing_event` are sent for the sessions the server records: with `enableDashboard` on, and not for a cloud provider's sessions. `session_stopped` is sent for those, and also for every session a hub routes to a node or a cloud provider, whatever `enableDashboard` says, since the hub keeps a record of each. `bug_report_generated` is sent whatever `enableDashboard` says.

| Event | Sent when | Payload |
|---|---|---|
| `session_started` | A session has started on a phone. | The session's record: `id`, `name`, `build_name`, `status` (`running`), `device_udid`, `device_name`, `device_platform`, `device_version`, `node_id`, `user_id`, `api_key_id`, `trace_id`, `video_recording_enabled`, and the session's capabilities. |
| `session_command` | A command of the session has finished. | The command's log entry: `session_id`, `command_name`, `title`, `method`, `url`, `body` (the request), `response`, `is_success`, `is_error`, `duration` (milliseconds), `screenshot`, `is_healed`, `original_strategy`, `original_selector`, `healed_strategy`, `healed_selector`, `healing_confidence`, `healing_tier`, `trace_id`, `span_id`. |
| `healing_event` | A find was healed. | `id`, `sessionId`, `deviceUdid`, `deviceName`, `devicePlatform`, `commandName`, `originalSelector`, `healedSelector`, `confidence`, `tier`, `isSuccess`, `createdAt` |
| `session_stopped` | A session ended, or a test set its result with `xenon: setSessionStatus`. | `id`, `status` (`success` or `failed`), `failure_reason` |
| `bug_report_generated` | Someone downloaded a session's bug report. | `sessionId`, `mode`, `durationMs`, `warnings` |

`body` and `response` are the command's own request and answer, so they hold whatever the test typed and read, page sources included.

### Selector health

See [Selector health](./selector-health.md) for what each status means. These go to admins, and to a Member who may see the selector on the **Selector health** page.

| Event | Sent when |
|---|---|
| `selector_fixed` | Someone marked a selector fixed: it is now **Being verified**. |
| `selector_progress` | The verification's count of clean builds changed, still short of 3. |
| `selector_resolved` | The verification moved a selector to **Fixed** after 3 clean builds. |
| `selector_regressed` | A selector being verified, or fixed, healed again and went back to **To fix**. |
| `selector_cancelled` | Someone cancelled a selector's verification: it went back to **To fix**. |
| `selector_muted` | Someone muted a selector. |
| `selector_unmuted` | Someone unmuted a selector: it went back to **To fix**. |

Each carries the selector's record: `id`, `original_strategy`, `original_selector`, `status` and `clean_builds_count`. `selector_progress` and `selector_resolved` add `resolved_at`; the others add `fixed_at`, `fixed_by_api_key`, `resolved_at`, `muted_at`, `muted_by_api_key`, `regression_count`, `last_event_at`, `createdAt` and `updatedAt`. The two `_by_api_key` fields hold the id of the API key that marked the selector fixed or muted it, and are empty when it wasn't done with an API key, such as from the dashboard. `status` is `active` for **To fix**, `pending` for **Being verified**, `resolved` for **Fixed** and `muted` for **Muted**. When a cancel or an unmute leaves no record, the event carries only `original_strategy`, `original_selector` and `status: "deleted"`.

### Network capture

See [Network interceptor](./network-interceptor.md). These go to admins only. A hub sends them for a capture on its own phones; a capture on a node's phone sends none, since a node has no live events.

| Event | Sent when | Payload |
|---|---|---|
| `interceptor_session_started` | A session's network capture has started. | `sessionId`, `host`, `port` (the capture's proxy) |
| `interceptor_request` | A request was captured: answered, or failed. | The captured request: `id`, `sessionId`, `ts` (milliseconds since 1970), `method`, `url`, `host`, `path`, `reqHeaders`, `reqBody`, `resStatus` (`-1` for a request that failed), `resHeaders`, `resBody`, `durationMs`, `mocked`, `modified`, `mockId`, `commandHint` (the test command it followed), and `failed`, `failureReason` and `failureKind` for a failure. |
| `interceptor_session_stopped` | The session ended and its capture was saved. | `sessionId` |

### Recordings

See [Recordings](./recordings.md).

| Event | Sent when | Payload |
|---|---|---|
| `recording_started` | A recording started, of one phone or of several together. | `groupId`, `recordings` (each `id` and `udid`), `startedAt` |
| `recording_stopped` | A recording stopped. | `groupId`, `recordings` (each `id`, `udid`, `status`, `durationMs`, `sizeBytes`) |
| `recording_failed` | One phone's recording failed. | `groupId`, `recordingId`, `udid`, `reason` |
| `recording_bookmark_added` | Someone added a bookmark. | `groupId`, `bookmark` |
| `recording_annotation_added` | Someone added an annotation. | `groupId`, `annotation` |

### Nodes

| Event | Sent when | Payload |
|---|---|---|
| `node_connected` | A node connected to this hub's stream and registered. | `host` |
| `node_disconnected` | That connection closed. | `host` |

### From a client

| Event | Sent by | Payload |
|---|---|---|
| `register_dashboard` | A dashboard client, to receive the events above | None |
| `register_node` | A node, after connecting | `host` |
| `handshake` | A node, after connecting. Optional. | `version`, `host`, `timestamp` |

## Protocol version

The stream's protocol version is `1.0.0`. A client may send it in `handshake`. If the version differs from the server's, the server logs the mismatch and disconnects the client. Nodes send it; the dashboard doesn't.

## The event log

The server also writes each event it sends to dashboards into its database, unless `XENON_EVENT_LOG=off`. See [The event log](./observability.md#the-event-log).

## Related

- [Authentication](./authentication.md): the credentials and bearer tokens.
- [Teams](./teams.md): who sees which phone.
- [Hub and nodes](./hub-and-nodes.md): how a node connects to its hub.
