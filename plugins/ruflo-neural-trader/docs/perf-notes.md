# Neural-Trader Performance Notes — ADR-126 follow-up #49

Bench-driven hot-path analysis derived from the three baseline benches
landed in `#48`:

- `benchmarks/signal-generation.bench.mjs`
- `benchmarks/backtest-throughput.bench.mjs`
- `benchmarks/memory-recall.bench.mjs`

The portfolio CG bench (`portfolio-cg.bench.mjs`) is owned by the
ADR-126 Phase 3 / #2080 work and is referenced read-only here.

## Hotspots ranked by user-visible impact

### 1. Neumann solver per-iter allocation (FIXED in this PR)

- **Where**: `plugins/ruflo-neural-trader/src/sublinear-adapter.mjs:148-184`
  (`neumannSeries` exported kernel)
- **Measured before**: avg ~0.635 ms at n=256 across 5 runs, plus measurable
  GC variance (p95 / max well above p50)
- **Measured after**: avg ~0.522 ms at n=256 across 5 runs — **~18% faster**
- **Optimization**: replace per-iter `new Float64Array(n)` allocation with
  a two-buffer ping-pong (`cur` / `next`, swapped by reference each iter).
  At n=256 a typical 5-iter solve previously allocated 5×2 KB of garbage
  per call — eliminated.
- **Scope**: plugin-layer only. No upstream `neural-trader` change needed.
  Smoke `node scripts/smoke-neural-trader-portfolio-cg.mjs` still passes.
- **Parity preserved**: `||cg − neumann||_∞ = 2.12e-8` at n=256 — identical
  to the pre-change baseline; the change is purely an allocation-pattern
  rewrite, not an algorithmic change.

### 2. Memory recall linear scan grows ~O(N) (TRACKED, not fixed here)

- **Where**: the production path uses `mcp__plugin_ruflo-core_ruflo__memory_search`
  via AgentDB + HNSW. The bench `memory-recall.bench.mjs` models the
  linear-scan baseline (cosine over Float32Array) to track the
  approximate-vs-exact recall gap an ANN index would create.
- **Measured**: avg latency scales from 0.08 ms at N=100 → 3.85 ms at
  N=5000 → 47.87× scaling vs the ideal-linear 50× (so 96% of linear).
  p95 at N=5000 is ~4.2 ms.
- **Proposed optimization (UPSTREAM)**: the production `memory_search`
  already uses HNSW per ADR-006, which gives 150x–12,500× speedups on
  this exact workload. The plugin doesn't need a local change — what we
  DO need is a regression gate: when the skill's recall@10 drops below
  0.8, the HNSW build params (M, efConstruction) drifted and need a
  rebuild. The bench captures that gate. **Scope: upstream HNSW config,
  not the plugin.**

### 3. Signal-scan p99 tail latency is ~9× the avg (TRACKED, not fixed here)

- **Where**: `benchmarks/signal-generation.bench.mjs` — for AAPL the
  measured avg is 22 µs but p99 is 191 µs.
- **Hypothesis**: GC pressure from `bars.map(b => b.close)` + two
  `bars.slice` calls per scan in the bench. The production `--signal scan`
  path is upstream (`npx neural-trader`) and we can't fix it in the
  plugin layer, but the bench is illustrative.
- **Proposed optimization (UPSTREAM)**: reuse a single typed array for
  `closes` and slice via indices instead of materializing sub-arrays.
  Saves ~3 allocations per scan call.
- **Scope**: upstream `neural-trader` binary if the same pattern exists
  in the Rust/NAPI code path — confirmed only by profiling the
  `--signal scan` cloud roundtrip, which the plugin can't reach from a
  pure-JS smoke.

## Out-of-scope / explicitly NOT optimized

- **`canonicalBytes` (signed-artifact.mjs:75 / signed-attribution.mjs:193)** —
  the explicit ADR-126 Phase 4 contract is `JSON.stringify` with NO key
  sort, deterministic-by-construction. Adding a sort or memoization
  would break the smoke's CWE-347 parity with the plugin-registry
  signer. Leave as-is.
- **`isSymmetric` (sublinear-adapter.mjs:204-211)** — already short-circuits
  on first violation. The full upper-triangle scan on symmetric inputs
  is the contract guard the smoke depends on; weakening it weakens the
  SPD precondition.

## Bench-as-regression-gate

The three new benches act as a perf budget:

| Bench                          | Budget                | Source              |
|--------------------------------|-----------------------|---------------------|
| signal worst-symbol avg        | <1000 µs              | acceptance line     |
| signal full-scan sum-of-avgs   | <10 ms                | acceptance line     |
| backtest avg runtime           | <10 ms                | acceptance line     |
| backtest throughput            | >25,000 bars/sec      | acceptance line     |
| memory-recall p95 at N=5000    | <50 ms                | acceptance line     |
| memory-recall recall@10        | >=0.8 (90% subset)    | acceptance line     |

A bench whose acceptance line trips on CI is a perf regression.

## Refs

- ADR-126 §SOTA delta — bench-driven perf work
- ADR-123 Wedge 8 — sublinear-time-solver
- ADR-006 — Unified Memory Service (HNSW)
- Followup #48 — bench suite that produced the numbers above
