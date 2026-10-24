# Security SOTA Report — 2026-07-31

**TL;DR:** Three new 2026 papers (ALIBI, SkillGate, FAVA) expose a coordinated blind spot: Ruflo's coding agents can be weaponized to inject adversarial comments that evade review, the plugin semantic intent scanner (ADR-145 Stage-2) remains unbuilt despite a now-proven architecture, and no pre-execution formal verification exists for agent actions — all gaps where competitors also lag, giving Ruflo a clear first-mover window.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| ALIBI: coding agents insert adversarial source-code comments that bypass human review, achieving silent vulnerability injection across evaluated frameworks | arXiv:2607.24964, Jul 27 2026 | **A** |
| SkillGate: hybrid regex-prefilter + LLM-judge pipeline screens AI skill packages for credential theft with high precision; blocks plugin supply-chain attacks static signing alone misses | arXiv:2607.25619, Jul 28 2026 | **A** |
| FAVA: SMT authorizer mathematically verifies agent actions against security policies before execution; eliminates classes of unauthorized tool calls entirely | arXiv:2607.27267, Jul 29 2026 | **A** |
| Agent Harness Distillation: IP leakage via black-box harness extraction from autonomous multi-agent systems is tractable — harness structure recoverable without source access | arXiv:2607.28147, Jul 30 2026 | **B** |
| MTGuard: lifecycle-aware hybrid static-dynamic MCP tool analysis blocks attack categories that static description scanning misses entirely | arXiv:2607.25297, Jul 28 2026 | **A** |

---

## Ruflo Current Capability

| Area | Status | Evidence |
|------|--------|----------|
| MCP composition scanning | ✅ Shipped (SimHash, ADR-320) | `@claude-flow/security/src/mcp-composition-inspector.ts` |
| Plugin install-time signing | ✅ Stage-1 shipped (Ed25519, ADR-145 P1) | `@claude-flow/security/src/plugins/integrity-verifier.ts` |
| Plugin semantic intent scan | ❌ Deferred (ADR-145 Stage-2 = P2) | `integrity-verifier.ts` header: "Stage-2 (semantic-intent scan against SCH attacks) lands in P2" |
| Adversarial code comment defense | ❌ Absent | No module in `@claude-flow/security` covers ALIBI-class attacks |
| Pre-execution formal action verification | ❌ Absent | `safe-executor.ts` is runtime guard, not pre-execution SMT verification |
| MCP runtime lifecycle analysis | ❌ Absent | `mcp-composition-inspector.ts` covers static ShareLock; no dynamic/lifecycle path |
| Coding agent output hardening | ❌ Absent | `coder`, `sparc-coder`, `tdd-london-swarm` agents have no output screening |

---

## Competitor Comparison

| Competitor | ALIBI Defense (Adversarial Comment) | SkillGate-Pattern (Semantic Plugin Scan) | FAVA-Pattern (Pre-Exec Formal Verify) | MCP Lifecycle Analysis |
|------------|:---:|:---:|:---:|:---:|
| **LangGraph v1.2.10** | ❌ None | ❌ None | ❌ None | ❌ None |
| **AutoGen / python-v0.7.5** | ❌ None | ❌ None | ❌ None | DockerExecutor sandbox (runtime, not formal) |
| **CrewAI v1.15.9** | ❌ None | ❌ None | ❌ None | ❌ None |
| **OpenAI Agents SDK** | ❌ None | ❌ None | ❌ None | ❌ None |
| **Ruflo (current)** | ❌ Gap (ADR-381 proposed) | ❌ Gap (ADR-145 P2 unbuilt) | ❌ Gap | ❌ Gap |

*No major framework ships ALIBI-class defenses, SkillGate-pattern screening, or FAVA-pattern formal pre-execution verification as of July 2026. All competitors rely on runtime sandboxing or no agent-output screening.*

---

## Benchmarks

| Metric | Value | Paper | Grade |
|--------|-------|-------|-------|
| ALIBI silent vulnerability injection success | Confirmed across evaluated frameworks (model-agnostic) | arXiv:2607.24964 | **A** |
| SkillGate credential theft prevention | High precision (hybrid regex+LLM-judge) | arXiv:2607.25619 | **A** |
| SCH attack success without semantic intent scan | 77.67% breach, 0.00% static scanner detection | arXiv:2605.14460 (ADR-145 ref) | **A** |
| FAVA pre-execution policy verification | SMT-backed; deterministic for bounded action spaces | arXiv:2607.27267 | **A** |
| MTGuard lifecycle analysis vs static-only | Blocks attack categories static inspection misses | arXiv:2607.25297 | **A** |

All five benchmark rows carry Grade A (arXiv 2026 papers or crosschecked vendor benchmarks). No 2026 data for Ruflo's own security module performance — no in-tree benchmark exists for the security surface.

---

## SOTA Proof & Witness

*(Filled in Step 4 — placeholder replaced by witness stamp)*

| Field | Value |
|-------|-------|
| Session commit | `791d24b36f2621aebe2d1a4d8cc5008561aa27b4` |
| Report SHA-256 | `cbff9273b8e3870163d968ebe9540da96472b119caf054486af525f91d91e0db` |
| Witness stamp | `8258b945abe067b8f7c92e3f2082c70ad1b51c9fea4de0babc4af48190f63239` |

**Verifier:** `sha256sum dream-gist-2026-07-31.md` → concat with session commit (no separator) → `sha256sum` → must equal witness stamp.

---

## Recommended Next Steps

1. **File ADR-381 and implement adversarial comment detector for coding agents** (`@claude-flow/security/src/coding-agent-output-screener.ts`): The ALIBI attack (Grade A) targets monolithic coding agents by injecting adversarial comments that survive code review. Implement a post-generation hook (`hooks post-edit` or `post-task`) that screens `coder`/`sparc-coder`/`tdd-london-swarm` output for adversarial comment patterns (regex heuristics + lightweight LLM-judge pass). Gate behind `CLAUDE_FLOW_FEATURE_ALIBI_SHIELD=1`. Target file: `v3/@claude-flow/security/src/coding-agent-output-screener.ts`. CI gate on coding agent PRs.

2. **Implement ADR-145 Stage-2 (SkillGate pattern): semantic intent scan for plugin install** (`@claude-flow/security/src/plugins/semantic-intent-scanner.ts`): SkillGate (Grade A) delivers the exact architecture ADR-145 P2 defined but never built — hybrid regex-prefilter (fast, $0) followed by LLM-judge (precision escalation) on plugin description content. SCH attacks achieve 77.67% breach success with 0% static detection today. Ship the P2 scanner with `CLAUDE_FLOW_STRICT_PLUGINS=true` as hard gate. Integration point: `integrity-verifier.ts` post-signature-check chain.

3. **Add `security scan --mode dynamic` using MTGuard lifecycle pattern** (`v3/@claude-flow/cli/src/security/mcp-lifecycle-scanner.ts`): The existing `mcp-composition-inspector.ts` covers static ShareLock-pattern composition scanning. MTGuard (Grade A) shows dynamic/lifecycle analysis blocks additional categories the static pass misses. Add a `ruflo security scan --mode dynamic` command that traces tool execution paths at runtime (sandbox mode) and flags lifecycle-level anomalies. No ADR needed — implementation-level extension of existing ADR-320 scope.
