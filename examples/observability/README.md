# Local observability stack

A self-contained Grafana + Loki + Tempo stack for inspecting Xenon traces and
logs on your laptop. Intended for **development and demos only** — no auth, no
TLS, no persistence beyond the container lifetime, no retention tuning.

## Quick start

```bash
cd examples/observability
docker compose up -d
```

Wait ~20 seconds for Loki and Tempo to finish their schema bootstrap (poll
`http://localhost:3100/ready` and `http://localhost:3200/ready` for `200`
if you want to be precise), then start Xenon with the OTel endpoints set:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://localhost:3100/otlp/v1/logs
npm run dev
```

On boot Xenon should print:

```
[TracingService] Trace OTLP endpoint: http://localhost:4318/v1/traces.
[TracingService] Trace SDK started.
[TracingService] Log OTLP endpoint: http://localhost:3100/otlp/v1/logs. Log SDK started.
```

## Endpoint URL gotcha

The OTLP HTTP exporter posts to whichever URL you give it — it does **not**
append a signal-specific path. **Both** trace and log endpoints need the
full path:

| Backend                 | Logs endpoint                              | Traces endpoint                            |
|-------------------------|--------------------------------------------|--------------------------------------------|
| Loki 3.0+ (this stack)  | `http://<host>:3100/otlp/v1/logs`          | (use Tempo)                                |
| Tempo 2.3+ (this stack) | (use Loki)                                 | `http://<host>:4318/v1/traces`             |
| OpenTelemetry Collector | `http://<host>:4318/v1/logs`               | `http://<host>:4318/v1/traces`             |

Setting either endpoint to just the host (e.g. `http://localhost:3100` or
`http://localhost:4318`) silently drops every record — the receiver returns
404 on `/` but the batch exporter swallows the error.

## Open Grafana

http://localhost:3001 — anonymous admin access.

**Data sources are auto-provisioned** (`grafana/provisioning/datasources/`):
Loki at `http://loki:3100` and Tempo at `http://tempo:3200` are wired on
first start.

**Dashboards are auto-loaded** from `grafana/dashboards/` into a "Xenon"
folder:

- **Xenon — Sessions & Logs** (`xenon-sessions`) — log explorer with
  Trace ID / Session ID / text filter template variables, plus log
  volume by severity.
- **Xenon — Self-Healing** (`xenon-healing`) — tier funnel (rate by
  tier), success-vs-failure rate, p99 latency by tier, recent
  all-tiers-failed events table.
- **Xenon — Recording Health** (`xenon-recording`) — attempt rate,
  failure breakdown by `fail_reason`, group-size distribution, stop
  latency p99.

The healing and recording dashboards use **TraceQL metrics** queries
(Tempo 2.4+) that compute counters/rates/quantiles directly from spans.
No Prometheus required.

### Ad-hoc queries

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

In **Explore → Tempo**, this TraceQL query returns every healing
attempt:

```
{ name = "xenon.healing.attempt" }
```

Healings that fell all the way through:

```
{ name = "xenon.healing.attempt" && status = error }
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
- Not a Prometheus stack. Xenon's OTel metrics (counters and histograms
  from `xenon.healing.*`, `xenon.recording.*`) are emitted to whatever
  `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` points at — this stack does not
  receive them. The healing and recording dashboards use TraceQL metrics
  computed from spans instead, which works without any metrics pipeline.
  Adopters who want a full metrics pipeline can add an OTel Collector +
  Prometheus separately.
- Xenon's process metrics live at `GET /xenon/api/config/metrics`
  (Prometheus text format) and are unrelated to this OTLP pipeline.
