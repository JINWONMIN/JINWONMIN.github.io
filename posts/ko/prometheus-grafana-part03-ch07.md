---
title: '[Prometheus & Grafana] Chapter 7. 설정 파일 (prometheus.yml)'
date: 2026-06-05
description: prometheus.yml의 전체 구조와 scrape_configs, 릴레이블링, 무중단 설정 재로드까지 정리
tags:
  - Prometheus
  - Grafana
  - 모니터링
  - 옵저버빌리티
series: Prometheus & Grafana
seriesOrder: 7
---

> **참고**: 이 글은 Prometheus (v3.2.1)와 Grafana 공식 문서를 기반으로 요약·정리한 내용입니다. 정확한 내용은 공식 문서를 참조해 주세요.
> - [Prometheus 공식 문서](https://prometheus.io/docs/)
> - [Grafana 공식 문서](https://grafana.com/docs/grafana/latest/)

***

[Chapter 6. 설치](/ko/posts/prometheus-grafana-part03-ch06)에서 Prometheus를 설치하고 `up` 쿼리가 `1`을 반환하는 것까지 확인했다. 그 시점의 Prometheus는 기본 설정 파일에 적힌 대로 자기 자신만 스크래핑하고 있었다. 무엇을, 얼마나 자주, 어떻게 수집할지는 전부 `prometheus.yml`이 결정한다. 이 장은 그 YAML 한 장을 해부한다.

***

## 7.1 전체 구조 개요

`prometheus.yml`의 최상위는 목적이 분명한 몇 개의 섹션으로 나뉜다. 각 섹션이 Prometheus 동작의 한 축을 담당한다.

```yaml
global:          # 모든 Job에 적용되는 기본값
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    cluster: 'production'

rule_files:      # Recording/Alerting Rule 파일 경로
  - '/etc/prometheus/rules/*.yml'

scrape_configs:  # 무엇을 어떻게 스크래핑할지 (핵심)
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

alerting:        # 알림을 보낼 Alertmanager
  alertmanagers:
    - static_configs:
        - targets: ['localhost:9093']

remote_write:    # 원격 스토리지로 쓰기
  - url: 'http://remote-storage:9201/write'

remote_read:     # 원격 스토리지에서 읽기
  - url: 'http://remote-storage:9201/read'
```

이 중 실무에서 매일 손대는 곳은 `global`과 `scrape_configs`다. 나머지는 알림, 장기 보관, 페더레이션이 필요해질 때 추가한다. 아래에서 섹션 순서대로 짚는다.

***

## 7.2 global: 전역 기본값

`global` 섹션은 개별 Job에서 따로 지정하지 않았을 때 적용되는 기본값을 정의한다. Job 단위에서 같은 키를 다시 지정하면 그 값이 우선한다.

```yaml
global:
  scrape_interval: 15s      # 스크래핑 주기 (기본 1m)
  scrape_timeout: 10s       # 스크래핑 타임아웃 (기본 10s)
  evaluation_interval: 15s  # 규칙 평가 주기 (기본 1m)
  external_labels:
    monitor: 'production-monitor'
    region: 'ap-northeast-2'
```

### scrape_interval과 evaluation_interval

이름이 비슷하지만 역할이 다른 두 값이다. 하나는 데이터를 가져오는 주기, 하나는 규칙을 계산하는 주기다.

| 설정 | 역할 | 영향 |
| --- | --- | --- |
| `scrape_interval` | 대상에서 메트릭을 가져오는 주기 | 짧을수록 해상도 ↑, 부하 ↑ |
| `evaluation_interval` | Recording/Alerting Rule을 평가하는 주기 | 알림 감지 속도에 영향 |

권장값은 환경에 따라 다르다. 일반 인프라 모니터링은 `15s ~ 30s`, 상세한 애플리케이션 모니터링은 `5s ~ 15s`가 적당하다. `evaluation_interval`은 `scrape_interval`과 같거나 그 배수로 두는 편이 안전하다. 스크래핑보다 자주 평가해봐야 새 데이터가 없기 때문이다.

### external_labels

`external_labels`는 데이터를 외부로 내보낼 때 출처를 표시하는 꼬리표다. Federation이나 Alertmanager로 전송하는 시계열에 자동으로 붙는다. 여러 Prometheus 서버를 운영할 때 어느 서버에서 온 데이터인지 구분하는 용도다.

```yaml
external_labels:
  cluster: 'production'
  region: 'ap-northeast-2'
  environment: 'prod'
```

한 가지 주의할 점이 있다. **`external_labels`는 로컬 TSDB에는 붙지 않는다.** 외부로 전송될 때만 적용되므로, 로컬에서 쿼리하면 이 레이블이 보이지 않는다.

***

## 7.3 scrape_configs: 스크래핑 설정

`scrape_configs`는 prometheus.yml의 심장이다. 어떤 대상을, 어떤 경로로, 얼마나 자주, 어떤 인증으로 긁어올지 모두 여기서 정의한다.

### 기본 구조

```yaml
scrape_configs:
  - job_name: 'my-service'      # 필수. 메트릭에 job 레이블로 붙음
    scrape_interval: 10s        # global 오버라이드
    metrics_path: '/metrics'    # 기본 /metrics
    scheme: 'https'             # 기본 http
    static_configs:
      - targets:
          - 'server1:9100'
          - 'server2:9100'
        labels:
          env: 'production'
          team: 'backend'
```

`job_name`은 파일 전체에서 고유해야 하며, 수집된 모든 메트릭에 `job` 레이블로 자동 추가된다.

### metrics_path와 scheme

대부분의 Exporter는 `/metrics`를 사용하지만, 그렇지 않은 경우가 종종 있다. Spring Boot Actuator는 `/actuator/prometheus`, Federation은 `/federate`를 쓴다.

```yaml
metrics_path: '/actuator/prometheus'   # Spring Boot Actuator
```

`scheme`을 `https`로 두면 TLS 통신을 하는데, 이때 `tls_config`로 인증서 경로를 함께 지정해야 한다.

```yaml
scheme: 'https'
tls_config:
  ca_file: '/etc/prometheus/ca.crt'
  cert_file: '/etc/prometheus/client.crt'
  key_file: '/etc/prometheus/client.key'
```

### 인증 설정

대상이 인증을 요구하면 Basic Auth 또는 Bearer Token을 설정한다. 토큰은 파일에서 읽어올 수도 있어, 시크릿을 설정 파일에 직접 박지 않을 수 있다.

```yaml
scrape_configs:
  - job_name: 'authenticated-service'
    basic_auth:
      username: 'prometheus'
      password: 'secret'
    # 또는 Bearer Token을 파일에서
    authorization:
      type: 'Bearer'
      credentials_file: '/etc/prometheus/token'
```

***

## 7.4 honor_labels와 honor_timestamps

이 두 옵션은 평소엔 건드릴 일이 없다가 Federation이나 Pushgateway를 붙이는 순간 반드시 마주친다. 스크래핑된 메트릭의 레이블과 타임스탬프를 누가 소유하느냐의 문제다.

### honor_labels

스크래핑한 메트릭에 이미 `job`이나 `instance` 레이블이 들어 있을 때, Prometheus가 붙이려는 동명의 레이블과 충돌한다. `honor_labels`는 이 충돌을 누구의 손을 들어 해결할지 결정한다.

| honor_labels | 충돌 시 동작 |
| --- | --- |
| `false` (기본값) | 원본 레이블을 `exported_<name>`으로 밀어내고 Prometheus 레이블을 사용 |
| `true` | 원본 레이블을 그대로 유지하고 Prometheus 레이블을 무시 |

판단 기준은 단순하다. 원본 소스의 레이블을 보존해야 하면 `true`, Prometheus가 대상을 정확히 식별해야 하면 `false`다. Federation과 Pushgateway는 `true`, 일반 Exporter 스크래핑은 기본값 `false`를 쓴다.

### honor_timestamps

스크래핑된 메트릭에 자체 타임스탬프가 포함된 경우 그것을 신뢰할지 결정한다. 기본값 `true`면 메트릭의 타임스탬프를 쓰고, `false`면 스크래핑 시점의 시각으로 덮어쓴다. 특수한 사정이 없으면 기본값을 유지한다.

***

## 7.5 relabel_configs와 metric_relabel_configs

릴레이블링은 Prometheus에서 가장 강력하면서도 가장 헷갈리는 기능이다. 레이블을 동적으로 추가·변경·삭제하고, 아예 스크래핑 여부까지 결정한다. 이름이 비슷한 두 종류가 있는데, **언제 적용되느냐**가 결정적 차이다.

| | relabel_configs | metric_relabel_configs |
| --- | --- | --- |
| 시점 | 스크래핑 **전** | 스크래핑 **후** |
| 대상 | 타겟 레이블 (서비스 디스커버리 결과) | 수집된 메트릭의 레이블 |
| 용도 | 스크래핑 대상 필터링, 레이블 변환 | 불필요한 메트릭 제거, 레이블 정리 |

한 문장으로 정리하면, `relabel_configs`는 "이 대상을 긁을지 말지, 어디서 긁을지"를 정하고, `metric_relabel_configs`는 "이미 긁어온 메트릭 중 무엇을 저장할지"를 정한다.

### relabel_configs: 스크래핑 전

서비스 디스커버리가 만들어낸 `__meta_*` 레이블을 가공해 스크래핑 대상을 거르거나 실제 레이블로 승격시킨다. Kubernetes 환경에서 특히 많이 쓴다.

```yaml
relabel_configs:
  # prometheus.io/scrape=true 어노테이션이 있는 Pod만 스크래핑
  - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
    action: keep
    regex: true
  # Pod 이름을 pod 레이블로 승격
  - source_labels: [__meta_kubernetes_pod_name]
    action: replace
    target_label: pod
```

### metric_relabel_configs: 스크래핑 후

이미 수집한 메트릭 중 저장할 것을 추린다. 카디널리티가 폭발하는 메트릭을 버리거나, 불필요한 `go_*` 내부 메트릭을 떨궈 스토리지를 아끼는 데 쓴다.

```yaml
metric_relabel_configs:
  # node_ 계열 핵심 메트릭만 유지
  - source_labels: [__name__]
    regex: 'node_cpu.*|node_memory.*|node_disk.*|node_network.*'
    action: keep
  # go_ 런타임 메트릭은 제거
  - source_labels: [__name__]
    regex: 'go_.*'
    action: drop
```

### 주요 action 유형

릴레이블링 규칙의 동작은 `action` 키가 결정한다. 자주 쓰는 일곱 가지는 다음과 같다.

| Action | 설명 |
| --- | --- |
| `keep` | regex에 매치되는 타겟/메트릭만 유지 |
| `drop` | regex에 매치되는 타겟/메트릭을 제거 |
| `replace` | 레이블 값을 교체 (기본 동작) |
| `labelmap` | regex에 매치되는 레이블 이름을 새 이름으로 매핑 |
| `labeldrop` | regex에 매치되는 레이블을 삭제 |
| `labelkeep` | regex에 매치되는 레이블만 유지 |
| `hashmod` | 해시 기반으로 값을 할당 (샤딩에 사용) |

***

## 7.6 rule_files: 규칙 파일 로딩

`rule_files`는 Recording Rules와 Alerting Rules를 담은 파일의 경로 목록이다. glob 패턴을 지원하므로 디렉토리 단위로 한 번에 불러올 수 있다.

```yaml
rule_files:
  - '/etc/prometheus/rules/recording_rules.yml'
  - '/etc/prometheus/rules/*.yml'   # glob 패턴
```

규칙 파일 자체의 작성법은 Chapter 13-14에서 다룬다. 여기서는 "경로만 지정하면 Prometheus가 알아서 로드한다"는 점만 기억하면 된다.

***

## 7.7 alerting: Alertmanager 연동

`alerting` 섹션은 발동된 알림을 어디로 보낼지 정의한다. Prometheus는 알림을 직접 발송하지 않고 Alertmanager에 넘기기만 한다.

```yaml
alerting:
  alert_relabel_configs:
    - source_labels: [severity]
      regex: 'info'
      action: drop          # severity=info 알림은 전송하지 않음
  alertmanagers:
    - static_configs:
        - targets:
            - 'alertmanager1:9093'
            - 'alertmanager2:9093'
      timeout: 10s
```

`alert_relabel_configs`로 발송 직전 알림에도 릴레이블링을 적용할 수 있다. 위 예시처럼 `severity=info` 알림을 거르는 데 흔히 쓴다.

여러 Alertmanager 인스턴스를 나열하면 고가용성이 확보된다. Prometheus는 **모든** 인스턴스에 알림을 보내고, 중복 제거는 Alertmanager 클러스터가 자체적으로 처리한다. 따라서 하나가 죽어도 알림은 누락되지 않는다.

***

## 7.8 remote_write / remote_read

로컬 TSDB만으로는 장기 보관이나 여러 서버의 통합 뷰가 어렵다. `remote_write`와 `remote_read`는 Thanos, Mimir 같은 원격 스토리지와 Prometheus를 잇는 통로다.

### remote_write

로컬에 저장된 데이터를 원격 스토리지로 밀어낸다. 전송량이 많아 큐 설정으로 처리량을 조절하고, `write_relabel_configs`로 비싼 메트릭을 미리 걸러내는 것이 일반적이다.

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

원격 스토리지에서 데이터를 읽어와 PromQL 쿼리 시 로컬 데이터와 투명하게 합쳐 반환한다. `read_recent: false`로 두면 최근 데이터는 로컬에서, 오래된 데이터만 원격에서 읽어 부하를 줄인다.

```yaml
remote_read:
  - url: 'http://thanos-query:9090/api/v1/read'
    read_recent: false
```

***

## 7.9 설정 재로드

설정을 바꿨다고 Prometheus를 재시작할 필요는 없다. 재시작하면 수집 공백이 생기고 진행 중인 쿼리가 끊긴다. 무중단 재로드 방법은 두 가지이고, 그 전에 반드시 검증을 거쳐야 한다.

| 방법 | 명령 | 전제 조건 |
| --- | --- | --- |
| SIGHUP 신호 | `kill -HUP $(pidof prometheus)` 또는 `systemctl reload prometheus` | 없음 |
| HTTP API | `curl -X POST http://localhost:9090/-/reload` | `--web.enable-lifecycle` 활성화 |
| 사전 검증 | `promtool check config prometheus.yml` | (재로드 전 항상 권장) |

### 재로드 전 검증

리로드 전에는 `promtool check config`로 문법을 확인한다. 운영 중인 서버에 잘못된 설정을 던지기 전에 잡아내는 최후의 안전장치다.

```bash
./promtool check config prometheus.yml
```

```plain
Checking prometheus.yml
 SUCCESS: prometheus.yml is valid prometheus config file syntax
```

설정 파일에 오류가 있으면 **리로드가 거부되고 기존 설정이 그대로 유지된다.** `rule_files`에 지정된 규칙 파일까지 전부 유효해야 리로드가 성공한다. 따라서 잘못된 설정을 밀어넣어도 동작 중인 Prometheus가 멈추지는 않지만, 변경이 반영되지 않았다는 사실을 로그로 확인해야 한다.

***

## 정리

| 섹션 | 역할 | 핵심 포인트 |
| --- | --- | --- |
| `global` | 전역 기본값 | `scrape_interval`(수집 주기) vs `evaluation_interval`(평가 주기), `external_labels`는 외부 전송 시에만 적용 |
| `scrape_configs` | 스크래핑 정의 | `job_name`은 고유, `metrics_path`/`scheme`/인증 설정 |
| `honor_labels` | 레이블 충돌 처리 | Federation/Pushgateway는 `true`, 일반 스크래핑은 `false` |
| `relabel_configs` | 스크래핑 **전** | 대상 필터링, `__meta_*` 가공 |
| `metric_relabel_configs` | 스크래핑 **후** | 카디널리티 제어, 불필요 메트릭 제거 |
| `alerting` | Alertmanager 연동 | 여러 인스턴스에 동시 발송, 중복은 Alertmanager가 처리 |
| `remote_write`/`read` | 원격 스토리지 | 장기 보관·통합 뷰, 큐와 필터링 설정 |
| 재로드 | 무중단 반영 | SIGHUP 또는 HTTP API, 사전에 `promtool check config` |

`prometheus.yml`을 손으로 채울 수 있게 됐지만, `static_configs`로 대상을 일일이 박는 방식은 서버가 수십 대만 넘어가도 무너진다. 다음 [Chapter 8. Service Discovery](/ko/posts/prometheus-grafana-part03-ch08)에서는 Kubernetes, EC2, Consul 같은 동적 환경에서 스크래핑 대상을 자동으로 발견하는 방법을 다룬다.
