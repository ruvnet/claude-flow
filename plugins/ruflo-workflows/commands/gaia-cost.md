---
name: gaia-cost
description: Report cumulative GAIA API spend and project cost for planned configurations
argument-hint: "[--level=1] [--limit=53] [--models=haiku,sonnet] [--voting=1]"
---

# /gaia cost

Show cumulative API spend across all stored GAIA runs and project the cost
for a planned configuration before you commit to running it.

## Usage

```
/gaia cost
/gaia cost --level=1 --limit=53 --models=claude-sonnet-4-6
/gaia cost --level=1 --limit=300 --models=sonnet,haiku --voting=3
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--level` | `1` | Level for projection |
| `--limit` | `53` | Number of questions for projection |
| `--models` | `claude-haiku-4-5` | Comma-separated models for projection |
| `--voting` | `1` | Self-consistency attempts multiplier |
| `--hardness-routing` | off | Include hardness-router model-mix estimate |

## Pricing reference

| Model | Input ($/M tokens) | Output ($/M tokens) |
|-------|--------------------|---------------------|
| claude-haiku-4-5 | $0.25 | $1.25 |
| claude-sonnet-4-6 | $3.00 | $15.00 |
| claude-opus-4-5 | $15.00 | $75.00 |

Estimates assume 1,500 input tokens / turn and 512 output tokens / turn,
4.2 mean turns per question (measured baseline).

## Example output

```
Cumulative spend (all stored runs)
------------------------------------
Total runs:    3
Total Q's:    159
Total spend:  $0.97
  Haiku:      $0.09  (53 Q × 1 attempt)
  Sonnet:     $0.88  (106 Q × 1 attempt)

Projection for: L1, 53 Q, sonnet × 3 voting
----------------------------------------------
Questions:        53
Attempts/Q:        3
Effective Q's:   159
Est. input tok:  238,500
Est. output tok:  81,600
Est. cost:        $1.94

  Above $5 threshold: NO — proceed without confirmation
```

## Cost confirmation gate

When a projected run exceeds $5, the `/gaia run` command will display this
cost estimate and require explicit confirmation before proceeding.

## Steps Claude should follow

1. Load history: `npx @claude-flow/cli@latest memory list --namespace gaia-runs`
2. Sum `est_cost_usd` across all stored runs to produce cumulative spend.
3. Compute projection for the requested configuration:
   - `effective_questions = limit × voting`
   - Per question: assume 4.2 turns (measured), 1500 input tokens/turn, 512 output tokens/turn
   - Multiply by model pricing
4. Display the cumulative table and the projection side by side.
5. Flag with a warning banner if projected cost exceeds $5.
