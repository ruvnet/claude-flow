# ADR-346: Multi-Layer Agent Security Stack

**Status:** Proposed  
**Date:** 2026-06-16  
**Authors:** claude (dream-cycle agent, 2026-06-16)  
**Supersedes:** Partially extends ADR-012 (MCP Security), ADR-144 (Agent Authorization), ADR-145 (Plugin Supply Chain), ADR-146 (Tool Output Guardrails)

---

## Context

Nightly dream-cycle research (2026-06-16, SLOT=1, DEEP=security) surfaced three Grade A benchmarks establishing a critical gap:

1. **ClawSafety** (arXiv:2604.01438): Agent attack success rate (ASR) 40–75% across 5 frontier models in 2,520 sandboxed trials. Safety is determined by the full deployment stack, not just the backbone model. Skill-instruction injection (matching Ruflo's hooks/plugins) is the highest-trust, highest-risk vector.

2. **MCP Threat Coverage** (arXiv:2604.05969): 7 threat categories, 23 distinct attack vectors across 177K+ deployed MCP tools. No single defense covers more than 34% of the threat landscape. An integrated MCPSHIELD approach (capability-based access control + cryptographic attestation + information flow tracking + runtime policy) achieves 91% coverage.

3. **OWASP Top 10 for Agentic Applications 2026** (published Dec 2025): ASI01 = Agent Goal Hijacking is ranked #1. ASI02 = Unauthorized Capability Escalation. These risks are unmitigated in Ruflo's current stack.

Ruflo's existing security layers (InputValidator, PathValidator, SafeExecutor, ADR-144/145/146) provide single-layer boundary validation estimated at ~34% threat coverage — the floor identified for isolated defenses. Ruflo exposes 314 registered MCP tools and 60+ hooks/skills that are currently unattestad against injection via tool environment.

---

## Decision

Implement a **multi-layer agent security stack** in `@claude-flow/security` comprising three coordinated layers:

### Layer 1 — MCP Tool Attestation
- Cryptographic signing of tool manifests at registration time
- Signature verification at every tool invocation in the MCP server
- Capability-based access control: tools declare required capabilities; agents are granted minimum necessary
- Revocation list for compromised tools
- Target: covers threat categories TC-1 (tool spoofing), TC-2 (capability escalation), TC-5 (protocol tampering)

### Layer 2 — Indirect Prompt Injection Monitoring
- Content sanitization pipeline at hook chokepoints: `pre-task`, `post-edit`, `pre-command`
- Pattern detection for instruction-injection signatures in tool outputs, environment variables, and skill payloads
- Quarantine mode: flag suspicious payloads for human review before agent execution
- Integrates into existing `SafeExecutor` in `@claude-flow/security`
- Target: addresses ClawSafety's highest-risk vector (skill-instruction injection)

### Layer 3 — Agent Action Audit Trail with Checkpointing
- Append-only audit log of every agent action (tool call, memory write, file operation, hook execution)
- Checkpoint state snapshot per task boundary, stored in AgentDB
- Rollback trigger: detected Goal Hijacking (ASI01) signals halt + restore from last clean checkpoint
- Expose audit trail via `@claude-flow/cli security audit` command
- Target: closes the LangGraph 0.4 feature gap; enables post-hoc forensics and OWASP compliance evidence

---

## Consequences

### Positive
- Raises estimated threat coverage from ~34% to ≥80% (target 91% with full MCPSHIELD alignment)
- Closes OWASP Agentic ASI01 and ASI02 gaps
- Makes Ruflo the first open-source agent framework with MCP-native tool attestation
- Enables enterprise compliance evidence for agentic AI security audits
- Competitive differentiation: LangGraph, CrewAI, AutoGen, OpenAI Swarm have no MCP tool attestation

### Negative
- Attestation adds latency to tool registration and invocation (~1-5ms per call, within <100ms MCP target)
- Audit trail increases AgentDB write volume; requires TTL/rotation policy
- Breaking change for unregistered or externally-sourced MCP tools (migration guide required)

### Neutral
- Layer 2 sanitization may produce false positives on legitimate complex tool outputs; tunable threshold
- Checkpoint storage in AgentDB uses existing HNSW backend with new `audit` namespace

---

## Implementation Plan

1. `@claude-flow/security`: Add `ToolAttestation` class (Layer 1) — key pair generation, manifest signing, verification middleware
2. `@claude-flow/security`: Extend `SafeExecutor` with injection pattern detection (Layer 2)
3. `@claude-flow/memory`: Add `audit` namespace with append-only writes and TTL (Layer 3)
4. `@claude-flow/cli`: Add `security audit` and `security attestation` subcommands
5. Migration: `npx claude-flow@latest security attestation --init` to sign all registered MCP tools
6. Tests: TDD London School — mock tool registry + inject adversarial payloads; verify quarantine triggers

---

## References

- arXiv:2604.01438 — ClawSafety: "Safe" LLMs, Unsafe Agents
- arXiv:2604.05969 — Formal Security Framework for MCP-Based AI Agents
- arXiv:2506.23260 — From Prompt Injections to Protocol Exploits: Threats in LLM-Powered AI Agents Workflows
- arXiv:2603.15408 — TrinityGuard: A Unified Framework for Safeguarding Multi-Agent Systems
- OWASP Top 10 for Agentic Applications 2026 — https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/
- Dream-cycle research gist: `v3/docs/dream/2026-06-16-security-report.md`
