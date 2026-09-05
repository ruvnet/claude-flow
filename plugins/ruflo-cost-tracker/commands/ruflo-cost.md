---
name: ruflo-cost
description: Cost tracking operations — generate reports, view breakdowns, set budgets, and get optimization recommendations
---

Cost tracking commands:

**`cost report [--period today|week|month]`** -- Generate a cost report for the specified period.
1. Recall token usage records from `cost-tracking` namespace for the period
2. Compute costs by model using current pricing (haiku/sonnet/opus input/output rates)
3. Aggregate by agent, task, and model
4. Show budget utilization percentage if a budget is configured
5. Display: total cost, breakdown by model, breakdown by agent, budget status

**`cost breakdown [--by agent|model|task]`** -- Detailed cost breakdown by dimension.
1. Recall all usage records from `cost-tracking` namespace
2. Group by the specified dimension (agent, model, or task)
3. For each group: total tokens (input/output/cache), total cost, percentage of total
4. Sort by cost descending
5. Display: dimension value, input tokens, output tokens, cache tokens, total cost, share %

**`cost budget set <amount>`** -- Set a budget limit in USD (real implementation, persisted to `cost-tracking:budget-config`).
1. Run `node plugins/ruflo-cost-tracker/scripts/budget.mjs set <amount>` to write the config to the cost-tracking namespace
2. Thresholds default to: info 50% · warning 75% · critical 90% · hard_stop 100%
3. Report: confirmed amount + namespace key

**`cost budget get`** -- Show the current budget config.
1. Run `node plugins/ruflo-cost-tracker/scripts/budget.mjs get`
2. Report: amount, when set, threshold ladder

**`cost budget check [--period today|week|month|all]`** -- Compute utilization + alert level (50/75/90/100% ladder).
1. Run `node plugins/ruflo-cost-tracker/scripts/budget.mjs check`
2. Filter by `BUDGET_PERIOD=today|week|month|all` (default `all`)
3. Sum `total_cost_usd` across all `session-*` records in cost-tracking
4. Compute utilization vs. budget; emit 🟢 OK / 🟡 INFO / 🟠 WARNING / 🔴 CRITICAL / 🛑 HARD_STOP
5. Exit code 1 on HARD_STOP — wrap agent spawns in `budget check && spawn ...` to fail closed

**`cost optimize`** -- Analyze usage and suggest cost optimizations.
1. Recall recent usage data from `cost-tracking` namespace
2. For each agent, analyze: average task complexity, model used, token efficiency
3. Identify agents using expensive models for low-complexity tasks
4. Check cache hit rates and suggest caching improvements
5. Look for redundant agent spawns or duplicate work
6. Calculate estimated savings for each recommendation
7. Display: recommendation, current cost, projected cost, savings, impact assessment

