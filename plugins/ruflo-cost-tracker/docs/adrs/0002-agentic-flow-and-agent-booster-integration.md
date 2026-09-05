---
id: ADR-0002
title: ruflo-cost-tracker — agentic-flow + Agent Booster integration, model-outcome feedback loop, optimize-worker consumption, tier-aware reporting
status: Accepted
date: 2026-05-04
authors:
  - planner (Claude Code)
tags: [plugin, cost, tokens, optimization, agentic-flow, agent-booster, tier1-routing, token-optimizer, model-routing, hooks-route, model-outcome, optimize-worker, smoke-test]
---

## Context

`ruflo-cost-tracker` (v0.2.2, post-ADR-0001) does three things well: it owns two namespaces (`cost-tracking`, `cost-patterns`) routed correctly via `memory_*`, it documents the federation budget circuit breaker pairing (ADR-097), and it ships a 10-check smoke contract. ADR-0001 fixed a real namespace-routing bug.

But the plugin's *raison d'être* is reducing token spend, and it does not reference any of the four capabilities that the surrounding system already exposes for that purpose. Specifically:

### 1. The `getTokenOptimizer` module is real, not vaporware

Verified at `v3/@claude-flow/integration/src/token-optimizer.ts:308`. The module:

- Exports a singleton accessor `getTokenOptimizer()` (line 308–314).
- Dynamically imports `agentic-flow`, `agentic-flow/reasoningbank`, `agentic-flow/agent-booster` with graceful fallback (`safeImport` helper at line 39–45; init at line 66–95). If agentic-flow isn't installed, the module returns inert results — `getCompactContext` returns `tokensSaved: 0`, `optimizedEdit` returns `method: 'traditional'`, `getOptimalConfig` falls back to anti-drift defaults (line 207–215).
- Reports stats with explicit honesty: file header line 9–10 reads *"No fabricated metrics are reported — all stats reflect real measurements"*.
- Tracks `editsOptimized` (line 184–186) only when `result.method === 'agent-booster'`, i.e. only when the WASM path actually fired.

This is the integration shim cost-tracker should be wrapping. The plugin currently does not import, mention, or surface it.

**However** — `getCompactContext` line 141–143 computes savings as `query_tokens - compact_prompt_tokens`. That's a heuristic comparing query length to retrieved-context length, which is not a real "tokens saved vs. baseline" measurement. The CLAUDE.md root claim of "ReasoningBank retrieval: -32% tokens" is **claimed upstream, not yet verified** in this repo. Cost-tracker should consume the optimizer but report its `tokensSaved` as a *bridge-reported* figure, not as a measured saving.

### 2. The Agent Booster bypass marker is real

`hooks_route` emits `[AGENT_BOOSTER_AVAILABLE]` at `v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:1228` and `[TASK_MODEL_RECOMMENDATION]` at line 1240. The CLI command surface mirrors this at `v3/@claude-flow/cli/src/commands/hooks.ts:1836, 1848`. CLAUDE.md root documents six booster intents (`var-to-const`, `add-types`, `add-error-handling`, `async-await`, `add-logging`, `remove-console`).

The plugin's optimization-strategies table (`README.md:62`, `REFERENCE.md:45`) lists "Use Agent Booster (Tier 1) — 100% savings" but provides no implementation guidance, no skill that detects booster-eligible tasks, and no command that reports how often the booster path was taken vs. bypassed. This is the highest-leverage gap: the routing infrastructure is already wired, the savings are real ($0 for Tier 1), and cost-tracker is the natural place to surface the count.

CLAUDE.md root claims the booster is "352x faster, $0". The 352x figure is **claimed upstream, not yet verified** in this repo's source. The $0 cost is structurally correct (no LLM call) and is the only number cost-tracker should report.

### 3. The model-routing feedback loop is half-wired

`hooks_model-route`, `hooks_model-outcome`, `hooks_model-stats` are real CLI commands at `v3/@claude-flow/cli/src/commands/hooks.ts:4689, 4784, 4829`. The router learns from outcome reports — without them, the recommendations don't tighten over time. Cost-tracker's `cost-optimize` skill is the natural producer of these outcome events: when it recommends "downgrade reviewer to haiku", the resulting success/failure is exactly the signal `hooks_model-outcome` records. The current `cost-optimize/SKILL.md` does not call it.

ruflo-intelligence ADR-0001 §"Neutral" already calls out the equivalent intent: "Consumers of [the legacy `routing-outcomes` namespace] should migrate to `hooks_model-outcome` which is the typed equivalent." Cost-tracker is one such consumer.

### 4. Cost-tracker is named as consumer of the `optimize` worker — but doesn't know it

