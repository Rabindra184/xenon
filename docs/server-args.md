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
| `XENON_AI_PROVIDER` | Same as `--plugin-xenon-aiProvider`. Selects the AI backend: `gemini`, `openai`, `anthropic`, or `ollama`. A provider saved on the dashboard's AI engine page replaces it. |
| `XENON_AI_MODEL` | Overrides the default model for the selected provider. A model saved through `POST /xenon/api/config` replaces it. |
| `XENON_AI_BASE_URL` | Custom base URL for the AI provider (Ollama, proxies, OpenAI-compatible gateways). A base URL saved through `POST /xenon/api/config` replaces it. |
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
| `XENON_DB_PROVIDER` | Same as `--plugin-xenon-databaseProvider`, and has no effect. Leave it unset: the published plugin stores its data in SQLite only. |
| `DATABASE_URL` | Where the SQLite database lives, `file:/path/to/xenon.db`. Falls back to `file:~/.cache/xenon/xenon.db`. A PostgreSQL URL stops the server at startup. |
| `XENON_JSON_LOGGING` | When `true`, log lines are JSON. Used only when `--plugin-xenon-enableJsonLogging` is not given: the option, true or false, wins over it. |
| `XENON_MAX_CONCURRENT_RECORDINGS` | The cap on simultaneous free-form recordings (a whole number of at least 1; default 4). Used only when `--plugin-xenon-maxConcurrentRecordings` is not given. |
| `XENON_RECORDINGS_ASSETS_PATH` | Where free-form recordings are stored. Used only when `--plugin-xenon-recordingsAssetsPath` is not given. |
| `XENON_AUTO_MIGRATE` | When `true` (default), every server (hub, node or standalone) brings its database up to date on startup, and the database decides how: `prisma migrate deploy` for one that keeps a migration history (`_prisma_migrations`) whose tables match it, `prisma db push` for any other (a new database, one made with the default settings or `npm run db:migrate`, or one whose tables differ from its recorded migrations). `db push` accepts data loss only on a database with no history; on one with a history it refuses to drop anything (a table added by hand, say), and the server stops and says what to do. Set `false` for ops who apply schema changes externally via CI, with the same command for the same database. See [retention.md](retention.md) and `prisma/migrations/`. |
| `XENON_HUB_ACCESS_KEY` | Node→hub outbound: access key the node sends in `x-xenon-access-key`. Required alongside `XENON_HUB_TOKEN`. See `docs/node-provisioning.md`. |
| `XENON_HUB_TOKEN` | Node→hub outbound: API token the node sends in `x-xenon-token`. Required alongside `XENON_HUB_ACCESS_KEY`. |
| `XENON_REQUIRE_SESSION_TOKEN` | When `true` (also `1`, `yes`, `on`), createSession is refused unless it carries valid credentials of an active user (`xe:options.accessKey` + `xe:options.token`, or `xe:options.sessionToken`). Off by default. Set it on the hub. |
| `XENON_PUBLIC_URL` | The address people reach this server at: scheme, host and port, such as `https://xenon.example.com` or `http://lab-mac:4723`. The dashboard's own address, ending in `/xenon` or `/xenon/`, is taken too. Any other path is refused, since the dashboard is always served at `/xenon` on the server's root and can't sit under a reverse-proxy prefix. Password reset links that Xenon emails or logs point here (`<address>/xenon/reset-password`), never at the `Host` of the request that asked for one, and so does each device's `dashboard_link` (`<address>/dashboard`, a path on the server when unset). Without it Xenon sends no reset link: the sign-in page asks people to contact an administrator, and an administrator's reset link is handed to them rather than emailed. |
| `XENON_SMTP_URL`, `XENON_SMTP_FROM` | The mail server password reset links go out through (for example `smtps://user:pass@smtp.example.com:465`), and the sender. Links are emailed only when `XENON_PUBLIC_URL` is set too. |
| `XENON_RESET_TOKEN_TTL_MS` | How long a password reset link works, in milliseconds (default 1 hour). The email says so. |
| `XENON_USER_SESSION_TTL_MS` | How long a dashboard sign-in lasts without use, in milliseconds (default 24 hours). Each request renews it for that long, longer than a day included. |
| `XENON_MCP_TOKEN_TTL_SEC` | Lifetime of the `xenon-mcp` tokens and session tokens `POST /xenon/api/auth/token` mints, in seconds (default 86400). A token minted with a Bearer token or an expiring API key ends no later than that credential. |
| `XENON_REQUIRE_COMMAND_AUTH` | When `true` (also `1`, `yes`, `on`), every WebDriver request under `<basePath>/session/:sessionId` must carry the caller's credentials, and only the session's owner or an admin may send it. The same applies to session WebSockets (`<basePath>/bidi/<id>`, `/ws/session/<id>/...`), and `GET <basePath>/appium/sessions` lists only the caller's sessions. Off by default; ignored when auth is disabled. Set it on the hub. See [Per-command authentication](#per-command-authentication). |

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

### The session list

