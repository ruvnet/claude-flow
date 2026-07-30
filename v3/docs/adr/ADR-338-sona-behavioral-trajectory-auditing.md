# ADR-338 — SONA Behavioral Trajectory Auditing via Embedding-Space Trait Vectors

**Status**: Proposed
**Authors**: claude (dream-cycle agent, 2026-06-02)
**Related**: ADR-017 (RuVector Integration), ADR-026 (3-tier model routing), ADR-130 (graph intelligence)
**Source**: arXiv:2606.02536 (Leshin, Shah, Timmis — ICML 2026 Workshop: Agents in the Wild)

## Context

SONA (Self-Optimizing Neural Architecture) adapts agent behavior via LoRA micro-tuning and EWC++
continual learning. As of 2026-06-02, SONA has **no behavioral monitoring layer**: propensity drift
(e.g., agents becoming more likely to seek sensitive data, or to skip validation steps) is
undetectable until it causes observable failures.

Leshin et al. (arXiv:2606.02536, ICML 2026 Workshop) demonstrate that **agent behavioral traits
can be quantified as directions in the embedding space of skill-file diffs**. A linear model trained
on 68 labeled before/after skill-file diff pairs achieves:

- **91.2% sign-classification accuracy** (leave-one-out cross-validation)
- **Spearman ρ = 0.82** rank correlation for trait magnitude

The method is lightweight: train once on labeled diffs, then project any new LoRA adaptation delta
onto the trait vector to score the behavioral shift — no full re-evaluation needed.

Additionally, AGENTCL (arXiv:2606.02461, Shu et al.) shows that Ruflo's current SONA evaluation
uses naive task sequences that cannot distinguish memory designs. Compositional task streams (where
sub-tasks recur across sessions) expose plasticity-stability tradeoffs that naive streams mask.

## Decision

Add a **behavioral trajectory auditing layer** to SONA with two components:

### 1. Trait Vector Registry

Maintain a set of named trait vectors (e.g., `seeks-sensitive-data`, `skips-validation`,
`over-delegates`) as unit vectors in the embedding space of skill-file diffs. Vectors are trained
offline on labeled datasets and stored in AgentDB.

**Target file:** `v3/@claude-flow/hooks/src/intelligence/sona.ts`
Add: `computeTraitDelta(beforeDiff: string, afterDiff: string, trait: string): number`

### 2. Behavioral Audit Module

At each SONA adaptation cycle (post-LoRA update), project the adaptation delta onto all registered
trait vectors. Emit a structured `behavioral-drift` event if any trait score exceeds a configurable
threshold (default: 2σ from rolling mean).

**New file:** `v3/@claude-flow/security/src/behavioral-audit.ts`

```typescript
export interface TraitAuditResult {
  trait: string;
  delta: number;         // signed projection score
  zscore: number;        // vs. rolling baseline
  flagged: boolean;      // |zscore| > threshold
}

export async function auditSONAAdaptation(
  beforeDiff: string,
  afterDiff: string,
  traits: string[]
): Promise<TraitAuditResult[]>
```

### 3. Compositional Evaluation Stream

Extend the `ultralearn` background worker to run compositional task streams per the AGENTCL
protocol: inject reusable sub-tasks across sessions and compute:

- **plasticity score**: accuracy on novel tasks after adaptation
- **stability score**: retention of prior-task accuracy post-adaptation

**Target file:** `v3/@claude-flow/hooks/src/workers/ultralearn.ts`
Add: `runCompositionalEvalStream(config: EvalStreamConfig): Promise<PlasticityStabilityReport>`

## Consequences

**Positive:**
- SONA behavioral drift becomes observable before it causes downstream failures
- Compositional evaluation distinguishes memory designs (EWC++ vs. naive replay)
- Trait auditing is lightweight: embedding projection is O(d) per trait per adaptation
- Audit events integrate with existing `@claude-flow/security` pipeline

**Negative:**
- Requires labeled behavioral datasets to train initial trait vectors (one-time offline cost)
- Adds one embedding call per SONA adaptation cycle (~5–15ms latency overhead at 384-dim)
- Compositional eval streams increase ultralearn worker runtime; recommend scheduling during
  low-activity windows only

**Neutral:**
- Trait vector registry stored in AgentDB (consistent with ADR-006 unified memory)
- Flagged events feed the existing `post-task` hook for human review; no auto-rollback

## Implementation Priority

High — behavioral drift is a silent failure mode with security implications. The embedding
projection cost is negligible relative to SONA's existing LoRA update cost.
