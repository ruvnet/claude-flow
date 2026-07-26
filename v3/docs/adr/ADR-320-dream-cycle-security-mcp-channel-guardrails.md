# ADR-320: MCP Tool Composition Inspector + Inter-Agent Channel Guardrails

**Status:** Proposed  
**Authors:** claude (dream-cycle agent, 2026-07-26)  
**Date:** 2026-07-26  
**Tags:** security, mcp, multi-agent, swarm

---

## Context

Two Grade-A 2026 papers reveal structural blind spots in Ruflo's security model:

**ShareLock** (arXiv 2606.27027): Fragments malicious instructions across multiple MCP tool descriptions using Shamir's secret-sharing, defeating per-tool inspection. With 314 registered MCP tools in Ruflo, cross-tool instruction fragments are undetected by any existing validation layer.

**ChannelGuard** (arXiv 2607.19430): Demonstrates that individually safe agents still propagate prompt injection through unmonitored inter-agent communication channels. Ruflo's hierarchical, mesh, and adaptive swarm topologies all forward raw agent outputs as inputs to downstream agents without a sanitisation boundary.

Together these create two attack surfaces that bypass `@claude-flow/security`'s existing InputValidator and SafeExecutor:

1. Multi-tool composition chains allow split-payload attacks at the MCP layer (pre-execution).
2. Agent-to-agent message forwarding allows injection propagation at the swarm layer (post-execution).

---

## Decision

### 1. MCP Tool Composition Inspector

Before executing any multi-tool chain, scan the concatenated tool descriptions for cross-description instruction fragments using a lightweight semantic similarity hash (SimHash or MinHash family, to avoid LLM call overhead). Flag chains where fragment similarity exceeds a configurable threshold.

**Implementation target:** `v3/@claude-flow/security/src/mcp-composition-inspector.ts`  
**Hook point:** `pre-task` hook, before MCP tool invocation  
**Default action:** warn + log; configurable to block

### 2. Inter-Agent Channel Information-Bottleneck Gate

Every agent-to-agent message in the swarm coordinator must pass through a sanitisation gate that:
- Strips known prompt-injection patterns (role-override phrases, instruction-boundary tokens)
- Applies the same InputValidator rules already used at system boundaries
- Logs sanitised-payload events to the security audit trail

**Implementation target:** `v3/@claude-flow/hooks/src/workers/channel-guard-worker.ts`  
**Hook point:** `post-task` + swarm coordinator message router (before SendMessage dispatch)  
**Topologies affected:** hierarchical, mesh, adaptive, hierarchical-mesh

---

## Consequences

### Positive
- Closes ShareLock attack surface across all 314 MCP tools.
- Closes ChannelGuard propagation risk in all swarm topologies.
- Reuses existing `InputValidator` logic — minimal new code surface.
- Adds structured audit events for security monitoring.

### Negative
- Adds latency at tool composition and agent message boundaries (~1–5ms per gate, estimated).
- SimHash threshold requires calibration to avoid false positives on legitimate multi-tool chains.
- Channel gate may strip legitimate structured outputs that resemble injection patterns (need allow-list for known safe formats).

### Neutral
- Does not address MemPoison (persistent memory poisoning) or PlanFlip (planning-phase injection) — those require separate ADRs.
- `CLAUDE_FLOW_SECURITY_CHANNEL_GATE=0` env var to disable for trusted internal environments.

---

## Alternatives Considered

- **LLM-based inspection**: Too expensive ($0.003+ per gate call) and adds an attack surface (the inspector itself can be injected).
- **Allowlist-only approach**: Insufficient for 314 tools — allowlist maintenance burden too high.
- **No action**: Acceptable short-term only; ShareLock is reproducible with Grade A evidence.

---

## References

- arXiv 2606.27027 — ShareLock: A Stealthy Multi-Tool Threshold Poisoning Attack Against MCP
- arXiv 2607.19430 — ChannelGuard: Safe Models Do Not Compose into Safe Multi-Agent Systems
- arXiv 2607.14651 — MemPoison (context only)
- OWASP LLM Top 10 v1.1: LLM01 (Prompt Injection), LLM07 (Insecure Plugin Design), LLM08 (Excessive Agency)
- Dream Cycle issue: #2783
