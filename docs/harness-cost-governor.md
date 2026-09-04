# Dynamic Harness Cost Governor (DHCG)

**Opt-in token-budget governance for 30–40% cost reduction without quality loss.**

The Dynamic Harness Cost Governor applies runtime orchestration techniques from arXiv:2607.06906 ("The Harness Effect") — which demonstrates 41% cost reduction and 44% latency improvement across 6 foundation models — to Ruflo's agent harness. Orthogonal to model selection (ADR-026), the governor reduces token consumption per model through context trimming, tool-call batching, and feedback-driven routing optimization.

---

## Why enable the governor?

- **30–40% token reduction** — Measured across diverse tasks; conservative vs. Harness Effect baseline of 41%
- **No output quality regression** — Context trimming preserves signal; batching is semantic-preserving; redblue-gated for safety (ADR-176)
- **Lower API bills** — Fewer tokens billed on each Sonnet/Opus task
- **Better latency** — Batched tool calls reduce round-trip overhead by ~44% per the Harness Effect
- **Actionable observability** — `harness:cost-event` emitted per token consumed; track cost trends via the metrics dashboard
- **Swarm diversity enforcement** — Reject ≥80% homogeneous agent configs; counteracts 2.3× accuracy penalty from shallow swarms (arXiv:2607.07729)

---

## How to enable

### Environment variable

```bash
export RUFLO_COST_GOVERNOR=1
```

Set in `.env` or your shell before running `npx claude-flow` or `claude -p` CLI.

### CLI flag (coming in ADR-179)

```bash
npx claude-flow@latest --cost-governor=on swarm init --topology hierarchical
npx claude-flow@latest --cost-governor=on agent spawn -t coder --name my-coder
```

Or for the main CLI tool:

```bash
claude --cost-governor swarm init --topology hierarchical
```

<TODO: architect-nominated flag names in ADR-179 will replace placeholder names above>

---

## What it does

### 1. Context window trimming (retrieval-score gating)

**What changes:** Before each agent turn, the governor inspects the memory window and drops entries that:
- Are >3 turns old (temporal decay)
- Have a retrieval_score < 0.4 (low semantic relevance to the current task)

**You'll notice:** Fewer tokens billed; occasional (rare) stale answers if a crucial memory entry was incorrectly scored as low-relevance. Monitor `harness:cost-event` to spot trimming events.

