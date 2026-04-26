---
title: Configuration
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';


# Configuration & Server Arguments

Xenon is highly configurable to suit single-node, hub-node, or cloud deployments. You can configure Xenon using:

1.  **Configuration File** (Recommended for production)
2.  **Runtime API** (For dynamic updates)
3.  **CLI Arguments** (Good for quick testing)

---

## 1. Using Configuration File

We recommend using an Appium configuration file to manage complex settings.


<Tabs>
<TabItem value="yaml" label="YAML (Recommended)" default>

```yaml
server:
  keepAliveTimeout: 800
  basePath: /wd/hub
  usePlugins:
    - xenon
  plugin:
    xenon:
      platform: both
      maxSessions: 8
      enableDashboard: true
      bootedSimulators: true
      aiProvider: gemini
      aiModel: llava:7b
      aiBaseUrl: "http://localhost:11434"
      buildCleanupDays: 30
```

</TabItem>
<TabItem value="json" label="JSON">

```json
{
  "server": {
    "keepAliveTimeout": 800,
    "basePath": "/wd/hub",
    "usePlugins": ["xenon"],
    "plugin": {
      "xenon": {
        "platform": "both",
        "iosDeviceType": "both",
        "androidDeviceType": "both",
        "enableDashboard": true,
        "maxSessions": 8
      }
    }
  }
}
```

</TabItem>
</Tabs>



To run:
```bash
appium server --config xenon-config.yaml
```

---

## 2. Runtime Configuration (API)

Xenon exposes a REST API to update configuration at runtime. This is useful for adjusting timeouts or concurrency limits without downtime.

**Endpoint**: `PUT /xenon/api/config`

**Example Request**:
```bash
curl -X PUT http://localhost:4723/xenon/api/config \
  -H "Content-Type: application/json" \
  -d '{ "maxSessions": 12, "newCommandTimeoutSec": 120 }'
```

**Response**:
```json
{
  "success": true,
  "config": { ... },
  "restartRequired": false,
  "message": "Configuration updated..."
}
```

> **Restart Required**: Changing these properties via API will **NOT** take effect until a server restart:
> - `hub`
> - `platform`
> - `bindHostOrIp`
> - `proxy`
> - `cloud`
> - `iosDeviceType` / `androidDeviceType`

---

## 3. Master Parameters Reference

Below is the definitive list of all Xenon configuration parameters.

