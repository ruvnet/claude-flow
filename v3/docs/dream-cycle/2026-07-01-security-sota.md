# Security SOTA Report — 2026-07-01

**TL;DR**: Six 2026 Grade A papers prove Ruflo's AgentDB retrieval pipeline is a high-confidence attack surface: certified defenses cut agent memory poisoning from 93–100% ASR to 0%, but Ruflo has neither a retrieval-layer injection filter nor behavioral forensics — and MCP caller identity remains unauthenticated across all major frameworks.

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| SMSR certified defense cuts multi-session RAG poisoning from 93–100% → 0% | arXiv:2606.12703 (Jun 2026) | A |
| Forensic Trajectory Signatures detect memory poisoning: AUC=0.9904, generalizes across frontier models without retraining | arXiv:2606.30566 (Jun 2026) | A |
| MIRROR: image poisoning ASR 76% vs 52% baseline; ships ART-SafeBench (41,000+ records) | arXiv:2606.26793 (Jun 2026) | A |
| Capability Gates Are Not Authorization: all 3 major frameworks (LangChain, LlamaIndex, Stripe Toolkit) conflate tool exposure with authorization; no fail-closed per-call gate by default | arXiv:2606.28679 (Jun 2026) | A |
| MCP Runtimes: naive baseline fails 10/10 attack cases; HCP mitigation blocks all 10 | arXiv:2606.29073 (Jun 2026) | A |
| MCP Caller Identity Confusion: authorization state persists across callers with no re-auth gate; large-scale audit finding | arXiv:2603.07473 (Mar 2026) | B |
| Indirect Prompt Injection in the Wild: decomposes payloads into retrieval-guaranteed fragments; near-100% retrieval success across 11 benchmarks | arXiv:2601.07072 (Jan 2026) | A |
| OWASP LLM Top 10 2025: two new categories — LLM07 (System Prompt Leakage), LLM08 (Vector and Embedding Weaknesses) | OWASP GenAI 2025 | B |

## Ruflo Current Capability

| Layer | Current State | Gap |
|-------|--------------|-----|
| AgentDB write path | Writes accepted from any swarm agent without content verification | No poison detection before commit |
| AgentDB retrieval path | HNSW retrieves top-K, injects directly into agent context | No injection filter; OWASP LLM08 not addressed |
| MCP caller identity | No caller authentication; `SafeExecutor` validates format/syntax only | Authorization persists without re-auth (arXiv:2603.07473 pattern) |
| Memory anomaly detection | None | No behavioral forensics; AUC=0.9904 detection proven feasible |
| System prompt leakage | No guardrail on prompt exfiltration via tool outputs | OWASP LLM07 not addressed |

## Competitor Comparison

| Framework | RAG/Memory Injection Defense | MCP Caller Auth | Behavioral Forensics | Latest Version |
|-----------|------------------------------|-----------------|----------------------|----------------|
| **LangGraph** | No retrieval-layer filter; only output bleaching | No native caller auth | No | 1.2.7 (Jun 2026) |
| **AutoGen / AG2** | Docker isolation (code only); no RAG layer defense | No | No | 0.12.x Beta |
| **CrewAI** | No documented defense | No | No | 1.14.2 (Apr 2026) |
| **OpenAI Swarm** (deprecated) | N/A — ephemeral context only | N/A | No | Oct 2024 |
| **Ruflo (current)** | None (ADR-165 closes CVE-1–5, not retrieval-layer) | None | None | 3.16.2 |

**All five frameworks share the RAG injection and caller-identity gaps. Ruflo is unique in having an extensible hook system (`post-retrieve`, `pre-context-inject`) that could be the insertion point — but the hooks do not exist yet.**

## Benchmarks

| Benchmark | Metric | Grade | Source |
|-----------|--------|-------|--------|
| SMSR certified defense — multi-session RAG agent | ASR: 93–100% (undefended) → 0% (SMSR, all unsigned variants) | **A** | arXiv:2606.12703, Jun 2026 |
| Forensic Trajectory Signatures — cross-model hold-out | AUC=0.9904 overall; AUC=1.000 on 6/9 frontier-model splits | **A** | arXiv:2606.30566, Jun 2026 |
| MIRROR multimodal RAG attack | Image poisoning ASR 76% vs 52% baseline | **A** | arXiv:2606.26793, Jun 2026 |
| Indirect injection retrieval (WILD) | Near-100% retrieval success across 11 benchmarks | **A** | arXiv:2601.07072, Jan 2026 |
| HCP MCP runtime mitigation | 10/10 attacks blocked (vs 0/10 naive baseline) | **A** | arXiv:2606.29073, Jun 2026 |

## SOTA Proof & Witness

| Field | Value |
|-------|-------|
| Session commit | `1a887969548b58e77f7853fedca922fc1cb5c6aa` |
| Report SHA-256 | `df009e8f56b505a827689066cf53ee1761b75360f21dc227427e939179837135` |
| Witness stamp | `aa9f66df228edde5ec6a529b6afb79cb490941d4aaf92395d0ff553b3b8f01a0` |

*Verifier: `printf '%s%s' 'df009e8f56b505a827689066cf53ee1761b75360f21dc227427e939179837135' '1a887969548b58e77f7853fedca922fc1cb5c6aa' | sha256sum` → must yield `aa9f66df228edde5ec6a529b6afb79cb490941d4aaf92395d0ff553b3b8f01a0`*

## Recommended Next Steps

1. **Add `AgentDbRetrievalGuard` to the read path** (`v3/@claude-flow/memory/src/agentdb/retrieval-guard.ts`): run each retrieved chunk through a lightweight injection detector (regex + semantic boundary check) before injecting into agent context. Target: reduce retrieval-layer ASR from ~100% (current) toward SMSR's 0% certified bound. Priority: **High** (ADR-180).

2. **Implement `MemoryPoisonForensics` background worker** (13th worker slot, priority: `critical`): record behavioral trajectory signatures on each AgentDB write sequence; flag anomalies where trust-change score exceeds 2σ baseline. SOTA benchmark: AUC=0.9904 is achievable without retraining across frontier models (arXiv:2606.30566).

3. **Add MCP caller-identity binding to `SafeExecutor`**: every MCP tool invocation must carry an invocation-bound capability token (AIP-style, arXiv:2603.24775); `SafeExecutor` rejects calls without a fresh per-invocation token. This closes the caller-identity persistence gap (arXiv:2603.07473) and satisfies OWASP LLM07 (system prompt leakage via tool channel).
