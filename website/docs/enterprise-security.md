---
title: Security
---

# Security & Compliance

This page describes what ships in Xenon today. For features that are commonly requested but not yet implemented, see [Roadmap](#roadmap) at the bottom.

---

## Identity model

Xenon ships an enterprise identity stack: **users** with roles (`SUPER_ADMIN` / `ADMIN` / `MEMBER`), **teams** that scope which devices a user can reach, and **API tokens** minted per-user with their own scope set. The dashboard, programmatic clients, and hub-node channel all flow through the same identity surface.

### First-run bootstrap

On first start Xenon creates a `SUPER_ADMIN` user from environment variables (defaults `admin@xenon.local` / `Admin@123` — change in any non-throwaway environment):

```bash
export XENON_BOOTSTRAP_ADMIN_EMAIL="you@example.com"
export XENON_BOOTSTRAP_ADMIN_PASSWORD="..."  # change me
```

Sign in at `https://<host>/xenon/` with these credentials. From `/profile` you can mint API tokens and rotate your access key. For CI use, programmatically `POST /api/auth/login` to get the cookie, then `POST /api/profile/tokens` to mint a scoped token under the bootstrap user.

## Authentication shapes

Every endpoint under `/xenon/api/*` is gated when `authDisabled` is `false` — the default. Xenon accepts three shapes; pick whichever matches your caller.

| Shape | Header(s) | When to use |
|---|---|---|
| **Cookie session** | `Cookie: xenon_dashboard_session=…` | Dashboard browser sessions. Set by `POST /api/auth/login` with `{email, password}`. `httpOnly`, `sameSite=strict`, sliding 24-hour TTL that re-ups on every authenticated request, marked `secure` when the request arrives over HTTPS (or via an `X-Forwarded-Proto: https` proxy hop). |
| **Pair auth** | `X-Xenon-Access-Key` + `X-Xenon-Token` | Programmatic clients (CI, SDK, hub→node). Each user has one access key (rotatable from `/profile`) and any number of scoped tokens minted from `/profile` → API Tokens. The token is shown once at creation and stored as a salted hash. |
| **Auth disabled** | _(none)_ | Local dev only. Set `--plugin-xenon-auth-disabled` (or `XENON_AUTH_DISABLED=true`). A WARN logs every 60 s. |

### Scopes

Tokens carry one or more scopes:

| Scope | Grants |
|---|---|
| `read` | All `GET` endpoints — dashboard polling, log pulls, metric scrapes. |
| `sessions` | Session lifecycle mutations (cancel, set status, attach evidence). |
| `devices` | Device control mutations (block, unblock, reset, reservation, hub-node `/register` and `/unblock`). |
| `admin` | Super-scope. Includes everything above plus user / team / API-key management, config writes, healing-state writes, digest webhooks. |

`admin` always satisfies a scope check. Mutation-only guards let `GET` traffic through with any authenticated token but require the listed scope for `POST`/`PUT`/`PATCH`/`DELETE` on the same resource.

### Roles vs. scopes vs. teams

- **Role** (`SUPER_ADMIN` / `ADMIN` / `MEMBER`) is on the user; it controls what the user can do in the dashboard (e.g. invite users, manage teams) and the maximum scope set their tokens may carry.
- **Scopes** are on the token; they control which API verbs the token can call.
- **Teams** are on the user (via team membership) and on devices (via ownership); they control which devices the caller can see. A user bound to a team sees the team's devices plus the shared pool (`teamId = null`). `admin`-scope tokens bypass team filtering.

### Disabling auth (development only)

Set `--plugin-xenon-auth-disabled=true` to bypass auth entirely. The plugin emits a startup warning. **Never use this in production** — every endpoint becomes anonymous, including destructive ones.

---

## Permission matrix

The matrix below is what the live router code enforces. Two guards stack: `roleGuard(min)` checks the caller's user role; `scopeGuard(required)` (or `mutationScopeGuard`, which only fires on `POST`/`PUT`/`PATCH`/`DELETE`) checks the token's scope set. **Both must pass.** The role check uses ranks: `MEMBER < ADMIN < SUPER_ADMIN`. The scope check passes if the token has any of the listed scopes; `admin` always satisfies anything.

### Read surface (any authenticated caller)

| Endpoint group | Method | Min role | Scope | Notes |
|---|---|---|---|---|
| `/grid/devices`, `/grid/device`, `/grid/device/:platform` | `GET` | `MEMBER` | _none_ | Filtered by team membership for `MEMBER` callers; admins see everything. |
| `/grid/queue/*`, `/grid/sessions/active` | `GET` | `MEMBER` | _none_ | Same team filter applies. |
| `/grid/node`, `/grid/node/:host/status` | `GET` | `MEMBER` | _none_ | |
| `/dashboard/session`, `/dashboard/session/:id`, `/dashboard/build` | `GET` | `MEMBER` | _none_ | |
| `/dashboard/healing/*` (events, summary, hotspots, selector, state) | `GET` | `MEMBER` | _none_ | |
| `/control/:udid/screenshot`, `/control/:udid/clipboard`, `/control/:udid/apps`, `/control/:udid/logs` | `GET` | `MEMBER` | _none_ | Mutations on `/control` need `devices` (see below). |
| `/apps`, `/apps/:id/download` | `GET` | `MEMBER` | _none_ | |
| `/recordings/:groupId`, `/recordings/:groupId/composite.mp4`, `/recordings/:groupId/bundle.zip` | `GET` | `MEMBER` | _none_ | |
| `/reservation` | `GET` | `MEMBER` | _none_ | Mutations need `devices`. |
| `/profile/*` (access-key, tokens) | any | _authenticated_ | _none_ | Self-only — handlers enforce `req.auth.userId`. |

### Device control (state-changing — `devices` scope)

| Endpoint | Method | Min role | Scope | Notes |
|---|---|---|---|---|
| `/control/:udid/tap`, `/swipe`, `/text`, `/keyevent`, `/touchAndHold` | `POST` | `MEMBER` | `devices` | |
| `/control/:udid/lock`, `/unlock`, `/install`, `/install-repository-app`, `/upload-install`, `/uninstall` | `POST` | `MEMBER` | `devices` | |
| `/control/:udid/clipboard` | `POST` | `MEMBER` | `devices` | |
| `/reservation`, `/reservation/:udid/:host`, `/reservation/:udid/:host/extend` | `POST` / `DELETE` | `MEMBER` | `devices` | |
| `/recordings`, `/recordings/:groupId/{add-device,stop,bookmark,annotation}` | `POST` | `MEMBER` | _none_ | Recording control is per-user; no scope guard. |

### Device administration — `ADMIN` + `devices`

| Endpoint | Method | Min role | Scope | Notes |
|---|---|---|---|---|
| `/grid/register` | `POST` | `ADMIN` | `devices` | Hub-node channel — nodes provisioned with `devices`-scope tokens. |
| `/grid/block`, `/grid/unblock` | `POST` | `ADMIN` | `devices` | Manual maintenance lock. |
| `/grid/device/tags` | `POST` | `ADMIN` | `devices` | Edit device tags. |

### App lifecycle — `ADMIN`

| Endpoint | Method | Min role | Scope | Notes |
|---|---|---|---|---|
| `/apps/upload` | `POST` | `ADMIN` | `devices` (mutation guard) | |
| `/apps/:id` | `DELETE` | `ADMIN` | `devices` (mutation guard) | |

### Identity & multi-tenancy — `ADMIN` + `admin`

| Endpoint | Method | Min role | Scope | Notes |
|---|---|---|---|---|
| `/users/*` | all | `ADMIN` | _router-level role-only_ | User CRUD, password reset. |
| `/teams`, `/teams/:id`, `/teams/:id/members`, `/teams/:id/members/:userId` | all | `ADMIN` | `admin` | Team CRUD + membership. |
| `/apikeys`, `/apikeys/:id` | all | `ADMIN` | `admin` | Programmatic API-key management (separate from per-user `/profile/tokens`). |
| `/grid/device/:udid/team` | `PUT` | `ADMIN` | `admin` | Cross-team device reassignment. |
| `/dashboard/healing/digest/send` | `POST` | `ADMIN` | `admin` | |
| `/dashboard/healing/selector/state` | `POST` | `ADMIN` | `admin` | Mark-fixed / mute / etc. |
| `/webhook`, `/webhook/:id`, `/webhook/test` | all | `ADMIN` | `admin` | |
| `/processes` | `GET` | `ADMIN` | `admin` | Live process snapshot for ops debugging. |
| `/interceptor/*` | all | `ADMIN` | _router-level role-only_ | Per-session HTTP interceptor + HAR + mocks. |

### Hub-wide config — `SUPER_ADMIN`

| Endpoint | Method | Min role | Scope | Notes |
|---|---|---|---|---|
| `/config/test-ai` | `POST` | `SUPER_ADMIN` | `admin` (mutation guard) | Smoke-tests an AI provider config. |
| `/config` | `POST` | `SUPER_ADMIN` | `admin` (mutation guard) | Writes the global config. |
| `/config` | `GET` | `ADMIN` | `admin` (mutation guard) | Read remains at `ADMIN`. |

### Reads that don't fit cleanly above

- `/build-export/:buildId/export` (`POST`) — `MEMBER` role; no scope guard. The handler self-enforces team filtering on which builds the caller can reach.
- `/bug-report/sessions/:sessionId/bug-report` (`POST`) — `MEMBER`; same reasoning.

### Auth-disabled mode

When `XENON_AUTH_DISABLED=true` the middleware short-circuits before any guard runs and synthesises a `SUPER_ADMIN` / `admin`-scope `req.auth`. Every row above is wide open. Local dev only.

---

## Per-key rate limiting

Each authenticated key has its own token buckets, split into three categories so a runaway in one class can't starve the others:

| Category | Path patterns | Capacity |
|---|---|---|
| `read` | `GET`, `HEAD`, `OPTIONS` | full per-minute rate (`rateLimit`) |
| `heavy` | `POST`/`PUT`/`PATCH`/`DELETE` to AI / healing / visual / `omni` / `test-locator` paths | `max(10, rateLimit / 4)` |
| `control` | all other mutations | full per-minute rate |

The split exists because a healing storm or AI-heavy loop on one key would otherwise drain a single shared bucket and 429 perfectly innocent dashboard polling on the same key.

Every response carries:

- `X-RateLimit-Category`
- `X-RateLimit-Remaining`
- `X-RateLimit-Capacity`

When throttled, clients receive HTTP 429 with `Retry-After` set to the seconds until one token refills.

---

## CSRF protection

Cookie-authenticated state-changing requests pass through a CSRF middleware. `POST`, `PUT`, `DELETE`, and `PATCH` require either:

- A double-submit token from the dashboard, or
- A pair-auth credential (`x-xenon-access-key` header alongside `x-xenon-token`).

Header-authed callers are exempt — the session cookie is what makes CSRF possible, so a request without a cookie cannot be forged across origins. Browsers will not attach `x-xenon-*` custom headers without an explicit CORS preflight, and the apiRouter's `cors({origin:false})` already refuses preflights.

---

## Hub-node channel authentication

When Xenon runs in [Hub-Node mode](remote-execution.md), nodes authenticate to the hub using the same `(accessKey, token)` pair shape as any other programmatic client. Each node has its own User row on the hub, with credentials revocable independently — there is no shared secret.

Provisioning a node:

1. On the hub dashboard at `https://<hub-host>/xenon/`, open `/users` → **Invite User**. Email convention `node-<hostname>@xenon.local`, role `ADMIN`.
2. Sign in as the new node user. Open `/profile` → **API Tokens**, note the **access key** (`xen_…`) at the top of the table, then mint a token scoped `devices`.
3. On the node, set both env vars before starting the process and restart it:

   ```bash
   export XENON_HUB_ACCESS_KEY="xen_..."
   export XENON_HUB_TOKEN="..."
   ```

Both REST `/register` calls and the Socket.IO handshake will use this pair. To rotate, mint a new token on the hub, drop the old one, and re-set `XENON_HUB_TOKEN` on the node — the hub revokes immediately.

If a node connects without these env vars and the hub does not have `XENON_AUTH_DISABLED=true`, the handshake is rejected. There is no shared-secret fallback.

---

## Outbound TLS verification

Xenon uses one shared HTTP client for all internal outgoing requests (node→hub, healing webhooks, AI providers when configured to use a custom URL). The `tlsRejectUnauthorized` setting controls whether the client verifies the upstream certificate; the default is `true`.

Disable it (`--plugin-xenon-tls-reject-unauthorized=false`) only against self-signed dev/test certs. Production should always leave it on.

---

## Structured log redaction

The plugin's scoped logger filters known secret-bearing fields before writing to console or the structured log sink. Redacted by default:

- `Authorization`, `x-xenon-access-key`, `x-xenon-token` headers
- API-key strings, AI-provider keys, database URLs that contain credentials
- Capability fields explicitly tagged as sensitive

If you ship logs to an external observability backend, redaction happens before egress.

---

## Roadmap

These are commonly-requested security features that are **not yet shipped**. They are tracked but not implemented in the current release.

- **OIDC/SAML SSO** — direct integration with Okta, Microsoft Entra ID, Google Workspace, GitHub Enterprise.
- **Visual PII masking** — autonomous CV-based redaction of credit-card / CVV / password fields in recorded video and screenshots.
- **mTLS for hub-node** — pin a hub TLS certificate on each node in addition to the pair-auth credentials.

If any of these are blocking your deployment, open a GitHub issue with the specific compliance requirement so it can be prioritized.
