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
| `--strict` | off | Fail on warnings (not just errors) |
| `--fix` | off | Attempt to auto-fix resolvable issues (e.g., install missing deps) |
| `--skip-hf` | off | Skip the HF dataset connectivity check (useful offline) |
| `--skip-build` | off | Skip the TypeScript build check |

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
5. Print the validation table and exit with code 1 if any errors (not warnings)
   are found, unless `--strict` is set in which case warnings also cause exit 1.
