# ruflo-ruvllm

RuVLLM local inference with chat formatting, model configuration, MicroLoRA fine-tuning, and SONA real-time adaptation.

## Install

```
/plugin marketplace add ruvnet/ruflo
/plugin install ruflo-ruvllm@ruflo
```

## Requirements

The WASM-backed tools (`ruvllm_chat_format`, `ruvllm_microlora_*`, `ruvllm_sona_*`, `ruvllm_hnsw_*`) need `@ruvector/ruvllm-wasm`, which `@claude-flow/cli` does not install. `ruvllm_status` reports `wasm.available: false` plus a `wasm.hint` until it is present:

```bash
npm i -g @ruvector/ruvllm-wasm   # global ruflo / @claude-flow/cli install
npm i @ruvector/ruvllm-wasm      # project-local install
```

## Features

- **Model configuration**: Generate optimal configs for local inference
- **MicroLoRA**: Ultra-light in-process LoRA adapters (rank 1-4) adjusted from quality signals
- **SONA adaptation**: Real-time neural adaptation (<0.05ms)
- **Chat formatting**: Local-model chat templates (llama3, mistral, chatml, phi, gemma, or a model id for auto-detect)
- **HNSW routing**: Context retrieval for RAG pipelines (≤11 hot patterns; for large-corpus search see `ruflo-agentdb` `embeddings_search`)

## Commands

- `/ruvllm` -- ruvllm-wasm, native backend and graph backend status

## Skills

- `llm-config` -- Configure models, MicroLoRA, and SONA
- `chat-format` -- Format messages in a local model's chat template

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **Verification:** `bash plugins/ruflo-ruvllm/scripts/smoke.sh` is the contract.

## Cross-plugin tool ownership

This plugin shares the `ruvllm_*` MCP family with two sibling plugins. Each tool group has a canonical owner; this plugin is the entry point for LLM-config + chat formatting:

| Tool group | Canonical owner | This plugin's role |
|-----------|-----------------|-------------------|
| `ruvllm_sona_create`, `ruvllm_sona_adapt` | [ruflo-intelligence ADR-0001](../ruflo-intelligence/docs/adrs/0001-intelligence-surface-completeness.md) (4-step pipeline DISTILL phase) | Surfaces SONA in `llm-config` skill |
| `ruvllm_microlora_create`, `ruvllm_microlora_adapt` | [ruflo-intelligence ADR-0001](../ruflo-intelligence/docs/adrs/0001-intelligence-surface-completeness.md) (DISTILL + CONSOLIDATE phases via `--consolidate` flag) | Surfaces MicroLoRA in `llm-config` skill |
| `ruvllm_hnsw_create`, `ruvllm_hnsw_add`, `ruvllm_hnsw_route` | [ruflo-agentdb ADR-0001](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md) (WASM router, ≤11 patterns — distinct from large-corpus `embeddings_search`) | References from `chat-format` for context routing |

Source: `v3/@claude-flow/cli/src/mcp-tools/ruvllm-tools.ts:142, 169, 192, 222` (SONA + MicroLoRA) and `:57-58` (HNSW WASM router with `~11 patterns` cap).

## Namespace coordination

This plugin owns the `ruvllm-config` AgentDB namespace (kebab-case, follows the convention from [ruflo-agentdb ADR-0001 §"Namespace convention"](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md)). Reserved namespaces (`pattern`, `claude-memories`, `default`) MUST NOT be shadowed.

`ruvllm-config` stores model configurations, adapter manifests, and chat-format templates. Accessed via `memory_*` (namespace-routed).

## Verification

```bash
bash plugins/ruflo-ruvllm/scripts/smoke.sh
# Expected: "10 passed, 0 failed"
```

## Architecture Decisions

- [`ADR-0001` — ruflo-ruvllm plugin contract (cross-plugin tool ownership table, namespace coordination, smoke as contract)](./docs/adrs/0001-ruvllm-contract.md)

## Related Plugins

- `ruflo-intelligence` — owns SONA + MicroLoRA in the 4-step pipeline
- `ruflo-agentdb` — owns HNSW WASM router; namespace convention owner
- `ruflo-ruvector` — sibling substrate plugin (pinned `ruvector@0.2.25`)
- `ruflo-rag-memory` — consumes RAG context routing

## As a mod

Function-hook mod (ADR-445, pattern of `ruflo-agentdb`). It loads from `hooks/hooks.json` → `hooks/register.ts`.

A guard for local inference learning: `ruvllm_sona_adapt`, `ruvllm_microlora_adapt` and `ruvllm_hnsw_add` refuse secrets, so credentials are never trained into an adapter or indexed as a routing pattern.

- **Command**: `/ruvllm-mod` answers locally with no model call. Verbs: `status`, `scan <text>`, `tools` (which ruvllm tools are connected).
- **Status file**: `.claude-flow/ruvllm-mod/status.json` (`{version, updatedMs, ...counters}`), written at session start and as counters change.
- **Safety**: no network, no process spawning; it only uses tools already connected.
- **Option** `guard` (`on` by default, `off` to disable): a tighten-only `tool.call` guard. A call to one of the tools above whose input holds a key, token, private key or password is denied. The reason never repeats the secret.
- **Test**: `claude plugin validate plugins/ruflo-ruvllm`, `claude plugin test plugins/ruflo-ruvllm`, `bash plugins/ruflo-ruvllm/scripts/smoke.sh`.
