# Observability Stack

## Architecture

```
App (Pino JSON -> stdout) --> Docker json-file --> OTel Collector --> OpenObserve
App (OTel SDK)            --> OTLP gRPC (4317)  --> OTel Collector --> OpenObserve
Host metrics (CPU/mem/etc) -------------------- --> OTel Collector --> OpenObserve
Browser (web-vitals)      --> /api/rum --> Pino JSON --> OTel Collector --> OpenObserve
```

All services run as Docker containers on the same `kamal` network, managed by Kamal.

### Components

| Component | Container | Image | Purpose |
|-----------|-----------|-------|---------|
| App | `kosarica-web-*` | `kosarica/app` | Node.js app, emits Pino logs + OTel traces/metrics |
| OTel Collector | `kosarica-opentelemetry-collector` | `otel/opentelemetry-collector-contrib` | Receives, processes, exports telemetry |
| OpenObserve | `kosarica-openobserve` | `public.ecr.aws/zinclabs/openobserve` | Unified logs/metrics/traces UI |

### Data Flow

1. **Logs**: App writes structured Pino JSON to stdout -> Docker captures as json-file logs -> OTel Collector's `filelog/docker` receiver reads container log files -> Parses Docker JSON envelope -> Routes JSON logs through Pino parser (extracts fields, maps severity) -> Exports to OpenObserve via OTLP HTTP
2. **Metrics**: OTel Collector's `hostmetrics` receiver scrapes CPU/memory/disk/network every 60s -> Exports to OpenObserve
3. **Traces**: App's OTel SDK auto-instruments HTTP via `--import` (ESM hook + instrumentation.mjs) -> Sends via OTLP gRPC to collector -> Exports to OpenObserve via OTLP HTTP (JSON)
4. **RUM**: Browser's `web-vitals` library captures Core Web Vitals -> `sendBeacon(/api/rum)` -> Server logs as Pino JSON -> OTel Collector -> OpenObserve

## Access

### SSH Tunnel (recommended)

OpenObserve is internal-only. Access via SSH port forwarding:

```bash
ssh -L 5080:172.18.0.4:5080 root@kosarica.duckdns.org
```

Then open http://localhost:5080

> **Note**: The IP `172.18.0.4` is the OpenObserve container's Docker IP. If it changes after a restart, find the current IP:
> ```bash
> ssh root@kosarica.duckdns.org "docker inspect kosarica-openobserve --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'"
> ```

### Credentials

- **Email**: `admin@kosarica.local`
- **Password**: Stored in `.kamal/secrets` as `ZO_ROOT_USER_PASSWORD`
- **Org**: `default`

## Dashboards

### System Health

Server infrastructure monitoring:

- **CPU Load Average** (1m / 5m / 15m) - line chart
- **CPU Time by State** (user, system, idle, iowait) - stacked area
- **Memory Usage** - used over time + breakdown by state
- **Filesystem Usage** - used, free, reserved
- **Disk I/O** - read/write throughput and IOPS
- **Network I/O** - transmit/receive throughput
- **Network Errors & Dropped Packets**
- **Network Connections** by protocol

### Application Logs

Application-level monitoring:

- **Log Volume** over time + by severity
- **Error Logs** over time + by component (loggertype)
- **HTTP Request Latency** (p50 / p95 / p99)
- **HTTP Status Code Distribution** over time
- **Top Slowest Endpoints** and **Most Requested Endpoints**
- **5xx Errors** over time
- **Request Rate by Method**

### Real User Monitoring (RUM)

Browser-side performance metrics via Web Vitals:

- **Web Vitals Distribution** - rating breakdown (good / needs-improvement / poor) per metric
- **LCP Over Time** - Largest Contentful Paint (avg + p75)
- **INP Over Time** - Interaction to Next Paint (avg + p75)
- **CLS Over Time** - Cumulative Layout Shift (avg + p75)
- **TTFB Over Time** - Time to First Byte (avg + p75)
- **Web Vitals by Page** - per-page breakdown of all metrics

Data flows: Browser (`web-vitals` lib) -> `sendBeacon(/api/rum)` -> Server logs as Pino JSON (loggerType=`rum`) -> OTel Collector -> OpenObserve.