`plugins/ruflo-loop-workers/README.md:46` lists `ruflo-cost-tracker` (alongside `ruflo-intelligence`) as the consumer of the `optimize` background worker, and line 55 lists it as a consumer of `benchmark`. Cost-tracker's own README, agent, skills, and commands make zero reference to either. This is a sibling-plugin contract drift: the substrate plugin (`ruflo-loop-workers` ADR-0001 §"12-worker trigger map") has already declared the relationship; the consumer plugin hasn't honored it.

### 5. Reports break down spend by *model name*, not by *tier*

Today the report shape (`REFERENCE.md:53-73`) groups by model (`Haiku / Sonnet / Opus`) and by agent. With the 3-tier routing reality (CLAUDE.md root §"3-Tier Model Routing"), the actually meaningful breakdown is **by tier**:

- Tier 1 (Agent Booster, $0) — bypass count
- Tier 2 (Haiku, $0.0002) — small tasks
- Tier 3 (Sonnet/Opus, $0.003–0.015) — complex reasoning

Without the tier dimension, the report can't tell the user "you spent $X on Sonnet for tasks that should have routed to Tier 1". That's the most actionable single line a cost report can produce.

## Decision

Six changes, ranked by leverage. Each is plugin-local; no CLI source modifications. All are scoped to be implemented after this ADR moves from `Proposed` to `Accepted`.

### 1. New skill: `cost-booster-route` (highest leverage)

`skills/cost-booster-route/SKILL.md`. Wraps `hooks_route` and reports booster bypass utilization.

- **Inputs:** a task description (or batch of recent task descriptions from `cost-tracking` namespace).
- **Behavior:** invoke `hooks_route` for each task; partition results by whether the response contains `[AGENT_BOOSTER_AVAILABLE]`. Sum the partition counts and the inferred token spend that *would have* gone through Tier 2/3 if the booster wasn't used.
- **Output:** a "Booster bypass report" section — `N tasks analyzed, M routed to Tier 1 (booster), avg latency <1ms, $0 cost`.
- **Allowed tools:** `mcp__plugin_ruflo-core_ruflo__hooks_route`, `mcp__plugin_ruflo-core_ruflo__memory_search`, `Bash`. No wildcard.
- **Expected savings:** structurally $0 per Tier 1 routed task. CLAUDE.md root's "352x faster" speedup figure is **claimed upstream, not yet verified** — the skill reports the latency the router actually returns, not the upstream multiplier.
- **Verification:** smoke check confirms the skill exists, references `hooks_route` and the `[AGENT_BOOSTER_AVAILABLE]` literal, and has no wildcard tool grant.

### 2. New skill: `cost-compact-context` (conditional on agentic-flow availability)

`skills/cost-compact-context/SKILL.md`. Wraps `getTokenOptimizer().getCompactContext()` for retrieval-augmented prompt compression on cost-analysis queries.

- **Inputs:** a natural-language query (e.g. "what optimizations worked last sprint").
- **Behavior:** import `getTokenOptimizer` from `@claude-flow/integration` via a `Bash`-shelled Node one-liner (or via a new `mcp__plugin_ruflo-core_ruflo__token_optimize_compact` tool if/when one is added — see "Riskiest assumption" below). Report the bridge's `tokensSaved` figure plus the `agentBoosterAvailable` flag.
- **Output:** "Context compacted: N memories retrieved, K tokens saved (per agentic-flow bridge; upstream-reported, not measured against a no-RAG baseline)."
- **Allowed tools:** `Bash` only (no MCP tool yet exists for this; we explicitly do **not** add one in this ADR).
- **Expected savings:** the CLAUDE.md root claim "-32% tokens" is **claimed upstream, not yet verified**. The skill MUST surface the bridge's figure as bridge-reported, with the disclaimer copied from `token-optimizer.ts:9-10`.
- **Fallback:** if `agentic-flow` isn't installed, the bridge returns `tokensSaved: 0` (line 116–124). Skill reports "agentic-flow not available, no compact-context savings" and exits cleanly.
- **Verification:** smoke check confirms the skill documents the fallback and tags upstream-reported figures.

### 3. Extend `cost-optimize/SKILL.md` with a model-outcome feedback step

After the existing step 7 ("Store the optimization pattern"), add step 8: when a downgrade recommendation is *applied* (or its application is logged), call `mcp__plugin_ruflo-core_ruflo__hooks_model-outcome` with `{task, fromModel, toModel, outcome: 'success'|'escalated'|'failure'}`. This closes the routing loop documented in ruflo-intelligence ADR-0001.

