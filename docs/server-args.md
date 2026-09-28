# Xenon Plugin Server Arguments

This is the complete reference for Xenon plugin CLI flags and environment variables.

The canonical source is [`schema.json`](../schema.json) — this page is generated from it. If a flag is missing here, it is either not yet documented or has been added since the last regeneration.

## Using CLI flags

Pass each flag with the `--plugin-xenon-` prefix:

```bash
appium server --use-plugins=xenon \
  --plugin-xenon-platform=both \
  --plugin-xenon-max-sessions=8 \
  --plugin-xenon-enable-dashboard \
  --plugin-xenon-booted-simulators
```

Appium also accepts either camelCase (`--plugin-xenon-maxSessions`) or kebab-case (`--plugin-xenon-max-sessions`).

## Using a config file

Put the same keys (camelCase, no prefix) under `plugin.xenon` in a YAML or JSON config:

```yaml
server:
  usePlugins: ["xenon"]
  plugin:
    xenon:
      platform: both
      maxSessions: 8
      enableDashboard: true
      bootedSimulators: true
```

Then:

```bash
appium server --config xenon-config.yaml
```

## Environment variables

These are read directly from the process environment and complement (or override) the CLI flags.

| Variable | Purpose |
|----------|---------|
| `XENON_AI_PROVIDER` | Same as `--plugin-xenon-aiProvider`. Selects the AI backend: `gemini`, `openai`, `anthropic`, or `ollama`. |
| `XENON_AI_MODEL` | Overrides the default model for the selected provider. |
| `XENON_AI_BASE_URL` | Custom base URL for the AI provider (Ollama, proxies, OpenAI-compatible gateways). |
| `XENON_GEMINI_API_KEY` / `GEMINI_API_KEY` | Gemini credentials. The `XENON_`-prefixed form wins if both are set. |
| `XENON_OPENAI_API_KEY` / `OPENAI_API_KEY` | OpenAI credentials. |
| `XENON_ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY` | Anthropic credentials. |
| `XENON_OPENAI_MODEL` | Alternate way to set the OpenAI model. |
| `XENON_OTEL_DEBUG` | When `true`, OpenTelemetry adds a ConsoleSpanExporter, ConsoleLogRecordExporter, and ConsoleMetricExporter so every span, log record, and metric is dumped to stdout. Use for tracing dev-time work — not for production. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP HTTP endpoint for traces. Used as-is — the JS exporter does not append a path. Set the **full URL**: `http://collector:4318/v1/traces` for an OTel Collector, `http://tempo:4318/v1/traces` for Tempo direct. |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | OTLP HTTP endpoint for log records. Used as-is. For Loki 3.0+ direct ingestion the path is `/otlp/v1/logs` — set the full URL `http://loki:3100/otlp/v1/logs`. See `examples/observability/README.md`. |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | OTLP HTTP endpoint for metrics. Used as-is. Typical destination is an OTel Collector at `http://collector:4318/v1/metrics`; pre-aggregated counters/histograms exit on a 60s cadence by default. |
| `OTEL_TRACES_ENABLED` | When `false`, suppresses trace export even if `OTEL_EXPORTER_OTLP_ENDPOINT` is set. |
| `OTEL_LOGS_ENABLED` | When `false`, suppresses log export even if `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` is set. |
| `OTEL_METRICS_ENABLED` | When `false`, suppresses metrics export even if `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` is set. |
| `OTEL_SDK_DISABLED` | Master kill switch. When `true`, the SDK never starts — traces, logs, and metrics are all no-ops. |
| `XENON_DB_PROVIDER` | Same as `--plugin-xenon-databaseProvider` (`sqlite` or `postgresql`). |
| `DATABASE_URL` | Prisma database URL. Falls back to `file:~/.cache/xenon/xenon.db`. |
| `XENON_AUTO_MIGRATE` | When `true` (default), the hub auto-applies pending schema changes on startup. Set `false` for ops who run migrations externally via CI. See [retention.md](retention.md) and `prisma/migrations/`. |
| `XENON_HUB_ACCESS_KEY` | Node→hub outbound: access key the node sends in `x-xenon-access-key`. Required alongside `XENON_HUB_TOKEN`. See `docs/node-provisioning.md`. |
| `XENON_HUB_TOKEN` | Node→hub outbound: API token the node sends in `x-xenon-token`. Required alongside `XENON_HUB_ACCESS_KEY`. |
| `XENON_REQUIRE_SESSION_TOKEN` | When `true` (also `1`, `yes`, `on`), createSession is refused unless it carries the session's credentials (`xe:options.accessKey` + `xe:options.token`, or `xe:options.sessionToken`). Off by default. Set it on the hub. |
| `XENON_REQUIRE_COMMAND_AUTH` | When `true` (also `1`, `yes`, `on`), every WebDriver request under `<basePath>/session/:sessionId` must carry the caller's credentials, and only the session's owner or an admin may send it. Off by default; ignored when auth is disabled. Set it on the hub. See [Per-command authentication](#per-command-authentication). |

Prefer environment variables over CLI flags for secrets so they do not end up in shell history or config files.

## Per-command authentication

Xenon checks credentials when a session is created. Without this setting, every
later command (`<basePath>/session/<id>/...`) is authorized by the session id
alone, so anyone who learns a session id can drive that session.

`XENON_REQUIRE_COMMAND_AUTH=true` closes that. Every request under
`<basePath>/session/:sessionId`, for every method (including `DELETE`), must
carry one of the credentials the REST API accepts:

- the header pair `x-xenon-access-key` + `x-xenon-token`, or
- `Authorization: Bearer <jwt>`, a token minted by `POST /xenon/api/auth/token`
  with audience `xenon-rest` (1 hour) or `xenon-mcp`.

The caller must be the session's owner, or an admin: a `SUPER_ADMIN`, or a
credential with the `admin` scope. An `ADMIN` user's ordinary key is not
enough. Creating a session (`POST <basePath>/session`) and requests outside a
session (`/status`, `/xenon/api/...`) are not affected. The dashboard cookie is
not accepted here.

### Give every session an owner

A session's owner is whoever created it, as named by the session's credentials
(`xe:options.accessKey` + `xe:options.token`, or `xe:options.sessionToken`).
Headers on the createSession request don't set the owner. A session created
without credentials has no owner, and with this setting on only an admin can
use it, including the person who started it. Either make every client send
those capabilities, or turn on `XENON_REQUIRE_SESSION_TOKEN` as well so a
session without them is never created.

### Refusals

A refused command gets exactly what WebDriver answers for a session that doesn't
exist, so a caller can't tell a session they may not use from a missing one:

```
HTTP/1.1 404 Not Found
Content-Type: application/json; charset=utf-8

{"value":{"error":"invalid session id","message":"A session is either terminated or not started","stacktrace":""}}
```

Each refusal is logged as a `warn` with the session id and the caller's user id,
or `no credentials` / `invalid credentials`. The credential itself is never
logged. If Xenon can't check the credential or look up the session's owner (for
example, the database is unavailable), the command gets `503` with a WebDriver
`unknown error` body. It is never let through.

A verified credential is remembered for 30 seconds. A key that is revoked or
expired, or a user who is deactivated or demoted, stops working for commands
within 30 seconds. The REST API and createSession see the change at once.

### Sending the headers from a client

Send the headers on every request. Most clients do this with a single
connection-level setting. In each example, the capabilities give the session
its owner and the headers prove who is calling.

WebdriverIO (`headers` option):

```js
import { remote } from 'webdriverio';

const credentials = { accessKey: process.env.XENON_ACCESS_KEY, token: process.env.XENON_TOKEN };

const driver = await remote({
  hostname: 'xenon-hub.example.com',
  port: 4723,
  path: '/wd/hub',
  headers: {
    'x-xenon-access-key': credentials.accessKey,
    'x-xenon-token': credentials.token,
  },
  capabilities: {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'xe:options': credentials,
  },
});
```

Appium Java client (a `Filter` on `AppiumClientConfig`):

```java
import io.appium.java_client.AppiumClientConfig;
import io.appium.java_client.android.AndroidDriver;
import io.appium.java_client.android.options.UiAutomator2Options;
import java.net.URL;
import java.util.Map;
import org.openqa.selenium.remote.http.Filter;

String accessKey = System.getenv("XENON_ACCESS_KEY");
String token = System.getenv("XENON_TOKEN");

Filter xenonAuth = next -> req -> {
  req.addHeader("x-xenon-access-key", accessKey);
  req.addHeader("x-xenon-token", token);
  return next.execute(req);
};

AppiumClientConfig config = AppiumClientConfig.defaultConfig()
    .baseUrl(new URL("http://xenon-hub.example.com:4723/wd/hub"))
    .withFilter(xenonAuth);

UiAutomator2Options options = new UiAutomator2Options();
options.setCapability("xe:options", Map.of("accessKey", accessKey, "token", token));

AndroidDriver driver = new AndroidDriver(config, options);
```

Appium Python client (`extra_headers` on `AppiumClientConfig`, which passes it
to Selenium's `ClientConfig`; Selenium 4.27 or later):

```python
import os
from appium import webdriver
from appium.options.android import UiAutomator2Options
from appium.webdriver.client_config import AppiumClientConfig

access_key = os.environ["XENON_ACCESS_KEY"]
token = os.environ["XENON_TOKEN"]

client_config = AppiumClientConfig(
    remote_server_addr="http://xenon-hub.example.com:4723/wd/hub",
    extra_headers={"x-xenon-access-key": access_key, "x-xenon-token": token},
)

options = UiAutomator2Options()
options.set_capability("xe:options", {"accessKey": access_key, "token": token})

driver = webdriver.Remote(
    client_config.remote_server_addr, options=options, client_config=client_config
)
```

curl:

```bash
curl -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN" \
  "http://xenon-hub.example.com:4723/wd/hub/session/$SESSION_ID/url"

# or with a token from POST /xenon/api/auth/token
curl -H "Authorization: Bearer $XENON_JWT" \
  "http://xenon-hub.example.com:4723/wd/hub/session/$SESSION_ID/url"
```

A `xenon-rest` token lasts an hour, so a run that may outlive it should use the
key pair. `GET /xenon/api/capabilities` reports `features.commandAuth: true`
when the setting is on, so a client can check before it starts.

### Hub and nodes

Enable it on the hub, where clients connect. Don't enable it on nodes: a node
checks credentials against its own database, so it would refuse the commands
the hub forwards. Keep each node's Appium port reachable only from the hub.

### What it doesn't cover

- WebSocket connections to a session (`<basePath>/bidi/<id>` for WebDriver BiDi,
  `<basePath>/ws/...` for log broadcasts) are not checked.
- `GET <basePath>/appium/sessions` still lists the running sessions. With this
  setting on, knowing a session's id is no longer enough to use it.
- The server refuses to start if it can't place the check in front of Appium's
  own routes, rather than run without it.

## CLI flags

<!-- BEGIN AUTOGEN: regenerate with `node scripts/generate-server-args.js` (see schema.json) -->

### Platform & discovery

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--plugin-xenon-platform` | string (ios, android, both) | `"both"` | Which mobile platform(s) Xenon should discover and orchestrate. |
| `--plugin-xenon-androidDeviceType` | string (both, real, simulated) | `"both"` | Which Android device kinds to include: physical devices, emulators, or both. |
| `--plugin-xenon-iosDeviceType` | string (both, real, simulated) | `"both"` | Which iOS device kinds to include: physical devices, simulators, or both. |
| `--plugin-xenon-simulators` | array | `[]` | Allow-list of iOS simulators (by name + sdk) to expose. Empty array means expose all discoverable simulators. |
| `--plugin-xenon-emulators` | array | `[]` | Allow-list of Android emulator AVDs to expose. Empty array means expose all discoverable emulators. |
| `--plugin-xenon-bootedSimulators` | boolean | `false` | Only discover iOS simulators that are already booted. Recommended on machines with many installed simulators — avoids allocating WDA/MJPEG ports for shutdown sims (the WDA pool is 8100-8199, 100 ports). |
| `--plugin-xenon-bootedEmulators` | boolean | `false` | Only discover Android emulators that are already booted. |
| `--plugin-xenon-adbRemote` | array | `[]` | List of remote ADB hosts in `host:port` form (e.g. `192.168.1.50:5037`) to discover Android devices on other machines. |
| `--plugin-xenon-removeDevicesFromDatabaseBeforeRunningThePlugin` | boolean | `false` | Wipe the persisted Device table at startup so discovery begins from a clean slate. Useful after hardware changes. |

### Networking

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--plugin-xenon-bindHostOrIp` | string | `"127.0.0.1"` | Host/IP the Xenon REST and WebSocket server binds to. Set to `0.0.0.0` to expose on all interfaces. |
| `--plugin-xenon-hub` | string | — | URL of the Xenon hub this instance should register with as a node (e.g. `http://hub.example:4723`). Omit to run as a standalone hub. |
| `--plugin-xenon-remoteMachineProxyIP` | string | — | Public host/URL that clients should use to reach this node when running behind a reverse proxy or NAT. |
| `--plugin-xenon-proxy` | object | — | Outbound HTTP/S proxy for Xenon's internal Axios calls (see `AxiosProxy` in `schema.json`). |

### Session control

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--plugin-xenon-maxSessions` | number | `8` | Maximum number of Appium sessions this node will run concurrently. Additional requests queue until a slot frees. |
| `--plugin-xenon-deviceAvailabilityTimeoutMs` | number | `300000` | How long (ms) a session request waits for a free device before failing. |
| `--plugin-xenon-deviceAvailabilityQueryIntervalMs` | number | `10000` | How often (ms) the session queue polls for a free device while waiting. |
| `--plugin-xenon-newCommandTimeoutSec` | number | `60` | Default Appium `newCommandTimeout` (seconds) when a client does not send one. Also drives the reconciler that releases devices idle past this threshold. |
| `--plugin-xenon-sessionHeartbeatIntervalMs` | number | `30000` | How often (ms) each active session writes a heartbeat. The orphan sweeper uses ~3× this interval to detect abandoned sessions. |

### Hub ↔ node

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--plugin-xenon-sendNodeDevicesToHubIntervalMs` | number | `30000` | How often (ms) a node pushes its device list to the hub. Only used when `hub` is set. |
| `--plugin-xenon-checkStaleDevicesIntervalMs` | number | `30000` | How often (ms) the hub prunes devices from nodes that have stopped heartbeating. |
| `--plugin-xenon-checkBlockedDevicesIntervalMs` | number | `30000` | How often (ms) to re-evaluate manually-blocked devices and the session reconciler that frees orphaned busy devices. |
| `--plugin-xenon-tlsRejectUnauthorized` | boolean | `true` | Verify TLS certificates on internal outgoing requests. Set to `false` only for dev/test. |

### Dashboard & auth

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--plugin-xenon-enableDashboard` | boolean | `false` | Serve the React dashboard at `/xenon/` and the Socket.io event stream. |
| `--plugin-xenon-authDisabled` | boolean | `false` | Disable API-key authentication for all `/xenon/api/*` endpoints. Local development only; a WARN is logged every 60 s as a reminder. |

### Health & lifecycle

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--plugin-xenon-healthCheckIntervalMs` | number | `86400000` | Default interval (ms) between background device health checks. Overridden when `healthCheckSchedule` is set. |
| `--plugin-xenon-healthCheckSchedule` | string | — | Cron expression for the device health-check job (e.g. `0 * * * *` for hourly). Takes precedence over `healthCheckIntervalMs`. |

### Data retention

See [Data Retention & Maintenance](./retention.md) for how these interact.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--plugin-xenon-buildCleanupDays` | number | `30` | Builds/sessions older than this many days are purged by the cleanup job. |
| `--plugin-xenon-buildCleanupMaxCount` | number | `100` | Maximum number of builds to retain. Oldest-first eviction beyond this cap regardless of `buildCleanupDays`. |
| `--plugin-xenon-buildCleanupSchedule` | string | `"0 0 * * *"` | Cron expression for the retention job. Default runs at midnight. |
| `--plugin-xenon-deleteBuildAssets` | boolean | `true` | When true, the cleanup job also deletes session video recordings and screenshots from disk (not just DB rows). |

### Database

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--plugin-xenon-databaseProvider` | string (sqlite, postgresql) | `sqlite` | Database backend. SQLite is per-instance; PostgreSQL is required for multi-node hub deployments. |
| `--plugin-xenon-databaseUrl` | string | `file:~/.cache/xenon/xenon.db` | Prisma-style database URL. SQLite: `file:/path/to/xenon.db`. PostgreSQL: `postgresql://user:pass@host/db`. Falls back to `DATABASE_URL`. |

### AI & self-healing

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--plugin-xenon-enableSelfHealing` | boolean | `true` | Enable the 5-tier self-healing pipeline (Native → Fuzzy XML → OCR → Visual AI → LLM). Can also be toggled at runtime from the dashboard. |
| `--plugin-xenon-aiProvider` | string (gemini, openai, anthropic, ollama) | `gemini` | AI provider for the LLM healing tier and visual analysis. Also controlled by `XENON_AI_PROVIDER`. |
| `--plugin-xenon-aiModel` | string | — | Override the default model for the selected `aiProvider`. Falls back to `XENON_AI_MODEL`. |
| `--plugin-xenon-aiBaseUrl` | string | — | Custom base URL for the AI provider (local Ollama, OpenAI-compatible gateway). Falls back to `XENON_AI_BASE_URL`. |
| `--plugin-xenon-geminiApiKey` | string | — | Prefer `XENON_GEMINI_API_KEY` (env) so keys don't live in config files. |
| `--plugin-xenon-openaiApiKey` | string | — | Prefer `XENON_OPENAI_API_KEY` (env). |
| `--plugin-xenon-anthropicApiKey` | string | — | Prefer `XENON_ANTHROPIC_API_KEY` (env). |

### Miscellaneous

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--plugin-xenon-skipChromeDownload` | boolean | `true` | Skip the automatic ChromeDriver download performed by uiautomator2. Leave `true` unless you specifically need Xenon to manage Chrome binaries. |
| `--plugin-xenon-enableJsonLogging` | boolean | `false` | Emit structured JSON log lines instead of human-readable text. Recommended for shipping logs to a log aggregator. |
| `--plugin-xenon-cloud` | object | — | Cloud-provider configuration (BrowserStack, SauceLabs, pCloudy, LambdaTest). See `CloudConfig` in `schema.json`. |
| `--plugin-xenon-derivedDataPath` | object | — | Map of per-UDID `derivedDataPath` overrides for iOS. |

<!-- END AUTOGEN -->

## Runtime configuration

A subset of these options can be changed at runtime via `PUT /xenon/api/config` without restarting the server. The response indicates if any changed field requires a restart to take full effect (e.g. `platform`, `hub`). See the [Authentication](../README.md#-authentication) section for API-key requirements.

## Related docs

- [Data Retention & Maintenance](./retention.md)
- [README — Configuration](../README.md#-configuration)
- [README — Authentication](../README.md#-authentication)
