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
      iosDeviceType: both
      androidDeviceType: both
      enableDashboard: true
      maxSessions: 8
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

## 3. CLI Arguments Reference

These arguments can be passed via command line flags (e.g., `--plugin-xenon-platform=ios`).

| Configuration Key | CLI Flag | Description | Default | Options |
| ----------------- | -------- | ----------- | ------- | ------- |
| `platform` | `--plugin-xenon-platform` | Platform to run tests against | `both` | `both`,`ios`,`android` |
| `iosDeviceType` | `--plugin-xenon-ios-device-type` | Types of iOS devices to include | `both` | `both`,`simulated`,`real` |
| `androidDeviceType` | `--plugin-xenon-android-device-type` | Types of Android devices to include | `both` | `both`,`simulated`,`real` |
| `skipChromeDownload` | `--plugin-xenon-skip-chrome-download` | Skip automatic chromedriver download | `true` | `true`, `false` |
| `hub` | `--plugin-xenon-hub` | HUB IP address (if running as node) | None | `http://host:port` |
| `maxSessions` | `--plugin-xenon-max-sessions` | Limit concurrent sessions | `8` | Number |
| `enableDashboard` | `--plugin-xenon-enable-dashboard` | Enable the web dashboard | `false` | `true`, `false` |
| `bootedSimulators` | `--plugin-xenon-booted-simulators` | Use already booted simulators | `false` | `true`, `false` |
| `deviceAvailabilityTimeoutMs` | `--plugin-device-availability-timeout-ms` | Wait time for free device (ms) | `300000` | Number |
| `newCommandTimeoutSec` | `--plugin-new-command-timeout-sec` | Auto-release session timeout (sec) | `60` | Number |
| `databaseProvider` | `--plugin-xenon-database-provider` | Database type for state storage | `sqlite` | `sqlite`, `postgresql` |
| `databaseUrl` | `--plugin-xenon-database-url` | Connection string for the database | Local path | Connection URL |
| `aiProvider` | `--plugin-xenon-ai-provider` | AI provider for Xenon | `gemini` | `gemini`, `openai`, `anthropic`, `ollama` |
| `aiModel` | `--plugin-xenon-ai-model` | AI model name to use | - | e.g., `gpt-4o`, `llama3` |
| `aiBaseUrl` | `--plugin-xenon-ai-base-url` | Custom base URL for AI provider | - | e.g., for Ollama |
| `buildCleanupDays` | `--plugin-xenon-build-cleanup-days` | Retention period in days | `30` | Number |
| `buildCleanupMaxCount` | `--plugin-xenon-build-cleanup-max-count` | Maximum number of builds to keep | `100` | Number |
| `buildCleanupSchedule` | `--plugin-xenon-build-cleanup-schedule` | Cron schedule for cleanup | `"0 0 * * *"` | Cron |
| `deleteBuildAssets` | `--plugin-xenon-delete-build-assets` | Delete videos/screenshots | `true` | `true`, `false` |

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

