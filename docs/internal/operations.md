# Xenon Operations Runbook

Internal reference for on-call engineers and lab administrators.

---

## Orphaned session alert

**Symptom:** A device shows `busy: true` in the dashboard but no session is actively running. `GET /xenon/api/sessions` returns a session in `running` status with a stale `last_heartbeat_at`.

**Cause:** The Appium process that owned the session crashed or was killed before it could mark the session `failed`.

**Auto-recovery:** `OrphanSweeper` runs every 30 s. Any session with `status = running` and `last_heartbeat_at` older than `3 × sessionHeartbeatIntervalMs` (default 90 s) is automatically failed and its device released. Worst-case detection time ≈ 120 s.

**Manual recovery (if OrphanSweeper is not running):**

```bash
# Find stale sessions (pair-auth headers minted at /profile)
curl -H "X-Xenon-Access-Key: $ACCESS_KEY" -H "X-Xenon-Token: $TOKEN" \
  http://localhost:4723/xenon/api/sessions?status=running

# Force-fail a session (releases device)
curl -X DELETE -H "X-Xenon-Access-Key: $ACCESS_KEY" -H "X-Xenon-Token: $TOKEN" \
  http://localhost:4723/xenon/api/sessions/<session-id>
```

---

## Port exhaustion

**Symptom:** Logs show `PortRangeExhaustedError` for `wda`, `mjpeg`, `system`, or `proxy` purpose. iOS sessions fail to start; WDA or MJPEG stream reports "address already in use".

**Cause:** All ports in the configured range are leased (or TTL-expired leases were not cleaned up after a crash).

**Immediate fix — clear stale leases:**

```bash
# Restart Xenon — startup purges expired PortLease rows automatically.
# If that is not possible, connect to the SQLite DB directly:
sqlite3 xenon.db "DELETE FROM port_leases WHERE expires_at < (strftime('%s','now') * 1000);"
```

**Expand the range** (in `appium-config.json`):

```json
{
  "plugin-xenon-port-range-wda": "8100-8299",
  "plugin-xenon-port-range-mjpeg": "9100-9299"
}
```

Default ranges:

| Purpose | Default range |
|---------|---------------|
| WDA | 8100–8199 |
| MJPEG | 9100–9199 |
| System | 10100–10199 |
| Proxy | 11100–11199 |

---

## First-run admin provisioning

**When:** First start of a fresh hub, or recovering from a lost super-admin password.

The hub creates a `SUPER_ADMIN` user on first boot from these env vars (defaults `admin@xenon.local` / `Admin@123` — change before deploying anywhere real):

```bash
export XENON_BOOTSTRAP_ADMIN_EMAIL="ops@xenon.local"
export XENON_BOOTSTRAP_ADMIN_PASSWORD="...strong..."
```

**Sign in for browser use:** open `https://<host>/xenon/`, log in with the bootstrap credentials, change the password from `/profile`, and mint scoped API tokens from `/profile` → **API Tokens**.

**Programmatic / CI use** (no browser):

```bash
# 1. Login → cookie
COOKIE=$(curl -s -c - -X POST \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$XENON_BOOTSTRAP_ADMIN_EMAIL\",\"password\":\"$XENON_BOOTSTRAP_ADMIN_PASSWORD\"}" \
  http://localhost:4723/xenon/api/auth/login | grep xenon_dashboard_session | awk '{print $7}')

# 2. Mint a scoped token under the bootstrap user
TOKEN_JSON=$(curl -s -X POST \
  -H "Cookie: xenon_dashboard_session=$COOKIE" \
  -H 'Content-Type: application/json' \
  -d '{"name":"ops-admin","scopes":["admin","sessions","devices","read"]}' \
  http://localhost:4723/xenon/api/profile/tokens)

ACCESS_KEY=$(echo "$TOKEN_JSON" | jq -r '.accessKey')
TOKEN=$(echo "$TOKEN_JSON" | jq -r '.token')
echo "ACCESS_KEY=$ACCESS_KEY"
echo "TOKEN=$TOKEN  # save securely; not retrievable again"
```

**Lost password recovery:** set `XENON_BOOTSTRAP_RESET_PASSWORD=true` and restart the hub. The first super-admin's password will be reset to `XENON_BOOTSTRAP_ADMIN_PASSWORD` on next boot, and any active dashboard sessions for that user are deleted. Unset the flag and restart again immediately afterward.

---

## Orphan process cleanup

**Symptom:** After a Xenon crash, `pgrep -f 'WebDriverAgent|ffmpeg|adb reverse'` shows leftover processes holding ports or USB tunnels.

**Auto-recovery:** On `SIGTERM`/`SIGINT`/`uncaughtException`, `ProcessRegistry.terminateAll()` is called before process exit. On a clean shutdown this handles everything.

**After a hard kill (`kill -9` / OOM):**

```bash
# Check what's running
pgrep -a -f 'WebDriverAgent|ffmpeg|adb reverse|iproxy'

# Kill by pattern
pkill -f 'WebDriverAgent'
pkill -f 'ffmpeg.*xenon'
pkill -f 'adb reverse'
pkill -f 'iproxy'
```

**Inspect currently tracked processes** (while Xenon is running):

```bash
curl -H "X-Xenon-Access-Key: $ACCESS_KEY" -H "X-Xenon-Token: $TOKEN" \
  http://localhost:4723/xenon/api/processes
```

Returns JSON array with `{ id, kind, pid, udid, sessionId, uptimeMs }` for each tracked child.

---

## Hub-node channel authentication

**Symptom:** Nodes appear in hub dashboard but device lists are empty; hub logs show `401` from node requests, or the Socket.io handshake is rejected with `invalid (accessKey, token) pair` / `inactive user`.

**Cause:** The node is missing `XENON_HUB_ACCESS_KEY` / `XENON_HUB_TOKEN`, the token has been revoked or rotated, or the corresponding User on the hub has been deactivated.

**Fix:**

1. On the hub, sign in as the node user (or a super-admin acting on its behalf) and confirm the User row is `ACTIVE` and that the token still exists at `/profile` → API Tokens.
2. On the node, confirm both env vars are set and exported in the process environment:
   ```bash
   env | grep XENON_HUB
   # XENON_HUB_ACCESS_KEY=xen_...
   # XENON_HUB_TOKEN=...
   ```
3. If the token was revoked, mint a new one in the dashboard and re-set `XENON_HUB_TOKEN` on the node. Restart the node — these vars are read at startup, not per-request.

Provisioning a fresh node (or recovering lost credentials) is documented end-to-end in [`docs/node-provisioning.md`](../node-provisioning.md).

**Symptom:** `[SocketClient] XENON_HUB_ACCESS_KEY + XENON_HUB_TOKEN not set; hub will reject the handshake unless it also has auth disabled.`

The node started without either env var and the hub does not have `XENON_AUTH_DISABLED=true`. The handshake will fail until both env vars are set and the node restarts.

---

## Rate limit tuning

Default: 300 req/min per token. Adjust per token at creation time or via update.

**Mint a higher-rate-limit CI token** (cookie obtained via login per "First-run admin provisioning" above):

```bash
curl -X POST \
  -H "Cookie: xenon_dashboard_session=$COOKIE" \
  -H 'Content-Type: application/json' \
  -d '{"name":"ci-pipeline","scopes":["sessions","read"],"rateLimit":1200}' \
  http://localhost:4723/xenon/api/profile/tokens
```

**Signs of rate limiting:** HTTP 429 responses with `Retry-After` header. Client should back off for the indicated number of seconds.
