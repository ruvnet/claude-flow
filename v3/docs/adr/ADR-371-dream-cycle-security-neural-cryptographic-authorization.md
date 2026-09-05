# ADR-371: Neural Cryptographic Authorization Gate for Agentic Action Execution

**Status**: Proposed  
**Authors**: claude (dream-cycle agent, 2026-07-21)  
**References**: arXiv (Jul 16, 2026) "From Neural Intent to Cryptographic Authorization: Governing Agentic Workflows"; ADR-178 (RepE IPI Detection); ADR-165 (Security CVE Posture); ADR-096 (Encryption at Rest); ADR-101 (Federated Claims)

---

## Context

The July 2026 arXiv paper "From Neural Intent to Cryptographic Authorization: Governing Agentic Workflows" (Grade A) demonstrates that:

1. **Identity verification is insufficient**: Authenticated agents can still be hijacked via direct or indirect prompt injection after identity is confirmed. The attack succeeds at the intent-interpretation layer, not the authentication layer.

2. **The proposed fix is a mandatory cryptographic gate**: Before any agentic action executes, a Neural Cryptographic Service (NCS) computes an intent signature from the agent's hidden states and requires cryptographic proof that the action is authorized under the original task scope. If the intent signature deviates from the authorized pattern, execution is blocked regardless of agent identity.

Ruflo's current security stack (`@claude-flow/security`) provides:
- `InputValidator` — boundary-level input validation (Zod)
- `PathValidator` — path traversal prevention  
- `SafeExecutor` — command injection protection
- ADR-178 (Proposed) — RepE-based IPI detection via entropy monitoring

None of these implement a cryptographic authorization gate at the action-execution level. ADR-096 covers encryption at rest. ADR-101 covers federated claims (identity). Neither prevents a legitimate, authenticated agent from executing an injected harmful action.

This is architecturally distinct from ADR-178: RepE detects anomalous intent; NCA prevents execution even when detection is uncertain. They are complementary.

---

## Decision

Add a `CryptoAuthGate` middleware to `@claude-flow/security` that intercepts action execution in the `@claude-flow/hooks` `pre-task` → `execute` path.

### Gate Architecture

```
Agent intent
    │
    ▼
┌─────────────────────────────────────┐
│ NCA Layer (CryptoAuthGate)          │
│  1. Extract intent signature         │
│     (task scope + action type +      │
│      tool targets)                   │
│  2. Verify against AuthorizationRoot │
│     (HMAC-SHA256 of original task)   │
│  3. Check deviation threshold        │
│     (configurable, default: strict)  │
│  4. Block or pass execution          │
└─────────────────────────────────────┘
    │                │
  PASS            BLOCK
    │                │
    ▼                ▼
execute()     reject + log + alert
```

### AuthorizationRoot Construction

When a task is initiated via `hooks pre-task`:
1. Compute `AuthorizationRoot = HMAC-SHA256(task_description + allowed_tools + scope_constraints, session_key)`
2. Store `AuthorizationRoot` in the task context (not in shared memory — local to the execution context)
3. Pass `AuthorizationRoot` to all sub-agents spawned by this task

When a sub-agent attempts to call a tool:
1. Compute `ActionSig = HMAC-SHA256(tool_name + tool_args + agent_id, session_key)`
2. Verify `ActionSig` is within the authorized scope defined by `AuthorizationRoot`
3. Out-of-scope actions are blocked, logged (OWASP LLM06 Excessive Agency), and trigger the `audit` background worker

### Deviation Threshold

- **Strict mode** (default): tool targets must exactly match those declared in the original task scope
- **Permissive mode**: tools declared `"allowed": ["read", "search"]` can be used freely; `"disallowed": ["write", "delete"]` are hard-blocked
- **Audit mode**: all actions logged but none blocked; use during rollout to measure false-positive rate

---

## Consequences

### Positive
- Blocks PlanFlip-style cascade attacks at the execution boundary, even when planner context is compromised
- Provides OWASP LLM06 (Excessive Agency) mitigation with cryptographic enforcement
- Complements ADR-178 RepE detection: detect (RepE) + prevent (NCA) in depth
- Audit trail for all out-of-scope action attempts

### Negative
- Adds latency per tool call (HMAC computation ≈ <1ms at current scale)
- Requires tasks to declare scope upfront — breaks ad-hoc agent workflows that don't pre-declare tools
- Session key management adds operational complexity (key rotation, multi-agent scope inheritance)

### Neutral
- Strict mode may generate false positives on legitimate multi-step workflows; audit mode recommended for first 2-week rollout
- AuthorizationRoot is per-task, not per-session — prevents scope bleed between concurrent tasks

---

## Implementation Scope

| Package | Change |
|---------|--------|
| `@claude-flow/security` | Add `CryptoAuthGate` class; `AuthorizationRoot` builder; scope deviation check |
| `@claude-flow/hooks` | Wire `CryptoAuthGate.check()` into `pre-task` hook before any tool dispatch |
| `@claude-flow/cli` | Add `--nca-mode [strict|permissive|audit]` flag to `hooks pre-task` |
| `@claude-flow/shared` | Add `TaskAuthContext` type for `AuthorizationRoot` + `ActionSig` |

---

## Relationship to Other ADRs

- **ADR-178** (RepE IPI Detection): NCA is the prevention layer; RepE is the detection layer. Both should ship together.
- **ADR-165** (Security CVE Posture): NCA adds to the security hardening surface; update CVE posture review after shipping.
- **ADR-096** (Encryption at Rest): Orthogonal — NCA operates at runtime action layer, not storage layer.
- **ADR-101** (Federated Claims): Claims prove identity; NCA proves action scope. Both are required — NCA assumes identity is established.