## OpenTelemetry Collector

### Config File

`deployment/otel-collector-config.yaml` - uploaded to the server on each deploy/reboot.

### Receivers

| Receiver | What it collects |
|----------|-----------------|
| `otlp` (gRPC:4317, HTTP:4318) | App traces + metrics from OTel SDK |
| `hostmetrics` (60s interval) | CPU, load, memory, disk, filesystem, network, processes |
| `filelog/docker` | All Docker container logs (`/var/lib/docker/containers/*/*-json.log`) |

### Log Parsing Pipeline

```
Docker JSON envelope (parse_docker)
    |
    v
Route by format (route_format)
    |                    |
    v                    v
JSON logs           Plain text logs
(parse_pino)        (set_text_body)
    |                    |
    v                    |
Map severity             |
(map_severity)           |
    |                    |
    v                    |
Set body to msg          |
(set_pino_body)          |
    |                    |
    v                    v
Tag source: docker (tag_source)
```

- **JSON path**: Extracts all Pino fields (level, msg, loggerType, service, etc.) into OTel attributes. Maps Pino numeric levels (30=info, 40=warn, 50=error) and uppercase strings (INFO, WARN, ERROR) to OTel severity.
- **Plain text path**: Uses raw log line as body (e.g., PostgreSQL, ClickHouse logs).

### Processors

| Processor | Purpose |
|-----------|---------|
| `memory_limiter` | Prevents OOM (512 MiB limit, 128 MiB spike) |
| `filter/drop_internal` | Drops noisy OpenObserve access logs and collector self-references |
| `resource` | Adds `environment: production`, `deployment.type: docker` |
| `batch` | Batches telemetry (5s timeout, 1024 batch size) |

### Exporters

All use OTLP HTTP to OpenObserve on port 5080 with Basic auth.

| Exporter | Stream | Signal |
|----------|--------|--------|
| `otlp_http/openobserve_logs` | `kosarica-logs` | Logs |
| `otlp_http/openobserve_metrics` | `kosarica-metrics` | Metrics |
| `otlp_http/openobserve_traces` | `kosarica-traces` | Traces |

## Log Fields Reference

### App Logs (Pino)

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| `body` | string | `"RPC request completed"` | Log message |
| `severity` | string | `"info"` | OTel severity (mapped from Pino level) |
| `level` | string/int | `"info"` or `30` | Original Pino level |
| `loggertype` | string | `"rpc"`, `"ingestion"` | App component |
| `service` | string | `"kosarica-nodejs"` | Service name |
| `method` | string | `"POST"` | HTTP method |
| `path` | string | `"/api/rpc/..."` | Request path |
| `status` | number | `200` | HTTP status code |
| `duration` | number | `5` | Request duration (ms) |
| `requestid` | string | `"req_abc..."` | Request correlation ID |
| `release` | string | `"282f20c"` | Git commit hash |

### Logger Types

`rpc`, `http`, `auth`, `db`, `app`, `ingestion`, `scheduler`, `daily-ingestion`, `temp-cleanup`, `matching`, `rum`

## Operations

### Reboot Collector (after config changes)

```bash
mise exec ruby@3.3 -- kamal accessory reboot opentelemetry-collector -c kamal.yml
```

This uploads the local `deployment/otel-collector-config.yaml` and restarts the container.

### View Collector Logs

```bash
ssh root@kosarica.duckdns.org "docker logs kosarica-opentelemetry-collector --since 5m"
```

### View Collector Health

```bash
ssh root@kosarica.duckdns.org "curl -s http://172.18.0.5:13133/health"
```

> The IP `172.18.0.5` is the collector container IP. Find current IP:
> ```bash
> ssh root@kosarica.duckdns.org "docker inspect kosarica-opentelemetry-collector --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'"
> ```

### Query Logs via API

