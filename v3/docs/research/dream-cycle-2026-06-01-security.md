# Security SOTA Report — 2026-06-01

**TL;DR:** Payload-less plugin supply-chain attacks (Semantic Compliance Hijacking) achieve 77.67% confidentiality breach and 67.33% RCE with 0.00% scanner detection in 2026; Ruflo's IPFS plugin registry and shared AgentDB memory namespaces have zero supply-chain integrity controls — the highest-priority unfilled security gap in Ruflo as of June 2026.

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| Semantic Compliance Hijacking (SCH): payload-less attack, 77.67% confidentiality breach, 67.33% RCE, 0.00% scanner detection | arXiv:2605.14460, May 14, 2026 | A |
| DDIPE supply-chain attack: embeds malicious logic in plugin docs, 11.6–33.5% bypass, 2.5% evades all defenses | arXiv:2604.03081, Apr 3, 2026 | A |
| Memory poisoning (MINJA): 95% injection success idealized → 28–38% realistic; defeated by trust-scored sanitization | arXiv:2601.05504, Jan 9, 2026 | A |
| Plan injection (context manipulation): 3× higher ASR than prompt-based attacks; 17.7% exfiltration gain via context-chaining | arXiv:2506.17318, Jun 18, 2026 | A |
| Mnemonic Sovereignty: 9 governance primitives needed for memory security — zero existing architectures satisfy all 9 | arXiv:2604.16548, Apr 17, 2026 | A |
| Microsoft Agent Governance Toolkit: Ed25519 plugin signing + <0.1ms p99 policy enforcement, full OWASP ASI01–ASI10 coverage | Microsoft OSS Blog, Apr 2, 2026 | B |
| OpenClaw study: current point-based defenses fail cross-temporal, multi-stage threat chains (5 lifecycle stages) | arXiv:2603.11619, Mar 12, 2026 | A |

## Ruflo Current Capability

| Area | Status |
|------|--------|
| Plugin registry integrity (IPFS/Pinata) | No signature verification, no semantic intent scanning |
| Memory namespace write authorization | No — all agents write unrestricted to shared namespaces |
| MCP tool output guardrail | ADR-131 proposed (branch not merged) |
| Authorization propagation | ADR-144 proposed (branch dream/2026-05-31-security, not merged) |
| OWASP ASI01 — Goal Hijacking | ADR-131 proposed only |
| OWASP ASI06 — Memory/Context Poisoning | Gap — no control |
| OWASP ASI09 — Supply Chain | Gap — no control |

## Deep Dive: Supply-Chain Attack Landscape

### Semantic Compliance Hijacking (SCH)

arXiv:2605.14460 introduces SCH as a qualitatively new threat class. Prior supply-chain attacks embed explicit malicious payloads (code, shell commands). SCH instead wraps malicious intent in natural-language "compliance rules" that appear to describe legitimate plugin behavior. The agent, upon reading these rules, generates the harmful code itself at runtime.

The implication for Ruflo's plugin store: static analysis and signature-based scanning cannot detect SCH. A plugin with a perfectly valid Ed25519 signature could still carry SCH content. Two-layer defense is required: signature verification (blocking DDIPE) AND semantic intent scanning (blocking SCH).

### Document-Driven Implicit Payload Execution (DDIPE)

arXiv:2604.03081 generated 1,070 adversarial skills from 81 seed skills covering all 15 MITRE ATT&CK categories. Key finding: agent skills execute with system-level privileges without mandatory security review in all four tested frameworks. Ruflo's `plugins install` path has no mandatory review gate.

### Memory Poisoning via MINJA

arXiv:2601.05504 shows that an attacker with query-only access (no code execution) can inject malicious instructions into an agent's memory store with 38% success for production-strength models. In Ruflo's shared `collaboration` namespace, a single compromised sub-agent (e.g., a `codex:coder` worker) can write poisoned instructions that persist for retrieval by future agents in the same namespace.

## Scan Findings — Intelligence

**Source:** arXiv:2603.07915, March 2026 (Grade A)

**Finding:** ARES (Adaptive Reasoning Effort Selection) trains a lightweight per-step router that dynamically selects the minimum necessary reasoning level for each agent step. Results: **52.7% reduction in reasoning token usage** while maintaining task success rates. This is complementary to SR²AM (covered in #2156 May 27) — both reduce reasoning overhead but at different granularities (SR²AM: planning frequency; ARES: per-step effort).

**Competitive signal (Grade B):** OpenAI Agents SDK v0.13 ships opt-in retry policies and session persistence, indicating the platform is optimizing for multi-step reliability — not token efficiency. Ruflo's 3-tier routing is cost-efficient but static; adding ARES-style per-step routing would compound with ADR-026's tier selection.

**Recommended action:** Prototype ARES-style effort router as an extension to the `route` hook's Tier-3 path. Implementation-level — no new ADR needed (enhancement to ADR-026 and ADR-131's simulative planning primitive).

## Scan Findings — Swarm

