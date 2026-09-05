# ADR-145 — Plugin Supply-Chain Integrity and Memory Namespace Governance

**Status**: Proposed
**Date**: 2026-06-02
**Issue**: [ruvnet/ruflo#2254](https://github.com/ruvnet/ruflo/issues/2254)
**Related**: ADR-004 (Plugin Architecture), ADR-006 (Unified Memory), ADR-015 (Unified Plugin System), ADR-131 (ToolOutputGuardrail — content layer), ADR-144 (Authorization Propagation — runtime layer)

## Context

ADR-131 closed the content boundary and ADR-144 closes the runtime action boundary. Both assume the *code that's about to run* is trustworthy in the first place. Two Grade A papers published April–May 2026 demonstrate that assumption is broken under current Ruflo defenses.

### Threat: plugin supply-chain attacks

**Semantic Compliance Hijacking — SCH** (arXiv:2605.14460, May 14, 2026, Grade A): Eliminates the recognizable payload entirely. Instead of injecting malicious code, SCH wraps malicious intent in natural-language "compliance rule" text within plugin descriptions. The LLM agent reads the rule and **generates the harmful code itself at runtime**. Benchmark: **77.67% confidentiality breach, 67.33% RCE success, 0.00% scanner detection**. Signature-based defenses are completely blind because there is no static payload to sign against.

**DDIPE** (arXiv:2604.03081, Apr 3, 2026, Grade A): Document-Driven Implicit Payload Execution embeds malicious logic in plugin documentation and configuration templates. Tested across 4 frameworks, 5 models, 1,070 adversarial skills covering 15 MITRE ATT&CK categories. **Bypass rate 11.6–33.5%; 2.5% of adversarial skills evade both detection and alignment systems.** Four CVEs were disclosed from this research.

Ruflo's current plugin install path (`v3/@claude-flow/cli/src/plugins/store/discovery.ts`) fetches manifests from IPFS via Pinata. It carries **no signature verification** and **no semantic intent analysis**.

### Threat: memory-namespace poisoning

**MINJA** (arXiv:2601.05504, Jan 2026, Grade A): Query-only memory injection achieves **95% success under idealized conditions; 28–38% on production-deployed strong models**. The realistic-production number is still unacceptable for a system where compromised memory steers future agent behavior.

**Plan Injection** (arXiv:2506.17318, Jun 2026, Grade A): Context-chained memory attacks achieve **3× higher attack success** than prompt-based injection and **+17.7% exfiltration gain** by creating logical bridges between unrelated memory entries. The fix is **namespace isolation with explicit write grants** — agents cannot poison a namespace they have no business writing to.

**Mnemonic Sovereignty survey** (arXiv:2604.16548, Apr 2026, Grade A): Catalogs nine governance primitives required for secure long-term agent memory. No existing published architecture satisfies all nine. The Ruflo gap: the shared `collaboration` namespace (and all AgentDB namespaces) accepts writes from any agent with no per-namespace authorization. ADR-131 catches *what gets read out*; this ADR catches *who is allowed to write in*.

### Why this is architectural

Distinct from existing security ADRs:

| Layer | ADR | Concern |
|---|---|---|
| Install-time integrity | **this ADR (Part A)** | Is the plugin code trustworthy enough to load? |
| Memory write authority | **this ADR (Part B)** | Is this agent allowed to write to this namespace? |
| Runtime action authority | ADR-144 | Is this agent allowed to call this tool right now? |
| Tool/memory output content | ADR-131 | Does this content contain hijacking instructions? |

ADR-145 introduces two new trust boundaries, two new module surfaces, a protocol addition to the IPFS plugin registry manifest format, and an API addition to AgentDB. All four are architectural.

## Decision

### Part A — `PluginIntegrityVerifier`

Add `PluginIntegrityVerifier` to `@claude-flow/security` with two verification stages run at `plugins install` time.

**Stage 1 — Signature verification** (blocks DDIPE's static-payload variants):

- Every plugin published to the IPFS registry MUST carry a detached **Ed25519 signature** over its manifest hash. The signature lives alongside the manifest in IPFS; the registry index records the signing key's fingerprint.
- `discovery.ts` MUST refuse to install unsigned plugins when `CLAUDE_FLOW_STRICT_PLUGINS=true` (default: warn-only for backwards compatibility).
- Trust anchors (publisher keys we vouch for) live in `v3/@claude-flow/cli/src/plugins/trust/trust-anchors.json`. Edits are gated on CODEOWNERS review.

**Stage 2 — Semantic intent scan** (blocks SCH):

- During `plugins install`, the verifier pipes every natural-language field (description, README excerpt, "compliance rules", any field that ends up in agent context) through a lightweight intent classifier.
- The classifier scores against a taxonomy of malicious-intent categories: credential exfiltration, RCE, data poisoning, privilege escalation, persistence.
- Install blocks if confidence exceeds `CLAUDE_FLOW_PLUGIN_SCH_THRESHOLD` (default `0.8`).
- Fallback: LLM-free pattern rules covering the top-5 SCH families from arXiv:2605.14460 (Table 3 of the paper). The pattern fallback is what makes this safe to run during `plugins install` in environments without LLM credentials.

**Implementation targets**:
- `v3/@claude-flow/security/src/plugins/integrity-verifier.ts` (new)
- `v3/@claude-flow/cli/src/plugins/store/discovery.ts` — verification hook on install
- `v3/@claude-flow/cli/src/plugins/trust/trust-anchors.json` (new)

### Part B — Memory namespace write ACLs

Address governance primitives 1–3 from the Mnemonic Sovereignty taxonomy (write authorization, read authorization, update authorization). Primitives 4–9 (retention, decay, audit, etc.) deferred for a future ADR.

- Every agent spawn receives an explicit `writeNamespaces: string[]` grant.
- AgentDB enforces grants at the storage boundary — **not** by convention in the calling code.
- Agents not in the grant list for a namespace receive `MemoryWriteDenied` on write attempt.
- Read access remains open by default (read-time poisoning is caught at ADR-131's guardrail layer).
- A `readNamespaces` grant is *optional* in v1 and becomes required in v4 (matching the strict-mode escalation in ADR-144).

**Implementation targets**:
- `v3/@claude-flow/memory/src/namespaces/authorization.ts` (new)
- `v3/@claude-flow/memory/src/agent-db.ts` — grant enforcement
- `v3/@claude-flow/cli/src/agent/spawn.ts` — `writeNamespaces` parameter

### Integration plan (phased — P1 is the first PR)

| Phase | Scope | Where |
|---|---|---|
| **P1** | `PluginIntegrityVerifier` skeleton + Stage-1 signature path; trust-anchors file with the existing official-plugin keys | `@claude-flow/security/src/plugins/`, `@claude-flow/cli/src/plugins/trust/` |
| P2 | Stage-2 semantic scan (pattern fallback first, classifier opt-in) | same files |
| P3 | Memory namespace ACL primitives 1–3 in AgentDB | `@claude-flow/memory/src/namespaces/` |
| P4 | `agent spawn --write-namespaces` plumbing through every spawn callsite | `@claude-flow/cli/src/agent/spawn.ts`, hooks |
| P5 | Strict-mode flips to default in v4.0; legacy mode requires explicit env var to re-enable | release docs + breaking-change ADR |

### Backwards compatibility

- Plugin verification defaults to **warn-only** (`CLAUDE_FLOW_STRICT_PLUGINS=false`). Existing unsigned plugins continue to install with a warning.
- Memory namespace ACLs are **additive**: agents spawned without `writeNamespaces` retain legacy full-access until `CLAUDE_FLOW_STRICT_MEMORY=true` is set.
- Both strict modes become default in v4.0.0. The next-major release will be the breaking change.
- The two new env vars are documented escape hatches and MUST be registered in `audit-env-var-precedence.mjs` with rationale.

## Alternatives considered

**Pattern-matching SCH at content boundary (ADR-131 extension).** SCH attacks succeed against content screening because the malicious content *is* the description — there's no instruction-shaped hijack to match. Catching it requires semantic intent classification at install, before the description ever enters agent context.

**Per-plugin sandboxing instead of signing.** Process-level sandboxing buys defense-in-depth but doesn't solve SCH: the malicious behavior is generated by the host model, not by sandboxed plugin code. Signing addresses the trust question; sandboxing addresses the blast-radius question — both belong on the roadmap, but signing closes the more urgent gap.

**Skip Part B; rely on ADR-131 for memory.** ADR-131 catches read-side injection. Plan Injection (arXiv:2506.17318) shows that allowing arbitrary writes lets attackers stage payloads that look innocuous individually but compose into a hijack across multiple reads — content screening cannot catch that compositional pattern. Write authorization is the missing piece.

## Consequences

**Positive**:
- Closes the **77.67% breach / 0.00% detection** SCH gap (arXiv:2605.14460) at the semantic layer.
- Closes DDIPE static-payload variants via Stage-1 signature check.
- Reduces memory-poisoning propagation across agent boundaries (write ACLs are the only mechanism that scales with namespace count).
- Positions Ruflo's memory governance ahead of every 2026 competitor surveyed — none satisfy more than 4 of the 9 Mnemonic Sovereignty primitives.

**Negative / risks**:
- Plugin publishers must generate Ed25519 keypairs and sign manifests (new workflow). The ruflo-plugin-creator skill MUST be updated to scaffold the signing step.
- Semantic intent scan adds **~50–200 ms** to `plugins install` — acceptable at install time, would be unacceptable at runtime.
- Write-ACL migration requires updating every existing `agent_spawn` callsite that uses shared namespaces. Existing pipelines fail open in legacy mode until v4.

**Telemetry / observability**:
- Each verification decision (`pass`, `signature-missing`, `signature-invalid`, `sch-blocked`) MUST be logged with plugin id, publisher fingerprint, and category.
- Each `MemoryWriteDenied` MUST be logged with agent id, namespace, and the granted-namespaces set at spawn time.
- Both feed the security dashboard as adoption metrics.

## Validation

P1 lands with:
- Unit tests covering signature verification against the existing official-plugin keys (round-trip sign → verify; tamper-flips fail).
- Smoke test: `plugins install ./unsigned-plugin` warns by default, errors under `CLAUDE_FLOW_STRICT_PLUGINS=true`.
- Pattern-fallback test corpus drawn from arXiv:2605.14460's Table 3 examples.
- Integration test: agent spawned with `writeNamespaces: ['a']` cannot `memory_store` to namespace `b` under strict-memory mode; legacy mode allows it with a warning log.

## References

- arXiv:2605.14460 — *Exploiting LLM Agent Supply Chains via Payload-less Skills* (SCH)
- arXiv:2604.03081 — *Supply-Chain Poisoning Attacks Against LLM Coding Agent Skill Ecosystems* (DDIPE)
- arXiv:2601.05504 — *Memory Poisoning Attack and Defense on Memory-Based LLM Agents* (MINJA)
- arXiv:2506.17318 — *Plan Injection: Context-Chained Memory Attacks*
- arXiv:2604.16548 — *A Survey on the Security of Long-Term Memory in LLM Agents: Toward Mnemonic Sovereignty*