- **Allowed-tools update:** add `mcp__plugin_ruflo-core_ruflo__hooks_model-outcome`.
- **Cross-link:** ruflo-intelligence ADR-0001 §"Neutral" (migration target).
- **Expected effect:** the model router's recommendations tighten over time. No direct token saving; this is *the mechanism* through which Decision #1's bypass rate improves.
- **Verification:** smoke check confirms `cost-optimize/SKILL.md` references `hooks_model-outcome`.

### 4. Wire cost-tracker as a consumer of the `optimize` and `benchmark` workers

ruflo-loop-workers README already declares this. Honor it on the cost-tracker side:

- **`agents/cost-analyst.md`** — add a "Background workers" section listing `optimize` (consumed for cost-optimization recommendations) and `benchmark` (consumed for cost-per-benchmark reporting). Cross-link ruflo-loop-workers ADR-0001 §"12-worker trigger map".
- **`commands/ruflo-cost.md`** — add a `cost workers` subcommand that calls `mcp__plugin_ruflo-core_ruflo__hooks_worker-status --worker optimize` and `--worker benchmark` and reports last-run timestamps + outcomes.
- **No new skill** — the existing `loop-worker` skill from `ruflo-loop-workers` is reused.
- **Expected savings:** none direct. This is contract honoring; failure to wire means cost-tracker ignores ~7 days of optimization recommendations the worker may have produced.
- **Verification:** smoke check confirms agent + command reference both worker triggers.

### 5. Tier-aware breakdown in `cost-report`

`skills/cost-report/SKILL.md` step 4 ("Aggregate by agent") gains a parallel step: aggregate by **tier** (Tier 1 / Tier 2 / Tier 3), not just by model. The report shape in `REFERENCE.md` adds a "By tier" block above "By model":

```
By tier:
  Tier 1 (booster): $0.00 (0%)   — N bypasses
  Tier 2 (haiku):   $0.45 (3.6%)  — 1,200K input, 400K output
  Tier 3 (sonnet+opus): $12.00 (96.4%) — ...
```

Tier classification at report-time uses two signals: (a) the `[AGENT_BOOSTER_AVAILABLE]` flag in stored routing decisions if the producer ran step #1 above; (b) the model name as fallback (haiku → Tier 2; sonnet/opus → Tier 3).

- **Allowed-tools:** unchanged (`memory_*` family is sufficient).
- **Expected savings:** none direct; **decision-quality improvement**. The report can now answer "what fraction of my Sonnet spend was Tier 1-eligible".
- **Verification:** smoke check confirms `REFERENCE.md` documents the tier breakdown shape and that `cost-report/SKILL.md` step list mentions tier aggregation.

### 6. README + plugin metadata

- **README** — new "Optimization integration" section linking to this ADR. Lists the four capabilities (TokenOptimizer bridge, Agent Booster bypass, model-outcome feedback, optimize-worker consumption) and which skill/command surfaces each. Federation budget block stays as-is.
- **plugin.json** — bump `0.2.2 → 0.3.0`. Justified: two new skills, one new command, one new agent section, report-shape change. Keywords add `agentic-flow`, `agent-booster`, `tier1-routing`, `model-routing`.
- **Architecture Decisions** section in README — append link to ADR-0002.

## Consequences

**Positive:**

