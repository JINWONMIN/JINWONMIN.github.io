---
title: '[Prometheus & Grafana] Chapter 8. Service Discovery'
date: 2026-06-06
description: Going beyond static_configs to auto-discover scrape targets across file, DNS, Consul, Kubernetes, and cloud environments
tags:
  - Prometheus
  - Grafana
  - Monitoring
  - Observability
series: Prometheus & Grafana
seriesOrder: 8
---

> **Note**: This post is a summary based on the official Prometheus (v3.2.1) and Grafana documentation. For precise details, please refer to the official docs.
> - [Prometheus Official Docs](https://prometheus.io/docs/)
> - [Grafana Official Docs](https://grafana.com/docs/grafana/latest/)

***

At the end of [Chapter 7. Configuration File (prometheus.yml)](/en/posts/prometheus-grafana-part03-ch07), I noted that hardcoding targets one by one in `static_configs` collapses the moment the fleet exceeds a few dozen servers. In an environment where an autoscaling group spins up five instances overnight and reaps them by morning, having a human add IPs by hand and reload is simply not an option. Service discovery (SD) delegates this problem to another system. You only tell Prometheus where the target list lives, and it polls that source periodically to keep its scrape targets up to date on its own.

***

## 8.1 Every SD Works the Same Way

Whatever the flavor of SD, the skeleton of its behavior is identical. **It pulls target candidates from a source, attaches `__meta_*` meta labels, and reshapes them via relabeling.** Kubernetes, EC2, Consul -- all three go through these same stages. Once that sticks, everything else is just a difference in per-source config keys and meta label names.

The meta labels are the crux. Every target discovered by SD comes plastered with temporary labels prefixed by `__`. These labels are discarded once scraping finishes, so any value worth keeping must be promoted into a real label. That promotion is the job of `relabel_configs`, covered in [Chapter 7](/en/posts/prometheus-grafana-part03-ch07). This chapter does not re-explain the relabeling syntax; instead it focuses on **which meta labels each SD provides** and **how to lift them into real labels**.

***

## 8.2 static_configs and file_sd_configs

Start with the two simplest approaches. Both work without any external system, but they differ in how the target list gets updated.

`static_configs` writes target addresses straight into the config file. It is unambiguous, but its limitation is the one we already know: every server you add or remove means editing the file and reloading.

```yaml
scrape_configs:
  - job_name: 'node-exporters'
    static_configs:
      - targets:
          - '10.0.1.5:9100'
          - '10.0.1.6:9100'
        labels:
          datacenter: 'dc1'
```

`file_sd_configs` is one evolutionary step up. The target list moves into a separate JSON or YAML file that Prometheus watches. When the file changes, the target list updates automatically -- no reload required.

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'file-based'
    file_sd_configs:
      - files:
          - '/etc/prometheus/targets/*.json'
        refresh_interval: 5m
```

```json
// /etc/prometheus/targets/web-servers.json
[
  {
    "targets": ["web1:9100", "web2:9100"],
    "labels": { "env": "production", "role": "web" }
  }
]
```

The real value of `file_sd` shows when paired with external tooling. Have Ansible or Terraform generate this JSON file as part of provisioning infrastructure, and targets roll in without ever touching the Prometheus config. Even an exotic platform that no SD supports natively can be absorbed through `file_sd`, as long as you have a single script that emits the target list as JSON. That is why `file_sd` is regarded as the universal adapter of the SD world.

***

## 8.3 dns_sd_configs: DNS-Based

If you already run DNS, you can discover targets through SRV or A/AAAA records without any extra system. An SRV record carries both host and port, so it is self-contained; an A/AAAA record returns only an IP, so you must supply `port` separately.

```yaml
scrape_configs:
  - job_name: 'dns-based'
    dns_sd_configs:
      - names:
          - '_prometheus._tcp.example.com'   # SRV: includes host + port
        type: SRV
        refresh_interval: 30s

      - names:
          - 'web-servers.example.com'        # A: returns IP only -> port required
        type: A
        port: 9100
        refresh_interval: 30s
```

DNS SD has no service registration or deregistration mechanism of its own. Filling and clearing records is ultimately someone else's job, which makes it a better fit for infrastructure that already revolves around DNS than for highly dynamic environments.

***

## 8.4 consul_sd_configs: Consul Integration

If you use HashiCorp Consul as a service registry, you can pull services registered in Consul directly as scrape targets. The moment a service registers with Consul, it enters Prometheus's field of view.

```yaml
scrape_configs:
  - job_name: 'consul'
    consul_sd_configs:
      - server: 'consul.example.com:8500'
        services: []           # empty array = all services
        tags: ['monitoring']   # only services carrying this tag
        refresh_interval: 30s

    relabel_configs:
      # Promote the Consul service name into the job label
      - source_labels: [__meta_consul_service]
        target_label: job
```

That `relabel_configs` block is exactly the meta label promotion described in 8.1: it takes the `__meta_consul_service` label that Consul SD attaches and lifts it into the `job` label. The main meta labels Consul provides are below.

| Meta label | Description |
| --- | --- |
| `__meta_consul_service` | Service name |
| `__meta_consul_node` | Node name |
| `__meta_consul_tags` | Service tags (comma-separated) |
| `__meta_consul_dc` | Datacenter |
| `__meta_consul_address` | Service address |

***

## 8.5 kubernetes_sd_configs: Kubernetes Integration

In Kubernetes, SD is not a choice but a premise. Pods die and respawn constantly, getting a new IP each time, so a static config could not survive a single day. `kubernetes_sd_configs` queries the Kubernetes API directly to discover resources, and what it discovers is decided by `role`.

| Role | Discovers | Primary use |
| --- | --- | --- |
| `node` | Cluster nodes | kubelet, Node Exporter |
| `pod` | Pods | Application metrics |
| `service` | Services | Service-level monitoring |
| `endpoints` | Endpoints | Pods backing a Service |
| `endpointslice` | EndpointSlice | Scalable successor to endpoints |
| `ingress` | Ingress | Blackbox monitoring |

### Annotation-Based Auto-Scraping

The most widely used Kubernetes pattern is to annotate a Pod and let Prometheus pick it up and scrape it on its own. Three lines in the application manifest are enough.

```yaml
# Pod / Deployment manifest
metadata:
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "8080"
    prometheus.io/path: "/metrics"
```

The side that reads these annotations and acts on them is `relabel_configs`. Two core rules, excerpted, do most of the work.

```yaml
relabel_configs:
  # Keep only pods carrying scrape=true; drop the rest
  - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
    action: keep
    regex: true

  # Splice the annotated port into the actual scrape address (__address__)
  - source_labels:
      - __address__
      - __meta_kubernetes_pod_annotation_prometheus_io_port
    action: replace
    regex: ([^:]+)(?::\d+)?;(\d+)
    replacement: $1:$2
    target_label: __address__
```

The `keep` in the first rule is a filter that eliminates any Pod lacking the annotation. Instead of indiscriminately scraping every Pod in the cluster, it selects only those that have explicitly opted in. The second rule completes the scrape address by attaching the annotated port to the Pod IP. Add rules that promote identifying details -- namespace, pod name, container name -- into real labels, and you can trace in PromQL exactly which Pod a metric came from.

The meta labels Kubernetes SD provides are extensive. The frequently used ones are below.

| Meta label | Description |
| --- | --- |
| `__meta_kubernetes_namespace` | Namespace |
| `__meta_kubernetes_pod_name` | Pod name |
| `__meta_kubernetes_pod_container_name` | Container name |
| `__meta_kubernetes_pod_label_<name>` | Pod label |
| `__meta_kubernetes_pod_annotation_<name>` | Pod annotation |
| `__meta_kubernetes_node_name` | Node name |

***

## 8.6 docker_sd_configs: Docker Integration

In a Docker-only environment without Kubernetes, `docker_sd_configs` discovers running containers through the Docker Engine API. The same mechanism applies to Docker Swarm.

```yaml
scrape_configs:
  - job_name: 'docker-containers'
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
        refresh_interval: 15s
        filters:
          - name: label
            values: ['prometheus.io/scrape=true']

    relabel_configs:
      # Strip the leading slash from the container name and promote it
      - source_labels: [__meta_docker_container_name]
        regex: '/(.*)'
        target_label: container
```

`filters` screens candidates at the source stage. Where the `keep` action in `relabel_configs` is a post-hoc filter that discovers first and drops afterward, `filters` is a pre-filter that applies the condition right when querying the Docker API. That spares you from pulling in non-monitored containers only to discard them via relabeling.

***

## 8.7 Cloud SD: AWS / Azure / GCP

In the cloud, instances are part of the infrastructure, born and retired without end. All three major clouds provide a dedicated SD, and they commonly require two core settings: **authentication credentials** and a **tag/label filter**.

AWS EC2 takes a region and credentials to discover instances, then narrows them down by tag. A discovered instance's tags and availability zone arrive as meta labels, ready to be promoted as-is.

```yaml
scrape_configs:
  - job_name: 'aws-ec2'
    ec2_sd_configs:
      - region: 'ap-northeast-2'
        port: 9100
        filters:
          - name: 'tag:Environment'
            values: ['production']

    relabel_configs:
      - source_labels: [__meta_ec2_tag_Name]
        target_label: instance_name
      - source_labels: [__meta_ec2_availability_zone]
        target_label: availability_zone
```

> The example above omits `access_key`/`secret_key`. Rather than embedding credentials in plaintext in the config file, it is safer to grant them through an instance IAM role.

Azure's `azure_sd_configs` expects a Service Principal (`subscription_id`, `tenant_id`, `client_id`, `client_secret`), and GCP's `gce_sd_configs` expects a project, zone, and Service Account. Only the auth mechanism and the meta label prefix (`__meta_azure_*`, `__meta_gce_*`) differ; the skeleton -- "call the API with credentials to pull instances, then lift tags into labels" -- is identical to EC2.

***

## Choosing a Service Discovery

Which SD to use is dictated not by taste but by your infrastructure. Pick the one that matches the environment you run.

| Environment | Recommended SD | Notes |
| --- | --- | --- |
| Fixed servers (bare metal / VM) | `static_configs` or `file_sd` | static for a few, file for many |
| Kubernetes | `kubernetes_sd` | the de facto standard |
| Docker (non-K8s) | `docker_sd` | includes Docker Swarm |
| HashiCorp ecosystem | `consul_sd` | when Consul is already in use |
| AWS / Azure / GCP | `ec2_sd` / `azure_sd` / `gce_sd` | needs IAM / Service Principal / Service Account |
| DNS-centric infra | `dns_sd` | requires SRV record management |
| Anything else | `file_sd` + external tooling | the general-purpose fallback |

***

## Summary

| Item | Key point |
| --- | --- |
| Common SD flow | Collect candidates from a source -> attach `__meta_*` -> reshape via relabeling |
| `static_configs` | Listed directly in the config; only fit for a few fixed targets |
| `file_sd_configs` | Watches JSON/YAML files; the universal adapter for external tooling |
| `dns_sd_configs` | SRV includes the port, A/AAAA require `port` |
| `consul_sd_configs` | Promote `__meta_consul_*` into real labels |
| `kubernetes_sd_configs` | `role` decides what to discover; annotation-based scraping is the standard pattern |
| `docker_sd_configs` | `filters` is a pre-filter, `relabel` `keep` is a post-filter |
| Cloud SD | Credentials + tag filter; the skeleton is identical across providers |

Once you finish promoting meta labels into real ones, Prometheus starts finding targets and stacking up time series on its own, even in dynamic environments. But that accumulated data is, by itself, just a heap of numbers. The next chapter, [Chapter 9. PromQL Basics](/en/posts/prometheus-grafana-part04-ch09), starts with the fundamentals of PromQL -- the language for asking these time series questions.
