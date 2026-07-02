# ADR-161: Bi-temporal Indexing for AgentDB — Dream Cycle Memory Research

**Status**: Proposed  
**Authors**: claude (dream-cycle agent, 2026-06-18)  
**Date**: 2026-06-18  
**References**: arXiv:2606.09900 (Engram), arXiv:2606.17628 (OPD-Evolver), arXiv:2606.18406 (CoreMem), arXiv:2606.18829 (GateMem)

---

## Context

Nightly dream-cycle research (SLOT 3, DEEP=memory, 2026-06-18) surfaced three Grade-A findings that collectively expose a structural gap in Ruflo's AgentDB memory stack:

1. **Engram** (arXiv:2606.09900): A bi-temporal memory engine achieves 83.6% vs 73.2% on LongMemEval_S (+10.4pp) while consuming 9.6k vs 79k tokens (8× reduction), by separating *valid time* (when a fact was true in the world) from *transaction time* (when it was recorded in the system).

2. **OPD-Evolver** (arXiv:2606.17628): A four-level slow-fast memory hierarchy (working → episodic → semantic → archival) with on-policy distillation outperforms ReasoningBank by **11.5%** and training methods by 5.8%, enabling 9B models to challenge 397B counterparts.

3. **CoreMem** (arXiv:2606.18406): Riemannian retrieval using Fisher-Rao metrics outperforms flat HNSW by +4.51pp on Open-domain and +4.17pp on Temporal tasks, within an 8GB VRAM budget.

Ruflo's current AgentDB stores embeddings in a flat HNSW index with no temporal metadata. The ReasoningBank is a single-tier trajectory store. Neither capability matches the 2026 SOTA described above.

---

## Decision

Add bi-temporal indexing to AgentDB and restructure ReasoningBank as a 4-level slow-fast hierarchy.

### 1. Bi-temporal Schema Extension

Extend the `vector_indexes` table (sql.js / SQLite) with two time columns:

```sql
ALTER TABLE vector_indexes ADD COLUMN valid_time_start INTEGER;  -- unix ms: when fact became true
ALTER TABLE vector_indexes ADD COLUMN valid_time_end   INTEGER;  -- unix ms: when fact ceased to be true (NULL = current)
ALTER TABLE vector_indexes ADD COLUMN tx_time          INTEGER;  -- unix ms: when this record was inserted
```

Retrieval scoring changes from:

```
score = cosine_similarity(query_vec, stored_vec)
```

to:

```
score = cosine_similarity(q, v)
      × recency_decay(now - tx_time, λ=0.001)
      × temporal_relevance(query_time_window, valid_time_start, valid_time_end)
```

### 2. ReasoningBank 4-Level Hierarchy

Replace the single-tier trajectory store with a slow-fast co-evolution hierarchy:

| Level | Name | Retention | Distillation trigger |
|---|---|---|---|
| 0 | Working | Current session | On session end → Level 1 |
| 1 | Episodic | 7 days | Nightly consolidation → Level 2 |
| 2 | Semantic | 90 days | Weekly distillation → Level 3 |
| 3 | Archival | Permanent | Manual or score-threshold |

Distillation uses on-policy LoRA compression (existing LoRA adapter in `@claude-flow/neural`).

### 3. MemoryBackend Interface (prerequisite)

Both changes require a backend-swap interface (separate ADR note — may be tracked as sub-task):

```typescript
interface MemoryBackend {
  write(entry: MemoryEntry): Promise<string>;
  read(id: string): Promise<MemoryEntry | null>;
  search(query: SearchQuery): Promise<MemoryEntry[]>;
  forget(id: string, reason: ForgetReason): Promise<void>;
  checkAccess(agentId: string, entryId: string): Promise<boolean>;
}
```

---

## Consequences

**Positive**:
- Closes the Engram +10.4pp gap on LongMemEval_S
- Closes the OPD-Evolver +11.5pp gap vs ReasoningBank
- Enables 8× token reduction on memory-heavy queries
- Prerequisite for GateMem-compliant multi-user memory governance
- Unlocks CrewAI v1.14.7-style pluggable backends for plugins

**Negative / Risks**:
- Schema migration required for existing AgentDB databases
- `temporal_relevance()` scoring requires a time-window extraction step on each query
- 4-level hierarchy increases complexity; distillation jobs need scheduling

**Neutral**:
- CoreMem Riemannian retrieval is noted but deferred — requires custom distance function injection into the HNSW library; evaluate after bi-temporal indexing ships.

---

## Alternatives Rejected

- **No-op**: SOTA gap grows; OPD-Evolver benchmark directly targets Ruflo's ReasoningBank.
- **Replace HNSW with Mem0's multi-signal (semantic + BM25 + entity)**: Valid but orthogonal; multi-signal fusion is a retrieval-strategy change, bi-temporal is a schema/scoring change — tackle both but sequence bi-temporal first (higher leverage per token saved).
- **Adopt Mem0 as external memory service**: Operational dependency; Ruflo's offline-first constraint (sql.js) conflicts with Mem0's cloud API requirement.

---

## Implementation Notes

- Target file: `v3/@claude-flow/memory/src/agentdb/bitemporal.ts` (new module)
- Migration: `v3/@claude-flow/memory/src/agentdb/migrations/0005_bitemporal.sql`
- Retrieval update: `v3/@claude-flow/memory/src/agentdb/search.ts`
- ReasoningBank hierarchy: `v3/@claude-flow/memory/src/reasoning-bank/hierarchy.ts` (new)
- Tests: `tests/memory/bitemporal.test.ts`, `tests/memory/reasoning-bank-hierarchy.test.ts`

**ADR numbering note**: ADR-155 through ADR-160 are reserved by open dream-cycle PRs (in-flight). This ADR uses 161 to avoid conflicts.
