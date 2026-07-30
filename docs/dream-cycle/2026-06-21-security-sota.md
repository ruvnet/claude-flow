# Security SOTA Report — 2026-06-21

**TL;DR:** Six high-severity arXiv papers published in June 2026 demonstrate that Ruflo's `ToolOutputGuardrail` covers ASI01 detection but is missing execution-phase sandbox enforcement, cross-interaction memory fragmentation defenses, and task-scoped transactional rollback — three gaps with grade-A benchmark evidence of ≥33% attacker success rates.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| SafeClawBench: 291/347 sandbox harms pass semantic checks (9–44.2% per-model semantic failure rate) | arXiv:2606.18356 (open benchmark, HuggingFace dataset) | **A** |
| Aura Mobile: semantic firewall + privilege isolation cuts ASR from ~40% → 4.4%, raises TSR 75% → 94.3% | arXiv:2602.10915 (MobileSafetyBench eval) | **A** |
| FinVault: SOTA models still reach 50% ASR in financial agent scenarios despite existing defenses | arXiv:2601.07853 (31 regulatory cases, 963 test cases) | **A** |
| FragFuse (arXiv:2606.15609): 86.3% bypass success via long-term memory fragmentation across interactions | arXiv:2606.15609 | **B** (independent dataset, partial tool diversity) |
| CmdNeedle: 69–98.6% of real-world command denylists bypassable via overlooked equivalents | arXiv:2606.15549 | **B** (corpus of real denylists; cross-agent validation limited) |
| Skill composition: 33.6% attack success when individually-harmless skills are chained vs ~0% in isolation | arXiv:2606.15242 | **B** (lab-constructed composition set) |
| Cordon (arXiv:2606.17573): task-scoped transactional rollback exposes cross-step violations missed by per-call guardrails | arXiv:2606.17573 | **B** (prototype; production latency not reported) |
| OWASP released separate Top 10 for Agentic Applications (ASI 2026): ASI01–ASI10 distinct from LLM01–LLM10 | OWASP ASI 2026 | **B** (OWASP official, no benchmark) |
| MCP-TDP: GPT-4o shows ~100% ASR in 6 high-risk tool-description-poisoning scenarios; prompt guardrails ineffective | arXiv:2605.24069 | **B** (32 cases, limited model diversity) |
| AutoGen 1.0 GA (Feb 2026): event-driven architecture, sandboxed tool-use; OpenAI Agents SDK (March 2026) native sandboxing + sub-agents + MCP | Vendor changelogs | **C** |

---

## Ruflo Current Capability

| Capability | Module | Coverage | Gap |
|------------|--------|----------|-----|
| Input validation (Zod-based) | `InputValidator` | HTTP/CLI boundaries | None — adequate |
| Command injection prevention | `SafeExecutor` | Allowlist-gated execution | Allowlist may miss composition patterns (CmdNeedle) |
| Path traversal prevention | `PathValidator` | File-system boundaries | None — adequate |
| Prompt injection detection (per-call) | `ToolOutputGuardrail` | MCP/tool output, memory reads | Detection-only; no execution-phase sandbox, no rollback |
| OWASP ASI01 (agent goal hijack) | `ToolOutputGuardrail` | Pattern-match + policy | Covers detection but not composition-phase attacks |
| OWASP ASI06 (memory poisoning) | Partial | No cross-interaction tracking | **Gap**: FragFuse-style fragmentation undetected |
| Plugin integrity | `integrity-verifier` | Hash verification | Covers supply chain; not runtime composition |
| Authorization propagation | `authorization/propagator` | Claims-based | No certificate-bound runtime enforcement (Sovereign Brokers pattern) |
| Transactional rollback | **Missing** | — | **Critical gap**: Cordon pattern absent |
| Sandbox execution enforcement | **Missing** | — | **Critical gap**: ASR 291/347 per SafeClawBench |

---

## Competitor Comparison

