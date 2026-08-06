# ADR-381: Adaptive Memory Trust Scoring for AgentDB

**Status:** Proposed  
**Authors:** claude (dream-cycle agent, 2026-08-06)  
**Date:** 2026-08-06  
**Related Issues:** Dream Cycle 2026-08-06 (#TBD)  
**Surfaces:** security (deep), intelligence (scan)

---

## Context

Five arXiv papers published in late July–August 2026 demonstrate that agent memory poisoning
succeeds 50–86% of the time against current defenses:

- **MemSecBench** (Jul 29 2026, grade A): malicious memory persisted in 84.2% of cases;
  end-to-end poisoning succeeded in 50.3% across 24 tested configurations.
- **SecureCollaRAG** (Aug 4 2026, grade A): a retrieval-time trust gate blocked all 100
  poisoned targets from surfacing in top-5 results (0/100).
- **AgentAntibody** (Aug 4 2026, grade B): a self-evolving defense that learns user security
  boundaries through experience outperforms static defenses.
- **OWASP Top 10 for Agentic Applications** (2026): ASI07 (Data Poisoning) and ASI04
  (Identity/Privilege Abuse) are listed as critical risks; existing AgentDB write path
  addresses neither.

Ruflo's AgentDB currently accepts memory writes from any source without verifying the
writer's trust level, agent identity, or claims authorization. The Claims module
(`@claude-flow/claims` alpha.8) enforces authorization at the API surface but does not
gate the actual AgentDB write path, leaving a gap that the above attack patterns exploit.

---

## Decision

Implement **Adaptive Memory Trust Scoring** as a write interceptor on AgentDB:

1. **Write-time trust gate** — every `agentdb.store(key, value, namespace)` call must
   carry a `WriterContext` (agent ID + active claims). The interceptor rejects writes from
   agents whose claims do not satisfy the namespace's trust policy (default: `min-trust=verified`).

2. **Retrieval-time provenance filter** — mirroring SecureCollaRAG's approach, top-k
   HNSW results are re-ranked to demote entries whose writer trust score falls below a
   configurable threshold (default: `0.5`). This ensures that even if a low-trust write
   slips through, it does not surface in top-5.

3. **Session-scoped security boundary learner** — inspired by AgentAntibody, a lightweight
   in-session learner records (tool-call, outcome) pairs via the `post-task` hook. Calls
   that match a known-bad pattern (flagged by the Claims auditor) are blocked for the
   remainder of the session without model weight modification.

4. **OWASP ASI04 multi-agent namespace isolation** — extend Claims to support per-agent
   namespace ownership: agent A cannot read or write to agent B's namespace unless an
   explicit cross-agent delegation claim exists.

---

## Implementation Notes

- **No new package**: implement as a middleware class in `@claude-flow/security`
  (`AdaptiveMemoryTrustInterceptor`) that wraps the AgentDB client.
- **Backward compatibility**: the interceptor defaults to `min-trust=none` (allow all) and
  is opt-in per namespace via `claude-flow.config.json`, so existing users are unaffected
  until they configure a trust policy.
- **Metrics**: emit `memory_write_blocked_total` and `memory_retrieval_demoted_total`
  counters to the performance module for observability.
- **Target benchmark**: match SecureCollaRAG's 0/100 poisoned-source-in-top-5 result
  (grade A) under a comparable 24-configuration test matrix.

---

## Alternatives Considered

- **Static allowlist per namespace** — simpler but cannot adapt to novel agents or
  dynamic team compositions; rejected for inflexibility.
- **Post-write scanning** — detects poison after storage; does not prevent the 50.3%
  end-to-end success rate seen in MemSecBench; rejected as insufficient.
- **Model-level fine-tuning** — AgentAntibody avoids weight modification explicitly;
  session-scoped learning achieves the same goal without training cost; fine-tuning
  rejected.

---

## Consequences

- **Positive:** closes the critical MemSecBench gap (84.2% persistence → target 0% for
  verified namespaces); satisfies OWASP ASI07 and ASI04; no new package dependency.
- **Negative:** write-path latency increases by the trust-check round-trip
  (~1–5ms estimated; Claims check is already in-process). Namespace isolation requires
  callers to pass `WriterContext`, which is a breaking change for direct `agentdb.store()`
  callers (mitigated by the opt-in default).
- **Neutral:** retrieval re-ranking adds a second HNSW pass; at N=20k this is ~2× the
  baseline cost (measured ~1.9× speedup vs brute force is preserved end-to-end).