| YAML Key | CLI Flag | Mandatory | Type / Values | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Core Options** | | | | | |
| `platform` | `--plugin-xenon-platform` | No | `android`, `ios`, `both` | `both` | Target platform for automation |
| `maxSessions` | `--plugin-xenon-max-sessions` | No | Number | `8` | Maximum concurrent sessions |
| `enableDashboard` | `--plugin-xenon-enable-dashboard` | No | Boolean | `false` | Enable the web dashboard interface |
| `bindHostOrIp` | `--plugin-xenon-bind-host-or-ip` | No | String | Local IP | Internal binding address |
| **Device Filters** | | | | | |
| `androidDeviceType`| `--plugin-xenon-android-device-type`| No | `both`, `real`, `simulated` | `both` | Android device categories to include |
| `iosDeviceType` | `--plugin-xenon-ios-device-type` | No | `both`, `real`, `simulated` | `both` | iOS device categories to include |
| `bootedSimulators` | `--plugin-xenon-booted-simulators` | No | Boolean | `false` | Use only simulators already in `Booted` state |
| `skipChromeDownload`| `--plugin-xenon-skip-chrome-download`| No | Boolean | `true` | Prevent automatic Chromedriver fetching |
| `hub` | `--plugin-xenon-hub` | No | URL | None | Hub URL when running in Node mode |
| **AI & Self-Healing** | | | | | |
| `enableSelfHealing` | `--plugin-xenon-enable-self-healing` | No | Boolean | `true` | Enable global locator auto-recovery |
| `aiProvider` | `--plugin-xenon-ai-provider` | No | `gemini`, `openai`, `anthropic`, `ollama` | `gemini` | Primary AI diagnostics provider |
| `aiModel` | `--plugin-xenon-ai-model` | No | String | Provider def | Model name override (e.g. `gpt-4o`) |
| `aiBaseUrl` | `--plugin-xenon-ai-base-url` | No | URL | None | Custom API endpoint (e.g. for Ollama) |
| **Database** | | | | | |
| `databaseProvider` | `--plugin-xenon-database-provider` | No | `sqlite`, `postgresql` | `sqlite` | State storage engine |
| `databaseUrl` | `--plugin-xenon-database-url` | No | String | Local DB Path | Connection string or path |
| **Cleanup & Retention** | | | | | |
| `buildCleanupDays` | `--plugin-xenon-build-cleanup-days` | No | Number | `30` | Build retention period in days |
| `buildCleanupMaxCount`| `--plugin-xenon-build-cleanup-max-count`| No | Number | `100` | Max builds to retain in database |
| `buildCleanupSchedule`| `--plugin-xenon-build-cleanup-schedule`| No | Cron String | `0 0 * * *` | Cleanup job execution schedule |
| `deleteBuildAssets` | `--plugin-xenon-delete-build-assets` | No | Boolean | `true` | Delete video/screenshots during cleanup |
| **Timeouts & Monitoring** | | | | | |
| `deviceAvailabilityTimeoutMs` | `--plugin-device-availability-timeout-ms` | No | Number | `300000` | Max wait for a free device (ms) |
| `newCommandTimeoutSec` | `--plugin-new-command-timeout-sec` | No | Number | `60` | Auto-release idle sessions (sec) |
| `healthCheckIntervalMs`| `--plugin-xenon-health-check-interval-ms`| No | Number | `86400000` | Frequency of device health audits |
| `sessionHeartbeatIntervalMs`| `--plugin-xenon-session-heartbeat-interval-ms`| No | Number | `30000` | Session health check frequency |
| `enableJsonLogging` | `--plugin-xenon-enable-json-logging` | No | Boolean | `false` | Format logs as structured JSON |
| `healthCheckSchedule` | `--plugin-xenon-health-check-schedule` | No | Cron String | — | Cron form for health-check job; takes precedence over `healthCheckIntervalMs` when set |
| `deviceAvailabilityQueryIntervalMs` | `--plugin-device-availability-query-interval-ms` | No | Number | `10000` | Poll interval (ms) while a session waits for a free device |
| `bootedEmulators` | `--plugin-xenon-booted-emulators` | No | Boolean | `false` | Discover only Android emulators that are already booted |
| `simulators` | `--plugin-xenon-simulators` | No | Array | `[]` (all) | Allow-list of iOS simulators (name + sdk). Empty = expose all. |
| `emulators` | `--plugin-xenon-emulators` | No | Array | `[]` (all) | Allow-list of Android emulator AVDs. Empty = expose all. |
| `adbRemote` | `--plugin-xenon-adb-remote` | No | Array | `[]` | Remote ADB hosts in `host:port` form for cross-machine device discovery |
| `removeDevicesFromDatabaseBeforeRunningThePlugin` | `--plugin-xenon-remove-devices-...` | No | Boolean | `false` | Wipe persisted Device table at startup (clean-slate discovery) |
| **Network Interceptor** | | | | | |
| `interceptor` | — (config-file only, object) | No | Object | None | Server-level interceptor defaults. See [Network Interceptor](network-interceptor.md) for the per-session capability. Object members: `enabled`, `bufferSize`, `captureBodies`, `includeHosts`, `excludeHosts`, `mocks`. |
| **Security** | | | | | |
| `authDisabled` | `--plugin-xenon-auth-disabled` | No | Boolean | `false` | Disable API-key auth on `/xenon/api/*`. **Local dev only.** |
| `nodeSecret` | `--plugin-xenon-node-secret` | No | String | — | Shared secret for hub-node channel auth; nodes send it in `X-Xenon-Node-Secret`. |
| `tlsRejectUnauthorized` | `--plugin-xenon-tls-reject-unauthorized` | No | Boolean | `true` | Verify TLS certs for internal outgoing requests. Set `false` only for dev/test. |
| **Hub-Node Tuning** | | | | | |
| `sendNodeDevicesToHubIntervalMs` | `--plugin-xenon-send-node-devices-...` | No | Number | `30000` | How often (ms) a node pushes its device list to the hub |
| `checkStaleDevicesIntervalMs` | `--plugin-xenon-check-stale-devices-...` | No | Number | `30000` | How often (ms) the hub prunes silent nodes |
| `checkBlockedDevicesIntervalMs` | `--plugin-xenon-check-blocked-devices-...` | No | Number | `30000` | Cadence for re-evaluating manually-blocked devices |
| `remoteMachineProxyIP` | `--plugin-xenon-remote-machine-proxy-ip` | No | String | — | Public host/URL clients should use to reach this node when behind a proxy |

---

## 4. Environment Variables

Some advanced features are configured via environment variables.

### AI & Diagnostics

| Variable | Description | Default |
|----------|-------------|---------|
| `GEMINI_API_KEY` or `XENON_GEMINI_API_KEY` | Google Gemini API key | — |
| `OPENAI_API_KEY` or `XENON_OPENAI_API_KEY` | OpenAI API key | — |
| `ANTHROPIC_API_KEY` or `XENON_ANTHROPIC_API_KEY` | Anthropic API key | — |
| `XENON_AI_PROVIDER` | AI provider: `gemini`, `openai`, `anthropic`, `ollama` | `gemini` |
| `XENON_AI_MODEL` | Universal AI model override (all providers) | Provider default |
| `XENON_GEMINI_MODEL` | Gemini-specific model (e.g., `gemini-3-flash-preview`) | — |
| `XENON_OPENAI_MODEL` | OpenAI-specific model (e.g., `gpt-4o`) | — |
| `XENON_ANTHROPIC_MODEL` | Anthropic-specific model | — |
| `XENON_OLLAMA_MODEL` | Ollama-specific model (e.g., `llava`) | — |
| `XENON_AI_BASE_URL` | Custom base URL (for self-hosted Ollama) | — |

→ See [AI Features](ai-features.md) for full provider documentation.

### Database

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL or SQLite connection string | `file:~/.cache/xenon/xenon.db` |
| `XENON_DB_PROVIDER` | Database provider (`sqlite` or `postgresql`) | `sqlite` |

→ See [Deployment Guide](deployment.md) for database setup instructions.

### Observability

| Variable | Description | Default |
|----------|-------------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry collector endpoint (e.g., `http://jaeger:4318/v1/traces`) | — |
| `XENON_OTEL_DEBUG` | Log traces to console for debugging | `false` |

### Cloud & Proxy

Xenon also supports `cloud` and `proxy` configurations. See the [Cloud Execution](cloud.md) and [Deployment Guide](deployment.md) for structure.

