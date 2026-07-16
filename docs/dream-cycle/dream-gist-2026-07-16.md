# Security SOTA Report — 2026-07-16

**TL;DR:** Indirect Prompt Injection (IPI) is now quantifiably the top runtime threat for multi-agent systems in 2026; AIRGuard's runtime authority control layer cuts attack success rate from 36% to 5% with 75% utility retention — Ruflo has no equivalent, creating a critical gap in swarm tool-call security.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| LivePI benchmark: IPI attack success 10.7%–29.6% across 5 production LLMs | arXiv:2605.17986 (2026) | A |
| Two-layer defense (prompt filter + pre-exec authorization) reduces IPI ASR near 0% | arXiv:2605.17986 | A |
| AIRGuard runtime authority control: ASR 36.3%→5.5% (Sonnet), 20.9%→3.3% (Haiku) | arXiv:2605.28914 (2026) | A |
| AIRGuard utility preservation rate (UPR): 72–78% across 4 models | arXiv:2605.28914 | A |
| 193 distinct multi-agent threat items; no existing framework covers >50% of any category | arXiv:2603.09002 (Mar 2026) | A |
| OWASP Agentic Security Initiative leads frameworks at 65.3% threat coverage | arXiv:2603.09002 | A |
| Secret collusion via steganographic channels identified as emergent MAS threat class | arXiv:2505.02077 (revised Apr 2026) | B |
| OWASP LLM 2025 LLM01: Prompt Injection remains #1 LLM vulnerability class | OWASP Gen AI Project | B |
| Group-chat injection achieves uniform success across all tested models (no model is safe) | arXiv:2605.17986 | A |

---

## Ruflo Current Capability

| Component | Status | Gap |
|-----------|--------|-----|
| `@claude-flow/security` InputValidator | ✅ Zod boundary validation | Only at system boundaries, not mid-chain |
| `@claude-flow/security` PathValidator | ✅ Path traversal prevention | No semantic injection detection |
| `@claude-flow/security` SafeExecutor | ✅ Shell command injection guard | Guards OS layer, not LLM prompt layer |
| CVE-1/2/3 remediation | ✅ ADR-documented, v3 | Code-level CVEs, not MAS threat model |
| Runtime authority control (RAC) | ❌ Not implemented | No AIRGuard-class pre-exec authorization |
| IPI detection hook | ❌ Not implemented | No `pre-tool-use` semantic filter |
| Agent-to-agent trust model | ❌ No ABAC/RBAC at tool boundary | Open trust between swarm agents |
| Security benchmark (IPI) | ❌ No AgentTrap/DTAP-150 equivalent | No measurable ASR target |

---

## Competitor Comparison

| Framework | IPI Defense | Runtime Auth Control | Security Benchmarks | Open Threat Model |
|-----------|------------|---------------------|--------------------|--------------------|
| **Ruflo** | Boundary validation only | ❌ None | None published | CVE-1/2/3 (code-level) |
| **LangGraph** | LangSmith monitoring (post-hoc) | ❌ None | None public | LangChain security guides |
| **AutoGen** | None built-in | ❌ None | None public | GitHub issues only |
| **CrewAI** | None built-in | ❌ None | None public | None |
| **OpenAI Agents SDK** | Handoff approval gates | Partial (handoff scope) | None public | SDK trust docs (B) |

---

## Benchmarks

| Benchmark | Metric | Value | Source | Grade |
|-----------|--------|-------|--------|-------|
| LivePI — baseline IPI ASR (Sonnet) | Attack success rate | 29.6% | arXiv:2605.17986 | A |
| LivePI — 2-layer defense IPI ASR | Attack success rate | ~0% (all stopped) | arXiv:2605.17986 | A |
| AIRGuard — AgentTrap ASR, Sonnet | Attack success rate | 5.5% (vs 36.3% baseline) | arXiv:2605.28914 | A |
| AIRGuard — DTAP-150 ASR, Sonnet | Attack success rate | 1.0% | arXiv:2605.28914 | A |
| AIRGuard — UPR (utility) | Utility preserved | 72–78% | arXiv:2605.28914 | A |
| MAS framework coverage | Max category coverage | 65.3% (OWASP Agentic) | arXiv:2603.09002 | A |
| MAS threat items catalogued | Count | 193 distinct items | arXiv:2603.09002 | A |
| Ruflo MAS IPI ASR | Attack success rate | **No data** | — | — |

---

## SOTA Proof & Witness

**Session commit:** `a0c1ac4b4ff84360cb85b577e1da81eb661a078f`

**Report SHA-256:** `7908ee97f883d4c27fe91703daf42c9be632e5151d0d52022931174b9f9835e3`

**Witness stamp:** `ea8818663af69533bb9aa58e7019c911720a74bebf805d7bfeb3e843a729cb98`

*Verifier: `sha256sum dream-gist-2026-07-16.md` → REPORT_HASH; then `printf '%s%s' "$REPORT_HASH" "a0c1ac4b4ff84360cb85b577e1da81eb661a078f" | sha256sum` → must equal WITNESS.*

---

## Recommended Next Steps

1. **Implement `RuntimeAuthorityController` in `@claude-flow/security`** — intercept every tool call in multi-agent swarm chains, apply least-privilege ABAC before execution, model on AIRGuard's approach (arXiv:2605.28914). Target: ASR < 5% on AgentTrap equivalents; UPR > 70%.

2. **Add `pre-tool-use` IPI detection hook** — extend the v3 hooks system with a new hook type that pattern-matches injected adversarial instructions in retrieved context (documents, web content, agent messages) before the tool call executes. Two-stage: regex fast-path → LLM classifier for ambiguous cases.

3. **Adopt LivePI as Ruflo security regression benchmark** — add IPI adversarial test suite to `@claude-flow/security` test harness; publish attack-success-rate metric alongside existing CVE coverage. Target: ASR < 3% across all 7 attack surfaces catalogued in LivePI.
