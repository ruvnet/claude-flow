---
name: gaia-leaderboard
description: Fetch and display current HAL GAIA leaderboard scores and our positioning
argument-hint: "[--level=1] [--top=20]"
---

# /gaia leaderboard

Display the current HAL GAIA leaderboard and compare with stored ruflo runs.

## Usage

```
/gaia leaderboard
/gaia leaderboard --level=1 --top=20
/gaia leaderboard --level=2
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--level` | `1` | Show scores for this GAIA level (1, 2, or 3) |
| `--top` | `20` | How many leaderboard entries to display |
| `--show-ours` | on | Overlay our stored run results in the table |

## What this does

1. Fetches the GAIA leaderboard from the HAL HuggingFace space API:
   `https://huggingface.co/spaces/gaia-benchmark/leaderboard`
2. Parses the top N entries by L1/L2/L3 pass-rate.
3. Loads our stored runs from the `gaia-runs` memory namespace.
4. Displays a comparison table:

```
Rank  System                  L1%    L2%    L3%    Overall
----  ----------------------  -----  -----  -----  -------
  1   HAL (Sonnet 4.5)        74.6   55.2   31.4   60.1
  2   GPT-4o (OpenAI)         71.3   51.8   28.9   56.6
...
 --   ruflo (this session)    20.8    --     --     20.8*
```

`*` denotes partial run (L1 only, 53/300 questions).

## Known baselines

| System | L1 | Source |
|--------|----|--------|
| HAL Sonnet 4.5 | 74.6% | Princeton HAL reference, 300 Q |
| ruflo iter 23 | 20.8% | 53 Q, post-SOTA web_search |
| ruflo iter 15 | 9.4% | 53 Q, broken web_search |

## Steps Claude should follow

1. Use the WebFetch tool to retrieve leaderboard data from
   `https://huggingface.co/spaces/gaia-benchmark/leaderboard`.
2. If the API returns JSON parse it directly; if HTML, extract the table rows.
3. Load local runs: `npx @claude-flow/cli@latest memory list --namespace gaia-runs`
4. Render a Markdown table comparing leaderboard entries with local runs.
5. Highlight the gap between our best run and the top-10 median.
6. Suggest which configuration changes would close the gap most efficiently.
