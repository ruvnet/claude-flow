# ADR-366: Self-Evolving Swarm Skill Distillation via Trajectory Feedback

**Status:** Proposed  
**Authors:** claude (dream-cycle agent, 2026-07-14)  
**Date:** 2026-07-14  
**Related Issues:** dream-cycle nightly research 2026-07-14 (swarm slot 4)

---

## Context

Ruflo's swarm system produces rich execution trajectories on every run: tool-call sequences, timing, success/failure verdicts, and agent message traces are all captured by the `post-task` hook and stored in AgentDB. However, nothing reads these trajectories back to improve the `.claude/skills/` YAML files that define coordination protocols.

Swarm Skills (arXiv:2605.10052, May 2026, Grade A) demonstrates that multi-agent coordination specs can be treated as first-class evolving assets: an automatic distillation algorithm scores each trajectory on Effectiveness × Utilization × Freshness and patches the matching skill definition. The resulting skills become progressively more efficient — without human authoring — and remain portable across agent frameworks via progressive disclosure.

The current state in Ruflo:
- Skills are static YAML files authored by humans
- Execution trajectory data is captured but never fed back to skill definitions
- There is no cross-session coordination quality measurement

## Decision

Implement a **Swarm Skill Trajectory Distillation** loop integrated into the existing `post-task` hook pipeline:

1. **Trajectory capture** (already exists via `post-task`): record tool-call sequence, agent assignments, success/failure verdicts, wall-clock latency per phase.

2. **EUF scoring**: compute Effectiveness (task success rate), Utilization (agent utilization ratio), and Freshness (recency-weighted) for each skill invocation.

3. **Patch generation**: when a skill's EUF score improves over its current definition (threshold: +5% on any dimension), generate a diff against the YAML and write it to `.claude/skills/<skill-name>.yaml` as a versioned patch with `# distilled from trajectory <trajectory-id>` comment.

4. **Portability gate**: before committing a patch, validate the updated skill still passes the existing `claude-flow@v3alpha hooks verify` check. Revert on failure.

5. **Session boundary**: distillation runs once at session end via `session-end` hook, not after every task — to avoid mid-session churn.

### Architecture

```
post-task hook → trajectory store (AgentDB)
                        ↓
              session-end hook triggers
                        ↓
         EUF scorer reads last N trajectories
                        ↓
         EUF delta > +5%?
              YES → patch .claude/skills/<name>.yaml
                    + hooks verify gate
              NO  → no-op
```

### Scope

- Applies only to skills that have run ≥3 times (statistical stability threshold)
- Does NOT modify agent type definitions, MCP tool schemas, or ADRs
- Patch is human-reviewable diff committed to branch; no silent in-place overwrites in production

## Consequences

### Positive
- Coordination protocols improve autonomously from usage data
- Closes the primary gap vs Swarm Skills SOTA (arXiv:2605.10052)
- Leverages existing trajectory capture infrastructure — no new data collection needed
- Human reviewable: every distillation produces a versioned YAML diff in git

### Negative
- EUF scoring adds ~10-50ms to session-end hook (low cost)
- Risk of distilling a lucky-run artifact: mitigated by the ≥3 run threshold and verify gate
- Adds a new file-write operation at session end; could conflict with concurrent sessions (mitigate with file lock)

### Neutral
- Does not require external model calls — EUF is deterministic arithmetic on trajectory metadata

## Alternatives Considered

- **No ADR — implementation-level**: Rejected. This is an architectural feedback loop connecting the execution layer to the skill definition layer — a meaningful bounded-context crossing.
- **Online distillation after every task**: Rejected. Mid-session churn makes debugging coordination failures harder.
- **Manual skill authoring only**: Current state; identified as the gap this ADR closes.

## References

- Swarm Skills (arXiv:2605.10052): https://arxiv.org/abs/2605.10052
- SWARM+ (arXiv:2603.19431): https://arxiv.org/abs/2603.19431
- Ruflo dream-cycle nightly report: `docs/dream-cycle/dream-gist-2026-07-14.md`
