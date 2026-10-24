# ADR-382: AgentDB Bitemporal Write Schema and Contradiction Resolution

**Status:** Proposed  
**Authors:** claude (dream-cycle agent, 2026-08-13)  
**Related:** ADR-373 (memory budget), ADR-377 (AgentDB retrieval security)  
**Source:** Dream Cycle 2026-08-13 — memory deep-dive

---

## Context

AgentDB's current write path uses last-writer-wins semantics for memory entries. The TOKI paper (arXiv 2606.06240, Aug 2026) formalizes four common contradiction-resolution heuristics — last-writer-wins, evidence-weighted merge, await-confirmation, and per-rule policy — and proves that each admits at least one of three critical anomalies: **replay inconsistency**, **belief-drift skew**, and **audit erasure**. TOKI demonstrates that all three anomalies are simultaneously excludable via a bitemporal dual-row schema with typed operators and explicit isolation preconditions.

Ruflo's current AgentDB implementation:
- Has no contradiction detection on the write path
- Silently overwrites conflicting beliefs
- Provides no audit trail of superseded facts
- Admits belief-drift skew by design (any concurrent write wins)

This is an unacceptable correctness gap for production memory-backed agents that accumulate facts across long sessions (employment changes, preference reversals, task context updates).

---

## Decision

Adopt a **bitemporal dual-row write schema** for AgentDB that:

1. **Types every write** as one of four operator classes: `OVERWRITE`, `MERGE`, `AWAIT`, or `POLICY_RULE` — each with declared isolation preconditions.
2. **Preserves losing facts** in audit rows with provenance annotations (writer, transaction time, valid time, supersession pointer) rather than deleting them.
3. **Exposes operator selection** as a per-namespace configuration key (`memory.write_operator`), defaulting to `MERGE` for semantic namespaces and `OVERWRITE` for ephemeral task namespaces.
4. **Adds a contradiction detection pass** on the HNSW retrieval path: before writing, retrieve top-3 semantically similar entries; if cosine similarity > 0.92, check for factual contradiction via a lightweight classifier (or heuristic key-value conflict check); route to the configured operator.

---

## Consequences

**Positive:**
- Eliminates replay inconsistency and audit erasure from the write path.
- Audit rows enable memory forensics and rollback for agent safety audits.
- `MERGE` operator supports the evidence-weighted pattern used by MAGMA (LoCoMo 0.700) and Mem0 (LoCoMo 92.5).
- No change to the read/HNSW search path — backward compatible.

**Negative:**
- Write latency increases by one retrieval round-trip (~5–10 ms at N=20k) for contradiction detection.
- sql.js schema migration required (add `audit_rows` table, `tx_time`, `valid_time_start`, `valid_time_end`, `superseded_by` columns).
- Operator selection adds a configuration surface that must be documented and tested.

**Neutral:**
- Audit rows grow storage by an estimated 15–30% for high-write workloads; old audit rows can be TTL-pruned separately from live entries.

---

## Alternatives Considered

- **Do nothing (last-writer-wins):** Continues to admit all three anomalies. Unacceptable for production deployments longer than one session.
- **Full TOKI implementation with soundness proofs:** Out of scope for this ADR; the typed-operator schema captures the structural guarantees without requiring a full formal proof system in-tree.
- **External contradiction resolution service:** Adds a network dependency on the write path; rejected for offline/local use cases.

---

## Implementation Notes

- Primary file: `v3/@claude-flow/memory/src/agentdb/write-operators.ts`
- Schema migration: `v3/@claude-flow/memory/src/agentdb/migrations/003-bitemporal.sql`
- Configuration key: `memory.write_operator` in `claude-flow.config.json`
- Benchmark gate: `scripts/benchmark-memory.mjs` (to be added per Recommended Next Step 3 from dream-cycle 2026-08-13)

