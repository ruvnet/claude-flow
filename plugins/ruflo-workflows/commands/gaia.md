---
name: gaia
description: GAIA benchmark dispatcher — run, submit, validate, and track leaderboard scores against the Princeton HAL benchmark
argument-hint: "<subcommand> [options]"
---

# /gaia — GAIA Benchmark Dispatcher

Dispatch GAIA benchmark operations. All subcommands are thin wrappers over the
`gaia-bench` CLI command shipped in `@claude-flow/cli`.

## Subcommands

| Command | Purpose |
|---------|---------|
| `/gaia run` | Execute a benchmark run against one or more models |
| `/gaia submit` | Package and sign results for HAL leaderboard submission |
| `/gaia leaderboard` | Fetch and display current HAL scores + our positioning |
| `/gaia validate` | Pre-submit checks: TypeScript clean, dataset accessible, env keys present |
| `/gaia history` | Show measured runs stored in the gaia-runs namespace |
| `/gaia cost` | Report cumulative API spend and project cost for next configurations |

## Quick start

```
/gaia validate
/gaia run --level=1 --limit=10 --models=haiku
/gaia submit --results=~/.cache/ruflo/gaia/results-latest.json
```

## Environment variables resolved

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Anthropic model inference |
| `HF_TOKEN` | Hugging Face dataset download |
| `GOOGLE_AI_API_KEY` | Gemini model support |
| `GOOGLE_CUSTOM_SEARCH_API_KEY` | Google Custom Search tool |
| `GOOGLE_CUSTOM_SEARCH_CX` | Custom Search Engine ID |

If any required variable is missing the command will instruct you how to
set it (env export or GCP secret).

## Extensibility

This dispatcher is intentionally benchmark-agnostic. Future benchmarks
(SWE-bench, WebArena, HumanEval) can be added as additional subcommands
without modifying this file.
