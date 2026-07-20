---
name: chat-format
description: Format prompts for different LLM providers with chat templates and HNSW-powered context retrieval
argument-hint: "<prompt> [--provider anthropic|openai|gemini|ollama|cohere]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__ruvllm_chat_format mcp__plugin_ruflo-core_ruflo__ruvllm_hnsw_create mcp__plugin_ruflo-core_ruflo__ruvllm_hnsw_add mcp__plugin_ruflo-core_ruflo__ruvllm_hnsw_route mcp__plugin_ruflo-core_ruflo__ruvllm_status Bash
---

# Chat Format

Format prompts for multi-provider LLM inference with context retrieval.

## When to use

When preparing prompts for different LLM providers (Claude, GPT, Gemini, Ollama) or building RAG pipelines with HNSW-powered context retrieval.

## Steps

1. **Format chat** — call `mcp__plugin_ruflo-core_ruflo__ruvllm_chat_format` with messages and target provider
2. **Create HNSW index** — call `mcp__plugin_ruflo-core_ruflo__ruvllm_hnsw_create` for context retrieval
3. **Add documents** — call `mcp__plugin_ruflo-core_ruflo__ruvllm_hnsw_add` to index documents
4. **Route query** — call `mcp__plugin_ruflo-core_ruflo__ruvllm_hnsw_route` to find relevant context
5. **Check status** — call `mcp__plugin_ruflo-core_ruflo__ruvllm_status` for provider availability

## Supported providers

- Anthropic (Claude) — native format
- OpenAI (GPT) — chat completion format
- Google (Gemini) — generative AI format
- Ollama — local model format
- Cohere — generate/chat format
