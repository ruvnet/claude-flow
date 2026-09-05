# ADR-0001: ruflo-arena plugin contract

**Status**: Proposed
**Date**: 2026-06-07
**Plugin**: ruflo-arena

## Context

`ruflo-arena` implements the first executable slice of the competitive-ruliology initiative
(Ruflo ADR-147 competitive arena/tournament modes, ADR-148 co-evolution, ADR-150 visualization
split), following Stephen Wolfram's
[*Games Between Programs: The Ruliology of Competition*](https://writings.stephenwolfram.com/2026/06/games-between-programs-the-ruliology-of-competition/).
This ADR pins the plugin's public contract so downstream surfaces (commands, dashboards,
the RuVector data layer) can depend on stable shapes.

## Decision

### Tool surface (`./mcp-tools`)

| Tool | Purpose |
|------|---------|
| `arena/run` | one deterministic match between two named strategies |
| `tournament/run` | round-robin → competitive array (mean-payoff matrix) + ranking |
| `evolve/run` | hill-climb an FSM vs the field; returns program + fitness curve |
| `coevolve/run` | mutual co-evolution (arms race) trace |
| `run/get`, `run/list` | fetch/list persisted run records |

Every tool returns the Ruflo envelope `{ success: boolean; result?: T; error?: { message } }`
and validates input with Zod at the boundary. Numeric inputs are coerced (MCP/CLI friendliness).

### Core types (`.` / `./engine`)

- `GameSpec` — payoff matrix over an action set (`prisoners-dilemma`, `match-or-not`).
- `Strategy` — `FsmStrategy` (deterministic Moore machine: output on state, transition on
  opponent action) or `FnStrategy` (closure, e.g. `random`). This is "strategy as program".
- `MatchResult`, `TournamentResult`, `EvolutionResult`, `CoevolutionResult`, `RunRecord`.

### Persistence contract

- TS code persists full artifacts via `RunStore` (`FileRunStore` → `.ruflo/arena/<runId>.json`;
  `InMemoryRunStore` for tests). This is the local stand-in for RuVector ADR-197.
- AgentDB persistence is performed at the **command/agent layer** (Ruflo convention): each tool
  result carries an `agentdb` payload `{ namespace:"arena", key, value, tags }` for
  `mcp__plugin_ruflo-core_ruflo__memory_store`, making runs semantically searchable.

### Determinism

All runs are reproducible under `seed`. The RunRecord captures `seed` and the full artifact for
bit-for-bit replay — Wolfram's requirement that competitions be re-runnable.

## Consequences

- **Positive**: stable, typed contract; zero runtime deps beyond Zod; engine is pure and
  unit-tested; no Ruflo-core changes; clean seam for the RuVector data layer and the dashboard.
- **Negative / Costs**: v1 only ships simple-program + stochastic strategies; LLM strategies
  (ADR-151), sandboxing (ADR-153), and the dashboard UI (ADR-149) are out of scope here.
- **Neutral / Risks**: the AgentDB summary schema (`agentdb.value`) is unversioned in v1;
  formalize with the RuVector integration contract (ADR-152 ↔ ADR-200) before cross-repo use.

## References

- Stephen Wolfram, *Games Between Programs: The Ruliology of Competition*, June 2026 —
  https://writings.stephenwolfram.com/2026/06/games-between-programs-the-ruliology-of-competition/
- Ruflo ADR-147 (arena/tournament), ADR-148 (co-evolution), ADR-149 (dashboard), ADR-150 (viz split)
- RuVector ADR-196 (strategy graphs), ADR-197 (payoff/fitness storage)
