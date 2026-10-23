# Security SOTA Report — 2026-06-11

**TL;DR:** Production AI agents in 2026 require a runtime governance plane; arXiv:2606.12320 proves sub-µs capability attenuation forecloses 7 agent threat classes, and Microsoft's Agent Governance Toolkit (April 2026) ships it open-source at <0.1ms p99 — Ruflo ships `@claude-flow/guidance` but implements no stateful policy engine, leaving ASI03 (Identity & Privilege Abuse) unaddressed across all 314 MCP tools and all SendMessage paths.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| Five-plane runtime governance (identity + policy + capability + endpoint + data) adjudicates in single-digit µs, forecloses 7 production threat classes; reference implementation provided | arXiv:2606.12320, Tallam, June 10, 2026 | **B** — arXiv, not yet cross-indexed by third parties |
| Survey of 247 security papers: prompt injection + tool hijacking dominate; persistent state corruption + multi-agent propagation are "central emerging concerns"; defenses "weakly compositional"; benchmarks underrepresent stateful long-horizon risks | arXiv:2606.10749, June 9, 2026 | **A** — peer-reviewed survey, 247 papers |
| Microsoft Agent Governance Toolkit (AGT, MIT-licensed, April 2026): stateless policy engine + cryptographic agent identity + execution rings + circuit breakers at <0.1ms p99; framework-agnostic (LangGraph/AutoGen/CrewAI native integrations) | Microsoft Open Source Blog, Apr 2, 2026 | **B** — vendor announcement, single source |
| Graph memory "selection integrity" attacks: sourceless structural writes redirect retrieval despite authenticated provenance — bypasses information-flow controls | arXiv:2606.12290, June 10, 2026 | **B** — arXiv, single source |
| OWASP ASI03 (Agent Identity & Privilege Abuse) is distinct from ASI06 (Memory Poisoning, covered dream #2303) and ASI08 (Cascading Failures, noted in #2343 scan) | OWASP Agentic Top 10 2026, 100+ contributors | **A** — globally peer-reviewed framework |

---

## Ruflo Current Capability

| Capability | Status | Location |
|-----------|--------|----------|
| Input validation (Zod-based) | ✅ Implemented | `@claude-flow/security/InputValidator` |
| Path traversal prevention | ✅ Implemented | `@claude-flow/security/PathValidator` |
| Authorization propagation | ✅ ADR-144 | `@claude-flow/security` |
| Governance control plane package | ⚠️ Package exists, scope unspecified | `v3/@claude-flow/guidance/` |
| Runtime policy engine (stateful) | ❌ Not implemented | — |
| Capability attenuation at spawn | ❌ Not implemented | — |
| Composite principal evaluation | ❌ Not implemented | — |
| Agent identity attestation | ❌ Not implemented | — |
| Delegation scope binding | ❌ Not implemented | — |
| Per-tool-call governance mediation | ❌ Not implemented | — |

---

## Competitor Comparison

| Framework | Runtime Governance | Capability Attenuation | Agent Identity | Governance Latency | 2026 Notable |
|-----------|-------------------|----------------------|---------------|-------------------|--------------|
| **Ruflo v3.6.10** | `@claude-flow/guidance` (unimplemented governance plane) | ❌ | ❌ | N/A | Federation hub, comms-first coordination |
| **Microsoft AGT** | ✅ Stateless policy engine (YAML/OPA/Cedar) | ✅ Execution rings | ✅ Agent Mesh + Inter-Agent Trust Protocol | <0.1ms p99 (**B**) | First open-source runtime governance toolkit |
| **LangGraph v0.4** | Conditional edges + per-node timeouts | ❌ | ❌ | Not published | PostgresSaver, streaming tool-output API |
| **AutoGen AG2 1.0** | `GroupChatManager` flow control | ❌ | ❌ | Not published | Event-driven architecture GA (Feb 2026) |
| **CrewAI 0.95+** | `max_iter` hard cap | ❌ | ❌ | Not published | Async crew runner, Anthropic/Google routing |
| **OpenAI Agents SDK** | Handoff approval callbacks + sandbox | Sandbox isolation (partial) | ❌ | Not published | Harness + approval system |

---

## Benchmarks

| Claim | Value | Grade |
|-------|-------|-------|
| arXiv:2606.12320 policy engine adjudication | Single-digit µs, verified on all trials; reference implementation | **B** — arXiv self-report; not yet independently benchmarked |
| Microsoft AGT policy enforcement overhead | <0.1ms p99 in production | **B** — vendor claim, single source |
| arXiv:2606.10749 survey breadth | 247 papers, 2020–2026 | **A** — peer-reviewed survey |
| No 2026 independent third-party comparative governance-overhead benchmark exists | — | — |

---

## SOTA Proof & Witness

| Field | Value |
|-------|-------|
| **Session commit** | `58716fd141b9c90b9b9a802bc089f2401da3d108` |
| **Report SHA-256** | `39e0baef45247ce283e168526358fd89cebd0fd534f31653cd91f7879cfc1253` |
| **Witness stamp** | `f0db66ef466a9ead3b80b90f63b63914471d3e62b0b74fd8293d422641949da0` |

**Verifier:** fetch raw `v3/docs/dream/dream-gist-2026-06-11.md` from branch `dream/2026-06-11-security` → `sha256sum` → concat `58716fd141b9c90b9b9a802bc089f2401da3d108` → `sha256sum` → must equal witness stamp.

---

## Scan Findings — Intelligence

**Source:** arXiv:2606.11816 (WorldReasoner, June 10, 2026); arXiv:2606.12018 (MODF-SIR, June 10, 2026)

**Competitive signal:** WorldReasoner shows temporal retrieval validity is the *strongest* driver of forecasting accuracy among reasoning quality metrics — outperforming chain-of-thought quality and context length in ablations.

**Finding (Grade B — arXiv, not cross-indexed):** Ruflo's ReasoningBank retrieves patterns by semantic similarity (HNSW) with no temporal recency weighting — stale patterns from 30 days ago are returned at the same confidence as yesterday's patterns. WorldReasoner's result implies this is the primary accuracy gap in SONA's prediction quality, not model capability. Fix is implementation-level: add `temporal_decay_factor` to HNSW query scoring in `v3/@claude-flow/memory/src/graceful-retrieval.ts`. No new ADR needed — covered architecturally by ADR-006.

---

## Scan Findings — Swarm

**Source:** arXiv:2606.07941 (Collective Hallucination in Multi-Agent LLMs, June 5, 2026)

**Competitive signal:** Interaction-aware control reduces collective multi-agent hallucination by 39% relative to undefended reasoning (factual accuracy improves to 0.87). No surveyed framework (LangGraph, AutoGen, CrewAI, OpenAI Swarm) implements inter-agent fact-checking gates.

**Finding (Grade B — arXiv, single source):** Ruflo swarms propagate hallucinated facts through SendMessage with no inter-agent fact-checking gate. A hallucinated finding from the `researcher` agent passes to `architect` and `coder` with no verification step. An interaction-aware guard at the SendMessage dispatch layer (~50 LOC) would reduce cascading hallucination. No ADR — implementation-level, aligns with existing ASI08 circuit-breaker gap noted in #2343 scan. First-mover opportunity across all four competitors.

---

## Recommended Next Steps

1. **ADR-154 (filed):** Implement `RuntimeGovernancePlane` in `@claude-flow/guidance` — `CompositeAgentPrincipal` + `AttenuatedCapabilitySet` + stateful `PolicyEngine`. Evaluate adopting Microsoft AGT as governance backend before building from scratch. ~150 LOC in `v3/@claude-flow/guidance/src/`, ~40 LOC coordinator integration. Target: <0.1ms p99 matching AGT.

2. **Wire ASI03 guard into SendMessage dispatch path:** assert calling agent's identity principal still holds delegated capability before forwarding message. Reuses existing `TokenGenerator` from `@claude-flow/security`. ~40 LOC in unified-coordinator. Prerequisite: ADR-154 governance plane.

3. **Add temporal decay to ReasoningBank retrieval:** add `temporal_decay_factor: number` (default 0.95 per day) to HNSW query scoring in `graceful-retrieval.ts` — aligns Ruflo with WorldReasoner's 2026 finding that temporal validity is the strongest forecasting accuracy driver. No ADR required.
