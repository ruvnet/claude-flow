# Security SOTA Report — 2026-06-06

**TL;DR:** Memory write poisoning (4 attack channels, 9 structural flaws; arXiv:2606.04329) and 9.93% MCP description-code inconsistency (arXiv:2606.04769) are the 2026 agentic security frontier; Ruflo ADR-144/145/146 cover supply chain and output guardrails but leave memory integrity validation and inter-agent message signing unguarded.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| Memory write poisoning: 4 channels, 9 structural vulns; single write → long-term influence | arXiv:2606.04329 (Dash et al., Jun 2026) | **A** |
| MCP description-code mismatch in 9.93% of real-world MCP servers creates blind spots | arXiv:2606.04769 (Shi et al., Jun 2026) | **A** |
| Membrane contrastive safety memory: highest F1 across 6 jailbreak types, 7–14% benign refusal | arXiv:2606.05743 (Choi et al., Jun 2026) | **A** |
| OWASP Top 10 for Agentic Applications 2026 (ASI01–ASI10) published, separate from LLM Top 10 | OWASP Gen AI Security Project, 2026 | **B** |
| WebMCP tool-surface poisoning: third-party scripts inject malicious tools at runtime | arXiv:2606.06387 (Lee et al., Jun 2026) | **A** |
| Voluntary agent recusal: 100% compliance with in-band access-deny signals vs. 0% without | arXiv:2606.06460 (Munirathinam, Jun 2026) | **A** |
| Adversarial feed curation flips agent decisions from 5% → 100% task compliance | arXiv:2606.00914 (Usman, Jun 2026) | **A** |

---

## Ruflo Current Capability

| Capability | Status | ADR |
|-----------|--------|-----|
| Agent authorization propagation | ✅ Implemented | ADR-144 |
| Plugin supply chain integrity | ✅ Implemented | ADR-145 |
| Tool output guardrail integration | ✅ Implemented | ADR-146 |
| Memory write validation / integrity checks | ❌ Not implemented | — |
| MCP description-code consistency verification | ❌ Not implemented | — |
| Inter-agent message signing (ASI07) | ❌ Not implemented | — |
| Agent goal monitoring / emergency shutdown (ASI10) | ❌ Not implemented | — |
| Contrastive safety memory (Membrane-style) | ❌ Not implemented | — |

---

## Competitor Comparison

| Framework | Authorization | Sandboxing | Inter-Agent Trust | Memory Security | Version |
|-----------|--------------|------------|------------------|-----------------|--------|
| **LangGraph** | Custom node logic (DIY) | None native | Graph-based conditional edges | None native | v0.4+ (May 2026) |
| **CrewAI** | Role-based per agent | None native | Role-driven task delegation | None native | v1.14+ |
| **AG2 (AutoGen)** | GroupChat manager | Docker container native | Manager-mediated conversation | None native | v0.12+ |
| **OpenAI Agents SDK** | Approval callbacks in harness | Sandbox execution (Apr 2026) | Sequential handoff + transfer validation | None documented | Apr 2026 |
| **Ruflo** | ADR-144 propagation | ADR-145 supply chain | Hive-mind Byzantine BFT | No memory integrity | 3.6.10 |

**Grade B — vendor claims cross-checked:** All five frameworks — including Ruflo — lack native memory integrity validation despite Memory & Context Poisoning being OWASP ASI06:2026. OpenAI Agents SDK leads on sandboxing; Ruflo leads on inter-agent consensus (Byzantine BFT) but has no Membrane-equivalent guardrail.

---

## Benchmarks

| Claim | Value | Source | Grade |
|-------|-------|--------|-------|
| Membrane: F1 on jailbreak defense | Highest across 6 attack types | arXiv:2606.05743 | **A** |
| Membrane: benign refusal rate | 7–14% | arXiv:2606.05743 | **A** |
| MCP description-code mismatch prevalence | 9.93% of real MCP servers | arXiv:2606.04769 | **A** |
| Memory poisoning attack surfaces | 4 write channels, 9 structural vulns | arXiv:2606.04329 | **A** |
| Agent recusal on in-band access-deny | 100% compliance | arXiv:2606.06460 | **A** |
| Adversarial feed compliance flip | 5% → 100% | arXiv:2606.00914 | **A** |

---

## Scan Findings: Intelligence (2026-06-06)

**Source:** arXiv:2606.05670 (Jun 2026) — "Do More Agents Help? Controlled Evaluation of LLM Agent Workflows"
**Finding (Grade A):** Under normalized conditions, most multi-agent systems underperform single-agent baselines by **2.56–11.29 percentage points** despite higher compute cost. Ruflo's multi-agent value must be justified by coordination quality, not headcount.

**Competitive signal:** Economy of Minds (arXiv:2606.02859) shows market-based self-organization of weak agents outperforms centralized coordination — contrasts with Ruflo's fixed-hierarchical queen topology.

---

## Scan Findings: Swarm (2026-06-06)

**Source:** arXiv:2605.10052 (May 2026) — "Swarm Skills: A Portable, Self-Evolving Multi-Agent System Specification"
**Finding (Grade A):** Portable, distributable multi-agent specs act as first-class assets enabling workflow distribution independent of runtime — Ruflo has no equivalent portable swarm-spec format.

**Competitive signal (Grade B):** LangGraph v0.4 (May 2026) adds per-node timeouts, error recovery, and graceful shutdown — Ruflo's swarm lacks per-agent circuit breakers (ADR-146 scope covers tool output only, not agent lifecycle).

---

## SOTA Proof & Witness

| Field | Value |
|-------|-------|
| Session commit | `d065b15927c6ba7318623e8af123e7980e4c6681` |
| Report SHA-256 (pre-stamp) | `8b409e9af5f38d7c322879601dfec049a344ecb45ee7a4241cb838b9015277fa` |
| Witness stamp | `5f5acdc81e2c3a13eed93e21b6d0689a59fea75498a77fa1bdeaeb0ff9acd054` |

**Verifier:** blank Witness section values → sha256sum file → concat session commit → sha256sum → must equal Witness stamp. (Pre-stamp hash per tamper-evident convention.)

---

## Recommended Next Steps

1. **Implement ASI06 Memory Integrity Validation (→ ADR-147):** Add write-channel validation to AgentDB's 4 identified attack surfaces (direct injection, retrieval-augmented write, tool-write, agent-to-agent relay). Apply `InputValidator` at each channel boundary; add integrity checksums to the `vector_indexes` table. Estimated: 2 days.

2. **Add MCP Tool Description-Code Consistency Checker:** Extend `@claude-flow/security` to scan MCP server registrations at load time — flag tools where description semantics diverge from implementation. Target: detect ≥9.93% mismatch rate validated by arXiv:2606.04769 methodology.

3. **Implement Inter-Agent Message Signing (ASI07):** Add HMAC signatures to SendMessage payloads using `TokenGenerator`; verify in the hive-mind router before dispatch. Closes ASI07:2026 gap without requiring Byzantine BFT upgrade.
