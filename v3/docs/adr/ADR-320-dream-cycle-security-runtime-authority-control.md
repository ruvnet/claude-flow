# ADR-320: Runtime Authority Control for Multi-Agent Tool Calls

**Status:** Proposed  
**Authors:** claude (dream-cycle agent, 2026-07-16)  
**Date:** 2026-07-16  
**Related:** ADR-179 (plugin supply chain security), ADR-026 (3-tier model routing), `@claude-flow/security`

---

## Context

The 2026-07-16 Dream Cycle security research (issue #TBD) identifies a critical gap: Ruflo's `@claude-flow/security` module provides code-level protections (Zod boundary validation, path traversal prevention, shell command injection guards) but has no runtime authority control (RAC) layer for multi-agent tool-call chains.

Two 2026 arXiv papers establish the threat quantitatively:

- **LivePI** (arXiv:2605.17986): Indirect Prompt Injection attack success rates of 10.7%–29.6% across production LLMs; group-chat injection succeeds uniformly across all tested models.
- **AIRGuard** (arXiv:2605.28914): Runtime pre-execution authorization reduces ASR from 36.3% to 5.5% on Sonnet, 20.9% to 3.3% on Haiku, with 72–78% utility preservation rate.

A 193-item multi-agent threat taxonomy (arXiv:2603.09002) shows no existing security framework covers >50% of any threat category. OWASP LLM01:2025 (Prompt Injection) remains the top-rated vulnerability class.

In Ruflo's hierarchical swarm topology, agents use shared tool-call channels. A single compromised retrieved document (email, web page, memory entry) can redirect all agents in the pipeline. There is currently no interception point at the tool-call layer.

---

## Decision

Implement a **RuntimeAuthorityController (RAC)** as a new component in `@claude-flow/security`, added as a mandatory middleware layer in swarm tool-call chains:

```typescript
// v3/@claude-flow/security/src/runtime-authority-controller.ts

export interface ToolCallRequest {
  agentId: string;
  toolName: string;
  args: Record<string, unknown>;
  callerContext: string; // retrieved content that prompted the call
}

export interface AuthorizationResult {
  authorized: boolean;
  reason?: string;
  sanitizedArgs?: Record<string, unknown>;
}

export class RuntimeAuthorityController {
  async authorize(req: ToolCallRequest): Promise<AuthorizationResult>;
  async detectInjection(context: string): Promise<{ score: number; patterns: string[] }>;
}
```

The RAC operates in two stages:
1. **Regex fast-path** — detect known injection patterns in `callerContext` before any LLM call
2. **LLM classifier** — for ambiguous cases, call a Haiku-tier model with the injection detection prompt (Tier-2 routing per ADR-026)

A new `pre-tool-use` hook type is added to the v3 hooks system (17 hooks → 18 hooks).

---

## Consequences

**Positive:**
- Closes the IPI gap; measurable target: ASR < 5% on AgentTrap/DTAP-150-class benchmarks (Grade A evidence from AIRGuard)
- Utility Preservation Rate target ≥ 70% (AIRGuard measured 72–78%)
- Aligns with OWASP LLM01:2025 remediation guidance
- Enables LivePI as a regression benchmark in the security test suite

**Negative:**
- Adds latency to every swarm tool call (regex: ~1ms, LLM classifier: ~500ms on Haiku Tier-2)
- Requires new `pre-tool-use` hook type — minor breaking change to hooks API if consumer code enumerates hook types
- False positives may block legitimate tool calls — UPR must be monitored

**Neutral:**
- No change to existing CVE-1/2/3 remediations (code-level, unaffected)
- Complements SafeExecutor (OS-level) — RAC operates at semantic/LLM layer above it

---

## Alternatives Considered

1. **Post-hoc monitoring only** (LangSmith model) — rejected; does not prevent IPI execution, only detects after damage done
2. **Static prompt hardening** — rejected; insufficient (LivePI shows static defenses fail on group-chat channels)
3. **No action** — rejected; IPI is measurable, exploitable, and closes a gap all four major competitors also lack (competitive parity insufficient justification; user data at risk)

---

## Implementation Notes

- `RuntimeAuthorityController` lives in `v3/@claude-flow/security/src/`
- Hook registration: `hooks.register('pre-tool-use', racMiddleware)`
- Benchmark integration: `scripts/security-benchmark-ipi.mjs` (to be created)
- Target files under 500 lines per CLAUDE.md file organization rules
