---
title: '[Prometheus & Grafana] Chapter 5. Jobs and Instances'
date: 2026-04-06
description: The relationship between Jobs and Instances as Prometheus scraping units, auto-generated labels and metrics, and Part 02 recap
tags:
  - Prometheus
  - Grafana
  - Monitoring
  - Observability
series: Prometheus & Grafana
seriesOrder: 5
---

> **Note**: This post is a summary based on the official Prometheus (v3.2.1) and Grafana documentation. For precise details, please refer to the official docs.
> - [Prometheus Official Docs](https://prometheus.io/docs/)
> - [Grafana Official Docs](https://grafana.com/docs/grafana/latest/)

***

Every metric Prometheus collects carries two labels that identify its origin: `job` and `instance`. These are not arbitrary tags -- they reflect Prometheus's fundamental model for organizing scrape targets. Understanding this model is the final piece of Part 02's data model coverage.

***

## 5.1 Instance: The Scrape Endpoint

An **Instance** is a single endpoint that Prometheus can scrape. It typically corresponds to one process and is identified by a `<host>:<port>` pair.

```plain
localhost:9090        <- Prometheus itself
10.0.1.5:9100        <- Node Exporter
10.0.1.5:4000        <- Web application
```

Each of these is an Instance. One host can run multiple Instances on different ports, and each is tracked independently.

***

## 5.2 Job: A Logical Group of Same-Purpose Instances

A **Job** is a logical group of replicated Instances that serve the same purpose. Running multiple copies of the same process for scalability or availability is standard practice -- a Job bundles them under one name.

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'api-server'
    static_configs:
      - targets:
          - '10.0.1.5:5670'
          - '10.0.1.5:5671'
          - '10.0.2.5:5670'
          - '10.0.2.5:5671'
```

The `api-server` Job above contains four Instances. The tree structure makes the relationship clear.

```plain
Job: api-server
├── Instance: 10.0.1.5:5670
├── Instance: 10.0.1.5:5671
├── Instance: 10.0.2.5:5670
└── Instance: 10.0.2.5:5671

Job: node-exporter
├── Instance: 10.0.1.5:9100
└── Instance: 10.0.2.5:9100
```

A Job groups what is logically the same service. An Instance pinpoints exactly which process within that service produced a given metric.

***

## 5.3 Auto-Generated Labels: `job` and `instance`

Prometheus automatically attaches two labels to every scraped metric.

| Label | Value | Example |
| --- | --- | --- |
| `job` | `job_name` from the scrape config | `api-server` |
| `instance` | `<host>:<port>` of the scrape target | `10.0.1.5:5670` |

Every collected metric is therefore traceable to its exact origin.

```plain
http_requests_total{job="api-server", instance="10.0.1.5:5670", method="GET"} = 1234
http_requests_total{job="api-server", instance="10.0.1.5:5671", method="GET"} = 5678
```

### honor_labels

A conflict arises when a scrape target already exposes its own `job` or `instance` labels. The `honor_labels` setting resolves this.

| honor_labels | Behavior |
| --- | --- |
| `false` (default) | Renames the target's labels to `exported_job`, `exported_instance`; uses Prometheus-assigned labels |
| `true` | Uses the target's labels as-is; Prometheus-assigned labels are discarded |

Federation setups typically use `honor_labels: true` to preserve the original labels from upstream Prometheus servers.

***

## 5.4 Auto-Generated Metrics

Beyond labels, Prometheus generates several metrics per scrape target automatically. These are essential for monitoring the health of the monitoring system itself.

### The `up` Metric

The most important auto-generated metric. It indicates whether a scrape succeeded.

| Value | Meaning |
| --- | --- |
| `1` | Scrape successful -- instance is up |
| `0` | Scrape failed -- instance is down or unreachable |

```promql
# Find all downed instances
up == 0

# Healthy instance ratio for a specific Job
avg(up{job="api-server"})
```

An alert rule on `up == 0` is often the first alert any Prometheus deployment configures. If `up` is 0, everything else about that target is unknown.

### Other Auto-Generated Metrics

| Metric | Description |
| --- | --- |
| `scrape_duration_seconds` | Time taken to complete the scrape |
| `scrape_samples_scraped` | Number of samples collected |
| `scrape_samples_post_metric_relabeling` | Samples remaining after metric relabeling |
| `scrape_series_added` | New time series added in this scrape (v2.10+) |

### extra-scrape-metrics Feature Flag

Enabling `--enable-feature=extra-scrape-metrics` exposes additional scrape diagnostics.

| Metric | Description |
| --- | --- |
| `scrape_timeout_seconds` | Configured scrape timeout |
| `scrape_sample_limit` | Configured sample limit (0 = unlimited) |
| `scrape_body_size_bytes` | Uncompressed size of the last scrape response |

### Practical PromQL

These auto-generated metrics become powerful when combined in queries.

```promql
# Targets where scraping takes over 3 seconds (timeout risk)
scrape_duration_seconds > 3

# Targets where sample count doubled compared to 1 hour ago (cardinality explosion suspect)
scrape_samples_scraped / scrape_samples_scraped offset 1h > 2

# Instance health summary by Job
count by (job) (up == 1)
count by (job) (up == 0)
```

The `scrape_duration_seconds > 3` query is particularly useful. If a target consistently approaches the scrape timeout, it will eventually start failing -- catching it early prevents gaps in your data.

***

## Part 02 Recap

This chapter concludes Part 02. The table below summarizes every concept covered across [Chapter 3. Data Model](/en/posts/prometheus-grafana-part02-ch03), [Chapter 4. Metric Types](/en/posts/prometheus-grafana-part02-ch04), and this chapter.

| Concept | Definition | Key Point |
| --- | --- | --- |
| Time Series | Time-ordered values identified by metric name + labels | Fundamental data unit |
| Metric Name | Describes what is measured | prefix + base unit + suffix convention |
| Labels | Key-value pairs for multi-dimensional distinction | Cardinality management is essential |
| Counter | Monotonically increasing cumulative value | Use with `rate()`, `_total` suffix |
| Gauge | Mutable snapshot value | Direct query, `predict_linear()` |
| Histogram | Bucket-based distribution | Server-side aggregation, `histogram_quantile()` |
| Summary | Client-side quantiles | Not aggregatable, precise quantiles |
| Job | Logical group of same-purpose instances | Auto `job` label |
| Instance | Single scrape endpoint | Auto `instance` label, `up` metric |

Part 02 established the theoretical foundation -- what Prometheus stores and how it categorizes that data. Part 03 shifts to practice. The next chapter covers installation of Prometheus and Grafana.
