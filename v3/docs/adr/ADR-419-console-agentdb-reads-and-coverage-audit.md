# ADR 419: Three more AgentDB reads in the Memory Lab, and a coverage audit of the knowledge and automation surfaces

Status: Accepted (ships in ruflo-console 0.21.0)

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/memory-lab.ts` (the catalog), `tests/memory-lab.spec.ts`.

Extends: ADR 407, ADR 411 (the plugin map). Companion to ADR 412.

## 1. Context

The roadmap listed "dedicated surfaces" for knowledge and memory, and for autonomy and workflows. Before building any, the tools were compared with what the console already reaches.

## 2. Audit

- **Memory Lab** already reaches 31 entries: stats, detailed stats, bridge, health, controllers, list, search, unified search, pattern search and store, hierarchical recall and store, graph query, causal edge, consolidate, embeddings (generate, compare, init, status, search), RaBitQ (build, search, status), import, export, migrate, compress, cleanup (plan first), delete.
- **Automation** already reaches workflows (list, status, template, create, validate, execute, pause, resume, cancel), the twelve workers and the daemon, all ten autopilot tools (status, enable, disable, reset, predict, learn, log, history, progress, config), sessions, config and tasks.
- **Not reached**: `agentdb_context-synthesize`, `agentdb_semantic-route` and `agentdb_graph-pathfinder` (reads); `agentdb_feedback`, `agentdb_batch` and the two deletes (writes).

A second surface for knowledge or for automation would duplicate rows that already exist, so none is built.

## 3. Decision

Add the three missing **reads** to the Memory Lab's AgentDB group; nothing else changes.

| Row | Tool | Takes |
|---|---|---|
| SYNTHESIZE | `agentdb_context-synthesize` | text (a brief from the 10 nearest memories) |
| INTENT ROUTE | `agentdb_semantic-route` | text (which intent route it falls under) |
| PATHFINDER | `agentdb_graph-pathfinder` | `<node> \| <question>` (personalized PageRank, depth 3, top 10) |

Each runs at once (reads, $0, local), with fixed argv through `mcp exec -t`. The writes stay out: `agentdb_feedback` is what the learning loop already records through hooks, and the two deletes are destructive and have no undo; they remain a terminal action.

## 4. Alternatives considered

- **A new knowledge view.** Rejected: it would split search and graph work across two pages and repeat existing rows.
- **Adding feedback and delete rows now.** Deferred: feedback needs a task id and scores a person would have to invent; deletes need their own confirm wording (ADR 412).

## 5. Safety

Reads only; no secret read or shown; no spend. The pathfinder's seed and question travel as JSON parameters of a fixed argv, never through a shell.

## 6. Tests

`tests/memory-lab.spec.ts`: the catalog invariants (unique `mem-` ids, one fixed argv each, no shell, reads read-only) now cover the three rows, and each has an exact-argv assertion.
