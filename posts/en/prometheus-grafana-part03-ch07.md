---
title: '[Prometheus & Grafana] Chapter 7. Configuration File (prometheus.yml)'
date: 2026-06-05
description: Anatomy of prometheus.yml -- scrape_configs, relabeling, and zero-downtime config reloads
tags:
  - Prometheus
  - Grafana
  - Monitoring
  - Observability
series: Prometheus & Grafana
seriesOrder: 7
---

> **Note**: This post is a summary based on the official Prometheus (v3.2.1) and Grafana documentation. For precise details, please refer to the official docs.
> - [Prometheus Official Docs](https://prometheus.io/docs/)
> - [Grafana Official Docs](https://grafana.com/docs/grafana/latest/)

***

In [Chapter 6. Installation](/en/posts/prometheus-grafana-part03-ch06), Prometheus was installed and the `up` query returned `1`. At that point, Prometheus was scraping nothing but itself -- exactly as the default config file instructed. What to collect, how often, and through which path are all dictated by `prometheus.yml`. This chapter dissects that single YAML file.

***

## 7.1 Top-Level Structure

The top level of `prometheus.yml` is divided into a handful of purpose-built sections. Each one governs a distinct axis of Prometheus's behavior.

```yaml
global:          # Defaults applied to every job
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    cluster: 'production'

rule_files:      # Paths to Recording/Alerting Rule files
  - '/etc/prometheus/rules/*.yml'

scrape_configs:  # What to scrape and how (the core)
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

alerting:        # Alertmanager to send alerts to
  alertmanagers:
    - static_configs:
        - targets: ['localhost:9093']

remote_write:    # Write to remote storage
  - url: 'http://remote-storage:9201/write'

remote_read:     # Read from remote storage
  - url: 'http://remote-storage:9201/read'
```

In practice, the two sections touched daily are `global` and `scrape_configs`. The rest get added when alerting, long-term retention, or federation become necessary. The sections below walk through each in order.

***

## 7.2 global: Default Values

The `global` section defines the defaults that apply when an individual job does not specify its own. Re-declaring the same key at the job level overrides the global value.

```yaml
global:
  scrape_interval: 15s      # Scrape frequency (default 1m)
  scrape_timeout: 10s       # Scrape timeout (default 10s)
  evaluation_interval: 15s  # Rule evaluation frequency (default 1m)
  external_labels:
    monitor: 'production-monitor'
    region: 'ap-northeast-2'
```

### scrape_interval vs evaluation_interval

The names look alike, but the two serve different roles: one sets how often data is pulled, the other how often rules are computed.

| Setting | Role | Impact |
| --- | --- | --- |
| `scrape_interval` | How often metrics are pulled from targets | Shorter = higher resolution, higher load |
| `evaluation_interval` | How often Recording/Alerting Rules are evaluated | Affects alert detection latency |

Recommended values depend on the environment. General infrastructure monitoring sits well at `15s ~ 30s`, while detailed application monitoring fits `5s ~ 15s`. Keep `evaluation_interval` equal to or a multiple of `scrape_interval` -- evaluating more often than scraping just re-runs rules against unchanged data.

### external_labels

`external_labels` act as a provenance tag attached to time series leaving the server. They are automatically appended to data sent via federation or to Alertmanager, letting you tell which Prometheus a series came from when running several servers.

```yaml
external_labels:
  cluster: 'production'
  region: 'ap-northeast-2'
  environment: 'prod'
```

One caveat matters here. **`external_labels` are not added to the local TSDB.** They apply only on outbound transmission, so they will not appear in local queries.

***

## 7.3 scrape_configs: Scrape Configuration

`scrape_configs` is the heart of prometheus.yml. Which targets to scrape, over which path, how often, and with what authentication -- it is all defined here.

### Basic Structure

```yaml
scrape_configs:
  - job_name: 'my-service'      # Required. Attached as the job label
    scrape_interval: 10s        # Overrides global
    metrics_path: '/metrics'    # Default /metrics
    scheme: 'https'             # Default http
    static_configs:
      - targets:
          - 'server1:9100'
          - 'server2:9100'
        labels:
          env: 'production'
          team: 'backend'
```

`job_name` must be unique across the entire file and is automatically added as a `job` label to every collected metric.

### metrics_path and scheme

Most exporters serve `/metrics`, but plenty do not. Spring Boot Actuator uses `/actuator/prometheus`, and federation uses `/federate`.

```yaml
metrics_path: '/actuator/prometheus'   # Spring Boot Actuator
```

Setting `scheme` to `https` switches to TLS, which requires a matching `tls_config` pointing at the certificates.

```yaml
scheme: 'https'
tls_config:
  ca_file: '/etc/prometheus/ca.crt'
  cert_file: '/etc/prometheus/client.crt'
  key_file: '/etc/prometheus/client.key'
```

### Authentication

When a target demands authentication, configure Basic Auth or a Bearer Token. Tokens can be read from a file, which keeps secrets out of the config file itself.

```yaml
scrape_configs:
  - job_name: 'authenticated-service'
    basic_auth:
      username: 'prometheus'
      password: 'secret'
    # Or a Bearer Token from a file
    authorization:
      type: 'Bearer'
      credentials_file: '/etc/prometheus/token'
```

***

## 7.4 honor_labels and honor_timestamps

These two options sit untouched until the moment you attach federation or a Pushgateway -- then they become unavoidable. They settle the question of who owns the labels and timestamps of a scraped metric.

### honor_labels

When a scraped metric already carries `job` or `instance` labels, they collide with the same-named labels Prometheus wants to attach. `honor_labels` decides which side wins.

| honor_labels | Behavior on conflict |
| --- | --- |
| `false` (default) | Original labels are pushed to `exported_<name>`; Prometheus labels are used |
| `true` | Original labels are kept as-is; Prometheus labels are ignored |

The decision rule is simple. Use `true` when the source's labels must be preserved, and `false` when Prometheus needs to identify the target precisely. Federation and Pushgateway use `true`; ordinary exporter scraping keeps the default `false`.

### honor_timestamps

This decides whether to trust a timestamp embedded in the scraped metric. The default `true` uses the metric's own timestamp; `false` overwrites it with the scrape time. Keep the default unless you have a specific reason not to.

***

## 7.5 relabel_configs and metric_relabel_configs

Relabeling is the most powerful -- and most confusing -- feature in Prometheus. It adds, rewrites, and drops labels dynamically, and can even decide whether a target gets scraped at all. There are two similarly named variants, and the decisive difference is **when** they apply.

| | relabel_configs | metric_relabel_configs |
| --- | --- | --- |
| Timing | **Before** scraping | **After** scraping |
| Subject | Target labels (service discovery output) | Labels of collected metrics |
| Purpose | Filter targets, transform labels | Drop unwanted metrics, clean up labels |

Put in one sentence: `relabel_configs` decides "whether and where to scrape this target," while `metric_relabel_configs` decides "which of the already-scraped metrics to keep."

### relabel_configs: Before Scraping

It massages the `__meta_*` labels produced by service discovery to filter targets or promote them into real labels. This is especially common in Kubernetes.

```yaml
relabel_configs:
  # Scrape only pods with the prometheus.io/scrape=true annotation
  - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
    action: keep
    regex: true
  # Promote the pod name into a pod label
  - source_labels: [__meta_kubernetes_pod_name]
    action: replace
    target_label: pod
```

### metric_relabel_configs: After Scraping

It selects which of the already-collected metrics to store. Use it to discard cardinality-exploding metrics or drop noisy `go_*` internals to save storage.

```yaml
metric_relabel_configs:
  # Keep only the core node_ metrics
  - source_labels: [__name__]
    regex: 'node_cpu.*|node_memory.*|node_disk.*|node_network.*'
    action: keep
  # Drop go_ runtime metrics
  - source_labels: [__name__]
    regex: 'go_.*'
    action: drop
```

### Common action Types

The `action` key determines what a relabeling rule does. The seven most-used actions are below.

| Action | Description |
| --- | --- |
| `keep` | Keep only targets/metrics matching the regex |
| `drop` | Remove targets/metrics matching the regex |
| `replace` | Replace a label value (default action) |
| `labelmap` | Map matching label names to new names |
| `labeldrop` | Delete labels matching the regex |
| `labelkeep` | Keep only labels matching the regex |
| `hashmod` | Assign a value via hashing (used for sharding) |

***

## 7.6 rule_files: Loading Rule Files

`rule_files` is a list of paths to files holding Recording Rules and Alerting Rules. It supports glob patterns, so an entire directory can be loaded at once.

```yaml
rule_files:
  - '/etc/prometheus/rules/recording_rules.yml'
  - '/etc/prometheus/rules/*.yml'   # glob pattern
```

How to write the rule files themselves is covered in Chapter 13-14. For now, the point is that pointing at a path is enough -- Prometheus loads them automatically.

***

## 7.7 alerting: Alertmanager Integration

The `alerting` section defines where firing alerts go. Prometheus never sends alerts directly; it merely hands them off to Alertmanager.

```yaml
alerting:
  alert_relabel_configs:
    - source_labels: [severity]
      regex: 'info'
      action: drop          # Do not forward severity=info alerts
  alertmanagers:
    - static_configs:
        - targets:
            - 'alertmanager1:9093'
            - 'alertmanager2:9093'
      timeout: 10s
```

`alert_relabel_configs` applies relabeling to alerts just before dispatch -- commonly used to filter out `severity=info` alerts, as above.

Listing multiple Alertmanager instances provides high availability. Prometheus sends each alert to **all** instances, and the Alertmanager cluster deduplicates them on its own. As a result, no alert is dropped even if one instance dies.

***

## 7.8 remote_write / remote_read

A local TSDB alone struggles with long-term retention and a unified view across servers. `remote_write` and `remote_read` are the conduits linking Prometheus to remote storage like Thanos or Mimir.

### remote_write

It pushes locally stored data to remote storage. Because the volume is high, throughput is tuned with queue settings, and `write_relabel_configs` typically filters out expensive metrics in advance.

```yaml
remote_write:
  - url: 'http://thanos-receive:19291/api/v1/receive'
    queue_config:
      max_samples_per_send: 5000
      max_shards: 200
    write_relabel_configs:
      - source_labels: [__name__]
        regex: 'expensive_metric.*'
        action: drop
```

### remote_read

It reads data from remote storage and transparently merges it with local data when serving PromQL queries. Setting `read_recent: false` reads recent data from local and only older data from remote, reducing load.

```yaml
remote_read:
  - url: 'http://thanos-query:9090/api/v1/read'
    read_recent: false
```

***

## 7.9 Reloading the Configuration

Changing the config does not require restarting Prometheus. A restart creates a collection gap and severs in-flight queries. There are two zero-downtime reload methods, and validation should always come first.

| Method | Command | Prerequisite |
| --- | --- | --- |
| SIGHUP signal | `kill -HUP $(pidof prometheus)` or `systemctl reload prometheus` | None |
| HTTP API | `curl -X POST http://localhost:9090/-/reload` | `--web.enable-lifecycle` enabled |
| Pre-validation | `promtool check config prometheus.yml` | (always recommended before reload) |

### Validate Before Reloading

Before reloading, verify the syntax with `promtool check config`. It is the last line of defense before throwing a broken config at a running server.

```bash
./promtool check config prometheus.yml
```

```plain
Checking prometheus.yml
 SUCCESS: prometheus.yml is valid prometheus config file syntax
```

If the config file contains an error, **the reload is rejected and the existing config stays in effect.** A reload succeeds only when every rule file referenced in `rule_files` is valid too. So pushing a bad config will not crash a running Prometheus -- but you must check the logs to confirm whether the change actually took effect.

***

## Summary

| Section | Role | Key Point |
| --- | --- | --- |
| `global` | Global defaults | `scrape_interval` (collection) vs `evaluation_interval` (evaluation); `external_labels` apply only on outbound transmission |
| `scrape_configs` | Scrape definitions | `job_name` must be unique; `metrics_path`/`scheme`/auth settings |
| `honor_labels` | Label conflict handling | `true` for federation/Pushgateway, `false` for ordinary scraping |
| `relabel_configs` | **Before** scraping | Target filtering, `__meta_*` manipulation |
| `metric_relabel_configs` | **After** scraping | Cardinality control, dropping unwanted metrics |
| `alerting` | Alertmanager integration | Sent to all instances at once; Alertmanager handles deduplication |
| `remote_write`/`read` | Remote storage | Long-term retention and unified view, queue and filter settings |
| Reload | Zero-downtime apply | SIGHUP or HTTP API, with `promtool check config` first |

You can now fill out `prometheus.yml` by hand -- but hardcoding targets one by one in `static_configs` collapses the moment the fleet exceeds a few dozen servers. The next chapter, [Chapter 8. Service Discovery](/en/posts/prometheus-grafana-part03-ch08), covers automatically discovering scrape targets in dynamic environments like Kubernetes, EC2, and Consul.
