---
title: Network Interceptor
---

# Network Interceptor

Inspect and modify HTTP / HTTPS traffic between your app and the network during a test session — without changing the app, the test, or the network. Captured requests stream live to the dashboard, can be downloaded as HAR, and survive past session end.

The interceptor runs an in-process MITM proxy against the device's traffic for the lifetime of the session. It supports request and response mocking, host-level allow/deny filters, TLS failure attribution, and real-device routing over USB without any shared LAN.

:::info Platform support
Android only in v1. iOS sessions skip interceptor setup with a warning. iOS support is on the roadmap.
:::

---

## Quick start

Enable the interceptor on a session by setting one capability:

```javascript
const caps = {
  platformName: 'Android',
  'appium:app': '/path/to/app.apk',
  'xe:interceptor': {
    enabled: true,
  },
};
```

Run your test. Open the dashboard for the session — every request your app makes to the network appears in the **Network** panel as it happens. When the session ends, click **Download HAR** to export the full trace.

That's it. Mocks, filters, and rewrites are all opt-in additions to the same capability object.

---

## Capability surface

All capability shapes below are accepted:

```javascript
// 1. Structured under xe: (recommended)
'xe:interceptor': {
  enabled: true,
  bufferSize: 2000,
  captureBodies: true,
  includeHosts: ['**.api.example.com'],
  excludeHosts: ['*.tracking.com'],
  mocks: [/* ... */],
}

// 2. Same object under appium: prefix or no prefix
'appium:interceptor': { enabled: true, /* ... */ }
'interceptor':        { enabled: true, /* ... */ }

// 3. Flat keys (for clients that prefer them)
'xe:interceptorEnabled': true
'xe:interceptorBufferSize': 2000
'xe:interceptorIncludeHosts': ['**.api.example.com']
'xe:interceptorExcludeHosts': ['*.tracking.com']

// 4. Nested under xenon:options (W3C-friendly)
'xenon:options': {
  interceptor: { enabled: true, /* ... */ }
}
```

