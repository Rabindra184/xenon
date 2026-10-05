---
title: Roles and scopes
description: What a Member, an Admin and a Super admin may do, what the read, sessions, devices and admin scopes allow, the scopes each credential carries, and every route's role and scope.
---

Two things decide what a request may do. The user's **role** says what the person may do, and the credential's **scopes** narrow that for one token. A request must pass both. A third rule, **teams**, decides which phones, sessions and apps someone can see at all. This page explains the roles and scopes, the scopes each kind of credential carries, and lists what every route needs. How to sign in and make tokens is on [Authentication](./authentication.md).

## Roles

Each user has one role. The admin pages in the dashboard's sidebar (**Settings**, **AI engine**, **Maintenance**, **Teams**, **Users** and **API keys**) are shown only to Admins and Super admins.

| Role | What it may do |
|---|---|
| **Member** | Use the dashboard on the phones they can see (the shared pool and their teams' phones): live control, preview and logs, recordings, reservations, installing apps they can see from the library, sessions and builds, and the Selector health actions. Make their own API tokens, with `sessions` and `read`. |
| **Admin** | Everything a Member may, on every phone whatever its team. Manage Members, teams, API keys and webhooks. Upload, move and delete apps. Put phones into maintenance, tag them and give them a team. See network captures. Open the **Settings**, **AI engine** and **Maintenance** pages, but not change them. |
| **Super admin** | Everything an Admin may. Change the lab's settings on the **Settings**, **AI engine** and **Maintenance** pages, and test an AI provider. Manage Admins and other Super admins. |

A role is read from the user's account on every request, so a change applies from the person's next request. The first user is a Super admin, made when the server first starts: see [Sign-in and passwords](./authentication.md#sign-in-and-passwords).

### Managing users

The **Users** page is for Admins and Super admins.

- An Admin may invite, edit, deactivate and delete Members, and send them reset links, and may do none of that for anyone else. A Super admin may do it for anyone.
- Nobody can change their own role, delete themselves or send themselves a reset link.
- The last active Super admin can't be demoted, set to Inactive or deleted.
- **Inactive** signs the person out: from their next request, the dashboard and `/xenon/api` refuse their sign-in and tokens until they are set back to Active, and a test session that presents their access key and token, or their session token, counts as one without credentials. A live preview or log stream they already have open keeps running until it closes, and a dashboard they have open keeps receiving live device and session updates until it is reloaded or its connection drops. **Delete** removes the account and its tokens: see [Hardening](./hardening.md#cut-off-someone-who-leaves).

## Scopes

A credential carries one or more of four scopes:

| Scope | What it allows |
|---|---|
| `read` | Nothing more than any credential has. Every signed-in credential can read what its role and teams allow, so a token with only `read` can read, and gets `403` for the changes that need a scope below. |
| `sessions` | Creating Appium sessions, with an access key and token or a session token, and the Selector health actions (mark fixed, mute, unmute, cancel a verification). A session token carries it only when the credential that asked for it has `sessions` or `admin`. |
| `devices` | Changing phones: device control, the live preview and its tickets, recordings, reservations and SDK leases. With the Admin role also maintenance, tags, uploading and deleting apps, a node's report of its phones, and reserving ports. |
| `admin` | Every scope check passes. With the Admin role: users, teams, API keys, moving a phone or an app to a team, webhooks, the selector digest and the server's process and request logs. With the Super admin role: the lab's settings. It also makes the credential an admin for other people's phones and sessions (see [Acting on someone else's phone or session](#acting-on-someone-elses-phone-or-session)). |

A refused role is `403` with `requires role >= ADMIN` (or the role needed), a missing scope is `403` with `insufficient scope`, and a lab setting changed by an Admin is `403` with `Only a super admin can change the lab's settings.`

## The scopes each credential carries

| Credential | Scopes |
|---|---|
| Dashboard sign-in | By role: `devices`, `sessions` and `read` for a Member; `admin`, `devices`, `sessions` and `read` for an Admin or a Super admin. |
| A token from the Profile page, with no scopes chosen | By role: `sessions` and `read` for a Member; `devices`, `sessions` and `read` for an Admin; `admin` for a Super admin. |
| A token made with `POST /xenon/api/profile/tokens` and `scopes` | The scopes asked for, within the two limits below. |
| A key from the **API keys** page | The scopes the admin ticked, any of the four. |
| A `xenon-rest` bearer token | The scopes of the credential that asked for it. |
| A `xenon-mcp` bearer token | `sessions` and `devices` as its MCP scopes give them: see [Bearer tokens](./authentication.md#bearer-tokens). |
| A session token (`sessionToken`) | `sessions`, and `admin` as well when an admin credential asked for it with no MCP scopes or all five: see [Credentials in a test session](./authentication.md#credentials-in-a-test-session). |

So a Member's dashboard sign-in can control phones and lease them, but the tokens a Member makes on the Profile page can't: a script that controls, records, reserves or leases phones needs an Admin's token, or a key with the `admin` scope. A Member's one-hour bearer token from `POST /xenon/api/auth/token`, asked for with the dashboard sign-in, does carry `devices`.

An Admin's Profile tokens leave out `admin` on purpose, so a CI token doesn't manage the lab. An Admin who needs a key with `admin` makes it on the API keys page.

### A token can't have more than its creator

A token made on the Profile page or with `POST /xenon/api/profile/tokens` gets only scopes that both the person's role allows there and the credential making the request has. A `read`-only key can't make itself a `sessions` token, and a Member can't make a `devices` token. The answer to a request for more is `400` with `cannot widen scopes beyond your role or the credential you are using`, and an unknown scope name is `400` too.

A bearer token never has more scopes than the credential that asked for it, and neither does a session token, which Xenon makes only for a credential with `sessions` or `admin`. A key from the API keys page needs a credential with `admin`, which passes every scope check already.

Nor can anything a credential makes outlast it. A token or key made with a bearer token, or with a token that has an expiry, ends no later than that credential, and so do the bearer and session tokens asked for with one.

Changing someone's role doesn't change the API keys and tokens they already have. A demoted Admin keeps any key with the `admin` scope until it is revoked, and it still counts as an admin's: see [Hardening](./hardening.md#use-tokens-with-the-least-they-need). Their bearer tokens stop counting `admin` once they are a Member, and their session tokens no longer take over someone else's lease.

## Acting on someone else's phone or session

Some rules protect what a person is using: device control of a phone someone else holds, someone else's live preview, recording or reservation, a test session's commands with [per-command checks](./authentication.md#check-every-command) on, and a phone under someone else's lease. For these, an admin is:

- a Super admin, with any of their credentials;
- any credential with the `admin` scope: an Admin's dashboard sign-in, or a key from the API keys page with `admin` ticked.

An Admin's token from the Profile page has no `admin` scope, so these rules treat it like a Member's, though it still sees every phone. A session token takes over someone else's lease only when its user is a Super admin, or an Admin and the token carries `admin`: see [Leases for CI](./leases.md#run-a-session-on-the-lease).

## What each route needs

Routes are under `/xenon/api`. **Member** means any signed-in user, since every role includes a Member's. A dash in the Scope column means none is needed. Every list and read shows only the phones, sessions, builds, apps and recordings the caller's teams allow: see [Teams](./teams.md).

### Reading

| What | Route | Role | Scope |
|---|---|---|---|
| Phones, the session queue, nodes | `GET /devices`, `/device`, `/device/<platform>`, `/queue`, `/queue/…`, `/sessions/active`, `/node` | Member | – |
| Sessions, builds, their logs and files | `GET /session`, `/session-summary`, `/session/<id>/…`, `/build` | Member | – |
| Self-healing and Selector health | `GET /healing/…` | Member | – |
| Apps in the library | `GET /apps`, `/apps/<id>/download` | Member | – |
| Recordings and their downloads | `GET /recordings`, `/recordings/…` | Member | – |
| Reservations | `GET /reservation` | Member | – |
| A phone's screenshot, installed apps, screen state and preview | `GET /control/<udid>/screenshot`, `/apps`, `/display`, `/stream`, `/stream/status` | Member | – |
| A phone's clipboard and logs | `GET /control/<udid>/clipboard`, `/logs` | Member, and nobody else holds the phone | – |
| Metrics, features, the SDK version | `GET /metrics`, `/capabilities`, `/sdk/version` | Member | – |

### Tests and sessions

| What | Route | Role | Scope |
|---|---|---|---|
| Create an Appium session with an access key and token, or a session token | `POST <base path>/session`, credentials in `xe:options` | Any | `sessions` |
| Mark a selector fixed, mute, unmute, cancel a verification | `POST /healing/selector/state` | Member | `sessions` |
| Make a bug report | `POST /sessions/<id>/bug-report` | Member | – |
| Export a build | `POST /build/<id>/export` | Member | – |

A bug report includes the session's network capture only for an Admin or a Super admin.

### Phones

| What | Route | Role | Scope |
|---|---|---|---|
| Control a phone: tap, swipe, type, keys, lock, unlock, install, uninstall, Shell, Test locator | `POST /control/<udid>/…` | Member, and nobody else holds the phone | `devices` |
| Live preview: start, leave, stop, a ticket | `POST /control/<udid>/stream/start`, `/stream/leave`, `/stream/stop`, `/stream/ticket` | Member | `devices` |
| Record, add a phone, stop, bookmark, annotate | `POST /recordings`, `/recordings/<id>/…` | Member | `devices` |
| Delete a recording | `DELETE /recordings/<id>` | Member who made it, or an admin | `devices` |
| Reserve a phone | `POST /reservation` | Member | `devices` |
| Release or extend a reservation | `DELETE /reservation/<udid>/<host>`, `POST /reservation/<udid>/<host>/extend` | Member who made it, or an admin | `devices` |
| Lease a phone for CI | `POST /sdk/leases`; heartbeat, extend and release also need the lease token | Member | `devices` |
| Maintenance | `POST /block`, `/unblock` | Admin | `devices` |
| Tags | `POST /device/tags` | Admin | `devices` |
| Upload or delete an app | `POST /apps/upload`, `DELETE /apps/<id>` | Admin | `devices` |
| A node's report of its phones | `POST /register` | Admin | `devices` |
| Reserve ports for a phone | `POST /ports/allocate` | Admin | `devices` |

### Running the lab

| What | Route | Role | Scope |
|---|---|---|---|
| Users | `GET`, `POST /users`; `PATCH`, `DELETE /users/<id>`; `POST /users/<id>/reset-link` | Admin (Members only), Super admin (anyone) | `admin` |
| Teams and their members | `/teams`, `/teams/<id>`, `/teams/<id>/members` | Admin | `admin` |
| API keys | `/apikeys`, `/apikeys/<id>` | Admin | `admin` |
| Move a phone or an app to a team | `PUT /device/<udid>/team`, `PUT /apps/<id>/team` | Admin | `admin` |
| Webhooks | `/webhook`, `/webhook/<id>`, `POST /webhook/test` | Admin | `admin` |
| Send the selector digest | `POST /healing/digest/send` | Admin | `admin` |
| Network capture, HAR and mocks | `/interceptor/sessions/<id>/…` | Admin | – |
| Process list, request log, node status, stored server arguments | `GET /processes`, `/logs/requests`, `/node/status`, `/node/<host>/status`, `/cliArgs` | Admin | `admin` |
| Read the lab's settings | `GET /config` | Admin | – |
| Change the lab's settings, reset the counters, test an AI provider | `POST /config`, `/config/reset-metrics`, `/config/test-ai` | Super admin | `admin` |

Two other routes need only the `admin` scope, with any role: `POST /audit/events`, where MCP tooling sends its audit records, and `POST /projects`.

### Your own account

Any signed-in user, with any scope: `GET /auth/me`, `POST /auth/token`, `POST /auth/change-password`, and their own tokens and access key under `/profile/tokens` and `/profile/access-key`. `POST /profile/access-key/rotate` takes a dashboard sign-in, or a credential with the `admin` scope.

The [API reference](/api) lists every route with its role, scope and answers.

## Teams

Roles and scopes say what someone may do; teams say on which phones. A Member sees the shared pool and their teams' phones, and the sessions, apps and recordings that go with them. Admins and Super admins see everything, whatever their token's scopes. [Teams](./teams.md) explains how to set them up.

## Related

- [Authentication](./authentication.md)
- [Teams](./teams.md)
- [Hardening](./hardening.md)
- [Leases for CI](./leases.md)
- [Live device control](./device-control.md)
