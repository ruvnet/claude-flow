# ADR-381: World Rehearsal Pre-Execution Buffer for SONA Adaptation Loop

**Status:** Proposed  
**Authors:** claude (dream-cycle agent, 2026-08-07)  
**Surface:** intelligence (SLOT=2, Dream Cycle 2026-08-07)  
**Ref:** arXiv:2608.06197 (EnvACE, Aug 6 2026)

---

## Context

The SONA (Self-Optimizing Neural Architecture) adaptation loop in `@claude-flow/hooks` operates reactively: it ingests trajectory signals *after* tool calls complete, updates pattern weights, and influences future routing decisions. It has no mechanism to simulate or rehearse an action before committing it.

EnvACE (arXiv:2608.06197, Aug 6 2026) introduces *world rehearsal* — a training and inference paradigm where agents alternate between:
1. Generating a candidate tool call
2. Simulating the expected environment response internally (without invoking the real tool)
3. Using the simulated outcome to score / revise the candidate before dispatch

This enables "private rehearsal before committed execution," allowing agents to self-correct without paying the latency or side-effect cost of real tool invocations. EnvACE reports outperforming environment-scaling baselines on BFCL-v4, tau²-Bench, VitaBench, and FinMCP-Bench (four agentic benchmarks, 2026).

No competitor (LangGraph, CrewAI, Microsoft Agent Framework, OpenAI Agents SDK) implements world rehearsal as of August 2026.

## Decision

Introduce a **World Rehearsal Buffer (WRB)** as a pre-dispatch gate in the SONA adaptation loop, implemented in `@claude-flow/hooks`:

```typescript
// Pseudocode: pre-task hook integration point
async function preDispatchRehearsal(
  candidateToolCall: ToolCall,
  reasoningBank: ReasoningBank,
  sonaState: SonaState
): Promise<{ approved: boolean; confidence: number; simulatedOutcome: string }> {
  const cachedTrajectories = await reasoningBank.retrieve(candidateToolCall.intent);
  const simulatedResponse = sonaState.moe.simulateOutcome(candidateToolCall, cachedTrajectories);
  const confidence = simulatedResponse.confidence;
  return {
    approved: confidence >= REHEARSAL_THRESHOLD,   // default: 0.6
    confidence,
    simulatedOutcome: simulatedResponse.summary
  };
}
```

The WRB sits in the `pre-task` hook, after intent classification and before tool dispatch. If `approved=false`, SONA revises the tool call or escalates to a higher-tier model (ADR-026 Tier 2/3 routing).

### Integration Points

| Component | Change |
|-----------|--------|
| `@claude-flow/hooks` pre-task | Add WRB gate; emit `rehearsal_trace` event |
| `SONA` adaptation loop | Add `simulateOutcome()` method using MoE experts + cached trajectories |
| `ReasoningBank` | Add `retrieveForRehearsal(intent, domainHint)` returning top-k trajectory embeddings |
| `@claude-flow/cli` hooks status | Expose `rehearsal_confidence` in `hooks worker status` output |

### Configuration

```json
{
  "sona": {
    "worldRehearsal": {
      "enabled": true,
      "confidenceThreshold": 0.6,
      "maxRehearseMs": 50,
      "fallbackOnTimeout": "approve"
    }
  }
}
```

## Consequences

**Positive:**
- Reduces committed tool-call errors by catching low-confidence dispatches before side effects occur
- First-mover: no competitor implements this as of Aug 2026
- Reuses existing SONA + ReasoningBank infrastructure; does not require new external dependencies
- Measurable: BFCL-v4 score before/after provides a concrete benchmark gate

**Negative:**
- Adds latency to the pre-task path; must complete within `maxRehearseMs` (default 50ms) to stay below SONA's 0.05ms adaptation target per call — the rehearsal is a separate step, not the adaptation itself
- Rehearsal quality is bounded by the richness of the ReasoningBank cache; cold-start agents with few cached trajectories will see low rehearsal confidence and high fallback rates
- Requires implementing `simulateOutcome()` in the MoE layer, which currently only performs routing, not generation

## Alternatives Considered

- **Post-hoc correction only (status quo):** SONA continues to adapt after errors. Rejected because it pays the full cost of failed tool calls (latency, side effects, downstream cascade).
- **External simulator (EnvACE full training approach):** Train a separate environment model. Rejected for the initial implementation — too expensive; world rehearsal from cached trajectories achieves the key benefit without a dedicated simulator.
- **Human-in-loop approval gate (LangGraph / Microsoft Agent Framework pattern):** Adds a human checkpoint before high-stakes tool calls. Complementary, not a substitute — the WRB handles automated pre-screening; human gates address policy/compliance, not confidence.

## Measurement Gate

This ADR is considered proven when Ruflo publishes a BFCL-v4 or τ-bench trajectory accuracy score with and without WRB enabled, demonstrating ≥5% relative improvement in tool-call success rate on the benchmark.

## References

- arXiv:2608.06197 — EnvACE: Internalizing Environment Dynamics via World Rehearsal for Agentic RL
- arXiv:2607.05202 — EvoAgentBench: Benchmarking Agent Self-Evolution via Ability Transfer
- arXiv:2608.06346 — TRAJDEBUG: Tracing Error Lifecycle to Identify Critical Failures in Long-Horizon Agent Trajectories
- ADR-026: 3-Tier Model Routing
- Dream Cycle 2026-08-07: Issue #TBD, Branch `dream/2026-08-07-intelligence`
