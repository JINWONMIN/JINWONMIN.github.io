---
title: '[Prometheus & Grafana] Chapter 6. Installation'
date: 2026-04-11
description: Prometheus binary and Docker installation, first run with Web UI and expression browser walkthrough
tags:
  - Prometheus
  - Grafana
  - Monitoring
  - Observability
series: Prometheus & Grafana
seriesOrder: 6
---

> **Note**: This post is a summary based on the official Prometheus (v3.2.1) and Grafana documentation. For precise details, please refer to the official docs.
> - [Prometheus Official Docs](https://prometheus.io/docs/)
> - [Grafana Official Docs](https://grafana.com/docs/grafana/latest/)

***

Part 03, "Hands-On Setup," begins here. [Chapter 5. Jobs and Instances](/en/posts/prometheus-grafana-part02-ch05) wrapped up Part 02's coverage of the data model, metric types, and scraping structure. The theory is in place. Time to install and run Prometheus.

***

## 6.1 Binary Installation

Prometheus is written in Go and distributed as a single static binary. There are no external dependencies -- download, extract, and run.

### Download

Grab the appropriate binary for your OS and architecture from the official releases page (https://prometheus.io/download/).

```bash
# Linux amd64 example
wget https://github.com/prometheus/prometheus/releases/download/v3.2.1/prometheus-3.2.1.linux-amd64.tar.gz

# Extract
tar xvfz prometheus-3.2.1.linux-amd64.tar.gz
cd prometheus-3.2.1.linux-amd64
```

### Directory Structure

The extracted archive contains these files.

```plain
prometheus-3.2.1.linux-amd64/
├── prometheus          ← Prometheus server binary
├── promtool            ← Config validation and management tool
├── prometheus.yml      ← Default configuration file
├── consoles/           ← Console templates
├── console_libraries/  ← Console template libraries
├── LICENSE
└── NOTICE
```

Three items matter most: the `prometheus` binary, the `promtool` utility for config validation, and the default `prometheus.yml` config. The rest are console UI assets and license files.

### Running Prometheus

```bash
# Run with default config
./prometheus --config.file=prometheus.yml

# With common flags
./prometheus \
  --config.file=prometheus.yml \
  --storage.tsdb.path=/var/lib/prometheus/data \
  --storage.tsdb.retention.time=30d \
  --web.listen-address=:9090 \
  --web.enable-lifecycle
```

### Key Command-Line Flags

| Flag | Default | Description |
| --- | --- | --- |
| `--config.file` | `prometheus.yml` | Path to configuration file |
| `--storage.tsdb.path` | `data/` | TSDB data storage directory |
| `--storage.tsdb.retention.time` | `15d` | Data retention period |
| `--storage.tsdb.retention.size` | `0` (unlimited) | Maximum storage size |
| `--web.listen-address` | `:9090` | Web UI and API listen address |
| `--web.enable-lifecycle` | `false` | Enable config reload via HTTP |
| `--web.enable-remote-write-receiver` | `false` | Enable remote write receiver |

When both `--storage.tsdb.retention.time` and `--storage.tsdb.retention.size` are set, **whichever limit is reached first** triggers data deletion. The default retention is 15 days, which may need adjustment for production.

### systemd Service Registration

For production deployments, managing Prometheus through systemd is standard practice.

```ini
# /etc/systemd/system/prometheus.service
[Unit]
Description=Prometheus Monitoring
Wants=network-online.target
After=network-online.target

[Service]
User=prometheus
Group=prometheus
Type=simple
ExecStart=/usr/local/bin/prometheus \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path=/var/lib/prometheus/data \
  --storage.tsdb.retention.time=30d \
  --web.listen-address=:9090 \
  --web.enable-lifecycle
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

```bash
# Register and start the service
sudo systemctl daemon-reload
sudo systemctl enable prometheus
sudo systemctl start prometheus
sudo systemctl status prometheus
```

The `ExecReload` directive sends SIGHUP to reload the config file via `systemctl reload prometheus`. With `--web.enable-lifecycle` enabled, `curl -X POST http://localhost:9090/-/reload` achieves the same result.

***

## 6.2 Docker Installation

Docker eliminates the need to manage binaries directly.

### Basic Run

```bash
docker run -d \
  --name prometheus \
  -p 9090:9090 \
  prom/prometheus
```

One command and Prometheus is running with default settings. Sufficient for testing.

### Custom Config with Volume Mount

Production use requires mounting a custom config file and a persistent data volume.

```bash
docker run -d \
  --name prometheus \
  -p 9090:9090 \
  -v /path/to/prometheus.yml:/etc/prometheus/prometheus.yml \
  -v prometheus-data:/prometheus \
  prom/prometheus \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.retention.time=30d
```

### docker-compose

For multi-service setups, docker-compose keeps things organized.

```yaml
# docker-compose.yml
version: '3.8'

services:
  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - ./rules:/etc/prometheus/rules
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=30d'
      - '--web.enable-lifecycle'
    restart: unless-stopped

volumes:
  prometheus-data:
```

There is no functional difference between binary and Docker installations. Docker fits naturally into container-based infrastructure; binary + systemd is simpler when containers are not already in use.

***

## 6.3 First Run and Status Pages

After starting Prometheus, open `http://localhost:9090` in a browser to access the web UI.

### Status > Targets

The `http://localhost:9090/targets` page shows the current state of all scrape targets. With default settings, only Prometheus itself appears.

| Column | Description |
| --- | --- |
| Endpoint | Scrape target URL |
| State | UP (healthy) or DOWN (failed) |
| Labels | Labels applied to the target |
| Last Scrape | Timestamp of the last scrape |
| Scrape Duration | Time taken for the scrape |
| Error | Error message (when failed) |

If State shows **UP**, everything is working. If DOWN, the Error column provides the cause.

### Status > Configuration

The `http://localhost:9090/config` page displays the currently loaded configuration. Useful for verifying that config changes have been applied correctly.

### Status > Runtime & Build Information

Prometheus version, Go version, build metadata, and storage details are all accessible here. This information is essential for debugging and issue reports.

***

## 6.4 Expression Browser

The built-in query interface is available at `http://localhost:9090/query` (or the Graph tab on the main page). It supports direct PromQL execution.

### Table Tab

Displays Instant Query results in tabular form.

```promql
# Query Prometheus's own HTTP request counts
prometheus_http_requests_total
```

Result:

```plain
prometheus_http_requests_total{code="200", handler="/api/v1/query", ...}    142
prometheus_http_requests_total{code="200", handler="/metrics", ...}          89
prometheus_http_requests_total{code="200", handler="/targets", ...}          12
```

Each unique label combination appears as a separate time series.

### Graph Tab

Renders Range Query results as a time-series graph. The time range is adjustable.

```promql
# Request rate over the last hour (5-minute window)
rate(prometheus_http_requests_total[5m])
```

The Table tab shows a point-in-time snapshot. The Graph tab shows trends over time.

### Useful First Queries

Prometheus scrapes itself by default. These queries work immediately without any additional configuration.

| Query | Description |
| --- | --- |
| `up` | Health status of all targets |
| `process_resident_memory_bytes` | Prometheus memory usage |
| `prometheus_tsdb_head_series` | Number of stored time series |
| `scrape_duration_seconds` | Scrape duration |
| `prometheus_target_interval_length_seconds` | Whether configured scrape intervals are being met |

```promql
# 1. Health status of all targets
up

# 2. Prometheus memory usage
process_resident_memory_bytes

# 3. Number of stored time series
prometheus_tsdb_head_series

# 4. Scrape duration distribution
scrape_duration_seconds

# 5. Actual vs configured scrape intervals
prometheus_target_interval_length_seconds
```

### Querying with promtool

Queries can also be executed from the command line without the web UI.

```bash
# instant query
./promtool query instant http://localhost:9090 'up'

# range query
./promtool query range http://localhost:9090 'rate(prometheus_http_requests_total[5m])' \
  --start='2026-03-26T00:00:00Z' \
  --end='2026-03-26T01:00:00Z' \
  --step=15s
```

`promtool query instant` returns the current value; `promtool query range` returns values across a specified time window. Both are useful in CI/CD pipelines and automation scripts.

***

## Summary

| Topic | Details |
| --- | --- |
| Binary install | Single Go binary, no dependencies, systemd registration recommended |
| Docker install | `prom/prometheus` image, mount config file and data volume |
| Web UI | `localhost:9090`, check Targets / Configuration / Runtime status |
| Expression browser | Table (Instant Query) / Graph (Range Query) |
| promtool | CLI-based querying, supports instant and range modes |

Once Prometheus is running and the `up` query returns `1` in the web UI, installation is complete. The next chapter, [Chapter 7. Configuration File (prometheus.yml)](/en/posts/prometheus-grafana-part03-ch07), covers the structure of `prometheus.yml` and scrape configuration.
