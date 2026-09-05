# ADR-337 — Plugin Supply Chain Integrity and Memory Namespace Governance

**Status**: Proposed
**Authors**: claude (dream-cycle agent, 2026-06-01)
**Related**: ADR-004 (Plugin Architecture), ADR-006 (Unified Memory), ADR-013 (Core Security), ADR-015 (Unified Plugin System), ADR-131 (ToolOutputGuardrail — different layer), ADR-144 (Authorization Propagation — different layer), dream-cycle issue #2249

> **Note on ADR numbering**: ADR-144 is proposed in branch `dream/2026-05-31-security` (authorization propagation). This record uses ADR-337 to avoid collision.

## Context

### Threat: Plugin Supply Chain Attacks (June 2026 SOTA)

Two Grade A papers published in April–May 2026 document active supply-chain attacks that bypass all current defenses in Ruflo's plugin system:

**DDIPE** (arXiv:2604.03081, Apr 3, 2026): Document-Driven Implicit Payload Execution embeds malicious logic in plugin documentation and configuration templates. Achieves 11.6–33.5% bypass rate across four frameworks and five models; 2.5% of adversarial skills evade both detection and alignment systems. Four confirmed CVEs were disclosed from this research.

**Semantic Compliance Hijacking — SCH** (arXiv:2605.14460, May 14, 2026): Translates malicious goals into natural-language compliance rules within skill/plugin descriptions. The agent generates harmful code dynamically at runtime — no static payload exists. Achieves **77.67% confidentiality breach** and **67.33% RCE success** with **0.00% detection by current scanning tools**. Signature-based defenses are entirely blind to SCH.

Ruflo's current plugin install path (`v3/@claude-flow/cli/src/plugins/`) fetches from IPFS via Pinata with no signature verification and no semantic intent analysis.

### Threat: Memory Namespace Poisoning

**MINJA** (arXiv:2601.05504, Jan 2026): Memory injection via query-only interaction achieves up to 95% success under idealized conditions. In realistic production environments, success falls to 28–38% for strong models — still unacceptable for a system where compromised memory can redirect agent behavior.

**Mnemonic Sovereignty survey** (arXiv:2604.16548, Apr 2026): Identifies nine governance primitives required for secure long-term agent memory. No existing published architecture satisfies all nine. The core gap in Ruflo: the shared `collaboration` memory namespace (and all AgentDB namespaces) accepts writes from any agent with no per-namespace authorization.

### Why This Is Architectural

This is architecturally distinct from:
- ADR-131 (ToolOutputGuardrail): screens MCP tool *outputs* for injected content at runtime — does not verify plugin integrity before install
- ADR-144 (Authorization Propagation): tracks runtime scope delegation in SendMessage chains — does not govern what code runs when a plugin is loaded

This ADR introduces two new trust boundaries:
1. **Plugin install-time integrity**: before a plugin is loaded, verify its supply-chain provenance
2. **Memory write-time authorization**: before an agent writes to a namespace, verify it holds an explicit write grant

These boundaries require new module surfaces, protocol additions to the plugin registry format, and an API addition to AgentDB — all architectural decisions.

## Decision

### Part A: PluginIntegrityVerifier

Add `PluginIntegrityVerifier` to `@claude-flow/security` with two verification stages:

**Stage 1 — Signature verification** (blocks DDIPE):
- Every plugin published to the IPFS registry MUST carry a detached Ed25519 signature over its manifest hash
- `discovery.ts` MUST refuse to install unsigned plugins when `CLAUDE_FLOW_STRICT_PLUGINS=true` (default: warn-only for backwards compatibility)
- Trust anchors stored in `v3/@claude-flow/cli/src/plugins/trust/trust-anchors.json`

**Stage 2 — Semantic intent scan** (blocks SCH):
- During `plugins install`, pipe all natural-language fields (description, readme excerpt, compliance rules) through a lightweight intent classifier
- Classify against a taxonomy of malicious intent categories (credential exfiltration, RCE, data poisoning, privilege escalation)
- Block install if confidence exceeds configurable threshold (default: 0.8)
- Fallback: LLM-free heuristic rules covering the top-5 SCH patterns from arXiv:2605.14460

**Implementation targets:**
- `v3/@claude-flow/security/src/plugins/integrity-verifier.ts` (new)
- `v3/@claude-flow/cli/src/plugins/store/discovery.ts` (add verification hook on install)
- `v3/@claude-flow/cli/src/plugins/trust/trust-anchors.json` (new)

### Part B: Memory Namespace Write ACLs (Mnemonic Sovereignty, primitives 1–3)

Add write authorization to AgentDB namespaces:

- Every agent spawn receives an explicit `writeNamespaces: string[]` grant
- AgentDB enforces grants at the storage boundary (not just convention)
- Agents not in the grant list for a namespace receive `MemoryWriteDenied` error
- Read access remains open (read-only poisoning blocked by ADR-131 guardrail layer)

Address governance primitives 1 (write authorization), 2 (read authorization), 3 (update authorization) from the Mnemonic Sovereignty taxonomy. Primitives 4–9 deferred for a future ADR.

**Implementation targets:**
- `v3/@claude-flow/memory/src/namespaces/authorization.ts` (new)
- `v3/@claude-flow/memory/src/agent-db.ts` (add grant enforcement)
- `v3/@claude-flow/cli/src/agent/spawn.ts` (add `writeNamespaces` parameter)

## Backwards Compatibility

- Plugin verification defaults to warn-only mode (`CLAUDE_FLOW_STRICT_PLUGINS=false`) — no breaking change for existing unsigned plugins
- Memory namespace ACLs are additive — agents spawned without explicit grants retain legacy full-access behavior until `CLAUDE_FLOW_STRICT_MEMORY=true` is set
- Both strict modes will become default in v4.0.0

## Consequences

**Positive:**
- Blocks SCH attacks (0.00% current detection → detectable at semantic layer)
- Blocks DDIPE attacks at install time via signature check
- Reduces memory poisoning propagation across agent boundaries
- Positions Ruflo's memory governance ahead of all 2026 competitors (none satisfy all 9 mnemonic sovereignty primitives)

**Negative:**
- Plugin publishers must generate Ed25519 keypairs and sign manifests (new workflow)
- Semantic intent scan adds ~50–200ms to `plugins install` (acceptable for install-time, not runtime)
- Write ACLs require updating all existing agent spawn callsites that use shared namespaces

## References

- arXiv:2604.03081 — Supply-Chain Poisoning Attacks Against LLM Coding Agent Skill Ecosystems
- arXiv:2605.14460 — Exploiting LLM Agent Supply Chains via Payload-less Skills
- arXiv:2601.05504 — Memory Poisoning Attack and Defense on Memory Based LLM-Agents
- arXiv:2604.16548 — A Survey on the Security of Long-Term Memory in LLM Agents: Toward Mnemonic Sovereignty
- Microsoft Agent Governance Toolkit — https://opensource.microsoft.com/blog/2026/04/02/
