# Phase 4B — Per-node `(accessKey, token)` for Hub-Node Channel

**Status:** design
**Date:** 2026-04-30
**Author:** rabindrabiswal1@gmail.com

## Overview

Phase 1's spec deferred two items to Phase 4: per-team device-visibility (Phase 4A — shipped #68 / #69 / #70) and per-node `(accessKey, token)` for the hub-node channel (this spec). After Phase 4B, every node-to-hub call uses the same `(accessKey, token)` header pair we already ship for SDK / CLI clients — no separate node-secret subsystem.

Today the hub-node channel uses a shared `XENON_NODE_SECRET` (with rotation overlap via `XENON_NODE_SECRET_PREVIOUS`):

- **Outbound (node → hub):** `src/device-managers/NodeDevices.ts:19` sends `{ 'x-xenon-node-secret': this.nodeSecret }` on every node-to-hub HTTP call.
- **Inbound (hub):** `src/middleware/nodeSecretMiddleware.ts` validates the header on `/register` and `/unblock` (mounted at `apiRouter.use(['/register','/unblock'], nodeSecretMiddleware(...))` in `src/app/index.ts:215`).
- **Defense in depth:** the same routes are ALSO gated by `roleGuard('ADMIN') + scopeGuard(['devices'])` (Phase 2), so today's node needs both a valid `x-xenon-node-secret` AND a valid API key — operationally awkward.
- **Validator:** `src/auth/nodeSecret.ts` does timing-safe compare with `current` / `previous` / `reject` outcome.

The simplification is real: a node IS a programmatic API client. We already have the primitives. Phase 4B drops the parallel auth subsystem and routes node traffic through the same `authMiddleware` chain as the SDK.

### What Phase 4B ships

