---
title: Deployment Guide
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Deployment Guide

Xenon supports three deployment topologies. Choose the one that matches your scale and infrastructure.

---

## 1. Standalone (Single Node)

The simplest setup — one machine running Appium + Xenon with devices connected directly. Best for local development, small teams, or CI runners.

**Characteristics:**
- SQLite database (zero setup)
- All devices connected to a single host
- Dashboard accessible on the same machine

<Tabs>
<TabItem value="yaml" label="YAML Config" default>

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
```

</TabItem>
<TabItem value="cli" label="CLI">

```bash
appium server -ka 800 --use-plugins=xenon \
  -pa /wd/hub \
  --plugin-xenon-platform=both \
  --plugin-xenon-max-sessions=8 \
  --plugin-xenon-enable-dashboard=true
```

</TabItem>
</Tabs>

### Database

By default, Xenon uses SQLite stored at `~/.cache/xenon/xenon.db`. No setup required.

---

## 2. Hub-Node (Distributed Grid)

For larger teams or CI farms with devices spread across multiple machines. The **Hub** acts as the controller and the **Nodes** register over HTTP REST (`/xenon/api/register`) and stream live state over Socket.IO. Each node authenticates with a per-node `(accessKey, token)` pair provisioned on the hub — see [Node Provisioning](enterprise-security.md#hub-node-channel-authentication).

```mermaid
graph TD
    subgraph Hub
        H["Xenon Hub\n(Controller)"]
        DB["PostgreSQL"]
        H --> DB
    end
    subgraph Node1["Node 1"]
        N1["Xenon Node"]
        D1["Devices"]
        N1 --> D1
    end
    subgraph Node2["Node 2"]
        N2["Xenon Node"]
        D2["Devices"]
        N2 --> D2
    end
    N1 -->|HTTP + Socket.IO| H
    N2 -->|HTTP + Socket.IO| H
```

### Hub Configuration

```yaml
server:
  keepAliveTimeout: 800
  basePath: /wd/hub
  usePlugins:
    - xenon
  plugin:
    xenon:
      platform: both
      maxSessions: 16
      enableDashboard: true
      databaseProvider: postgresql
      databaseUrl: "postgresql://user:password@localhost:5432/xenon"
```

### Node Configuration

```yaml
server:
  keepAliveTimeout: 800
  basePath: /wd/hub
  usePlugins:
    - xenon
  plugin:
    xenon:
      platform: android
      hub: "http://hub-ip:4723"
```

Set the node's pair-auth env vars before starting the Appium server (provision the credentials on the hub first per [Node Provisioning](enterprise-security.md#hub-node-channel-authentication)):

```bash
export XENON_HUB_ACCESS_KEY="xen_..."
export XENON_HUB_TOKEN="..."
```

### PostgreSQL Setup

PostgreSQL is required for Hub-Node deployments to maintain shared state across nodes.

```bash
# Create the database
createdb xenon

# Set the connection URL
export DATABASE_URL="postgresql://user:password@localhost:5432/xenon"

# Or configure via plugin args
--plugin-xenon-database-provider=postgresql
--plugin-xenon-database-url="postgresql://user:password@localhost:5432/xenon"
```

:::info
Xenon auto-applies pending schema changes on every startup — `prisma db push` for SQLite, `prisma migrate deploy` for PostgreSQL — so deploying a new plugin version never requires a manual migration step. Set `XENON_AUTO_MIGRATE=false` if you manage schema externally via CI for auditable change-control; in that case run `prisma migrate deploy` against your DB **before** booting the new plugin version, otherwise the next request that hits an unmigrated column will throw.
:::

---

## 3. Cloud Execution

Execute tests on cloud device farms without managing physical hardware. Xenon supports five cloud providers:

| Provider | Configuration Key |
|----------|------------------|
| **BrowserStack** | `browserstack` |
| **SauceLabs** | `sauce` |
| **LambdaTest** | `lambdatest` |
| **HeadSpin** | `headspin` |
| **pCloudy** | `pcloudy` |

See the [Cloud Execution Guide](cloud.md) for provider-specific setup.

---

## Environment Variables Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL or SQLite connection string | `file:~/.cache/xenon/xenon.db` |
| `XENON_DB_PROVIDER` | Database provider (`sqlite` or `postgresql`) | `sqlite` |
| `GEMINI_API_KEY` | Google Gemini API key for AI features | — |
| `OPENAI_API_KEY` | OpenAI API key for AI features | — |
| `ANTHROPIC_API_KEY` | Anthropic API key for AI features | — |
| `XENON_AI_PROVIDER` | AI provider selection | `gemini` |
| `XENON_AI_MODEL` | AI model override | Provider default |
| `XENON_AI_BASE_URL` | Custom AI endpoint (for Ollama) | — |
| `XENON_HUB_ACCESS_KEY` | Node→hub access key (pair auth) | — |
| `XENON_HUB_TOKEN` | Node→hub API token (pair auth) | — |
| `XENON_BOOTSTRAP_ADMIN_EMAIL` / `XENON_BOOTSTRAP_ADMIN_PASSWORD` | First-run super-admin user (hub) | `admin@xenon.local` / `Admin@123` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry collector endpoint | — |
| `XENON_OTEL_DEBUG` | Log traces to console | `false` |

---

## Production Checklist

- [ ] Use **PostgreSQL** for any multi-node deployment
- [ ] Set `maxSessions` to match your hardware capacity (CPU cores × 2 is a good starting point)
- [ ] Configure `newCommandTimeoutSec` to auto-release idle sessions (default: 60s)
- [ ] Set up [Data Retention](retention.md) policies to prevent disk exhaustion
- [ ] Configure [Notifications](notifications.md) for `device_offline` alerts
- [ ] Enable [AI Features](ai-features.md) for automatic failure triage
- [ ] Set `keepAliveTimeout` to at least 600 for long-running tests
