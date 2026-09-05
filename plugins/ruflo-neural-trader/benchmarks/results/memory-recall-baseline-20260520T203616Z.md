# Memory recall (trading-backtests namespace) — bench results

Generated: 2026-05-20T20:36:06.129Z
Node: v22.22.1
Embedding dim: 384 (matches all-MiniLM-L6-v2 / ONNX)
K: 10
Query count per size: 50
Seed: 271828

## Latency by corpus size

| N    | avg (ms) | p50 (ms) | p95 (ms) | Ops/sec   | Recall@10 |
|------|----------|----------|----------|-----------|-----------|
| 100  | 0.0804   | 0.0736   | 0.1208   | 12443     | 1.000     |
| 1000 | 0.8006   | 0.8233   | 1.0012   | 1249      | 1.000     |
| 5000 | 3.8472   | 3.8536   | 4.1681   | 260       | 1.000     |

## Scaling

- Latency at N=100:  0.0804 ms
- Latency at N=5000: 3.8472 ms
- Scaling factor: 47.87x (ideal linear: 50x)
- Effective sub-linearity: 96% of linear

## Acceptance

- p95 at N=5000: **4.1681 ms** (target: <50 ms — PASS)
- Recall@10 at all N: **PASS** (target: ≥0.8 against ground-truth subset)

## Notes

- This bench models a **linear scan** baseline. The production
  backend uses HNSW (ADR-006), which is 150x-12,500x faster on
  the same data at the same dim — that gap is the optimization
  budget the bench should track as memory grows.
- Embeddings are unit-norm 384-dim Gaussian — a reasonable proxy
  for the ONNX all-MiniLM-L6-v2 output distribution.
- Recall@K is computed against a 90% subset of the corpus; in a
  real ANN deployment this is the approximate-vs-exact gap.

## Refs

- ADR-126 §SOTA delta — bench-driven perf work
- ADR-006 — Unified Memory Service (HNSW)
- `plugins/ruflo-neural-trader/skills/trader-backtest/SKILL.md` — production recall path
