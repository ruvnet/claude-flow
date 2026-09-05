# Darwin capability evolution — plan

Branch: `darwin/capability-evolution-2026-06-26`
Started: 2026-06-26

## Goal
Drive ruflo capabilities toward SOTA across the dimensions we already
benchmark, using a `/loop 5m` autonomous loop. Each tick spawns one
`claude -p` (headless, Read/Edit/Bash only, --max-budget-usd capped) to
do a single optimization cycle, so this conversation stays focused on
orchestration and the per-tick spend is bounded.

## Per-tick contract
A single tick = one `claude -p` invocation that does end-to-end:

  1. Read `docs/darwin/log.jsonl` — last N entries, find current
     champion scores per dimension.
  2. Pick the worst-relative-to-SOTA dimension. SOTA baselines:
       BEIR NFCorpus  — nDCG@10 ≥ 0.36 (state-of-the-art hybrid)
       BEIR ArguAna   — nDCG@10 ≥ 0.55
       BEIR SciFact   — nDCG@10 ≥ 0.74
       BEIR TREC-COVID — nDCG@10 ≥ 0.78
       GAIA L1        — exact-match ≥ 0.62 (LangGraph reference)
       ADR coverage   — adr-index storage success ≥ 0.99
  3. Propose ONE targeted change (parameter tune, prompt rewrite, dep
     bump, algorithm swap). Keep it small enough that a benchmark
     subset can score it in ≤4 minutes.
  4. Apply, run the relevant benchmark/audit:
       BEIR  → `node scripts/bench-beir.mjs <dataset> --top-k 10`
       ADR   → `node plugins/ruflo-adr/scripts/import.mjs --dry-run`
       OIA   → `npx ruflo metaharness oia-audit --format json`
  5. Compare delta to prior champion for that dimension:
       Δ > 0       → commit, update champion, log success
       Δ ≤ 0       → revert, log noImprovement
       benchmark error → revert, log error
  6. Append one JSONL line to `docs/darwin/log.jsonl` with:
       { iter, ts, dimension, change, deltaScore, action, commit }

## Termination
- 3 consecutive iterations without Δ > 0 across any dimension → stop
- Or explicit user stop

## Spend cap per tick
`claude -p --max-budget-usd 0.50 --model haiku` for routine ticks.
Escalate to sonnet only when haiku reports "task too complex" 3x in
a row.

## SOTA-proof
A dimension is "proven SOTA" when:
  - It exceeds the baseline above by ≥1%
  - The benchmark run is reproducible (3 consecutive runs within 1σ)
  - The git commit is signed and witnessed
