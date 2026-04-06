---
title: '[Prometheus & Grafana] Chapter 5. Jobs와 Instances'
date: 2026-04-06
description: Prometheus의 스크래핑 단위인 Job과 Instance의 관계, 자동 생성 레이블과 메트릭, Part 02 핵심 정리
tags:
  - Prometheus
  - Grafana
  - 모니터링
  - 옵저버빌리티
series: Prometheus & Grafana
seriesOrder: 5
---

> **참고**: 이 글은 Prometheus (v3.2.1)와 Grafana 공식 문서를 기반으로 요약·정리한 내용입니다. 정확한 내용은 공식 문서를 참조해 주세요.
> - [Prometheus 공식 문서](https://prometheus.io/docs/)
> - [Grafana 공식 문서](https://grafana.com/docs/grafana/latest/)

***

[Chapter 4. 메트릭 타입](/ko/posts/prometheus-grafana-part02-ch04)에서 Counter, Gauge, Histogram, Summary를 다뤘다. 이제 남은 질문은 "그 메트릭을 어디서 가져오는가"다. Prometheus가 메트릭을 수집하는 단위가 바로 **Instance**와 **Job**이다.

***

## 5.1 Instance: 스크래핑 엔드포인트

Instance는 Prometheus가 스크래핑할 수 있는 단일 엔드포인트다. 일반적으로 하나의 프로세스에 해당하며, `<host>:<port>` 형식으로 식별한다.

```plain
localhost:9090        <- Prometheus 자체
10.0.1.5:9100        <- Node Exporter
10.0.1.5:4000        <- 웹 애플리케이션
```

하나의 호스트에서 여러 프로세스가 각각 다른 포트로 메트릭을 노출하면, 각각이 별도의 Instance다. 위 예시에서 `10.0.1.5`라는 동일한 호스트에 `:9100`과 `:4000` 두 개의 Instance가 존재한다.

***

## 5.2 Job: 동일 목적 인스턴스 그룹

Job은 동일한 목적으로 복제된 여러 Instance의 **논리적 그룹**이다. 예를 들어 같은 API 서버를 수평 확장해서 4대 운영한다면, 4개의 Instance가 하나의 Job에 속한다.

```yaml
scrape_configs:
  - job_name: 'api-server'
    static_configs:
      - targets:
          - '10.0.1.5:5670'
          - '10.0.1.5:5671'
          - '10.0.2.5:5670'
          - '10.0.2.5:5671'
```

트리 구조로 보면 관계가 명확하다.

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

Job은 스크래핑 설정의 기본 단위이면서, 동시에 쿼리 시 집계의 기본 단위이기도 하다. `up{job="api-server"}`와 같이 Job 레이블로 특정 서비스 전체의 상태를 한번에 조회할 수 있다.

***

## 5.3 자동 생성 레이블: job, instance

Prometheus는 타겟을 스크래핑할 때 **두 개의 레이블을 자동으로 추가**한다. 사용자가 직접 설정하지 않아도 모든 메트릭에 붙는다.

| 레이블 | 값 | 예시 |
| --- | --- | --- |
| `job` | `job_name` 설정값 | `api-server` |
| `instance` | `<host>:<port>` | `10.0.1.5:5670` |

수집된 메트릭은 다음과 같은 형태가 된다.

```plain
http_requests_total{job="api-server", instance="10.0.1.5:5670", method="GET"} = 1234
http_requests_total{job="api-server", instance="10.0.1.5:5671", method="GET"} = 5678
```

동일한 메트릭 이름이라도 `instance` 레이블이 다르면 별개의 타임시리즈다. [Chapter 3. 데이터 모델](/ko/posts/prometheus-grafana-part02-ch03)에서 다뤘던 타임시리즈 식별 원칙이 여기에도 그대로 적용된다.

### honor_labels

스크래핑 대상이 이미 `job`이나 `instance` 레이블을 자체적으로 노출하는 경우가 있다. 이때 Prometheus가 자동 생성하는 레이블과 충돌이 발생한다. `honor_labels` 설정이 이 충돌을 제어한다.

| honor_labels | 동작 |
| --- | --- |
| `false` (기본값) | 대상의 레이블을 `exported_job`, `exported_instance`로 변경 |
| `true` | 대상의 레이블을 그대로 사용 |

Federation 환경에서는 하위 Prometheus가 이미 올바른 `job`, `instance` 레이블을 가지고 있으므로 `honor_labels: true`를 사용하는 것이 일반적이다.

***

## 5.4 자동 생성 메트릭

Prometheus는 스크래핑할 때마다 메트릭 데이터와 함께 **스크래핑 자체에 대한 메타 메트릭**도 자동으로 생성한다.

### up 메트릭

가장 중요한 자동 생성 메트릭이다. 각 타겟의 스크래핑 성공 여부를 나타낸다.

| 값 | 의미 |
| --- | --- |
| `1` | 스크래핑 성공 |
| `0` | 스크래핑 실패 |

`up` 메트릭은 가장 기본적인 헬스체크 수단이다. 모니터링 시스템을 구축하면 가장 먼저 설정하게 되는 알림이 바로 `up == 0`이다.

```promql
# 다운된 인스턴스 조회
up == 0

# api-server Job의 평균 가용률
avg(up{job="api-server"})

# 알림 규칙 예시: 5분 이상 다운 시 발동
# alert: InstanceDown
# expr: up == 0
# for: 5m
```

### 기타 자동 생성 메트릭

스크래핑 성능과 상태를 추적하기 위한 메트릭도 함께 생성된다.

| 메트릭 | 설명 |
| --- | --- |
| `scrape_duration_seconds` | 스크래핑 소요 시간 |
| `scrape_samples_scraped` | 수집된 샘플 수 |
| `scrape_samples_post_metric_relabeling` | 릴레이블링 후 남은 샘플 수 |
| `scrape_series_added` | 새로 추가된 시계열 수 (v2.10+) |

`extra-scrape-metrics` Feature Flag를 활성화하면 추가 메트릭도 수집할 수 있다.

| 메트릭 | 설명 |
| --- | --- |
| `scrape_timeout_seconds` | 설정된 스크래핑 타임아웃 |
| `scrape_sample_limit` | 설정된 샘플 제한 |
| `scrape_body_size_bytes` | 최근 응답의 압축 해제 크기 |

### 실무 활용 PromQL

자동 생성 메트릭을 활용한 실무 쿼리 예시다.

```promql
# 스크래핑이 3초 이상 걸리는 타겟 — 성능 병목 후보
scrape_duration_seconds > 3

# 1시간 전 대비 샘플 수가 2배 이상 증가한 타겟 — 카디널리티 폭발 감지
scrape_samples_scraped / scrape_samples_scraped offset 1h > 2

# Job별 정상 인스턴스 수
count by (job) (up == 1)

# Job별 다운 인스턴스 수
count by (job) (up == 0)
```

특히 두 번째 쿼리는 실무에서 유용하다. 배포 직후 메트릭 수가 급격히 늘어나면 카디널리티 문제의 신호일 수 있다.

***

## Part 02 핵심 정리

Part 02에서 다룬 데이터 모델, 메트릭 타입, Jobs와 Instances를 한 테이블로 정리한다.

| 개념 | 정의 | 핵심 포인트 |
| --- | --- | --- |
| 타임시리즈 | 메트릭 이름 + 레이블로 식별되는 시간순 값 | Prometheus의 기본 데이터 단위 |
| 메트릭 이름 | 측정 대상을 표현 | 접두사 + base unit + 접미사 규칙 |
| 레이블 | 다차원 구분을 위한 키-값 쌍 | 카디널리티 관리 필수 |
| Counter | 단조 증가 누적값 | `rate()`와 함께 사용, `_total` 접미사 |
| Gauge | 증감 가능한 순간값 | 직접 조회 가능, `predict_linear()` 사용 |
| Histogram | 버킷 기반 분포 | 서버 측 집계 가능, `histogram_quantile()` |
| Summary | 클라이언트 측 quantile | 집계 불가, 정확한 quantile |
| Job | 동일 목적 인스턴스 그룹 | 자동 `job` 레이블 |
| Instance | 스크래핑 엔드포인트 | 자동 `instance` 레이블, `up` 메트릭 |

Part 02를 통해 Prometheus가 데이터를 어떤 구조로 저장하고, 어떤 타입으로 분류하며, 어디서 수집하는지를 다뤘다. 다음 Part 03에서는 Prometheus를 직접 설치하고 설정하는 과정을 다룬다.
