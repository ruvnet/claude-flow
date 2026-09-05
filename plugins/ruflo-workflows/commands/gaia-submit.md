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
| `--allow-dirty` | off | Build the package even when the ADR-167 exploit audit reports a CRITICAL failure (records the failure in the package; not for leaderboard submissions) |
| `--strict-audit` | off | Also refuse to build when the audit reports a WARN finding |

## Output package layout

```
submission-<date>-<short-sha>/
├── results.jsonl        — one JSON object per question (HAL-compatible)
├── trajectories.jsonl   — full agent trajectory per question
├── metadata.json        — model, harness version, tool catalogue, cost
├── audit-report.json    — ADR-167 pre-submission exploit-audit report
├── manifest.md.json     — Ed25519-signed witness manifest (signs audit-report.json's hash)
└── README.md            — human-readable summary + comparison vs HAL baseline
```

## Submission integrity gate (ADR-167)

Before signing, `/gaia submit` runs the **pre-submission exploit audit** — a
deterministic, $0 red-team of the known reward-hacking vectors that let UC
Berkeley RDI hit ~98% on GAIA *without solving a single task* (leaked answer
DBs, no-work passes, oracle leakage, grader monkey-patching).

**Signing proves the package bytes are untampered; the audit proves the scores
were earned.** The two are wired together: the audit report is registered as an
ADR-103 witness **fix marker**, so its sha256 + `"clean": true` marker are
signed *into* `manifest.md.json`.

- If the audit reports a **CRITICAL** failure, `/gaia submit` **refuses** to
  build the leaderboard package unless `--allow-dirty` is passed.
- `--strict-audit` additionally refuses on WARN findings.
- Checks whose data the current trajectory schema does not capture return
  `skip` with a `harness_gap` note (ADR-167 §7) — they do not block, but the
  gap is recorded in `audit-report.json` and thus in the signed manifest.

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
6. **Run the exploit audit (ADR-167)** before signing:
   ```bash
   node plugins/ruflo-workflows/scripts/gaia-audit.mjs \
     --results <results> \
     --trajectories submission-<id>/trajectories.jsonl \
     --metadata submission-<id>/metadata.json \
     --out submission-<id>/audit-report.json \
     --audited-at "$SUBMITTED_AT" ${STRICT_AUDIT:+--strict}
   ```
   If it exits non-zero (CRITICAL fail, or WARN under `--strict-audit`) and
   `--allow-dirty` was NOT passed, stop and report the findings — do not build
   the package. `--audited-at` is set to `metadata.submitted_at` so the report
   is reproducible.
7. Register the audit report as a witness fix marker so its hash is signed into
   the manifest, then sign:
   ```bash
   node plugins/ruflo-core/scripts/witness/regen.mjs \
     --manifest submission-<id>/manifest.md.json \
     --root submission-<id> \
     --fixes gaia-audit-fix.json   # {id:"gaia-exploit-audit", file:"audit-report.json", marker:"\"clean\": true"}
   ```
8. Write `README.md` with pass-rate table comparing to HAL baselines.
9. If `--dry-run`, print the package tree, the audit summary, and the manifest
   hash without writing.
10. Print the package directory path so the user can zip + upload to HAL.

## Submitting to HAL

After generating the package:
```bash
zip -r submission-$(date +%Y%m%d).zip submission-<date>-<sha>/
# Upload at https://huggingface.co/spaces/gaia-benchmark/leaderboard
```
