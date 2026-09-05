# Reproduction Steps

**GAIA L1 Stable Config — iter63 convergence layer**
Commit: `3ef6e175ddeb867135f00e843247aba2324d3c6d`

## Prerequisites

- Node.js 20+
- npm 9+
- Git

## Required Environment Variables

```bash
# Mandatory
export ANTHROPIC_API_KEY=<your-key>

# Optional (used for web search grounding)
export GOOGLE_AI_API_KEY=<your-key>

# Optional (HuggingFace for dataset access)
export HF_TOKEN=<your-token>
```

**Never echo or store these keys in any file.**

## Clone and Checkout

```bash
git clone https://github.com/ruvnet/ruflo
cd ruflo
git checkout 3ef6e175ddeb867135f00e843247aba2324d3c6d
```

## Build

```bash
cd v3/@claude-flow/cli
npm install
npm run build
cd ../../..
```

## Run

```bash
node v3/@claude-flow/cli/dist/cli.js gaia-bench run \
  --level 1 \
  --model claude-sonnet-4-6 \
  --limit 53 \
  --enable-convergence
```

## Expected Output

```
GAIA Level 1 — 53 questions
Model: claude-sonnet-4-6
Convergence layer: enabled

[...per-question PASS/FAIL lines...]

Pass rate : 33-35/53 (62.3%–66.0%)
Mean turns: ~4.6
Mean time : ~43s per question
Estimated cost: ~$3.90 USD
```

**Expected score range: 33–35/53.** The ±2 question variance is inherent to web-retrieval-dependent questions where search result availability varies across runs. Do not interpret a single run as the definitive score; use the n=3 mean.

## Variance Note

Approximately 47% of questions produce inconsistent answers across runs when using this config (measured from n=4 runs spanning iters 53a–63). The stable PASS rate (correct in all runs) is approximately 22/53. The remaining questions vary based on retrieval conditions. If your reproduction run scores 32 or 36, both are within the expected distribution.

## Cost Estimate

- Anthropic API (claude-sonnet-4-6): approximately $3.50–$4.50 USD per full 53-question run
- Google Search API: minimal additional cost
- Total: approximately $4 USD per reproduction run

## Verification

After running, compare your results against `docs/benchmarks/submission/predictions.json`:

```bash
# Quick check: count your passing questions
node -e "const r=require('./your-results.json'); console.log(r.summary.passed + '/' + r.summary.total)"
```

Per-question answer discrepancies are expected due to run-to-run variance. The headline score (34/53) was measured in a specific run at a specific time; your run may differ by ±2 questions.
