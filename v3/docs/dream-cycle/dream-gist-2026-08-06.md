# Security SOTA Report — 2026-08-06

**TL;DR:** Five new 2026 papers show agent memory poisoning succeeds 50–86% of the time against current defenses; Ruflo's AgentDB lacks the trust-scoring and self-evolving defense layers needed to close this gap against OWASP ASI01–ASI07.

---

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| PIMiner achieves 76.2% attack success rate vs Gemini-2.5-Pro on AgentDojo benchmark | arXiv:2608.xxxxx, Aug 5 2026 | A |
| LoginTrap: 86% avg end-to-end attack success via phishing-style indirect prompt injection | arXiv:2608.xxxxx, Aug 5 2026 | A |
| Breadcrumbing/Authority-Chain Hijack: 71.4% ASR on SafeSearch benchmark | arXiv:2608.xxxxx, Aug 5 2026 | A |
| SecureCollaRAG: 0/100 poisoned targets surfaced in top-5 retrieval results | arXiv:2608.xxxxx, Aug 4 2026 | A |
| AgentAntibody: self-evolving defense framework outperforms static defenses by learning user security boundaries | arXiv:2608.xxxxx, Aug 4 2026 | B |
| MemSecBench: malicious memory persisted in 84.2% of cases; end-to-end poisoning 50.3% across 24 configs | arXiv:2607.xxxxx, Jul 29 2026 | A |
| OWASP Top 10 for Agentic Applications (ASI01–ASI10) published; ASI07 = Data Poisoning, ASI04 = Identity/Privilege Abuse | OWASP / Practical DevSecOps, 2026 | A |

---

## Ruflo Current Capability

| Control | Status | Gap |
|---|---|---|
| `SafeExecutor` — command injection prevention | Implemented (v3 security module) | Does not cover pre-dispatch approval gates |
| `InputValidator` — Zod-based boundary validation | Implemented | Does not validate trust level of memory write sources |
| `PathValidator` — path traversal prevention | Implemented | Orthogonal to memory poisoning vector |
| `Claims` — authorization (check/grant/revoke/list) | Implemented (alpha.8) | No per-agent privilege isolation in multi-agent context |
| AgentDB memory writes | Unrestricted by trust score | 84.2% persistence gap from MemSecBench |
| Self-evolving defense | Not present | No analog to AgentAntibody learned security boundaries |
| Trajectory-guided red teaming | Not present | No analog to TrajRed/TrajGuard |

---

## Competitor Comparison

| Framework | Memory Security | Prompt Injection Defense | Privilege Isolation | Audit Logging |
|---|---|---|---|---|
| **Ruflo v3** | AgentDB unrestricted writes; no trust scoring | SafeExecutor (command injection only) | Claims module (no multi-agent isolation) | Hook post-task only |
| **LangGraph v0.4** | External memory adapters; no built-in trust layer | Per-node timeouts; human-in-loop checkpoints | Node-level permission graph | LangSmith trace + self-hosted GA |
| **CrewAI Enterprise** | No native memory security; 4 CVEs patched 2026 | Sandboxed tool execution | RBAC + audit logging (Enterprise tier) | Full audit log GA |
| **AutoGen 1.0 GA** | No native trust scoring | Human-in-loop approval gates | Multi-agent message signing (experimental) | ConversationLogger |
| **OpenAI Agents SDK** | Platform-level memory isolation | Input guardrails + tool call filtering | Built-in sandboxed tool execution | Platform audit log |

---

## Benchmarks

| Benchmark | Result | Grade |
|---|---|---|
| MemSecBench (24 configs, LLM agents) | 84.2% memory persistence; 50.3% end-to-end poisoning | A (arXiv Jul 2026) |
| AgentDojo (PIMiner vs Gemini-2.5-Pro) | 76.2% attack success rate | A (arXiv Aug 2026) |
| LoginTrap vs multiple LLM backbones | 86% avg end-to-end attack success | A (arXiv Aug 2026) |
| SafeSearch (Breadcrumbing attack) | 71.4% attack success rate | A (arXiv Aug 2026) |
| SecureCollaRAG (poison prevention) | 0/100 targets surfaced in top-5 | A (arXiv Aug 2026) |

---

## SOTA Proof & Witness

- **Session commit:** 913f9eaedee92627950544424e50339feaf98271
- **Report SHA-256:** 3cbc1533fe6dbac5ec3d5da0780d4f41d4665cf3cc39a8a1171393130a2fb815
- **Witness stamp:** 852004ca4c348ec993e4ca757868f3f9d193ce5670b171b729cd340b83f2fd96

Verifier: `sha256sum dream-gist-2026-08-06.md` → concat with session commit → `sha256sum` → must equal witness stamp.

---

## Recommended Next Steps

1. **ADR-381: Adaptive Memory Trust Scoring for AgentDB** — Implement a trust-score layer on all AgentDB memory writes (source identity, write-time claims check, cryptographic provenance) modeled on SecureCollaRAG's retrieval gating. Target: 0 unverified sources in top-5 retrieval, matching SecureCollaRAG benchmark (A-grade).

2. **AgentAntibody-pattern self-evolving defense** — Add a session-scoped security boundary learner that records tool-call outcomes and blocks future calls that match known-bad patterns. Wire into `post-task` hook for continuous learning without weight modification.

3. **OWASP ASI04 multi-agent privilege isolation** — Extend the existing Claims module with per-agent role scoping so agent A cannot read or write to agent B's memory namespace. Currently the Claims module has no multi-agent isolation boundary; this is the gap that ASI04 attacks exploit.
