# Guidance Performance Benchmarks

Phase 1 benchmarks for the `@claude-flow/guidance` SOTA optimization
horizon (`guidance-sota-2026-05`).

## Scripts

| Script | Measures |
|--------|----------|
| `bench-phase-1.mjs` | Micro-benchmarks for the 3 hot paths identified by the researcher (analyzer extractMetrics, compiler parseRule, retriever cosine) |
| `bench-retriever-scale.mjs` | End-to-end `retriever.retrieve()` latency at N ∈ {10, 100, 500, 1000} shards — the production-facing scaling curve |

## Running

```bash
cd v3/@claude-flow/guidance && npm run build
node v3/@claude-flow/guidance/scripts/bench-phase-1.mjs --tag=baseline
node v3/@claude-flow/guidance/scripts/bench-retriever-scale.mjs --tag=baseline
```

Output lands in `docs/benchmarks/guidance-*-<tag>.json`.

## Findings (Phase 1, 2026-05-22)

| Bench | Baseline | Phase 1 | Δ |
|-------|---------:|--------:|---|
| analyzer.analyze (150-line CLAUDE.md) | 2,896 ops/s | 2,860 ops/s | within noise |
| compiler.compile (150-line CLAUDE.md) | 3,752 ops/s | 3,704 ops/s | within noise |
| retriever.retrieve (N=500) | 2,457 ops/s | 2,724 ops/s | **+10.9%** |
| retriever.retrieve (N=1000) | 1,317 ops/s | 1,425 ops/s | **+8.2%** |

The micro-optimizations to `extractMetrics` (single-pass loop) and
`parseRule` (`text.matchAll` instead of `new RegExp(...)` per call) are
within run-to-run noise on V8 — the JIT already optimizes these patterns
heavily. The retriever changes (unit-vector dot-only cosine + same
single-pass philosophy) deliver a real 8-11% lift at scale.

**The real opportunity is M3**: replace `scoreShards`'s O(n) linear scan
(retriever.ts:268) with an HNSW ANN query. Baseline shows latency goes
from 14µs at N=10 to 760µs at N=1000 — pure O(n) cost. An ANN index
will deliver O(log n), which at N=1000 means roughly 100x algorithmic
improvement on the dominant bottleneck.
