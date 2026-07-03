---
name: gaia-validate
description: Pre-submit validation — TypeScript clean, dataset accessible, all required env keys present, submission integrity checklist (answer-key reads, dynamic eval, judge injection)
argument-hint: "[--strict] [--fix] [--skip-integrity] [--allow-integrity-override]"
---

# /gaia validate

Run pre-submission integrity checks before executing a benchmark or packaging
results for the HAL leaderboard.

## Usage

```
/gaia validate
/gaia validate --strict
/gaia validate --fix
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--strict` | off | Fail on warnings (not just errors) |
| `--fix` | off | Attempt to auto-fix resolvable issues (e.g., install missing deps) |
| `--skip-hf` | off | Skip the HF dataset connectivity check (useful offline) |
| `--skip-build` | off | Skip the TypeScript build check |
| `--skip-integrity` | off | Skip the submission integrity checklist (check 7) |
| `--allow-integrity-override` | off | Suppress the fail-closed exit on integrity findings — the override is RECORDED in the provenance stamp and visible to reviewers |

## Checks performed

### 1. Environment keys
- `ANTHROPIC_API_KEY` — required for model inference
- `HF_TOKEN` — required to download the GAIA dataset from Hugging Face
- `GOOGLE_AI_API_KEY` — optional; warn if absent (Gemini model support disabled)
- `GOOGLE_CUSTOM_SEARCH_API_KEY` + `GOOGLE_CUSTOM_SEARCH_CX` — optional; warn
  if absent (web_search falls back to DuckDuckGo)

### 2. TypeScript build
```bash
cd v3/@claude-flow/cli && npx tsc --noEmit
```
All GAIA benchmark source files must be TS-error-free.

### 3. Dataset accessibility
Perform a dry-run fetch of 1 question from the HF GAIA dataset to confirm
the token and network path work.

### 4. Witness manifest
Verify the witness manifest is up to date and valid:
```bash
node plugins/ruflo-core/scripts/witness/verify.mjs
```

### 5. Benchmark source files present
Confirm all required benchmark source files exist:
- `v3/@claude-flow/cli/src/commands/gaia-bench.ts`
- `v3/@claude-flow/cli/src/benchmarks/gaia-agent.ts`
- `v3/@claude-flow/cli/src/benchmarks/gaia-judge.ts`
- `v3/@claude-flow/cli/src/benchmarks/gaia-loader.ts`
- `v3/@claude-flow/cli/src/benchmarks/gaia-tools/index.ts`

### 6. CLI binary resolvable
```bash
node v3/@claude-flow/cli/bin/cli.js --version
```

### 7. Submission integrity checklist (fail-closed)

Motivated by UC Berkeley RDI's "Agents' Last Exam" (April 2026,
https://rdi.berkeley.edu/blog/agents-last-exam/), which gamed all 8 major
agent benchmarks to near-100% without solving tasks — trojanized test infra,
answer keys read from unsanitized config, prompt-injected LLM judges. A
legitimate score is indistinguishable from a gamed one without this audit.

```bash
node plugins/ruflo-workflows/scripts/gaia-integrity.mjs \
  --results ~/.cache/ruflo/gaia/results-latest.json \
  [--trajectories <file>] [--config <file>] [--dataset-dir <dir>]
```

Four sub-checks:

| Sub-check | Severity | What it scans |
|-----------|----------|---------------|
| **A. answer-key reads** | **FAIL-CLOSED** | Run config + trajectory artifacts + runner sources for answer/gold/solution/ground-truth-shaped file paths referenced OUTSIDE the sanctioned dataset dir (`~/.cache/huggingface`, `~/.cache/ruflo/gaia/dataset` by default) |
| **B. dynamic evaluation** | **FAIL-CLOSED** | gaia-bench runner code paths (`v3/@claude-flow/cli/src/benchmarks/gaia-*`, `src/commands/gaia-bench.ts`) for `eval()`, `new Function()`, or exec-family calls whose command is not a fixed string literal (i.e. derivable from task content) |
| **C. judge injection** | WARN | Produced answers/trajectories for judge-directed injection markers ("ignore previous", "you are the judge", "score this as correct", evaluator-addressed instruction blocks, ...) |
| **D. provenance stamp** | always | Writes checklist results + git SHA + branch + dataset content hash to `~/.cache/ruflo/gaia/integrity-latest.json` so `/gaia submit` can embed an integrity attestation in the signed package |

Exit codes: `0` clean (warnings allowed), `2` on any A/B finding. The
`--allow-integrity-override` flag converts exit 2 to 0 but records
`"overridden": true` in the stamp — the override is never silent.

Self-test mode (used by the plugin smoke): plants a fake answer-key read, an
eval-of-task-content runner, and a judge-injection marker in temp fixtures and
verifies fail-closed / pass / warn behavior:

```bash
node plugins/ruflo-workflows/scripts/gaia-integrity.mjs --self-test
```

## Expected output

```
Validating GAIA benchmark environment...

[PASS] ANTHROPIC_API_KEY set (sk-ant-...abc3)
[PASS] HF_TOKEN set (hf_...xyz9)
[WARN] GOOGLE_AI_API_KEY not set — Gemini routing disabled
[WARN] GOOGLE_CUSTOM_SEARCH_API_KEY not set — web_search using DuckDuckGo fallback
[PASS] TypeScript build clean (0 errors)
[PASS] HF dataset reachable (1 question fetched)
[PASS] Witness manifest valid (Ed25519 verified)
[PASS] All 5 benchmark source files present
[PASS] CLI binary resolves to v3.6.x
[PASS] Integrity A: answer-key reads outside sanctioned dataset dir (0 findings)
[PASS] Integrity B: dynamic evaluation in runner code paths (0 findings)
[PASS] Integrity C: judge-prompt-injection markers (0 findings)
[PASS] Integrity D: provenance stamp written (git 78810360b, dataset sha256:...)

2 warnings (use --strict to fail on warnings)
Ready to run /gaia run
```

## Steps Claude should follow

1. For each env var, check `process.env` first, then attempt
   `gcloud secrets versions access latest --secret=<name>` silently.
2. Run `npx tsc --noEmit` in the CLI package directory; capture stderr.
3. Run a 1-question dry-run fetch: `node … gaia-bench run --smoke-only --limit=1 --dry-run`.
4. Run the witness verify script.
5. Unless `--skip-integrity`, run the integrity checklist:
   `node plugins/ruflo-workflows/scripts/gaia-integrity.mjs --results <results>
   [--trajectories <file>]` (pass `--allow-integrity-override` through if the
   user set it). Exit 2 from the script is an integrity failure — report the
   findings verbatim and STOP; do not proceed to `/gaia run` or `/gaia submit`.
6. Print the validation table and exit with code 1 if any errors (not warnings)
   are found, unless `--strict` is set in which case warnings also cause exit 1.
   Integrity findings (check 7 A/B) always fail regardless of `--strict`.
