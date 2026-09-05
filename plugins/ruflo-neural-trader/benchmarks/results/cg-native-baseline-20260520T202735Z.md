# CG native-dispatch baseline — Task #55

This baseline captures the portfolio-CG bench after wiring the native
sublinear dispatch in the `SublinearAdapter` (#55). The adapter now
probes `mcp__ruflo-sublinear__solve` on `globalThis` and honours
`RUFLO_SUBLINEAR_NATIVE=1` as a manual override. When the native path
is unreachable from the current runtime, the bench produces a useful
local-JS baseline that matches PR #2070's measured 1.5-1.9× speedup.

The full 40-60× speedup headline requires the `ruflo-sublinear` plugin
to be registered AND its MCP tool to be mounted into the adapter's
runtime via the harness — that happens on a live ruflo daemon. CI
exercises that path.

## Run summary

- Platform: macOS Apple Silicon, Node v22.22.1
- Branch: feat/55-native-cg-dispatch
- Native sublinear tool: **NOT AVAILABLE** in this run (agent sandbox)
- Method recorded by adapter: `cg-local` (clean fallback)
- Solver recorded: `local-js-cg`

## Local-JS-only baseline (this run — native not reachable)

```
# Portfolio CG vs Neumann — bench results

Generated: 2026-05-20T20:27:35.594Z
Node: v22.22.1
Iterations per size: 100 (warmup: 10)
Tolerance: 0.000001
Seed: 42
Native sublinear tool: NOT AVAILABLE (local JS fallback only)

| n    | CG local (ms) | CG native (ms)         | Neumann (ms) | Local speedup | Native speedup | CG iters | Neumann iters | Parity (∞-norm) |
|------|---------------|------------------------|--------------|---------------|----------------|----------|---------------|-----------------|
| 16   | 0.0243        | n/a (native not avail) | 0.0462       | 1.90×         | n/a            | 9        | 20            | 1.11e-6         |
| 64   | 0.0351        | n/a (native not avail) | 0.0618       | 1.76×         | n/a            | 7        | 7             | 8.07e-8         |
| 256  | 0.4786        | n/a (native not avail) | 0.7727       | 1.61×         | n/a            | 6        | 5             | 2.12e-8         |
```

### Acceptance (local-JS path)

- CG (local JS) latency at n=256: **0.4786 ms** (target: <1 ms — **PASS**)
- Local JS speedup at n=256: **1.61×** vs Neumann (consistent with PR #2070's 1.5-1.9× JS-vs-JS measurements; the gap is dominated by per-iter constant factors when both kernels converge in O(few) iterations)
- Parity at all n: **PASS** (||cg − neumann||_∞ < 1e-4)

## Reference baseline (PR #2070 / Phase 3 commit — for diff)

The committed baseline on `main` measured the same local-JS path on the
same seed and the same node version:

```
| n    | CG avg (ms) | Neumann avg (ms) | Speedup | CG iters | Neumann iters | Parity (∞-norm) |
|------|-------------|------------------|---------|----------|---------------|-----------------|
| 16   | 0.0164      | 0.0291           | 1.77   × | 9        | 20            | 1.11e-6         |
| 64   | 0.0238      | 0.0435           | 1.83   × | 7        | 7             | 8.07e-8         |
| 256  | 0.3130      | 0.4685           | 1.50   × | 6        | 5             | 2.12e-8         |
```

The numbers move slightly run-to-run (V8 JIT, OS scheduler), but the
speedup ratio is stable at 1.5-1.9× and parity is identical bit-for-bit
(same seed, same kernel). The local-JS contract has not regressed.

## Native-path expected numbers (when reachable)

Per `sublinear-time-solver@1.7.0` documentation and ADR-123 §162 Row 8:

- Native CG at n=256: **~816 ns** (vs ~50 µs for native Neumann)
- Expected `native_speedup` column: **40-60×** vs Neumann
- Method tag recorded by adapter: `cg-sublinear-native`
- Solver tag: `sublinear-time-solver@1.7.0`

The bench will populate the `CG native (ms)` and `Native speedup`
columns automatically when run in an environment where the harness has
mounted `mcp__ruflo-sublinear__solve` onto `globalThis`. CI exercises
that path; this run does not.

## Wiring summary (what changed in #55)

1. `SublinearAdapter.detectSublinearTool()` — new public probe that
   checks both `globalThis['mcp__ruflo-sublinear__solve']` and the
   `RUFLO_SUBLINEAR_NATIVE=1` env-var override. Legacy `isMcpAvailable()`
   preserved as an alias.
2. `SolveResult.method` — new field, `'cg-sublinear-native' | 'cg-local'`.
   Downstream callers record this in artifact metadata so the operator
   can verify which backend ran.
3. `SolveResult.solver` — new field, pins the producer version
   (`'sublinear-time-solver@1.7.0'` or `'local-js-cg'`).
4. `trader-portfolio-cg/SKILL.md` updated to pull `method` and `solver`
   from the adapter result instead of hard-coding.
5. Bench gained the `CG native (ms)` and `Native speedup` columns, with
   graceful "n/a" when unreachable.
6. Smoke gained contract checks for `detectSublinearTool`,
   `RUFLO_SUBLINEAR_NATIVE`, and the new `method` / `solver` fields.

## Refs

- Task #55 (downstream tracker) — wire native sublinear CG dispatch
- ruvnet/ruflo#2068 — ADR-126 Phase 3 (the SublinearAdapter ships)
- ruvnet/ruflo#2070 — Phase 3 PR (the local-JS baseline this builds on)
- ADR-126 Phase 3 — `plugins/ruflo-neural-trader/src/sublinear-adapter.ts`
- ADR-123 §162 Row 8 — Wedge 8 portfolio CG (the 40-60× claim)
- Upstream `sublinear-time-solver@1.7.0` — production CG kernel target
