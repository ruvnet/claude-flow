# ADR-144 — Agent Authorization Propagation and MCP Authentication Enforcement

**Status**: Proposed
**Date**: 2026-06-02
**Issue**: [ruvnet/ruflo#2248](https://github.com/ruvnet/ruflo/issues/2248)
**Related**: ADR-012 (MCP Security Features), ADR-013 (Core Security Module), ADR-131 (ToolOutputGuardrail — content layer), ADR-145 (Plugin supply-chain — install layer)

## Context

ADR-131 closed the *content* layer of OWASP ASI01: tool outputs and memory reads are now screened for embedded instructions before they enter agent reasoning. Three Grade A papers published May 2026 identify a separate, currently-unmitigated layer: **authorization propagation** across agent delegation chains.

The distinction matters:

| Layer | ADR | Question it answers |
|---|---|---|
| Content boundary | ADR-131 | "Does this text contain instructions trying to hijack the model?" |
| Action boundary | **this ADR** | "Is the agent acting now allowed to call this tool, on this server, on behalf of this principal?" |
| Install boundary | ADR-145 | "Is the code that's about to run trustworthy at all?" |

### Evidence

1. **MCP Authentication Measurement** (arXiv:2605.22333, May 2026, Grade A — empirical): First survey of 7,973 live MCP servers. **40.55% expose tools with zero authentication; 96.6% of OAuth-enabled servers contain ≥1 exploitable flaw** (most common: improper scope validation). Ruflo registers MCP tools but performs no runtime authentication check on server identity before accepting tool responses, so any agent that calls a federated MCP tool today has a >40% chance of trusting an unauthenticated source.

2. **AIRGuard** (arXiv:2605.28914, May 2026, Grade A — controlled benchmark): Runtime authority control at the action execution layer reduces agent attack success **from 36.3% to 5.5% (−85%)**. The load-bearing primitive is least-privilege authorization checked **per action**, not per session.

3. **Authorization Propagation** (arXiv:2605.05440, Apr 2026, Grade A — formal analysis): Multi-agent delegation creates an authorization-propagation problem with seven structural requirements not solvable by RBAC, ABAC, or ReBAC alone. When agent A delegates to agent B via SendMessage, B can escalate the granted scope by calling tools A was never authorized to invoke. Scope must travel **with** the delegation message and be enforced at every hop.

4. **Dual-Graph Provenance Defense** (arXiv:2605.26497, May 2026, Grade A): Comparing an *execution* provenance graph against an *authorization-intent* graph reduces indirect prompt injection success **from 40% to 1%**. Provenance is the audit trail required for any post-incident investigation.

### Current State

`@claude-flow/security` provides `InputValidator`, `PathValidator`, `SafeExecutor`, `PasswordHasher`, `TokenGenerator`. None of these track authorization scope across agent delegation boundaries, verify MCP server identity, enforce per-action privilege, or produce an execution provenance record. `SendMessage` (the comms primitive between named agents) carries no authorization metadata at all.

## Decision

Add `AgentAuthorizationPropagator` as a new component in `@claude-flow/security`, paired with an MCP-server auth validator in the CLI's MCP layer.

### `AgentAuthorizationPropagator` shape

**File**: `v3/@claude-flow/security/src/authorization/propagator.ts`

```typescript
interface AuthScope {
  principalId: string;         // originating agent identity
  grantedTools: string[];      // MCP tool IDs this scope allows
  grantedServers: string[];    // MCP servers whose responses are accepted
  delegationDepth: number;     // max remaining delegation hops
  expiresAt: number;           // unix ms
}

interface SendMessageEnvelope<T = unknown> {
  scope: AuthScope;            // NEW — attached to every SendMessage
  payload: T;
}

class AgentAuthorizationPropagator {
  // Attach a reduced scope to an outbound SendMessage.
  // Newly granted tools MUST be a subset of currentScope.grantedTools;
  // delegationDepth MUST decrement by ≥ 1.
  wrapOutbound<T>(payload: T, currentScope: AuthScope, requestedTools: string[]): SendMessageEnvelope<T>;

  // Validate an inbound tool call against the current delegation scope.
  // Returns the policy decision; never throws.
  checkToolCall(toolId: string, scope: AuthScope): { allowed: boolean; reason?: string };

  // Verify an MCP server presented valid auth before its response is consumed.
  verifyServerAuth(serverId: string, credential: unknown): boolean;

  // Record action in provenance log for the dual-graph audit (ADR-144 P2).
  recordAction(agentId: string, toolId: string, scope: AuthScope, outcome: 'allowed' | 'denied'): void;
}
```

Scope is **monotonically reducing**: each delegation hop can drop tools/servers but never add them. Adding requires the requesting agent to talk to the original principal out-of-band — the same shape as OAuth scope reduction.

### MCP Authentication Validator

**File**: `v3/@claude-flow/cli/src/mcp/auth-validator.ts`

Before any tool response from an MCP server enters agent reasoning:

1. The server MUST be in the registered allowlist *or* in `unauthenticated-allowed.json` (an explicit, audit-logged opt-out for known-public servers like a local read-only documentation server).
2. If the server declared OAuth support in its tool registration, the validator verifies token freshness and scope.
3. Otherwise, the response is rejected with `UNAUTHENTICATED_MCP_SERVER` and the rejection is surfaced to the agent — never silently dropped (same rule as ADR-131 reject findings).

### Integration plan (phased — P1 is the first PR)

| Phase | Scope | Where |
|---|---|---|
| **P1** | Component + tests + exports; SendMessage envelope schema | `@claude-flow/security/src/authorization/`, `@claude-flow/cli/src/types/` |
| P2 | Outbound: wrap every SendMessage in the comms layer | `@claude-flow/cli/src/agent/comms.ts` |
| P3 | Inbound: validate scope at the MCP tool dispatcher | `@claude-flow/cli/src/mcp-tools/dispatch.ts` |
| P4 | MCP auth validator wired before tool result processing | `@claude-flow/cli/src/mcp/auth-validator.ts` |
| P5 | Provenance log + dual-graph audit CLI | `@claude-flow/cli/src/commands/audit.ts` |

P2–P5 ship behind `CLAUDE_FLOW_STRICT_AUTH=true` so existing pipelines continue to work in legacy permissive mode until v4.0.

### Backwards compatibility

- The `scope` field on the envelope is **optional** in v1. Agents that don't set scope operate in legacy mode (all tools allowed, depth unlimited, server auth unchecked).
- `CLAUDE_FLOW_STRICT_AUTH=true` enables enforcement. This env var is a documented escape hatch (registered in `audit-env-var-precedence.mjs`).
- Existing `SafeExecutor` is unchanged.

## Alternatives considered

**Extend ADR-131 ToolOutputGuardrail.** Different layer. ADR-131 screens content before it enters reasoning; this ADR controls *who* is authorized to take actions. They must coexist — neither subsumes the other.

**RBAC on agent roles.** The formal analysis (arXiv:2605.05440) demonstrates RBAC cannot maintain authorization invariants across dynamic LLM delegation chains: roles don't compose under delegation. Scope-based propagation is the minimum viable solution.

**OAuth scope on every cross-agent call.** Closer to the right shape, but requires per-tool OAuth servers — operationally heavy and only solves the MCP-server identity half. Scope-envelope on SendMessage covers both agent-to-agent and agent-to-MCP-server in one mechanism.

## Consequences

**Positive**:
- Closes the 40.55% unauthenticated-MCP-server exposure surfaced by arXiv:2605.22333.
- Targets the AIRGuard 85%-reduction benchmark for action-layer attacks.
- Produces a provenance log that enables post-incident audit (maps to OWASP ASI07).
- Pairs cleanly with ADR-131: content boundary + action boundary together cover both layers of ASI01.

**Negative / risks**:
- The `scope` envelope adds ~100 bytes to every SendMessage (negligible vs payload).
- Strict mode breaks existing pipelines that rely on implicit cross-agent tool access — every agent spawn site must declare its scope explicitly.
- A misconfigured `unauthenticated-allowed.json` becomes a confused-deputy risk; treat it as security-sensitive and gate edits on CODEOWNERS review.

**Deferred**:
- Full dual-graph provenance comparison engine (expensive at runtime — Phase 2 of P5).
- Cross-organization delegation (MCP-I / DIF standard) — deferred pending spec maturity.

## Validation

P1 lands with:
- Unit tests for `wrapOutbound` scope-reduction invariants (cannot grant more than holder, cannot increase delegationDepth).
- Property tests for `checkToolCall` (every reachable scope chain remains a subset of the principal's original grant).
- Integration test demonstrating that a chain `principal → A → B → tool` denies a tool the principal never granted to A, even when B requests it.
- Benchmark: `wrapOutbound` + `checkToolCall` must add < 1 ms p99 to a SendMessage roundtrip.
