# ADR-354: AgentDB Memory Write Verification and Temporal Supersession Layer

**Status**: Proposed  
**Authors**: claude (dream-cycle agent, 2026-06-28)  
**Dream Cycle Issue**: #TBD (filed same night)  
**References**: TRUSTMEM (arXiv 2606.25161), MemStrata (arXiv 2606.26511), MemClaw (arXiv 2606.24535)

---

## Context

Two Grade A arXiv papers published in June 2026 expose two distinct but related gaps in AgentDB's write pipeline:

**Gap 1 — No write verification**: AgentDB commits memory updates without checking coverage (all key facts captured), preservation (no prior facts silently dropped), or faithfulness (no new facts hallucinated). TRUSTMEM (Yang et al., 2606.25161) demonstrates that unguarded memory updates accumulate 40.1% omissions, 79.1% corruptions, and 50.0% hallucinations at scale. A `MemoryTransitionVerifier` reduces all three.

**Gap 2 — No temporal supersession**: AgentDB uses embedding similarity to detect stale facts, which achieves only 0.20–0.47 accuracy on evolving-knowledge workloads. MemStrata (Yadav, 2606.26511) shows that deterministic supersession rules — keyed on `entity:predicate` pairs — achieve 0.95–1.00 accuracy on the same workloads by hard-replacing rather than similarity-ranking.

These gaps are architectural: both require changes to the AgentDB write path and the maintenance module, not just tuning of existing retrieval parameters.

---

## Decision

Add two new components to AgentDB's write path:

### 1. MemoryWriteVerifier (post-write gate)

Insert a verification step after LLM-produced memory updates and before they are committed to AgentDB storage:

```typescript
interface MemoryWriteVerification {
  coverage: number;      // 0–1: fraction of source facts captured
  preservation: number;  // 0–1: fraction of prior facts retained where expected
  faithfulness: number;  // 0–1: fraction of written facts grounded in source
  verdict: 'commit' | 'retry' | 'rollback';
}
```

- `coverage < 0.8` → retry with gap-filling prompt
- `faithfulness < 0.85` → rollback + alert
- `preservation < 0.9` on a non-superseding write → rollback + alert
- All thresholds pass → commit

Implementation: lightweight LLM-as-judge call (Haiku tier, ~500ms, ~$0.0002 per write) comparing the proposed write against the source context and prior memory state.

### 2. EntityPredicateSupersessionLayer (write-time key resolution)

Every AgentDB write MUST declare an `entityPredicateKey` string (e.g., `"user:prefs:theme"`, `"agent:ruflo:version"`). The write path checks for an existing record with the same key:
- If found → hard-supersede (delete old, write new, record provenance link)
- If not found → normal insert

This replaces the current similarity-threshold stale-detection approach. Keys can be auto-generated from the entity + predicate fields of a structured memory record, or manually specified.

---

## Consequences

**Positive**:
- Target ≥50% reduction in memory corruption events (TRUSTMEM Grade A benchmark extrapolated to Ruflo workloads)
- Target 0.90+ accuracy on internal evolving-knowledge eval (vs ~0.40 estimated from current RAG baseline)
- Provenance chain enables future MemClaw-style derivation reconstruction

**Negative / Trade-offs**:
- Write latency: +500ms per LLM-verified write (Haiku tier). Mitigation: async verification with optimistic commit, rollback on failure within 5s window.
- EntityPredicateKey must be defined for every write — adds schema discipline burden on callers. Mitigation: auto-generate from structured fields where possible; fall back to hash of content for unstructured writes (no supersession, just insert).
- Not applicable to bulk ingestion flows (ReasoningBank trace writes) — verification gate is for agent-produced memory updates only.

---

## Implementation Path

| Phase | Work | Target |
|-------|------|--------|
| 1 | Implement `MemoryWriteVerifier` (Haiku-judge, 3 metrics) | Sprint N+1 |
| 2 | Add `entityPredicateKey` field to AgentDB write schema | Sprint N+1 |
| 3 | Implement `EntityPredicateSupersessionLayer` in write path | Sprint N+1 |
| 4 | Instrument + measure against internal evolving-knowledge eval set | Sprint N+2 |
| 5 | Add provenance tracking per write (writer identity, supersedes pointer) | Sprint N+2 |

---

## Alternatives Considered

- **Tune HNSW similarity threshold** to better detect stale facts: rejected — MemStrata Grade A evidence shows similarity-based approaches plateau at 0.47, well below the 0.90+ target regardless of threshold.
- **Skip write verification, rely on retrieval-time re-ranking**: rejected — TRUSTMEM shows 79.1% corruption rate at write time; corrupted entries degrade retrieval regardless of re-ranking quality.
- **Adopt MemStrata directly as a dependency**: under consideration for later phase — for now, implement the supersession principle natively to avoid external dependency in the core write path.
