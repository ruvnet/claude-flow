# ADR-342: RuVector Production-Scale Backend Adoption

**Status:** Proposed
**Authors:** claude (dream-cycle agent, 2026-06-09)
**Supersedes / Extends:** ADR-017 (RuVector Integration, Accepted) — ADR-017 established the integration; this ADR governs the path to production-scale deployment.
**Related:** ADR-006 (Unified Memory Service), ADR-009 (Hybrid Memory Backend)

---

## Context

ADR-017 accepted RuVector as an integration target. The current implementation in `v3/@claude-flow/memory/src/agentdb-backend.ts` uses HNSW + RaBitQ quantization, benchmarked internally at N=5k–20k vectors (1.9x–4.7x vs brute force, recall@10 ~0.99).

In June 2026, RuVector vendor documentation (gist.github.com/ruvnet) claims:
- 50K QPS single-threaded, 100K QPS (8 threads) at 1M × 128D vectors
- p99 <5ms at 1M vectors
- Three quantization tiers: scalar 4x (97% acc), product 16x (90%), binary 32x (85%)
- Drop-in AgenticDB API compatibility

**Confidence level:** Grade C — vendor gist, no peer-reviewed benchmark. Cannot commit architecturally on Grade C alone.

**Gap identified tonight:** Competitor vector stores (Qdrant, Milvus, Weaviate) are benchmarked at 100M–1B vectors. Ruflo's only published number is at 20K vectors. The behavior above 20K — particularly QPS, recall, and memory — is unknown and undocumented.

---

## Decision

Add `ruvector` as an **optional, feature-flagged** backend in `AgentDB` configuration, gated behind independent benchmark validation before any production default change.

### Specific changes proposed

1. **`v3/@claude-flow/memory/src/agentdb-backend.ts`** — Add `BackendType = 'hnsw' | 'ruvector'` union; wire `ruvector` branch to the RuVector API surface described in ADR-017.

2. **`v3/@claude-flow/memory/src/database-provider.ts`** — Backend selection reads `CLAUDE_FLOW_VECTOR_BACKEND` env var; default remains `hnsw`.

3. **`scripts/benchmark-intelligence.mjs`** — Extend to cover 100K and 1M vector corpus; compare `hnsw` vs `ruvector` at p50/p99 and recall@10. Publish result before flipping default.

4. **`v3/@claude-flow/memory/MIGRATION.md`** — Document the manual migration path from AgentDB HNSW → RuVector for existing deployments.

### What is NOT changing

- Default backend stays `hnsw` until benchmark validates Grade-C claim
- AgenticDB API surface unchanged (RuVector is drop-in)
- No existing tests modified; new backend tested in isolation

---

## Consequences

**Positive**
- Unlocks 1M+ vector corpus for production deployments without architectural changes
- Three quantization tiers give users scalar/product/binary tradeoff control
- Maintains API compatibility (AgenticDB interface)

**Negative / Risks**
- RuVector 50K QPS claim is Grade C; if unreproducible, this ADR is moot
- Binary quantization (85% recall) is a step down from current RaBitQ (measured 0.99 recall@10 at 20K)
- Edge deployments on resource-constrained devices may not benefit from 8-thread QPS claims

---

## ADR Number Collision Note

The formula `ls v3/docs/adr/ADR-*.md | sort | tail -1 | +1` yields 147. **Six in-flight PRs (#2278, #2290, #2295, #2304, #2310, #2317) each claim ADR-147 and none has merged** (see meta-issue #2324). This ADR uses **153** (147 + 6 in-flight) to avoid further collision. Human review should renumber all 7 collision ADRs (147–153) once the PRs land.

---

## Review Gate

Do not change `CLAUDE_FLOW_VECTOR_BACKEND` default to `ruvector` until:
- `scripts/benchmark-intelligence.mjs` produces a Grade-A result at N ≥ 100K
- recall@10 ≥ 0.97 at the chosen quantization tier
- p99 latency measured at target corpus size
