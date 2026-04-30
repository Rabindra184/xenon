# Local observability stack

A self-contained Grafana + Loki + Tempo stack for inspecting Xenon traces and
logs on your laptop. Intended for **development and demos only** — no auth, no
TLS, no persistence beyond the container lifetime, no retention tuning.

## Quick start

```bash
cd examples/observability
docker compose up -d
```

Wait ~10 seconds for Loki and Tempo to finish their schema bootstrap, then
start Xenon with the OTel endpoints set:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://localhost:3100/otlp/v1/logs
npm run dev
```

On boot Xenon should print:

```
[TracingService] Trace OTLP endpoint: http://localhost:4318.
[TracingService] Trace SDK started.
[TracingService] Log OTLP endpoint: http://localhost:3100/otlp/v1/logs. Log SDK started.
```

## Endpoint URL gotcha

The OTLP HTTP exporter posts to whichever URL you give it — it does **not**
append a signal-specific path. That means:

| Backend                | Logs endpoint                                    | Traces endpoint                          |
|------------------------|--------------------------------------------------|------------------------------------------|
| Loki 3.0+ (this stack) | `http://<host>:3100/otlp/v1/logs`                | (use Tempo)                              |
| Tempo 2.3+ (this stack)| (use Loki)                                       | `http://<host>:4318` *(Tempo accepts root)* |
| OpenTelemetry Collector| `http://<host>:4318/v1/logs`                     | `http://<host>:4318/v1/traces`           |

Setting `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://localhost:3100` (no path)
will silently drop every record — Loki returns 404 on `/` but the batch
exporter swallows the error.

## Open Grafana

http://localhost:3001 — anonymous admin access.

Add data sources:

- Loki — URL `http://loki:3100` (the in-network hostname, not localhost)
- Tempo — URL `http://tempo:3200`

In **Explore → Loki**, this LogQL query returns every Xenon log line:

```
{service_name="xenon"}
```

Filter by session:

```
{service_name="xenon"} | sessionId=`<paste-session-id-here>`
```

Filter to one role (hub vs. node):

```
{service_name="xenon", service="hub"}
```

## Cleanup

```bash
docker compose down -v
```

`-v` removes the anonymous volumes so the next run starts from an empty Loki
and Tempo. Drop it if you want logs to persist across restarts.

## What this stack is *not*

- Not production-ready. Single-node, in-memory Loki ring, filesystem chunks,
  no auth, no TLS, no replication, 24h retention.
- Not a Prometheus stack. Xenon's process metrics live at
  `GET /xenon/api/config/metrics` and are unrelated to this OTLP pipeline.
- Not a Grafana provisioning recipe. You add data sources and dashboards by
  hand. A pre-provisioned bundle may follow in a later iteration.
