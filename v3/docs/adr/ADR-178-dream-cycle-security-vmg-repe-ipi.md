# ADR-178: Verifiable Memory Governance and RepE-Based IPI Detection for Agent Security

**Status**: Proposed  
**Authors**: claude (dream-cycle agent, 2026-07-06)  
**References**: arXiv:2604.16548, arXiv:2604.03870, arXiv:2604.01438, OWASP Agentic Top 10 2026  

---

## Context

The 2026 security research landscape has produced three Grade-A findings that expose architectural gaps in Ruflo:

1. **ClawSafety (arXiv:2604.01438)**: "Safe" LLMs deployed as agents achieve 40–75% attack success rates. Safety is determined by the full deployment stack, not the backbone model alone. Skill files are the highest-risk injection vector — higher than email or web content.

2. **Long-Term Memory Security (arXiv:2604.16548)**: Persistent writable memory (i.e., AgentDB) introduces a six-phase attack surface (Write, Store, Retrieve, Execute, Share, Forget). Security "cannot be retrofitted at retrieval or execution time alone" — storage-time provenance and policy-aware retention are foundational requirements.

3. **Indirect Prompt Injection / RepE (arXiv:2604.03870)**: Indirect Prompt Injections (IPI) bypass all baseline defenses including filters and prompt guards. Representation Engineering (RepE) — extracting hidden states at the tool-input position to detect abnormal decision entropy — achieves high detection accuracy across 9 LLM backbones.

Ruflo has `@claude-flow/security` (InputValidator, PathValidator, SafeExecutor) and ADR-145/ADR-165 addressing plugin supply chain integrity and CVE posture. However, there is no Verifiable Memory Governance (VMG) for AgentDB writes, no RepE-based IPI detection in the hooks system, no OWASP Agentic 2026 compliance mapping, and no skill-file signature verification.

---

## Decision

Implement two architectural primitives as part of the `@claude-flow/security` and `@claude-flow/memory` packages:

### Primitive 1 — Verifiable Memory Governance (VMG)

Extend AgentDB write operations with five metadata fields at storage time:

| Field | Type | Purpose |
|-------|------|---------|
| `provenance` | string (agent-id + session-id + timestamp) | Audit trail for every write |
| `version` | monotonic integer | Enable rollback to prior state |
| `policy_tag` | enum (ephemeral \| session \| persistent \| immutable) | Retention lifecycle |
| `write_hash` | SHA-256 of content | Tamper detection |
| `parent_hash` | SHA-256 of prior version | Chained integrity |

The VMG layer wraps all `memory store` calls in `@claude-flow/memory`. Reads include provenance. Rollback is a first-class operation. Policy-aware retention runs on `session-end` hook.

### Primitive 2 — RepE IPI Detection Hook

Add a `pre-tool-call` security hook in `@claude-flow/hooks` that:

1. Samples the agent's decision entropy on the pending tool call (via the model's output logit distribution or a lightweight classifier over the serialized tool-input).
2. Flags calls with entropy above a configurable threshold (default: 2.5 standard deviations from session baseline).
3. Routes flagged calls to a human-in-the-loop checkpoint or drops them based on `CLAUDE_FLOW_IPI_MODE` (warn \| block \| hil).

This integrates with the existing 17-hook system as hook #18 (`pre-tool-call`).

### Primitive 3 — Skill File Signature Verification

Add SHA-256 signature verification to the plugin/skill loader in `@claude-flow/cli`. Skills must carry a `.sig` sidecar or inline `x-signature` field in their YAML frontmatter, verified against the plugin registry's public key (already present in ADR-145 supply chain integrity).

---

## Consequences

**Positive**:
- Closes the top-3 Grade-A security gaps identified by 2026 SOTA research.
- VMG enables audit, rollback, and policy-driven retention — directly addresses arXiv:2604.16548 Memory Lifecycle Framework.
- RepE hook reduces IPI risk without requiring model retraining.
- Skill signature verification closes the highest-risk injection vector (ClawSafety).
- Creates foundation for OWASP Agentic 2026 Top 10 compliance mapping.

**Negative / Trade-offs**:
- VMG adds ~3–5% write latency to AgentDB (provenance metadata serialization).
- RepE entropy sampling adds ~10–20ms per tool call; disable with `CLAUDE_FLOW_IPI_MODE=off` for latency-sensitive pipelines.
- Skill signature verification breaks unsigned community skills — migration period needed (warn-only mode for 2 releases).

**Out of scope** (implementation-level, no ADR needed):
- A2A message signing (tracked separately under SendMessage protocol work).
- OWASP Top 10 full compliance audit (tracked as a separate issue, not an architectural decision).

---

## Implementation Notes

- `@claude-flow/memory`: Add `VmgMetadata` interface and wrap `AgentDB.store()` in `VmgMemoryStore` class.
- `@claude-flow/security`: Add `IpiDetector` class with `assess(toolCall: ToolCall): IpiRisk` method.
- `@claude-flow/hooks`: Register `pre-tool-call` hook at priority 100 (runs before all other pre-call hooks).
- `@claude-flow/cli`: Add `verifySkillSignature()` in `src/skills/loader.ts`.

Estimated effort: 2 sprints (3 developers). Rollout: warn-only → block mode over 2 releases.
