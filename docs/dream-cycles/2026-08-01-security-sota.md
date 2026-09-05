# Security SOTA Report — 2026-08-01

**TL;DR:** MemSecBench (arXiv:2607.27080, Grade A) benchmarks agent memory poisoning across 310 cases — Ruflo's AgentDB has no Write-Execute-Forget attack detection; AutoGen v0.7.5 makes Docker-sandboxed code execution the industry default, closing OWASP LLM08 for competitors while Ruflo's `coder` agent still runs LLM-generated code without container isolation.

---

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| MemSecBench: 310-case memory poisoning lifecycle benchmark (Write→Execute→Forget protocol) measures persistence, downstream consequence, and selective repair across 48 realistic contexts | arXiv:2607.27080, Jul 2026 | **A** |
| ThreatForest: directed-graph multi-agent pipeline generates structured attack trees from source code, maps to MITRE ATT&CK/CAPEC, synthesizes mitigations — no prior agent framework ships this | arXiv:2607.27528, Jul 2026 | **B** |
| AutoGen v0.7.5 defaults `DockerCommandLineCodeExecutor` for all code execution — industry baseline has shifted; "local executor" is now an explicit regression | AutoGen changelog, Jul 30 2026 | **A** |
| Agent Harness Distillation (AHD): black-box extraction of agent harness capabilities (system prompt structure, tool schemas) via two-stage interaction — AMAS IP leakage is tractable today | arXiv:2607.28147, Jul 2026 | **B** |
| LangGraph checkpoint namespace fix (v3.1.1): `foobar` namespace incorrectly matched `foo` — cross-agent state leakage bug now patched | LangGraph changelog, Jul 30 2026 | **A** |
| OWASP LLM08 (Excessive Agency) is the top-scoring unmitigated risk across all four benchmarked frameworks when running code-executing agents | OWASP LLM Top 10 2025, cross-checked Jul 2026 | **B** |

---

## Ruflo Current Capability

| Area | Status | Notes |
|------|--------|-------|
| Agent memory poisoning detection | ❌ Absent | AgentDB stores vectors and SQL entries; no Write-Execute-Forget poison detection; no MemSecBench equivalent test |
| Sandboxed code execution | ❌ Absent | `SafeExecutor` blocks command injection but does not containerize LLM-generated code; `coder`/`sparc-coder` agents run at host level |
| Structured threat modeling output | ❌ Absent | `ruflo security scan` emits findings JSON; no MITRE ATT&CK/CAPEC mapping, no attack tree synthesis |
| Checkpoint/memory namespace isolation | ✅ Present (partial) | AgentDB uses namespaced vector indexes; no cross-namespace SQL guard tested |
| Agent harness IP protection | ❌ Absent | No obfuscation or probe-detection on MCP tool schemas or system prompts |

---

## Competitor Comparison

| Competitor | Memory Poisoning Defense | Sandboxed Code Execution (default) | Threat Modeling Output | Namespace Isolation Fix |
|------------|:---:|:---:|:---:|:---:|
| **AutoGen python-v0.7.5** | ❌ | ✅ Docker default (v0.7.5) | ❌ | n/a |
| **LangGraph v1.2.10** | ❌ | ❌ | ❌ | ✅ Fixed (checkpoint v3.1.1) |
| **CrewAI v1.15.9** | ❌ | ❌ | ❌ | ❌ |
| **OpenAI Agents SDK** | ❌ | Partial (code interpreter sandbox) | ❌ | n/a |
| **Ruflo v3.7.x** | ❌ | ❌ | ❌ | Partial |

AutoGen is the only competitor with sandboxed code execution as a default. No competitor ships memory poisoning defense or structured threat modeling output.

---

## Benchmarks

| Benchmark | Metric | Value | Grade | Source |
|-----------|--------|-------|-------|--------|
| MemSecBench | Cases across 48 realistic contexts | 310 | **A** | arXiv:2607.27080 |
| MemSecBench | Attack protocol stages | Write → Execute → Forget | **A** | arXiv:2607.27080 |
| AutoGen DockerDefault | Code execution isolation | Container-sandboxed | **A** | AutoGen v0.7.5 changelog |
| OWASP LLM Top 10 | Unmitigated LLM08 (Excessive Agency) score — code-executing agents without sandbox | High | **B** | OWASP 2025, crosschecked |
| OwlPath (intelligence scan) | SWE-bench Pro strict-apply rate | 68.4% vs 66.7% baseline | **A** | arXiv:2607.27249 |
| OwlPath | Token reduction | 28.8% | **A** | arXiv:2607.27249 |

---

## Scan Findings — intelligence

