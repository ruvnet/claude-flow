# ADR-330: Adaptive Pheromone Swarm Consensus

**Status:** Accepted and implemented
**Date:** 2026-07-29
**Issue:** #2832
**Supersedes:** the research-only contract in draft PR #2833
**Related:** ADR-320, ADR-322, ADR-324, ADR-329

## Decision

Ruflo adds the opt-in `pheromone-adaptive` swarm topology. It learns a bounded
fitness signal after task outcomes and controls whether an agent is eligible
for future Ruflo-managed dispatch. It does not terminate agents or expand any
agent capability.

The public initialization contract is:

```bash
ruflo swarm init \
  --topology pheromone-adaptive \
  --max-agents 8
```

The topology starts in dry-run calibration mode. Applying suspensions requires
the explicit `--apsc-live` flag:

```bash
ruflo swarm init \
  --topology pheromone-adaptive \
  --max-agents 8 \
  --apsc-live
```

This corrects the draft proposal's `--maxAgents` example. Kebab-case is the
public CLI contract; camelCase remains the internal parsed/MCP representation.

## Signal

Each observation is normalized before it reaches the coordinator:

```text
raw = α × taskSuccess
    + β × (1 - normalizedLatency)
    + γ × consensusAlignment
```

Defaults are `α=0.5`, `β=0.2`, and `γ=0.3`. Inputs and weights are finite and
bounded to `[0,1]`; weights are normalized to sum to one.

The raw terms are observations, not interchangeable physical measurements.
Ruflo therefore does not compare raw scores directly across roles. It centers
each observation on the role's EMA baseline:

```text
roleNormalized = clamp(0.5 + raw - roleBaseline, 0, 1)
agentEMA        = decay × priorEMA + (1-decay) × roleNormalized
```

This prevents a coordinator or specialist with fewer discrete completions from
being compared as though it were a task-producing coder.

## Safety invariants

The optimizer cannot trade away these invariants:

1. `coordinator`, `queen`, `security-architect`, and `security-auditor` are
   protected by default.
2. An agent receives at least `minSamples=3` observations before pruning.
3. At least `minActiveAgents=3` remain eligible.
4. At most `maxSuspendFraction=0.25` of active agents may be suspended in one
   observation round.
5. Suspension affects Ruflo scheduling eligibility only. It does not kill the
   process, discard context, revoke memory, or mutate permissions.
6. Dry-run is the default. Live mode is an explicit operator decision.
7. A suspended agent is reactivated after recovery or by deterministic bounded
   exploration.
8. Invalid or missing state fails open for dispatch: existing topologies and
   previous installations continue to execute.
9. Cross-process outcome updates use a workspace-scoped lock and atomic state
   replacement; concurrent hooks cannot silently overwrite one another.

## Runtime integration

The implementation lives on the actual Ruflo paths:

- `cli/src/services/pheromone-adaptive.ts`: pure scoring and safety state
- `cli/src/mcp-tools/swarm-tools.ts`: persistence and MCP operations
- `cli/src/mcp-tools/hooks-tools.ts`: automatic post-task signal
- `cli/src/mcp-tools/agent-tools.ts`: scheduling eligibility gate
- `cli/src/commands/swarm.ts`: topology and inspection CLI
- `shared/src/core/interfaces/coordinator.interface.ts`: topology contract

The earlier draft named paths that do not exist in the repository. The
implemented surface attaches to the persistent swarm store used by `swarm_init`
and the tracked-agent execution path used by `agent_execute`.

MCP operations:

- `swarm_pheromone_update`
- `swarm_pheromone_status`

Human inspection:

```bash
ruflo swarm pheromone
ruflo agent metrics --format json
```

Manual observation:

```bash
ruflo swarm pheromone \
  --agent-id coder-1 \
  --role coder \
  --task-success 1 \
  --normalized-latency 0.2 \
  --consensus-alignment 0.9
```

`hooks_post-task` emits the same observation automatically when a
`pheromone-adaptive` swarm is active.

## Evaluation and claims

The Dream-cycle report cited a 50% agent reduction and 11.6% fitness increase
from a different workload. Those numbers are upstream hypotheses, not Ruflo
results.

Ruflo's benchmark reports:

- update latency distribution;
- active-agent reduction on a declared synthetic workload;
- quorum preservation;
- protected-role preservation;
- mean admitted-agent score before and after;
- exact configuration and seed.

Release text may claim only measured Ruflo results produced by that benchmark.

## Backward compatibility

- All existing topology strings retain their behavior.
- Default topology remains `hierarchical`.
- `adaptive` is unchanged.
- Old swarm-state documents without `apscState` remain readable.
- Non-APSC `agent_execute` calls have no additional denial path.
- Dry-run APSC never denies dispatch.

## Acceptance tests

1. The new topology initializes and persists through the existing swarm store.
2. APSC dry-run records decisions without changing eligibility.
3. Live APSC never crosses its active-agent floor.
4. Protected roles are never suspended.
5. A recovered agent can be reactivated.
6. Invalid score/config values are rejected.
7. `hooks_post-task` feeds active APSC state.
8. `agent_execute` refuses an agent only when live APSC marks that exact ID
   suspended.
9. Existing topology schemas and presets still parse.
10. Benchmark output distinguishes measured results from upstream claims.
11. Twenty concurrent outcome writers produce twenty persisted rounds and no
    residual lock file.
12. `agent metrics` exposes the per-agent EMA pheromone score, role, sample
    count, and current scheduling eligibility.
