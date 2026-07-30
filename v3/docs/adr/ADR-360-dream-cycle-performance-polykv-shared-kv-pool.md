# ADR-360 — Cross-Agent Shared KV Pool (PolyKV Architecture)

- **Status:** Proposed
- **Date:** 2026-07-05
- **Authors:** claude (dream-cycle agent, 2026-07-05)
- **Related:** [ADR-174](ADR-174-memory-distillation-self-optimization.md) (memory distillation), [ADR-006](ADR-006-unified-memory-service.md) (unified memory), [ADR-009](ADR-009-hybrid-memory-backend.md) (hybrid memory backend)
- **Source:** Dream Cycle 2026-07-05 — performance deep-dive; arXiv:2604.24971 (PolyKV)

## Context

Ruflo currently maintains per-agent KV caches with no cross-agent sharing or compression. At 15+ concurrent agents, the per-agent approach accumulates memory linearly — a 4K-token context per agent on Llama-3-8B scale requires ~19.8 GB of KV memory for 15 agents under the default (unshared) model.

PolyKV (arXiv:2604.24971, Patel & Joshi, Apr 2026) proves that a **shared asymmetrically-compressed KV pool** collapses this to 0.45 GB (97.7% reduction) with 2.91x compression via int8 key quantization + FWHT + 3-bit Lloyd-Max value quantization, while preserving BERTScore F1 of 0.928 and perplexity degradation of only +0.57%. This is a Grade A finding (two model scales tested with specified baselines).

Two complementary findings reinforce the case for serving-layer changes:
- ConServe (arXiv Jun 2026): disaggregated prefill/decode scheduling cuts p95 TTFT by 51.08% (Grade A)
- AsymCache (arXiv Jun 2026): asymmetric segment-based KV eviction cuts TTFT 1.90–2.03x (Grade A)

The `@claude-flow/memory` package owns AgentDB + HNSW vector indexing but does not manage KV caches for LLM inference contexts. Adding a shared compressed pool requires a new coordination layer between the memory package and the CLI's agent execution path.

## Decision

Implement a **SharedKVPoolManager** in `@claude-flow/memory` that:

1. Maintains a single process-shared compressed KV pool keyed by `(model, context_hash)`
2. Applies asymmetric compression: int8 quantization for keys (3.84x measured, reconstruction cosine 0.99999); FWHT + 3-bit Lloyd-Max for values (target 2.91x per PolyKV)
3. Exposes a `kvpool://` pseudo-backend selectable via `CLAUDE_FLOW_KV_BACKEND=shared-pool`
4. Integrates with the existing `hybrid` memory backend — pool lives alongside SQLite + AgentDB
5. Exports metrics (`pool_hit_rate`, `pool_memory_bytes`, `compression_ratio`) to the performance monitoring hook

## Consequences

**Positive:**
- 97.7% KV memory reduction at 15 concurrent agents (Grade A, Llama-3-8B, 4K ctx)
- Enables higher agent concurrency on same hardware without OOM
- Compression reuses existing int8 quantization path (3.84x measured in `@claude-flow/memory`)
- Orthogonal to HNSW vector search — both can be active simultaneously

**Negative / Risks:**
- FWHT + Lloyd-Max value compression is not yet implemented in the codebase; requires new codec module
- Shared pool introduces cross-agent state — requires eviction policy and LRU accounting
- Perplexity +0.57% and BERTScore F1 0.928 are acceptable but must be verified against Ruflo's specific models
- Pool requires a benchmark gate (compare vs current per-agent baseline) before enabling by default

**Neutral:**
- Speculative decoding (4.48x throughput, IBM arXiv:2606.18502) and disaggregated scheduling (ConServe, 51% TTFT) are related optimizations but scoped to separate ADRs — this ADR covers the KV pool only

## Implementation Path

1. `v3/@claude-flow/memory/src/kv-pool/` — new module: `SharedKVPoolManager`, `AsymmetricKVCodec` (int8 keys + FWHT+Lloyd-Max values), `KVEvictionPolicy` (LRU)
2. `v3/@claude-flow/memory/src/index.ts` — export `SharedKVPoolManager`; register `kvpool://` backend
3. `v3/@claude-flow/cli/src/commands/performance/` — add `kv-pool` subcommand (status, flush, benchmark)
4. `scripts/benchmark-kv-pool.mjs` — measure pool vs per-agent baseline at N=5,10,15 agents; gate merge on ≥90% memory reduction and BERTScore F1 ≥0.90
5. `CLAUDE.md` performance table — add row once benchmark validates

## Alternatives Considered

- **Per-agent int8 quantization only (no sharing):** Captures ~3.84x compression but not the cross-agent sharing benefit; still linear with agent count. Rejected — leaves the primary gap open.
- **External KV cache service (Redis/Memcached):** Introduces network hop; adds operational dependency. Rejected for initial implementation — in-process shared pool first.
- **Wait for upstream LLM serving framework support:** vLLM and SGLang are moving toward cross-request KV sharing; Ruflo could delegate. Acceptable future path but blocks on external timeline. Implement own first.
