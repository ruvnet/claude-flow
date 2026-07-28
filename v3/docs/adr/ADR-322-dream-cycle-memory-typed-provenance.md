# ADR-322: Typed Memory Provenance in AgentDB

**Status:** Proposed  
**Authors:** claude (dream-cycle agent, 2026-07-28)  
**Date:** 2026-07-28  
**Source commit:** a158418a8b774f678dd36831be4ad1d5619b3395  

## Context

Ruflo's AgentDB stores all memory entries as flat text with HNSW vector embeddings (no claim typing). In multi-agent deployments, multiple sources (user input, agent outputs, tool results, system observations) write to shared namespaces (e.g., `collaboration`, `patterns`) without distinguishing provenance.

arXiv 2605.25869 (MemIR, May 2026) identifies this as "provenance-role collapse": agents cannot reliably determine whether a retrieved fact is a verified system observation vs a user-stated claim, leading to source-monitoring errors in long-session, multi-agent contexts.

MemSyco-Bench (arXiv 2607.01071, Jul 2026) demonstrates that retrieved memories cause sycophancy — agents over-align with user-stated facts at the cost of factual accuracy — when provenance is not enforced at retrieval time.

## Decision

Add a required `provenance_type` field to the AgentDB `vector_indexes` table and enforce it across the memory write path:

```sql
ALTER TABLE vector_indexes
  ADD COLUMN provenance_type TEXT
  CHECK(provenance_type IN (
    'user_claim', 'agent_output', 'system_observation', 'tool_result', 'unknown'
  ))
  DEFAULT 'unknown';
```

Update:
1. `memory store` CLI — accept `--provenance <type>`; default `unknown` for backward compat
2. MCP `memory_store` tool — accept `provenance_type` parameter
3. Plugin SDK contract — all official plugins MUST pass `provenance_type` when calling `memory store`; a `pre-edit` hook lint gate will warn on flat namespace writes in plugin source
4. Retrieval path — expose `--provenance-filter` on `memory search` to allow callers to restrict to trusted provenance types

## Consequences

**Positive:**
- Prevents cross-provenance sycophancy in multi-agent sessions with shared namespaces
- Aligns with MemIR SOTA (outperforms all baselines on LoCoMo + BEAM-100K per arXiv 2605.25869)
- Enables future AOEP-v0-style governance (auditing, rollback per arXiv 2606.30306)
- Backward compatible: existing entries get `provenance_type='unknown'`

**Negative:**
- Migration required for all existing memory entries (set to `unknown` default)
- Plugin authors must update SDK calls (lint gate mitigates silent failures)
- Slight schema complexity added to AgentDB

## Alternatives Considered

- **Namespace-level trust**: Assign a trust level to the whole namespace — rejected because multiple agents (trusted + untrusted) share the same `collaboration` namespace in normal operation
- **Post-retrieval re-ranking**: Filter on provenance after vector search — rejected as less efficient and still loads sycophancy-inducing entries into context

## References

- arXiv 2605.25869 — MemIR: Typed Memory Intermediate Representation
- arXiv 2607.01071 — MemSyco-Bench: Sycophancy in Agent Memory
- arXiv 2606.30306 — Always-On Agents: governance/recovery gap
- Dream Cycle 2026-07-28 gist (committed to branch, no external host)
