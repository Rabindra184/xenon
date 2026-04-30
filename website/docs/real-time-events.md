---
title: Real-time Events
---

# Real-time Events (Socket.IO)

The Xenon plugin server fans out state changes to connected clients over Socket.IO. The dashboard uses this channel to render device, session, healing, selector-health, and network-interceptor activity without polling. Custom dashboards, CLI watchers, and notification bridges can consume the same stream.

The Socket.IO endpoint runs on the Xenon plugin's HTTP server (default `:4723`) on the **default namespace** (`/`) — there is no namespaced suffix. Both dashboard clients and remote nodes connect to the same endpoint and are routed into separate broadcast **rooms** based on how they authenticated.

---

## Connecting

The handshake is gated by the same auth surface as the REST API. A connecting client must present one of:

- **Pair auth** (programmatic clients and nodes) — `accessKey` + `token` in the Socket.IO `auth` payload, or `x-xenon-access-key` + `x-xenon-token` headers. The pair must resolve to an `ACTIVE` user.
- **Dashboard credentials** — `apiKey` in the Socket.IO `auth` payload, or an `x-xenon-api-key` header, or the `xenon_dashboard_session` cookie set by the dashboard login flow.

When `authDisabled=true`, the handshake is unconditionally accepted; this is for local development only.

### Dashboard client (browser or Node.js)

```javascript
import { io } from 'socket.io-client';

const socket = io('http://hub.internal:4723', {
  auth: { apiKey: process.env.XENON_API_KEY },
  transports: ['websocket'],
});

// Tell the server which broadcast room to put us in
socket.emit('register_dashboard');

socket.on('healing_event', (data) => console.log('heal:', data));
socket.on('selector_resolved', (data) => console.log('resolved:', data));
```

### Node client

```javascript
const socket = io('http://hub.internal:4723', {
  auth: {
    accessKey: process.env.XENON_HUB_ACCESS_KEY,
    token: process.env.XENON_HUB_TOKEN,
  },
  transports: ['websocket'],
});

socket.emit('register_node', { host: 'node-1.internal:4723' });
```

A socket authenticated as a `dashboard` cannot register as a `node` (and vice versa) — the room each principal can join is fixed at handshake time, so a stolen credential of one class can't impersonate the other.

---

## Protocol handshake

Optionally, after connecting, a client can verify protocol compatibility:

```javascript
socket.emit('handshake', {
  version: '1.0.0',                // must match XENON_PROTOCOL_VERSION
  nodeId: 'node-1',
  host: 'node-1.internal:4723',
  timestamp: Date.now(),
});
```

If `version` does not match the server's `XENON_PROTOCOL_VERSION`, the server logs the mismatch and disconnects the socket. The current protocol version is **`1.0.0`**.

---

## Rooms

Each authenticated socket joins exactly one broadcast room:

| Room | Joined by | Receives |
|---|---|---|
| `dashboard` | clients that emit `register_dashboard` | All session, healing, selector, and interceptor events |
| `nodes` | clients that emit `register_node` | Hub-to-node directives (rare in v1; reserved for future use) |

Server emission helpers (`emitToDashboard`, `emitToNodes`, `broadcast`) target these rooms; they are why most events listed below land on dashboard clients only.

---

## Event reference

Event names are stable strings declared in `src/enums/SocketEvents.ts`. Payload shapes are documented on the originating feature page (linked in the **See** column).

### Connection lifecycle

| Event | Emitted by | Purpose | See |
|---|---|---|---|
| `handshake` | client → server | Optional protocol-version exchange | This page |
| `register_node` | client → server | Join the `nodes` room | This page |
| `register_dashboard` | client → server | Join the `dashboard` room | This page |
| `node_connected` | server → dashboard | A node finished registering | [Remote Execution](remote-execution.md) |
| `node_disconnected` | server → dashboard | A node socket disconnected | [Remote Execution](remote-execution.md) |

### Sessions

| Event | Emitted by | Purpose |
|---|---|---|
| `session_started` | server → dashboard | A new Appium session was allocated to a device |
| `session_stopped` | server → dashboard | A session ended (stopped, crashed, or timed out) |
| `session_command` | server → dashboard | Per-command stream when the session has command logging enabled |

### Healing & selector lifecycle

All event payloads carry the `(strategy, selector)` tuple. See [Selector Health](selector-health.md) for the state machine that produces them.

| Event | Trigger |
|---|---|
| `healing_event` | A `findElement` was successfully healed (any tier) |
| `selector_fixed` | User clicked **Mark as Fixed** — selector entered `Pending` |
| `selector_progress` | Verifier counted one more clean CI build but the threshold isn't met |
| `selector_resolved` | Verifier promoted a selector to `Resolved` after 3 clean builds |
| `selector_regressed` | A `Pending` or `Resolved` selector healed again |
| `selector_cancelled` | User backed out of `Pending` without recording a fix |
| `selector_muted` | User muted a selector |
| `selector_unmuted` | User unmuted a selector |

### Network interceptor

See [Network Interceptor](network-interceptor.md) for capture semantics.

| Event | Trigger |
|---|---|
| `interceptor_session_started` | A session with `xe:interceptor.enabled = true` started — the proxy is live |
| `interceptor_request` | A request (or response, or failure) was captured |
| `interceptor_session_stopped` | The session ended; archived traffic is now served from disk |

---

## Versioning

The wire protocol is versioned via the `XENON_PROTOCOL_VERSION` constant. Backwards-incompatible changes — adding a required field, renaming an event, changing room semantics — bump the version. Adding new events under existing categories does not.

If you write a long-lived Socket.IO consumer, send the `handshake` event after `connect` and treat a disconnect-after-handshake as a signal to bump your version pin.