| Finding | Source | Grade |
|---------|--------|-------|
| OwlPath: OWL2 ontology encoding of source code for bug-repair agents reduces token usage 28.8%, runtime 39.5%, achieves 68.4% SWE-bench Pro strict-apply vs 66.7% baseline — Ruflo's `coder` agent uses flat context with no structural compression | arXiv:2607.27249, Jul 2026 | **A** |
| Objective Misalignment in Mixed-Motive LLM Multi-Agent Systems: misaligned agents develop invisible divergent reasoning while appearing aligned in public communications — Ruflo's hive-mind consensus assumes good-faith agents with no behavioral divergence monitoring | arXiv:2607.26160, Jul 2026 | **B** |

**Competitive signal:** No framework (LangGraph, AutoGen, CrewAI, OpenAI Agents SDK) ships causal skill verification or behavioral divergence monitoring for mixed-motive scenarios.

**One-sentence finding:** OwlPath (Grade A) delivers 28.8% token savings via OWL2 ontology encoding — immediately actionable for Ruflo's `coder` and `sparc-coder` agents whose context windows are the primary cost driver in coding swarms.

---

## Scan Findings — swarm

| Finding | Source | Grade |
|---------|--------|-------|
| Self-Healing Coordination via Bloch-Type Perceptual Memory: closed slow-fast perceptual loop accelerates spatial reconnection after agent fragmentation vs. memoryless controllers — Ruflo swarm has no reconnection protocol after partial failure | arXiv:2607.11960, Jul 2026 | **B** |
| Distributed Containment of a Compromised Agent: defender agents geometrically isolate a hijacked peer via repulsive cage fields using collision-avoidance modules; Stackelberg-game formulation with sublinear dynamic-regret bounds | arXiv:2607.01230, Jul 2026 | **B** |

**Competitive signal:** No competitor framework implements agent-level containment isolation (repulsive cage) when a swarm member is compromised; all rely on external orchestrator kill signals.

**One-sentence finding:** Distributed Containment (Grade B) introduces a peer-driven isolation protocol for compromised swarm agents — Ruflo's hive-mind has no equivalent; a compromised `coder` agent in a swarm can propagate malicious outputs until the queen detects it via external signal.

---

## SOTA Proof & Witness

| Field | Value |
|-------|-------|
| Session commit | `4ac1ab9ff3ee8f0406cfa97fe463944d9b110e9a` |
| Report SHA-256 | `d5c3ef510b1effdb931e18753e88d6fa1a3c03e4b7519677fc012532b1bc5bbf` |
| Witness stamp | `16eb7e75bf3ef21b599d9329ca29681c5c7203a9a048ddbd263985556688c608` |

**Verify:** `sha256sum docs/dream-cycles/2026-08-01-security-sota.md` → concat (no separator) with session commit `4ac1ab9ff3ee8f0406cfa97fe463944d9b110e9a` → `sha256sum` → must equal witness stamp.

---

## Recommended Next Steps

1. **Implement `MemPoisonGuard` in `@claude-flow/security`** (`v3/@claude-flow/security/src/memory/mem-poison-guard.ts`): Intercept all AgentDB write operations, apply a two-stage check — regex heuristics for credential/backdoor patterns in stored content (Layer 1, <1ms), LLM-judge on flagged writes (Layer 2, Haiku, ~$0.0002). Block on confirmed poison, log to `.swarm/mem-poison.jsonl`. Wire into `memory store` hook and `hooks post-task`. Gate: `CLAUDE_FLOW_FEATURE_MEM_POISON_GUARD=1`. Maps to OWASP LLM02 + LLM08.

2. **Add `--sandbox docker` flag to `ruflo agent spawn`** (`v3/@claude-flow/cli/src/agent/spawn.ts`): When `--sandbox docker` is passed (or `CLAUDE_FLOW_AGENT_SANDBOX=docker` is set), wrap `coder`/`sparc-coder`/`tdd-london-swarm` agent code execution in `DockerCommandLineCodeExecutor`-equivalent container. Phase-1 implementation: generate code to `./sandbox/` dir, execute via `docker run --rm --network=none -v ./sandbox:/work`. No new ADR — implementation-level hardening.

3. **Add `ruflo security scan --output mitre-attack`** (`v3/@claude-flow/cli/src/security/threat-forest.ts`): Extend existing `security scan` with a ThreatForest-inspired output mode: for each finding, map to MITRE ATT&CK technique ID (using a static mapping table seeded from ThreatForest's public corpus), emit as structured JSON with `technique_id`, `tactic`, and `mitigation`. No new ADR — extension of existing ADR-320 scope.
