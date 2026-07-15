# ADR-179: Dynamic Harness Cost Governor

- **Status**: Proposed
- **Date**: 2026-07-14
- **Deciders**: ruflo core
- **Related**: [ADR-026](../../implementation/adrs/ADR-026-agent-booster-model-routing.md) (3-tier model routing — orthogonal, governs model *choice*), [ADR-143](ADR-143-deterministic-tier1-codemods.md) (tier assignment mechanics), [ADR-174](ADR-174-memory-distillation-self-optimization.md) (distillation substrate + promote-gate discipline the MoE feedback loop reuses), [ADR-176](ADR-176-proven-self-benchmarking-harness-loop.md) (receipt-backed `accept/v1+sig` gate — the promotion pattern this ADR's tunables borrow), [ADR-150](ADR-150-metaharness-integration-surfaces.md) (parallel-logging JSONL pattern reused for cost events), [ADR-320](ADR-320-windows-console-flash-residual-mitigation.md)/[ADR-321](ADR-321-cross-event-foreground-window-snapshot-cache.md)/[ADR-322](ADR-322-daemon-based-state-probing-consolidation.md) (daemon-hosted state consolidation — the ETL/replay workers below piggyback on this infra)
- **Tracking**: [Issue #2641](https://github.com/ruvnet/ruflo/issues/2641)

## Context

arXiv:2607.06906 ("The Harness Effect", Grade A — measured across 6 foundation models) shows that orchestration design — context sizing, turn sequencing, tool batching — reduces cost 41% and latency 44%, *orthogonal to model choice*, with quality improving 0.78→0.81 and every tested model showing 33–61% savings. Ruflo has ADR-026's 3-tier router (deterministic codemod / Haiku / Sonnet-Opus) and ADR-143's routing-tier mechanics, both of which pick the *right model*. Neither applies runtime *token governance* once a model is picked. That is the gap this ADR closes.

Two complementary findings motivate two of the five sub-features below:
- arXiv:2607.07729 (Grade A): heterogeneous agent role configurations (solver+critic+aggregator) yield 2.3x accuracy over homogeneous configurations. Ruflo has 60+ agent types but no gate enforcing role diversity in a swarm.
- arXiv:2604.22452 ("Superminds Test", Grade A): collective intelligence does not emerge from scale alone — shallow interaction (<1 reply depth) is the bottleneck, not agent count. This targets the same shallow-pipeline failure mode that motivates tool-call batching (fewer, richer round-trips vs. many single-shot ones).

Issue #2641's Recommended Action names one module, `v3/@claude-flow/hooks/src/cost-governor.ts`, with five sub-features. This ADR designs that module.

### Why one ADR, not five

All five sub-features share: the same opt-in-by-default-off philosophy, the same `RUFLO_COST_GOV_*` env namespace, and — critically — four of the five *consume or produce* the same `CostEvent` schema (sub-feature 3), so they are not independently deployable without that substrate existing first. None requires a *new* IPC contract the codebase doesn't already have a pattern for: cost events reuse the ADR-150 opt-in-JSONL pattern (`router-parallel-recorder.ts`); the MoE feedback and diversity-gate sub-features reach into other packages (`@claude-flow/neural`, swarm-tools) only as *consumers* of governor-emitted events, via existing daemon/MCP-tool seams — they don't need their own ADR any more than a new AgentDB consumer needs one. Splitting would scatter one coherent cost-story across five documents that all restate the same gating discipline. Kept as a single umbrella ADR; see Alternatives Considered.

## Decision

Build `v3/@claude-flow/hooks/src/cost-governor.ts` (new module, hooks package — matches where the issue places it and where the existing `HookRegistry`/`HookExecutor`/`DaemonManager` tool-call and daemon lifecycle seams already live). All five sub-features are **off by default** — this is a new user-visible cost/latency/behavior lever and defaulting it on would silently change harness behavior.

Common infrastructure:

```typescript
// cost-governor/types.ts
export interface CostEvent {
  v: 1;
  ts: string;                 // ISO-8601
  correlation_id: string;     // ties an event to a turn/task/swarm run
  task_id?: string;
  agent_id?: string;
  session_id: string;
  model: string;               // concrete model id (model-prices.ts key)
  tier: 'codemod' | 'haiku' | 'sonnet-opus';   // ADR-026/143 tier label
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;            // computed via existing costUsd() — model-prices.ts, NOT reinvented
  diversity_score?: number;    // present when swarm diversity gate (sub-feature 5) is active
}

export interface CostGovernorConfig {
  contextTrim: { enabled: boolean; maxTurnAge: number; minRetrievalScore: number };
  toolBatch:   { enabled: boolean; windowMs: number; maxBatchSize: number };
  costEvents:  { enabled: boolean; path: string };
  moeFeedback: { enabled: boolean };
  diversityGate: { enabled: boolean; threshold: number; enforce: 'warn' | 'reject' };
}
```

Master gate: `RUFLO_COST_GOV=1` enables the module at all (still requires each sub-flag); `--cost-governor` CLI flag mirrors it. Every sub-feature additionally requires its own env var / flag — this is deliberate defense-in-depth, not redundant, since a user may want cost *events* without *behavior changes* (trim/batch/gate).

### 1. Context trim

**Trigger point.** No native "turn" boundary hook exists in `HookContext`/`types.ts` today. Decision: reuse the existing `pre-task` hook (fires once per agent task in the current hook lifecycle) as the turn boundary proxy — `cost-governor.ts` registers a `pre-task` handler that increments a per-`session_id` `TurnCounter`, persisted so it survives daemon restarts within a bounded TTL.

**What gets trimmed.** ADR-174 established the invariant that `memory_entries` is never mutated by any learning-loop consumer. This ADR does not touch that invariant: the trim operates **only on the ephemeral candidate set** assembled by `GuidanceProvider`/pattern-search just before it is surfaced into the prompt — i.e., a retrieval-time filter, never a deletion from AgentDB/ReasoningBank storage. MCP tool-call context (the harness's own transcript) is explicitly **out of scope** — that window is owned by Claude Code, not by ruflo.

```typescript
function trimCandidates(candidates: RetrievedCandidate[], turn: number, cfg: ContextTrimConfig) {
  return candidates.filter(c =>
    (turn - c.lastAccessTurn) <= cfg.maxTurnAge || c.retrievalScore >= cfg.minRetrievalScore);
}
```

**Tunables.** `RUFLO_COST_GOV_CONTEXT_TRIM=1`, `RUFLO_COST_GOV_TRIM_MAX_TURN_AGE` (default `3`), `RUFLO_COST_GOV_TRIM_MIN_SCORE` (default `0.4`); CLI `--cost-governor-context-trim`, `--trim-max-turn-age`, `--trim-min-score`.

**Regression risk + gate.** Over-trimming degrades retrieval accuracy. Before this defaults on for any repo, require the exact ADR-174 promotion discipline: measure MRR@10/recall@10 on a held-out query set with trim on vs. off; regression must be ≤ 0.002 (ADR-174's own threshold, reused for methodological consistency, not reinvented). A `metaharness redblue --mock-judge` smoke pass (borrowing the frozen-anchor pattern from ADR-176) is the recommended pre-default-on gate, deferred to phase 2 (see Roadmap).

**Test hooks.** Pure-function unit test on `trimCandidates` (determinism: same input → same output); an integration test asserting `memory_entries`/AgentDB row counts are unchanged after N turns of trimming (mirrors ADR-174's non-mutation acceptance test).

### 2. Tool batching

**"Sequential" defined.** Consecutive tool calls from the **same agent, within the same turn** (turn = the pre-task-hook-scoped boundary above), where calls arrive as separate single-tool messages rather than already-parallel `tool_use` blocks (those are already concurrent — nothing to coalesce). The target failure mode is N back-to-back single-tool round-trips (e.g., five sequential `Read` calls), which is exactly the shallow-interaction pattern arXiv:2604.22452 and the Harness Effect paper both flag.

**Batchable categories.** Read-only, side-effect-free tools only: `Read`, `Grep`, `Glob`, and any MCP tool explicitly tagged read-only in its schema. `Bash` and any mutating tool (`Edit`, `Write`, `NotebookEdit`, MCP write-tools) are **must-fire-immediately** — deferring them risks masking ordering-dependent side effects, which is a correctness hazard batching must never introduce.

**Serialization mechanism.** A **queue + sliding-window flush timer**, not a resetting debounce — a resetting debounce can starve indefinitely under continuous back-to-back calls. The window is anchored to the *first* queued call:

```typescript
// flush when: now - firstQueuedAt >= windowMs, OR queue.length >= maxBatchSize,
// OR a non-batchable call arrives (flush pending batch first, preserve order, then fire immediately)
```

**Ordering guarantee.** Batched calls execute concurrently (`Promise.all`) but return results tagged with original call order/`call_id`, so the harness observes the same ordering it would under strict sequential dispatch — batching is transparent below the governor.

**Enforcement point.** The existing `HookExecutor`/pre-command hook family (tool-call interception already lives here) — no new interception seam needed.

**Tunables.** `RUFLO_COST_GOV_TOOL_BATCH=1`, `RUFLO_COST_GOV_BATCH_WINDOW_MS` (default `500`), `RUFLO_COST_GOV_BATCH_MAX_SIZE` (default `8`); CLI `--cost-governor-tool-batch`.

**Test hooks.** Property test: for any sequence of N batchable calls, batched-execution results equal sequential-execution results (order + content, byte-identical). A test asserting `Bash`/`Edit` are never queued regardless of config.

### 3. Cost tracking (`harness:cost-event`)

**Schema.** `CostEvent` above. **Granularity correction (resolved ambiguity):** the issue's literal "per token" would emit 10k+ events/task — a per-*completion* event carrying `tokens_in`/`tokens_out` counts delivers identical information at 3–4 orders of magnitude fewer events, so one `CostEvent` is emitted per model completion, not per token.

**Publish target.** Reuse the exact `router-parallel-recorder.ts` pattern (ADR-150 Phase 2): opt-in env-gated JSONL append to `.swarm/cost-events.jsonl`, try/caught at the write boundary (never throws, DEBUG-gated stderr log on failure — the routing/execution path continues regardless). A bounded in-memory ring buffer (500 events) additionally backs live statusline/status queries within the current process. Long-term AgentDB persistence (an ETL of the JSONL into a `cost-governor:events` namespace, mirroring ADR-174's `memory_entries`→`episodes` ETL and ADR-322's daemon-hosted consolidation shape) is a **phase 2 daemon worker** (`cost-audit`), not phase 1 — keeps the hot path at $0 default cost.

**Rate limiting.** Per-completion granularity (above) is itself the primary rate limit; additionally cap JSONL rotation the same way `router-parallel-recorder.ts` already does (size-based rename/rotate).

**Tunables.** `RUFLO_COST_GOV_COST_EVENTS=1`, `RUFLO_COST_GOV_EVENT_PATH` (default `.swarm/cost-events.jsonl`); CLI `--cost-governor-events`.

**Test hooks.** Schema validation (zod) test; a test asserting one event per completion regardless of tool-call count within that completion; JSONL append never throws on fs error (mirrors `router-parallel-recorder.test.ts` discipline).

### 4. MoE feedback loop

**"Outcome" defined (resolved ambiguity).** No thumbs-up/user-rating mechanism exists in the harness today, and inventing one would add a sixth ground-truth mechanism where five already exist. Decision: reuse the **same provenance-tier ladder** ADR-171/174 already define — `oracle:test-exec` (test pass/fail) when available, else `proxy:structural` (heuristic — no immediate rollback/no corrective follow-up turn).

**Update path.** Cost-outcome pairs are **queued** (JSONL or a `moe-feedback` table), never direct-written to live gate weights from the hot path — this also keeps `@claude-flow/hooks` from taking a hard runtime dependency on `@claude-flow/neural` (package-boundary discipline). A daemon worker (`moe-feedback-replay`, following the ADR-322 daemon-consolidation shape) periodically replays qualified pairs into `@claude-flow/neural`'s `moe-router.ts` gate-update entry point in batch.

**ADR-174 integration point.** The same qualification gate applies: only `oracle:test-exec`-tier pairs are `promoted` into the gate update; `proxy:structural` pairs are recorded (auditable) but never promoted — enforced in code, mirroring ADR-174's "0 proxy_promoted" invariant exactly.

**Tunables.** `RUFLO_COST_GOV_MOE_FEEDBACK=1`; CLI `--cost-governor-moe-feedback`.

**Test hooks.** Qualification-gate unit test (a proxy-tier pair must never reach a promoted gate update); idempotency test for batched replay (replaying the same batch twice produces no double-counted weight update).

### 5. Swarm diversity gate

**Resolved ambiguity — enforcement point.** `swarm-tools.ts`'s `swarm_init` schema today only carries `topology`/`strategy`, not an agent-type list (confirmed by inspection) — so the gate **cannot** fire at `swarm_init` time as the issue's phrasing implies. Decision: enforce at **agent registration** (each `agent_spawn` call accumulates into a per-swarm roster already tracked in swarm state); `diversity_score` is recomputed on every registration once the roster has ≥3 agents.

**Diversity measure.** `diversity_score = 1 - max_type_share` over the roster's **agent-type distribution** (role heterogeneity — solver/critic/aggregator per arXiv:2607.07729), not model distribution (model choice is already ADR-026's concern — conflating the two would double-govern the same axis).

**Enforcement mode.** Default **warn-only** — a hard reject-by-default could break intentionally-homogeneous swarms (e.g., a pure map-reduce fan-out of identical workers), and this is a brand-new user-visible behavior. Escalation to hard-reject is an explicit opt-in.

**Score surfacing — both, as scoped.** Returned in the `agent_spawn`/`swarm_status` MCP tool response, **and** attached as `diversity_score` on the `CostEvent` for that swarm's `task_id` (queryable alongside spend).

**Tunables.** `RUFLO_COST_GOV_DIVERSITY_GATE=1` (warn-only), `RUFLO_COST_GOV_DIVERSITY_ENFORCE=reject` (opt-in escalation), `RUFLO_COST_GOV_DIVERSITY_THRESHOLD` (default `0.8`, i.e. ≥80% homogeneous triggers); CLI `--cost-governor-diversity-gate`, `--diversity-enforce reject`.

**Test hooks.** Formula test across fixed rosters (all-same-type → 0; N evenly-split types → (N-1)/N); a test asserting warn-only mode never blocks a spawn; a test asserting reject mode blocks the Nth spawn once threshold crosses.

## Consequences

### Positive
- Closes the orchestration-cost gap the Harness Effect paper identifies, orthogonal to and compounding with ADR-026/143's model routing.
- Every sub-feature reuses an existing pattern (ADR-150 JSONL, ADR-174 promote-gate, ADR-322 daemon shape, `model-prices.ts`) rather than inventing new trust/IPC surfaces.
- All-off-by-default means zero blast radius on existing installs until explicitly opted in.
- `CostEvent` gives, for the first time, a queryable per-completion spend/tier/diversity record — the substrate ADR-174-style self-optimization needs to eventually tune routing against real cost outcomes.

### Negative
- Five opt-in flags plus a master gate is real surface area to document and support; users must understand the flag interaction (master gate AND sub-flag).
- Context trim and tool batching both carry real regression risk (retrieval accuracy; tool-call ordering edge cases) that only shows up under load — phase 1 ships the gate machinery, not a proof the defaults are safe to flip on broadly.
- MoE feedback loop adds a cross-package dependency edge (`hooks` → `neural`) even though it's daemon-mediated and batched, not hot-path.

### Neutral
- Diversity gate defaults to warn-only, so it initially changes nothing except visibility — the actual behavior change (reject) is a separate opt-in decision users make later.
- No new signing/attestation surface is introduced — `CostEvent`/`moe-feedback` JSONL are unsigned observability data, not receipts (unlike ADR-176/177's manifest chain).

## Alternatives Considered

- **Five separate ADRs (one per sub-feature).** Rejected: none has an independent IPC contract or invalidation surface the codebase doesn't already have a pattern for (see "Why one ADR" above); would scatter one coherent gating story across five documents.
- **Per-token `CostEvent` emission (literal issue wording).** Rejected: 10k+ events/task event storm for no additional information over per-completion granularity carrying token counts.
- **Diversity gate enforced at `swarm_init`.** Rejected: the current schema has no agent-type list at that call site; enforcing at `agent_spawn`-time registration is the only point with real data.
- **Direct-write MoE gate updates from the cost-tracking hot path.** Rejected: couples `@claude-flow/hooks` to `@claude-flow/neural` at runtime and risks unqualified (proxy-tier) signal corrupting the gate; batched, qualified, daemon-replayed updates match ADR-174's existing discipline.
- **Hard-reject-by-default diversity gate.** Rejected: too aggressive a default behavior change for a first release; warn-only first, opt-in escalation.
- **New user-thumbs-up outcome signal for MoE feedback.** Rejected: adds a sixth ground-truth mechanism where the oracle/proxy ladder (ADR-171/174) already exists and is reused everywhere else.

## Deferred (phase 2, not phase 1)

- AgentDB long-term persistence of cost events (`cost-audit` ETL worker) — phase 1 ships JSONL + ring buffer only.
- Automated `metaharness redblue` regression gate for context-trim retrieval accuracy before recommending default-on — phase 1 ships the manual ADR-174-style held-out measurement path; CI wiring is phase 2.
- None of the five sub-features named in #2641 is dropped; the above are implementation-detail deferrals within sub-features 1 and 3.

## Implementation Roadmap

1. `CostEvent` schema + JSONL emitter (sub-feature 3, foundation for 4/5's surfaced fields) + master/sub env gates.
2. Context trim (sub-feature 1) — filter function + `pre-task` turn counter + tunables.
3. Tool batching (sub-feature 2) — queue/flush + ordering-preserving executor wrapper.
4. Diversity gate (sub-feature 5) — roster tracking at `agent_spawn` + warn-only default.
5. MoE feedback loop (sub-feature 4) — qualified-pair queue + `moe-feedback-replay` daemon worker.
6. Phase 2: `cost-audit` AgentDB ETL worker; redblue regression gate for context trim; diversity-gate reject-mode field trial.

## References

- arXiv:2607.06906 — "The Harness Effect": orchestration design cuts cost 41%, latency 44% across 6 foundation models, orthogonal to model choice. Grade A — measured, cross-model.
- arXiv:2607.07729 — heterogeneous agent configurations (solver+critic+aggregator) yield 2.3x accuracy over homogeneous. Grade A — motivates the diversity gate.
- arXiv:2604.22452 — "Superminds Test": collective intelligence bottleneck is shallow interaction depth, not agent count/scale. Grade A — motivates tool-call batching over naive parallelism.
- Issue #2641 — Dream Cycle 2026-07-12, intelligence deep-dive, Recommended Action.
