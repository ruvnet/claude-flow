# ruflo-agentdb

The substrate plugin for Ruflo memory. Wraps three CLI MCP families — `agentdb_*` (controller bridge, 15 tools), `embeddings_*` (RuVector ONNX engine, 10 tools), and `ruvllm_hnsw_*` (WASM-backed pattern router, 3 tools) — into discoverable skills and commands. Other plugins (`ruflo-browser`, `ruflo-rag-memory`, `ruflo-intelligence`) compose this substrate; this plugin owns the namespace convention and the smoke contract for the substrate as a whole.

> **Status:** ADR-0001 implemented. Plugin v0.3.0 targets `@claude-flow/cli` v3.6.x with bundled `agentdb@^3.0.0-alpha.11`. The smoke contract (13 numbered checks + 3 documentation invariants) is the verification mechanism — see [docs/adrs/0001-agentdb-optimization.md](./docs/adrs/0001-agentdb-optimization.md).

## Install

```
/plugin marketplace add ruvnet/ruflo
/plugin install ruflo-agentdb@ruflo
```

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor. Patch bumps within v3.6 are expected to be no-op.
- **AgentDB:** the CLI bundles `agentdb@^3.0.0-alpha.11`. The plugin does **not** pin the npm package — internals (alpha.11 → alpha.12 etc.) are not the plugin's contract.
- **Verification:** the bundled smoke script is the source of truth (`bash plugins/ruflo-agentdb/scripts/smoke.sh`). If smoke passes against your CLI version, the plugin's contract holds.

## Features

- **Controller bridge**: 15 `agentdb_*` MCP tools (hierarchical store/recall, semantic routing, pattern store/search, causal edges, context synthesis, batch ops, consolidation, feedback, sessions).
- **RuVector embeddings**: 10 `embeddings_*` MCP tools — 384-dim ONNX (all-MiniLM-L6-v2), HNSW search, hyperbolic (Poincare), neural substrate, and **RaBitQ 1-bit quantization (32× memory reduction)**.
- **HNSW pattern router**: 3 `ruvllm_hnsw_*` tools (WASM-backed, ≤11 high-priority patterns — distinct from the large-scale embeddings HNSW path).
- **Causal knowledge graphs**: `agentdb_causal-edge` (graph-node backend with bridge fallback per ADR-087).

## Controllers (real registry, grouped by INIT_LEVELS)

The "controller count" reported anywhere in this plugin is **whatever the runtime tool reports**. The canonical list of names is the `ControllerName` union at `v3/@claude-flow/memory/src/controller-registry.ts:34-73` (29 names across 6 init levels). Inspect at runtime:

```bash
mcp tool call agentdb_controllers --json
```

Initialization order per ADR-053 (`controller-registry.ts:160-174`):

| Level | Controllers | Role |
|------:|-------------|------|
| 0 | _(foundation, pre-existing)_ | Bootstrap |
| 1 | `reasoningBank`, `hierarchicalMemory`, `learningBridge`, `hybridSearch`, `tieredCache` | Core intelligence |
| 2 | `memoryGraph`, `agentMemoryScope`, `vectorBackend`, `mutationGuard`, `gnnService` | Graph + security |
| 3 | `skills`, `explainableRecall`, `reflexion`, `attestationLog`, `batchOperations`, `memoryConsolidation` | Specialization |
| 4 | `causalGraph`, `nightlyLearner`, `learningSystem`, `semanticRouter` | Causal + routing |
| 5 | `graphTransformer`, `sonaTrajectory`, `contextSynthesizer`, `rvfOptimizer`, `mmrDiversityRanker`, `guardedVectorBackend` | Advanced services |
| 6 | `federatedSession`, `graphAdapter` | Session management |

`graphAdapter` is currently disabled pending an external graph-DB connection (tracked in ADR-095). Other Level-2/3 security controllers (`mutationGuard`, `attestationLog`, `gnnService`, `rvfOptimizer`, `guardedVectorBackend`) were activated by ADR-095 G7 in ruflo 3.6.23+.

## G7 controllers (activated by ADR-095)

[ADR-095](../../v3/docs/adr/ADR-095-architectural-gaps-from-april-audit.md) closed five previously-disabled AgentDB controllers:

