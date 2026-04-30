# Node Provisioning

Hub-to-node traffic uses the same `(accessKey, token)` header pair Xenon
ships for SDK / CLI clients. Each node authenticates as its own User row
on the hub, with credentials minted via the dashboard.

## Provisioning a node

### 1. On the hub: create the node user

Sign in to the dashboard at `https://<hub-host>/xenon/`. Then:

1. Open `/users` → **Invite User**.
2. **Email:** `node-<hostname>@xenon.local` (pick a convention durable
   across redeploys — host or rack-id is fine).
3. **Name:** `Node <hostname>`.
4. **Role:** `ADMIN`. (`/register` and `/unblock` require the admin role.)
5. Submit. The dialog shows a temporary password — copy it.

### 2. Generate the node's API token

1. Sign out. Sign in as the new node user with the temp password.
2. Open `/profile` → **API Tokens** tab.
3. Note the **access key** at the top of the table (`xen_…`).
4. Click **Generate New Token**, name it `node-<hostname>`, scopes
   `devices`. Submit.
5. Copy the token shown once — it is not retrievable later.

### 3. Configure the node

Set the env vars before starting the node process:

```bash
export XENON_HUB_ACCESS_KEY="xen_..."          # access key from step 2.3
export XENON_HUB_TOKEN="..."                    # token from step 2.4
```

Both REST `/register` calls and the Socket.io handshake will use this
pair.

## Recovery scenarios

### Lost token

Sign in to the hub as the node user. Open `/profile` → **API Tokens**.
Delete the lost token, generate a new one, and re-set `XENON_HUB_TOKEN`
on the node. Restart.

### Lost access key

The access key is printed at the top of the **API Tokens** tab on the
node user's `/profile`. If even that is unrecoverable (e.g. the node
user's password is also lost), sign in as a super-admin, reset the node
user's password, sign in as that user, and rotate the access key via the
**Rotate** button. Existing tokens are rebound to the new accessKey at
verify time, so you only need to re-issue tokens if you also rotated the
token itself.

### Node user accidentally deactivated

A deactivated User cannot authenticate. Re-activate via `/users` (admin
flow) before the node retries.

## First-run scenario

A fresh hub install has no node user provisioned. You must create the
first node user via the dashboard before bringing up any node.

The bootstrap super-admin is created on first hub boot per Phase 1's flow
(see `docs/superpowers/specs/2026-04-28-phase-1-identity-backbone-design.md`).
Sign in as that super-admin to provision the first node user.

## Common gotchas

- **Forgetting to restart the node after env changes.**
  `XENON_HUB_ACCESS_KEY` / `XENON_HUB_TOKEN` are read at startup, not
  per-request.
- **Node user accidentally promoted to SUPER_ADMIN.** The token's
  `['devices']` scope still constrains what the node can do at the API
  layer, but admin hygiene says: keep node users at `ADMIN`. Audit
  periodically.
- **HTTPS proxy in front of the hub.** Pair-auth headers
  (`x-xenon-access-key`, `x-xenon-token`) must reach the hub unmodified.
  Confirm your reverse proxy is not stripping or rewriting them.

## Reference: env vars

| Var | Side | Purpose |
|---|---|---|
| `XENON_HUB_ACCESS_KEY` | node (outbound) | Access key the node sends in `x-xenon-access-key`. Required alongside `XENON_HUB_TOKEN`. |
| `XENON_HUB_TOKEN` | node (outbound) | API token the node sends in `x-xenon-token`. Required alongside `XENON_HUB_ACCESS_KEY`. |
