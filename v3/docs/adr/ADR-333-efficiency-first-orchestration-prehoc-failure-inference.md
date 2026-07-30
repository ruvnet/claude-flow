# ADR-333: Efficiency-First Orchestration — Pre-hoc Failure Inference and Adaptive Agent Count Routing

**Status:** Proposed  
**Authors:** claude (dream-cycle agent, 2026-07-30)  
**Date:** 2026-07-30  
**Related issues:** dream-cycle 2026-07-30 (#TBD)  
**Supersedes:** none — extends ADR-026 (3-tier model routing) and ADR-322 (provenance typing)

---

## Context

Two Grade-A papers published July 29, 2026 challenge Ruflo's current swarm-invocation policy:

1. **"Two Calls Beat Five Agents" (arXiv 2607.26922):** On Qwen2.5-7B, 2-call self-refinement achieves 86.2% GSM8K accuracy at **7.4× lower token usage** than a 5-agent pipeline (86.7% accuracy). The accuracy gap is 0.5 pp; the cost gap is 7.4×. For tasks within the capability range of the current model, multi-agent spawning is net-negative on value-per-token.

2. **HalluProp — Pre-hoc Failure Risk Inference (arXiv 2607.26836):** Semantic misalignment between agent roles and tasks causes hallucinations to propagate along agent communication chains. HalluProp's pre-task topology risk analysis achieves 84.6% average AUROC for fault localization at **65× the speed** of post-hoc methods, sub-second per assessment.

Ruflo's CLAUDE.md currently prescribes "AUTO-INVOKE SWARM when task involves 3+ files" and `maxAgents: 8` unconditionally. This policy ignores task-level capability proportionality, leaving 3–7× token efficiency on simple tasks.

ADR-026 added cost-tier routing (deterministic/Haiku/Sonnet). This ADR adds a **pre-tier efficiency gate** that considers whether spawning agents at all is warranted.

---

## Decision

### §1 — Pre-hoc Failure Inference hook in `hooks pre-task`

Before routing to any agent tier, estimate task propagation risk:

- **Input signals:** task description, agent types requested, topology, file count, estimated context size
- **Risk classifier:** lightweight rule-based + embedding similarity check (ported from HalluProp topology analysis)
- **Output:** `{ risk_score: 0.0–1.0, recommendation: "self-refine" | "haiku" | "swarm", reasoning: string }`
- **Threshold:** `risk_score < 0.3` AND `file_count <= 2` → recommend `self-refine`
- **Logging:** all decisions appended to `.swarm/routing-decisions.jsonl` for SONA training input

Implementation target: `v3/@claude-flow/hooks/src/workers/pre-hoc-inference-worker.ts`

### §2 — Efficiency routing mode in `hooks route`

Extend `hooks route` with `--efficiency-mode` flag:

1. Attempt single-model self-refinement (max 2 calls, same model)
2. If self-refinement score (measured by task completion signal) is below threshold, escalate to Haiku (2 agents max)
3. If Haiku multi-agent score is below threshold, escalate to Sonnet swarm

Feature gate: `CLAUDE_FLOW_FEATURE_EFFICIENCY_ROUTING=1`  
Dry-run mode: `--efficiency-dry-run` logs recommendations without applying them.

### §3 — Token-efficiency benchmark in `performance benchmark`

Add `--suite efficiency` to the `performance benchmark` command:

- Metric: **Agents/token-budget** (tasks completed per 10k tokens spent)
- Compares: self-refine path vs 2-agent vs 4-agent vs 8-agent hierarchical
- Integrates with existing AA-AgentPerf gap tracked in ADR-026 (2026-07-25 cycle)
- Runs on every PR touching `hooks/`, `swarm/`, or `@claude-flow/cli/src/commands/`

---

## Consequences

**Positive:**
- 3–7× token reduction on simple tasks (Grade A evidence for 7.4×)
- Sub-second pre-task risk assessment (HalluProp pattern; 65× speedup vs post-hoc)
- SONA neural training gains data from routing decisions (aligns with §8 intelligence pipeline)
- Measurable efficiency metric for CI gating

**Negative / risks:**
- Pre-hoc classifier can miss genuinely complex tasks that look simple (false negative → under-spawn)
- Adds latency to `hooks pre-task` for every invocation (must stay <50ms to not block CLI)
- `CLAUDE_FLOW_FEATURE_EFFICIENCY_ROUTING=1` gate adds configuration surface

**Mitigation:**
- Gate behind env var; off by default for existing users
- Classifier must time-box at 50ms and fall back to current routing on timeout
- Log every recommendation mismatch to `.swarm/routing-decisions.jsonl` for tuning

---

## Alternatives Considered

- **No change:** Acceptable for large-scale complex tasks; inefficient for 60–70% of common single-file/simple-question interactions.
- **Lower `maxAgents` globally:** Blunt; doesn't route by task complexity.
- **Increase self-refinement budget in ADR-026 Tier-2:** Doesn't address pre-task risk or 2-call path for Tier-1 tasks.
