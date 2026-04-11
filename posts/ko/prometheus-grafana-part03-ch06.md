---
title: '[Prometheus & Grafana] Chapter 6. 설치'
date: 2026-04-11
description: Prometheus 바이너리 설치와 Docker 설치, 첫 실행 후 웹 UI와 표현식 브라우저 사용법
tags:
  - Prometheus
  - Grafana
  - 모니터링
  - 옵저버빌리티
series: Prometheus & Grafana
seriesOrder: 6
---

> **참고**: 이 글은 Prometheus (v3.2.1)와 Grafana 공식 문서를 기반으로 요약·정리한 내용입니다. 정확한 내용은 공식 문서를 참조해 주세요.
> - [Prometheus 공식 문서](https://prometheus.io/docs/)
> - [Grafana 공식 문서](https://grafana.com/docs/grafana/latest/)

***

Part 03 "실전 구성"이 시작된다. [Chapter 5. Jobs와 Instances](/ko/posts/prometheus-grafana-part02-ch05)까지 Part 02에서 데이터 모델, 메트릭 타입, 스크래핑 구조를 다뤘다. 이론은 충분하다. 이제 Prometheus를 직접 설치하고 실행한다.

***

## 6.1 바이너리 설치

Prometheus는 Go로 작성된 단일 정적 바이너리다. 외부 의존성이 없으므로 다운로드 후 바로 실행할 수 있다.

### 다운로드

공식 릴리스 페이지(https://prometheus.io/download/)에서 운영체제와 아키텍처에 맞는 바이너리를 받는다.

```bash
# Linux amd64 예시
wget https://github.com/prometheus/prometheus/releases/download/v3.2.1/prometheus-3.2.1.linux-amd64.tar.gz

# 압축 해제
tar xvfz prometheus-3.2.1.linux-amd64.tar.gz
cd prometheus-3.2.1.linux-amd64
```

### 디렉토리 구조

압축을 해제하면 다음 파일들이 포함되어 있다.

```plain
prometheus-3.2.1.linux-amd64/
├── prometheus          ← Prometheus 서버 바이너리
├── promtool            ← 설정 검증 및 관리 도구
├── prometheus.yml      ← 기본 설정 파일
├── consoles/           ← 콘솔 템플릿
├── console_libraries/  ← 콘솔 라이브러리
├── LICENSE
└── NOTICE
```

핵심은 세 가지다. `prometheus` 바이너리, 설정 검증용 `promtool`, 그리고 기본 설정 파일 `prometheus.yml`. 나머지는 콘솔 UI 관련 파일과 라이선스다.

### 실행

```bash
# 기본 설정으로 실행
./prometheus --config.file=prometheus.yml

# 주요 플래그
./prometheus \
  --config.file=prometheus.yml \
  --storage.tsdb.path=/var/lib/prometheus/data \
  --storage.tsdb.retention.time=30d \
  --web.listen-address=:9090 \
  --web.enable-lifecycle
```

### 주요 커맨드라인 플래그

| 플래그 | 기본값 | 설명 |
| --- | --- | --- |
| `--config.file` | `prometheus.yml` | 설정 파일 경로 |
| `--storage.tsdb.path` | `data/` | TSDB 데이터 저장 경로 |
| `--storage.tsdb.retention.time` | `15d` | 데이터 보관 기간 |
| `--storage.tsdb.retention.size` | `0` (무제한) | 최대 저장소 크기 |
| `--web.listen-address` | `:9090` | 웹 UI/API 리스닝 주소 |
| `--web.enable-lifecycle` | `false` | HTTP를 통한 설정 리로드 활성화 |
| `--web.enable-remote-write-receiver` | `false` | 원격 쓰기 수신 활성화 |

`--storage.tsdb.retention.time`과 `--storage.tsdb.retention.size`를 동시에 지정하면, 둘 중 **먼저 도달하는 조건**에 의해 오래된 데이터가 삭제된다. 기본값은 15일이므로 프로덕션에서는 환경에 맞게 조정해야 한다.

### systemd 서비스 등록

프로덕션 환경에서는 systemd로 관리하는 것이 일반적이다.

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
# 서비스 등록 및 시작
sudo systemctl daemon-reload
sudo systemctl enable prometheus
sudo systemctl start prometheus
sudo systemctl status prometheus
```

`ExecReload`에 `kill -HUP`을 설정해두면 `systemctl reload prometheus`로 설정 파일을 재적용할 수 있다. `--web.enable-lifecycle`을 활성화했다면 `curl -X POST http://localhost:9090/-/reload`로도 동일한 리로드가 가능하다.

***

## 6.2 Docker 컨테이너 설치

Docker를 사용하면 바이너리 설치 없이 바로 실행할 수 있다.

### 기본 실행

```bash
docker run -d \
  --name prometheus \
  -p 9090:9090 \
  prom/prometheus
```

이 한 줄이면 Prometheus가 기본 설정으로 동작한다. 테스트 용도로는 충분하다.

### 커스텀 설정 파일 마운트

실제 운영에서는 자체 설정 파일과 데이터 볼륨을 마운트한다.

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

### docker-compose 사용

여러 서비스를 함께 관리할 때는 docker-compose가 편리하다.

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

바이너리 설치와 Docker 설치는 기능상 차이가 없다. 이미 Docker 기반 인프라를 운영하고 있다면 Docker가 자연스럽고, 그렇지 않다면 바이너리 + systemd 조합이 더 단순하다.

***

## 6.3 첫 실행과 상태 페이지 확인

Prometheus를 시작한 후 브라우저에서 `http://localhost:9090`에 접속하면 웹 UI가 열린다.

### Status > Targets

`http://localhost:9090/targets` 페이지에서 현재 스크래핑 대상의 상태를 확인할 수 있다. 기본 설정으로 실행했다면 Prometheus 자기 자신 하나만 보인다.

| 컬럼 | 설명 |
| --- | --- |
| Endpoint | 스크래핑 대상의 URL |
| State | UP (정상) 또는 DOWN (실패) |
| Labels | 대상에 적용된 레이블 |
| Last Scrape | 마지막 스크래핑 시각 |
| Scrape Duration | 스크래핑 소요 시간 |
| Error | 오류 메시지 (실패 시) |

State가 **UP**이면 정상이다. DOWN이면 Error 컬럼에서 원인을 확인한다.

### Status > Configuration

`http://localhost:9090/config` 페이지에서 현재 적용된 설정 파일의 내용을 확인할 수 있다. 설정 변경 후 제대로 반영되었는지 확인하는 데 유용하다.

### Status > Runtime & Build Information

Prometheus 버전, Go 버전, 빌드 정보, 저장소 정보 등을 확인할 수 있다. 디버깅이나 이슈 리포트 시 필요한 정보가 여기 모여 있다.

***

## 6.4 표현식 브라우저 사용법

`http://localhost:9090/query` (또는 메인 페이지의 Graph 탭)에서 PromQL 쿼리를 직접 실행할 수 있다. Prometheus의 내장 쿼리 인터페이스다.

### Table 탭

Instant Query의 결과를 테이블 형태로 보여준다.

```promql
# Prometheus 자체의 HTTP 요청 수 조회
prometheus_http_requests_total
```

결과:

```plain
prometheus_http_requests_total{code="200", handler="/api/v1/query", ...}    142
prometheus_http_requests_total{code="200", handler="/metrics", ...}          89
prometheus_http_requests_total{code="200", handler="/targets", ...}          12
```

각 레이블 조합별로 별도의 타임시리즈가 표시된다.

### Graph 탭

Range Query의 결과를 시간축 그래프로 보여준다. 시간 범위를 조절할 수 있다.

```promql
# 최근 1시간 동안의 초당 요청률
rate(prometheus_http_requests_total[5m])
```

Table 탭은 현재 시점의 스냅샷, Graph 탭은 시간에 따른 변화 추이를 보는 용도다.

### 유용한 첫 쿼리들

Prometheus는 기본 설정에서 자기 자신을 스크래핑한다. 별도 설정 없이도 아래 쿼리들을 바로 실행할 수 있다.

| 쿼리 | 설명 |
| --- | --- |
| `up` | 모든 대상의 상태 확인 |
| `process_resident_memory_bytes` | Prometheus 자체의 메모리 사용량 |
| `prometheus_tsdb_head_series` | 저장된 시계열 수 |
| `scrape_duration_seconds` | 스크래핑 소요 시간 |
| `prometheus_target_interval_length_seconds` | 설정된 스크래핑 간격이 지켜지고 있는지 |

```promql
# 1. 모든 대상의 상태 확인
up

# 2. Prometheus 자체의 메모리 사용량
process_resident_memory_bytes

# 3. 저장된 시계열 수
prometheus_tsdb_head_series

# 4. 스크래핑 간격 분포
scrape_duration_seconds

# 5. 설정된 스크래핑 간격이 지켜지고 있는지
prometheus_target_interval_length_seconds
```

### promtool을 이용한 쿼리

웹 UI 없이 커맨드라인에서도 쿼리를 실행할 수 있다.

```bash
# instant query
./promtool query instant http://localhost:9090 'up'

# range query
./promtool query range http://localhost:9090 'rate(prometheus_http_requests_total[5m])' \
  --start='2026-03-26T00:00:00Z' \
  --end='2026-03-26T01:00:00Z' \
  --step=15s
```

`promtool query instant`는 현재 시점의 값을, `promtool query range`는 지정한 시간 범위의 값을 반환한다. CI/CD 파이프라인이나 스크립트에서 Prometheus 데이터를 조회할 때 유용하다.

***

## 정리

| 항목 | 내용 |
| --- | --- |
| 바이너리 설치 | Go 정적 바이너리, 외부 의존성 없음, systemd 등록 권장 |
| Docker 설치 | `prom/prometheus` 이미지, 설정 파일과 데이터 볼륨 마운트 |
| 웹 UI | `localhost:9090`, Targets/Configuration/Runtime 상태 확인 |
| 표현식 브라우저 | Table (Instant Query) / Graph (Range Query) |
| promtool | CLI 기반 쿼리, instant/range 지원 |

Prometheus가 실행되고 웹 UI에서 `up` 쿼리가 `1`을 반환하면 설치는 완료된 것이다. 다음 [Chapter 7. 설정 파일 (prometheus.yml)](/ko/posts/prometheus-grafana-part03-ch07)에서는 `prometheus.yml`의 구조와 스크래핑 설정을 다룬다.