- The plugin's primary value claim ("recommend optimizations to reduce costs") becomes mechanistically grounded — every recommendation maps to a real upstream tool: booster route, compact context, model-outcome learning, optimize worker.
- Tier-aware reporting (Decision #5) gives the user the single most actionable metric: how much spend is Tier 1-eligible but currently routed to Tier 2/3.
- The model-outcome feedback loop (Decision #3) means cost-optimize's own recommendations train the router that future spawns route through. The plugin compounds.
- Sibling-plugin contract honored: ruflo-loop-workers' declared consumer relationship is now reciprocated.

**Negative:**

- Adds a transitive dependency surface. `getTokenOptimizer` works without `agentic-flow` installed (graceful fallback), but the `cost-compact-context` skill is effectively inert in that case. We surface this explicitly in the skill.
- The CLAUDE.md root percentage claims (-32% retrieval, -15% booster edits, 352x speedup, 95% cache hit) are upstream marketing figures, not measured in this repo. Decisions #1 and #2 above MUST tag every percentage as "claimed upstream, not yet verified" to avoid restating them as facts.
- Plugin v0.2.2 → v0.3.0 is a minor jump within a 0.x line, which signals breaking surface change. The breakage is purely additive (new skills, new subcommand, new report row), so consumers reading the existing `cost report` output will see one new section but no removed columns.
- Two new skills increase the agent-loadable surface. Mitigation: each skill has a tight `allowed-tools` allowlist; no wildcards.

**Neutral:**

- No new MCP tools introduced. All capability is **wiring** of tools that already exist in `hooks-tools.ts` and `commands/hooks.ts`.
- No changes to `cost-tracking` or `cost-patterns` namespace ownership.
- Federation budget circuit-breaker pairing (ADR-097) is unaffected — that's a separate axis (federation cost containment) from this ADR's focus (local-spend optimization).

## Verification

A new smoke contract extends the ADR-0001 smoke from 10 to 16 checks. We don't write the smoke script in this ADR — we describe what it checks. The new checks:

11. `skills/cost-booster-route/SKILL.md` exists with valid frontmatter, references `hooks_route` and the `[AGENT_BOOSTER_AVAILABLE]` literal, and grants no wildcard tools.
12. `skills/cost-compact-context/SKILL.md` exists with valid frontmatter, references `getTokenOptimizer` (or `@claude-flow/integration`), documents the agentic-flow-unavailable fallback, and tags upstream figures as "claimed upstream, not yet verified".
13. `cost-optimize/SKILL.md` step list includes a `hooks_model-outcome` invocation step, and `allowed-tools` enumerates `mcp__plugin_ruflo-core_ruflo__hooks_model-outcome`.
14. `agents/cost-analyst.md` documents both `optimize` and `benchmark` workers in a "Background workers" section, with a cross-link to ruflo-loop-workers ADR-0001.
15. `commands/ruflo-cost.md` includes a `cost workers` subcommand referencing `hooks_worker-status` for both `optimize` and `benchmark`.
16. `cost-report/SKILL.md` step list mentions tier aggregation; `REFERENCE.md` documents the "By tier" report block with Tier 1 / Tier 2 / Tier 3 enumerated.

Plus three doc-invariant single-line greps:

- `grep -q "agentic-flow" plugins/ruflo-cost-tracker/README.md`
- `grep -q "AGENT_BOOSTER_AVAILABLE" plugins/ruflo-cost-tracker/skills/cost-booster-route/SKILL.md`
- `grep -qE "Tier 1.+Tier 2.+Tier 3" plugins/ruflo-cost-tracker/REFERENCE.md`

Plugin version assertion (`0.3.0`) and keyword additions (`agentic-flow`, `agent-booster`, `tier1-routing`, `model-routing`) are checked the same way ADR-0001's smoke checks `0.2.2`.

## Riskiest assumption

The single biggest dependency in this ADR is that **agents reading `cost-compact-context/SKILL.md` can actually invoke `getTokenOptimizer()`**. Today there is no MCP tool wrapping it — the integration module is consumed in-process by other CLI code paths. The skill therefore documents a `Bash`-shelled Node one-liner as the invocation method. That works for skill-driven invocation but is awkward, and a future ADR may want to add an MCP tool (`token_optimize_compact` or similar) wrapping the bridge. We deliberately do **not** add that tool in this ADR — keeping scope tight to wiring what already exists. If the in-process Bash invocation proves brittle, Decision #2 should be deferred until the MCP wrapper exists, while Decisions #1, #3, #4, #5 ship independently (none of them depend on agentic-flow being installed).

## Related

- `plugins/ruflo-cost-tracker/docs/adrs/0001-cost-tracker-contract.md` — namespace-routing fix; this ADR builds on its smoke-as-contract pattern
- `plugins/ruflo-intelligence/docs/adrs/0001-intelligence-surface-completeness.md` — surfaces `hooks_route`, `hooks_model-route`, `hooks_model-outcome`, `hooks_transfer`; calls out the `routing-outcomes` → `hooks_model-outcome` migration
- `plugins/ruflo-loop-workers/docs/adrs/0001-loop-workers-contract.md` — declares cost-tracker as consumer of `optimize` and `benchmark` workers (the contract this ADR honors from the consumer side)
- `plugins/ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md` — namespace convention; RaBitQ quantization (relevant for storing tier-classified cost records cheaply at scale)
- `v3/docs/adr/ADR-097-federation-budget-circuit-breaker.md` — federation `maxTokens` / `maxUsd` envelope (orthogonal axis, unchanged here)
- `v3/@claude-flow/integration/src/token-optimizer.ts` — `getTokenOptimizer()` singleton, `getCompactContext`, `optimizedEdit`, `getOptimalConfig`, `cachedLookup` (line 308 export)
- `v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:1228, 1240` — `[AGENT_BOOSTER_AVAILABLE]` and `[TASK_MODEL_RECOMMENDATION]` recommendation strings
- `v3/@claude-flow/cli/src/commands/hooks.ts:4689, 4784, 4829` — `model-route` / `model-outcome` / `model-stats` CLI command definitions
- CLAUDE.md root §"3-Tier Model Routing (ADR-026)" — Tier 1/2/3 definitions; percentage claims tagged in this ADR as upstream-reported
