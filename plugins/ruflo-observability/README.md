# ruflo-observability

Structured logging, distributed tracing, and metrics -- correlate agent swarm activity with application telemetry.

## Overview

Implements OpenTelemetry-compatible structured logging with correlation IDs, distributed tracing with parent-child span hierarchies, and metrics collection (counters, gauges, histograms). Correlates swarm agent activity with application-level telemetry and detects anomalies in latency, error rates, and resource usage.

## Installation

```bash
claude --plugin-dir plugins/ruflo-observability
```

## Agents

| Agent | Model | Role |
|-------|-------|------|
| `observability-engineer` | sonnet | Structured logging, distributed tracing, metrics collection, agent-application telemetry correlation |

## Skills

Skills are auto-invoked via the Skill tool when their `description` matches the task (progressive disclosure). For an explicit CLI surface use the `/observe` slash command below.

| Skill | Argument hint | Description |
|-------|---------------|-------------|
| `observe-trace` | `<task-id>` | Trace agent execution by collecting spans and building a trace tree |
| `observe-metrics` | `[--period 1h]` | Aggregate and display system metrics with anomaly detection |

## Commands (5 subcommands)

```bash
observe trace <task-id>              # Trace agent execution with span tree
observe metrics [--period 1h]        # View aggregated metrics (p50, p95, p99)
observe logs [--level error]         # Filter structured logs by level
observe dashboard                    # Combined health dashboard
observe correlate <agent-id>         # Correlate all telemetry for an agent
```

## Key Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `agent_task_duration_seconds` | Histogram | Time to complete agent tasks |
| `agent_token_usage` | Counter | Tokens consumed per agent/model |
| `agent_active_count` | Gauge | Currently active agents |
| `agent_error_rate` | Counter | Errors per agent |
| `swarm_span_duration_ms` | Histogram | Span durations for tracing |
| `memory_operations_total` | Counter | AgentDB read/write counts |

**What produces this data.** The plugin reads and analyses records in the `observability` namespace; ruflo itself does not write spans or metric records there automatically (checked in `v3/@claude-flow/cli/src` and the helpers). Something has to store them, for example your own hooks or agents calling `memory_store` with `namespace: "observability"` and a `spanId` / `parentSpanId` / `taskId` / `startTime` / `endTime` shape, or the metric names above. With no records, `observe-trace` and `observe-metrics` report "nothing recorded" and stop; they do not reconstruct a trace from guesses. The metric names are the convention this plugin looks for, not a built-in exporter.

## Trace Hierarchy

```
[root] swarm-task
  [child] agent-spawn (agent=architect)
  [child] agent-spawn (agent=coder)
    [child] file-read (path=src/auth.ts)
    [child] file-write (path=src/auth.ts)
  [child] agent-spawn (agent=tester)
    [child] test-run (suite=auth)
```

## Log Format

JSON structured logs with `timestamp`, `level`, `message`, `correlationId`, `agentId`, `taskId`, `spanId`, `traceId`, `duration_ms`, and `metadata`.

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **Verification:** `bash plugins/ruflo-observability/scripts/smoke.sh` is the contract.

## Namespace coordination

This plugin owns the `observability` AgentDB namespace (base-name exception per [ruflo-agentdb ADR-0001 §"Namespace convention"](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md), same precedent as `federation` and `migrations`). Reserved namespaces (`pattern`, `claude-memories`, `default`) MUST NOT be shadowed.

`observability` is accessed via `memory_*` tools (namespace-routed). Stores spans, metric snapshots, and log entries.

> **Routing note:** Earlier versions of these skills used `agentdb_hierarchical-recall` with namespace argument — that tool family routes by tier and ignores namespace strings. ADR-0001 fixed the skills to use `memory_*` for namespaced reads and documented the dual pattern-store path for metric snapshots.

## Verification

```bash
bash plugins/ruflo-observability/scripts/smoke.sh
# Expected: "10 passed, 0 failed"
```

## Architecture Decisions

- [`ADR-0001` — ruflo-observability plugin contract (namespace-routing fix, smoke as contract)](./docs/adrs/0001-observability-contract.md)

## Related Plugins

- `ruflo-agentdb` — namespace convention owner; defines the routing rules ADR-0001 fixes a violation of
- `ruflo-cost-tracker` -- Token usage metrics feed into cost attribution
- `ruflo-iot-cognitum` -- Reuses Z-score anomaly detection for telemetry patterns
- `ruflo-market-data` -- Data feed health and ingestion latency monitoring

## License

MIT

## As a mod

Function-hook mod (ADR-445 pattern, `hooks/register.ts`). It adds, with no network, no process spawning and no model call:

- **Guard** (tighten-only, default on): refuses a memory write of telemetry (spans, logs, labels) that holds a secret, a US SSN or a spaced payment-card number (13-digit epoch timestamps are fine). The deny reason names the rule, never the value.
- **`/observe-mod`**: local `status` and `scan <text>` (secret check, same rules as the guard).
- **Status file** `.claude-flow/observe-mod/status.json` (`{version:1, updatedMs, guard, checked, blocked, ...}`), written at session start and when counters change.

Per-prompt context is deliberately not added: this plugin has nothing worth attaching to every prompt.

| Option | Default | Effect |
|---|---|---|
| `guard` | `on` | refuse the calls above |

Test: `claude plugin validate plugins/ruflo-observability`, `claude plugin test plugins/ruflo-observability`, `bash plugins/ruflo-observability/scripts/smoke.sh`.
