---
name: gaia-history
description: Show measured benchmark runs stored across sessions in the gaia-runs memory namespace
argument-hint: "[--limit=20] [--level=1] [--model=<id>]"
---

# /gaia history

Display a table of all GAIA benchmark runs that have been stored in the
`gaia-runs` AgentDB memory namespace.

## Usage

```
/gaia history
/gaia history --limit=10
/gaia history --model=claude-sonnet-4-6
/gaia history --level=1
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--limit` | `20` | Maximum rows to show |
| `--level` | all | Filter by GAIA level |
| `--model` | all | Filter by model ID |
| `--since` | all | ISO-8601 date; show runs after this date |
| `--format` | `table` | `table` or `json` |

## What this does

1. Queries the `gaia-runs` namespace: `npx @claude-flow/cli@latest memory list --namespace gaia-runs`
2. Parses each stored value (JSON summary blobs saved by `/gaia run`).
3. Renders a sorted table (newest first):

```
Run ID               Date        Level  Model               Q    Pass%   Cost ($)  Mean turns
-------------------  ----------  -----  ------------------  ---  ------  --------  ----------
run-20260527-1423    2026-05-27  L1     claude-sonnet-4-6   53   20.8%   $0.47     4.2
run-20260524-0912    2026-05-24  L1     claude-haiku-4-5    53    9.4%   $0.09     3.1
run-20260522-1537    2026-05-22  L1     claude-sonnet-4-5   53   18.2%   $0.41     3.9
```

4. Highlights the best pass-rate row.
5. Shows a trend line (pass-rate over time) if 3+ runs exist.

## Run record schema (stored per run)

```json
{
  "run_id": "run-20260527-1423",
  "timestamp": "2026-05-27T14:23:00Z",
  "level": 1,
  "model": "claude-sonnet-4-6",
  "total": 53,
  "passed": 11,
  "pass_rate": 0.208,
  "est_cost_usd": 0.47,
  "mean_turns": 4.2,
  "adrs": ["ADR-133","ADR-135"],
  "git_sha": "abc1234"
}
```

## Steps Claude should follow

1. Run `npx @claude-flow/cli@latest memory list --namespace gaia-runs --limit $LIMIT`
2. Parse each entry value as JSON.
3. Apply `--level` and `--model` filters if provided.
4. Sort by timestamp descending.
5. Render the table and highlight the row with the highest `pass_rate`.
6. If 3+ runs exist, print a simple ASCII trend chart of `pass_rate` over time.
