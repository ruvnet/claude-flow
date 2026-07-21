---
name: llm-config
description: Configure RuVLLM local inference with model selection, MicroLoRA fine-tuning, and SONA adaptation
argument-hint: "[--model MODEL] [--adapter microlora|sona]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__ruvllm_generate_config mcp__plugin_ruflo-core_ruflo__ruvllm_status mcp__plugin_ruflo-core_ruflo__ruvllm_microlora_create mcp__plugin_ruflo-core_ruflo__ruvllm_microlora_adapt mcp__plugin_ruflo-core_ruflo__ruvllm_sona_create mcp__plugin_ruflo-core_ruflo__ruvllm_sona_adapt Bash
---

# LLM Configuration

Configure RuVLLM for local inference and fine-tuning.

## When to use

When you need to configure local LLM inference, create MicroLoRA adapters for task-specific fine-tuning, or set up SONA for real-time adaptation.

## Steps

1. **Check status** — call `mcp__plugin_ruflo-core_ruflo__ruvllm_status` to see current model and adapter state
2. **Generate config** — call `mcp__plugin_ruflo-core_ruflo__ruvllm_generate_config` with model parameters
3. **Create MicroLoRA** — call `mcp__plugin_ruflo-core_ruflo__ruvllm_microlora_create` for task-specific adapters
4. **Adapt MicroLoRA** — call `mcp__plugin_ruflo-core_ruflo__ruvllm_microlora_adapt` with training data
5. **Create SONA** — call `mcp__plugin_ruflo-core_ruflo__ruvllm_sona_create` for real-time neural adaptation
6. **Adapt SONA** — call `mcp__plugin_ruflo-core_ruflo__ruvllm_sona_adapt` with feedback signals

## MicroLoRA vs SONA

| Feature | MicroLoRA | SONA |
|---------|-----------|------|
| Speed | Minutes to train | <0.05ms adaptation |
| Scope | Task-specific fine-tuning | Real-time micro-adjustments |
| Persistence | Saved as adapter weights | Session-scoped |
| Use case | Specialized domain tasks | Continuous feedback loops |
