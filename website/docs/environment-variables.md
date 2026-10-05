---
title: Environment variables
description: Every environment variable Xenon reads, grouped by what it is for, with its default and what it does.
---

Xenon takes most of its settings from Appium's plugin options, listed on [Configuration](./configuration.md). Some things are read from the environment of the process that runs Appium instead: secrets, the first admin account, the security switches, the database's location and telemetry. This page lists every variable Xenon reads, with its default and what it does.

## Setting them

Put the variables in the environment of the process that runs Appium, before it starts. Xenon reads them when it starts, so restart Appium after you change one.

```bash
export XENON_BOOTSTRAP_ADMIN_EMAIL="you@example.com"
export XENON_BOOTSTRAP_ADMIN_PASSWORD="a-long-passphrase-of-your-own"
export XENON_AI_PROVIDER=anthropic
export XENON_ANTHROPIC_API_KEY='<your Anthropic API key>'

appium server --use-plugins=xenon
```

- **Under a process manager,** put them in the manager's environment, such as `env` in a PM2 file: see [Production deployment](./deployment.md#keep-it-running).
- **With [Xenon Control](./xenon-control.md),** put them on a profile's **Secrets & Env** tab. The app stores secrets encrypted and hands them to the server as environment variables.
- **Keep secrets here, not in a config file.** Appium prints every option that isn't at its default when it starts, and config files get copied. See [Hardening](./hardening.md#keep-secrets-in-environment-variables).
- **`XENON_ACCESS_KEY`, `XENON_TOKEN` and `XENON_SESSION_TOKEN`** in the samples on these pages are shell variables of your own, holding your credentials for `curl` and test scripts. Xenon doesn't read them.

How Xenon reads the values:

- **A switch that is off by default** turns on only with exactly `true`. `TRUE`, `1` or `yes` leave it off. `XENON_REQUIRE_SESSION_TOKEN` and `XENON_REQUIRE_COMMAND_AUTH` are the exceptions: they also take `1`, `yes` and `on`, in any case.
- **A switch that is on by default** (`XENON_AUTO_MIGRATE`, `XENON_TLS_REJECT_UNAUTHORIZED` and the `OTEL_*_ENABLED` ones) turns off only with exactly `false`. `XENON_EVENT_LOG` turns off only with exactly `off`.
- **A variable with a matching option** is a fallback: the option wins when it is set. `XENON_AUTH_DISABLED` is the exception: either it or the `authDisabled` option turns sign-in off.

## Setup

