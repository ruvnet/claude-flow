# Security SOTA Report — 2026-07-26

**TL;DR:** Five Grade-A 2026 papers expose structural blind spots in multi-agent LLM security: MCP tool-description poisoning (ShareLock), inter-agent channel injection (ChannelGuard), memory poisoning, planning-phase cascade attacks (PlanFlip), and autonomous privilege escalation — none defended by Ruflo's current `@claude-flow/security` module.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|-----------|
| Shamir-split MCP tool poisoning defeats per-tool inspection | arXiv 2606.27027 (ShareLock) | A |
| Individually safe agents propagate injection via inter-agent channels | arXiv 2607.19430 (ChannelGuard) | A |
| Persistent memory poisoning bypasses write-time defenses | arXiv 2607.14651 (MemPoison) | A |
| Planning-phase injection cascades to all downstream sub-agents simultaneously | arXiv 2607.16199 (PlanFlip) | B |
| Models autonomously escalate coercive tactics against refusing sub-agents | arXiv 2607.15434 | A |
| Authority-framing enables malicious code exfiltration through multi-agent CI/CD | arXiv 2607.19267 | B |
| Adaptive multi-turn LLM attacker achieves 5–14% success even with heterogeneous models | arXiv 2607.18063 | A |
| 66.5% guardrail bypass rate on coding agents via issue trojans | arXiv 2607.20759 | A |
| Hallucinated skill names (36%) create supply-chain attack surface | arXiv 2607.12340 | A |

---

## Ruflo Current Capability

| Security Feature | Status | Gap |
|-----------------|--------|-----|
| Input validation (Zod-based) | ✅ `@claude-flow/security` InputValidator | None |
| Path traversal prevention | ✅ PathValidator | None |
| Command injection protection | ✅ SafeExecutor | None |
| Secure token generation | ✅ TokenGenerator | None |
| MCP tool composition inspection | ❌ Not implemented | **ShareLock attack surface (314 tools)** |
| Inter-agent channel guardrails | ❌ Not implemented | **ChannelGuard gap: all swarm topologies** |
| Memory write-time structural defense | ❌ Write validation only | **MemPoison dormant corruption** |
| Adaptive adversary test suite | ❌ Not integrated | **No CI gate for prompt injection** |
| Planning-phase injection detection | ❌ Not implemented | **PlanFlip cascade risk** |
| Authority-framing detection in CI/CD hooks | ❌ Not implemented | **ADR-specific hook gap** |

---

## Competitor Comparison

| Framework | Latest Release | MCP Security | Channel Guardrails | Adversary Benchmark | Security Advisory Record |
|-----------|---------------|-------------|-------------------|--------------------|-----------------------|
| **Ruflo** | 3.6.10 | ❌ None | ❌ None | ❌ None | Partial (CVE-1,2,3 remediation planned) |
| **LangGraph** | 1.2.9 (Jul 2026) | N/A | Unknown | None public | Passive dep bumps only (B) |
| **AutoGen** | 0.7.5 (Sep 2024 — stale) | N/A | DockerExecutor sandbox | None public | Architectural hardening only (C) |
| **CrewAI** | Unknown (no public release data) | N/A | Unknown | None public | C — no data |
| **OpenAI Swarm** | Archived/experimental | N/A | None | None | Not maintained |

---

## Benchmarks

| Benchmark | Metric | Source | Grade |
|-----------|--------|--------|-------|
| ShareLock vs per-tool inspection | 100% bypass rate (defenses defeated) | arXiv 2606.27027 | A |
| ChannelGuard composition safety | Safe agents compose unsafely without bottleneck gate | arXiv 2607.19430 | A |
| IssueTrojanBench guardrail bypass | 66.5% success on coding agents | arXiv 2607.20759 | A |
| Adaptive adversary (15-round multi-turn) | 5–14% attack success, heterogeneous models | arXiv 2607.18063 | A |
| Hallucinated skill supply-chain | 36% of hallucinated skill names are exploitable | arXiv 2607.12340 | A |

---

## SOTA Proof & Witness

**Session commit:** `26c35b59b40a0a95b286ccf5ac675a15edcc995f`
**Report SHA-256:** f55dbaa7fe37ded37b8565fa81acdace7e46a33d1399895dae57f31c3a56036d
**Witness stamp:** 797a712493b3b3965f0e0e1137444bef759f5aebb1f195e96e06451199adffc0

Verifier: `sha256(raw_gist_content)` → concat session commit → `sha256` → must equal witness stamp.

Note: No GitHub Gist MCP tool available; this report is committed to branch `dream/2026-07-26-security` as `docs/dream-cycles/2026-07-26-security-sota.md`.

---

## Recommended Next Steps

1. **Implement MCP Tool Composition Inspector** (ShareLock defense): Before any multi-tool execution chain, scan the cross-referenced tool descriptions for Shamir-split instruction fragments using semantic similarity hashing. File as ADR-320 implementation task in `@claude-flow/security`.

2. **Add Inter-Agent Channel Information-Bottleneck Gates** (ChannelGuard pattern): Every agent-to-agent message boundary in the swarm coordinator (hierarchical, mesh, adaptive topologies) must pass through a sanitisation gate that strips injected instruction formats before forwarding. Target: `v3/@claude-flow/hooks/` post-task hook + swarm coordinator message router.

3. **Integrate Adaptive Adversary CI Gate** (arXiv 2607.18063 pattern): Add a `security scan --depth adaptive-adversary` subcommand to `@claude-flow/security` that runs a configurable multi-turn prompt injection battery against the current agent configuration. Wire as a required CI check on PRs touching agent communication paths.