| Controller | Role | Source |
|---|---|---|
| `gnnService` | Graph Neural Network embeddings + relational scoring over the AgentDB causal graph. No-arg construction. | `agentdb/dist/src/services/GNNService.js` |
| `rvfOptimizer` | RuVector format compaction — quantizes + dedupes vector blocks before persistence. | `agentdb/dist/src/optimizations/RVFOptimizer.js` |
| `mutationGuard` | WASM-backed proof generation for state mutations (ADR-060). | `agentdb/dist/src/security/MutationGuard.js` |
| `attestationLog` | Hash-chained audit log of mutations. Backed by a dedicated `.swarm/attestation.db`. | `agentdb/dist/src/security/AttestationLog.js` |
| `GuardedVectorBackend` | Wraps the existing vectorBackend with `mutationGuard` + `attestationLog`. | `agentdb/dist/src/backends/ruvector/GuardedVectorBackend.js` |

## Commands

- `/agentdb` — AgentDB health, controller status, session management
- `/embeddings` — RuVector embedding engine status and operations

## Skills

- `agentdb-query` — Query AgentDB with semantic routing and hierarchical recall
- `vector-search` — HNSW vector search + RaBitQ quantization + 3 tuning profiles

## Namespace convention

This plugin owns the namespace convention that downstream plugins consume. Following it keeps cross-plugin search discoverable and avoids accidental key collisions in the bridge.

### Naming

`<plugin-stem>-<intent>` in kebab-case. Examples already in the wild:

| Plugin | Namespaces |
|---|---|
| `ruflo-browser` | `browser-sessions`, `browser-selectors`, `browser-templates`, `browser-cookies` |
| `ruflo-rag-memory` | (uses bridge target `claude-memories`) |
| `ruflo-intelligence` | (uses fallback target `pattern`) |

### Reserved namespaces (do NOT shadow)

| Namespace | Owned by | Source |
|---|---|---|
| `pattern` | ReasoningBank fallback writes here | `agentdb-tools.ts:144` |
| `claude-memories` | Claude Code auto-memory bridge target | bridge |
| `default` | `memory_store` default | `memory-tools.ts` |

### Where namespace strings actually apply

Namespace is **not** a universal parameter. Read the routing carefully:

- `memory_*` and `embeddings_search` route by namespace — pass it.
- `agentdb_hierarchical-*` routes by `tier` (`working|episodic|semantic`) — namespace argument is ignored.
- `agentdb_pattern-*` routes through the ReasoningBank controller — namespace argument is ignored.
- `agentdb_causal-edge` routes through the causal graph — namespace argument is ignored.

Don't pass `namespace: 'browser-cookies'` to `agentdb_pattern-store` and expect filtering. It will be silently dropped.

### GC posture

This plugin **does not** GC namespaces. Consumer plugins that want lifecycle (e.g., `browser-sessions` after a `purge`) own their own deletion via `memory_delete` + `agentdb_consolidate`. If you need cleanup, schedule it.

### Naming guardrails

A namespace SHOULD NOT contain `:` (collides with key-internal delimiters used in the bridge), MUST be ≤200 chars, and MUST pass `validateIdentifier` (the same validator already used in `agentdb-tools.ts:122`).

## How Claude Code populates AgentDB

The `claude-memories` reserved namespace is filled by Claude Code's own auto-memory bridge, not by direct user calls. Two mechanisms:

| Mechanism | Trigger | What it writes |
|---|---|---|
| `memory_import_claude` MCP tool | Manual or hook-driven | Reads `~/.claude/projects/*/memory/*.md`, parses YAML frontmatter, splits sections, stores with 384-dim embeddings. `allProjects: true` imports from ALL Claude projects. |
| `.claude/helpers/auto-memory-hook.mjs` | `SessionStart` (import) and `SessionEnd` (sync) — wired in `.claude/settings.json` | `import` → calls into the bridge for the current project; `sync` → flows AgentDB insights back to `~/.claude/projects/*/memory/MEMORY.md` |

To inspect or refresh:

```bash
# What's in the bridge right now?
mcp tool call memory_bridge_status --json

# Force a re-import from Claude Code's project memory
mcp tool call memory_import_claude --json -- '{"allProjects": true}'

# Cross-namespace search across claude-memories + auto-memory + patterns + tasks + feedback
mcp tool call memory_search_unified --json -- '{"query": "your query"}'
```

`memory_search_unified` defaults to searching `['default', 'claude-memories', 'auto-memory', 'patterns', 'tasks', 'feedback']` — these are the namespaces the bridge actually populates. The `default` namespace is the catch-all; `auto-memory` is distinct from `claude-memories` (auto-memory holds bridge-internal cache, claude-memories holds parsed `*.md` sections).

> **Pluralization gotcha:** the ReasoningBank fallback writes to `pattern` (singular). Other hooks (`hooks pretrain`, neural training paths) write to `patterns` (plural). They are different namespaces. When in doubt, `memory_list --namespace pattern` and `memory_list --namespace patterns` will tell you which one your data is in. Don't refactor your downstream code to "fix" the pluralization until you've confirmed which namespace was actually written.

