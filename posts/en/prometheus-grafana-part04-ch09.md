---
title: '[Prometheus & Grafana] Chapter 9. PromQL Basics'
date: 2026-06-08
description: From PromQL's four data types to instant and range vector selectors, label matchers, time durations, and the offset and @ modifiers
tags:
  - Prometheus
  - Grafana
  - Monitoring
  - Observability
series: Prometheus & Grafana
seriesOrder: 9
---

> **Note**: This post is a summary based on the official Prometheus (v3.2.1) and Grafana documentation. For precise details, please refer to the official docs.
> - [Prometheus Official Docs](https://prometheus.io/docs/)
> - [Grafana Official Docs](https://grafana.com/docs/grafana/latest/)

***

By the end of [Chapter 8. Service Discovery](/en/posts/prometheus-grafana-part03-ch08), Prometheus could find targets and stack up time series on its own, even in dynamic environments. But that accumulated data is, on its own, just a heap of meaningless numbers. To ask questions like "what is the CPU usage right now?" or "how much has the error rate climbed over the last five minutes?" and get answers back, you need a separate language. That language is PromQL (Prometheus Query Language).

PromQL sits underneath every Grafana dashboard panel, every alerting rule condition, and every recording rule's precomputation. Without this language, Prometheus is nothing more than a warehouse that only collects data. Before getting into PromQL proper, this chapter lays out the **data types** and **selector** syntax that form the foundation of every query. Operators, aggregation, and functions like `rate` are deferred to the next chapter.

***

## 9.1 PromQL's Four Data Types

The starting point for understanding PromQL is the fact that every expression evaluates to one of four types. Whatever query you write, its result is one of these four, and knowing which type a function or operator accepts and returns accounts for half of PromQL's grammar.

| Type | Description | Example |
| --- | --- | --- |
| Instant vector | A set of time series, each with a single sample at the same timestamp | `node_cpu_seconds_total` |
| Range vector | A set of time series, each with a set of samples over a time range | `node_cpu_seconds_total[5m]` |
| Scalar | A single floating-point number | `3.14` |
| String | A string value (rarely used today) | `"production"` |

Of these, the two used overwhelmingly in real-world monitoring are the **instant vector** and the **range vector**. Their difference boils down to a single sentence: an instant vector is "the value right now," while a range vector is "a bundle of values over a past window." This distinction runs through all of PromQL, so make it second nature.

***

## 9.2 Instant Vector Selectors

The simplest query is just a metric name. That alone fetches the most recent value of every time series carrying that name.

```promql
node_cpu_seconds_total
```

This query returns every time series named `node_cpu_seconds_total` as an instant vector. With 8 CPU cores and 7 modes, a single server alone yields 56 time series. That is far too many. This is where label matchers come in.

### Label Matchers

You narrow time series by placing label conditions inside braces `{}`. There are four matchers, two of which use regular expressions.

| Matcher | Meaning | Example |
| --- | --- | --- |
| `=` | Label value matches exactly | `{mode="idle"}` |
| `!=` | Label value does not match | `{mode!="idle"}` |
| `=~` | Matches the regex | `{mode=~"user\|system"}` |
| `!~` | Does not match the regex | `{instance!~"10\\.0\\..*"}` |

Listing multiple matchers separated by commas combines them with **AND**. The query below selects only series where `mode` is not `idle` *and* `instance` is `server1:9100`.

```promql
node_cpu_seconds_total{mode!="idle", instance="server1:9100"}
```

### Two Pitfalls of Regex Matchers

`=~` and `!~` are powerful, but you must keep two things in mind.

First, **regexes are always fully anchored.** `=~"user"` matches only values that are *exactly* `user`, not values that *contain* `user`. If you want a partial match, you must add `.*` yourself, as in `=~".*user.*"`. Internally it uses the RE2 engine; think of it as having an implicit `^` and `$` wrapped around the pattern.

Second, **you cannot query with only matchers that match the empty string.** PromQL requires that a selector contain at least one matcher that does *not* match the empty string. That means `{job=~".*"}` on its own raises an error. Since `.*` matches even the empty string, it effectively means "every time series," forcing a full scan with no index. This constraint is a safety net against unintended full scans.

### A Metric Name Is Really a Label Too

As covered in [Chapter 3. Data Model](/en/posts/prometheus-grafana-part02-ch03), a metric name is nothing more than a special label called `__name__`. The following two queries are therefore completely identical.

```promql
node_cpu_seconds_total{mode="idle"}
{__name__="node_cpu_seconds_total", mode="idle"}
```

Exploiting this, you can even apply a regex to the name itself. The one below grabs every metric starting with `node_` at once.

```promql
{__name__=~"node_.*"}
```

***

## 9.3 Range Vector Selectors

If an instant vector is "the value now," a range vector is "the values over a past window." You build one by appending a time range in square brackets after the selector.

```promql
node_cpu_seconds_total{mode="idle"}[5m]
```

For each time series, this query returns *every sample collected over the last five minutes*. If `scrape_interval` is 15 seconds, roughly 20 samples accumulate in five minutes, so you get a bundle of about 20 values per series.

### Time Durations

Inside the brackets you can use the following units, and you may combine them.

| Unit | Meaning |
| --- | --- |
| `ms` | Milliseconds |
| `s` | Seconds |
| `m` | Minutes |
| `h` | Hours |
| `d` | Days |
| `w` | Weeks |
| `y` | Years |

When chaining multiple units, write them from largest to smallest. `1h30m` is valid; `30m1h` is an error.

```promql
http_requests_total[1h30m]
```

### A Range Vector Cannot Be Graphed As-Is

Here is the pitfall beginners hit most often. **A range vector cannot be graphed directly.** Drop `node_cpu_seconds_total[5m]` into a Grafana panel or the Graph tab of the Prometheus expression browser, and you meet this error:

```plain
Error executing query: invalid expression type "range vector"
for range query, must be Scalar or instant Vector
```

The reason is clear. A point on a graph must be a single value, but a range vector packs multiple values (five minutes of samples) into one point. So a range vector **must be reduced back to an instant vector through a function** before it can be graphed. The most common such function is `rate()`, covered in the next chapter.

```promql
rate(node_cpu_seconds_total{mode="idle"}[5m])
```

`rate` takes the five-minute bundle of samples and compresses it into a single value -- the per-second rate of increase. Because the result is an instant vector, it can finally go onto a graph. Memorizing **"if you put `[5m]` on a counter, you almost always have to wrap it in a function like `rate` or `increase`"** right now will make the next chapter far easier.

***

## 9.4 The offset Modifier: Shifting Back in Time

By default, every selector fetches values relative to the moment the query is evaluated (now). Adding `offset` shifts that reference point into the past. Use it when you want the value not at "now" but "an hour ago" or "yesterday."

```promql
# value as of one hour ago
http_requests_total offset 1h

# a 5-minute range as of the same time yesterday
rate(http_requests_total[5m] offset 1d)
```

The most common use is **comparison against the past** -- comparing current traffic to the same time a week ago to catch spikes or drops. (The actual subtraction is the job of the next chapter on operators; here we only note that `offset` is the tool for shifting the reference point.)

A syntactic caveat is placement. `offset` must come immediately after the selector, and for a range vector it goes *after* the brackets. `[5m] offset 1d` is correct; `offset 1d [5m]` is wrong.

***

## 9.5 The @ Modifier: Evaluating at a Fixed Instant

Where `offset` is a *relative* shift ("how long before now"), the `@` modifier pins an *absolute* instant ("exactly this moment"). It takes a Unix timestamp (in seconds) as its value.

```promql
# value as of 2026-06-01 00:00:00 UTC (= 1748736000)
http_requests_total @ 1748736000
```

No matter which point on the graph the query is evaluated at, a selector carrying `@` always sees only the value at that fixed moment. This makes expressions like "current ratio against a specific baseline" possible.

You can also use the special values `start()` and `end()`, which refer to the start and end of the query range, respectively.

```promql
# pinned to the value at the start of the displayed range
http_requests_total @ start()
```

`@` and `offset` can even be combined, but that goes beyond the basics. It is enough to remember the distinction: **`@` for an absolute instant, `offset` for a relative shift.**

***

## 9.6 Your First Queries: The Expression Browser

With the theory laid out, let's confirm it directly in the Prometheus expression browser (`http://localhost:9090`). Throwing the three types at it in turn makes the difference tangible.

Enter a scalar and you get a single value back as-is.

```promql
2 + 3
```

```plain
5
```

Enter an instant vector and you get the current value of each series in a table. `up` is the most fundamental metric of all, holding whether each target's scrape succeeded (1 = healthy, 0 = failed).

```promql
up
```

```plain
up{instance="localhost:9090", job="prometheus"}   1
up{instance="server1:9100", job="node"}           1
up{instance="server2:9100", job="node"}           0
```

If `server2`'s `up` is `0` in this result, that target's scraping is failing. You can also narrow it down with a selector.

```promql
up{job="node"} == 0
```

Finally, drop a range vector straight into the Graph tab and you get the type error seen earlier. Hitting that error yourself once is the fastest way to burn in the rule that **range vectors must be wrapped in a function.**

***

## Summary

| Item | Key point |
| --- | --- |
| Data types | Instant vector / range vector / scalar / string -- every expression evaluates to one of these four |
| Instant vector | "Value now." Metric name + `{}` label matchers |
| Label matchers | `=` `!=` `=~` `!~`; commas mean AND; regexes are fully anchored |
| Empty-matcher rule | At least one matcher must not match the empty string (`{job=~".*"}` alone is invalid) |
| Metric name | Sugar for the `__name__` label; regexes work on the name too |
| Range vector | "Bundle of values over a past window." `[5m]`, units `ms`-`y` combinable |
| Range vector pitfall | Cannot be graphed directly -> reduce to an instant vector via `rate` etc. |
| `offset` | Shifts the reference point relatively into the past, after the selector (`[5m] offset 1d`) |
| `@` modifier | Pins an absolute instant; Unix timestamp, `start()`, `end()` |

You now know how to pick out time series and work the time axis. But the queries so far only *select* data -- they cannot add, compare, or sum it. To answer real questions like "average CPU across all nodes" or "total error rate per service," you need operators and aggregation. The next chapter, [Chapter 10. PromQL Operators and Aggregation](/en/posts/prometheus-grafana-part04-ch10), covers arithmetic, comparison, and logical operators, `sum`/`avg`/`by`/`without`, and vector matching.
