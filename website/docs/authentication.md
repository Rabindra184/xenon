---
title: Authentication
description: The credentials Xenon accepts, how to make an access key and token, how a test session signs in, per-command checks, tickets, the same-origin rule, rate limits, sign-in and password reset.
---

This page explains how people, scripts, tests and nodes prove who they are to Xenon. It covers the credentials the API accepts, how to make them, how a test session presents them, the settings that make Xenon check sessions and commands more strictly, and how sign-in and passwords work. What each person may then do is on [Roles and scopes](./roles-and-scopes.md), and the settings to use on a lab others can reach are on [Hardening](./hardening.md).

## The credentials Xenon accepts

Every request under `/xenon/api` needs one of these. The exceptions are sign-in, sign-out and password reset, the public key at `GET /xenon/api/auth/jwks.json`, `GET /xenon/api/health`, and the few calls one Xenon server makes to another.

| Credential | How it is sent | Who uses it |
|---|---|---|
| Dashboard sign-in | The `xenon_dashboard_session` cookie, which `POST /xenon/api/auth/login` sets | People, in the browser |
| Access key and token | The `x-xenon-access-key` and `x-xenon-token` headers | Scripts, CI and nodes |
| Bearer token | `Authorization: Bearer <token>`, from `POST /xenon/api/auth/token` | SDKs, MCP tools, short-lived access |
| Hub token | The `x-xenon-hub-token` header | A hub calling its own nodes, and nothing else. You never make or send one. |