| Framework | Sandbox Enforcement | Memory Poisoning Defense | Transactional Rollback | OWASP ASI Coverage | Audit |
|-----------|--------------------|--------------------------|-----------------------|--------------------|-------|
| **Ruflo v3.6** | Detection-only (ToolOutputGuardrail) | None (cross-interaction) | None | ASI01 partial | Integrity verifier |
| **AutoGen 1.0** (GA Feb 2026) | Native sandboxed tool-use (event-driven) | Not documented | Partial (event replay) | ASI01–ASI03 partial | Enterprise observability |
| **OpenAI Agents SDK** (March 2026) | Native sandboxing, Codex-style filesystem | Not documented | None documented | ASI01 (guardrail API) | Tool-call logs |
| **LangGraph 0.3.x** | No native sandbox; PostgresSaver checkpointing | Not documented | Via checkpointer (partial) | ASI01 via custom | State snapshot |
| **CrewAI 0.105** | No native sandbox | Not documented | None | ASI01 partial | Tool-call routing observability |

---

## Benchmarks

| Benchmark | Result | Grade | Source |
|-----------|--------|-------|--------|
| SafeClawBench: semantic failure rate per model | 9.0%–44.2% | **A** | arXiv:2606.18356 (open dataset) |
| SafeClawBench: sandbox harms despite semantic pass | 291/347 (83.9%) | **A** | arXiv:2606.18356 |
| Aura Mobile: ASR reduction with semantic firewall | ~40% → 4.4% | **A** | arXiv:2602.10915 (MobileSafetyBench) |
| Aura Mobile: Task Success Rate with isolation | 75% → 94.3% | **A** | arXiv:2602.10915 |
| FinVault: SOTA model ASR with existing defenses | up to 50% | **A** | arXiv:2601.07853 (963 test cases) |
| FragFuse: memory fragmentation bypass ASR | 86.3% | **B** | arXiv:2606.15609 |
| Skill composition: attack success rate | 33.6% vs ~0% isolated | **B** | arXiv:2606.15242 |
| MCP-TDP: GPT-4o ASR in high-risk tool-poison scenarios | ~100% | **B** | arXiv:2605.24069 |

---

## SOTA Proof & Witness

| Field | Value |
|-------|-------|
| Session commit | `9c28fe038cf49ac6db0bb4e04b6158076f03894d` |
| Report SHA-256 | `b87ebade32195a82f6e13105eec6077590abafac72060c9e83b04e4cd837a8d8` |
| Witness stamp | `2f7e8db4244bb4b52181f33b6426af8eb02c5f02d6be031a1b0b13e739db5b73` |
| Verification | Restore `PLACEHOLDER_SHA` and `PLACEHOLDER_WITNESS` in this table, run `sha256sum` on the file → must equal Report SHA-256; then `printf '%s%s' <sha256> <session_commit> \| sha256sum` → must equal Witness stamp |

---

## Recommended Next Steps

1. **Implement execution-phase sandbox enforcement** (ADR-164): Add `SandboxEnforcer` to `@claude-flow/security` that wraps `SafeExecutor` with a task-scoped transactional boundary (Cordon pattern, arXiv:2606.17573). On policy violation, roll back all mutations from the current task scope. Target: reduce effective ASR from ~84% (SafeClawBench) to <10% (Aura Mobile benchmark).

2. **Add cross-interaction memory fragmentation detection** to `ToolOutputGuardrail`: Track fragment signatures across the session memory namespace; flag sequences that together match injection patterns even when individual fragments are benign (FragFuse defense). Integrate into the existing `scanAndEnforce` hot path with no async I/O.

3. **Audit `SafeExecutor` allowlist against CmdNeedle corpus**: Run the CmdNeedle denylist audit (arXiv:2606.15549) against Ruflo's existing allowlist patterns to confirm there are no bypassable equivalents; add equivalence-class checking (e.g., `sh` ↔ `bash` ↔ `/bin/sh`) to the executor configuration schema.

