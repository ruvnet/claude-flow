# ADR-336 — Agent Authorization Propagation and MCP Authentication Enforcement

**Status**: Proposed
**Authors**: claude (dream-cycle agent, 2026-05-31)
**Related**: ADR-012 (MCP Security Features), ADR-013 (Core Security Module), ADR-131 (ToolOutputGuardrail), #[tonight's issue]

---

## Context

Three Grade A papers published May 2026 identify a security layer Ruflo currently lacks — authorization propagation across agent delegation chains — that is architecturally distinct from the content-screening gap addressed by ADR-131.

**ADR-131** covers WHAT agents receive (tool output content screening for injected instructions).  
**This ADR** covers WHO agents can act as and what they are authorized to delegate.

### Evidence

1. **arXiv:2605.22333** (Grade A, empirical): 40.55% of 7,973 live MCP servers expose tools with zero authentication; 96.6% of OAuth-enabled servers contain ≥1 exploitable flaw. Ruflo registers MCP tools but performs no runtime authentication check on server identity before accepting tool responses.

2. **arXiv:2605.28914 — AIRGuard** (Grade A, controlled benchmark): Runtime authority control at the action execution layer reduces agent attack success from 36.3% to 5.5% (−85%). The key primitive is least-privilege authorization checked per-action, not per-session.

3. **arXiv:2605.05440 — Authorization Propagation** (Grade A, formal analysis): Multi-agent delegation creates an "authorization propagation" problem with seven structural requirements not solvable by RBAC, ABAC, or ReBAC alone. When an agent delegates a task via SendMessage, the receiving agent may escalate the granted scope by calling tools or sub-agents the original caller was not authorized to invoke.

4. **arXiv:2605.26497 — Dual-Graph Provenance Defense** (Grade A): Comparing an execution provenance graph against an authorization intent graph reduces indirect prompt injection success from 40% to 1%.

### Current State

`@claude-flow/security` provides:
- `InputValidator` — boundary input validation (Zod-based)
- `PathValidator` — path traversal prevention
- `SafeExecutor` — command injection protection
- `PasswordHasher`, `TokenGenerator` — credential utilities

None of these track authorization scope across agent delegation boundaries, verify MCP server identity, enforce per-action privilege, or produce an execution provenance record.

---

## Decision

Add `AgentAuthorizationPropagator` as a new component in `@claude-flow/security`.

### Component Design

**File**: `v3/@claude-flow/security/src/authorization/propagator.ts`

```typescript
interface AuthScope {
  principalId: string;         // originating agent identity
  grantedTools: string[];      // MCP tool IDs this scope allows
  delegationDepth: number;     // max remaining delegation hops
  expiresAt: number;           // unix ms
}

interface SendMessageEnvelope {
  scope: AuthScope;            // NEW — attached to every SendMessage
  payload: unknown;
}

class AgentAuthorizationPropagator {
  // Attach reduced scope to outbound SendMessage
  wrapOutbound(msg: unknown, currentScope: AuthScope, requestedTools: string[]): SendMessageEnvelope;

  // Validate inbound tool call against current delegation scope
  checkToolCall(toolId: string, scope: AuthScope): { allowed: boolean; reason?: string };

  // Verify MCP server presented valid auth before accepting its response
  verifyServerAuth(serverId: string, credential: unknown): boolean;

  // Record action in provenance log for dual-graph audit
  recordAction(agentId: string, toolId: string, scope: AuthScope, outcome: 'allowed' | 'denied'): void;
}
```

### MCP Authentication Validator

**File**: `v3/@claude-flow/cli/src/mcp/auth-validator.ts`

Before any tool response from an MCP server enters agent reasoning:
1. Check server is in the registered allowlist
2. If server declared OAuth support, verify token validity
3. If server has no declared auth and is not in an explicit unauthenticated-allowed list, reject with `UNAUTHENTICATED_MCP_SERVER` error

### Integration Points

- `v3/@claude-flow/hooks/src/pre-task.ts` — initialize scope on task creation
- `v3/@claude-flow/cli/src/mcp/` — add `auth-validator.ts`, call before tool result processing
- `@claude-flow/security` public API — export `AgentAuthorizationPropagator`

### Backwards Compatibility

- `scope` on SendMessage envelope is optional in v1. Agents without scope set operate in a permissive legacy mode (all tools allowed, depth unlimited). A `CLAUDE_FLOW_STRICT_AUTH=true` env var enables enforcement mode.
- Existing `SafeExecutor` is unchanged.

---

## Consequences

**Positive**
- Eliminates authorization escalation in multi-hop agent delegation
- Provides provenance log for post-incident audit (maps to OWASP ASI07 and dual-graph defense)
- MCP auth validator closes the 40.55% unauthenticated-server exposure
- Targets 85% reduction in action-layer attack success rate (AIRGuard benchmark, Grade A)

**Negative / Trade-offs**
- `scope` field adds ~100 bytes to every SendMessage envelope (negligible vs payload)
- Strict mode may break existing agent pipelines that rely on implicit cross-agent tool access — requires explicit scope grants on upgrade

**Deferred**
- Full dual-graph provenance comparison engine (expensive at runtime) — Phase 2
- Cross-organization delegation (MCP-I / DIF standard) — deferred pending spec maturity

---

## Alternatives Rejected

- **Extend ADR-131 ToolOutputGuardrail**: ADR-131 screens content before it enters reasoning; this ADR controls who is authorized to take actions. They address different layers and must coexist.
- **RBAC on agent roles**: The formal analysis (arXiv:2605.05440) demonstrates RBAC cannot maintain authorization invariants across dynamic delegation chains in LLM agents. Scope-based propagation is the minimum viable solution.