- **The access key says who you are; the token is the secret.** Each user has one access key, which starts with `xen_` and is shown on their Profile page. A user can have many tokens. Xenon stores only a hash of a token and shows its value once, when it is made.
- **One credential per request.** When a request carries more than one, Xenon uses the header pair first, then a bearer token, then the cookie. A pair or a bearer token that doesn't check out is refused with `401`; Xenon doesn't fall back to the cookie.
- **The account is checked every time.** Each request looks the user up, so a user set to Inactive, or deleted, is refused on their next request with any of these credentials. Their credentials no longer create test sessions as them either: see [Credentials in a test session](#credentials-in-a-test-session).
- **Refusals** are `401` with `invalid credentials`, `invalid token`, `invalid session` or `unauthenticated`.
- **Who am I.** `GET /xenon/api/auth/me` answers with the caller's user id, email, role, access key, scopes and teams.

A hub signs its tokens itself, for one to five minutes at a time, and its nodes check them against the hub's public key at `GET /xenon/api/auth/jwks.json`. [Hub and nodes](./hub-and-nodes.md#security) explains what they carry.

## Make an access key and token

### On the Profile page

1. Open the account menu at the top right and choose **Profile**, then **API tokens**.
2. **Access Key** at the top is your access key. Copy it.
3. Choose **Generate new token**. Give it a **Description**, such as `ci-main`, and choose how long it lasts under **Expires after**: 7 days, 30 days (the default), 90 days, 1 year or No expiry. Choose **Create**.
4. Copy the token straight away. Xenon shows it once.

A token made here gets every scope your role allows on this page: `sessions` and `read` for a Member, `devices`, `sessions` and `read` for an Admin, and `admin` for a Super admin. To make a token with fewer scopes, use the API below. [Roles and scopes](./roles-and-scopes.md) explains what each scope allows.

- **Delete a token** with the bin icon in its row. It stops working at once.
- **Rotate the access key** with the arrows beside it. The old access key stops working at once. Your tokens stay valid, but only with the new access key, so update every client that uses one of them. Over the API, `POST /xenon/api/profile/access-key/rotate` takes a dashboard sign-in or a credential with the `admin` scope, and answers any other credential `403`.

### From a script

Sign in with your email and password, keep the cookie, and make a token with the scopes you want. Requests that use the cookie need an `Origin` header that matches the server's address (see [Requests from a browser](#requests-from-a-browser)), and the `X-Appium-Is-Sensitive` header keeps the password out of Appium's log (see [Keep secrets out of Appium's log](#keep-secrets-out-of-appiums-log)):

```bash
XENON=http://localhost:4723

# Sign in; the cookie goes into cookies.txt
curl -c cookies.txt -X POST $XENON/xenon/api/auth/login \
  -H "Origin: $XENON" -H 'Content-Type: application/json' \
  -H 'X-Appium-Is-Sensitive: true' \
  -d '{"email":"you@example.com","password":"your-password"}'

# Your access key
curl -b cookies.txt $XENON/xenon/api/profile/access-key
# {"accessKey":"xen_..."}

# A token that can run sessions and read, valid until the date given
curl -b cookies.txt -X POST $XENON/xenon/api/profile/tokens \
  -H "Origin: $XENON" -H 'Content-Type: application/json' \
  -d '{"name":"ci-main","scopes":["sessions","read"],"expiresAt":"2027-01-01T00:00:00Z"}'
# {"id":"0e4b8a2c-...","token":"3b9f1d7c...","expiresAt":"2027-01-01T00:00:00.000Z"}
```

`scopes` may name only scopes your role allows here and the credential you are using has. Leave it out to get all of your role's, which the credential you are using must also have: otherwise the answer is `400`. Leave `expiresAt` out for a token that never expires. A token made with a credential that expires, such as a bearer token or a token with an expiry, can't outlast it: without `expiresAt` it gets that credential's expiry, and a later `expiresAt` is refused with `400`.

### On the API keys page

Admins also have an **API keys** page. **Create new key** takes a name, any scopes (`admin` included), a rate limit, a **Team** and an expiry. Over the API, `POST /xenon/api/apikeys` refuses a scope other than `read`, `sessions`, `devices` and `admin` with `400`. The key belongs to the admin who makes it: it is used with that admin's access key, sessions it creates are that admin's, and it reaches every phone, whatever team it names, while its owner is an Admin or a Super admin. To keep a test session to one team, set `xe:options.team` (see [Teams](./teams.md#what-a-test-gets)). The page lists every token in the lab, the ones people made on their Profile page included, with when each was last used. **Revoke** stops one at once.

## Bearer tokens

`POST /xenon/api/auth/token`, called with a dashboard sign-in, an access key and token, or a bearer token, returns a signed token to send as `Authorization: Bearer <token>`:

```bash
curl -X POST http://localhost:4723/xenon/api/auth/token \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"audience":"xenon-rest"}'
# {"token":"eyJ...","expiresIn":3600,"audience":"xenon-rest"}
```

The `audience` says what the token is for:

| `audience` | Lasts | Its scopes |
|---|---|---|
| `xenon-rest`, the default | One hour | The scopes of the credential that asked for it. |
| `xenon-mcp` | `XENON_MCP_TOKEN_TTL_SEC` seconds, 86400 (24 hours) by default | Set by the MCP scopes it is given, below. When they include `appium:use`, the answer also carries a `sessionToken` for test sessions. |

- A bearer token asked for from a dashboard sign-in carries that sign-in's scopes, so a Member's has `devices` as well as `sessions` and `read`.
- **It can't outlast the credential that asked for it.** A bearer token asked for with another bearer token, or with a token that has an expiry, ends no later than that credential, and `expiresIn` says so.
- **The user is looked up on every request,** so deactivating or deleting the account stops its bearer tokens at once, and a token's `admin` scope stops counting once its user is a Member.
- **Revoking the token that asked for it doesn't stop it.** A bearer token works until it expires, whatever happens to the token or key it was asked for with. To stop a person's bearer tokens at once, set the user to Inactive.
- Xenon signs these tokens, and the stream tickets below, with the key in `xenon-jwt-private.pem` in its data folder (see [Production deployment](./deployment.md#where-xenon-keeps-its-data)). Anyone who has that file can sign tokens: keep it private.

For `xenon-mcp`, the body may list MCP scopes in `scopes`: `appium:use`, `xenon:devices:read`, `xenon:devices:lock`, `xenon:analytics:read` and `xenon:recordings`. Without it the token gets whichever of `appium:use` and `xenon:devices:read` the credential allows. Each must be one the credential allows: `read` allows the two `:read` scopes, `sessions` allows `appium:use` and `xenon:recordings`, `devices` allows `xenon:devices:read`, `xenon:devices:lock` and `xenon:recordings`, and `admin` allows all five. On the API the token then has `sessions` if it was given `appium:use` and `devices` if it was given `xenon:devices:lock`, and `admin` only when an admin credential asks for all five. An unknown scope is refused with `400 unknown_scope`, and one beyond the credential with `403 scope_exceeds_key`.

## Credentials in a test session

A test signs in through its capabilities, in `xe:options`: an access key and token, or a session token.

```js
'xe:options': {
  accessKey: process.env.XENON_ACCESS_KEY,
  token: process.env.XENON_TOKEN,
},
```

```js
'xe:options': {
  sessionToken: process.env.XENON_SESSION_TOKEN,
},
```

- **They decide the session's owner.** The owner decides which phones the session may get (see [Teams](./teams.md#what-a-test-gets)) and who may control its phone while it runs.
- **They need the `sessions` scope.** A valid key without it is refused when the session is created, with `400 invalid argument` and ``credentials are invalid, revoked, or lack the `sessions` scope``. So is a valid session token without it, whether or not [`XENON_REQUIRE_SESSION_TOKEN`](#refuse-sessions-without-credentials) is on, with a message that starts ``session rejected: xe:options.sessionToken carries no `sessions` scope``. Session tokens made by Xenon 2.14 or earlier carry no scopes, so mint new ones: see [Upgrading](./upgrading.md#from-214-to-215).
- **Wrong credentials count as none.** A key and token, or a session token, that don't check out are treated as missing: a wrong, revoked or expired one, and the credentials of a user who is Inactive or deleted. The session still runs, with no owner, and the server log says `Session created without valid credentials`. Only an admin can then control its phone. To refuse such sessions, see [Refuse sessions without credentials](#refuse-sessions-without-credentials).
- **An owner that can't be looked up refuses the session.** When Xenon can't check the credentials at all, because its database or its signing key is unavailable, the create fails and no phone is given out. Retry it.
- **A session token** is the `sessionToken` field of the answer to `POST /xenon/api/auth/token` with `{"audience":"xenon-mcp"}`, and lasts as long as that token. Xenon makes one only for a credential with the `sessions` or `admin` scope, and only when the MCP scopes asked for include `appium:use`, as they do by default. It carries `sessions`, and `admin` too when the credential has `admin` and asked for no MCP scopes or for all five. It only says who created the session: the API doesn't accept it as a bearer token.
- **Xenon removes them.** The credentials are taken out of the capabilities before the driver, the session's record, the dashboard or Xenon's own logs see them, and never leave the server they were sent to. [Capabilities](./capabilities.mdx#how-xenon-sees-your-credentials) has the details, and `xenon:options`, the older name, works too.

### Keep secrets out of Appium's log

Appium logs the body of every request it receives, cut at 1,024 characters, before Xenon or any other plugin runs. Xenon's own log lines hide secrets, but these lines are Appium's.

- **Requests marked sensitive are hidden.** A request with the `X-Appium-Is-Sensitive: true` header is logged without its body, as `--> POST /xenon/api/auth/login **SECURE**`. The dashboard sends that header with every request that carries a password, a reset token or an API key.
- **Scripts and SDKs must mark their own.** One that calls `POST /xenon/api/auth/login`, `/auth/change-password`, `/auth/reset-password`, `/auth/dashboard-session`, or `POST /xenon/api/users` with a `password`, should send `X-Appium-Is-Sensitive: true` too, as the [example above](#from-a-script) does, or rely on the rules below.
- **A test session needs the header or a rule.** The `POST /session` that creates it carries its `token`, `sessionToken` or `leaseToken` in the body. A client that can add a header may send `X-Appium-Is-Sensitive: true` with it; otherwise the first rule below hides them.
- **The rules below don't hide them.** Webhook addresses (`POST /xenon/api/webhook` and `/webhook/test`), which often work as a secret, text typed on a phone through device control (`POST /xenon/api/control/<udid>/text`) and text written to its clipboard (`POST /xenon/api/control/<udid>/clipboard`, `content`) are logged as sent. Limit who can read Appium's log and where it is shipped.

Give the Appium server `log-filters` rules that hide the rest. In a JSON file passed with `--log-filters <file>`:

```json
[
  {"pattern": "([Tt]oken\\\\?[\"']?\\s*:\\s*\\\\?[\"']?)[A-Za-z0-9._~+/=-]+", "flags": "g", "replacer": "$1**REDACTED**"},
  {"pattern": "((?:[Pp]assword|apiKey)\\\\?[\"']?\\s*:\\s*(\\\\?)([\"'`]))(?:\\2\\\\(?:\\2[\\s\\S]|[^\\\\])|(?!\\3)[^\\\\\\x00-\\x1f])*", "flags": "g", "replacer": "$1**REDACTED**"}
]
```

Or in an Appium config file (`--config`, which is how [Xenon Control](./xenon-control.md) starts Appium):

```yaml
server:
  log-filters:
    - pattern: '([Tt]oken\\?["'']?\s*:\s*\\?["'']?)[A-Za-z0-9._~+/=-]+'
      flags: g
      replacer: '$1**REDACTED**'
    - pattern: '((?:[Pp]assword|apiKey)\\?["'']?\s*:\s*(\\?)(["''`]))(?:\2\\(?:\2[\s\S]|[^\\])|(?!\3)[^\\\x00-\x1f])*'
      flags: g
      replacer: '$1**REDACTED**'
```

The first rule is the one in the [2.0.0 release notes](./release-notes.md#200). It hides the values of `token`, `sessionToken` and `leaseToken`, even in a body Appium cut off inside one. The second is the password rule in the [2.1.0 release notes](./release-notes.md#210) with `apiKey` added, so use it in place of that one. It hides `password`, `oldPassword`, `newPassword` and `apiKey`. A request log line becomes, for example, `--> POST /xenon/api/auth/login {"email":"you@example.com","password":"**REDACTED**"}`. Appium doesn't log request headers, so the `x-xenon-*` and `Authorization` headers never reach its log.

### Refuse sessions without credentials

With `XENON_REQUIRE_SESSION_TOKEN=true` in the server's environment, a session is created only with a valid access key and token, or a valid session token, of a user who is Active. Despite its name, the key and token are enough. `1`, `yes` and `on` work as well as `true`. Anything else is refused with `400 invalid argument`, and the message says why:

- `session rejected: XENON_REQUIRE_SESSION_TOKEN is enabled and the session presented no valid credentials`, then how to pass them, for no credentials, or a key and token that don't check out;
- `session rejected: xe:options.sessionToken is invalid or expired`, for a session token that doesn't check out, its user's account included.

A session token without the `sessions` scope, and a key without it, are refused whether this is on or not, as [above](#credentials-in-a-test-session).

On a hub with nodes, set it on the hub, where every create arrives first. The [Kotlin SDK](./kotlin-sdk.mdx#what-you-need) works with it as long as `xenon.attachSessionCredentials` stays `true`, because the SDK then sends your key and token in the session's capabilities.

## Check every command

Without more, Xenon checks credentials only when a session is created. Every later command, `<base path>/session/<id>/...`, is accepted on the strength of the session id alone, so anyone who learns an id can drive that session. With `XENON_REQUIRE_COMMAND_AUTH=true` (or `1`, `yes`, `on`) in the server's environment, each of those requests must carry credentials too:

- **The headers, not the capabilities.** Each request needs the `x-xenon-access-key` and `x-xenon-token` headers, or `Authorization: Bearer` with a `xenon-rest` or `xenon-mcp` token. The dashboard cookie isn't accepted here. A `xenon-rest` token lasts an hour, so a run that may last longer should send the key pair.
- **The owner or an admin.** The caller must be the session's owner, or a Super admin, or use a credential with the `admin` scope. An Admin's token from the Profile page doesn't have `admin`, so it reaches only the Admin's own sessions. A session created without credentials has no owner, so only those admins can drive it.
- **A refusal looks like an unknown session:** `404` with `invalid session id` and `A session is either terminated or not started`, exactly what Appium answers for a session that doesn't exist. The server logs a warning that starts with `Command refused:` and says why.
- **When the check can't run,** because Xenon couldn't check the credential or look up the owner, the answer is `503` with `Xenon could not verify access to this session. Try again.` It never lets the command through.
- **A credential that checks out is remembered for 30 seconds.** A revoked token, a rotated access key or a deactivated user stops working for commands within 30 seconds, and at once on the rest of the API.
- **Session WebSockets too.** BiDi (`<base path>/bidi/<id>`) and the sockets drivers open under `/ws/session/<id>/` need the same headers, on the upgrade request itself. A browser page can't set headers on a WebSocket, so it can't open these sockets. A refusal is a bare `404` and the socket is closed, and when the check can't run the answer is `503`. The BiDi socket that belongs to no session (`<base path>/bidi`), socket.io, and the dashboard's preview and log sockets, which use [tickets](#tickets-for-previews-and-app-downloads), aren't affected.
- **Appium's session list** (`GET <base path>/appium/sessions`, which needs Appium's `session_discovery` insecure feature) shows a caller only their own sessions: all of them to an admin as above, and none to a request without credentials. An error from Appium, such as its answer while `session_discovery` is off, is passed on unchanged. When Xenon can't check the credential or look up the owners, the answer is `503`, never the whole list.

Set it before Appium starts. The server log then says `Per-command auth is ON`, and `GET /xenon/api/capabilities` reports the setting as `features.commandAuth`, so a client can check before it starts. If Xenon can't place the check in front of Appium's own routes, the server refuses to start rather than run without it. It has no effect while sign-in is turned off. On a hub with nodes, turn it on on the hub: the hub checks each command before it forwards it.

:::caution[Every client must send credentials with every command]
With this on, your WebDriver client has to add the headers to every request after the create, the one that ends the session included. A client that doesn't gets its session created and then `404 invalid session id` for every command. The [Kotlin SDK](./kotlin-sdk.mdx#what-you-need) is one: it sends no Xenon headers with its commands, so leave this off on a server that runs Kotlin SDK sessions.
:::

The create still takes its credentials from `xe:options`, so a client sends both. In WebdriverIO, the `headers` option adds headers to every request:

```js
import { remote } from 'webdriverio';

const driver = await remote({
  hostname: 'localhost',
  port: 4723,
  headers: {
    'x-xenon-access-key': process.env.XENON_ACCESS_KEY,
    'x-xenon-token': process.env.XENON_TOKEN,
  },
  capabilities: {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'xe:options': {
      accessKey: process.env.XENON_ACCESS_KEY,
      token: process.env.XENON_TOKEN,
    },
  },
});
```

For other clients, look for their setting that adds headers to every request. To try a session's command by hand:

```bash
curl http://localhost:4723/session/$SESSION_ID/source \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN"
```

## Tickets for previews and app downloads

Some requests come from places that can't send headers. For those, Xenon issues a ticket: a signed token that works once, for one thing, for a short time.

- **Live preview and logs.** A browser `<img>` and a WebSocket can't send headers, so the dashboard first calls `POST /xenon/api/control/<udid>/stream/ticket`. That needs the `devices` scope and a phone the caller can see, and answers `{"ticket": "...", "expiresIn": 60}`. The ticket works once, for that phone only, within 60 seconds, as `?ticket=` on the MJPEG preview (`GET /xenon/api/control/<udid>/stream`) or on the H.264 preview and logs WebSockets. The dashboard does all of this itself.
- **App downloads.** When a session names an app from the library, the driver downloads it with no credentials of its own. Xenon puts a ticket in the download address it gives the driver: one use, that app only, for 10 minutes. The ticket isn't stored with the session.

Appium's request log prints addresses, tickets included. By the time anyone reads the log, a ticket has been used or will expire within minutes. With sign-in turned off, the MJPEG preview and app downloads need no ticket, and the H.264 preview and logs WebSockets still take one, which the dashboard gets as usual.

## Requests from a browser

A `POST`, `PUT`, `PATCH` or `DELETE` under `/xenon/api` that doesn't carry the `x-xenon-access-key` header or an `Authorization: Bearer` header must come with an `Origin` or `Referer` header. Its host, port included, must match the `Host` the server was reached at, or be listed in `XENON_ALLOWED_ORIGINS`. That applies to sign-in too. Otherwise the answer is `403` with `CSRF: Origin or Referer header required`, `CSRF: invalid Origin/Referer` or `CSRF: Origin/Referer mismatch`.

- A browser sends `Origin` itself. A script that uses the cookie must send it, as in the example above.
- `XENON_ALLOWED_ORIGINS` is a comma-separated list of origins (`https://xenon.example.com`) or bare hosts (`xenon.example.com`), for a dashboard served at an address other than the one the server sees. Xenon reads it when it starts. A reverse proxy that keeps the `Host` header doesn't need it: see [HTTPS behind a reverse proxy](./deployment.md#https-behind-a-reverse-proxy).
- The cookie itself is `HttpOnly` and `SameSite=Strict`, and `Secure` when the request came over HTTPS, directly or with `X-Forwarded-Proto: https` from a proxy.

The check is off while sign-in is turned off.

## Rate limits

Xenon limits how many `/xenon/api` requests each caller makes a minute. It counts three kinds of request apart, so a burst of one kind doesn't block the others:

| Caller | Reads | Changes | AI changes |
|---|---|---|---|
| An access key and token | The key's rate limit, 300 a minute by default | The key's rate limit | A quarter of the key's rate limit, at least 10 |
| A signed-in user, or a bearer token | 3,000 a minute | 300 a minute | 75 a minute |

- **Reads** are `GET`, `HEAD` and `OPTIONS`. **AI changes** are changes on the routes that run an AI provider or a screen analysis, such as testing an AI provider and **Test locator**. **Changes** are every other `POST`, `PUT`, `PATCH` and `DELETE`.
- A token from the Profile page has a rate limit of 300. An admin sets a key's rate limit on the API keys page.
- A user's dashboard sign-ins and bearer tokens share one count. Each key has its own.
- The allowance refills evenly over the minute. Every answer carries `X-RateLimit-Category`, `X-RateLimit-Remaining` and `X-RateLimit-Capacity`. Past the limit, the answer is `429` with a `Retry-After` header in seconds and a body such as `{"error":"rate limit exceeded","category":"control","retryAfter":2}`.
- Each server counts its own requests. Appium's WebDriver commands aren't counted. Sign-in and password reset have their own limits, below.

## Sign-in and passwords

The first user, a Super admin, is made from `XENON_BOOTSTRAP_ADMIN_EMAIL` and `XENON_BOOTSTRAP_ADMIN_PASSWORD` the first time the server starts with an empty database. Without them the account is `admin@xenon.local` with the password `Admin@123`, so set your own before that first start. Admins add everyone else on the **Users** page with **Invite user**, which shows a temporary password once.

- **How long a sign-in lasts.** 24 hours after the last request. Every request extends it. `XENON_USER_SESSION_TTL_MS` sets another time, in milliseconds, shorter or longer. **Logout** in the account menu ends the sign-in on the server too.
- **Too many attempts.** Xenon allows 5 sign-in attempts per client address in 5 minutes, and a successful sign-in starts the count again. After that, sign-in answers `429` with `too many login attempts` and a `Retry-After` header, and the sign-in page counts down. `XENON_LOGIN_RATE_LIMIT_ATTEMPTS` and `XENON_LOGIN_RATE_LIMIT_WINDOW_MS` change the number and the window. The client address is the first value of `X-Forwarded-For` when the request has one, so put the server behind a proxy that sets that header itself: see [HTTPS behind a reverse proxy](./deployment.md#https-behind-a-reverse-proxy).
- **Same answer either way.** A wrong email and a wrong password both answer `401 invalid credentials`. An Inactive user can't sign in.
- **Passwords** set on the Profile, Users or reset page must be at least 8 characters. Xenon stores only a bcrypt hash of each.
- **Change your password** on **Profile**, **Password & authentication**, with **Update password**. It signs you out in your other browsers and cancels any reset link sent to you.

### A forgotten password

Xenon emails reset links when two things are set in the server's environment: a mail server in `XENON_SMTP_URL`, and the server's address in `XENON_PUBLIC_URL`. Then the **Forgot password?** page emails a reset link, and so does **Reset password** on the **Users** page. [Notifications](./notifications.md#email-for-password-resets) shows how to set the mail server up. When either is missing, the sign-in page tells people to ask an administrator, and **Reset password** on the **Users** page shows the link once, to copy and pass on. An Admin can do that for Members, and a Super admin for anyone but themselves.

- **The link points at `XENON_PUBLIC_URL`,** as `<address>/xenon/reset-password`, never at the address a request came to. Set it to the scheme, host and port people use, such as `https://xenon.example.com` or `http://lab-mac:4723`. The dashboard's own address, ending in `/xenon/`, works too. Any other path, a query or a user name in it, makes Xenon ignore the variable and log a warning at startup. A link an administrator copies from the **Users** page while it isn't set points at the address their browser used.
- **A link works once** and expires after an hour by default (`XENON_RESET_TOKEN_TTL_MS`, in milliseconds), and the email says how long it lasts. Setting a new password with it signs the user out everywhere and cancels their other links.
- **The form doesn't say whether an account exists.** It answers the same for any email, and allows 3 requests per client address in 15 minutes (`XENON_RESET_RATE_LIMIT_ATTEMPTS`, `XENON_RESET_RATE_LIMIT_WINDOW_MS`).
- **Leave `XENON_PASSWORD_RESET_LOG_FALLBACK` off.** Set to `true`, with `XENON_PUBLIC_URL` set and no mail server, it writes the reset links asked for with `POST /xenon/api/auth/forgot-password` to the server log, where anyone who can read the log can use them.

### A Super admin who is locked out

Start the server once with `XENON_BOOTSTRAP_RESET_PASSWORD=true` and `XENON_BOOTSTRAP_ADMIN_PASSWORD` set to a new password. At startup, Xenon sets the password of the oldest active Super admin to it and signs them out. Then remove `XENON_BOOTSTRAP_RESET_PASSWORD`: it does the same at every start while it is set, and with no `XENON_BOOTSTRAP_ADMIN_PASSWORD` it sets the password to `Admin@123`.

## Turning sign-in off

`XENON_AUTH_DISABLED=true` in the environment, or the `authDisabled` option (`--plugin-xenon-auth-disabled`), turns sign-in off. Either one is enough. Then every caller is treated as a Super admin without signing in: the same-origin rule, the per-command check and the team rule are off, the MJPEG preview and app downloads need no ticket, and test sessions have no owner. The server logs `Authentication is DISABLED` at startup, and the dashboard's account menu says `Sign-in is off on this server.`

Use it only on your own machine, for development. See [Hardening](./hardening.md).

## Related

- [Roles and scopes](./roles-and-scopes.md)
- [Hardening](./hardening.md)
- [Teams](./teams.md)
- [Capabilities](./capabilities.mdx)
- [Leases for CI](./leases.md)
- [Hub and nodes](./hub-and-nodes.md)