**Source:** arXiv:2602.08009, February 2026 (Grade A)

**Finding:** "Towards Adaptive, Scalable, and Robust Coordination of LLM Agents: A Dynamic Ad-Hoc Networking Perspective" proposes treating swarms as Dynamic Ad-Hoc Networks (DANETs) — agents self-organize topology in response to failures and load, rather than maintaining a fixed hierarchical structure. The paper shows that adaptive topology switching under failure reduces task latency by 31% compared to static hierarchical topology when ≥20% of agents fail simultaneously.

**Competitive signal (Grade B):** LangGraph v1.1.3 ships "distributed runtime support" (April 2026), allowing graph nodes to run across multiple machines. Ruflo's swarm topology is configured at init time — no adaptive reconfiguration under failure.

**Recommended action:** Evaluate DANET-style adaptive reconfiguration as an enhancement to ADR-132 (hierarchical consensus topology, proposed). Would allow graceful degradation from hierarchical to mesh under partial failure. Implementation-level — no new ADR needed.

## Competitors Reviewed

| Framework | Plugin Signing | Memory Governance | Supply-Chain Defense | OWASP ASI Coverage | Key 2026 Update |
|-----------|---------------|-------------------|---------------------|--------------------|----------------|
| **Ruflo v3.6** | None | None (shared namespaces) | None | ASI01 proposed only | ADR-131, ADR-144 proposed; unmerged |
| **Microsoft AGT** | Ed25519 per plugin | YAML/OPA/Cedar policy engine | Agent Marketplace package | Full — all ASI01–ASI10 | Open-sourced Apr 2026, MIT license |
| **OpenAI Agents SDK v0.13** | Platform-signed | Platform-managed | Input/output guardrails | Best-in-class | any-LLM adapter + MCP resource support |
| **LangGraph v1.1.3** | No | Checkpoint-scoped | No | HITL checkpoints | Deep agent templates + distributed runtime |
| **CrewAI v1.12** | No (SOC2 audit trail) | Hierarchical memory isolation | No | SOC2 partial | Agent skills + native OpenAI-compatible providers |

## Benchmarks

| Metric | Value | Source | Grade |
|--------|-------|--------|-------|
| SCH confidentiality breach success rate | 77.67% | arXiv:2605.14460 | A |
| SCH Remote Code Execution success rate | 67.33% | arXiv:2605.14460 | A |
| SCH detection rate by current scanning tools | 0.00% | arXiv:2605.14460 | A |
| DDIPE bypass rate (best case) | 33.5% | arXiv:2604.03081 | A |
| DDIPE evasion of all detection + alignment | 2.5% | arXiv:2604.03081 | A |
| MINJA memory injection (idealized) | 95.0% | arXiv:2601.05504 | A |
| MINJA memory injection (realistic, GPT-4o-mini) | 38.0% | arXiv:2601.05504 | A |
| Plan injection ASR vs prompt-based | 3× | arXiv:2506.17318 | A |
| Plan injection exfiltration gain (context-chaining) | +17.7% | arXiv:2506.17318 | A |
| ARES reasoning token reduction | 52.7% | arXiv:2603.07915 | A |
| MS AGT policy enforcement latency | <0.1ms p99 | Microsoft OSS Blog | B |
| DANET adaptive topology latency improvement under 20% failure | 31% | arXiv:2602.08009 | A |

## SOTA Proof & Witness

| Field | Value |
|-------|-------|
| **Session commit** | `28eb57543be916abf5191f71114268a3985cb001` |
| **Report SHA-256** | `2d30798accfbd2eda6cfab79c8a3e2d74d84527fdb4d521a62c3f2c1fddf6fb0` |
| **Witness stamp** | `77d1b0fdc4cf98768ffa062a16a5efd1650c8a778a1d5ea6b1520ac7312628e3` |
| **Verifier** | `sha256sum dream-gist-2026-06-01.md` (pre-witness fill) → concat `28eb57543be916abf5191f71114268a3985cb001` → `sha256sum` → must equal witness stamp |

## Recommended Next Steps

1. **Implement PluginIntegrityVerifier** — Add Ed25519 signature verification to `v3/@claude-flow/cli/src/plugins/store/` and `discovery.ts`. Require all IPFS registry plugins to carry a signed manifest. This blocks DDIPE (embedded malicious logic in docs) at install time. ADR-145.

2. **Add semantic intent scanner at plugin install** — Static/signature analysis alone misses SCH (0.00% detection). Add `@claude-flow/security` NLP-based semantic intent validation during `plugins install` to detect compliance-rule-formatted malicious instructions that synthesize harmful behavior at runtime.

3. **Implement memory namespace write ACLs (Mnemonic Sovereignty)** — Agents should only write to namespaces explicitly granted at spawn time. Prevents memory poisoning propagation across agent boundaries. Target: `v3/@claude-flow/memory/src/namespaces/authorization.ts`. No existing system in 2026 literature satisfies all 9 governance primitives — differentiator opportunity.
