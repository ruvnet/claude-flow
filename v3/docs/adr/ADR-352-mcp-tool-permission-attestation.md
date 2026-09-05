# ADR-352: MCP Tool Permission Attestation (Min-Privilege Contract)

- **Status**: Proposed
- **Authors**: claude (dream-cycle agent, 2026-06-26)
- **Date**: 2026-06-26
- **Dream Cycle Issue**: TBD (filed same night)

---

## Context

The 2026-06-26 Dream Cycle SOTA sweep surfaced two converging evidence streams that identify MCP tool-call boundaries as the primary unguarded attack surface in LLM agent systems:

1. **ShareLock (arXiv 2026, Grade A)** — Achieves >90% poisoning ASR on MCP-connected agents via Shamir's threshold scheme distributed across multiple benign-looking tool servers. The attack exploits the absence of tool-level permission declarations: any server can inject arbitrary behaviour if the agent does not enforce a privilege contract at dispatch time.

2. **ToolPrivBench (arXiv 2026, Grade A)** — 64.9% of Qwen3-8B tool calls escalate to higher-privilege tools than the task requires (OPUR metric). Post-training with privilege-aware objectives reduces OPUR to 27.02%. The benchmark formalises 544 scenarios across 8 domains and 5 risk patterns.

3. **ControlPlane paper (arXiv 2026, Grade A)** — Fewer than 1% of coding agents declare explicit permission boundaries, making over-privilege the default posture.

Ruflo's current security module (`@claude-flow/security`) provides `SafeExecutor` (command injection), `InputValidator` (Zod), and `PathValidator` (traversal). None operate at the MCP tool registration or dispatch layer. Tool calls are forwarded without a declared min-privilege contract.

---

## Decision

Introduce a **MCP Tool Permission Attestation** layer with two integration points:

### 1. Tool Registration Contract

Every MCP tool registration (server-side and client-side stub) must carry a `permissions` manifest:

```typescript
interface ToolPermissionContract {
  toolName: string;
  minPrivilege: {
    filesystem?: 'none' | 'read' | 'write' | 'execute';
    network?: 'none' | 'outbound' | 'inbound' | 'full';
    process?: 'none' | 'spawn' | 'kill';
    memory?: 'none' | 'read' | 'write';
    agentScope?: 'none' | 'self' | 'team' | 'global';
  };
  declaredAt: string;   // ISO date of contract signature
  trustLevel: 'official' | 'community' | 'unverified';
}
```

Tools without a `permissions` field are assigned `trustLevel: 'unverified'` and routed through a stricter sandbox.

### 2. Dispatch-Time Enforcement

`SafeExecutor` is extended with a `McpPermissionGuard` that runs before every tool dispatch:

```
Request → McpPermissionGuard → {
  if call.escalatesAbove(tool.minPrivilege) → REJECT (log + alert)
  if tool.trustLevel === 'unverified' && call.privilege > 'read' → BLOCK
  else → forward to SafeExecutor → execute
}
```

Rejection emits a structured event to the security audit log; repeated escalation triggers a circuit-breaker (ADR-097 pattern).

---

## Target Metrics

| Metric | Baseline | Target |
|--------|----------|--------|
| OPUR (over-privilege usage rate) | ~64.9% (ToolPrivBench Qwen3-8B baseline) | ≤ 30% |
| ShareLock-style poisoning ASR | >90% (no defence) | < 10% |
| Tools with declared contracts | 0% | 100% of official tools; ≥ 80% of community tools |

---

## Consequences

**Positive:**
- Closes the primary attack vector identified by ShareLock
- Provides a measurable ToolPrivBench-equivalent baseline for continuous monitoring
- Composable with ADR-093 (MCP audit) and ADR-131 (tool output guardrail)

**Negative / Risk:**
- Breaking change for tool servers that currently omit `permissions` — requires migration period
- OPUR measurement requires a ToolPrivBench-compatible evaluation harness (new test infrastructure)
- Unverified tools silently downgraded to read-only scope — may surprise plugin authors

## Alternatives Considered

- **Prompt-level privilege hints only** (rejected): Relies on model compliance; ToolPrivBench shows models ignore prompts under tool-failure pressure
- **Runtime syscall tracing** (deferred): Effective but requires platform-specific instrumentation; out of scope for v3.7 timeframe
- **Output-only guardrail** (existing ADR-131/146): Insufficient — output sanitisation does not prevent the upstream tool invocation

## References

- ShareLock: arXiv 2026 (MCP threshold poisoning, >90% ASR)
- ToolPrivBench: arXiv 2026 (64.9% OPUR baseline, 27.02% post-training)
- ControlPlane: arXiv 2026 (<1% agents declare permission boundaries)
- ADR-092: MCP tool validation bugfixes
- ADR-093: MCP audit May 2026 remediation
- ADR-097: Federation budget circuit-breaker (reused pattern)
- ADR-131/146: Tool output guardrail
