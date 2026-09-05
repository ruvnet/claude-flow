---
name: gaia-run
description: Execute a GAIA benchmark run — shells out to gaia-bench run, streams progress, and writes JSON results
argument-hint: "[--level=1] [--limit=53] [--models=haiku,sonnet] [--concurrency=3] [--voting-attempts=1] [--hardness-routing] [--enable-critic] [--decompose] [--planning-interval=4]"
---

# /gaia run

Run GAIA benchmark questions through the ruflo agent loop.

## Usage

```
/gaia run
/gaia run --level=1 --limit=53 --models=claude-sonnet-4-6
/gaia run --level=1 --limit=53 --models=haiku,sonnet --voting-attempts=3 --hardness-routing
/gaia run --smoke-only   # 5 questions, no HF token needed

# Recommended config (~$2/run, all active tracks):
/gaia run --level=1 --models=claude-sonnet-4-6 --hardness-routing --enable-critic --planning-interval=4
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--level` | `1` | GAIA difficulty level (1=easiest, 2, 3) |
| `--limit` | all | Maximum questions to run |
| `--models` | `claude-haiku-4-5` | Comma-separated model IDs |
| `--concurrency` | `3` | Parallel question slots |
| `--voting-attempts` | `1` | Track A: self-consistency attempts (3 recommended, +5-10pp; voting takes precedence over critic when both set) |
| `--hardness-routing` | off | Track Q: route each question to appropriate model/turn budget (overrides --max-turns and --voting-attempts per question) |
| `--hardness-verbose` | off | Track Q: log predicted difficulty per question |
| `--enable-critic` | off | Track D: adversarial critic reviews answer before submission (+3-5pp; skipped when voting-attempts > 1) |
| `--decompose` | off | Track E: decompose multi-step questions into sub-questions (+5-10pp on ~30-40% of L1 set) |
| `--planning-interval` | `4` | Track B: inject planning checkpoint every N turns (0=disable; based on smolagents finding) |
| `--max-turns` | `12` | Max agent turns per question (overridden by hardness router) |
| `--judge-model` | `claude-sonnet-4-6` | Model used for LLM-as-judge scoring |
| `--smoke-only` | off | Use 5-question fixture (CI / no HF token) |
| `--output` | `text` | `text` or `json` |

## Flag precedence

When multiple flags combine:
1. `--hardness-routing` overrides `--max-turns` and `--voting-attempts` per question.
2. `--voting-attempts > 1` takes precedence over `--enable-critic` (cost containment — voting + critic would cost voting-count × critic calls per question).
3. `--decompose` works independently; each sub-question runs through voting/critic/plain independently, then sub-answers are synthesized before judging.

## What this does

1. **Resolve environment keys** — checks `ANTHROPIC_API_KEY`, `HF_TOKEN`, and
   optionally `GOOGLE_*` keys; falls back to GCP Secrets.
2. **Load dataset** — downloads and caches the GAIA validation split from
   Hugging Face (`~/.cache/ruflo/gaia/`).  Cached files are reused on
   subsequent runs.
3. **Estimate cost** — computes expected spend based on model pricing and
   question count; asks for confirmation when estimated cost exceeds $5.
4. **Run the agent loop** — for each question, the multi-turn
   `gaia-agent.ts` loop drives the selected model through up to `--max-turns`
   turns, using the registered tool catalogue
   (web_search, file_read, web_browse, image_describe, python_exec).
5. **Score results** — two-stage LLM-as-judge (`gaia-judge.ts`) normalizes and
   compares the model's `FINAL_ANSWER` to the ground truth.
6. **Write output** — results land in `~/.cache/ruflo/gaia/results-<sha>.json`.
   Progress is printed to stdout every 5 questions.

## Resuming an interrupted run

If a run crashes, restart with the same flags. The loader checks for a
`checkpoint-<level>-<limit>.json` in the cache dir and skips already-completed
`task_id`s automatically.

## Example invocation (underlying CLI)

```bash
node $(npm root -g)/@claude-flow/cli/bin/cli.js gaia-bench run \
  --level 1 --limit 53 \
  --models claude-sonnet-4-6 \
  --concurrency 3 --voting 1 \
  --output json
```

## Baselines for context

| System | L1 pass-rate | Notes |
|--------|-------------|-------|
| HAL (Sonnet 4.5) | 74.6% | 300 Q reference run |
| ruflo iter 23 | 20.8% | 53 Q, web_search restored |
| ruflo iter 15 | 9.4% | 53 Q, broken web_search |

## Steps Claude should follow

1. Check that `ANTHROPIC_API_KEY` and `HF_TOKEN` are set; if not, prompt user
2. Run the cost estimate: `node … gaia-bench run --dry-run --level $LEVEL --limit $LIMIT --models $MODELS`
3. If estimated cost > $5, show the estimate and ask for confirmation
4. Execute: `node … gaia-bench run --level $LEVEL --limit $LIMIT --models $MODELS --concurrency $CONCURRENCY --output json`
5. Parse JSON output and display a summary table (model | pass-rate | cost | mean-turns)
6. Store the run record in memory: `npx @claude-flow/cli@latest memory store --namespace gaia-runs --key "run-$(date +%Y%m%d-%H%M)" --value "$SUMMARY"`
