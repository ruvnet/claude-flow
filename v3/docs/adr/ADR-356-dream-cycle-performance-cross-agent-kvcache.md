# ADR-356: Cross-Agent KV-Cache Sharing for Swarm Performance

**Status:** Proposed
**Date:** 2026-06-30
**Authors:** claude (dream-cycle agent, 2026-06-30)
**Dream Cycle:** SLOT=0, DEEP=performance, source issue TBD
**Related ADRs:** ADR-006 (Unified Memory Service), ADR-009 (Hybrid Memory Backend), ADR-163 (Multi-Agent Benchmarking Suite)

---

## Context

As of June 2026, Ruflo spawns each agent in a swarm with an independent inference context. When 8 agents share the same system prompt (the default in CLAUDE.md's `maxAgents=8` anti-drift config), each agent sends the full system-prompt prefix to the model on every turn. At ~8k tokens per system prompt and 8 agents, this is 64k tokens of redundant prefill per swarm turn.

**TokenDance** (arXiv 2604.03143, April 2026, Grade A) is the first published paper to quantify collective KV-cache sharing across concurrent LLM agents:

| Metric | TokenDance Result |
|--------|-----------------|
| Per-agent cache reduction | **17.5×** |
| Concurrent agent scaling | **2.7× more agents** within same memory budget |
| Prefill speedup | **1.9×** |

The paper pools KV-cache entries by prefix hash across agents sharing a common context (system prompt, conversation history prefix), eliminating redundant computation. The approach is model-agnostic and does not require model weight changes.

**No competitor framework has productized this pattern.** LangGraph, AutoGen, CrewAI, and OpenAI Swarm all use per-agent independent contexts as of June 2026.

Additionally, **TraceLab** (arXiv Jun 2026, Grade A) characterizes 4,300 real coding-agent sessions and identifies **context bloat** (extensive input contexts with concise outputs) as the dominant latency driver — precisely the scenario that prefix-cache sharing addresses.

Ruflo already maintains a `hybrid` memory backend (SQLite + AgentDB) and a `SharedKVCache` concept exists at the infrastructure level (the `storeEntry`/`searchEntries` API). The missing piece is a prefix-hash pool that maps `(session_id, prompt_hash)` → `cached_kv_block_id` and is consulted before each agent turn.

---

## Decision

Add a `SharedKVCacheNamespace` class to `@claude-flow/memory` that implements prefix-hash pooling for swarm agents. The feature is **opt-in** via environment variable to avoid breaking existing behavior.

### Interface

```typescript
// @claude-flow/memory/src/shared-kv-cache.ts

export interface KVCacheEntry {
  prefixHash: string;          // sha256 of (session_id + prompt_prefix)
  cachedTokenCount: number;
  hitCount: number;
  createdAt: number;
  lastHitAt: number;
}

export class SharedKVCacheNamespace {
  constructor(private sessionId: string, private agentDb: AgentDB) {}

  /** Check if prefix is already cached; return entry or null */
  async lookup(promptPrefix: string): Promise<KVCacheEntry | null>;

  /** Register a new cache entry after first computation */
  async register(promptPrefix: string, tokenCount: number): Promise<KVCacheEntry>;

  /** Record a cache hit */
  async hit(prefixHash: string): Promise<void>;

  /** Evict entries older than maxAgeMs or with hitCount < minHits */
  async evict(opts: { maxAgeMs?: number; minHits?: number }): Promise<number>;

  /** Return cache stats for the current session */
  async stats(): Promise<{ entries: number; totalHits: number; estimatedTokensSaved: number }>;
}
```

### Activation

```bash
# Enable (off by default)
CLAUDE_FLOW_KV_SHARE=true npx claude-flow swarm init --topology hierarchical

# Or via config
{
  "performance": {
    "kvCacheSharing": true,
    "kvCacheMaxAgeMs": 3600000,
    "kvCacheMinHits": 2
  }
}
```

### Integration Points

1. **`swarm init`** — when `CLAUDE_FLOW_KV_SHARE=true`, create a `SharedKVCacheNamespace` instance keyed to the swarm session ID
2. **`agent spawn`** — pass the shared namespace to each agent's context; agents consult before sending prefix tokens
3. **`post-task` hook** — evict stale entries after task completion
4. **`performance benchmark --suite kvcache`** — new benchmark mode to measure actual hit rates and token savings

---

## Consequences

### Positive
- Targets 17.5× per-agent cache reduction at 8-agent swarm scale (Grade A evidence from TokenDance)
- 1.9× prefill speedup expected for common-system-prompt workloads
- No model weight changes required; works with any provider
- `CLAUDE_FLOW_KV_SHARE=false` default preserves all existing behavior

### Negative / Risks
- Cache invalidation complexity: stale entries must be evicted when system prompt changes
- Cross-agent security boundary: shared cache entries must not leak agent-private state (mitigated by keying only on the shared prefix, not per-agent turn history)
- Memory overhead: the KV-cache namespace adds entries to AgentDB; must set TTL and size limits
- The TokenDance results are for a specific model and GPU configuration; actual speedup on Ruflo's provider calls (API, not GPU) may be lower (C — implementation-dependent)

### Neutral
- ADR-163's benchmarking suite must be extended (see Recommended Actions in gist) before any public claims are made about this speedup

---

## Implementation Plan

| Phase | Action | Effort |
|-------|--------|--------|
| 1 | Add `SharedKVCacheNamespace` class to `@claude-flow/memory` | 1–2 days |
| 2 | Wire into `swarm init` behind `CLAUDE_FLOW_KV_SHARE` flag | 0.5 days |
| 3 | Add `performance benchmark --suite kvcache` backend | 1 day |
| 4 | Publish measured numbers in CLAUDE.md under "Multi-Agent Benchmarks" | After Phase 3 |

Phase 4 must precede any public speedup claims.

---

## References

- TokenDance: arXiv 2604.03143 (Apr 2026) — collective KV-cache sharing
- TraceLab: arXiv Jun 2026 — context bloat as dominant latency driver
- UltraQuant: arXiv 2606.20474 (Jun 2026) — 4-bit KV caching (complementary, not prerequisite)
- ADR-163: multi-agent benchmarking suite — must be extended before publishing results
- ADR-006: Unified Memory Service — AgentDB backend used for cache namespace storage
