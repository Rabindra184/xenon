# Xenon Operations Runbook

Internal reference for on-call engineers and lab administrators.

---

## Orphaned session alert

**Symptom:** A device shows `busy: true` in the dashboard but no session is actively running. `GET /xenon/api/sessions` returns a session in `running` status with a stale `last_heartbeat_at`.

**Cause:** The Appium process that owned the session crashed or was killed before it could mark the session `failed`.

**Auto-recovery:** `OrphanSweeper` runs every 30 s. Any session with `status = running` and `last_heartbeat_at` older than `3 × sessionHeartbeatIntervalMs` (default 90 s) is automatically failed and its device released. Worst-case detection time ≈ 120 s.

**Manual recovery (if OrphanSweeper is not running):**

```bash
# Find stale sessions
curl -H "X-Xenon-API-Key: $ADMIN_KEY" \
  http://localhost:4723/xenon/api/sessions?status=running

# Force-fail a session (releases device)
curl -X DELETE -H "X-Xenon-API-Key: $ADMIN_KEY" \
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

## Bootstrap key rotation

**When:** First start, or after a key compromise.

**Locate the bootstrap key:**

```bash
cat ~/.cache/xenon/bootstrap-key.txt   # or the path logged on startup
```

**Create a permanent admin key:**

```bash
NEW_KEY=$(curl -s -X POST \
  -H "X-Xenon-API-Key: $(cat ~/.cache/xenon/bootstrap-key.txt)" \
  -H 'Content-Type: application/json' \
  -d '{"name":"ops-admin","scopes":["admin","sessions","devices","read"]}' \
  http://localhost:4723/xenon/api/apikeys | jq -r .key)

echo "Save this key securely: $NEW_KEY"
```

**Revoke the bootstrap key:**

```bash
BOOTSTRAP_ID=$(curl -s \
  -H "X-Xenon-API-Key: $NEW_KEY" \
  http://localhost:4723/xenon/api/apikeys | jq -r '.[] | select(.name=="bootstrap") | .id')

curl -X DELETE \
  -H "X-Xenon-API-Key: $NEW_KEY" \
  http://localhost:4723/xenon/api/apikeys/$BOOTSTRAP_ID
```

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
curl -H "X-Xenon-API-Key: $ADMIN_KEY" \
  http://localhost:4723/xenon/api/processes
```

Returns JSON array with `{ id, kind, pid, udid, sessionId, uptimeMs }` for each tracked child.

---

## Hub-node channel authentication

**Symptom:** Nodes appear in hub dashboard but device lists are empty; hub logs show `401` from node requests.

**Cause:** `--plugin-xenon-node-secret` mismatch between hub and node, or one side is unset.

**Fix:** Set identical value on both sides, then restart both.

Hub (`hub-config.json`):
```json
{ "plugin-xenon-node-secret": "your-shared-secret" }
```

Node (`node-config.json`):
```json
{ "plugin-xenon-node-secret": "your-shared-secret" }
```

When unset on either side, the middleware logs a WARN every 60 s and permits traffic (back-compat for single-node installs).

---

## Rate limit tuning

Default: 300 req/min per API key. Adjust per key at creation time or via key update.

**Increase limit for a CI key:**

```bash
curl -X POST \
  -H "X-Xenon-API-Key: $ADMIN_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"ci-pipeline","scopes":["sessions","read"],"rateLimit":1200}' \
  http://localhost:4723/xenon/api/apikeys
```

**Signs of rate limiting:** HTTP 429 responses with `Retry-After` header. Client should back off for the indicated number of seconds.
