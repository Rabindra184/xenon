---
title: Observability
description: Traces, logs and metrics from Xenon over OpenTelemetry, JSON logs, the Prometheus metrics route, the event log, and a local Grafana, Tempo and Loki stack to try them.
---

Xenon can send traces, logs and metrics over OpenTelemetry, write its log as JSON for a log system, serve metrics in Prometheus format, and keeps a copy of its live events in its database. This page explains how to turn each on, what Xenon sends, and how to try it all with the Grafana stack in the repository.

## Where it runs

OpenTelemetry runs on a hub or a standalone server, any server started without the `hub` option. A node sends no traces, logs or metrics over OpenTelemetry. The commands and heals of a session on a node's phone run on the node, so they don't appear in the hub's traces either.

JSON logs, the Prometheus route and the event log work on every server.

## Turn on OpenTelemetry

Set the URLs in the environment of the process that runs Appium, then start it:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://collector.internal:4318/v1/traces
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://collector.internal:4318/v1/logs
export OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://collector.internal:4318/v1/metrics

appium server --use-plugins=xenon
```

- **Give each URL in full, path included.** Xenon hands each URL to its exporter as it is and adds no path, so `http://collector.internal:4318` on its own delivers nothing.
- **Xenon sends over OTLP/HTTP.** Point it at an OpenTelemetry Collector, or at a backend that takes OTLP over HTTP, such as Tempo for traces or Loki 3 for logs (`http://<loki>:3100/otlp/v1/logs`).
- **Each kind is on when its URL is set.** `OTEL_TRACES_ENABLED`, `OTEL_LOGS_ENABLED` or `OTEL_METRICS_ENABLED` set to `false` turns one off with its URL still set, and `OTEL_SDK_DISABLED=true` turns all of it off.
- **The log at startup says what is on:**

  ```
  [TracingService] Trace OTLP endpoint: http://collector.internal:4318/v1/traces.
  [TracingService] Trace SDK started.
  [TracingService] Log OTLP endpoint: http://collector.internal:4318/v1/logs. Log SDK started.
  [TracingService] Metric OTLP endpoint: http://collector.internal:4318/v1/metrics. Metrics SDK started.
  ```

- **`XENON_OTEL_DEBUG=true`** also prints every span to the server's output, for development.

