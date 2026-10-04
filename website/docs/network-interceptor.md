---
title: Network interceptor
description: "Capture an Android app's HTTP and HTTPS traffic during a test, mock or change requests and responses, and export the capture as a HAR file."
---

The network interceptor sits between the app and the network for the length of one session. It records every request the app makes, shows them live on the session's page, and can answer or change requests with rules you set, without changing the app or the backend. The capture is saved with the session and can be exported as a HAR file. This page covers how to switch it on, how rules work, and the certificate the phone needs.

:::note[Android only]
The interceptor works on Android phones and emulators. On an iOS session Xenon logs a warning, `Interceptor v1 supports Android only`, and carries on without it.
:::

## Turn it on

A session opts in with a capability. This one switches the interceptor on with its defaults:

```js
const capabilities = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'appium:app': '/path/to/app.apk',
  'xe:interceptor': { enabled: true },
  'xe:options': {
    accessKey: process.env.XENON_ACCESS_KEY,
    token: process.env.XENON_TOKEN,
  },
};
```

Run the test and open the session in the dashboard as an Admin. Its **Network** panel lists each request as the app makes it, and the **HAR** link in the panel's header downloads the capture. Rules, filters and the other settings below go in the same `xe:interceptor` object.

A server can also turn it on for every session. Its `interceptor` option, in a config file, is the default each session on the server's own Android phones gets when its own capability doesn't say otherwise:

```yaml
server:
  use-plugins: [xenon]
  plugin:
    xenon:
      interceptor:
        enabled: true
        captureBodies: false
```

The session's capability wins, field by field. `enabled` is the session's when it says `true` or `false`, else the server option's, else off. `bufferSize` is the session's, else the server option's, else `1000`. `captureBodies` is the session's, else the server option's, else `true`. The rules, `includeHosts` and `excludeHosts` come from the session only. A session that sets `'xe:interceptor': { enabled: false }` is not captured, whatever the server option says. On a hub, a session on a node's phone is captured by the node, under the node's own `interceptor` option. The hub's Network panel doesn't show that capture, but the [execute commands](./execute-commands.md#network-interceptor) reach the node and work.

### Settings

