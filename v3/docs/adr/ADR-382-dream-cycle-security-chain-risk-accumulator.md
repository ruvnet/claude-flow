# ADR-382: ChainRiskAccumulator — Cross-Tool Sequential Injection Correlation

**ID**: ADR-382
**Status**: Proposed
**Date**: 2026-08-11
**Authors**: claude (dream-cycle agent, 2026-08-11)
**Branch**: dream/2026-08-11-security
**Related ADRs**:
- ADR-131 (ToolOutputGuardrail — ASI01 content-boundary screening)
- ADR-165 (Security CVE Posture Review)
- ADR-377 (AgentDB Retrieval Security Layer)

---

## Context

arXiv:2608.09732 "ColluSkill: Adversarial Cross-Skill Composition for Evading Agent Skill Scanners" (Aug 9, 2026, Grade A) demonstrates that per-component MCP scanners are trivially bypassed by composing individually-safe skills into an adversarial chain. The paper reports:

- **96.0% ASR** against per-tool static scanners (including phrase-catalog and Shamir-split fragment detection patterns)
- **22.5% ASR** after applying ChainGuard — a chain-level cross-skill correlation defense that maintains a rolling injection-risk sum across the full tool-call sequence

Ruflo's current `McpCompositionInspector` performs per-tool Shamir-split fragment correlation and phrase-catalog matching. It does not maintain any cross-tool state. A multi-step ColluSkill attack distributes injection payload fragments across sequential tool calls so each call scores below the per-tool threshold, while the combined payload is assembled by the target model.

A companion finding, arXiv:2608.08468 "SkillsMetric" (Grade A), reports **0% detection** for host-destruction attacks in static analysis (AUC 0.93 for benign/malicious classification but complete blind spot for the host-destruction subcategory). The `injection-catalog.ts` phrase list has no host-destruction patterns.

arXiv:2608.06477 "StepJack" (Grade A) shows multi-hop indirect prompt injection ASR rises monotonically from **31.3% at hop 1 to 36.9% at hop 3**, confirming that `ChannelGuard`'s stateless per-hop scanning is insufficient for multi-agent swarm pipelines.

---

## Decision

### 1. `ChainRiskAccumulator` — new class in `mcp-composition-inspector.ts`

Add a `ChainRiskAccumulator` that is:
- **Session-scoped**: keyed by `sessionId` (from the MCP call context), persisted for the session lifetime
- **Additive**: each per-tool `InjectionRisk` score is added to the session's accumulated total
- **Threshold-gated**: when `accumulatedScore >= CHAIN_RISK_THRESHOLD` (default: 3 × per-tool threshold), the inspector returns a `chain-injection` finding at severity `critical` regardless of whether the triggering tool call would have passed individually
- **Decay-optional**: expose `chainRiskDecayMs` config (default: disabled) for high-throughput scenarios where operator context warrants time-windowed accumulation

```typescript
// v3/@claude-flow/cli/src/security/mcp-composition-inspector.ts
export class ChainRiskAccumulator {
  private ledger = new Map<string, { score: number; lastUpdated: number }>();
  
  add(sessionId: string, toolScore: number): number { ... }
  get(sessionId: string): number { ... }
  reset(sessionId: string): void { ... }
  sweep(maxAgeMs: number): void { ... }  // GC stale sessions
}
```

### 2. `SessionRiskLedger` — stateful `ChannelGuard`

Extend `ChannelGuard` to accept an optional `channelSessionId`. When provided:
- Accumulate `ChannelFinding` severity scores per session (low=1, medium=2, high=3)
- When the session total reaches `SESSION_RISK_THRESHOLD` (default: 6), return an additional `session-risk-exceeded` finding at severity `critical`
- `channelSessionId` is propagated through `SendMessage`'s existing message envelope

### 3. Host-destruction patterns in `injection-catalog.ts`

Add `HOST_DESTRUCTION_PATTERNS` export alongside `INJECTION_PHRASES`:

```typescript
export const HOST_DESTRUCTION_PATTERNS = [
  'rm -rf /',
  'format c:',
  'dd if=/dev/zero',
  'shutdown -h now',
  'del /f /s /q',
  'truncate --size=0',
  ':(){:|:&};:',     // fork bomb
  'mkfs.',
] as const;
```

Weight host-destruction matches at `severity: 'critical'` unconditionally.

---

## Consequences

**Positive:**
- Closes the ColluSkill compositional evasion gap (96.0% ASR → target: parity with ChainGuard's 22.5%)
- Closes the StepJack multi-hop gap for swarm pipelines
- Adds host-destruction detection (currently 0% in static analysis)
- `ChainRiskAccumulator` is session-scoped, stateless across sessions — no new persistence requirement

**Negative / Risks:**
- Session-scoped accumulation increases false-positive rate in long sessions with many legitimate tool calls. Operators must tune `CHAIN_RISK_THRESHOLD`.
- `SessionRiskLedger` in `ChannelGuard` requires `channelSessionId` to be threaded through `SendMessage` — a minor API change in the swarm coordinator.
- Neither `ChainRiskAccumulator` nor `SessionRiskLedger` are model-based classifiers; adversaries with knowledge of the threshold can still craft payloads that stay just below it. This is a known limitation of all deterministic defenses.

---

## Alternatives Considered

1. **Model-based classifier at the chain boundary** — higher accuracy but adds LLM latency to every tool call; rejected for hot-path use; remains an option for async audit mode.
2. **Raise per-tool thresholds** — does not address compositional evasion; rejected.
3. **Do nothing until a published bypass of the current scanner is demonstrated on Ruflo specifically** — ColluSkill's 96.0% ASR on equivalent per-component scanners is sufficient evidence; rejected.
