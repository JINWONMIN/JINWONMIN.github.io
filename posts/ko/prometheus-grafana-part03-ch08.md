---
title: '[Prometheus & Grafana] Chapter 8. 서비스 디스커버리'
date: 2026-06-06
description: static_configs의 한계를 넘어 파일, DNS, Consul, Kubernetes, 클라우드 환경에서 스크래핑 대상을 자동으로 발견하는 방법
tags:
  - Prometheus
  - Grafana
  - 모니터링
  - 옵저버빌리티
series: Prometheus & Grafana
seriesOrder: 8
---

> **참고**: 이 글은 Prometheus (v3.2.1)와 Grafana 공식 문서를 기반으로 요약·정리한 내용입니다. 정확한 내용은 공식 문서를 참조해 주세요.
> - [Prometheus 공식 문서](https://prometheus.io/docs/)
> - [Grafana 공식 문서](https://grafana.com/docs/grafana/latest/)

***

[Chapter 7. 설정 파일 (prometheus.yml)](/ko/posts/prometheus-grafana-part03-ch07)의 마지막에서 `static_configs`로 대상을 일일이 박는 방식은 서버가 수십 대만 넘어가도 무너진다고 적었다. 오토스케일링 그룹이 새벽에 인스턴스 다섯 대를 띄웠다 아침에 거둬들이는 환경에서, 사람이 IP를 손으로 추가하고 리로드하는 일은 애초에 불가능하다. 서비스 디스커버리(Service Discovery, 이하 SD)는 이 문제를 다른 시스템에 위임한다. 대상 목록이 어디에 사는지만 알려주면, Prometheus가 그곳을 주기적으로 들여다보며 스크래핑 대상을 스스로 갱신한다.

***

## 8.1 모든 SD는 같은 방식으로 동작한다

SD의 종류가 무엇이든, 동작의 골격은 동일하다. **소스에서 대상 후보를 끌어오고, `__meta_*` 메타 레이블을 붙이고, 릴레이블링으로 가공한다.** Kubernetes든 EC2든 Consul이든 이 세 단계를 거친다는 점만 머리에 넣으면, 나머지는 소스별 설정 키와 메타 레이블 이름의 차이일 뿐이다.

여기서 핵심은 메타 레이블이다. SD가 발견한 대상에는 `__`로 시작하는 임시 레이블이 잔뜩 붙어 있다. 이 레이블은 스크래핑이 끝나면 버려지므로, 그중 보존하고 싶은 값은 실제 레이블로 승격시켜야 한다. 그 승격을 담당하는 것이 [Chapter 7](/ko/posts/prometheus-grafana-part03-ch07)에서 다룬 `relabel_configs`다. 이 장에서는 릴레이블링 문법 자체를 다시 설명하지 않고, 각 SD가 **어떤 메타 레이블을 제공하는지**, 그리고 그것을 **어떻게 실제 레이블로 끌어올리는지**에 집중한다.

***

## 8.2 static_configs와 file_sd_configs

가장 단순한 두 방식부터 짚는다. 둘 다 외부 시스템 없이 동작하지만, 갱신 방식이 다르다.

`static_configs`는 대상 주소를 설정 파일에 직접 적는다. 설정이 명확하다는 장점이 있지만, 서버를 추가·제거할 때마다 파일을 고치고 리로드해야 한다는 한계는 이미 알고 있는 그대로다.

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

`file_sd_configs`는 한 단계 진화한 형태다. 대상 목록을 JSON 또는 YAML 파일로 분리하고, Prometheus가 그 파일을 감시한다. 파일이 바뀌면 리로드 없이 대상 목록이 자동으로 갱신된다.

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

`file_sd`의 진가는 외부 도구와 결합할 때 드러난다. Ansible이나 Terraform이 인프라를 프로비저닝하면서 이 JSON 파일까지 함께 생성하도록 해두면, Prometheus 설정 파일은 손대지 않고 대상만 굴러 들어온다. 어떤 SD도 직접 지원하지 않는 특수한 인프라라도, 대상 목록을 JSON으로 뱉어내는 스크립트 하나만 있으면 `file_sd`로 흡수할 수 있다. 그래서 `file_sd`는 SD 세계의 만능 어댑터로 통한다.

***

## 8.3 dns_sd_configs: DNS 기반

DNS를 이미 운영하고 있다면, 별도 시스템 없이 SRV 또는 A/AAAA 레코드로 대상을 탐지할 수 있다. SRV 레코드는 호스트와 포트를 모두 담고 있어 그 자체로 완결되지만, A/AAAA 레코드는 IP만 반환하므로 `port`를 따로 지정해야 한다.

```yaml
scrape_configs:
  - job_name: 'dns-based'
    dns_sd_configs:
      - names:
          - '_prometheus._tcp.example.com'   # SRV: 호스트+포트 포함
        type: SRV
        refresh_interval: 30s

      - names:
          - 'web-servers.example.com'        # A: IP만 반환 → port 필수
        type: A
        port: 9100
        refresh_interval: 30s
```

DNS SD는 자체적으로 서비스 등록·해제 메커니즘을 갖지 않는다. 레코드를 채우고 비우는 일은 결국 다른 도구의 몫이라, 정교한 동적 환경보다는 이미 DNS 중심으로 굴러가는 인프라에 어울린다.

***

## 8.4 consul_sd_configs: Consul 연동

HashiCorp Consul을 서비스 레지스트리로 쓰고 있다면, Consul에 등록된 서비스를 그대로 스크래핑 대상으로 끌어올 수 있다. 서비스가 Consul에 등록되는 순간 Prometheus의 시야에도 들어온다.

```yaml
scrape_configs:
  - job_name: 'consul'
    consul_sd_configs:
      - server: 'consul.example.com:8500'
        services: []           # 빈 배열 = 모든 서비스
        tags: ['monitoring']   # 이 태그가 붙은 서비스만
        refresh_interval: 30s

    relabel_configs:
      # Consul 서비스 이름을 job 레이블로 승격
      - source_labels: [__meta_consul_service]
        target_label: job
```

`relabel_configs` 블록이 바로 8.1에서 말한 메타 레이블 승격이다. Consul SD가 붙여주는 `__meta_consul_service`를 가져다 `job` 레이블로 올렸다. Consul이 제공하는 주요 메타 레이블은 다음과 같다.

| 메타 레이블 | 설명 |
| --- | --- |
| `__meta_consul_service` | 서비스 이름 |
| `__meta_consul_node` | 노드 이름 |
| `__meta_consul_tags` | 서비스 태그 (쉼표 구분) |
| `__meta_consul_dc` | 데이터센터 |
| `__meta_consul_address` | 서비스 주소 |

***

## 8.5 kubernetes_sd_configs: Kubernetes 연동

Kubernetes에서는 SD가 선택이 아니라 전제다. Pod는 수시로 죽고 다시 뜨며 그때마다 IP가 바뀌므로, 정적 설정으로는 단 하루도 버틸 수 없다. `kubernetes_sd_configs`는 Kubernetes API에 직접 물어 리소스를 탐지하며, 무엇을 탐지할지는 `role`이 결정한다.

| Role | 탐지 대상 | 주 용도 |
| --- | --- | --- |
| `node` | 클러스터 노드 | kubelet, Node Exporter |
| `pod` | Pod | 애플리케이션 메트릭 |
| `service` | Service | 서비스 레벨 모니터링 |
| `endpoints` | Endpoints | Service에 연결된 Pod |
| `endpointslice` | EndpointSlice | endpoints의 확장 버전 |
| `ingress` | Ingress | Blackbox 모니터링 |

### 어노테이션 기반 자동 스크래핑

Kubernetes에서 가장 널리 쓰이는 패턴은 Pod에 어노테이션을 달아두면 Prometheus가 알아서 골라 긁어가는 방식이다. 애플리케이션 매니페스트에 세 줄만 추가하면 된다.

```yaml
# Pod / Deployment 매니페스트
metadata:
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "8080"
    prometheus.io/path: "/metrics"
```

이 어노테이션을 읽어 동작을 결정하는 쪽은 `relabel_configs`다. 핵심 규칙 두 가지만 발췌하면 다음과 같다.

```yaml
relabel_configs:
  # scrape=true 어노테이션이 붙은 Pod만 남기고 나머지는 버린다
  - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
    action: keep
    regex: true

  # 어노테이션의 포트를 실제 스크래핑 주소(__address__)에 합성한다
  - source_labels:
      - __address__
      - __meta_kubernetes_pod_annotation_prometheus_io_port
    action: replace
    regex: ([^:]+)(?::\d+)?;(\d+)
    replacement: $1:$2
    target_label: __address__
```

첫 규칙의 `keep`은 어노테이션이 없는 Pod를 통째로 탈락시키는 필터다. 클러스터의 모든 Pod를 무차별로 긁지 않고, 모니터링 의사를 명시한 것만 골라낸다. 두 번째 규칙은 Pod IP에 어노테이션으로 지정한 포트를 붙여 스크래핑 주소를 완성한다. 여기에 네임스페이스, Pod 이름, 컨테이너 이름 같은 식별 정보를 실제 레이블로 승격하는 규칙을 더하면, 어느 메트릭이 어느 Pod에서 왔는지 PromQL로 추적할 수 있게 된다.

Kubernetes SD가 제공하는 메타 레이블은 방대하다. 자주 쓰는 것만 추리면 다음과 같다.

| 메타 레이블 | 설명 |
| --- | --- |
| `__meta_kubernetes_namespace` | 네임스페이스 |
| `__meta_kubernetes_pod_name` | Pod 이름 |
| `__meta_kubernetes_pod_container_name` | 컨테이너 이름 |
| `__meta_kubernetes_pod_label_<name>` | Pod 레이블 |
| `__meta_kubernetes_pod_annotation_<name>` | Pod 어노테이션 |
| `__meta_kubernetes_node_name` | 노드 이름 |

***

## 8.6 docker_sd_configs: Docker 연동

Kubernetes 없이 Docker만 쓰는 환경에서는 `docker_sd_configs`가 Docker Engine API를 통해 실행 중인 컨테이너를 탐지한다. Docker Swarm 환경에도 같은 방식이 적용된다.

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
      # 컨테이너 이름 앞의 슬래시를 떼고 container 레이블로 승격
      - source_labels: [__meta_docker_container_name]
        regex: '/(.*)'
        target_label: container
```

`filters`는 소스 단계에서 미리 거르는 장치다. `relabel_configs`의 `keep`이 발견한 뒤 버리는 사후 필터라면, `filters`는 Docker API에 질의할 때부터 조건을 거는 사전 필터다. 모니터링 대상이 아닌 컨테이너까지 일일이 끌어와 릴레이블링으로 떨굴 필요가 없어진다.

***

## 8.7 클라우드 SD: AWS / Azure / GCP

클라우드에서는 인스턴스가 인프라의 일부로 끊임없이 태어나고 사라진다. 세 메이저 클라우드 모두 전용 SD를 제공하며, 공통적으로 **인증 자격 증명**과 **태그/레이블 필터**를 핵심 설정으로 요구한다.

AWS EC2는 리전과 자격 증명을 받아 인스턴스를 탐지하고, 태그로 대상을 좁힌다. 발견한 인스턴스의 태그와 가용 영역은 메타 레이블로 들어오므로 그대로 승격해 쓰면 된다.

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

> 위 예시에서는 `access_key`/`secret_key`를 생략했다. 자격 증명을 설정 파일에 평문으로 박는 대신 인스턴스 IAM 역할로 부여하는 편이 안전하다.

Azure는 `azure_sd_configs`에 Service Principal(`subscription_id`, `tenant_id`, `client_id`, `client_secret`)을, GCP는 `gce_sd_configs`에 프로젝트와 존, Service Account를 요구한다. 인증 방식과 메타 레이블 접두사(`__meta_azure_*`, `__meta_gce_*`)만 다를 뿐, "자격 증명으로 API를 호출해 인스턴스를 끌어오고 태그를 레이블로 올린다"는 골격은 EC2와 똑같다.

***

## 서비스 디스커버리 선택 가이드

어떤 SD를 쓸지는 취향이 아니라 인프라가 정한다. 운영 중인 환경에 맞춰 고르면 된다.

| 환경 | 추천 SD | 비고 |
| --- | --- | --- |
| 고정 서버 (물리/VM) | `static_configs` 또는 `file_sd` | 수가 적으면 static, 많으면 file |
| Kubernetes | `kubernetes_sd` | 사실상 표준 |
| Docker (비-K8s) | `docker_sd` | Docker Swarm 포함 |
| HashiCorp 생태계 | `consul_sd` | Consul을 이미 쓰는 경우 |
| AWS / Azure / GCP | `ec2_sd` / `azure_sd` / `gce_sd` | 각각 IAM·Service Principal·Service Account 필요 |
| DNS 중심 인프라 | `dns_sd` | SRV 레코드 관리 필요 |
| 그 외 모든 경우 | `file_sd` + 외부 도구 | 범용 해결책 |

***

## 정리

| 항목 | 핵심 |
| --- | --- |
| SD 공통 동작 | 소스에서 대상 후보 수집 → `__meta_*` 부착 → 릴레이블링으로 가공 |
| `static_configs` | 설정 파일에 직접 명시, 소수 고정 대상에만 적합 |
| `file_sd_configs` | JSON/YAML 파일 감시, 외부 도구와 결합하는 만능 어댑터 |
| `dns_sd_configs` | SRV는 포트 포함, A/AAAA는 `port` 필수 |
| `consul_sd_configs` | `__meta_consul_*`를 실제 레이블로 승격 |
| `kubernetes_sd_configs` | `role`로 탐지 대상 결정, 어노테이션 기반 자동 스크래핑이 표준 패턴 |
| `docker_sd_configs` | `filters`는 사전 필터, `relabel` `keep`은 사후 필터 |
| 클라우드 SD | 자격 증명 + 태그 필터, 골격은 모두 동일 |

메타 레이블을 실제 레이블로 승격하는 일까지 끝내면, Prometheus는 동적인 환경에서도 스스로 대상을 찾아 시계열을 쌓기 시작한다. 그런데 그렇게 쌓인 데이터는 그 자체로는 숫자의 더미일 뿐이다. 다음 [Chapter 9. PromQL 기초](/ko/posts/prometheus-grafana-part04-ch09)에서는 이 시계열에 질문을 던지는 언어, PromQL의 기본 문법부터 시작한다.
