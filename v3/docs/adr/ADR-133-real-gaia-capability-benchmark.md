# ADR-133 — Real GAIA Capability Benchmark Architecture

**Status**: Partially Implemented (vanilla harness shipped; ruflo-intelligence integration deferred to ADR-134)
**Date**: 2026-05-27 (proposed); **Updated**: 2026-05-27 (post-implementation amendment after 24-iter /loop pursuit)
**Authors**: claude (capability-bench follow-up, 2026-05-27)
**Related**: ADR-088 (LongMemEval Benchmark), ADR-132 (Simulative Planning Router, acceptance gate measured −78.2%), ADR-026 (3-tier model routing), #2156 (Dream Cycle 2026-05-27 capabilities scan), ADR-134 (planned: ruflo-native GAIA agent integration)

---

## Implementation Status (2026-05-27, post-/loop)

After ~24 iterations of a 5-minute /loop driven by horizon-tracker, the architecture proposed below is **substantially implemented** with the following deviations from the original 7-PR roadmap:

| Original PR | Status | Actual delivery |
|---|---|---|
| PR1 — `gaia-loader.ts` + `HF_TOKEN` | ✅ Shipped (iter 1) | Commit `189f9020e` in PR #2165 |
| PR2 — `gaia-tools/` skeleton | ✅ Shipped (iter 2) | Commit `6b48a9491` in PR #2165 |
| PR3 — `gaia-agent.ts` multi-turn loop | ✅ Shipped (iter 4) | Commit `0d9c64f64` in PR #2165 |
| PR4 — `python_exec` sandbox | ✅ Shipped (iter 19) | PR #2169 — **local Python subprocess** (Path B; E2B not available, security disclosure included) |
| PR5 — `web_browse` + `image_describe` | ✅ Shipped (iter 20) | PR #2170 — Playwright **lazy-loaded** via string-concat to avoid 80MB install in base path; vision via Anthropic Messages API |
| PR6 — `gaia-judge.ts` LLM-as-judge | ✅ Shipped (iter 5) | Commit `a5d86df50` in PR #2165, plus iter 15 judge-normalization fix + iter 11 unit-aware comparison |
| PR7 — CI wiring | ✅ Shipped (iter 6) | PR #2166 — `gaia-benchmark.yml` + smoke |

Plus follow-up PRs discovered during the SOTA-pursuit phase:
- **PR #2171** (iter 21) — `web_search` 3-backend fallback (Wikipedia primary, Brave secondary, DDG tertiary). The original DDG-only scraper was 100% TCP-blocked from the dev env; iter 15's baseline was measured with effectively zero web search.
- **PR #2172** (iter 22) — Agent loop quality: empty-tool-result hint injection, multi-pattern answer extraction (4-pattern cascade), anti-surrender system prompt, tool error recovery hints. Original loop had a single `FINAL_ANSWER:` regex.
- **gaia-bench CLI entry** (iter 4 follow-up + iter 12 schema fix) — `commands/gaia-bench.ts` matching PR7's locked workflow contract; loader truncation bug fixed to recover all 53 L1 questions from `2023_level1` config (was truncating to 30 via `length=100` on `2023_all`).

### Measured Baseline (iter 15, pre-SOTA-pursuit)

First real GAIA Level-1 measurement against the actual Hugging Face validation split (53 questions):

| Model | Pass Rate | Cost | Mean Turns | vs HAL Sonnet 4.5 (74.6% full L1) |
|---|---|---|---|---|
| claude-haiku-4-5 | 8/53 (15.1%) | $0.07 | 3.0 | — |
| claude-sonnet-4-6 | 5/53 (9.4%) | $1.27 | 4.4 | −65pp |

**Honest caveat**: this baseline was measured with `web_search` returning 100% timeouts (Case D / TCP block discovered in iter 21). Effectively measures "Sonnet 4.6 alone with file_read only" — not the intended harness configuration. Failure decomposition: Sonnet 79% null returns, Haiku 38% "I don't know" — both driven primarily by the broken search tool.

### Consolidated Measurement (iter 23, post-SOTA-pursuit)

After PR4+PR5+PR #2171+PR #2172 cherry-picked into meta-branch `bench/adr-133-sota-meta` (in flight as of this ADR amendment). Result will be backfilled into a follow-up update once iter 23 posts its headline numbers to PR #2165.

---

## Known Limitation: Ruflo Intelligence Integration Gap

**The current GAIA harness uses ruflo's CLI infrastructure but does NOT use ruflo's intelligence stack inside the agent loop.** `gaia-agent.ts` calls `https://api.anthropic.com/v1/messages` directly via raw `fetch`. It exercises:

