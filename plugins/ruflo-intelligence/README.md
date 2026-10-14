# ruflo-intelligence

User-facing surface for Ruflo's self-learning system. Wraps **29 intelligence-related MCP tools** across four families into discoverable skills, commands, and the canonical 4-step pipeline (RETRIEVE → JUDGE → DISTILL → CONSOLIDATE). Coordinates with `ruflo-agentdb` (namespace convention), `ruflo-ruvector` (trajectory recording substrate), and `ruflo-browser` (consumes trajectory hooks for session replay).

> **Status:** ADR-0001 implemented. Tool names and parameters in this plugin are checked against `@claude-flow/cli` 3.56.x; the package manifest is version truth.

## Install

```
/plugin marketplace add ruvnet/ruflo
/plugin install ruflo-intelligence@ruflo
```

## Compatibility

- **CLI:** checked against `@claude-flow/cli` 3.56.x (`mcp exec`, `hooks`, `neural` flags as in `--help`).
- **Verification:** `bash plugins/ruflo-intelligence/scripts/smoke.sh` is the contract.

## Tool inventory

| Family | Count | Source |
|--------|------:|--------|
| `neural_*` | 6 | `v3/@claude-flow/cli/src/mcp-tools/neural-tools.ts` |
| `hooks_intelligence_*` (incl. dispatcher + reset) | 10 | `v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts` |
| Routing & meta hooks (`hooks_route`, `hooks_explain`, `hooks_pretrain`, `hooks_build-agents`, `hooks_metrics`, `hooks_transfer`) | 6 | `hooks-tools.ts` |
| `hooks_model-*` (3-tier routing) | 3 | `hooks-tools.ts` |
| `ruvllm_sona_*` + `ruvllm_microlora_*` | 4 | `v3/@claude-flow/cli/src/mcp-tools/ruvllm-tools.ts` |
| **Total** | **29** | — |

## The 4-step intelligence pipeline

CLAUDE.md describes the V3 intelligence loop as four discrete phases. This plugin operationalizes them:

| Step | What happens | Tools |
|------|--------------|-------|
| **RETRIEVE** | Pull relevant patterns + past trajectories from HNSW index | `hooks_intelligence_pattern-search`, `agentdb_pattern-search`, `agentdb_semantic-route` |
| **JUDGE** | Score retrieved candidates with verdicts (success / failure / partial) | `hooks_intelligence_attention`, `neural_predict`, `hooks_explain` |
| **DISTILL** | Extract the key learnings via LoRA / SONA adaptation | `ruvllm_sona_adapt`, `ruvllm_microlora_adapt`, `neural_train`, `hooks_intelligence_learn` |
| **CONSOLIDATE** | Prevent catastrophic forgetting via EWC++ | `hooks_intelligence_learn` (EWC++ cycle), `agentdb_consolidate`, `neural_compress` |

For an end-to-end run:

```
hooks_pretrain
  → hooks_intelligence_trajectory-start
    → (each step) hooks_intelligence_trajectory-step
  → hooks_intelligence_trajectory-end
  → hooks_intelligence_learn
  → ruvllm_sona_adapt    # DISTILL
  → agentdb_consolidate  # CONSOLIDATE
  → neural_compress      # storage efficiency
```

## Cross-project pattern transfer

Two mechanisms, chosen by where the patterns are (see the `intelligence-transfer` skill):

```bash
# Copy patterns from a sibling project on disk (MCP: hooks_transfer { sourcePath, filter, minConfidence })
npx @claude-flow/cli@latest hooks transfer from-project --source ../other-project --min-confidence 0.7

# Browse, download and publish through the IPFS pattern marketplace
npx @claude-flow/cli@latest hooks transfer store search --query routing
npx @claude-flow/cli@latest hooks transfer store download --name PATTERN_NAME
```

`hooks_transfer` itself only does the project-to-project copy; it has no `store`/`load`/CID action. Publishing to the marketplace is public and needs `PINATA_API_KEY` and `PINATA_API_SECRET`; scan for PII first.

## Hook integration

Several Claude Code hooks fire intelligence-side writes:

