# Security SOTA Report — 2026-07-21

**TL;DR:** Five Grade-A papers from 2026 show that authenticated agents remain hijackable via planning-phase injection and adaptive multi-turn attacks, with Neural Cryptographic Authorization as the emerging architectural solution; no major framework — LangGraph, AutoGen, CrewAI, or OpenAI Swarm — has implemented first-class prompt injection defenses despite OWASP LLM01 ranking it the #1 risk.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| Adaptive Adversaries: stateful multi-turn attackers break all evaluated single-round defenses across tested LLM agents | arXiv (Jul 20, 2026) | **A** |
| PlanFlip: one injection into the Planner's context cascades to corrupt all downstream sub-tasks in multi-agent pipelines | arXiv (Apr/Jul 2026) | **A** |
| Neural Cryptographic Authorization: authenticated agents remain hijackable via IPI even after identity verification; mandatory cryptographic gate before any agentic action is the proposed fix | arXiv (Jul 16, 2026) | **A** |
| MemPoison: adversarial content injected via standard channels persists across turns; compositional + trigger-conditioned attacks bypass all evaluated defenses | arXiv (Jul 16, 2026) | **A** |
| Agent Skill Security: supply-chain attacks operate at repository admission and semantic retrieval stages — before a skill ever executes | arXiv (Jul 15, 2026) | **A** |
| CrewAI 1.15.1 (Jul 2026) patched a real SSRF open-redirect bypass in its built-in scraping tool, enabling agent-driven exfiltration of internal endpoints via crafted URLs | GitHub releases (Jul 2026) | **B** |

---

## Ruflo Current Capability

| Area | State |
|------|-------|
| Prompt injection (OWASP LLM01) | `@claude-flow/security` InputValidator + ADR-178 RepE detection (Proposed, not shipped) |
| Memory security | ADR-178 VMG proposed but unimplemented; MemPoison compositional blindspots unaddressed |
| Planning-phase guards | None — no injection validation at the planner boundary before sub-task distribution |
| Adaptive adversary resistance | None — hooks are single-round; no stateful attacker modeling |
| Cryptographic action gating | None — no Neural Cryptographic Authorization layer in hooks or security module |
| Skill supply-chain admission | ADR-165 proposes plugin signing; skill-lifecycle admission checks absent |
| Code execution sandboxing | None equivalent to AutoGen Docker-default |

---

## Competitor Comparison

| Framework | Version (Jul 2026) | Prompt Injection Defense | Sandboxing | Supply-Chain Auth | SSRF Fix | Human Gate |
|-----------|---------------------|--------------------------|------------|-------------------|----------|------------|
| **Ruflo** | 3.32.9 | RepE ADR-178 (proposed) | None | ADR-165 (proposed) | None | None |
| **LangGraph** | 1.2.9 | None | None | None | None | None |
| **AutoGen** | v0.7.5 | None | Docker-default ✓ | None | None | `approval_func` ✓ |
| **CrewAI** | 1.15.5 | None | None | Skill registry auth ✓ | Fixed ✓ | None |
| **OpenAI Swarm** | No releases | None | None | None | None | None |

*OWASP LLM Top 10 (2025): LLM01 Prompt Injection, LLM03 Supply Chain, LLM06 Excessive Agency, LLM08 Vector/Embedding Weaknesses — none of the four competitors have first-class LLM01 defenses at the orchestration layer.*

---

## Benchmarks

| Claim | Value | Grade | Source |
|-------|-------|-------|--------|
| Multi-turn adaptive attacks defeat all single-round defenders | Defender success rate collapses under stateful pivot attacker | **A** | arXiv Adaptive Adversaries (Jul 20, 2026) |
| PlanFlip cascade amplification via Planner context injection | Corrupts all downstream sub-tasks from a single injected payload | **A** | arXiv PlanFlip (Apr/Jul 2026) |
| MemPoison compositional trigger attacks bypass all defenses | Structural blind spots confirmed across full retrieval/execution lifecycle | **A** | arXiv MemPoison (Jul 16, 2026) |
| OWASP LLM01 = #1 risk; no framework ships orchestration-layer defenses | Audit of LangGraph, AutoGen, CrewAI, OpenAI Swarm — all absent | **A** | OWASP 2025 + competitor audit (Jul 2026) |

---

## SOTA Proof & Witness

**Session commit:** `26c35b59b40a0a95b286ccf5ac675a15edcc995f`
**Report SHA-256 (pre-stamp):** `5d839212c46a9600b6c329e95a91ffa058144c58381387564ecd3e87858b9bf6`
**Witness stamp:** `e455247f1a0e55eff837b4a8cecf6ac59aa4ec709fa6ffb28b2c6638251a0baa`

*Verifier: sha256sum the pre-stamp file, concat with session commit, sha256 → must equal Witness stamp.*

---

## Recommended Next Steps

1. **Implement Neural Cryptographic Authorization (NCA) gate** (ADR-320): before `pre-task` hooks allow tool execution, compute a neural intent signature and require cryptographic proof of authorization chain. Pattern from arXiv Jul-16-2026 "From Neural Intent to Cryptographic Authorization: Governing Agentic Workflows". Scope: `@claude-flow/security` NCA middleware + `@claude-flow/hooks` pre-task integration. Ships alongside ADR-178 RepE detection as complementary layers (detect + prevent).

2. **Harden the planning-phase against PlanFlip injection**: wrap the task planner (`hooks pre-task`) with an isolation boundary — strip any injected `<tool_call>` or `<agent_instruction>` patterns from retrieved context before distribution to sub-agents. Labels: OWASP LLM01 + LLM06 mitigation.

3. **Ship ADR-178 RepE IPI detection** (filed 2026-07-06, still Proposed): the MemPoison paper confirms structural blindspots worsen over time. Assign to `@claude-flow/hooks` background worker `audit` — add hidden-state entropy monitoring at the tool-input position. Target: one sprint to move ADR-178 from Proposed to Accepted with a concrete implementation PR.