| Variable | Default | What it does |
|---|---|---|
| `XENON_BOOTSTRAP_ADMIN_EMAIL` | `admin@xenon.local` | The email of the first Super admin, which Xenon makes the first time it starts with no users in its database. It isn't read again after that. |
| `XENON_BOOTSTRAP_ADMIN_PASSWORD` | `Admin@123` | That user's password. Anyone can look up the default, so set your own before the first start on a server others can reach. |
| `XENON_BOOTSTRAP_RESET_PASSWORD` | Off | `true`: at startup, set the password of the oldest active Super admin to `XENON_BOOTSTRAP_ADMIN_PASSWORD` and sign them out everywhere. It does this at every start while it is set, so remove it after one. See [A Super admin who is locked out](./authentication.md#a-super-admin-who-is-locked-out). |
| `ANDROID_HOME`, `ANDROID_SDK_ROOT` | None | The Android SDK folder. Xenon looks for `adb` in its `platform-tools` folder, and finds no Android devices without it. `ANDROID_HOME` is used when both are set. See [Installation and requirements](./installation.md#android-needs-android_home). |

## Database

| Variable | Default | What it does |
|---|---|---|
| `DATABASE_URL` | `file:` and the path of `~/.cache/xenon/xenon.db` | Where the SQLite database is, as `file:/path/to/xenon.db`. The `databaseUrl` option wins. A `postgresql://` URL stops the server at startup with a message that says what to set: Xenon stores its data in SQLite only. |
| `XENON_DB_PROVIDER` | `sqlite` | Leave it unset, and the `databaseProvider` option too, which wins over it. With `postgresql`, Xenon logs a warning that the setting has no effect, but it does change how Xenon updates the database's tables at startup. A new database, or one first made with `postgresql` set, still starts. A database made with the default setting, by an earlier start or by `npm run dev`, can't be updated that way, and the server stops: see [The server doesn't start](./troubleshooting.md#the-server-doesnt-start). |
| `XENON_AUTO_MIGRATE` | On | `false`: don't update the database's tables at startup. You then apply the changes yourself before starting a new version: see [Upgrading](./upgrading.md#database-changes). |
| `XENON_STORAGE_TYPE` | Follows the database | Leave it unset. Any value other than `sqlite`, `postgresql` or `prisma` moves the device list, the queue of waiting session requests and a few other records out of the database into an older in-process store that Xenon's own tests use. |

## AI

[AI providers](./ai-providers.md) explains how to set a provider up, its default model, and why its key belongs in the environment rather than in a config file.

| Variable | Default | What it does |
|---|---|---|
| `XENON_AI_PROVIDER` | `gemini` | The provider for the AI healing tiers, Omni-Vision and failure analysis: `gemini`, `openai`, `anthropic` or `ollama`. The `aiProvider` option wins, and a provider chosen on the **AI engine** page wins over both. |
| `XENON_GEMINI_API_KEY`, or `GEMINI_API_KEY` | None | The Gemini key. The unprefixed name is read only when the `XENON_` one isn't set, and the `geminiApiKey` option wins over both. `GEMINI_API_KEY=mock` is a test value: failure analysis then answers with a fixed sample text and calls no provider. |
| `XENON_OPENAI_API_KEY`, or `OPENAI_API_KEY` | None | The OpenAI key, or the key of another service that speaks the OpenAI API. Same order as above; the `openaiApiKey` option wins. |
| `XENON_ANTHROPIC_API_KEY`, or `ANTHROPIC_API_KEY` | None | The Anthropic key. Same order; the `anthropicApiKey` option wins. |
| `XENON_GEMINI_MODEL`, `XENON_OPENAI_MODEL`, `XENON_ANTHROPIC_MODEL`, `XENON_OLLAMA_MODEL` | The provider's default | The model for that provider. It wins over the `aiModel` option and `XENON_AI_MODEL`, and a model saved for that provider through `POST /xenon/api/config` wins over it. Ollama's default, `llama3`, can't read screenshots: choose a vision model such as `llava`. |
| `XENON_AI_MODEL` | The provider's default | The model for whichever provider is chosen, when that provider's own variable isn't set. The `aiModel` option wins, and an `aiModel` saved through `POST /xenon/api/config` wins over both. |
| `XENON_AI_BASE_URL` | For Ollama, `http://localhost:11434` | The address of an Ollama server, or of another service that speaks the OpenAI API. The `aiBaseUrl` option wins, and a base URL saved through `POST /xenon/api/config` wins over both. |

## Hub, nodes and other servers

| Variable | Default | What it does |
|---|---|---|
| `XENON_HUB_ACCESS_KEY`, `XENON_HUB_TOKEN` | None | An Admin's access key and token with the `devices` scope. On a node: those of the node's user on the hub. The node sends them with its phone reports and when it connects to the hub's live events. Set both: a hub with sign-in on refuses a node without them. See [Hub and nodes](./hub-and-nodes.md#give-each-node-a-user-and-a-token). On any server with sign-in on that takes lease requests, a single server or a hub, Xenon also uses them to reserve a leased phone's ports, and without them every lease answers `503` with `device_unhealthy`. See [Leases for CI](./leases.md#what-you-need). |
| `XENON_HTTP_TIMEOUT_MS` | `30000` (30 seconds) | How long Xenon waits for an answer to its calls to other Xenon servers, such as a node's phone reports and the hub's checks on its nodes. A call that sets its own time keeps it: a session create sent to a node waits 8 minutes. Commands the hub passes on to a node aren't limited by it. A value that isn't a positive number is ignored, with a warning. |
| `XENON_TLS_REJECT_UNAUTHORIZED` | On | `false`: stop checking HTTPS certificates on the calls between servers that the `tlsRejectUnauthorized` option doesn't cover, such as a hub asking a node for its status or its ports. For development against a self-signed certificate only. |
| `HTTP_PROXY`, `HTTPS_PROXY` | None | A proxy for Xenon's calls to other servers: a hub's to its nodes and to a cloud provider (session creates, test commands, device-control actions, the live preview and the live logs, recordings), a node's to its hub (phone reports, signing keys, live events), and others such as webhooks and Ollama. `HTTP_PROXY` is used for `http` addresses and `HTTPS_PROXY` for `https`; the lower-case `http_proxy` and `https_proxy` win when both spellings are set. The live preview's and the live logs' sockets go through the proxy in a CONNECT tunnel. When the proxy refuses one, as a stock Squid does for any port but 443, they go straight to the node, with a warning in the log, and a node's live events stay on long-polling through the proxy. The `proxy` option, when set, is used instead of these for the calls between Xenon servers and to a cloud provider; see [Configuration](./configuration.md). OpenTelemetry export and the calls to Gemini, OpenAI and Anthropic ignore all of these and go direct. |
| `NO_PROXY` | None | Hosts that go direct, whichever proxy would apply, the `proxy` option's included: a comma-separated list of `*` for every host, host names, and domains starting with a dot, such as `.lab.example` for every host under `lab.example`. An entry with a port matches nothing. The lower-case `no_proxy` wins when both spellings are set. If you set `HTTP_PROXY` or `HTTPS_PROXY`, list `localhost,127.0.0.1` here, so that Xenon's calls on its own machine don't go to the proxy. The `proxy` option already leaves them direct. |
| `CLOUD_USERNAME`, `CLOUD_KEY` | None | The account name and key for the cloud provider named in the `cloud` option. For pCloudy they are sent as the `appium:pCloudy_Username` and `appium:pCloudy_ApiKey` capabilities; for BrowserStack, Sauce Labs and LambdaTest they go in the provider's address as `https://<username>:<key>@<host>/wd/hub`. HeadSpin uses neither. |

## Security and sign-in

[Authentication](./authentication.md) and [Hardening](./hardening.md) explain when to use these.

| Variable | Default | What it does |
|---|---|---|
| `XENON_AUTH_DISABLED` | Off | `true`: turn sign-in off. Every caller is then a Super admin without signing in, and the team rule is off. Either this or the `authDisabled` option is enough. For local development only. |
| `XENON_REQUIRE_SESSION_TOKEN` | Off | `true`, `1`, `yes` or `on`: create a session only when it presents a valid access key and token, or a valid session token, of an Active user, in `xe:options`. Set it on the hub. See [Refuse sessions without credentials](./authentication.md#refuse-sessions-without-credentials). |
| `XENON_REQUIRE_COMMAND_AUTH` | Off | `true`, `1`, `yes` or `on`: every command to a session, the session's WebSockets and Appium's session list need the credentials of the session's owner or an admin. Ignored with sign-in off. If Xenon can't put its check in front of Appium's routes, the server refuses to start. Set it on the hub. See [Check every command](./authentication.md#check-every-command). |
| `XENON_ALLOWED_ORIGINS` | None | A comma-separated list of origins (`https://xenon.example.com`) or hosts (`xenon.example.com`) from which a browser may make changes with the dashboard's sign-in, besides the address the server was reached at. For a dashboard served at another address. See [Requests from a browser](./authentication.md#requests-from-a-browser). |
| `XENON_PUBLIC_URL` | None | The address people reach this server at: the scheme, host and port, such as `https://xenon.example.com` or `http://lab-mac:4723`. The dashboard's own address, ending in `/xenon/`, works too. Password reset links point here, never at the address a request came to, and so does the link the device list gives each phone to the appium-dashboard-plugin (`dashboard_link`) when that plugin runs on the server. Without it Xenon emails no reset links. A value with any other path, a query or a user name in it is ignored, with a warning at startup. See [A forgotten password](./authentication.md#a-forgotten-password). |
| `XENON_USER_SESSION_TTL_MS` | `86400000` (24 hours) | How long a dashboard sign-in lasts after its last request, in milliseconds. Each request renews it for that long, a time longer than a day included. |
| `XENON_LOGIN_RATE_LIMIT_ATTEMPTS` | `5` | How many sign-in attempts a client address may make in the window below. |
| `XENON_LOGIN_RATE_LIMIT_WINDOW_MS` | `300000` (5 minutes) | That window, in milliseconds. |
| `XENON_MCP_TOKEN_TTL_SEC` | `86400` (24 hours) | How long a bearer token with the audience `xenon-mcp`, and the session token that comes with it, last, in seconds. A token asked for with a credential that expires ends no later than that credential. |
| `XENON_IP_HASH_SECRET` | A built-in value, the same on every server | The secret mixed into the hash of a client's address that Xenon keeps with each sign-in and counts sign-in attempts by. Set a random value of your own. |
| `XENON_JWT_KEY_DIR` | `~/.cache/xenon` | The folder of `xenon-jwt-private.pem`, the key Xenon signs its tokens and tickets with. Xenon makes the key there on its first start. `DATABASE_URL` doesn't move it. |
| `XENON_JWT_ISSUER` | `xenon-hub` | The issuer Xenon writes into the tokens it signs and requires in the tokens it checks itself. Changing it stops the tokens and tickets this server issued before from working with it. |
| `XENON_BCRYPT_COST` | `12` | The bcrypt cost of password hashes. It exists for Xenon's own tests: a lower cost makes passwords faster to guess. |

## Email

These are for password-reset emails. [Notifications](./notifications.md#email-for-password-resets) shows how to set a mail server up.

| Variable | Default | What it does |
|---|---|---|
| `XENON_SMTP_URL` | None | The mail server, as a URL such as `smtps://user:password@smtp.example.com:465`. Links are emailed only when `XENON_PUBLIC_URL` is set too. Without both, nobody can email themselves a reset link, and an admin passes the link on instead. |
| `XENON_SMTP_FROM` | `noreply@xenon.local` | The sender's address. |
| `XENON_RESET_TOKEN_TTL_MS` | `3600000` (1 hour) | How long a reset link works, in milliseconds. The email says how long. |
| `XENON_RESET_RATE_LIMIT_ATTEMPTS` | `3` | How many reset requests a client address may make in the window below. |
| `XENON_RESET_RATE_LIMIT_WINDOW_MS` | `900000` (15 minutes) | That window, in milliseconds. |
| `XENON_PASSWORD_RESET_LOG_FALLBACK` | Off | `true`, with `XENON_PUBLIC_URL` set and no mail server: write the reset links asked for with `POST /xenon/api/auth/forgot-password` to the server log, where anyone who can read the log can use them. Leave it off. |

## Recordings and storage

| Variable | Default | What it does |
|---|---|---|
| `XENON_RECORDINGS_ASSETS_PATH` | `~/.cache/xenon/assets/sessions/recordings` | Where recordings made on the Live devices page are stored. The `recordingsAssetsPath` option wins, and a blank value counts as unset. |
| `XENON_MAX_CONCURRENT_RECORDINGS` | `4` | How many recordings may run at once on the server, across all users. It must be a whole number of at least 1; any other value is ignored, with a warning at startup. The `maxConcurrentRecordings` option, from 1 to 16, wins. See [Recordings](./recordings.md#limits-storage-and-cleanup). |

## Logging and telemetry

[Observability](./observability.md) explains what each of these produces. The OpenTelemetry variables apply on a hub or a standalone server: a node sends no telemetry.

| Variable | Default | What it does |
|---|---|---|
| `XENON_JSON_LOGGING` | Off | `true`: write Xenon's log lines as JSON. Used only when the `enableJsonLogging` option isn't set; the option, set to `true` or `false` in a config file, wins. |
| `XENON_EVENT_LOG` | On | `off`: don't keep a copy of the live events in the database's event log. See [The event log](./observability.md#the-event-log). |
| `XENON_EVENT_LOG_RETENTION_DAYS` | `30` | Events in the event log older than this many days are deleted, once a day. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | None | The full URL traces are sent to over OTLP/HTTP, such as `http://collector:4318/v1/traces`. Setting it turns tracing on. |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | None | The full URL log records are sent to, such as `http://collector:4318/v1/logs`. Setting it turns log export on. |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | None | The full URL metrics are sent to, such as `http://collector:4318/v1/metrics`. |
| `OTEL_TRACES_ENABLED`, `OTEL_LOGS_ENABLED`, `OTEL_METRICS_ENABLED` | On | `false`: don't send that kind of telemetry, even with its URL set. With tracing on, `OTEL_METRICS_ENABLED=false` doesn't stop metrics: see [When tracing is on](./observability.md#when-tracing-is-on). |
| `OTEL_SDK_DISABLED` | Off | `true`: no OpenTelemetry at all, whatever else is set. |
| `XENON_OTEL_DEBUG` | Off | `true`: also print every span to the server's output, for development. |

The OpenTelemetry SDK reads some standard `OTEL_*` variables of its own as well. [Observability](./observability.md#when-tracing-is-on) says which ones matter here.

## Related

- [Configuration](./configuration.md): the plugin options.
- [Hardening](./hardening.md): which of these to set on a server others can reach.
- [Production deployment](./deployment.md): running Xenon under a process manager.