```bash
ssh root@kosarica.duckdns.org "curl -s -u 'admin@kosarica.local:<password>' \
  'http://172.18.0.4:5080/api/default/_search?type=logs' \
  -H 'Content-Type: application/json' \
  -d '{\"query\":{\"sql\":\"SELECT * FROM kosarica_logs WHERE severity=\\\"error\\\" ORDER BY _timestamp DESC LIMIT 10\",\"from\":0,\"size\":10,\"start_time\":0,\"end_time\":0}}'"
```

### List Streams

```bash
ssh root@kosarica.duckdns.org "curl -s -u 'admin@kosarica.local:<password>' \
  http://172.18.0.4:5080/api/default/streams"
```

### List Dashboards

```bash
ssh root@kosarica.duckdns.org "curl -s -u 'admin@kosarica.local:<password>' \
  http://172.18.0.4:5080/api/default/dashboards"
```

## Troubleshooting

### No logs appearing

1. Check collector is running: `docker ps --filter name=kosarica-opentelemetry-collector`
2. Check collector logs for errors: `docker logs kosarica-opentelemetry-collector --since 5m 2>&1 | grep -i error`
3. Verify OpenObserve is reachable from collector: `docker exec kosarica-opentelemetry-collector curl -s http://kosarica-openobserve:5080/healthz`
4. Check `ZO_BASIC_AUTH` and `ZO_ORG_ID` env vars are set correctly

### Log fields not extracted

The filelog receiver parses Docker JSON -> routes JSON vs plain text -> parses Pino JSON. If fields aren't extracted:
1. Confirm the regex `"^\\{.*\\}\\s*$"` matches your log format (trailing newlines)
2. Check if new Pino fields need to be added (they're auto-extracted by the JSON parser)
3. Verify with `docker logs <app-container>` that the app outputs valid JSON

### No traces

Traces require the ESM loader hook to patch `http` module in ESM mode:

1. Verify `--import @opentelemetry/instrumentation/hook.mjs` is in the CMD (Dockerfile)
2. Verify `--import ./scripts/instrumentation.mjs` is after the hook
3. App outputs `[Telemetry] OpenTelemetry initialized for kosarica-nodejs` on startup
4. Collector OTLP gRPC receiver is listening on 4317
5. Trace exporter has `encoding: json` (required by OpenObserve)
6. Check from inside the app container: `node -e "require('net').createConnection(4317, 'kosarica-opentelemetry-collector', () => { console.log('OK'); process.exit(0); })"`

### Metrics reporting container filesystem (not host)

The hostmetrics receiver runs inside the collector container. It reports container-scoped metrics unless `root_path` is set. To get host metrics, mount the host root filesystem and configure:
```yaml
hostmetrics:
  root_path: /hostfs
```
And add volume mount in `kamal.yml`:
```yaml
volumes:
  - /:/hostfs:ro
```

## Environment Variables

### App (in kamal.yml env)

| Variable | Value | Purpose |
|----------|-------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `kosarica-opentelemetry-collector:4317` | Collector gRPC endpoint |
| `OTEL_SERVICE_NAME` | `kosarica-nodejs` | Service name in traces/metrics |

### Collector (in .kamal/secrets)

| Variable | Purpose |
|----------|---------|
| `ZO_BASIC_AUTH` | Base64-encoded `email:password` for OpenObserve API |
| `ZO_ORG_ID` | OpenObserve organization ID (`default`) |

### OpenObserve (in .kamal/secrets)

| Variable | Purpose |
|----------|---------|
| `ZO_ROOT_USER_EMAIL` | Admin login email |
| `ZO_ROOT_USER_PASSWORD` | Admin login password |

## Key Files

| File | Purpose |
|------|---------|
| `deployment/otel-collector-config.yaml` | OTel Collector configuration |
| `scripts/instrumentation.mjs` | OTel SDK bootstrap (loaded via `--import` before app) |
| `scripts/start-server.mjs` | HTTP server with cluster module (WEB_CONCURRENCY workers) |
| `src/telemetry.ts` | OTel config types and helpers |
| `src/lib/rum.ts` | Browser-side Web Vitals collection |
| `src/routes/api.$.ts` | Server-side RUM + client-error ingest endpoints |
| `src/utils/logger.ts` | Pino logger configuration |
| `kamal.yml` | Deployment config (accessories, env vars, volumes) |
