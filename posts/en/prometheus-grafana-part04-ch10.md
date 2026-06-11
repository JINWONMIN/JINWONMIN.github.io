---
title: '[Prometheus & Grafana] Chapter 10. PromQL Operators and Aggregation'
date: 2026-06-12
description: From arithmetic, comparison, and logical operators to vector matching (on/ignoring, group_left), aggregation operators with by/without, and operator precedence
tags:
  - Prometheus
  - Grafana
  - Monitoring
  - Observability
series: Prometheus & Grafana
seriesOrder: 10
---

> **Note**: This post is a summary based on the official Prometheus (v3.2.1) and Grafana documentation. For precise details, please refer to the official docs.
> - [Prometheus Official Docs](https://prometheus.io/docs/)
> - [Grafana Official Docs](https://grafana.com/docs/grafana/latest/)

***

In [Chapter 9. PromQL Basics](/en/posts/prometheus-grafana-part04-ch09) we learned how to select time series and work with the time axis. But up to that point, the queries only *selected* data. They couldn't add, compare, or sum. To answer real questions like "the average CPU across all nodes" or "the total error rate per service," you need operations.

Operators are what give PromQL its expressive power. This chapter walks through arithmetic, comparison, and logical operators in turn, then moves into the part that makes PromQL genuinely hard: **vector matching**. After that comes the aggregation operators that collapse many series into one, along with `by`/`without`, and finally operator precedence.

***

## 10.1 Arithmetic Operators

The basic arithmetic operators are these.

| Operator | Meaning |
| --- | --- |
| `+` | Addition |
| `-` | Subtraction |
| `*` | Multiplication |
| `/` | Division |
| `%` | Modulo |
| `^` | Exponentiation |

What matters isn't the operators themselves but the **combination of operand types**. Scalar to scalar, vector to scalar, and vector to vector all behave differently.

**Scalar × scalar** yields a scalar.

```plain
2 + 3        # → 5
10 / 3       # → 3.333...
2 ^ 10       # → 1024
```

**Vector × scalar** applies the scalar operation to each element of the vector. Common for unit conversion.

```plain
# Convert bytes to MB
node_memory_MemAvailable_bytes / 1024 / 1024

# Convert a ratio to a percentage
http_error_ratio * 100
```

**Vector × vector** operates only on elements whose labels match. This is the **vector matching** the following sections dig into.

```plain
# error rate = errors / total requests
rate(http_errors_total[5m]) / rate(http_requests_total[5m])
```

### The metric name disappears

In the result of an arithmetic operation, the **metric name (`__name__`) is dropped**. The value of dividing two metrics no longer carries the meaning of either original metric. Dividing `http_errors_total` by `http_requests_total` gives neither an "error count" nor a "request count."

```plain
# Original: http_errors_total / http_requests_total
# The result has no __name__ label
# → {method="GET", status="500"} = 0.02
```

***

## 10.2 Comparison Operators

| Operator | Meaning |
| --- | --- |
| `==` | Equal |
| `!=` | Not equal |
| `>` | Greater than |
| `<` | Less than |
| `>=` | Greater or equal |
| `<=` | Less or equal |

The default behavior is counterintuitive. Rather than returning true/false, a comparison **removes the elements that don't satisfy the condition**. In other words, a comparison is a **filter**.

```plain
# Return only instances with less than 1GB of memory
node_memory_MemAvailable_bytes < 1073741824

# Return only instances that are down
up == 0
```

The key point is that `up == 0` doesn't simply emit a single "true" — it **keeps only the time series of targets that are down**. Alerting rules are built on top of this behavior.

### The bool modifier

When you want actual 1/0 values rather than filtering, add the `bool` modifier.

```plain
# Filtering mode — only series above 1000 survive
http_requests_total > 1000

# bool mode — all series survive, but values become 0 or 1
http_requests_total > bool 1000
```

For **scalar × scalar** comparisons, `bool` is mandatory. There are no time series to filter, so it can only answer with a value.

```plain
1 > bool 2    # → 0  (correct)
1 > 2         # → error
```

***

## 10.3 Logical / Set Operators

These set operators work only between instant vectors. They operate on **the presence of label sets**, not on values.

| Operator | Meaning | Behavior |
| --- | --- | --- |
| `and` | Intersection | Left elements that have a matching label set on the right |
| `or` | Union | All of the left + right elements not present on the left |
| `unless` | Difference | Left minus the elements matched on the right |

`and` narrows to series that satisfy two conditions at once. The value always comes from the left side.

```plain
# Services with errors AND high traffic at the same time
rate(http_errors_total[5m]) > 0.1
  and
rate(http_requests_total[5m]) > 100
```

`unless` is handy for exclusion.

```plain
# Live instances, excluding maintenance targets
up == 1
  unless
maintenance_mode == 1
```

***

## 10.4 Vector Matching — PromQL's Real Hurdle

Vector × vector operations are hard because "which element pairs with which" isn't obvious. The basic rule is simple: **all labels on both sides must match to form a pair.** The trouble starts when two real-world metrics have different label structures.

### on() and ignoring()

These let you specify the matching labels directly. `on()` means "match on these labels only," `ignoring()` means "match on everything except these."

```plain
# Match on the method label only
rate(http_errors_total[5m]) / on(method) rate(http_requests_total[5m])

# Ignore the status label, match on the rest
rate(http_errors_total[5m]) / ignoring(status) rate(http_requests_total[5m])
```

Usually matching breaks because of a label that exists on only one side (`status` above). Drop it with `ignoring` and the pairs line up.

***

## 10.5 One-to-One vs. Many-to-One Matching

The default matching is **one-to-one**: one element on each side pairs with exactly one on the other. But it's common for one side to have more elements.

Consider this. The left error metric is split by `status`, while the right request metric is aggregated only by `method`.

```plain
# Left (errors): multiple method + status combinations
http_errors_total{method="GET", status="404"} = 100
http_errors_total{method="GET", status="500"} = 50

# Right (requests): method only
http_requests_total{method="GET"} = 10000
```

One element on the right must pair with several on the left. This is where **`group_left`** comes in. It marks "the left is the many side."

```plain
# Error rate per error code
rate(http_errors_total[5m])
  / ignoring(status) group_left
rate(http_requests_total[5m])

# Result:
# {method="GET", status="404"} → 100/10000 = 0.01
# {method="GET", status="500"} → 50/10000  = 0.005
```

| Modifier | Meaning | Note |
| --- | --- | --- |
| (none) | One-to-one | Default |
| `group_left` | Left is many | Most common in practice |
| `group_right` | Right is many | Rarely used |

### Pulling "one"-side labels into the result

With the `group_left(label)` form, you can carry extra labels from the "one" side into the result. This is the key pattern for joining against a metadata metric.

```plain
# Add the team label from service_info to the result
rate(http_requests_total[5m])
  * on(service) group_left(team)
service_info
```

***

## 10.6 Aggregation Operators

If everything so far was operations *between* series, aggregation *collapses* many series into one. Most monitoring queries come from here.

| Operator | Description |
| --- | --- |
| `sum()` | Sum |
| `avg()` | Arithmetic mean |
| `min()` / `max()` | Minimum / maximum |
| `count()` | Number of elements |
| `stddev()` / `stdvar()` | Standard deviation / variance |
| `quantile(φ)` | φ-quantile |
| `topk(k, v)` / `bottomk(k, v)` | Top / bottom k |
| `count_values("label", v)` | Count per distinct value |

```plain
# Total request rate
sum(rate(http_requests_total[5m]))

# Average memory per job
avg by (job) (process_resident_memory_bytes)

# Top 5 handlers by request volume
topk(5, sum by (handler) (rate(http_requests_total[5m])))
```

***

## 10.7 by and without

Aggregation, by default, **strips all labels** and collapses to a single value. You decide which labels to keep with `by` and `without`. The two work in opposite directions.

```plain
# by: keep only the specified labels
sum by (method, status) (rate(http_requests_total[5m]))

# without: remove only the specified labels
sum without (instance) (rate(http_requests_total[5m]))
```

| Form | Meaning | When it fits |
| --- | --- | --- |
| `by` | Keep specified labels | Few labels to keep |
| `without` | Remove specified labels | Few labels to remove |

**`by` is usually safer.** If a new label is added later, `by` is unaffected, whereas `without` can let an unexpected label slip into the result.

***

## 10.8 Operator Precedence

In complex expressions, precedence changes the result. From highest to lowest:

| Precedence | Operators | Associativity |
| --- | --- | --- |
| 1 (highest) | `^` | **Right** |
| 2 | `*` `/` `%` `atan2` | Left |
| 3 | `+` `-` | Left |
| 4 | `==` `!=` `<=` `<` `>=` `>` | Left |
| 5 | `and` `unless` | Left |
| 6 (lowest) | `or` | Left |

Note that `^` is the lone **right-associative** operator.

```plain
2 ^ 3 ^ 2
# = 2 ^ (3 ^ 2) = 2 ^ 9 = 512   (actual)
# = (2 ^ 3) ^ 2 = 8 ^ 2 = 64    (if it were left-associative)
```

Rather than memorizing all this, **use parentheses.** A query that leans on precedence forces every reader to replay the precedence table in their head.

```plain
# Without parentheses — you have to remember precedence
rate(errors[5m]) / rate(requests[5m]) * 100 > 5

# With parentheses — the intent is clear
(rate(errors[5m]) / rate(requests[5m])) * 100 > 5
```

***

## Summary

| Item | Key point |
| --- | --- |
| Arithmetic | Operand type combination drives behavior; `__name__` is dropped |
| Comparison | Default is a **filter** (removes non-matching); use `bool` for values |
| Logical | `and`/`or`/`unless` — operate on label-set presence, not values |
| Vector matching | Default matches all labels; use `on()`/`ignoring()` to set the basis |
| Many-to-one | `group_left` marks the many side; `group_left(label)` pulls labels over |
| Aggregation | `sum`, `avg`, `topk`, etc. collapse many series into one |
| `by`/`without` | Keep vs. remove labels; `by` is usually safer |
| Precedence | Only `^` is right-associative; parenthesize when complex |

With operators and aggregation in hand, you can answer real questions like "error rate per service" or "the 5 slowest endpoints." In the next chapter, [Chapter 11. PromQL Functions](/en/posts/prometheus-grafana-part04-ch11), we dig into the functions that work over range vectors and compute over time — `rate`, `increase`, `histogram_quantile`, and more.
