---
title: Security
---

# Security & Compliance

This page describes what ships in Xenon today. For features that are commonly requested but not yet implemented, see [Roadmap](#roadmap) at the bottom.

---

## API-key authentication

Every endpoint under `/xenon/api/*` is gated behind API-key authentication when `authDisabled` is `false` — the default.

### Where keys come from

API keys are issued from **Settings → API Keys** in the dashboard. Each key is stored as a salted hash; the raw token is shown once at creation time and never persisted in plaintext.

### How keys are presented

Two equivalent paths:

- `x-xenon-api-key: <token>` header — for CI runners, scripts, third-party integrations.
- `xenon_dashboard_session` cookie — set by the dashboard login flow. `httpOnly`, `sameSite=strict`, sliding 24-hour TTL that re-ups on every authenticated request, marked `secure` when the request arrives over HTTPS (or via an `X-Forwarded-Proto: https` proxy hop).

### Scopes

Each key has one or more scopes:

| Scope | Grants |
|---|---|
| `read` | All `GET` endpoints — dashboard polling, log pulls, metric scrapes. |
| `sessions` | Session lifecycle mutations (cancel, set status, attach evidence). |
| `devices` | Device control mutations (block, unblock, reset, reservation). |
| `admin` | Super-scope. Includes everything above plus key management, config writes, healing-state writes, digest webhooks. |

`admin` always satisfies a scope check. Mutation-only guards let `GET` traffic through with any authenticated key but require the listed scope for `POST`/`PUT`/`PATCH`/`DELETE` on the same resource.

### Disabling auth (development only)

Set `--plugin-xenon-auth-disabled=true` to bypass the middleware entirely. The plugin emits a startup warning. **Never use this in production** — every endpoint becomes anonymous, including destructive ones.

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
- A header-based credential (`x-xenon-api-key` or `x-xenon-node-secret`).

Header-authed callers are exempt — the cookie is what makes CSRF possible, so a request without a cookie cannot be forged across origins.

---

## Hub-node channel authentication

When Xenon runs in [Hub-Node mode](remote-execution.md), every node→hub request carries an `X-Xenon-Node-Secret` header. Configure it identically on both ends:

```bash
# Hub
appium server ... --plugin-xenon-node-secret="$XENON_NODE_SECRET"

# Node
appium server ... --plugin-xenon-hub=http://hub.internal:4723 \
                  --plugin-xenon-node-secret="$XENON_NODE_SECRET"
```

The hub middleware compares the inbound header against both `nodeSecret` and `nodeSecretPrevious`, accepting either match. This lets you rotate the secret without coordinated downtime:

1. Set the new secret on the hub as `nodeSecret`. Move the existing one to `nodeSecretPrevious` (`XENON_NODE_SECRET_PREVIOUS`).
2. Roll nodes one at a time, replacing their `nodeSecret`.
3. Once all nodes are on the new value, drop `nodeSecretPrevious` from the hub.

If `nodeSecret` is not configured **and** API-key auth is disabled, the plugin refuses to start — that combination would leave the hub-node channel completely open.

---

## Outbound TLS verification

Xenon uses one shared HTTP client for all internal outgoing requests (node→hub, healing webhooks, AI providers when configured to use a custom URL). The `tlsRejectUnauthorized` setting controls whether the client verifies the upstream certificate; the default is `true`.

Disable it (`--plugin-xenon-tls-reject-unauthorized=false`) only against self-signed dev/test certs. Production should always leave it on.

---

## Structured log redaction

The plugin's scoped logger filters known secret-bearing fields before writing to console or the structured log sink. Redacted by default:

- `Authorization`, `x-xenon-api-key`, `x-xenon-node-secret` headers
- API-key strings, AI-provider keys, database URLs that contain credentials
- Capability fields explicitly tagged as sensitive

If you ship logs to an external observability backend, redaction happens before egress.

---

## Roadmap

These are commonly-requested security features that are **not yet shipped**. They are tracked but not implemented in the current release.

- **Coarse-grained Role-Based Access Control on top of scopes** — Admin / Maintainer / Developer / Viewer presets, manageable from the dashboard.
- **OIDC/SAML SSO** — direct integration with Okta, Microsoft Entra ID, Google Workspace, GitHub Enterprise.
- **Visual PII masking** — autonomous CV-based redaction of credit-card / CVV / password fields in recorded video and screenshots.
- **mTLS for hub-node** — replace the shared-secret model with mutual TLS using per-node client certificates.

If any of these are blocking your deployment, open a GitHub issue with the specific compliance requirement so it can be prioritized.
