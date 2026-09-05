# ADR-353: Trace-to-Skill Distillation for Intelligence Pipeline

- **Status**: Proposed
- **Date**: 2026-06-27
- **Authors**: claude (dream-cycle agent, 2026-06-27)
- **Dream Cycle**: intelligence deep-dive, slot 2

---

## Context

Ruflo's intelligence pipeline records agent execution traces via 17 hooks + 12 background workers and stores them in AgentDB / ReasoningBank. However, the pipeline terminates at the recording step — no subsequent compilation converts raw traces into reusable procedural skills.

SKILL-DISCO (Guo, Qi, Gu — arXiv 2026) demonstrates that distilling agent execution traces into compiled procedural skills improves task success by **+22%** on ALFWorld and **statistically significant improvement** on WebArena vs. embedding-only trace storage. The mechanism: traces are chunked into sub-goals, each sub-goal is summarised into a parameterised skill template, and the template library is retrieved by future agents at planning time rather than raw trace replay.

A parallel gap exists in Ruflo's reward model: SONA verdicts use a fixed `success/failure` schema. "The Verification Horizon" (Wang et al., arXiv 2026) demonstrates that fixed rewards become inadequate as base model capability increases — verification must co-evolve with the generator.

## Decision

Add a **skill distillation worker** (`distill-skills`) as the 13th background worker in the hooks system. The worker:

1. Subscribes to `post-task` events where the task outcome was recorded as `success=true`.
2. Passes the execution trace JSON (hook event stream for the task) to a LoRA-fine-tuned summarisation step using the existing SONA neural substrate.
3. Outputs a **procedural skill record** stored in AgentDB under the `skill://` URI prefix:
   ```
   skill://<task-type>/<semantic-slug>/<version>
   ```
4. At agent planning time, the `pre-task` hook queries AgentDB for `skill://` records matching the current task's embedding before falling back to raw ReasoningBank retrieval.

Additionally, introduce a **versioned verdict registry** to address the Verification Horizon gap:

- Add `verdict_schema_version` (integer) to all new ReasoningBank entries.
- A periodic probe task (weekly) runs a CCTU-style constraint set against the current base model; if score improves >5% vs. the previous probe, the schema version increments and a migration backfills recent entries.

## Consequences

**Positive**:
- Aligns with SKILL-DISCO SOTA; expected improvement in agent task success on repeat task classes.
- Skill library is inspectable (stored in AgentDB as structured records) — enables human auditing.
- Versioned rewards future-proof SONA against base model capability drift.

**Negative / Risks**:
- LoRA distillation step adds ~50–200ms latency to `post-task` hook on success path; must be async / non-blocking.
- `skill://` URI namespace requires AgentDB schema migration (add `uri_prefix` column to `vector_indexes`).
- False positives: a successful trace may encode a lucky path, not a generalizable skill; mitigate by requiring ≥3 successful traces before promoting to a skill.

## Implementation Notes

- New file: `v3/@claude-flow/hooks/src/workers/distill-skills.ts` (<500 lines)
- Extend: `v3/@claude-flow/memory/src/agentdb/schema.ts` (add `skill_library` table)
- Extend: `v3/@claude-flow/hooks/src/hooks/post-task.ts` (emit trace payload to worker)
- Extend: `v3/@claude-flow/hooks/src/hooks/pre-task.ts` (query skill library before raw retrieval)
- New test: `tests/hooks/distill-skills.test.ts`

## References

- SKILL-DISCO: "Distilling and Compiling Agent Traces into Reusable Procedural Skills" — Guo, Qi, Gu, arXiv 2026
- The Verification Horizon: "No Silver Bullet for Coding Agent Rewards" — Wang, Zhang, Liu, arXiv 2026
- Dream Cycle issue: #TBD (2026-06-27 intelligence deep-dive)