| Field | Type | Default | What it does |
|---|---|---|---|
| `enabled` | boolean | `false` | Switches the interceptor on for the session. |
| `bufferSize` | number | `1000` | How many requests to keep in memory. The oldest are dropped first. |
| `captureBodies` | boolean | `true` | Keep request and response bodies. `false` keeps headers only, which uses less memory. |
| `includeHosts` | array of strings | all hosts | Capture only these hosts. See [Host filtering](#host-filtering). |
| `excludeHosts` | array of strings | none | Don't capture these hosts. |
| `mocks` | array of rules | none | Rules to start with. See [Mocking](#mocking). |

For `enabled`, `bufferSize` and `captureBodies`, the default applies when the server's `interceptor` option doesn't set the field either.

Besides `xe:interceptor`, Xenon reads the same object as `appium:interceptor`, as `interceptor`, and as `interceptor` inside `xe:options`. It also reads four flat keys, each with a snake_case or a camelCase name, with the `xe:` prefix, the `appium:` prefix or none, or inside `xe:options`:

| Flat key | Same as |
|---|---|
| `xe:interceptor_enabled`, `xe:interceptorEnabled` | `enabled`, as `true` or `"true"` |
| `xe:interceptor_buffer_size`, `xe:interceptorBufferSize` | `bufferSize` |
| `xe:interceptor_include_hosts`, `xe:interceptorIncludeHosts` | `includeHosts` |
| `xe:interceptor_exclude_hosts`, `xe:interceptorExcludeHosts` | `excludeHosts` |

The flat keys can't set `captureBodies` or `mocks`: bodies are captured unless the server's `interceptor` option says not to, and you add rules while the test runs with [`addMock`](./execute-commands.md#network-interceptor). When a session sends the object form, the flat keys are ignored.

## Mocking

A mock rule says which requests it applies to and what to do with them. Rules are checked against every request, and when several match, the newest one wins.

A rule has a `match` and one or more actions:

```js
'xe:interceptor': {
  enabled: true,
  mocks: [
    {
      match: { url: 'https://api.example.com/users/me', method: 'GET' },
      respondWith: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: { id: 1, name: 'Test User' },
        delayMs: 250,
      },
    },
  ],
},
```

### Matching a request

- `match.url` is compared with the whole URL as the app requested it: the scheme, the host (with its port, if the request had one), the path and the query, such as `https://api.example.com/v2/cart?lang=en`.
- A `url` with no `*` in it must equal that URL exactly, so a query string stops an exact match. Use `*` to be looser.
- In a `url` with `*`, a single `*` stands for any text without a `/`, and `**` for any text, slashes included. Everything else is literal. So `https://api.example.com/users/*` matches `.../users/42`, and `**/v1/**` matches any URL with `/v1/` in it.
- `match.method` is optional, and ignores case. Leave it out to match any method.
- Rules sent by a test are JSON, so a `url` is always a string. A regular expression can't be sent.
- A rule still applies to a host that [host filtering](#host-filtering) leaves out of the capture.

### What a rule can do

**`respondWith`** answers the request itself, and it never reaches the server.

| Field | What it does |
|---|---|
| `status` | The HTTP status to answer with. Required. |
| `headers` | Headers for the answer. `content-type` is `application/json` unless you set it. |
| `body` | A string, sent as it is, or an object, sent as JSON. |
| `delayMs` | How long to wait before answering, to imitate a slow server. |

**`rewriteRequest`** changes the request on its way out, and then sends it on.

```js
{
  match: { url: '**/v1/**', method: 'POST' },
  rewriteRequest: {
    headers: { authorization: 'Bearer test-token' },
    body: { mocked: true },
  },
}
```

`headers` are added to the request's own, and `body` replaces its body. When you replace the body, Xenon sets the `content-length` itself, and adds `content-type: application/json` when the request has none.

**`rewriteResponse`** lets the request through, and changes what comes back before the app sees it.

```js
// Change only the status.
{ match: { url: '**/health' }, rewriteResponse: { status: 503 } }

// Replace the body.
{ match: { url: '**/feature-flags' }, rewriteResponse: { bodyTransform: 'replace', body: { darkMode: true } } }

// Change some fields of the real answer.
{ match: { url: '**/users/*' }, rewriteResponse: { bodyTransform: 'jsonMerge', body: { isAdmin: true } } }
```

| Field | What it does |
|---|---|
| `status` | Replaces the status. |
| `headers` | Replace or add response headers. |
| `body` | The new body, a string or JSON. |
| `bodyTransform` | `replace`, the default when there is a `body`, swaps the body. `jsonMerge` copies the keys of `body` over the top-level keys of the real JSON answer. When the real answer isn't a JSON object, `jsonMerge` replaces it, like `replace`. |

When the body changes, Xenon drops the `content-length` header, and the answer is sent in chunks.

A rule can carry `rewriteRequest` and `rewriteResponse` together. `respondWith` ends the handling of a request, so a rule that has it ignores the other two.

## Host filtering

Host filters keep noisy traffic, such as analytics or a CDN, out of the Network panel and the capture. They decide only what is recorded: a rule still applies to a request to a filtered host.

```js
'xe:interceptor': {
  enabled: true,
  includeHosts: ['**.api.example.com'],
  excludeHosts: ['telemetry.example.com'],
}
```

A host is recorded when it matches at least one `includeHosts` entry, if there are any, and no `excludeHosts` entry. An empty or missing list lets everything through. Patterns ignore case, and a dot matches only a dot.

| Pattern | Matches |
|---|---|
| `api.example.com` | That host only. |
| `*.example.com` | One label in front: `api.example.com` and `cdn.example.com`, but not `example.com` or `a.b.example.com`. |
| `**.example.com` | Any number of labels, none included: all of the above and `example.com`. It also matches a host that only ends with the same text, such as `myexample.com`. |
| `*` | Every host. |

## What the panel shows

The **Network** panel on the session's page lists each request with its time, method, status, host, path and duration. A request a rule answered carries a `mock` flag, and one a rule changed carries `mod`. Click a row for its headers and bodies. While the test runs the list grows live. After the session ends the panel shows the saved capture.

The panel and the HAR link read the routes in [REST routes](#rest-routes), which need the Admin role. Captured requests can carry sign-in details and personal data, so a Member who opens the session sees "Only admins can see network requests" in place of the list, with no HAR link, even when the session captured traffic. When a session didn't capture, the panel says "Network capture is off" on a running session and "No network capture" on a finished one. When a running session's capture ends, the panel reads the saved capture, so the list stays.

A request that never completes is shown as a failed row for the host it was going to. The Status column says `net` when Xenon couldn't reach the server, for example on a failed DNS lookup, a refused connection or a timeout, and `tls` for each of the other kinds below, which happen while the connection is being set up. The row's tooltip gives the reason. A request that fails the handshake never reaches Xenon as a request. These are the kinds of failure:

| Kind | Status | Cause |
|---|---|---|
| `HTTPS_CLIENT_ERROR` | `tls` | The app rejected the proxy's certificate. It usually doesn't trust it. |
| `HTTPS_SERVER_ERROR` | `tls` | An error on the server side of the TLS handshake. |
| `OPEN_HTTPS_SERVER_ERROR` | `tls` | Xenon failed to open an HTTPS endpoint for the host. |
| `ON_CONNECT_ERROR` | `tls` | The CONNECT tunnel couldn't be set up. |
| `PROXY_TO_SERVER_REQUEST_ERROR` | `net` | A network problem reaching the server, such as a failed DNS lookup, a refused connection or a timeout. |

Repeats of the same failure for one host collapse into one row per session. That is on purpose, not a lost event. A TLS failure doesn't say which request failed, so Xenon names the host the app connected to most recently, and when many connections fail at once the host can be off.

## How the phone reaches Xenon

While the interceptor runs, Xenon sets the phone's global HTTP proxy to a port on the machine it runs on, and puts the phone's own proxy back when the session ends. The setting is for the whole phone, not for one app. The port is one of 11100 to 11199, and it listens on every network interface of the machine.

- **Emulators** reach the proxy through the address `10.0.2.2`, which Android gives the host machine. There is nothing to set up.
- **Real phones** reach it through `adb reverse`, which forwards a port on the phone back to the machine over the adb connection, USB or wireless. It works without a shared network: a CI runner, a NAT or a USB-only lab is fine.
- If `adb reverse` fails, Xenon falls back to the machine's first non-loopback IPv4 address and logs a warning, `adb reverse failed ... falling back to host LAN IP`. Interception then works only if the phone can reach that address.

### The certificate

To read HTTPS traffic, Xenon makes its own certificate authority, `Xenon MITM Root CA`, once, in `~/.cache/xenon/interceptor-ca/`. It is valid for ten years. Each session puts it on the phone:

- **An emulator** gets it in the system certificate store, through `adb root` and `adb remount`, so every app that trusts system certificates trusts it. When that step fails, for example on an image whose system partition isn't writable, the log says `HTTPS interception may not work`.
- **A real phone** gets the file on its storage as `/sdcard/<hash>.0`. You install it once, by hand, from the phone's settings as a CA certificate. The menu's name varies by Android version. Apps for Android 7 and later don't trust such a user certificate unless they opt in with a `network_security_config.xml`, so add one to the debug build of your app.

An app that pins its certificates refuses the proxy's certificate even when it is installed. Xenon doesn't get around pinning: turn it off in the build you test.

## Past sessions

When the session ends, however it ends, Xenon saves its capture next to the session's other files, in `~/.cache/xenon/assets/sessions/<session id>/interceptor/`: `requests.json` for the requests and `session.har` for the HAR. That covers your test's `driver.quit()` or a `DELETE` of the session, Appium's new command timeout, Xenon's idle release of the phone, a stale heartbeat and a server shutdown. The Network panel and the routes below read it from there when the session is over. [Data retention](./retention.md) removes it with the session's other files.

Xenon also puts the phone's proxy setting back, before it releases the phone. It restores what the phone had before the session, so a proxy your lab set on the phone stays, and a phone that had none ends with none. Only the server that drives the phone does this.

If Xenon is stopped or crashes while a session is capturing, it undoes the change at its next start, from its own record. For a phone that isn't connected then, Xenon keeps that record, and puts the phone right before its next session on the server, or at the next start. A record that still can't be undone a week after the change is dropped, and the phone is left as it is. At start Xenon also clears a proxy on its own Android phones that points at one of its capture ports on this machine, 11100 to 11199, when nothing answers there, because such a phone has no network. A proxy that points anywhere else, or at a capture that is running, is left alone. To clear a proxy at once by hand:

```bash
adb -s <udid> shell settings put global http_proxy :0
```

A response body larger than about 1 MB isn't saved: while the session runs it is kept in a temporary file, which is deleted when the session ends, and the saved capture shows it empty. Headers, status, URL, timing and the failure kind are always saved, as are request bodies and smaller response bodies.

## HAR export

```
GET /xenon/api/interceptor/sessions/<sessionId>/har
```

The answer is the session's traffic as a HAR 1.2 document, sent as a download called `<sessionId>.har`. It is built from memory while the interceptor runs and read from the saved file afterwards. Entries a rule answered or changed carry `_mocked`, `_modified` and `_mockId`, and failed requests are left out, because a HAR holds only completed exchanges. The **HAR** link in the Network panel downloads the same file, and `xenon: exportHar` returns the document to your test.

## REST routes

These routes are under `/xenon/api/interceptor`, and all of them need the Admin role.

| Method | Path | What it does |
|---|---|---|
| `GET` | `/sessions/<sessionId>/requests` | The session's captured requests, as `{ "requests": [...] }`. |
| `GET` | `/sessions/<sessionId>/requests/<requestId>` | One request, with its bodies. |
| `GET` | `/sessions/<sessionId>/har` | The HAR download. |
| `GET` | `/sessions/<sessionId>/mocks` | The running session's rules, as `{ "mocks": [...] }`. |
| `POST` | `/sessions/<sessionId>/mocks` | Adds a rule, given as the body, and answers `201` with `{ "id": "..." }`. |
| `DELETE` | `/sessions/<sessionId>/mocks/<mockId>` | Removes one rule, and answers `{ "removed": true }` or `false`. |
| `DELETE` | `/sessions/<sessionId>/mocks` | Removes every rule, and answers `{ "ok": true }`. |

The requests and the HAR come from memory while the session runs and from the saved capture after it. When there is neither, they answer `404` with `interceptor inactive`. The routes for rules need a session that is running. The [API reference](/api) lists every field.

The commands a test sends with `executeScript` do the same without an Admin role. See [Execute commands](./execute-commands.md#network-interceptor).

## Troubleshooting

**Some requests show up and others don't.** The app that sends the others probably pins its certificate, or trusts only system certificates while you installed yours as a user certificate. Use a debug build that trusts user certificates, or turn pinning off.

**One host always shows as failed with `tls`.** Click the row: if its kind is `HTTPS_CLIENT_ERROR`, that host most likely pins its certificate. Repeated failures show as one row. See [the failure kinds](#what-the-panel-shows).

**A real phone shows no traffic at all.** Look in the server log for `adb reverse failed`. If Xenon fell back to the machine's LAN address, the phone can't reach it: replug the phone and check that `adb devices` lists it, or fix the network between them.

**An iOS session captures nothing.** The interceptor is Android only. The log says `Interceptor v1 supports Android only`.

**The panel is empty for a finished session.** Check that the session was capturing: it asked for it with `xe:interceptor`, or the server's `interceptor` option is on, and the phone was an Android one. Check that its `includeHosts` and `excludeHosts` didn't leave out every host, and that you are signed in as an Admin: a Member sees "Only admins can see network requests".

**A phone has no network after a session.** The phone may still point at a capture proxy. Xenon puts it back when the session ends, and again at its next start if it was stopped mid-session. See [Past sessions](#past-sessions) for the command that clears it by hand.

**A body is empty in a finished session.** Response bodies over about 1 MB aren't saved. See [Past sessions](#past-sessions).

## Related

- [Execute commands](./execute-commands.md): `addMock`, `getRequests` and `exportHar` from a test.
- [Capabilities](./capabilities.mdx): `xe:interceptor` among the other session settings.
- [Network conditioning](./network-conditioning.md): taking a phone offline or slowing a session.
- [Real-time events](./real-time-events.md): the live events the dashboard receives.
