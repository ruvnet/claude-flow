---
name: vector-search
description: Vector search via embeddings_* (large-scale HNSW) and ruvllm_hnsw_* (WASM router for ≤11 hot patterns), with RaBitQ 1-bit quantization for 32× memory reduction
argument-hint: "<query> [--limit N] [--quantized]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__embeddings_generate mcp__plugin_ruflo-core_ruflo__embeddings_search mcp__plugin_ruflo-core_ruflo__embeddings_compare mcp__plugin_ruflo-core_ruflo__embeddings_init mcp__plugin_ruflo-core_ruflo__embeddings_status mcp__plugin_ruflo-core_ruflo__embeddings_hyperbolic mcp__plugin_ruflo-core_ruflo__embeddings_neural mcp__plugin_ruflo-core_ruflo__embeddings_rabitq_build mcp__plugin_ruflo-core_ruflo__embeddings_rabitq_search mcp__plugin_ruflo-core_ruflo__embeddings_rabitq_status mcp__plugin_ruflo-core_ruflo__ruvllm_hnsw_create mcp__plugin_ruflo-core_ruflo__ruvllm_hnsw_add mcp__plugin_ruflo-core_ruflo__ruvllm_hnsw_route mcp__plugin_ruflo-core_ruflo__memory_search_unified Bash
---

# Vector Search

Two distinct vector-search paths live in this plugin. Pick the right one — they're not interchangeable.

| Path | Tool family | Backing | Capacity | Latency |
|------|-------------|---------|----------|---------|
| **Large-scale corpus** | `embeddings_*` | `@claude-flow/memory` HNSW (Rust/Native) | up to millions of vectors | ~1.9× at N=20k, ~3.2×–4.7× at N=5k vs brute-force (measured; recall@10 ≈ 0.99). ANN wins above the crossover |
| **Hot-path router** | `ruvllm_hnsw_*` | WASM-backed router (v2.0.1) | **~11 patterns max** (`ruvllm-tools.ts:58`) | sub-ms; designed for high-priority routing, not corpus search |

The "12,500×" headline applies to the large-scale `embeddings_search` path. The WASM router is **not** that path.

## When to use

| Need | Path |
|---|---|
| Search a corpus of N ≥ 500 documents | `embeddings_search` |
| Memory-constrained corpus (≥5,000 vectors) | RaBitQ quantized — see "Quantized search" below |
| Compare two strings | `embeddings_compare` |
| Hierarchical / taxonomic data | `embeddings_hyperbolic` (Poincare ball) |
| Route a query to one of ≤11 hot patterns | `ruvllm_hnsw_route` |
| Cross-namespace search | `memory_search_unified` |

## Standard search

1. **Check status** — `mcp__plugin_ruflo-core_ruflo__embeddings_status` to verify the embedding engine.
2. **Initialize** — `mcp__plugin_ruflo-core_ruflo__embeddings_init` if not active.
3. **Generate** — `mcp__plugin_ruflo-core_ruflo__embeddings_generate` for text input.
4. **Search** — `mcp__plugin_ruflo-core_ruflo__embeddings_search` with the query.
5. **Compare** — `mcp__plugin_ruflo-core_ruflo__embeddings_compare` to measure similarity.
6. **Unified search** — `mcp__plugin_ruflo-core_ruflo__memory_search_unified` for cross-namespace.

## Quantized search (32× memory reduction)

For corpora ≥5,000 vectors and/or memory-constrained environments, use the RaBitQ 1-bit quantization workflow. Below 5,000 vectors the rebuild cost outweighs the savings — use the standard path instead.

| Step | Tool | Purpose |
|---|---|---|
| 1 | `embeddings_init` | Engine warm |
| 2 | `embeddings_rabitq_build` | One-time build of the 1-bit index after corpus is loaded |
| 3 | `embeddings_rabitq_search` | Hamming-prefilter returns top-N candidate IDs (cheap) |
| 4 | `embeddings_search` | Optional exact rerank on the candidate set (full-precision) |
| 5 | `embeddings_rabitq_status` | Index health, memory footprint, build time |

> **Note**: `embeddings_rabitq_search` returns candidate IDs only — the rerank in step 4 is the user's responsibility (mirrors the docstring at `embeddings-tools.ts:911`). Without rerank, results are approximate; with rerank, you get full-precision quality at 32× lower memory.

## Tuning

HNSW exposes three knobs that trade recall against latency. The "12,500×" headline assumes **defaults**; tune deliberately for your workload:

| Profile | `efSearch` | `M` | When to use |
|---------|-----------|-----|-------------|
| `recall-first` | 200 | 32 | Pattern recall during planning; quality matters more than ms |
| `balanced` (default) | 64 | 16 | General-purpose semantic recall |
| `latency-first` | 16 | 8 | Hot-path routing where p99 latency matters |

`efSearch` is passed via `ruvllm_hnsw_create` (`ruvllm-tools.ts:64`). `M` is registry-level today; raise as a follow-up if it should be MCP-tunable. `efConstruction` defaults to 200 in the lite index (`hnsw-index.ts:537`).

## HNSW pattern router (WASM, ≤11 patterns)

For routing a small number of high-priority patterns:
- `mcp__plugin_ruflo-core_ruflo__ruvllm_hnsw_create` — create the WASM index (cap ~11)
- `mcp__plugin_ruflo-core_ruflo__ruvllm_hnsw_add` — add a pattern
- `mcp__plugin_ruflo-core_ruflo__ruvllm_hnsw_route` — route an incoming query

This is **not** a corpus index. Treat it as a fast classifier over a curated set of patterns.

## Hyperbolic embeddings

For hierarchical data (code trees, org charts), use `mcp__plugin_ruflo-core_ruflo__embeddings_hyperbolic` which maps to Poincare ball space. Distance is geodesic, not cosine.

## CLI alternative

```bash
npx @claude-flow/cli@latest embeddings search --query "authentication patterns"
npx @claude-flow/cli@latest embeddings init
npx @claude-flow/cli@latest memory search --query "your query"
```

## Performance

Measured numbers (source: `scripts/benchmark-intelligence.mjs`, ruvector NAPI backend; recall@10 ≈ 0.99). The older "150×–12,500×" figures were brute-force-fallback artifacts and have been retired — see project CLAUDE.md "V3 Performance Targets".

| Method | Measured speedup vs brute-force |
|--------|---------------------------------|
| Brute-force scan | Baseline |
| HNSW (N=5,000) | ~3.2×–4.7× faster |
| HNSW (N=20,000) | ~1.9× faster |
| HNSW (below crossover, small N) | ties/loses vs brute-force |
| RaBitQ quantization | 32× memory reduction; 0.60 ms/query at N≈14.7k |
| `ruvllm_hnsw_route` (n≤11) | sub-ms per route, fixed cost |
