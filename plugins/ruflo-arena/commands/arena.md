---
name: arena
description: Competitive ruliology — run arenas and tournaments between program strategies, evolve winners, and persist runs (ADR-147/148)
---

$ARGUMENTS

Run *competitions between programs* and *evolve* winning strategies, following Stephen
Wolfram's "Games Between Programs: The Ruliology of Competition". Parse `$ARGUMENTS` to pick
a subcommand. Each subcommand maps to an MCP tool exported by this plugin
(`arena/run`, `tournament/run`, `evolve/run`, `coevolve/run`, `run/get`, `run/list`).

### Subcommands

**`arena run --a <strategy> --b <strategy> [--game pd] [--rounds 200] [--seed 1]`**
Run one deterministic match. Strategies come from the classic roster
(`tit-for-tat`, `always-cooperate`, `always-defect`, `grim`, `pavlov`, `alternate`, `random`, …).
1. Call MCP tool `arena/run` with the parsed args.
2. Report cumulative + mean payoffs.

**`arena tournament [--game pd] [--rounds 200] [--seed 1]`**
Round-robin over the classic roster → Wolfram's **competitive array** (mean-payoff matrix) + mean-vs-field ranking.
1. Call `tournament/run`.
2. Display `result.tables.competitiveArray` and `result.tables.ranking`.

**`arena evolve [--game pd] [--generations 300] [--seed 42]`**
Hill-climb an FSM strategy against the field (mutate → keep-if-fitter). Shows the plateau→breakthrough fitness curve.
1. Call `evolve/run`; display `result.sparkline`, `finalFitness`, and the evolved program.

**`arena coevolve [--game pd] [--generations 400] [--seed 7]`**
Mutual co-evolution (arms race) between two evolving strategies.
1. Call `coevolve/run`; display the payoff trace and range.

**`arena runs [--limit 20]`** / **`arena get <runId>`**
List or fetch persisted run records.

### Persistence (AgentDB)

The MCP tools persist full artifacts to `.ruflo/arena/<runId>.json` (exact replay). Each tool
result also includes an `agentdb` payload — use it to store a searchable summary in AgentDB so
runs are queryable later (the local stand-in for the RuVector data layer, ADR-196/197):

```
mcp__plugin_ruflo-core_ruflo__memory_store({
  namespace: result.agentdb.namespace,   // "arena"
  key:       result.agentdb.key,         // the runId
  value:     result.agentdb.value,       // JSON summary (kind, game, seed, ranking/fitness …)
  tags:      result.agentdb.tags         // ["ruliology","competition", kind, game]
})
```

Later: `mcp__plugin_ruflo-core_ruflo__memory_search({ namespace: "arena", query: "tournaments where grim dominated" })`.

### Notes

- Everything is reproducible under `--seed`. Non-halting programs are out of scope in v1
  (FSMs always halt); untrusted/evolved-program sandboxing is tracked in ADR-153.
- See `docs/adrs/0001-arena-contract.md` for the tool/data contract and
  `../../INTEGRATION-ADRS.md` (in the ruliad meta-repo) for the full ADR map.
