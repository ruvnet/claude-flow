# ADR-166: Memory Governance Layer — Semantic Drift Detection and Write-Path Consistency Gate

- **Status**: Proposed
- **Authors**: claude (dream-cycle agent, 2026-06-23)
- **Dream Cycle Issue**: #TBD (filed 2026-06-23)
- **DEEP Surface**: memory
- **Supersedes**: none
- **Related**: ADR-161 (bi-temporal HNSW indexing)

---

## Context

The 2026 memory SOTA literature reveals a structural failure mode in long-lived agent memory systems: **semantic drift** caused by repeated summarization cycles. Paper arXiv:2603.11768 (SSGM, Mar 2026) identifies two specific corruption paths:

1. **Topology-induced knowledge leakage** — sensitive or high-fidelity information becomes embedded in long-term storage through graph traversal during summarization, then re-surfaces in unrelated retrieval contexts.
2. **Semantic drift** — repeated summarization of summaries progressively degrades the semantic accuracy of stored memories relative to the original experience. Information that was accurate at write-time becomes a distorted abstraction at retrieval-time.

Additionally, arXiv:2601.07190 (Active Context Compression, Jan 2026) demonstrates that autonomous compression agents using a "sawtooth" pattern (compress-and-prune cycles) achieve 22.7% token reduction with identical task accuracy — but only when the compression step includes quality verification. Without a consistency gate, lossy compression compounds on itself.

Ruflo's current `AgentDB` has:
- Append-only write path (no pre-commit consistency gate)
- Flat HNSW cosine similarity (no temporal decay; ADR-161 adds bi-temporal schema but not drift detection)
- ReasoningBank with no drift detection between original trajectory and stored pattern
- No automated summarization quality verification

**This is an architectural gap**: none of the four primary competitors (LangGraph, CrewAI, AutoGen, OpenAI Agents SDK) ship a memory governance layer either — making this an open-field SOTA opportunity for Ruflo to lead.

---

## Decision

Add a `MemoryGovernor` middleware layer in `@claude-flow/memory` that intercepts all write operations and applies a three-phase consistency gate before committing to AgentDB.

### Architecture

```
Write Request
     │
     ▼
┌─────────────────────────────────┐
│       MemoryGovernor            │
│                                 │
│  Phase 1: Consistency Check     │  cosine_sim(original, summary) ≥ 0.85
│  Phase 2: Temporal Decay Tag    │  attach valid_time + decay_factor λ
│  Phase 3: Topology Leak Scan    │  cross-reference entity overlap > threshold
│                                 │
└────────────┬────────────────────┘
             │ PASS                 FAIL → flag-for-review queue
             ▼
       AgentDB Write
```

### Phase 1 — Consistency Check

Before committing any summarized memory, compare its embedding against the embedding of the original chunk(s) it summarizes. If cosine similarity < 0.85, route to a `PendingReview` queue instead of committing. This directly addresses SSGM semantic drift.

```typescript
// @claude-flow/memory/src/governance/consistency-gate.ts
export async function checkConsistency(
  original: Float32Array,
  summary: Float32Array,
  threshold = 0.85
): Promise<'commit' | 'flag'> {
  const sim = cosineSimilarity(original, summary);
  return sim >= threshold ? 'commit' : 'flag';
}
```

### Phase 2 — Temporal Decay Tagging

Every committed memory gets a `decay_factor` column (default λ=0.05) used by HNSW retrieval to weight recency:

```
retrieval_score = cosine_sim * exp(-λ * age_days)
```

This is an extension of ADR-161's bi-temporal schema (no schema conflict; adds one column).

### Phase 3 — Topology Leak Scan

Before write, check if the summary's entity set overlaps with entities from a different security context (based on claims from `@claude-flow/security`). If overlap > 30%, route to `PendingReview`. Addresses SSGM topology-induced leakage.

### Feature Flag

All three phases are gated by `CLAUDE_FLOW_MEMORY_GOVERNANCE=true` (default: `false` until latency profiling complete on production workloads).

---

## Consequences

**Positive:**
- Prevents progressive semantic degradation in long-running swarms
- Provides an audit trail of flagged writes (foundation for GateMem-class forgetting protocols, arXiv:2606.18829)
- Enables measurable LOCOMO/LongMemEval benchmark submission once implemented
- Zero behavioral change for existing callers when feature flag is off

**Negative:**
- +1 HNSW embedding lookup per write (estimated <2ms at AgentDB scale)
- `PendingReview` queue requires a drain worker (add to `hooks/workers/memory-review.ts`)
- Consistency threshold (0.85) is empirically chosen; needs calibration against Ruflo-specific workloads

**Risks:**
- False positives from legitimate abstractive summarization (intentional semantic shift) — mitigated by making threshold configurable
- Topology scan adds O(k) lookups where k = entity count; acceptable at N<100k memories

---

## Implementation Plan

1. `@claude-flow/memory/src/governance/consistency-gate.ts` — Phase 1 (cosine gate)
2. `@claude-flow/memory/src/governance/decay-tagger.ts` — Phase 2 (decay annotation)
3. `@claude-flow/memory/src/governance/topology-scanner.ts` — Phase 3 (entity leak scan)
4. `@claude-flow/memory/src/governor.ts` — orchestrates phases, exposes `governor.admit(write)` 
5. Wire `governor.admit()` into `AgentDB.write()` behind `CLAUDE_FLOW_MEMORY_GOVERNANCE` flag
6. Add `memory-review` background worker to drain `PendingReview` queue
7. Add benchmark runner target: `npx claude-flow performance benchmark --suite memory-governance`

Estimated scope: <400 lines across all files. No external dependencies beyond existing `@claude-flow/memory` ONNX/HNSW stack.

---

## References

- arXiv:2603.11768 — SSGM: Stability and Safety Governed Memory (Mar 2026)
- arXiv:2601.07190 — Active Context Compression / Focus agent (Jan 2026)
- arXiv:2602.13933 — HyMem: Hybrid Memory with Dynamic Retrieval Scheduling (Feb 2026)
- arXiv:2603.07670 — Memory for Autonomous LLM Agents survey (Mar 2026)
- ADR-161 — Bi-temporal HNSW indexing (2026-06-18)