| Hook | Tool invoked | Target |
|------|--------------|--------|
| `pre-task` | `hooks_route` + `hooks_intelligence_pattern-search` | RETRIEVE phase |
| `post-task` (pass `--task` and `--agent`) | records the outcome and, with both flags, the routing outcome (#2785) | feeds JUDGE/DISTILL |
| `pretrain` (one-shot) | `hooks_pretrain` → seeds `memory_store --namespace patterns` | Bootstrap, writes to **`patterns`** namespace (plural) |
| Trajectory hooks (ruvector substrate) | `intelligence_trajectory-*` | Recorded by `ruflo-ruvector`; consumed by this plugin's pattern-store |

> **Pluralization gotcha:** ReasoningBank fallback writes to `pattern` (singular). The `pretrain` hook writes to `patterns` (plural). They are *different* namespaces. See `ruflo-agentdb` ADR-0001 §"Namespace convention" for the canonical contract.

## Namespace coordination with ruflo-agentdb

This plugin defers to [ruflo-agentdb ADR-0001](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md) for namespace conventions. Three reserved namespaces are read by the intelligence pipeline:

| Namespace | Read by | Source |
|-----------|---------|--------|
| `pattern` | `hooks_intelligence_pattern-search`, `agentdb_pattern-search` | ReasoningBank fallback target |
| `patterns` (plural) | `hooks_pretrain`, `neural_train` corpus | distinct from `pattern` |
| `claude-memories` | `memory_search_unified` (default include) | Claude Code auto-memory bridge |

Do **not** invent new top-level namespaces for intelligence purposes — the convention is owned upstream.

## EWC++ consolidation

The plugin claims EWC++ consolidation; here's how to actually invoke it:

1. **At trajectory end**, call `hooks_intelligence_learn` to register the outcome.
2. **Periodically** (or after N task completions), call `agentdb_consolidate` to fold patterns into the long-term store under EWC++ semantics.
3. `hooks_intelligence_learn` already runs an EWC++ consolidation cycle by default (`consolidate` defaults to true). `ruvllm_microlora_adapt` takes `{ loraId, quality }` and has no consolidate option.

Without these calls, fresh trajectories overwrite older patterns without protection — the system "forgets". The pipeline diagram above bakes consolidation into step 4 deliberately.

## MoE (Mixture of Experts) routing

`hooks_intelligence` is a status call: it reports the SONA / MoE / HNSW state from the memory store and echoes the `mode` it was given. It does not switch architectures; use it to inspect, and `enableSona` / `enableMoe` / `forceTraining` to shape what it reports or trigger a training cycle. Conventional mode labels:

| Mode | When to use |
|------|-------------|
| `balanced` (default) | General-purpose: SONA + HNSW retrieval, no MoE specialization |
| `sona` | Single-domain specialization with SONA adaptation |
| `moe` | Multi-domain expert routing — recommended when tasks span 3+ distinct domains |
| `hnsw` | Pure pattern retrieval, no online adaptation |

Inspect with `npx @claude-flow/cli@latest mcp exec -t hooks_intelligence -p '{"showStatus": true}'`.

## Commands

- `/intelligence` — Dashboard: stats, metrics, model-tier distribution, routing rationale on demand
- `/neural` — Neural training and prediction (`train`, `status`, `patterns`, `predict`, `optimize`, `compress`)

## Skills

- `neural-train` — Train SONA + MicroLoRA patterns from successful tasks
- `intelligence-route` — Route tasks using learned patterns; produces a `hooks_explain` rationale
- `intelligence-transfer` — Publish/fetch patterns via IPFS (`hooks_transfer`)

## As a mod (0.4.2)

A function-hook mod ships beside the skills (ADR-445 pattern). Needs a Claude Code with mods (2.1.287+); older builds ignore it. No network, no process spawning: it only tightens calls to this plugin's own tools and reads through tools already connected.

| Piece | Default | What it does |
|---|---|---|
| **Write guard** | on | Refuses a secret in a learned pattern, trajectory step/end, `neural_train` or `hooks_transfer` call, or a `memory_store` into a pattern namespace. A transfer also refuses an email address (IPFS is public). |
| **Reset confirm** | on | Refuses `hooks_intelligence-reset` unless the call carries `confirm: true`. |
| **`/intelligence-mod`** | — | `status`, `scan <text>`, `stats` (calls `hooks_intelligence_stats` through the connected tool); answered locally, no model call. |
| **Status file** | — | `.claude-flow/intelligence-mod/status.json` (`version`, `updatedMs`, mode flags and counters); written at session start and when a counter changes. |

Options (`userConfig`): `guard` on\|off, `confirmReset` on\|off. Refusals never echo the value they matched.

```bash
claude plugin test plugins/ruflo-intelligence   # 11 tests
```

## Architecture Decisions

- [`ADR-0001` — Optimize ruflo-intelligence (surface completeness, 4-step pipeline, IPFS transfer, namespace coordination)](./docs/adrs/0001-intelligence-surface-completeness.md)

## Related Plugins

- `ruflo-agentdb` — substrate for HNSW + namespace contract; `agentdb_pattern-*` is this plugin's storage backend
- `ruflo-ruvector` — trajectory hooks substrate; `intelligence_trajectory-*` calls land in ruvector's persisted trajectories
- `ruflo-browser` — consumes trajectory hooks for session replay (ADR-0001 there)
- `ruflo-daa` — Dynamic Agentic Architecture; cognitive patterns feed routing as inputs

## License

MIT
