---
name: gaia-submit
description: Package GAIA results into an Ed25519-signed, HAL-compatible submission archive
argument-hint: "[--results=<path>] [--run-id=<id>] [--dry-run]"
---

# /gaia submit

Build a submission-ready package from a completed benchmark run and sign it
with the ruflo Ed25519 witness manifest.

## Usage

```
/gaia submit
/gaia submit --results=~/.cache/ruflo/gaia/results-latest.json
/gaia submit --results=./my-results.json --dry-run
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--results` | `~/.cache/ruflo/gaia/results-latest.json` | Path to the JSON results file from `/gaia run` |
| `--run-id` | auto (from git SHA) | Short identifier embedded in the package directory name |
| `--dry-run` | off | Build and validate the package but do not write it to disk |
| `--no-sign` | off | Skip Ed25519 signing (not recommended for leaderboard submissions) |

## Output package layout

```
submission-<date>-<short-sha>/
├── results.jsonl        — one JSON object per question (HAL-compatible)
├── trajectories.jsonl   — full agent trajectory per question
├── metadata.json        — model, harness version, tool catalogue, cost
├── manifest.md.json     — Ed25519-signed witness manifest
└── README.md            — human-readable summary + comparison vs HAL baseline
```

## HAL-compatible result schema (per question)

```json
{
  "task_id": "e1fc63a2-da7a-432f-be78-7c4a95598703",
  "model_answer": "4",
  "reasoning_trace": "[full agent trace]",
  "tools_used": ["web_search", "python_exec"],
  "turns": 5,
  "wall_seconds": 12.4
}
```

## Steps Claude should follow

1. Locate the results file — default `~/.cache/ruflo/gaia/results-latest.json`;
   ask if multiple candidates exist.
2. Validate the file has the expected shape: `level`, `model`, `summary`, `results` array.
3. Transform `results[]` → HAL-compatible `results.jsonl` (one JSON per line).
4. Extract `trajectories.jsonl` from any `trajectory` fields in the results.
5. Build `metadata.json`:
   ```json
   {
     "submitted_at": "<ISO-8601>",
     "harness": "ruflo@3.6.x / @claude-flow/cli@3.6.x",
     "model": "<model-id>",
     "gaia_level": 1,
     "tool_catalogue": ["web_search","file_read","web_browse","image_describe","python_exec"],
     "total_questions": 53,
     "pass_rate": 0.208,
     "est_cost_usd": 1.23,
     "adrs": ["ADR-133","ADR-135","ADR-136"],
     "git_sha": "<short-sha>"
   }
   ```
6. Sign with witness: `node plugins/ruflo-core/scripts/witness/sign.mjs submission-<id>/`
7. Write `README.md` with pass-rate table comparing to HAL baselines.
8. If `--dry-run`, print the package tree and manifest hash without writing.
9. Print the package directory path so the user can zip + upload to HAL.

## Submitting to HAL

After generating the package:
```bash
zip -r submission-$(date +%Y%m%d).zip submission-<date>-<sha>/
# Upload at https://huggingface.co/spaces/gaia-benchmark/leaderboard
```
