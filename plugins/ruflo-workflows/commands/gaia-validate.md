---
name: gaia-validate
description: Pre-submit validation — TypeScript clean, dataset accessible, all required env keys present
argument-hint: "[--strict] [--fix]"
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
| `--strict` | off | Fail on warnings (not just errors); with `--audit`, also fails on WARN audit findings |
| `--fix` | off | Attempt to auto-fix resolvable issues (e.g., install missing deps) |
| `--skip-hf` | off | Skip the HF dataset connectivity check (useful offline) |
| `--skip-build` | off | Skip the TypeScript build check |
| `--audit` | off | Run the pre-submission exploit audit (ADR-167) when a results file exists |

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

### 7. Submission integrity (exploit audit) — ADR-167

Only runs when `--audit` is passed **and** a results file is available
(default `~/.cache/ruflo/gaia/results-latest.json`). Motivated by UC Berkeley
RDI's April-2026 finding that all 8 major agent benchmarks — GAIA included —
were gamed to ~98-100% *without solving any task* (GAIA leaked ~98% of answers
via public answer DBs + normalization collisions; o3/Claude-3.7 monkey-patch
graders in 30%+ of runs, per METR).

**Signing proves the bytes are untampered; this audit proves the score was
earned.** It is a deterministic, $0, offline red-team of the known
reward-hacking vectors:

```bash
node plugins/ruflo-workflows/scripts/gaia-audit.mjs \
  --results ~/.cache/ruflo/gaia/results-latest.json \
  --trajectories <submission>/trajectories.jsonl \
  --metadata <submission>/metadata.json \
  [--repo-root <dir>] [--dataset-dir <dir>]... [--skip-source-scan]
```

| Check | Severity | RDI/METR vector |
|-------|----------|-----------------|
| answer-leakage | CRITICAL | gold answer appears in a fetched tool output (GAIA's #1 vector) |
| no-work-pass | CRITICAL | correct with zero turns / zero output tokens / no LLM call |
| oracle-leakage | CRITICAL | gold answer present in the agent-visible **input** prompt |
| grader-isolation | CRITICAL | tool call targets judge/grader/witness paths (monkey-patching) |
| normalization-collision | WARN | degenerate/generic answer credited under aggressive normalization |
| voting-disclosure | WARN | hidden best-of-N not disclosed in metadata |
| split-integrity | WARN/INFO | validation-split (public gold) presented as held-out |
| answer-key-reads | CRITICAL | answer/gold/solution/ground-truth-shaped path read outside the sanctioned dataset dir (runner sources + produced artifacts) |
| dynamic-eval | CRITICAL | `eval()` / `new Function()` / exec of a non-literal (task-derivable) command in the gaia-bench runner sources |
| judge-injection | WARN | prompt-injection markers in the agent's **produced** answer/output aimed at the LLM judge |

The last three form the **static source-scan family** (ported from the reverted
#2547 duplicate): they scan the harness sources + produced artifacts rather than
the trajectory, so they enforce today with no instrumentation. `answer-key-reads`
and `dynamic-eval` are fail-closed; both `skip` (never false-pass) when the
runner sources cannot be located (e.g. run standalone) or under
`--skip-source-scan`. `--repo-root` overrides where the runner sources are found;
`--dataset-dir` (repeatable) sets the sanctioned dataset dirs (default
`~/.cache/huggingface`, `~/.cache/ruflo/gaia/dataset`). `dynamic-eval` is tuned
to pass ruflo's own multi-line `gcloud secrets … execSync` calls (fixed-string
commands and `RegExp.prototype.exec` are not flagged). `judge-injection` is
output-side and distinct from `oracle-leakage` (input-side), so both run.

Exit 0 clean · exit 1 on any CRITICAL fail (or WARN fail under `--strict`) ·
exit 2 usage error. Checks whose data the trajectory schema does not yet
capture return `skip` with a `harness_gap` note (see ADR-167 §7) — they never
report a false pass.

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

2 warnings (use --strict to fail on warnings)
Ready to run /gaia run
```

## Steps Claude should follow

1. For each env var, check `process.env` first, then attempt
   `gcloud secrets versions access latest --secret=<name>` silently.
2. Run `npx tsc --noEmit` in the CLI package directory; capture stderr.
3. Run a 1-question dry-run fetch: `node … gaia-bench run --smoke-only --limit=1 --dry-run`.
4. Run the witness verify script.
5. If `--audit` is set and a results file exists, run
   `plugins/ruflo-workflows/scripts/gaia-audit.mjs` (ADR-167); treat a CRITICAL
   audit failure as an error and a WARN failure as a warning.
6. Print the validation table and exit with code 1 if any errors (not warnings)
   are found, unless `--strict` is set in which case warnings also cause exit 1.
