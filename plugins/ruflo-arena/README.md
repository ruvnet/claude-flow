# ruflo-arena

Competitive ruliology for Ruflo swarms — **arenas**, **tournaments**, and **adaptive
co-evolution** of program strategies. Implements the first executable slice of Ruflo
ADR-147/148/150, following Stephen Wolfram's
[*Games Between Programs: The Ruliology of Competition*](https://writings.stephenwolfram.com/2026/06/games-between-programs-the-ruliology-of-competition/).

Strategies are **programs** (deterministic finite-state machines reading opponent history).
They compete under payoff games; tournaments produce Wolfram's **competitive array**; hill-climb
and **mutual co-evolution** discover winners empirically — because, per computational
irreducibility, you have to *run* the competition to find out.

## Install & test

```bash
cd plugins/ruflo-arena
npm install        # light — runtime dep is just zod
npm run build      # tsc -> dist/
npm test           # vitest (engine + MCP tools + persistence)
npm run lint       # eslint (typescript-eslint)
```

## CLI

```bash
node dist/cli.js demo                                   # tournament + evolution + co-evolution
node dist/cli.js tournament --game pd --rounds 200 --seed 1
node dist/cli.js arena --a tit-for-tat --b always-defect
node dist/cli.js evolve --game pd --generations 300 --seed 42
node dist/cli.js coevolve --game pd --generations 400 --seed 7
```

Sample PD ranking (mean-vs-field): `grim ≈ 2.99`, `always-defect ≈ 2.76`, `tit-for-tat ≈ 2.50`,
… `always-cooperate ≈ 1.88`. The evolution run climbs from a random FSM (~2.78) to ~3.00 with
the characteristic plateau→breakthrough fitness curve.

## MCP tools (`ruflo-arena/mcp-tools`)

| Tool | Purpose |
|------|---------|
| `arena/run` | one deterministic match between two named strategies |
| `tournament/run` | round-robin → competitive array + mean-vs-field ranking |
| `evolve/run` | hill-climb an FSM vs the field; returns program + fitness curve |
| `coevolve/run` | mutual co-evolution (arms race) trace |
| `run/get`, `run/list` | fetch/list persisted run records |

All return `{ success, result | error }` and validate inputs with Zod. See
[`commands/arena.md`](commands/arena.md) and [`docs/adrs/0001-arena-contract.md`](docs/adrs/0001-arena-contract.md).

## Persistence

Full run artifacts are written to `.ruflo/arena/<runId>.json` (exact replay). Each tool result
also carries an `agentdb` payload so the command layer can store a searchable summary via
`mcp__plugin_ruflo-core_ruflo__memory_store` (namespace `arena`) — the local stand-in for the RuVector data
layer (ADR-196/197), enabling queries like *"tournaments where grim dominated"*.

## Scope

v1 is intentionally Ruflo-only and core-untouched:

- **In:** simple-program + stochastic strategies, PD + zero-sum games, tournaments, hill-climb &
  co-evolution, file/AgentDB persistence, MCP tools + CLI.
- **Out (tracked elsewhere):** LLM-agent strategies + distillation (ADR-151), execution
  sandboxing/resource governance (ADR-153), dashboard UI (ADR-149/154), and the full RuVector
  data/intelligence layer (ADR-196–198, ADR-200).

## Architecture

```
src/
  domain/      types (+ Zod schemas) · games · strategies (FSM programs, library, mutation)
  engine/      rng · arena (match) · tournament (competitive array) · evolution (hill-climb, co-evolution)
  persistence/ RunStore (File + InMemory) + AgentDB record builder
  report/      competitive-array tables · ASCII heatmaps · fitness sparklines
  mcp-tools/   arenaTools: MCPTool[]  (the 6 tools above)
  index.ts     export surface + default { tools }
  cli.ts       human-facing CLI
```
