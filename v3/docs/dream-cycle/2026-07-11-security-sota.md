# Security SOTA Report — 2026-07-11

**TL;DR**: Agent skill/plugin supply chains are 2026's most active LLM attack vector — 19+ papers since January 2026. Grade-A findings: 77.67% confidentiality breach rate with 0.00% scanner detection (arXiv:2605.14460); 26.1% of 31,132 real-world skills contain at least one vulnerability (arXiv:2601.10338); malicious plugin ASR reaches 100% in SafeClawArena (arXiv:2606.30755). Ruflo's IPFS plugin registry has no pre-publish scanner, no behavioral manifest, and no OWASP GenAI Top 10 mapping — a first-mover opportunity no competitor has claimed.

---

## What's New in 2026

| Finding | Source | arXiv | Confidence |
|---------|--------|-------|------------|
| Payload-less skill attacks achieve 77.67% confidentiality breach + 67.33% RCE; manipulated skill files maintained **0.00% detection rate** against existing scanners | Exploiting LLM Agent Supply Chains via Payload-less Skills | 2605.14460 | **A** |
| 26.1% of 31,132 real-world skills contain ≥1 vulnerability across 14 patterns; skills with executable scripts 2.12× more likely to be vulnerable | Agent Skills in the Wild | 2601.10338 | **A** |
| Malicious plugins succeed in **100% of cases** in SafeClawArena (406 adversarial tasks); highest ASR 70%; SeClaw reduces GPT-5.4 ASR from 70% → 22% | Claw-like Agent Security (SafeClawArena) | 2606.30755 | **A** |
| Neuro-symbolic scanner achieves **93% F1** on 150,108 skills from 7 public registries; found 620 malicious skills, 76 previously unknown | "Elementary, My Dear Watson." — MalSkills | 2603.27204 | **A** |
| 1.43 million skills analyzed: "activation-ready but governance-poor" — dependency graphs have concentrated reuse; inspecting a skill alone misses signals in its dependencies | Skills Are Not Islands (SkillDepAnalyzer) | 2607.01136 | **A** |
| ClawWorm self-propagating attack: 64.5% aggregate ASR, sustained multi-hop propagation across 40,000+ active instances | ClawWorm | 2603.15727 | **A** |
| OWASP GenAI Security Project v2025: 600 experts, 18+ countries; Supply Chain Vulnerabilities + Insecure Plugin Design confirmed top agentic-specific entries | OWASP genai.owasp.org | — | **B** |