| Field | Type | Default | Purpose |
|---|---|---|---|
| `enabled` | boolean | `false` | Master switch. |
| `bufferSize` | number | `1000` | Max requests held in memory; oldest evicted on overflow. |
| `captureBodies` | boolean | `true` | Capture request/response bodies. Set `false` for header-only mode (lower memory, less detail). |
| `includeHosts` | string[] | `[]` (all) | Capture-time allowlist; see [Host filtering](#host-filtering). |
| `excludeHosts` | string[] | `[]` (none) | Capture-time denylist. |
| `mocks` | Mock[] | `[]` | Request/response rules; see [Mocking](#mocking). |

---

## Mocking

The interceptor matches outgoing requests against a list of mock rules and applies the first match. Mocks are evaluated in declaration order; later mocks override earlier ones for the same URL.

There are three independent operations a mock can perform — they can be combined on a single rule.

### `respondWith` — short-circuit a response

The request is intercepted and never reaches the upstream server. Xenon synthesizes the response and returns it to the app.

```javascript
'xe:interceptor': {
  enabled: true,
  mocks: [
    {
      match: { url: 'https://api.example.com/users/me' },
      respondWith: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: { id: 1, name: 'Test User' },
        delayMs: 250, // simulate slow upstream
      },
    },
  ],
}
```

`body` accepts a string (sent as-is) or any JSON-serializable object (stringified automatically). `delayMs` is optional latency before the response is delivered.

### `rewriteRequest` — modify before forwarding

The request goes upstream as usual, but with headers and/or body rewritten on the way out.

```javascript
{
  match: { url: '**/v1/**', method: 'POST' },
  rewriteRequest: {
    headers: { authorization: 'Bearer test-token' },
    body: { mocked: true },  // replaces request body; Content-Length is recalculated
  },
}
```

If you replace the body and don't set `content-type` in `headers`, Xenon defaults it to `application/json`.

### `rewriteResponse` — modify upstream's response

The request goes upstream, but the response is rewritten before reaching the app. Useful for testing edge cases on real backends without standing up a fixture server.

```javascript
// Override status only
{ match: { url: '**/health' }, rewriteResponse: { status: 503 } }

// Replace the body wholesale
{
  match: { url: '**/feature-flags' },
  rewriteResponse: {
    bodyTransform: 'replace',
    body: { darkMode: true, betaUI: true },
  },
}

// Patch fields on top of the real response (deep merge → shallow merge)
{
  match: { url: '**/users/*' },
  rewriteResponse: {
    bodyTransform: 'jsonMerge',
    body: { isAdmin: true },  // shallow-merged onto upstream JSON
  },
}
```

`bodyTransform: 'jsonMerge'` parses the upstream response as JSON, shallow-merges your patch on top, and re-serializes. If the upstream isn't valid JSON, it falls back to `'replace'` semantics.

When body length changes, `Content-Length` is dropped and chunked encoding takes over — your apps don't need any special handling.

### Match patterns

`match.url` accepts:

- An **exact string**: `'https://api.example.com/users/1'`
- A **glob**: `'https://api.example.com/users/*'` (single `*` does not cross `/`), or `'**.example.com/**'` (`**` crosses path segments)
- A **RegExp**: `/\/users\/\d+$/` — matched as-is

`match.method` is optional; case-insensitive; defaults to "any method".

---

## Host filtering

Hide noisy traffic (analytics, third-party CDNs, telemetry) from the network panel without affecting mocking. Mocks for excluded hosts still fire — the filter is capture-only.

```javascript
'xe:interceptor': {
  enabled: true,
  includeHosts: ['**.api.example.com'],   // narrows: only these hosts get captured
  excludeHosts: ['telemetry.example.com'], // carves out
}
```

**Glob rules:**

| Pattern | Matches |
|---|---|
| `api.example.com` | exact host only |
| `*.example.com` | one DNS label prefix: `api.example.com`, `cdn.example.com` (NOT `example.com`, NOT `sub.api.example.com`) |
| `**.example.com` | zero or more labels: all of the above PLUS `example.com` |
| `*` (bare) | match anything |

Patterns are case-insensitive. Dots are literal — `api.example.com` does NOT match `apixexamplexcom`.

Semantics:
1. If `includeHosts` is non-empty, the host must match at least one include pattern.
2. If `excludeHosts` is non-empty, the host must not match any exclude pattern.
3. Empty / absent lists pass everything through.

---

## TLS handshake failures

When an app rejects Xenon's MITM certificate (the default for Android 7+ apps that haven't opted into a custom `network_security_config.xml`), the TLS handshake fails before any request data reaches the proxy. Xenon attributes these failures to the host that was being connected to and surfaces them in the network panel as **failed** rows.

The recognised failure kinds:

| Kind | Cause |
|---|---|
| `HTTPS_CLIENT_ERROR` | App rejected the proxy cert — typically not in `network_security_config.xml`. |
| `HTTPS_SERVER_ERROR` | Server-side TLS handshake error. |
| `OPEN_HTTPS_SERVER_ERROR` | Failed to open the upstream HTTPS endpoint. |
| `ON_CONNECT_ERROR` | The CONNECT tunnel could not be established. |
| `PROXY_TO_SERVER_REQUEST_ERROR` | DNS / TCP issue (`ENOTFOUND`, `ECONNREFUSED`, `ETIMEDOUT`, ...). |

Repeated identical failures for the same `(host, kind)` collapse to a single row to avoid flooding the panel — that's a UX choice, not a missed event.

---

## Real-device routing

Emulators reach the host MITM proxy via the special `10.0.2.2` alias — no setup. Real devices use `adb reverse` to tunnel a device-local port back to the host over the adb transport itself (USB or wireless adb), so the device proxy can point at `127.0.0.1`. This works regardless of network shape — CI runners, NAT'd hosts, hotel WiFi, USB-only labs.

If `adb reverse` fails (rare), Xenon falls back to the host's first non-loopback IPv4 and logs a warning naming the address. If interception silently stops working on a real device, the warning is the first place to look.

### Certificate installation

Xenon generates a per-install self-signed CA at `{cacheDir}/interceptor-ca/` and installs it on the device:

- **Emulator (writable system image, e.g. `-writable-system`):** automatic via `adb root` + `adb remount` + push to `/system/etc/security/cacerts/{hash}.0`. Trusted system-wide.
- **Real device:** automatic push to `/sdcard/{hash}.0`. **Manual install required:** open the device's Settings → Security → "Install a certificate" → "CA certificate", browse to the file, accept the warning. Alternatively, ship a `network_security_config.xml` in your app's debug build that trusts user CAs.

Apps using **certificate pinning** will refuse the proxy cert even when it's installed. Disable pinning in your debug build (or use Frida-based pinning bypass externally) — Xenon does not bypass pinning automatically.

---

## Past sessions

The network panel works for finished sessions, not just live ones. When a session ends, captured traffic is flushed to disk under the session's asset directory and re-served by the same REST endpoints when the dashboard navigates to a past session.

**Body retention:**

| Body size | Retained? |
|---|---|
| Under 1 MB (inline) | Yes — written into `requests.json` |
| Over 1 MB (spilled to tmp) | No — spill files are deleted at session stop |

Headers, status, URL, timing, and `failureKind` metadata are always retained, which covers the primary "what happened in this past session" debugging use case. Persisting large bodies needs a body-storage strategy and is on the roadmap.

---

## HAR export

Every active or finished session exposes a HAR 1.2 download:

```
GET /xenon/api/interceptor/sessions/{sessionId}/har
```

Returns the full session as `application/json` with `Content-Disposition: attachment` so a browser saves it directly. Failed entries (TLS errors with no real response) are filtered out — HAR consumers expect well-formed exchanges.

You can also download the HAR from the dashboard via the **Download HAR** button on the network panel.

---

## REST endpoints

Under `/xenon/api/interceptor`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/sessions/:sessionId/requests` | List all captured requests for the session. |
| `GET` | `/sessions/:sessionId/requests/:requestId` | Single request, including body (lazily loaded from spill if needed). |
| `GET` | `/sessions/:sessionId/har` | HAR 1.2 download. |
| `GET` | `/sessions/:sessionId/mocks` | Live: list active mocks. |
| `POST` | `/sessions/:sessionId/mocks` | Live: add a mock at runtime. |
| `DELETE` | `/sessions/:sessionId/mocks/:mockId` | Live: remove a mock. |
| `DELETE` | `/sessions/:sessionId/mocks` | Live: clear all mocks. |

The four `GET` routes serve from the live in-memory state when the session is active and fall back to the on-disk archive when it has stopped. The mock-management routes (POST/DELETE) require an active session — modifying mocks on a finished session has no semantic.

---

## Troubleshooting

**"Interception works for some requests but not all."**
The app is using certificate pinning, or has a `network_security_config.xml` that trusts only system CAs and you installed the cert as user CA. Use a debug build that trusts user CAs, or remove pinning.

**"All requests show as `HTTPS_CLIENT_ERROR` for one host."**
That host is pinning. The dedupe collapses many identical failures to one row by design — see [TLS handshake failures](#tls-handshake-failures).

**"Real device shows no traffic at all."**
Check the session log for `adb reverse failed` or "falling back to host LAN IP" warnings. If the fallback is in effect, your device cannot reach the named address. Re-plug USB and confirm `adb devices` shows the device, or fix LAN reachability.

**"Network panel is empty for a finished session."**
Confirm the session actually had captured traffic before it stopped (it might have been short-circuited, or all hosts were excluded by the filter). The archive is only written if the interceptor was active during the session.

**"Bodies show as empty for finished sessions."**
Bodies above 1 MB are not retained across session end (see [Past sessions](#past-sessions)). Headers and status are retained. For full body retention, keep the session alive while inspecting, or watch this space — durable body persistence is on the roadmap.
