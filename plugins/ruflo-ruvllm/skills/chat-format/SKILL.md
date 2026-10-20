---
name: chat-format
description: Format chat messages in a local model's template (llama3, mistral, chatml, phi, gemma, or a model id) and route queries over a small WASM HNSW pattern index (about 11 patterns). Use when preparing prompts for local runtimes.
argument-hint: "<prompt> [--provider anthropic|openai|gemini|ollama|cohere]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__ruvllm_chat_format mcp__plugin_ruflo-core_ruflo__ruvllm_hnsw_create mcp__plugin_ruflo-core_ruflo__ruvllm_hnsw_add mcp__plugin_ruflo-core_ruflo__ruvllm_hnsw_route mcp__plugin_ruflo-core_ruflo__ruvllm_status Bash
---

# Chat Format

Format prompts for multi-provider LLM inference with context retrieval.

## When to use

When you need a prompt string in a local model's chat template (for llama.cpp, Ollama or another local runtime), or a small embedding-based router over a handful of patterns. It does not call a model and it does not format for hosted APIs: Anthropic, OpenAI and Gemini take structured messages, not a template string.

## Steps

1. **Format chat** — call `mcp__plugin_ruflo-core_ruflo__ruvllm_chat_format` with `messages` (`[{role, content}]`) and `template`: one of `llama3`, `mistral`, `chatml`, `phi`, `gemma`, or a model id to auto-detect. Both fields are required. It returns the formatted string. It needs `@ruvector/ruvllm-wasm` (`npm i -g @ruvector/ruvllm-wasm`); without it the call fails with an install hint.
2. **Create a router** (optional) — `ruvllm_hnsw_create` with `dimensions` (for example 384), `maxPatterns`, `efSearch`. The WASM router holds about 11 patterns at most (ruvllm-wasm v2.0.1), so use it for routing between a few named intents, not for document retrieval. For real document search use `memory_search` or the `ruflo-rag-memory` plugin.
3. **Add patterns** — `ruvllm_hnsw_add` with `routerId`, a `name`, and an `embedding` whose length equals the router's dimensions (you produce the embedding, for example with `embeddings_generate`).
4. **Route a query** — `ruvllm_hnsw_route` with `routerId`, the query `embedding`, and `k` (default 3).
5. **Check status** — `ruvllm_status` shows whether the WASM module loaded. Routers live in the MCP server process only; they are gone when it restarts.