**Note**: Previous security deep-dive (2026-07-06, issue #2588, ADR-178) covered IPI / VMG / RepE at context level. Tonight's angle is orthogonal: pre-install supply-chain integrity and runtime behavioral containment of third-party plugins.

---

## Ruflo Current Capability

| Component | Current State | Gap vs SOTA |
|-----------|---------------|-------------|
| Plugin registry | IPFS/Pinata; CID-addressed; 21 optional plugins | **No pre-publish scanner** — 0.00% detection rate for payload-less attacks (arXiv:2605.14460) is the baseline without one |
| Plugin install path | `plugins install @name` fetches from IPFS; CID integrity check | **No dependency graph analysis** — skill dep graphs hide signals (arXiv:2607.01136) |
| `@claude-flow/security` InputValidator | Zod boundary validation; CVE remediation | Does not inspect plugin AST or manifests |
| `@claude-flow/security` SafeExecutor | Command injection protection | No per-plugin allowed-command scope |
| Plugin runtime | Plugins loaded into CLI process | **No behavioral permission manifest** — plugins can access env vars, net, fs without declaration |
| OWASP GenAI mapping | Not published | **0/10 entries documented** — no compliance statement |

---

## Competitor Comparison

| Competitor | Plugin Pre-Publish Scanner | Dependency Graph Analysis | Runtime Behavioral Manifest | OWASP GenAI Alignment |
|------------|---------------------------|--------------------------|-----------------------------|-----------------------|
| **LangGraph** | No | No | Sandboxing only (LangSmith tracing) | No |
| **AutoGen 0.7.5** | No | No | No | No |
| **CrewAI 1.14+** | No | No | No | No |
| **OpenAI Agents SDK** | No | No | Sandboxed code interpreter only | No |
| **Ruflo 3.6.10** | **No** | **No** | **No** | **No** |

*No competitor has published an OWASP GenAI Top 10 compliance mapping or deployed a pre-publish plugin scanner. First-mover on either is a visible differentiator.*

---

## Benchmarks

| Benchmark | Value | Grade | Source |
|-----------|-------|-------|--------|
| Payload-less skill attack success (confidentiality breach) | 77.67% | **A** | arXiv:2605.14460 |
| Payload-less skill detection rate by existing scanners | 0.00% | **A** | arXiv:2605.14460 |
| Real-world skill vulnerability prevalence | 26.1% of 31,132 skills | **A** | arXiv:2601.10338 |
| Malicious plugin ASR (SafeClawArena) | 100% (reduced 70%→22% with SeClaw) | **A** | arXiv:2606.30755 |
| Neuro-symbolic scanner F1 on real-world skills | 93% F1 on 150,108 skills | **A** | arXiv:2603.27204 |
| ClawWorm multi-hop propagation ASR | 64.5% across 40,000+ instances | **A** | arXiv:2603.15727 |
| OWASP GenAI v2025 Supply Chain entry | Confirmed agentic-specific Top 10 | **B** | OWASP genai.owasp.org |

---

## Scan Findings — Intelligence

**Source**: arXiv:2603.08852 (LDP: Identity-Aware Protocol for Multi-Agent LLM Systems, March 2026)

**Finding**: Identity-aware routing in multi-agent systems achieves ~12× lower latency on easy tasks, 37% token reduction via semantic payloads (p=0.031), and 39% token overhead elimination through governed sessions. Ruflo's MoE gate (8 experts, confidence 0.13→0.88) routes by task complexity but has no **identity-aware** dimension — agents are routed by content, not by declared identity and capability scope. LDP demonstrates that identity-scoped routing closes both a security gap (impersonation) and an efficiency gap (redundant capability negotiation).

**Gap**: `@claude-flow/hooks` route hook dispatches by task content only; no agent identity token or capability manifest is passed to the MoE router. An attacker who compromises one agent can claim any capability scope in the next hop.

**Action**: Add agent identity tokens to the `route` hook payload. No ADR tonight — implementation-level addition to existing MoE routing path.

**Confidence**: B (paper fetched, metrics cited directly from abstract; ~12x figure labeled as approximate by authors)

---

## Scan Findings — Swarm

**Source**: arXiv:2603.15727 (ClawWorm, March 2026) + arXiv:2606.30755 (SafeClawArena, June 2026)

**Finding**: Supply-chain attacks self-propagate across swarms. ClawWorm achieves 64.5% aggregate ASR with sustained multi-hop propagation across 40,000+ agent instances — one compromised skill poisons downstream agents via shared memory and tool-result channels. Ruflo's swarm topologies (hierarchical, mesh, adaptive) route tool results between agents without content integrity checks. A compromised plugin in one worker can inject into the shared `collaboration` memory namespace and reach every downstream agent in the pipeline.

**Gap**: Ruflo's `collaboration` namespace has no integrity seal on stored values. A plugin calling `memory store` can overwrite another agent's context without audit trail.

**Action**: Add a `memory:integrity-seal` wrapper to the `post-edit` hook that HMAC-signs values written to shared namespaces. No ADR tonight — implementation-level extension to existing memory system.

**Confidence**: A (arXiv:2603.15727, specific metrics, 1,800 trials across 4 LLM backends)

---

## Competitors Reviewed

| Competitor | Plugin/Skill Scanner | OWASP GenAI Alignment | Key 2026 Move |
|------------|---------------------|-----------------------|---------------|
| LangGraph | No | No | NemoClaw Blueprint w/ NVIDIA (Jul 8) |
| AutoGen 0.7.5 | No | No | Tool call validation patch (Jun 2026) |
| CrewAI 1.14+ | No | No | Pluggable memory backends |
| OpenAI Agents SDK | No | No | No 2026 security update noted |

---

## SOTA Proof & Witness

| Field | Value |
|-------|-------|
| Session commit | `7ef4d4e655d81c0451f6f40f35729cce6c9928e7` |
| Report SHA-256 | `b7b800ed372622fa76c2b19e1846cc4b51d7443c5baad8ef574a344cb19ef47d` |
| Witness stamp | `79b8bc12455076e9717cd1f4ee2d1942e0cc5fe2d5a4898cd464e29cf8bc2146` |
| Verifier | `sha256sum <this-file> \| awk '{print $1}'` → concat session commit → `sha256sum` → must equal witness stamp |

---

## Recommended Next Steps

1. **PluginScanner static gate** (`@claude-flow/security`, sprint): Add AST-level scan to `npx ruflo plugins publish` before Pinata pin. Target the neuro-symbolic approach from arXiv:2603.27204 (93% F1): scan for credential extraction (`process.env.*`, `fs.readFile` on sensitive paths), exfiltration patterns (`fetch`/`axios` to non-allowlisted hosts), and hook injection into `pre-task`/`post-task`. Also add dependency graph walk (arXiv:2607.01136 shows single-skill inspection is insufficient — must trace transitive deps). Integrate as `@claude-flow/security` exported `PluginScanner` class.

2. **OWASP GenAI Top 10 Mapping** (`docs/security/owasp-genai-top10-mapping.md`, 2-day sprint): Map all 10 OWASP GenAI v2025 entries to Ruflo's `@claude-flow/security` module. LLM07 (Insecure Plugin Design) and LLM05 (Supply Chain Vulnerabilities) should map to ADR-179 deliverables. Publish as Ruflo's security compliance statement — **no competitor has done this**.

3. **Plugin Behavioral Manifest + Memory Integrity Seal** (ADR-179, two components): (A) Declarative permission manifests in `v3/@claude-flow/cli/src/plugins/manager.ts` — each plugin declares allowed env vars, net destinations, fs paths; violations emit `plugin:permission-violation` and halt. (B) HMAC-signed values in the `collaboration` memory namespace via `post-edit` hook — prevents ClawWorm-style cross-agent memory poisoning (arXiv:2603.15727).

---

*Ruflo Dream Cycle — 2026-07-11 — do not self-merge. Leave for human review.*