[Environment variables](./environment-variables.md#logging-and-telemetry) lists the variables with their defaults.

### When tracing is on

With tracing on, through a trace URL or `XENON_OTEL_DEBUG`, the OpenTelemetry SDK also sets up log and metric export from the standard OpenTelemetry variables, and Xenon's log records and metrics go through it:

- **Logs** still go to `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`, and only when it is set.
- **Metrics** go to `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`. Without it they go to the trace URL with `/v1/metrics` added, such as `http://collector.internal:4318/v1/traces/v1/metrics`, which no collector serves, or to `http://localhost:4318/v1/metrics` when only `XENON_OTEL_DEBUG` is set.
- **`OTEL_METRICS_ENABLED=false` doesn't stop them.** To send no metrics, set `OTEL_METRICS_EXPORTER=none`.

## Traces

A trace is made for each session on the server's own phones, and each heal and recording gets a trace of its own. Every span has the resource attributes `service.name` = `xenon` and `service` = `hub`.

| Span | Made for | Attributes |
|---|---|---|
| The command's name, such as `findElement` or `click` | Each command of a session, except `getScreenshot`, `startRecordingScreen` and `stopRecordingScreen` | `xenon.session_id`, `xenon.command`, and `xenon.command.args`: the command's arguments as JSON, text a test types included |
| `Session: <name>`, with the session's name or its id | The session, as the parent of its commands | `xenon.session_id`, `xenon.build_name`, `xenon.platform`, `xenon.udid` |
| `xenon.healing.attempt` | A heal, from the first tier to the last | `xenon.session_id`, `xenon.healing.original_strategy`, `xenon.healing.duration_ms` once the tiers have run, healed or not, and when it heals: `xenon.healing.tier`, `xenon.healing.confidence`, `xenon.healing.result_strategy` |
| `xenon.recording.start` | Starting a recording | `xenon.recording.device_count`, `xenon.recording.group_id`, `xenon.recording.composite_enabled`, and `xenon.recording.fail_reason` when it fails |
| `xenon.recording.add_device` | Adding a phone to a running recording | `xenon.recording.group_id`, and `xenon.recording.fail_reason` when it fails |
| `xenon.recording.stop` | Stopping a recording | `xenon.recording.group_id` |

- **Command spans end with status OK** whether the command worked or not. To find failures, use the session's page, or the logs of the same trace.
- **The session span is sent only when Appium ends the session itself,** at its new-command timeout or when the driver stops unexpectedly, and only on a server with the dashboard on. It then has status error and `xenon.session.stop_reason`. For a session the test ends, it is never sent, so a trace viewer shows the session's commands with their parent missing.
- **A heal's span** records each tier as an event, `tier_started`, `tier_succeeded`, `tier_failed` or `tier_skipped_remaining`, and ends with status error and an `all_tiers_failed` event when no tier found the element. When Xenon can't read the page source and screenshot to start with, it ends at once with status error and a `context_collection_failed` event. The selector itself is left off the span.
- **The trace id is kept with the session.** With the dashboard on, each session's trace id, and each command's span id, are saved with the session and its commands, and the [`session_command`](./real-time-events.md#sessions) event carries both. Log lines written while a command runs carry them too.

## Logs

### JSON logs

Turn on the `enableJsonLogging` option, or set `XENON_JSON_LOGGING=true`. The option wins when it is set, to `true` or `false` in a config file. With neither, Xenon writes plain text.

With it on, Xenon writes each message as one JSON object. Appium writes the line, so the object comes after Appium's prefix for Xenon, `[xenon]`. While Xenon handles a request about a session (a test command, or a dashboard call whose address names the session), the session's own prefix comes first, with no space between the two:

```
[5b1f0c9e][xenon] {"timestamp":"2026-10-04T09:12:44.512Z","level":"info","scope":"[HealingOrchestrator]","message":"Attempting Tier 2: Fuzzy XML Provider...","sessionId":"5b1f0c9e-7d2a-4f4e-9a51-3c6d8e2b7a10","commandName":"findElement"}
```

- `timestamp`, `level`, `scope` (the part of Xenon that wrote it) and `message` are always there.
- `sessionId`, `udid`, `requestId`, `commandName`, `traceId` and `spanId` are added when the line belongs to a session, an API request or a command, and `args` when the message has more values.
- Xenon masks secrets in its lines either way. Appium's own lines keep their usual format: [Keep secrets out of Appium's log](./authentication.md#keep-secrets-out-of-appiums-log) shows how to mask those.

What Appium adds around the object depends on how it writes its log:

- **In a file from `--log`,** each line starts with Appium's timestamp: `2026-10-04 09:12:44:512 [xenon] {...}`.
- **On the console,** Appium colours the prefix unless it is started with `--log-no-colors`, so a log shipper that reads Appium's output should have that set.
- **With `--log-format json`,** Appium writes a JSON object of its own for each line, and Xenon's line, prefix included, is the text of its `message` field.
- **Appium writes every Xenon JSON line at its `info` level,** errors included. Read the level from Xenon's own `level` field, and don't start Appium with `--log-level warn` or `error`, which hides all of them.

So a log shipper should take the text from the first `{` after `[xenon]` and parse that as JSON, after first parsing Appium's object when `--log-format json` is set.

`requestId` comes from the `X-Request-Id` header: every answer under `/xenon/api` carries one, and a request that sends its own keeps it. Quote it when you look for one request in the log.

### Logs over OpenTelemetry

With `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` set, every message Xenon logs is also sent as a log record, debug messages included, whether JSON logging is on or not. Appium's own lines aren't sent.

- The record's body is the message, and its severity the level.
- Its attributes are `scope` and `log_level`, and `sessionId`, `udid`, `requestId`, `commandName`, `traceId`, `spanId` and `args` when they apply.

## Metrics

### OpenTelemetry metrics

With metrics on, Xenon sends these every 60 seconds:

| Metric | Kind | Labels | What it counts |
|---|---|---|---|
| `xenon.healing.attempts` | Counter | `tier` | Tiers tried |
| `xenon.healing.successes` | Counter | `tier` | Tiers that found the element |
| `xenon.healing.failures` | Counter | `tier` | Tiers that didn't |
| `xenon.healing.all_tiers_failed` | Counter | | Heals where no tier found the element |
| `xenon.healing.tier_skipped` | Counter | `tier` | Times a tier stopped the tiers after it from running |
| `xenon.healing.duration_ms` | Histogram | `tier`, `outcome` | Time each tier took, in milliseconds |
| `xenon.recording.attempts` | Counter | | Recordings started, and phones added to one |
| `xenon.recording.failures` | Counter | `fail_reason` | Recordings that failed |
| `xenon.recording.composite_failures` | Counter | | Side-by-side videos that failed; the phones' own recordings carry on |
| `xenon.recording.duration_ms` | Histogram | `outcome` | Length of each recording when it stops, in milliseconds |
| `xenon.recording.device_count` | Histogram | | Phones in each recording when it starts |

`tier` is the tier's name, such as `Fuzzy XML Provider`, and `outcome` is `success` or `failure`.

### Prometheus

`GET /xenon/api/metrics` answers in Prometheus' text format. It needs a sign-in, as the rest of the API does, but no particular role, so don't expose it beyond the people who may see the lab's figures:

```bash
curl -s http://localhost:4723/xenon/api/metrics \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN"
```

A scraper has to send credentials the same way, or a bearer token. The route serves:

- **Sessions:** `xenon_sessions_total` with `status` `started`, `success` or `failure`, and `xenon_sessions_active`.
- **Phones:** `xenon_devices_total`, `xenon_devices_busy` and `xenon_devices_offline`.
- **Healing:** `xenon_healing_total` with `status` `attempt` or `success`, and per tier `xenon_heal_tier_attempts_total`, `xenon_heal_tier_successes_total`, `xenon_heal_tier_failures_total` and `xenon_heal_tier_duration_seconds_sum`, with `tier` and `name` labels. Then `xenon_heal_all_tiers_failed_total` and `xenon_heal_tier_skipped_remaining_total`.
- **The process:** `xenon_process_memory_bytes` with `type` (`rss`, `heap_used`, `heap_total`, `external`, `array_buffers`), `xenon_process_event_loop_lag_ms`, `xenon_process_event_loop_lag_max_ms`, `xenon_session_commands_processed_total` and `xenon_session_command_duration_ms_sum`.
- **Other:** `xenon_device_reconciler_orphans_freed_total`, phones a session left busy that Xenon freed, and `xenon_circuit_breaker_state` (0 closed, 1 half open, 2 open) and `xenon_circuit_breaker_consecutive_failures`, with a `key` label.

`xenon_sessions_total` and `xenon_healing_total` are kept in the database and count the sessions the server records, with the dashboard on. The per-tier figures and the process figures are kept in memory and start again from zero when the server restarts.

## The event log

Every event a server sends to dashboards, as listed on [Real-time events](./real-time-events.md), is also written to the `EventLog` table of its database, with its type, its payload as JSON and the time it happened. So are the audit records MCP tooling posts to `POST /xenon/api/audit/events`. A node writes the events it raises into its own database.

- **Nothing in the dashboard or the API reads it.** Query the database, for example on the default SQLite file:

  ```bash
  sqlite3 ~/.cache/xenon/xenon.db \
    "SELECT datetime(occurredAt / 1000, 'unixepoch'), type FROM EventLog ORDER BY occurredAt DESC LIMIT 20;"
  ```

- **It holds what the events hold,** with two exceptions that keep a session's own data with the session. A `session_command` row is the event's summary: which command ran in which session, how it went and how it healed, never what it typed or answered. A captured network request gets no row; only the start and end of a capture do. Deleting a session or its build doesn't touch the event log.
- **Retention.** Once a day, events older than `XENON_EVENT_LOG_RETENTION_DAYS` days (30 by default) are deleted.
- **To stop writing it,** set `XENON_EVENT_LOG=off`. Live events still reach the dashboards.

## Try it with Grafana, Tempo and Loki

The repository's `examples/observability` folder holds a Docker Compose stack for trying traces and logs on one machine: Tempo 2.6 for traces, Loki 3.0 for logs, and Grafana 10 with both wired in and three dashboards. It isn't in the npm package, so clone the repository:

```bash
git clone https://github.com/Rabindra184/xenon.git
cd xenon/examples/observability
docker compose up -d
```

Loki and Tempo take about 20 seconds to get ready: `http://localhost:3100/ready` and `http://localhost:3200/ready` answer `200` when they are. Then start Xenon with these:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://localhost:3100/otlp/v1/logs
export OTEL_METRICS_EXPORTER=none   # the stack takes no metrics

appium server --use-plugins=xenon
```

Run a test, then open Grafana at `http://localhost:3001`, where anyone is let in as an admin. The **Xenon** folder has three dashboards:

- **Xenon — Sessions & Logs:** Xenon's log, filtered by session id, trace id or text, and the number of lines by severity.
- **Xenon — Self-Healing:** heals by tier, successes against failures, how long each tier takes (99th percentile), and the heals where every tier failed.
- **Xenon — Recording Health:** recordings started, failures by reason, phones per recording, and how long stopping takes (99th percentile).

The healing and recording dashboards compute their figures from the spans, with Tempo's TraceQL metrics, so they need no metrics pipeline. In **Explore**, `{service_name="xenon"}` on Loki returns Xenon's log, and `{ name = "xenon.healing.attempt" }` on Tempo every heal.

The stack is for trying things out: it has no sign-in and no TLS. `docker compose down -v` removes it with its data.

## Related

- [Environment variables](./environment-variables.md#logging-and-telemetry): the variables on this page.
- [Production deployment](./deployment.md#logs): where Appium writes its log, and rotating it.
- [Real-time events](./real-time-events.md): the events the event log keeps.
