---
title: '[Prometheus & Grafana] Chapter 10. PromQL 연산자와 집계'
date: 2026-06-12
description: 산술·비교·논리 연산자부터 벡터 매칭(on/ignoring, group_left), 집계 연산자와 by/without, 연산자 우선순위까지
tags:
  - Prometheus
  - Grafana
  - 모니터링
  - 옵저버빌리티
series: Prometheus & Grafana
seriesOrder: 10
---

> **참고**: 이 글은 Prometheus (v3.2.1)와 Grafana 공식 문서를 기반으로 요약·정리한 내용입니다. 정확한 내용은 공식 문서를 참조해 주세요.
> - [Prometheus 공식 문서](https://prometheus.io/docs/)
> - [Grafana 공식 문서](https://grafana.com/docs/grafana/latest/)

***

[Chapter 9. PromQL 기초](/ko/posts/prometheus-grafana-part04-ch09)에서 시계열을 골라내고 시간 축을 다루는 법을 익혔다. 하지만 그때까지의 쿼리는 데이터를 *선택*만 했다. 더하거나 비교하거나 합산하지는 못했다. "전체 노드의 CPU 평균", "서비스별 에러율 합계" 같은 진짜 질문에 답하려면 연산이 필요하다.

연산자는 PromQL의 표현력을 결정짓는 핵심이다. 이 장에서는 산술·비교·논리 연산자를 차례로 본 뒤, PromQL을 진짜 어렵게 만드는 지점인 **벡터 매칭**으로 들어간다. 그리고 여러 시계열을 하나로 묶는 집계 연산자와 `by`/`without`, 마지막으로 연산자 우선순위를 정리한다.

***

## 10.1 산술 연산자

기본 산술 연산자는 다음과 같다.

| 연산자 | 의미 |
| --- | --- |
| `+` | 덧셈 |
| `-` | 뺄셈 |
| `*` | 곱셈 |
| `/` | 나눗셈 |
| `%` | 나머지 (modulo) |
| `^` | 거듭제곱 |

중요한 건 연산자 자체가 아니라 **피연산자의 타입 조합**이다. 스칼라끼리, 벡터와 스칼라, 벡터끼리 — 세 경우의 동작이 다르다.

**스칼라 × 스칼라**의 결과는 스칼라다.

```plain
2 + 3        # → 5
10 / 3       # → 3.333...
2 ^ 10       # → 1024
```

**벡터 × 스칼라**는 벡터의 각 요소에 스칼라 연산을 적용한다. 단위 변환에 자주 쓴다.

```plain
# 바이트를 MB로 변환
node_memory_MemAvailable_bytes / 1024 / 1024

# 비율을 백분율로 변환
http_error_ratio * 100
```

**벡터 × 벡터**는 레이블이 일치하는 요소끼리만 연산한다. 이것이 다음 절들에서 깊이 파고들 **벡터 매칭**이다.

```plain
# 에러율 = 에러 수 / 전체 요청 수
rate(http_errors_total[5m]) / rate(http_requests_total[5m])
```

### 메트릭 이름은 사라진다

산술 연산의 결과에서는 **메트릭 이름(`__name__`)이 삭제**된다. 두 메트릭을 나눈 값은 더 이상 원래 메트릭의 의미를 갖지 않기 때문이다. `http_errors_total`을 `http_requests_total`로 나눈 결과는 "에러 수"도 "요청 수"도 아니다.

```plain
# 원본: http_errors_total / http_requests_total
# 결과에는 __name__ 레이블이 없다
# → {method="GET", status="500"} = 0.02
```

***

## 10.2 비교 연산자

| 연산자 | 의미 |
| --- | --- |
| `==` | 같음 |
| `!=` | 다름 |
| `>` | 초과 |
| `<` | 미만 |
| `>=` | 이상 |
| `<=` | 이하 |

비교 연산자의 기본 동작은 직관과 다르다. true/false를 돌려주는 게 아니라 **조건을 만족하지 않는 요소를 결과에서 제거**한다. 즉 비교는 곧 **필터**다.

```plain
# 메모리가 1GB 미만인 인스턴스만 반환
node_memory_MemAvailable_bytes < 1073741824

# 다운된 인스턴스만 반환
up == 0
```

`up == 0`이 단순히 "참" 한 줄을 뱉는 게 아니라 **다운된 대상의 시계열만 남긴다**는 점이 핵심이다. 알림 규칙이 이 동작 위에 세워진다.

### bool 수정자

필터링이 아니라 진짜 1/0 값을 원할 때는 `bool` 수정자를 붙인다.

```plain
# 필터링 모드 — 1000 초과인 시계열만 남음
http_requests_total > 1000

# bool 모드 — 모든 시계열이 남되, 값이 0 또는 1로 바뀜
http_requests_total > bool 1000
```

**스칼라 × 스칼라** 비교에서는 `bool`이 필수다. 필터링할 시계열이 없으니 값으로 답할 수밖에 없기 때문이다.

```plain
1 > bool 2    # → 0  (올바름)
1 > 2         # → 에러
```

***

## 10.3 논리/집합 연산자

인스턴트 벡터끼리만 쓸 수 있는 집합 연산자다. 값이 아니라 **레이블 셋의 존재 여부**로 동작한다.

| 연산자 | 의미 | 동작 |
| --- | --- | --- |
| `and` | 교집합 | 오른쪽에 매칭되는 레이블 셋이 있는 왼쪽 요소만 |
| `or` | 합집합 | 왼쪽 전부 + 왼쪽에 없는 오른쪽 요소 |
| `unless` | 차집합 | 오른쪽에 매칭되는 요소를 뺀 왼쪽 |

`and`는 두 조건을 동시에 만족하는 시계열을 추릴 때 쓴다. 값은 항상 왼쪽 것을 유지한다.

```plain
# 에러가 있으면서(and) 동시에 트래픽도 높은 서비스
rate(http_errors_total[5m]) > 0.1
  and
rate(http_requests_total[5m]) > 100
```

`unless`는 제외에 유용하다.

```plain
# 살아있는 인스턴스 중 유지보수 대상은 제외
up == 1
  unless
maintenance_mode == 1
```

***

## 10.4 벡터 매칭 — PromQL의 진짜 난관

벡터 × 벡터 연산이 어려운 이유는 "어떤 요소와 어떤 요소를 짝지을 것인가"가 자명하지 않기 때문이다. 기본 규칙은 단순하다. **양쪽의 모든 레이블이 같아야 짝이 된다.** 문제는 현실의 두 메트릭이 레이블 구성이 다를 때다.

### on()과 ignoring()

매칭 기준 레이블을 직접 지정한다. `on()`은 "이 레이블들로만 매칭", `ignoring()`은 "이 레이블만 빼고 매칭"이다.

```plain
# method 레이블만으로 매칭
rate(http_errors_total[5m]) / on(method) rate(http_requests_total[5m])

# status 레이블만 무시하고 나머지로 매칭
rate(http_errors_total[5m]) / ignoring(status) rate(http_requests_total[5m])
```

대개 한쪽 메트릭에만 있는 레이블(위 예시의 `status`) 때문에 매칭이 깨진다. 그 레이블을 `ignoring`으로 빼주면 짝이 맞는다.

***

## 10.5 일대일 vs 다대일 매칭

기본 매칭은 **일대일(one-to-one)**이다. 양쪽에서 하나의 요소가 정확히 하나와 짝지어진다. 하지만 한쪽에 요소가 더 많은 상황이 흔하다.

상황을 보자. 왼쪽 에러 메트릭은 `status`별로 쪼개져 있는데, 오른쪽 요청 메트릭은 `method` 단위로만 집계돼 있다.

```plain
# 왼쪽 (errors): method + status 조합이 여러 개
http_errors_total{method="GET", status="404"} = 100
http_errors_total{method="GET", status="500"} = 50

# 오른쪽 (requests): method만
http_requests_total{method="GET"} = 10000
```

오른쪽 하나가 왼쪽 여럿과 짝지어져야 한다. 이때 **`group_left`**를 쓴다. "왼쪽이 many 쪽"이라는 표시다.

```plain
# 에러 코드별 에러율
rate(http_errors_total[5m])
  / ignoring(status) group_left
rate(http_requests_total[5m])

# 결과:
# {method="GET", status="404"} → 100/10000 = 0.01
# {method="GET", status="500"} → 50/10000  = 0.005
```

| 수정자 | 의미 | 비고 |
| --- | --- | --- |
| (없음) | 일대일 | 기본값 |
| `group_left` | 왼쪽이 many | 실무에서 대부분 |
| `group_right` | 오른쪽이 many | 드물게 사용 |

### "one" 쪽 레이블을 결과에 붙이기

`group_left(label)` 형태로 매칭의 "one" 쪽에서 추가 레이블을 결과에 끌어올 수 있다. 메타데이터 메트릭과 조인할 때 핵심 패턴이다.

```plain
# service_info에서 team 레이블을 결과에 추가
rate(http_requests_total[5m])
  * on(service) group_left(team)
service_info
```

***

## 10.6 집계 연산자

지금까지가 시계열 *간의* 연산이었다면, 집계는 여러 시계열을 *하나로 묶는다*. 모니터링 쿼리의 대부분이 여기서 나온다.

| 연산자 | 설명 |
| --- | --- |
| `sum()` | 합계 |
| `avg()` | 산술 평균 |
| `min()` / `max()` | 최소 / 최대 |
| `count()` | 요소 개수 |
| `stddev()` / `stdvar()` | 표준편차 / 분산 |
| `quantile(φ)` | φ-분위수 |
| `topk(k, v)` / `bottomk(k, v)` | 상위 / 하위 k개 |
| `count_values("label", v)` | 각 고유값별 개수 |

```plain
# 전체 요청률 합계
sum(rate(http_requests_total[5m]))

# Job별 평균 메모리
avg by (job) (process_resident_memory_bytes)

# 요청이 가장 많은 상위 5개 핸들러
topk(5, sum by (handler) (rate(http_requests_total[5m])))
```

***

## 10.7 by와 without

집계는 기본적으로 **모든 레이블을 없애고** 단일 값으로 뭉친다. 어떤 레이블을 살릴지는 `by`와 `without`으로 정한다. 둘은 정반대 방향이다.

```plain
# by: 지정한 레이블만 남긴다
sum by (method, status) (rate(http_requests_total[5m]))

# without: 지정한 레이블만 없앤다
sum without (instance) (rate(http_requests_total[5m]))
```

| 방식 | 의미 | 적합한 상황 |
| --- | --- | --- |
| `by` | 지정 레이블만 유지 | 살릴 레이블이 적을 때 |
| `without` | 지정 레이블만 제거 | 없앨 레이블이 적을 때 |

**대개 `by`가 더 안전하다.** 나중에 새 레이블이 추가돼도 `by`는 영향을 받지 않지만, `without`은 예상치 못한 레이블이 결과에 끼어들 수 있다.

***

## 10.8 연산자 우선순위

복잡한 표현식에서는 우선순위가 결과를 바꾼다. 높은 것부터 낮은 순서다.

| 우선순위 | 연산자 | 결합 방향 |
| --- | --- | --- |
| 1 (최고) | `^` | **우결합** |
| 2 | `*` `/` `%` `atan2` | 좌결합 |
| 3 | `+` `-` | 좌결합 |
| 4 | `==` `!=` `<=` `<` `>=` `>` | 좌결합 |
| 5 | `and` `unless` | 좌결합 |
| 6 (최저) | `or` | 좌결합 |

특히 `^`는 혼자 **우결합**이라 주의해야 한다.

```plain
2 ^ 3 ^ 2
# = 2 ^ (3 ^ 2) = 2 ^ 9 = 512   (실제)
# = (2 ^ 3) ^ 2 = 8 ^ 2 = 64    (좌결합이었다면)
```

외우는 것보다 **괄호를 쓰는 편이 낫다.** 우선순위에 기대 쓴 쿼리는 읽는 사람이 매번 머릿속으로 우선순위를 재생해야 한다.

```plain
# 괄호 없이 — 우선순위를 기억해야 함
rate(errors[5m]) / rate(requests[5m]) * 100 > 5

# 괄호 사용 — 의도가 명확함
(rate(errors[5m]) / rate(requests[5m])) * 100 > 5
```

***

## 정리

| 항목 | 핵심 |
| --- | --- |
| 산술 연산 | 피연산자 타입 조합이 동작을 결정, 결과에서 `__name__` 삭제 |
| 비교 연산 | 기본은 **필터**(조건 불만족 제거), 값이 필요하면 `bool` |
| 논리 연산 | `and`/`or`/`unless` — 값이 아니라 레이블 셋 존재로 동작 |
| 벡터 매칭 | 기본은 전 레이블 일치, `on()`/`ignoring()`으로 기준 지정 |
| 다대일 매칭 | `group_left`로 many 쪽 지정, `group_left(label)`로 레이블 끌어오기 |
| 집계 | `sum`·`avg`·`topk` 등으로 여러 시계열을 하나로 |
| `by`/`without` | 살릴 레이블 지정 vs 없앨 레이블 지정, 보통 `by`가 안전 |
| 우선순위 | `^`만 우결합, 복잡하면 괄호로 의도 고정 |

연산자와 집계까지 익히면 "서비스별 에러율", "상위 5개 느린 엔드포인트" 같은 실전 질문에 답할 수 있다. 다음 [Chapter 11. PromQL 함수](/ko/posts/prometheus-grafana-part04-ch11)에서는 `rate`·`increase`·`histogram_quantile`처럼 레인지 벡터를 다루고 시간 흐름을 계산하는 함수들을 본격적으로 파고든다.