**`cost track`** -- Auto-capture token usage for the active Claude Code session and persist to the `cost-tracking` namespace. Run after significant work or at session end so `cost report` has real data.
1. Invoke `node plugins/ruflo-cost-tracker/scripts/track.mjs` (no flags = current cwd's most-recent session)
2. Print: total cost, per-model and per-tier breakdown, persisted memory key
3. Sets the `cost-tracking` namespace record at key `session-<sessionId>` (consumed by `cost-report` step 1)

**`cost outcome <task> <model> <outcome>`** -- Emit a `hooks_model-outcome` event so the router learns from applied recommendations. Auto-wired into `cost-optimize` step 8.
1. Validates `outcome ∈ {success, escalated, failure}`
2. Runs `node plugins/ruflo-cost-tracker/scripts/outcome.mjs "<task>" <model> <outcome>`
3. The script wraps `npx @claude-flow/cli hooks model-outcome -t ... -m ... -o ...` with explicit-argv spawnSync so quoting is safe
4. Without this, the router doesn't learn from cost-optimize recommendations and the Tier 1 bypass rate doesn't tighten over time

**`cost summary [--format json|markdown]`** -- Single-shot programmatic dump of all cost data. Other plugins/scripts can shell out and parse the JSON.
1. Run `node plugins/ruflo-cost-tracker/scripts/summary.mjs --format json`
2. Output: total_cost_usd, sessionCount, byTier, byModel, topSession, budget, federation aggregate
3. Default `--format markdown`; JSON contract is stable for programmatic consumers
4. ADR-0002 considered an MCP-tool form but deferred (requires v3 source change); this is the plugin-local equivalent

**`cost federation`** -- Consumer-side wiring for ADR-097 Phase 3 federation_spend events. Aggregates per-peer 1h/24h/7d rolling windows and flags peers exceeding the suspension threshold (default $5/24h).
1. Run `node plugins/ruflo-cost-tracker/scripts/federation.mjs`
2. Optional: `FED_FORMAT=json`, `FED_NAMESPACE=federation-spend`, `FED_SUSPEND_THRESHOLD_USD=5.0`
3. Reports gracefully when no events present (Phase 3 not yet landed upstream)
4. Activates automatically when upstream publishes `{peerId, taskId, tokensUsed, usdSpent, ts}` to the `federation-spend` namespace

**`cost export [--prometheus <path>] [--webhook <url>]`** -- Export cost-tracking telemetry to external observability systems.
1. `--prometheus <path>` writes the node_exporter textfile-collector format (gauges + counters with session labels)
2. `--webhook <url>` POSTs JSON; auth via `EXPORT_WEBHOOK_HEADER='K: V'`
3. No flag → stdout JSON
4. Metrics emitted: `cost_tracker_total_usd`, `cost_tracker_tier_total_usd{tier=...}`, `cost_tracker_session_total_usd{session=...}`, `cost_tracker_session_messages{session=...}`, `cost_tracker_budget_usd`, `cost_tracker_budget_utilization`

**`cost conversation`** -- Per-conversation cost view: list every session in `cost-tracking` with started-at, message count, top model, total cost. Different lens from `cost report` (which is per-agent/per-model).
1. Run `node plugins/ruflo-cost-tracker/scripts/conversation.mjs`
2. Optional `CONV_FORMAT=json`, `CONV_LIMIT=N`, `CONV_NAMESPACE=...`
3. Reports: total across conversations, per-tier rollup, per-session table

**`cost trend`** -- Read all docs/benchmarks/runs/*.json and surface drift in the gate metrics — win rate, avg latency, p99, escalation rate, speedup vs LLM. Flags regressions the binary smoke gate misses.
1. Run `node plugins/ruflo-cost-tracker/scripts/trend.mjs`
2. Optional `TREND_FORMAT=json` for machine-readable output, `TREND_LIMIT=N` to truncate
3. Reports: first→last deltas + per-run series + regression flags (win rate drop or ≥1.5× latency rise)

**`cost projection [--window 7d] [--horizons 7d,30d,90d,365d] [--format table|json]`** -- Forward-looking spend extrapolation. Predictive counterpart to `cost budget check` (reactive).
1. Run `node plugins/ruflo-cost-tracker/scripts/projection.mjs`
2. Compute USD-per-day from sessions in the measurement window (default last 7d)
3. Linear-extrapolate to 7d/30d/90d/365d horizons (configurable via `--horizons`)
4. If `cost budget set` has run: surface "days until 75%/90%/100% consumed" tables
5. JSON output for dashboards / CI gates (e.g. `jq '.budget.exhaustion[2].daysUntilReached < 7'` to fail builds when 100% exhaustion is < 1 week away)
6. Env: `PROJECTION_NAMESPACE`, `PROJECTION_QUIET=1`

**`cost counterfactual [--since 7d] [--baseline always-haiku|always-sonnet|always-opus|all] [--format table|json]`** -- Multi-baseline counterfactual cost analysis. Comparative counterpart to budget-check (reactive) and projection (predictive): answers "is the routing earning its keep?".
1. Run `node plugins/ruflo-cost-tracker/scripts/counterfactual.mjs`
2. Sum tokens across all sessions in window (default all-time)
3. For each baseline tier, compute hypothetical cost if every token had run at that tier's pricing
4. Surface savings $ + % across all three baselines (default `--baseline all`)
5. Negative `always-haiku` savings = over-escalation signal (router picked sonnet/opus when haiku could have done it). Positive `always-sonnet` quantifies the router's win against the "safe default" baseline.
6. JSON output for CI gates: `jq '.baselines[1].savingsPct > 30'` to flag workload shifts where routing isn't saving ≥30% vs sonnet

**`cost burn [--bucket 1d] [--lookback 14d] [--alert-on-acceleration-pct N] [--format table|json]`** -- Burn-rate trend over time with optional drift-alert exit code. Trend counterpart to reactive/predictive/comparative: answers "is daily burn accelerating?".
1. Run `node plugins/ruflo-cost-tracker/scripts/burn.mjs`
2. Bin sessions into `--bucket` duration windows (default 1d) over `--lookback` (default 14d)
3. Compute delta: latest bucket vs mean of prior non-empty buckets
4. With `--alert-on-acceleration-pct N`: exit 1 when latest exceeds prior mean by N%+. Independent of budget — catches "hot loop burning 10× normal" before budget alarm fires
5. Distinct from `cost trend` (which surfaces BENCHMARK drift across `docs/benchmarks/runs/*.json`); this tracks PRODUCTION spend.
6. Edge cases: no prior data → alert SKIPPED (no spurious cold-start alerts). `--bucket` > `--lookback` → exit 2 (config error).

**`cost anomaly [--since 7d] [--threshold 3.5] [--alert-on-outliers N] [--format table|json]`** -- MAD-based outlier detection on session spend. Point-anomaly counterpart to cost-burn's aggregate-trend signal: answers "which specific session is the outlier?".
1. Run `node plugins/ruflo-cost-tracker/scripts/anomaly.mjs`
2. Compute `median(total_cost_usd)` and `MAD = median(|x - median|)` over the filtered window
3. Per-session modified z-score `z = 0.6745 × (x - median) / MAD` (Iglewicz-Hoaglin 1993)
4. Flag sessions with `|z| > --threshold` (default 3.5)
5. With `--alert-on-outliers N`: exit 1 when ≥N outliers found
6. MAD beats mean+sigma because outliers themselves can't inflate it — robust on n=10. Sessions table labels `high` (over-spending) vs `low` (crash/drop) direction.
7. Edge cases: n<3 → "insufficient data" exit 0. MAD=0 (half the sessions share exact spend) → explainer exit 0.

**`cost session [--session-id <id>] [--top 20] [--since <iso-ts>] [--format table|json]`** -- Per-message cost breakdown within ONE session. Drill-down companion to cost-anomaly.
1. Run `node plugins/ruflo-cost-tracker/scripts/session.mjs`
2. Resolves session jsonl via `--session-id` (scans `~/.claude/projects/*/`) or `--latest` (default)
3. Lists top-N most expensive messages with full token breakdown (input / output / cache_write / cache_read)
4. Surfaces p50/p90/p99 message-cost percentiles so operators can judge "is this top message a 2× or 380× outlier?"
5. Flags the top message as in-session outlier when cost > 2× the p99
6. The Cache W column is critical: a 569-token output message at $16 looks insane until you see "881898 cache writes" beside it.

**`cost diff --baseline <path> --current <path> [--alert-on-pct N] [--alert-on-usd N] [--alert-on-class-pct <class>:N[,<class>:N]] [--format table|json]`** -- Snapshot delta between two cost-summary JSON outputs. PR-level regression detection.
1. Run `node plugins/ruflo-cost-tracker/scripts/diff.mjs --baseline <path> --current <path>`
2. Both files must be cost-summary JSON shape (validated: total_cost_usd + sessionCount required)
3. Computes total delta + per-tier + per-model breakdowns; entries tagged added / removed / changed
4. Tables sorted by `|delta|` descending so biggest movers bubble to the top
5. `--alert-on-pct N` exits 1 when total grew >N%; `--alert-on-usd N` exits 1 when total grew >$N; both can be set, first to trigger wins
6. Composes with `cost summary --format json` — the stable JSON contract is the protocol between snapshot capture and snapshot diffing

**`cost health [--alert-acceleration 100] [--alert-outliers 1] [--alert-days-to-exhaust 14] [--skip burn,anomaly] [--format table|json]`** -- Composite CI gate. Runs all four alert ladders (budget / burn / anomaly / projection) in parallel and returns `max(exit_codes)`. One shell-out replaces four separate CI steps.
1. Run `node plugins/ruflo-cost-tracker/scripts/health.mjs`
2. Spawn budget-check, burn, anomaly, projection subchecks via `Promise.all`
3. Each subcheck runs `--format json`; parse exit codes
4. Projection synthesizes exit code from `daysUntilReached[100%] < --alert-days-to-exhaust`
5. Final exit = `max(subcheck exits)` — any failure fails the gate
6. Print one-line summary per check + overall HEALTHY/UNHEALTHY badge
7. `--skip <list>` to disable specific subchecks (e.g. `--skip burn` for fast-feedback smoke runs).

**`cost benchmark [--llm] [--anthropic]`** -- Run the corpus benchmark to verify booster claims with measured numbers.
1. Without flags: booster-only (free, ~85 ms wall-time, no API keys needed)
2. `--llm`: also run Gemini 2.0 Flash baseline (uses GCP `GOOGLE_AI_API_KEY` secret)
3. `--anthropic`: also run Claude Sonnet 4.6 + Opus 4.7 (uses GCP `ANTHROPIC_API_KEY` secret)
4. Writes results to `docs/benchmarks/runs/latest.json` and timestamped sibling
5. Print: win rate (Tier 1 cases), escalation rate (adversarial cases), per-endpoint avg latency, cost/edit, measured speedup
6. Smoke step 23 fails the build if `winRate < 0.80`. See `cost-benchmark` skill for env-var overrides.

**`cost workers`** -- Inspect the `optimize` and `benchmark` background workers consumed from ruflo-loop-workers.
1. Call `mcp__plugin_ruflo-core_ruflo__hooks_worker-status --worker optimize` -- report last-run timestamp, outcome, and any pending recommendations
2. Call `mcp__plugin_ruflo-core_ruflo__hooks_worker-status --worker benchmark` -- report last-run timestamp, outcome, and any pending benchmark deltas
3. Cross-link [ruflo-loop-workers ADR-0001 §"12-worker trigger map"](../../ruflo-loop-workers/docs/adrs/0001-loop-workers-contract.md) — the contract this command honors
4. Display: worker name, status, last-run timestamp, outcome, last-summary

**`cost history`** -- Show cost tracking history over time.
1. Recall all cost reports from `cost-tracking` namespace
2. Show daily/weekly totals with trend direction
3. Highlight days with unusual spending (>2x average)
4. Display: date, total cost, top agent, top model, budget status