## Hook integration convention

Several Claude Code hooks fire writes into AgentDB. Consumer plugins should know which namespaces accumulate state automatically vs. by explicit call, so they don't rebuild what the hook system already provides.

| Hook | Tool invoked | Target namespace | Notes |
|------|--------------|------------------|-------|
| `SessionStart` | `memory_import_claude` (via auto-memory-hook.mjs) | `claude-memories` | Imports `~/.claude/projects/*/memory/*.md` into AgentDB on every session start |
| `SessionEnd` | `auto-memory-hook.mjs sync` | bridge → `MEMORY.md` | Flows AgentDB insights back to Claude Code's MEMORY.md |
| `post-task --train-neural` | `agentdb_pattern-store` (ReasoningBank) | `pattern` (with `memory-store-fallback` if registry unavailable) | Stores task-completion patterns for SONA distillation |
| `pretrain` (one-shot) | `memory_store` | `patterns` (plural) | Bootstrap learning corpus |
| `trajectory-begin/step/end` (ruvector hooks) | ruvector substrate (separate plugin) | sona/agentdb namespaces handled by `ruflo-ruvector` | See `plugins/ruflo-ruvector/docs/adrs/0001-pin-ruvector-0.2.25.md` |

Implication for consumer plugins:

- **Don't double-write.** If you're already calling `hooks post-task --train-neural`, you don't also need to manually `memory_store --namespace pattern`. Pick one path.
- **Don't refresh `claude-memories` yourself.** It auto-imports on every SessionStart. Manual `memory_import_claude` is for force-refresh, not steady-state.
- **Surface fallback responses.** When `controller: 'memory-store-fallback'` comes back from `agentdb_pattern-store`, the data still landed — see "Pattern-store fallback" below.

## Operational fallbacks

Three fallbacks exist in the bridge code; consumers should branch on them rather than treat them as soft failures.

### Pattern-store fallback (ADR-093 F4)

When the ReasoningBank controller registry returns null, `agentdb_pattern-store` writes through to `memory_store` and returns:

```json
{
  "success": true,
  "patternId": "pattern-...",
  "controller": "memory-store-fallback",
  "note": "ReasoningBank controller registry unavailable. Pattern persisted via memory_store."
}
```

A `controller: 'memory-store-fallback'` response is a pattern that **was persisted** — not an error. Source: `agentdb-tools.ts:138-161`.

### Causal-edge graph-node backend (ADR-087)

`agentdb_causal-edge` tries the native `@ruvector/graph-node` backend first; on failure, falls back to the bridge. The response includes `_graphNodeBackend: true` when the native backend handled the call. Source: `agentdb-tools.ts:267-290`.

### Bridge unavailable

When `bridgeHealthCheck()` returns null (the `@claude-flow/memory` package is not installed or `controller-registry.ts` is missing), every `agentdb_*` handler returns:

```json
{
  "success": false,
  "error": "AgentDB bridge not available — @claude-flow/memory not installed... Use memory_store/memory_search tools instead."
}
```

Replacement table for bridge-unavailable mode:

| Unavailable `agentdb_*` | Use instead |
|---|---|
| `agentdb_hierarchical-store` / `_recall` | `memory_store` / `memory_search` |
| `agentdb_pattern-store` / `_search` | `memory_store --namespace pattern` / `memory_search --namespace pattern` |
| `agentdb_semantic-route` | `embeddings_search` |
| `agentdb_context-synthesize` | `memory_search_unified` |

## Verification

```bash
bash plugins/ruflo-agentdb/scripts/smoke.sh
# Expected: "10 passed, 0 failed"
```

The smoke script is the contract. It calls each documented MCP tool, exercises the RaBitQ workflow, and source-inspects the fallback path (no env-var gate exists to force the fallback live).

## Architecture Decisions

- [`ADR-0001` — Optimize ruflo-agentdb (accurate surface, RaBitQ, namespacing, smoke contract)](./docs/adrs/0001-agentdb-optimization.md)

## Related Plugins

- `ruflo-rag-memory` — simple store/search/recall interface; consumes the `claude-memories` reserved namespace
- `ruflo-intelligence` — SONA neural patterns; consumes the `pattern` reserved namespace via ReasoningBank
- `ruflo-browser` — composes the namespace convention for `browser-sessions/-selectors/-templates/-cookies` (ADR-0001 §3 there)
- `ruflo-ruvector` — pinned ruvector CLI; sibling substrate plugin

## License

MIT