- **Outbound side:** `NodeDevices.ts` switches to sending `x-xenon-access-key` + `x-xenon-token` (Phase 1's pair shape) when configured; falls back to the legacy `x-xenon-node-secret` when only that's set. New config: `XENON_HUB_ACCESS_KEY` + `XENON_HUB_TOKEN`.
- **Inbound side:** `nodeSecretMiddleware` is reworked. When the request already carries pair-auth headers (`x-xenon-access-key` + `x-xenon-token`), the middleware passes through and `authMiddleware` (the next layer) handles auth normally. When the request carries only the legacy `x-xenon-node-secret` AND `XENON_ACCEPT_LEGACY_NODE_SECRET=true`, the middleware validates the secret and synthesizes a `req.auth` for the synthetic "Legacy Node" user so downstream `roleGuard` + `scopeGuard` checks succeed.
- **Legacy Node user:** mirrors Phase 1's "Legacy Admin" pattern. Created lazily on first legacy-header request: email `legacy-node@xenon.local`, role=`ADMIN`, status=`INACTIVE` (can't log in via `/login` even if status is later flipped — its bcrypt hash is unusable). The synthetic `req.auth.userId` resolves to this row, so audit logs and `manual_<userId>_<udid>` formats stay consistent.
- **One new env var:** `XENON_ACCEPT_LEGACY_NODE_SECRET` (default `true` for one minor, mirrors Phase 1's `XENON_ACCEPT_LEGACY_KEY`). Flip to `false` to enforce pair auth.
- **Documentation:** `src/app/swagger.ts` marks `x-xenon-node-secret` deprecated and documents pair-auth on `/register` / `/unblock`. New ops doc at `docs/superpowers/operations/node-provisioning.md` walks through migration: invite a node-<hostname> ADMIN user via `/users`, generate a `['devices']`-scoped token via `/profile`, set `XENON_HUB_ACCESS_KEY` / `XENON_HUB_TOKEN` on the node, then drop `XENON_NODE_SECRET` from the hub.
- **Integration tests:** node sends pair → /register succeeds; node sends legacy secret with flag on → /register succeeds (synthesized auth); node sends legacy secret with flag off → 401; both shapes simultaneously → pair wins (consistent with Phase 1's precedence rule).

### What Phase 4B does NOT ship (deferred)

| Phase | Topic | Reason for deferral |
|---|---|---|
| 5+ | Removal of `XENON_NODE_SECRET` entirely | Deprecation now; removal after a minor of bake-in |
| 5 | Sidebar redesign | Cosmetic |
| — | Dedicated `NODE` role | YAGNI — `['devices']`-scoped admin token already gives a node minimum-privilege access |
| — | Auto-generated node bootstrap credentials (analogous to Phase 1's `bootstrap-key.txt`) | Manual provisioning is fine for v1; auto is convenience-only |
| — | Frontend "Nodes" management page | Nodes are just users; existing `/users` surfaces them |
| — | Per-node audit log of every register call | Existing log scope is enough; UI can come later |
| — | Lint-style audit when a SUPER_ADMIN-role user's token is used from a non-cookie origin | Defense-in-depth; not blocking |
| — | 2FA / SSO / OIDC / account lockout | Per Phase 1 spec, deferred indefinitely |

## Decisions on file (from brainstorm)

| # | Decision | Why |
|---|---|---|
| Q1 | No new `NODE` role — node is just an `ADMIN`-role user | YAGNI. The token's `['devices']` scope already constrains what the node can do |
| Q2 | One minor of overlap via `XENON_ACCEPT_LEGACY_NODE_SECRET=true` (default) | Mirrors Phase 1's `XENON_ACCEPT_LEGACY_KEY` pattern. Smooth migration |
| Q3 | Legacy header path resolves to a "Legacy Node" user (lazy-create, `INACTIVE`) | So `req.auth.userId` stays a real string for downstream audit / manual-lock / token attribution |
| Q4 | Manual provisioning (operator creates user + token by hand) | Existing `/users` and `/profile` flows already do this. Auto-bootstrap is convenience |
| Q5 | No frontend changes | Reuses Phase 1 / Phase 3 screens. Nodes appear in `/users` like any other user |
| Q6 | Drop `nodeSecretMiddleware` as a parallel auth subsystem; let `authMiddleware` handle pair-auth requests | Single auth path |
| Q7 | When BOTH the legacy header and the pair headers are present, pair wins | Mirrors Phase 1's "tokens narrow, never widen" precedence |

## Architecture

### Inbound (hub) request flow

```
Request to /register or /unblock
  │
  ▼
nodeSecretMiddleware (rewritten)
  │   ┌─ pair-auth headers present? ───→ next() (authMiddleware below picks it up)
  │   ├─ legacy header + flag on?    ───→ validate, synthesize req.auth for Legacy Node, next()
  │   ├─ legacy header + flag off?   ───→ 401
  │   └─ neither?                    ───→ next() (authMiddleware will 401 it)
  │
  ▼
authMiddleware (Phase 1)
  │   ─ if req.auth already populated (legacy path), skip
  │   ─ else resolve cookie / pair / legacy-x-xenon-api-key as today
  │
  ▼
roleGuard('ADMIN') + scopeGuard(['devices']) (Phase 2)
  │
  ▼
Handler (registerNode / unBlockDevice)
```

The middleware's role narrows from "the only auth gate" to "an optional fast path that synthesizes auth for legacy callers". When the flag is dropped (Phase 5+), this middleware can be deleted entirely — `/register` and `/unblock` become just regular pair-auth admin routes.

### Outbound (node → hub) flow

```
NodeDevices.headersForCall()
  │
  ├─ XENON_HUB_ACCESS_KEY + XENON_HUB_TOKEN set?
  │     YES → return { 'x-xenon-access-key': key, 'x-xenon-token': tok }
  │
  ├─ XENON_NODE_SECRET set (legacy)?
  │     YES → return { 'x-xenon-node-secret': secret }   # Deprecation log every 60s
  │
  └─ neither set?
       → return {}   # call will 401; existing behavior preserved
```

`NodeDevices` doesn't sign requests dynamically per-call — it picks credentials at construction time and reuses them. The two-source-of-truth is operationally awkward (secret OR pair); the precedence is "pair wins when both set, with deprecation log on the legacy path".

### Lazy "Legacy Node" user creation

When `nodeSecretMiddleware` validates a `x-xenon-node-secret` and the flag is on, it needs `req.auth.userId` to point at a real User row. Lazily ensure the row exists:

```ts
async function ensureLegacyNodeUser(): Promise<{ id: string }> {
  const existing = await prisma.user.findUnique({
    where: { email: 'legacy-node@xenon.local' },
  });
  if (existing) return { id: existing.id };
  // Create with unusable bcrypt + INACTIVE so nobody can sign in via /login.
  return prisma.user.create({
    data: {
      email: 'legacy-node@xenon.local',
      name: 'Legacy Node Channel',
      passwordHash: '$2b$04$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid',
      accessKey: `xen_legacynode${Date.now().toString(36).slice(-8)}`,
      role: 'ADMIN',
      status: 'INACTIVE',
    },
    select: { id: true },
  });
}
```

Cached in module scope after first lookup so subsequent legacy-header requests don't re-query (but if the row gets deleted, the next request re-creates it lazily).

The synthesized `req.auth` looks like:

```ts
req.auth = {
  kind: 'api-key',  // closest semantic — like a long-lived API token
  userId: legacyNodeUser.id,
  role: 'ADMIN',
  scopes: 'devices',
  rateLimit: 1000,  // generous; nodes can register many devices
  teamIds: undefined,  // unscoped (admin)
  apiKeyId: undefined,
  sessionId: undefined,
  teamId: null,
};
```

Downstream `roleGuard('ADMIN')` and `scopeGuard(['devices'])` both pass.

## Data model

No schema changes. The Legacy Node user uses the existing `User` table.

## API surface

### No new endpoints

### Modified

- `POST /register` and `POST /unblock` — auth shape changes from "x-xenon-node-secret OR fall through" to "x-xenon-access-key + x-xenon-token (preferred) OR legacy x-xenon-node-secret (gated by `XENON_ACCEPT_LEGACY_NODE_SECRET`)". Response shape unchanged.
- Swagger docs (`src/app/swagger.ts`) update the `x-xenon-node-secret` security scheme to "deprecated, use x-xenon-access-key + x-xenon-token".

### New

- Operator doc: `docs/superpowers/operations/node-provisioning.md` (or similar location — pick whatever the project's other ops docs use).

### Audit logging

- Existing `[nodeSecret]` warning when a request authenticates via `x-xenon-node-secret-previous`.
- New: every legacy-header validation logs `[nodeSecret] DEPRECATED: <ip> authenticated via x-xenon-node-secret. Migrate this node to pair auth.` at `warn` level, throttled to once per minute per source IP.

## Operational concerns

### Migration plan (operator-facing)

This is the heart of Phase 4B's value. Document clearly:

1. **On the hub:** sign in to the dashboard. `/users` → "+ Invite User" → email `node-<hostname>@xenon.local` (pick whatever convention is durable across redeploys), name `Node <hostname>`, role `ADMIN`. Server returns a temporary password — don't bother saving; the node won't use the password.
2. **Sign in to the dashboard as that node user** (with the temp password). Open `/profile`. Generate a new API token with scopes narrowed to `['devices']`. Copy the token immediately (shown once).
3. **Note the access key** displayed at the top of `/profile`'s API Tokens tab.
4. **On the node:** set `XENON_HUB_ACCESS_KEY=xen_<accessKey>` and `XENON_HUB_TOKEN=<token>` env vars. Restart the node process.
5. **Verify:** the node's hub-side audit log no longer shows `[nodeSecret] DEPRECATED` warnings for that node's IP.
6. **Once every node has migrated:** drop `XENON_NODE_SECRET` and `XENON_NODE_SECRET_PREVIOUS` from the hub's env.
7. **In a future minor:** flip `XENON_ACCEPT_LEGACY_NODE_SECRET=false` to enforce pair auth.

### Bootstrap on existing installs

A hub upgrading from Phase 4A to Phase 4B sees no immediate behavior change — `XENON_ACCEPT_LEGACY_NODE_SECRET` defaults to `true`, so existing nodes keep working with the legacy header. The deprecation warning starts firing in operator logs, prompting migration.

A fresh hub install (post-Phase-4B) doesn't need to set `XENON_NODE_SECRET` at all — the operator follows the migration plan above to provision the first node user.

### Security checklist (verify during implementation)

- [ ] Pair-auth header takes precedence when both shapes are present.
- [ ] Legacy header is rejected with 401 when `XENON_ACCEPT_LEGACY_NODE_SECRET=false`.
- [ ] Synthesized `req.auth` for legacy callers has `kind='api-key'`, `role='ADMIN'`, `scopes='devices'`.
- [ ] Legacy Node user is created lazily (first request triggers the row); subsequent requests reuse the cached id.
- [ ] Legacy Node user is `INACTIVE` and has an unusable bcrypt hash (matches Phase 1's Legacy Admin pattern).
- [ ] If an admin manually flips Legacy Node to `ACTIVE` and `authMiddleware` later sees a cookie session for it: the existing `user.status !== 'ACTIVE'` check in `authMiddleware` would now PASS — but the user has no usable password, so login fails at the bcrypt-compare step. Defense in depth holds.
- [ ] Node-side env vars precedence: `XENON_HUB_*` (pair) wins over `XENON_NODE_SECRET` (legacy).
- [ ] Deprecation log throttle: once per minute per source IP, not on every request.

## Testing strategy

### Unit (`test/unit/`)

| Suite | Coverage |
|---|---|
| `nodeSecretMiddleware.test.ts` (rewrite of existing) | (a) pair headers present → next() without touching req.auth; (b) legacy header + flag on → req.auth synthesized; (c) legacy header + flag off → 401; (d) neither → next() (downstream authMiddleware will 401); (e) pair + legacy both present → pair wins, legacy ignored |
| `legacyNodeUser.test.ts` (NEW) | Lazy creation idempotency — two parallel requests don't create duplicate rows; INACTIVE + unusable hash; cached lookup |

### Integration (`test/integration/`)

| Suite | Scenario |
|---|---|
| `node-pair-auth.spec.ts` (NEW) | Mounting `/register` end-to-end: request with pair → 200; request with legacy + flag on → 200; request with legacy + flag off → 401; request with neither → 401. Asserts the synthesized `req.auth.userId` resolves to the Legacy Node user when the legacy path runs |

### Manual verification

```
1. Install with default flags (XENON_ACCEPT_LEGACY_NODE_SECRET=true).
2. Existing node with XENON_NODE_SECRET still works for /register.
3. Operator log shows the [nodeSecret] DEPRECATED warning on first call.
4. Walk the migration plan: create node-A user, generate token, set XENON_HUB_*
   on the node, restart the node.
5. Confirm /register now works without x-xenon-node-secret on the wire (curl
   the node's request to a logging proxy or inspect the network tab).
6. On the hub, set XENON_ACCEPT_LEGACY_NODE_SECRET=false and restart the hub.
7. The migrated node still works; an unmigrated node 401s on /register.
```

### Out of scope

No load tests · no SSO / OAuth integration · no per-node device-visibility filtering (that's a separate problem from how nodes auth).

## Risks and open questions

- **Legacy Node user accidentally getting elevated.** It's `INACTIVE` and `ADMIN` — same constraints as Phase 1's Legacy Admin. If an operator manually flips status to `ACTIVE` and someone uses the synthesized accessKey for a header-pair call: the Legacy Node has no real tokens (its `accessKey` is set but no `ApiKey` rows reference it), so `verifyPair` would 401 anyway. No realistic abuse path.
- **Concurrent first-request races on Legacy Node creation.** Two simultaneous requests on a fresh DB both check `findUnique`, both miss, both `create`. The unique constraint on `User.email` makes the second `create` throw P2002. Mitigation: catch P2002 and re-fetch the now-existing row. Documented in code.
- **Node behind NAT — multiple nodes share a source IP.** The deprecation log throttles per source IP. Multiple legacy-using nodes behind one NAT would produce one warning every minute, not per-node. Acceptable; the migration tool isn't the log line — it's the migration plan in the doc.
- **`XENON_NODE_SECRET_PREVIOUS` (rotation overlap support).** Phase 1's nodeSecret validator supports current+previous so a hub can rotate the shared secret without simultaneous downtime on every node. Phase 4B's legacy path keeps this behavior — both `current` and `previous` continue to be accepted under the flag. Removed in the same Phase-5+ cleanup that drops the flag entirely.
- **Outbound-side dual-config awkwardness.** A node's env file might end up with BOTH `XENON_NODE_SECRET=xxx` and `XENON_HUB_ACCESS_KEY=xen_yyy` during migration. The code picks pair when both are set; `XENON_NODE_SECRET` becomes inert but harmless. Operators clean it up at their leisure.
- **Self-hosting first-run confusion.** A fresh hub install with no `XENON_NODE_SECRET` configured AND no node user provisioned yet means the first node can't connect. The migration doc must call this out: "If you're starting fresh, provision the first node user BEFORE bringing up the first node."

## Next step

Once this spec is approved, the brainstorming workflow hands off to `superpowers:writing-plans`. Two PRs anticipated:

- **PR-A:** Backend rewrite. New `XENON_ACCEPT_LEGACY_NODE_SECRET` config; rewritten `nodeSecretMiddleware` (pair-aware + legacy synthesizer + flag-gated); Legacy Node lazy-creation helper. `NodeDevices.headersForCall()` outbound switch with pair > legacy > none precedence. Unit + integration tests covering all four shapes (pair / legacy-on / legacy-off / both). Swagger updates.
- **PR-B:** Operator documentation. New `docs/superpowers/operations/node-provisioning.md` with the migration plan, copy-paste commands, and a "rolling out a multi-node deployment" section. Manual verification walked. PR body documents the deprecation timeline.

Each PR mergeable on its own; PR-A's backend ships the dual-shape acceptance even without the doc, and PR-B's doc lands once the backend is proven.
