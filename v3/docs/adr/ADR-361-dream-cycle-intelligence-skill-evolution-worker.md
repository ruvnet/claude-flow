# ADR-361: Skill Evolution Worker (SEW) — Runtime RL-Based Skill Acquisition for SONA

- **Status:** Proposed
- **Authors:** claude (dream-cycle agent, 2026-07-07)
- **Related:** [ADR-026](ADR-026-three-tier-model-routing.md) (3-tier model routing), [ADR-143](ADR-143-tier-1-codemod-routing.md) (Tier-1 codemod routing), [ADR-174](ADR-174-memory-distillation-self-optimization.md) (memory distillation), [ADR-176](ADR-176-proven-self-benchmarking-harness-loop.md) (self-benchmarking harness)

---

## Context

Ruflo's SONA (Self-Optimizing Neural Architecture) adapts routing weights at inference time (measured 0.0043ms/adapt) and the MoE gate converges from confidence 0.13→0.88 after rewards. However, SONA's skill catalog — the discrete skill types available to agents at spawn time — is **statically defined** in the codebase. Agent types are declared at initialization and do not evolve based on runtime task outcomes.

In 2026, **SkillRL** (arXiv:2602.08234) demonstrates that agents with RL-driven recursive skill acquisition outperform static skill catalogs across EvoAgentBench's four domains (web research, algorithmic reasoning, software engineering, knowledge retrieval). The key insight is that skill *selection* (which skill to apply to a task) and skill *acquisition* (whether to add a new skill derived from task experience) operate on different timescales and benefit from separate RL signals.

Separately, **EvolveMem** (arXiv:2605.13941) shows that memory management strategies themselves can be improved via an auto-research loop — analogous to the skill evolution gap but on the memory side.

The existing `post-task` hook already fires with `--success true/false` per task completion. This is the natural injection point for an RL update signal.

---

## Decision

Add a **Skill Evolution Worker (SEW)** as the 13th background worker in the hooks system (`@claude-flow/hooks`).

### SEW Behavior

1. **Trigger:** Fires on every `post-task` hook event (priority: normal; non-blocking to task pipeline).
2. **Signal extraction:** Reads task outcome (success/failure), task duration, model tier used, and post-hoc skill label from SONA's trajectory log.
3. **RL update:** Applies a SARSA(λ) update to a per-skill-type Q-table stored in AgentDB under namespace `skill-evolution`. λ=0.9, α=0.01, γ=0.95.
4. **Skill promotion gate:** A new skill variant is promoted to the active catalog only when its Q-value confidence interval lower bound exceeds **0.75** across ≥20 task completions. This prevents premature skill inflation.
5. **Skill pruning:** Skills with Q-value falling below 0.20 for ≥50 consecutive tasks are demoted to `deprecated` status (not deleted; available for re-promotion).
6. **SONA integration:** SEW writes updated skill weights to the SONA's MoE router's auxiliary skill index. The MoE gate reads this index at routing time. No change to the MoE gate architecture itself.
7. **Observability:** Skill promotion and demotion events are emitted as structured log events and exposed via `npx claude-flow@latest hooks worker status --worker sew`.

### CLI Surface

```bash
# Status
npx claude-flow@latest hooks worker status --worker sew

# Inspect skill Q-table
npx claude-flow@latest hooks worker dispatch --trigger sew --action inspect

# Force a skill promotion dry-run
npx claude-flow@latest hooks worker dispatch --trigger sew --action promote-dryrun

# Disable (opt-out)
npx claude-flow@latest config set hooks.workers.sew.enabled false
```

### Data Schema (AgentDB `skill-evolution` namespace)

```typescript
interface SkillQRecord {
  skillId: string;          // e.g. "coder:typescript"
  qValue: number;           // current Q-value
  sampleCount: number;      // number of SARSA updates
  status: "active" | "candidate" | "deprecated";
  lastUpdated: string;      // ISO timestamp
  confidenceLowerBound: number; // Bayesian lower bound at 95%
}
```

---

## Consequences

**Positive:**
- Closes the SkillRL gap: Ruflo gains runtime skill acquisition without a full model fine-tune cycle.
- Additive to ADR-026/ADR-143: tier routing is unchanged; SEW operates on the skill index layer above it.
- Naturally amortized: SARSA updates are O(1) per task; no batch training required.
- Reuses existing `post-task` hook infrastructure and AgentDB storage.

**Negative / Risks:**
- Skill catalog instability during early convergence (≤20 completions per skill). Mitigated by the promotion gate.
- AgentDB write contention under high-concurrency swarms. Mitigation: SEW uses optimistic concurrency with a per-skill lock (50ms timeout; drops update rather than blocking).
- Q-table cold-start on fresh installs. Mitigation: ship a seed Q-table derived from the 6,000-commit history (build artifact; not source-controlled).

**Not changed:**
- Existing 12 background workers are unaffected.
- MoE gate architecture (ADR-026) is unchanged.
- ADR-176 self-benchmarking harness is unchanged; SEW adds a new signal source it can read.

---

## Validation Criteria

- [ ] SEW promotes ≥1 skill variant in a 100-task integration test suite.
- [ ] No task latency regression (p99 < +5ms) measured by ADR-163 benchmarking suite.
- [ ] EvoAgentBench score ≥ baseline + 5% after 500 SEW-driven tasks (to be baselined per ADR-176).
- [ ] Skill Q-table persists across session restarts (AgentDB round-trip test).