`GET <basePath>/appium/sessions` lists every live session's id and
capabilities. Appium serves it only when the `session_discovery` insecure
feature is enabled (for example `--allow-insecure '*:session_discovery'`, which
Appium Inspector's "attach to session" needs). With this setting on, the list
depends on who asks:

- an admin (as above) sees every session;
- any other caller with valid credentials sees only the sessions they own;
- a caller with no credentials, or credentials that don't verify, gets an
  empty list, `{"value":[]}`, the same answer as a server with no sessions.

If Appium answers with an error (for example, `session_discovery` is not
enabled), that answer is passed on unchanged. If Xenon can't check the
credential or look up the owners, the request gets `503`, never the full
list. An emptied list is logged as a `warn`, and a filtered one as an `info`
line with how many sessions were shown.

### Session WebSockets

Some session traffic is a WebSocket, not a WebDriver request: WebDriver BiDi
(`<basePath>/bidi/<sessionId>`), and the sockets drivers open for a session,
such as UiAutomator2's logcat and XCUITest's syslog broadcasts
(`/ws/session/<sessionId>/...`). With this setting on, the upgrade request must
carry the same headers as a command, from the session's owner or an admin.
Otherwise it gets a bare `404 Not Found` with no body, and the connection is
closed before Appium sees it. The answer is the same whether or not the session
exists. If the check can't run, the answer is `503`. Refusals are logged as a
`warn`, like commands.

Other WebSockets are not affected: the BiDi socket without a session id
(`<basePath>/bidi`), socket.io, and the dashboard's live-preview and log
streams, which use their own single-use tickets.

The client must send the headers on the upgrade request itself. Check that
yours does, since some send connection-level headers only on HTTP commands.
Browsers can't set headers on a WebSocket, so a browser page can't use these
sockets with this setting on.

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
| `--plugin-xenon-emulators` | array | `[]` | Android emulators (AVDs) to boot when the server starts, each as `{ "avdName": "Pixel_7", ... }`. Any other field is a launch option passed to the emulator: `args`, `env`, `language`, `country`, `launchTimeout`, `readyTimeout`, `retryTimes`. Nothing is booted when `platform` is `ios` or `androidDeviceType` is `real`. It does not limit which emulators are discovered: every emulator that is running is found, as `bootedEmulators` allows. |
| `--plugin-xenon-bootedSimulators` | boolean | `false` | Only discover iOS simulators that are already booted. Recommended on machines with many installed simulators — avoids allocating WDA/MJPEG ports for shutdown sims (the WDA pool is 8100-8199, 100 ports). |
| `--plugin-xenon-bootedEmulators` | boolean | `false` | Only discover Android emulators that are already booted. |
| `--plugin-xenon-adbRemote` | array | `[]` | List of remote ADB hosts in `host:port` form (e.g. `192.168.1.50:5037`) to discover Android devices on other machines. |
| `--plugin-xenon-removeDevicesFromDatabaseBeforeRunningThePlugin` | boolean | `false` | At startup, also forget what was set for this server's own phones (team, tags, maintenance, reservations), so each comes back as a new phone. Without it a phone keeps those whenever it reconnects, through restarts. A node forgets them for every phone it has; a hub keeps its nodes' phones and theirs either way. |

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
| `--plugin-xenon-maxSessions` | number | `8` | Maximum number of Appium sessions this server runs at once. A new session waits until fewer are running or being started. A live preview, a recording, or an SDK lease that has no session on it does not use a slot; a session started on a leased phone does, but is never held back itself. On a hub the count includes its nodes' phones. A value below 1 means no limit. |
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
| `--plugin-xenon-enableDashboard` | boolean | `false` | Keep a full record of each Appium session for the dashboard: its commands, screenshots, logs and performance on the Sessions page, and its heals in Selector Health. Self-healing learns selectors either way, while self-healing is on. Without it, a session on this server's own phones isn't listed at all, while a hub still lists the sessions it sends to its nodes' phones, with their result, why they failed and their video. A node's own setting records nothing for its hub's sessions. Video is recorded either way unless the session turns it off. The dashboard itself is always served at `/xenon/`, whatever this is set to. |
| `--plugin-xenon-authDisabled` | boolean | `false` | Disable API-key authentication for all `/xenon/api/*` endpoints. Local development only; a WARN is logged every 60 s as a reminder. |

### Health & lifecycle

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--plugin-xenon-healthCheckIntervalMs` | number | `300000` | Default interval (ms) between background device health checks. Overridden when `healthCheckSchedule` is set. A value saved on the dashboard's Settings page replaces this one. |
| `--plugin-xenon-healthCheckSchedule` | string | — | Cron expression for the device health-check job (e.g. `0 * * * *` for hourly). Takes precedence over `healthCheckIntervalMs`. A schedule saved on the dashboard's Settings page replaces this one. |

### Data retention

See [Data Retention & Maintenance](./retention.md) for how these interact.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--plugin-xenon-buildCleanupDays` | number | `30` | Builds/sessions older than this many days are purged by the cleanup job. A value saved on the dashboard's Maintenance page replaces this one, and applies at the next cleanup run without a restart. |
| `--plugin-xenon-buildCleanupMaxCount` | number | `100` | Maximum number of builds to retain. Oldest-first eviction beyond this cap regardless of `buildCleanupDays`. A value saved on the dashboard's Maintenance page replaces this one. |
| `--plugin-xenon-buildCleanupSchedule` | string | `"0 0 * * *"` | Cron expression for the retention job. Default runs at midnight. A schedule saved on the dashboard's Maintenance page replaces this one, and takes effect at once. |
| `--plugin-xenon-deleteBuildAssets` | boolean | `true` | When true, the cleanup job also deletes session video recordings and screenshots from disk (not just DB rows). A value saved on the dashboard's Maintenance page replaces this one. |

### Database

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--plugin-xenon-databaseProvider` | string (sqlite, postgresql) | `sqlite` | Has no effect. The published plugin stores its data in SQLite only, and each server, hub or node, has its own database: the database URL says where. `postgresql` is accepted so older configs still start, and logs a warning. It no longer chooses how the schema is updated at startup (see `XENON_AUTO_MIGRATE`): through 2.15.0 it chose `prisma migrate deploy`, which stopped the server on a database made with the default settings. |
| `--plugin-xenon-databaseUrl` | string | `file:~/.cache/xenon/xenon.db` | Where the SQLite database lives, `file:/path/to/xenon.db`. Falls back to `DATABASE_URL`. A PostgreSQL URL stops the server at startup. |

### AI & self-healing

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--plugin-xenon-enableSelfHealing` | boolean | `true` | Enable the self-healing pipeline (etalon recovery → Native → Fuzzy XML → OCR → Visual AI → LLM). A value saved with the AI self-healing switch on the dashboard's Settings page replaces this one, and applies from the next command without a restart. |
| `--plugin-xenon-aiProvider` | string (gemini, openai, anthropic, ollama) | `gemini` | AI provider for the LLM healing tier and visual analysis. Also controlled by `XENON_AI_PROVIDER`. A provider saved on the dashboard's AI engine page replaces this one, and is kept across restarts. |
| `--plugin-xenon-aiModel` | string | — | Override the default model for the selected `aiProvider`. Falls back to `XENON_AI_MODEL`. A model saved through `POST /xenon/api/config` replaces this one. |
| `--plugin-xenon-aiBaseUrl` | string | — | Custom base URL for the AI provider (local Ollama, OpenAI-compatible gateway). Falls back to `XENON_AI_BASE_URL`. A base URL saved through `POST /xenon/api/config` replaces this one. |
| `--plugin-xenon-geminiApiKey` | string | — | Prefer `XENON_GEMINI_API_KEY` (env) so keys don't live in config files. |
| `--plugin-xenon-openaiApiKey` | string | — | Prefer `XENON_OPENAI_API_KEY` (env). |
| `--plugin-xenon-anthropicApiKey` | string | — | Prefer `XENON_ANTHROPIC_API_KEY` (env). |

### Miscellaneous

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--plugin-xenon-skipChromeDownload` | boolean | `true` | Skip the automatic ChromeDriver download performed by uiautomator2. Leave `true` unless you specifically need Xenon to manage Chrome binaries. |
| `--plugin-xenon-enableJsonLogging` | boolean | off | Emit structured JSON log lines instead of human-readable text. Recommended for shipping logs to a log aggregator. When unset, the `XENON_JSON_LOGGING` environment variable decides (`true` turns it on); setting this to true or false overrides the variable. |
| `--plugin-xenon-maxConcurrentRecordings` | integer (1-16) | `4` | Server-wide hard cap on simultaneous free-form (non-session) screen recordings across all users. Automation session recording is exempt. When unset, `XENON_MAX_CONCURRENT_RECORDINGS` is used if it is a whole number of at least 1. |
| `--plugin-xenon-recordingsAssetsPath` | string | `~/.cache/xenon/assets/sessions/recordings` | Directory for free-form recording artifacts. When unset, `XENON_RECORDINGS_ASSETS_PATH` is used if it is set. |
| `--plugin-xenon-cloud` | object | — | Cloud-provider configuration (BrowserStack, SauceLabs, pCloudy, LambdaTest). See `CloudConfig` in `schema.json`. |
| `--plugin-xenon-derivedDataPath` | object | — | Map of per-UDID `derivedDataPath` overrides for iOS. |

<!-- END AUTOGEN -->

## Runtime configuration

The device health check (`healthCheckIntervalMs`, `healthCheckSchedule`) and the build cleanup (`buildCleanupDays`, `buildCleanupMaxCount`, `buildCleanupSchedule`, `deleteBuildAssets`) can be changed at runtime, on the dashboard's Settings and Maintenance pages or with `POST /xenon/api/config`, without restarting the server. A value saved that way is stored in the database and replaces the option the server was started with: the health check picks it up within a minute, the cleanup at its next run, and a new cleanup schedule at once. Changing them needs a super admin. See [Data Retention & Maintenance](./retention.md).

## Related docs

- [Data Retention & Maintenance](./retention.md)
- [README — Configuration](../README.md#-configuration)
- [README — Authentication](../README.md#-authentication)