✅ AgentDB / HNSW (via `findSimilarPatterns` in `--suite agent`, not in the GAIA loop)
✅ SONA short-term recording (same — control plane only)
✅ Q-Learning router (same — control plane only)
✅ horizon-tracker memory (this loop's iteration checkpoints)

❌ ADR-132 SimulativePlanningRouter (built, measured at −78.2% token reduction, but not wired into `gaia-agent.ts`)
❌ ADR-026 3-tier model routing (GAIA explicitly picks Haiku/Sonnet via flags)
❌ SONA pattern learning across GAIA runs (failures aren't distilled into avoidance patterns)
❌ Pre-task / post-task / route hooks (loop doesn't fire them)
❌ 4-step intelligence pipeline (RETRIEVE→JUDGE→DISTILL→CONSOLIDATE) — judge is in-loop but no consolidation across runs
❌ `agentic-flow` swarm coordination — single-agent harness
❌ MoE expert routing, Hive-mind, EWC++ — all unused

What we built is **a GAIA harness IN ruflo, not OF ruflo**. The 9.4% Sonnet baseline (and forthcoming iter-23 consolidated number) measures "what raw Sonnet 4.6 + N tools + decent agent loop can do" — not "what ruflo's intelligence stack can do for an agent."

### Path Forward: ADR-134 (planned)

To legitimately leverage ruflo's intelligence stack, file **ADR-134 — Ruflo-Native GAIA Agent: Intelligence Stack Integration**. Estimated integrations and lift:

| Integration | Estimated L1 lift | Effort |
|---|---|---|
| Wire ADR-132 SimulativePlanningRouter into agent loop | +3-8pp (token efficiency + multi-step planning) | 1 day |
| SONA pattern learning across GAIA runs (store successful trajectories, retrieve for similar questions) | +5-10pp (compound across runs) | 1-2 days |
| Hook integration (pre-task evaluates question, route picks tools, post-task records outcome) | +5-15pp | 2-3 days |
| `agentic-flow` swarm coordination on hard questions | +10-20pp (research territory) | 3-5 days |

This integration track is **the honest path to differentiated SOTA** — not "we have an OK agent harness" but "ruflo's intelligence stack measurably moves the needle on agent benchmarks."

---

## Context

The Dream Cycle 2026-05-27 capabilities scan (#2156) flagged that ruflo had no agent capability regression detection. The current `performance capability` subcommand (shipped in PR #2163) closes the immediate gap with a **text-only verifiable-answer fixture** — 17 questions, scoreable via exact/substring/regex match, $0.06 per Haiku+Sonnet run, no external dataset required.

That subcommand is honestly named "GAIA-lite" in the code comments. It is **not** the GAIA benchmark. The real GAIA benchmark (arXiv:2311.12983) tests:

- **Tool use**: web browsing, code execution, file inspection
- **Multimodal input**: images, audio, PDFs, spreadsheets as task attachments
- **Long-horizon reasoning**: 3-5+ tool-use turns per question
- **Open-ended answers**: scored by an LLM-as-judge, not exact-match

GAIA Level 1 (the easiest tier) reports human performance at ~92%, current best agents (GAIA Princeton HAL leaderboard) at ~74% for Claude Sonnet 4.5. The ~18pp gap is *the* metric the agent-research community uses to track autonomous-agent progress. Ruflo currently has no measured GAIA score.

This ADR proposes the architecture for adding a real GAIA capability benchmark. **It does not propose implementing it in a single PR** — the work is estimated at 5-10 engineering days and should be scoped as its own multi-PR effort.

---

## Decision

Add a new opt-in subcommand: `performance capability-gaia`.

Architectural layers:

```
┌─────────────────────────────────────────────────────────────┐
│ performance capability-gaia (CLI entry)                     │
│   ├─ flags: --level, --limit, --models, --concurrency       │
│   └─ env:   HF_TOKEN, ANTHROPIC_API_KEY                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Dataset      │ │ Agent Loop   │ │ Judge        │
│ Loader       │ │              │ │              │
│              │ │              │ │              │
│ HF datasets  │ │ Tool-use     │ │ LLM-as-judge │
│ checkout +   │ │ orchestrator │ │ (Sonnet) +   │
│ attachment   │ │ over Claude  │ │ exact-match  │
│ resolution   │ │ Messages API │ │ fast path    │
└──────────────┘ └──────┬───────┘ └──────────────┘
                        │
            ┌───────────┼───────────┬────────────┐
            ▼           ▼           ▼            ▼
       ┌────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐
       │ web    │ │ python  │ │ file    │ │ image    │
       │ search │ │ exec    │ │ reader  │ │ vision   │
       │ tool   │ │ tool    │ │ tool    │ │ tool     │
       └────────┘ └─────────┘ └─────────┘ └──────────┘
```

### 1. Dataset Loader (`v3/@claude-flow/cli/src/benchmarks/gaia-loader.ts`)

- Authenticates to Hugging Face via `HF_TOKEN` env var (gcloud secret fallback per the ADR-088 pattern)
- Downloads the `gaia-benchmark/GAIA` validation split (300 questions across Levels 1/2/3)
- Caches under `~/.cache/ruflo/gaia/` keyed by HF dataset revision
- Resolves attachments (file_name field) to absolute paths in the cache
- Exposes `loadGaia({ level: 1|2|3, limit?: number }): Question[]` API

**Why not bundle the dataset?** GAIA is ~150MB with attachments, has a research-only license, and updates over time. Bundling would violate the license and lock us to a single dataset revision.

### 2. Tool Implementations (`v3/@claude-flow/cli/src/benchmarks/gaia-tools/`)

Each tool implements the Anthropic tool-use spec (`tool_use` content blocks):

| Tool | Purpose | Implementation |
|---|---|---|
| `web_search` | Query the web for facts | DuckDuckGo HTML scrape or Brave Search API (no key required) |
| `web_browse` | Open + extract page content | `playwright` headless Chromium with text-only mode; reuse `ruflo-browser` patterns |
| `python_exec` | Run Python in a sandbox | E2B sandbox or local `python -c` with timeout. Existing `flow-nexus-sandbox` plugin already has this primitive |
| `file_read` | Read an attachment (csv, json, txt, pdf) | Local fs read + content-type sniff. PDF via `pdfjs-dist`. |
| `image_describe` | Describe an image attachment | Anthropic Messages API with `image` content block — uses same model that's solving the question |
| `audio_transcribe` | Transcribe an audio attachment | Anthropic doesn't ship Whisper; either skip audio questions or use Groq/OpenAI Whisper (separate budget) |

**Sandbox containment**: `python_exec` is the highest-risk tool. Must run inside an E2B sandbox (existing flow-nexus integration) or a Docker container — never on the bench runner's host filesystem.

### 3. Agent Loop (`v3/@claude-flow/cli/src/benchmarks/gaia-agent.ts`)

Multi-turn message exchange with Claude:

```typescript
async function runOneGaia(q: Question, model: string): Promise<GaiaResult> {
  const messages: Message[] = [{ role: 'user', content: buildSystemPrompt(q) }];
  const toolDefs = getToolDefinitions();
  let turns = 0;
  while (turns < MAX_TURNS /* default 10 */) {
    const resp = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      tools: toolDefs,
      messages,
    });
    if (resp.stop_reason === 'end_turn') {
      return { answer: extractFinalAnswer(resp), turns, ... };
    }
    if (resp.stop_reason === 'tool_use') {
      const toolResults = await Promise.all(
        resp.content.filter(b => b.type === 'tool_use').map(executeToolBlock)
      );
      messages.push({ role: 'assistant', content: resp.content });
      messages.push({ role: 'user', content: toolResults });
      turns++;
    }
  }
  return { answer: '(max turns reached)', turns, timedOut: true };
}
```

Caps: 10 turns per question, 4096 max_tokens per turn, 60s per tool call, 300s total per question.

### 4. Judge (`v3/@claude-flow/cli/src/benchmarks/gaia-judge.ts`)

GAIA answers are often essay-like ("the third character in Smith's 1987 publication, all caps"). Pure exact-match has high false-negative rate. Use two-stage scoring:

1. **Fast path** — exact-match (after string normalization). ~30% of GAIA answers are short factoids that exact-match works for.
2. **LLM-as-judge** — for non-exact-match, ask Claude Sonnet whether the candidate answer is semantically equivalent to ground truth. Cost: 1 Sonnet call (~$0.005) per non-exact-match question.

The judge prompt embeds GAIA's official scoring guidelines. Outputs are cached so re-running the bench doesn't re-judge.

### 5. CLI Surface

```bash
# Standard run: Level 1, all questions, Haiku
npx claude-flow performance capability-gaia

# Multi-level, multi-model, limited to 10 questions per level for sanity
npx claude-flow performance capability-gaia \
  --levels 1,2 --limit 10 \
  --models claude-haiku-4-5,claude-sonnet-4-6

# Custom tools (e.g., disable python_exec in environments without a sandbox)
npx claude-flow performance capability-gaia --disable-tools python_exec
```

### 6. CI Integration

Extends the existing `.github/workflows/capability-benchmark.yml` (shipped in PR #2163 follow-up):

- New PR label: `bench:gaia` (separate from `bench:capability`)
- Cron: **weekly** on main, not nightly (cost-bearing: ~$5-20 per full-level-1 run depending on tool-use turn count)
- Required secrets: `ANTHROPIC_API_KEY`, `HF_TOKEN`
- Posts results as PR comment with per-level breakdown table

---

## Consequences

**Positive:**

- First measured GAIA score for ruflo — comparable against published leaderboards (Princeton HAL)
- Tool-use loop is itself a reusable harness for other agent benchmarks (WebArena, SWE-bench-multimodal)
- Forces ruflo to expose a clean tool-use API at the CLI level, useful beyond benchmarking
- Closes the credibility gap noted in #2156's competitor table where "SWE-bench Score" column shows "Not measured" for ruflo

**Negative:**

- ~5-10 engineering days; spans 3-4 PRs (loader, tools, agent loop, judge+CI)
- Recurring cost: ~$5-20 per full-level-1 weekly run, ~$50-200/month if extended to L2+L3
- Adds a Playwright dep (web_browse), pdfjs (file_read), and either E2B SDK or Docker (python_exec) to the CLI package — non-trivial install footprint
- Failures are harder to debug: a "0% pass rate" run might be due to model regression, tool harness bug, dataset format change, or judge prompt drift — needs careful error categorization

**Neutral:**

- The existing `performance capability` (text-only fixture) remains the cheap, no-API-dataset-dependency CI floor. GAIA is the heavy-weight quarterly measurement.
- Real GAIA score is only comparable to others when scored with the official judge prompt. Custom judge tuning would break comparability — should be a hard rule.

---

## Alternatives Considered

1. **SWE-bench-Verified instead of GAIA.** SWE-bench measures code-fixing capability against real GitHub issues. Higher signal for a coding agent, but requires running an actual git repo + test suite per question, which is operationally heavier than GAIA's tool-use loop. **Decision: pursue GAIA first; track SWE-bench-Verified as a separate ADR follow-up.** ADR-088's LongMemEval has shown that "build the harness once, run it forever" pattern works — same model for GAIA.

2. **Hosted benchmark service (e.g. SimpleBench, Princeton HAL submission).** Would offload harness maintenance. But requires uploading our model outputs to a third party, latency is days-to-weeks, and we can't iterate quickly on prompt/tool changes. **Decision: in-house harness so iteration is fast.**

3. **Skip GAIA entirely; commit harder to the text-only fixture.** This was the path through PR #2163. Capacity exists (Sonnet 4.6 still 100% on the 17-question fixture at session end). But text-only saturates at PhD-level questions where answer-key correctness becomes the bottleneck (3 answer-key bugs already caught in #2156 session). **Decision: dual-track — text-only fixture for cheap nightly regression, GAIA for capability ladder reality.**

4. **Use the GAIA test split (open) instead of validation (gated).** Avoids HF auth, but the test split has no ground truth — would require setting up our own ground-truth process. **Decision: use validation split with HF_TOKEN; if license / cost becomes an issue, fall back to test split with judge-only scoring.**

---

## Implementation Roadmap (suggested PR sequence)

| PR | Scope | Estimated effort |
|---|---|---|
| 1 | `gaia-loader.ts` + `HF_TOKEN` env handling + 5-question smoke (no tools yet, just download + load) | 1 day |
| 2 | `gaia-tools/web_search.ts` + `gaia-tools/file_read.ts` (the two cheapest) + tool-use harness skeleton | 2 days |
| 3 | `gaia-agent.ts` multi-turn loop + smoke against 10 Level-1 questions | 1.5 days |
| 4 | `python_exec` (E2B integration or Docker fallback) | 1 day |
| 5 | `web_browse` (Playwright) + `image_describe` (Anthropic vision) | 1.5 days |
| 6 | `gaia-judge.ts` LLM-as-judge + scoring | 1 day |
| 7 | CI wiring (extend capability-benchmark.yml with bench:gaia label) + first full Level-1 run | 0.5 days |

Total: ~8-9 engineering days for a working Level-1 implementation.

---

## Success Criteria

- Full Level-1 run completes in <30 minutes per model
- Pass rate within ±5% of published GAIA Princeton HAL scores for the same model (sanity check against community baselines)
- Per-question cost <$0.10 average (cap individual question cost at $0.50)
- CI job runs weekly on main without manual intervention, alerts on regression >10pp
- Zero false answer-key failures (judge correctness validated against 30+ ground-truth samples before going live)

---

## References

- [GAIA: a benchmark for General AI Assistants](https://arxiv.org/abs/2311.12983) (arXiv:2311.12983)
- [Princeton HAL GAIA Leaderboard](https://hal.cs.princeton.edu/gaia)
- ADR-088 — LongMemEval Benchmark for AgentDB (the harness template this follows)
- ADR-132 — Simulative Planning Router (related: would benefit from GAIA scores as the empirical baseline for its acceptance gate)
- #2156 — Dream Cycle 2026-05-27 capabilities scan (the issue that motivated this)
- PR #2163 — text-only `performance capability` (the cheap-bench predecessor to this)
