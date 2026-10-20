# ruflo-loop-workers

Cache-aware /loop workers and CronCreate background automation. Substrate plugin for every recurring task in the ruflo family.

## Install

```
/plugin marketplace add ruvnet/ruflo
/plugin install ruflo-loop-workers@ruflo
```

## What's Included

- **Loop Workers**: Recurring tasks via `/loop` with ScheduleWakeup (delay <270s for prompt cache hits)
- **CronCreate**: Session-scoped cron jobs for audit, optimization, and monitoring (they end with the session and expire after 7 days; use `/schedule` or an OS scheduler to outlive it)
- **12 Background Workers**: ultralearn, optimize, consolidate, predict, audit, map, preload, deepdive, document, refactor, benchmark, testgaps
- **Daemon Management**: Start, stop, status, trigger, and enable workers
- **ADR-091 Integration**: Native Claude Code capabilities preferred over daemon polling

## Requires

- `ruflo-core` plugin (provides MCP server)

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **Verification:** `bash plugins/ruflo-loop-workers/scripts/smoke.sh` is the contract.

## MCP surface (5 tools)

All defined at `v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts`:

| Tool | Purpose |
|------|---------|
| `hooks_worker-list` | List available workers and their triggers |
| `hooks_worker-dispatch` | Dispatch a worker run with `--trigger <worker-name>` and optional `--scope` |
| `hooks_worker-status` | Inspect a running worker |
| `hooks_worker-detect` | Detect which workers should fire based on context |
| `hooks_worker-cancel` | Cancel a running worker |

## 12 worker triggers → consumer plugins

| Trigger | Consumer plugin | Purpose |
|---------|-----------------|---------|
| `ultralearn` | `ruflo-intelligence` | Bootstrap learning corpus from a deep codebase scan |
| `optimize` | `ruflo-cost-tracker`, `ruflo-intelligence` | Performance + cost optimization recommendations |
| `consolidate` | `ruflo-intelligence`, `ruflo-agentdb` | EWC++ memory consolidation |
| `predict` | `ruflo-intelligence` | Predictive routing for upcoming tasks |
| `audit` | `ruflo-security-audit`, `ruflo-aidefence` | Security + compliance audit pass |
| `map` | `ruflo-knowledge-graph` | Build/refresh entity-relation knowledge graph |
| `preload` | `ruflo-core`, `ruflo-rag-memory` | Warm caches before high-frequency operations |
| `deepdive` | `ruflo-goals` (deep-research) | Multi-source investigation pass |
| `document` | `ruflo-docs` | Generate API docs + drift detection |
| `refactor` | `ruflo-jujutsu` | Diff-aware refactor recommendations |
| `benchmark` | `ruflo-cost-tracker`, `ruflo-iot-cognitum` | Perf benchmarks |
| `testgaps` | `ruflo-testgen` | Coverage gap detection + test generation |

Invocation pattern (CLI + MCP):

```bash
# CLI
npx @claude-flow/cli@latest hooks worker dispatch --trigger document --context src/api

# MCP (trigger is required; context, priority and background are optional; there is no scope field)
npx @claude-flow/cli@latest mcp exec -t hooks_worker-dispatch -p '{"trigger": "document", "context": "src/api"}'
```

## Cache-aware /loop integration

This plugin pairs with [ruflo-autopilot ADR-0001](../ruflo-autopilot/docs/adrs/0001-autopilot-contract.md) which **owns the 270s cache-aware ScheduleWakeup heartbeat contract**. Recommended fallback heartbeat is **270 seconds** — under the 5-minute prompt-cache TTL so the next wake-up reads conversation context cached. Going past 300s pays a cache-miss; rounding to 5 minutes is the worst-of-both case. This only applies to sessions on the 5-minute TTL: where `ScheduleWakeup` documents a 1-hour TTL, idle polling at 1200–1800s is cheaper and 270s wakes buy nothing.

For event-driven loops, arm a `Monitor` and let the 270s wake be the safety net.

## Namespace coordination

This plugin owns the `worker-history` AgentDB namespace (kebab-case, follows the convention from [ruflo-agentdb ADR-0001 §"Namespace convention"](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md)). Reserved namespaces (`pattern`, `claude-memories`, `default`) MUST NOT be shadowed.

`worker-history` records dispatch events, durations, success/failure verdicts. Accessed via `memory_*` tools (namespace-routed).

## Verification

```bash
bash plugins/ruflo-loop-workers/scripts/smoke.sh
# Expected: "12 passed, 0 failed"
```

## Architecture Decisions

- [`ADR-0001` — ruflo-loop-workers plugin contract (12-worker trigger map, autopilot 270s cross-reference, smoke as contract)](./docs/adrs/0001-loop-workers-contract.md)

## Related Plugins

- `ruflo-autopilot` — owns the 270s cache-aware /loop heartbeat contract
- `ruflo-docs`, `ruflo-security-audit`, `ruflo-testgen`, `ruflo-knowledge-graph`, etc. — worker-trigger consumers per the table above
- `ruflo-agentdb` — namespace convention owner; backing store for worker-history

## As a mod

This plugin ships a function-hook mod (ADR-445, `hooks/register.ts`). It makes no network call, spawns no process and makes no model call.

- **Guard** (tighten-only, on by default): Refuses `hooks_worker-dispatch` whose context holds a key, token or password (workers log their context), and any dispatch past the per-session cap, which catches a stuck loop that keeps dispatching. A refusal never echoes the secret.
- **`/loop-mod`**: `status`, `recent`, `tools` (which of this plugin's tools are connected) and `scan <text>` (would the guard refuse it). Answered locally.
- **Status file**: `.claude-flow/loop-mod/status.json` (`{version: 1, updatedMs, guard, calls, total, blocked, recent}`, counters only, never tool input), written at session start and after every call to this plugin's tools.

Options (`userConfig`): `guard` (on), `maxDispatch` (100, range 1 to 1000).

Test it: `claude plugin validate plugins/ruflo-loop-workers`, `claude plugin test plugins/ruflo-loop-workers`, `bash plugins/ruflo-loop-workers/scripts/smoke.sh`.
