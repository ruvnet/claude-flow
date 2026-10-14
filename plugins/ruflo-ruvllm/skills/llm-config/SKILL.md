---
name: llm-config
description: Configure RuVLLM local inference helpers: generate a config, and create and adapt in-process MicroLoRA and SONA instances from quality signals. Use when you need local, air-gapped inference tooling, not for fine-tuning hosted models.
argument-hint: "[--model MODEL] [--adapter microlora|sona]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__ruvllm_generate_config mcp__plugin_ruflo-core_ruflo__ruvllm_status mcp__plugin_ruflo-core_ruflo__ruvllm_microlora_create mcp__plugin_ruflo-core_ruflo__ruvllm_microlora_adapt mcp__plugin_ruflo-core_ruflo__ruvllm_sona_create mcp__plugin_ruflo-core_ruflo__ruvllm_sona_adapt Bash
---

# LLM Configuration

Configure RuVLLM for local inference and fine-tuning.

## When to use

When you need to configure local LLM inference, create MicroLoRA adapters for task-specific fine-tuning, or set up SONA for real-time adaptation.

## Steps

1. **Check status** — call `mcp__plugin_ruflo-core_ruflo__ruvllm_status` to see current model and adapter state. If `wasm.available` is `false`, install the add-on first (`npm i -g @ruvector/ruvllm-wasm`, or without `-g` in a project) — the MicroLoRA and SONA tools cannot run without it
2. **Generate config** — call `mcp__plugin_ruflo-core_ruflo__ruvllm_generate_config` with model parameters
3. **Create MicroLoRA** — call `mcp__plugin_ruflo-core_ruflo__ruvllm_microlora_create` with `inputDim`, `outputDim`, `rank` (1-4, default 2) and `alpha`
4. **Adapt MicroLoRA** — call `mcp__plugin_ruflo-core_ruflo__ruvllm_microlora_adapt` with `loraId` and a `quality` signal (0.0-1.0), optional `learningRate` and `success`. It takes a feedback score, not a training set
5. **Create SONA** — call `mcp__plugin_ruflo-core_ruflo__ruvllm_sona_create` with `hiddenDim` (default 64), `learningRate` and `patternCapacity`
6. **Adapt SONA** — call `mcp__plugin_ruflo-core_ruflo__ruvllm_sona_adapt` with `sonaId` and a `quality` signal (0.0-1.0)

## MicroLoRA vs SONA

| Feature | MicroLoRA | SONA |
|---------|-----------|------|
| What it is | Ultra-light LoRA adapter, rank 1-4 | Instant adaptation loop (the tool describes <1ms cycles) |
| Input | `quality` feedback per call | `quality` feedback per call |
| Persistence | None: instances live in the MCP server's memory and are lost on restart | None: same |

Neither tool fine-tunes a hosted model or writes adapter files; both adjust small in-process weights from quality scores. Keep the returned `loraId` / `sonaId` for later calls, and re-create them after a restart. For the repo's measured SONA latency see `docs/reviews/intelligence-system-audit-2026-05-29.md`.
