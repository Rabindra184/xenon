# Node Provisioning (Phase 4B onward)

After Phase 4B, every node-to-hub call uses the same `(accessKey, token)`
header pair Xenon already ships for SDK / CLI clients. The legacy
`XENON_NODE_SECRET` shared-secret keeps working for one minor under
`XENON_ACCEPT_LEGACY_NODE_SECRET=true` (default), with a deprecation log
line nudging you to migrate.

## Why migrate

- **One auth path.** Nodes look like any other programmatic API client; the
  hub's auth code has fewer special cases to reason about.
- **Per-node credentials.** Revoking one node's token doesn't break the
  others. With a shared secret, rotation meant restarting every node at once.
- **Audit trail.** Every `/register` call now attributes to the node's User
  row instead of an anonymous shared secret.
- **No shared secrets in env.** Nothing to leak via accidental log capture
  or env-dump.

## Migrating a single node

### 1. Provision a node user on the hub

Sign in to the dashboard at `https://<hub-host>/xenon/`. Then:

1. Open `/users` → **Invite User**.
2. **Email:** `node-<hostname>@xenon.local` (pick a convention durable across
   redeploys — host or rack-id is fine).
3. **Name:** `Node <hostname>`.
4. **Role:** `ADMIN`. (`/register` and `/unblock` require the admin role
   today; this matches what the legacy shared secret already conferred.)
5. Submit. The dialog shows a temporary password — copy it.

### 2. Generate the node's API token

1. Sign out. Sign in as the new node user with the temp password.
2. Open `/profile` → **API Tokens** tab.
3. Note the **access key** displayed at the top of the table (`xen_…`).
4. Click **Generate New Token**. Name it `node-<hostname>`, scopes
   `devices`. Submit.
5. Copy the token shown once — it is not retrievable later.

### 3. Configure the node

Set the env vars before bringing the node up:

```bash
export XENON_HUB_ACCESS_KEY="xen_..."          # access key from step 2.3
export XENON_HUB_TOKEN="..."                    # token from step 2.4
```

Restart the node process. Both the REST `/register` calls and the Socket.io
handshake will switch to pair auth automatically — `XENON_NODE_SECRET` is
no longer consulted on outbound when the pair is set.

### 4. Verify

On the hub, tail the operator logs. Before migration, you should see this
roughly every minute per legacy-using node:

```
WARN [nodeSecret] DEPRECATED: 1.2.3.4 authenticated via x-xenon-node-secret. Migrate this node to pair auth (XENON_HUB_ACCESS_KEY + XENON_HUB_TOKEN).
```

After step 3, that log line should stop firing for that source IP.

You can also confirm in the dashboard: `/sessions` and `/devices` actions
will now attribute to the node's User row, not to the anonymous Legacy Node
synthetic user.

## Migrating a multi-node deployment

Do nodes one at a time. Each migration is independent — the hub accepts
both shapes simultaneously while `XENON_ACCEPT_LEGACY_NODE_SECRET=true`.

1. Migrate node A. Confirm the deprecation log stops for A's IP.
2. Migrate node B. Confirm.
3. Repeat for every remaining node.

There is no need for a coordinated cutover — the migration window is open
for the entire minor.

## Tightening the screw

Once every node has migrated:

1. On the hub, set `XENON_ACCEPT_LEGACY_NODE_SECRET=false`. Restart.
2. Drop `XENON_NODE_SECRET` and `XENON_NODE_SECRET_PREVIOUS` from the
   hub's env (no longer consulted).
3. On each node, drop `XENON_NODE_SECRET` from its env (it's already
   ignored because pair auth wins; this is just cleanup).

After step 1, any unmigrated node will start failing `/register` and
socket handshakes with `x-xenon-node-secret is rejected; XENON_ACCEPT_LEGACY_NODE_SECRET is false`.
That's your deadline-enforcer.

## First-run scenario

A fresh hub install (post-Phase-4B) has no `XENON_NODE_SECRET` set. You
must provision the first node user via the dashboard **before** bringing
up the first node — otherwise the node has nothing to authenticate with.

The bootstrap super-admin is created on first hub boot per Phase 1's flow
(see `docs/superpowers/specs/2026-04-28-phase-1-identity-backbone-design.md`).
Sign in as that super-admin to provision the first node user.

## Recovery scenarios

### Lost token

Sign in to the hub as the node user. Open `/profile` → **API Tokens**.
Delete the lost token, generate a new one, and re-set `XENON_HUB_TOKEN`
on the node. Restart the node.

### Lost access key

The access key is printed at the top of the **API Tokens** tab on the node
user's `/profile`. If even that is unrecoverable (e.g. the node user's
password is also lost), sign in as a super-admin, reset the node user's
password, sign in as that user, and rotate the access key via the
**Rotate** button. Existing tokens are rebound to the new accessKey at
verify time, so you only need to re-issue tokens if you also rotated the
token itself.

### Node user accidentally deactivated

A deactivated User cannot authenticate. Re-activate via `/users` (admin
flow) before the node retries.

## Common gotchas

- **HTTPS proxy in front of the hub.** The deprecation log logs the source
  IP. If your nodes are behind a proxy, confirm `X-Forwarded-For` is being
  honoured — `nodeSecretMiddleware` already reads it, but only if your
  proxy sets it.
- **Multiple nodes behind one NAT.** The deprecation log throttles per
  source IP, so multiple legacy-using nodes behind one NAT show one log
  line per minute total, not per-node. Migrate them one at a time so each
  individual node's IP becomes resolvable in the log stream.
- **Node user accidentally promoted to SUPER_ADMIN.** The token's
  `['devices']` scope still constrains what the node can do at the API
  layer, but admin hygiene says: keep node users at `ADMIN`. Audit
  periodically.
- **Forgetting to restart the node after env changes.** `XENON_HUB_ACCESS_KEY`
  / `XENON_HUB_TOKEN` are read at startup, not per-request.

## Reference: env vars introduced in Phase 4B

| Var | Side | Purpose |
|---|---|---|
| `XENON_HUB_ACCESS_KEY` | node (outbound) | Access key the node sends in `x-xenon-access-key`. Pair-auth: required if `XENON_HUB_TOKEN` is set. |
| `XENON_HUB_TOKEN` | node (outbound) | Token the node sends in `x-xenon-token`. Pair-auth: required if `XENON_HUB_ACCESS_KEY` is set. |
| `XENON_ACCEPT_LEGACY_NODE_SECRET` | hub (inbound) | When `true` (default), `x-xenon-node-secret` is accepted alongside pair auth. When `false`, the legacy header is rejected with 401. |