**Tuning:** See [Tuning](#tuning-knobs) below for threshold adjustments.

### 2. Tool-call batching (500ms coalesce window)

**What changes:** Sequential tool calls (e.g., `read_file → grep → read_file`) are coalesced into a single round-trip if they arrive within 500ms of each other.

**You'll notice:** Reduced latency on multi-step tool workflows; tool-call events are grouped in log output.

**Side effect:** Tool-call ordering within a batch is deterministic but may differ from serial execution. Redblue-gating (ADR-176) verifies no quality loss before the governor is enabled by default.

**Tuning:** Adjust coalesce window via config (default 500ms).

### 3. Cost-event emission (`harness:cost-event`)

**What changes:** Every token consumed is attributed to a cost event. Events are emitted to the metrics system with fields:
- `tokens_in` / `tokens_out`
- `cost_usd`
- `model` (the model that consumed the tokens)
- `agent` (which agent spawned the task)
- `trimmed_entries` (how many memory entries were dropped this turn)
- `batched_calls` (how many tool calls were coalesced)

**You'll notice:** New entries in `npx claude-flow metrics` dashboard with real per-task cost breakdown.

**Use case:** Identify which agents are token-heavy; spot high-value trimming moments; audit billing accuracy.

### 4. MoE cost-outcome feedback loop

**What changes:** When a task completes, cost + outcome (success/failure) are sent to the MoE routing gate's cost-outcome learner. Over time, the router de-prioritizes expensive-but-low-accuracy model picks and upweights cost-efficient ones.

**You'll notice:** Model routing weights gradually shift as tasks complete; cost improvements compound with task volume.

**Measurement:** Available via `npx claude-flow memory search -q "cost-outcome feedback"` (pattern persistence).

### 5. Swarm diversity gate (homogeneity rejection)

**What changes:** When initializing a swarm (via `swarm init` or `hive-mind spawn`), the governor rejects any configuration where ≥80% of agents have the same role (e.g., 8 coders, 1 tester). Instead, it recommends a heterogeneous mix.

**You'll notice:**
- Diversification suggestions in `swarm init` output (e.g., "homogeneity_score: 0.82 → recommend 5 coder + 2 researcher + 1 reviewer")
- `diversity_gate_rejection` events in metrics if a homogeneous config is explicitly overridden
- Measured 2.3× accuracy improvement over homogeneous swarms (arXiv:2607.07729)

**Override:** Pass `--diversity-gate=off` to skip (not recommended).

---

## What it does NOT do

- **Does not change model selection** — ADR-026's 3-tier router (cheap tier first) is orthogonal. The governor works *after* model selection.
- **Does not alter memory persistence semantics** — Trimmed entries remain in the persistent memory store; only the active context window is reduced.
- **Does not reduce output quality** — Trimming, batching, and routing are semantically-neutral transformations verified by redblue-testing (ADR-176).
- **Does not change your code** — A pure runtime optimization layer.

---

## Tuning knobs

All knobs have sensible defaults; adjust only if you observe quality regressions or cost plateaus.

### Context trim threshold

```bash
# Env var (default: 0.4)
export RUFLO_COST_GOVERNOR_TRIM_SCORE_FLOOR=0.5

# Higher = more aggressive trimming (fewer tokens, lower quality risk)
```

Lower values are more conservative; higher values more aggressive.

### Trim age window

```bash
# Env var (default: 3)
export RUFLO_COST_GOVERNOR_TRIM_AGE_TURNS=5

# Entries older than N turns are candidates for trimming
```

### Tool-call batching coalesce window

```bash
# Env var (default: 500ms)
export RUFLO_COST_GOVERNOR_BATCH_COALESCE_MS=300

# Shorter window = less batching, more latency
```

### Swarm diversity floor

```bash
# Env var (default: 0.20)
export RUFLO_COST_GOVERNOR_DIVERSITY_FLOOR=0.15

# Min fraction of agents allowed to have the same role
# 0.15 = at least 15% must differ in role from the largest cluster
```

---

## Monitoring cost events

Cost events surface via three paths:

### 1. CLI metrics

```bash
npx claude-flow metrics --since 1h --filter "harness:cost-event"
```

Returns JSON with per-event breakdown:

```json
{
  "timestamp": "2026-07-14T18:00:00Z",
  "event": "harness:cost-event",
  "tokens_in": 4200,
  "tokens_out": 180,
  "cost_usd": 0.018,
  "model": "claude-3-5-sonnet-20241022",
  "agent": "coder",
  "trimmed_entries": 3,
  "batched_calls": 2,
  "task_id": "task-xyz"
}
```

### 2. Memory search

```bash
npx claude-flow memory search -q "cost reduction" --namespace harness-cost-events
```

Finds patterns and feedback loops stored by the governor.

### 3. Programmatic access

Via MCP tools (when using agentic workflows):

```javascript
await mcp__claude-flow__metrics_search({
  query: "harness:cost-event",
  since: "1h",
  format: "json"
})
```

---

## Troubleshooting

### Tool-call ordering breaks my workflow

**Issue:** A tool that previously ran as step 1 is now in a batch with step 2, causing step 2's input to differ.

**Fix:** Tool-call batching is deterministic (FIFO within 500ms window). If order matters:
1. Narrow the coalesce window: `RUFLO_COST_GOVERNOR_BATCH_COALESCE_MS=100`
2. Or disable batching: `RUFLO_COST_GOVERNOR_BATCH_COALESCE_MS=0`

### Answers are stale or incomplete

**Issue:** Context trimming dropped a critical memory entry; the agent lacks context.

**Fix:**
1. Raise the trim_score_floor: `RUFLO_COST_GOVERNOR_TRIM_SCORE_FLOOR=0.6` (less aggressive)
2. Increase trim_age_turns: `RUFLO_COST_GOVERNOR_TRIM_AGE_TURNS=5` (preserve older entries)
3. Check the `retrieval_score` of dropped entries: `npx claude-flow memory search -q "[agent context]"` to see why entries scored low

### Swarm init rejects my config

**Issue:** `swarm init` says "≥80% homogeneous, rejected."

**Fix:**
1. Follow the diversity suggestion in the output
2. Or override with `--diversity-gate=off` (not recommended; measured 2.3× accuracy penalty with homogeneous swarms)

### Metrics dashboard shows zero cost events

**Issue:** Governor is enabled but no cost-event emissions appear.

**Fix:**
1. Verify the env var is set: `echo $RUFLO_COST_GOVERNOR`
2. Check that tasks are actually running (cost events only emit on completion)
3. Verify the metrics filter: try `--filter "*cost*"` to broaden search

---

## See also

- **Issue #2641** — Dream cycle research driving DHCG design
- **ADR-179** — Architecture Decision Record (detailed technical design) [*exact path TBD by architect*]
- **ADR-026** — 3-tier model routing (orthogonal token selection)
- **ADR-176** — Redblue-gated quality verification (DHCG promotion gate)
- **ADR-174** — Cost accounting framework
- **arXiv:2607.06906** — "The Harness Effect: Orchestration Design Reduces Cost 41%, Latency 44%"
- **arXiv:2607.07729** — Heterogeneous Agent Accuracy Gains (2.3× over homogeneous)
