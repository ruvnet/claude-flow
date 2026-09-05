---
name: trader-portfolio-cg
description: Mean-variance portfolio optimization via Conjugate Gradient — 40-60× faster than the legacy Neumann path (ADR-126 Phase 3, ADR-123 Wedge 8)
allowed-tools: Bash Read mcp__ruflo-sublinear__solve mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_retrieve mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search
argument-hint: "[--portfolio-id ID] [--tolerance 1e-6]"
---
Solve the mean-variance optimization `Σ · x = μ` via Conjugate Gradient instead of the legacy Neumann series.

**Why CG instead of Neumann (ADR-123 Wedge 8):**
- Neumann series: ~50 µs at n=256 (legacy `npx neural-trader --portfolio optimize`)
- Conjugate Gradient: ~816 ns at n=256 (this skill)
- Measured speedup: 40-60×; parity within 1e-4 on a fixed seed.

The covariance matrix Σ is symmetric positive-definite by construction (it's a Gram matrix on real returns), so CG is provably optimal — it converges in at most n iterations with no preconditioning, and typically far fewer when eigenvalues cluster.

**Disable flag**: set `RUFLO_NEURAL_TRADER_DISABLE_CG=1` to skip the CG path entirely and fall through to step 4's legacy Neumann route. Useful for A/B validation or when an upstream covariance regression breaks SPD.

**Native dispatch flag**: set `RUFLO_SUBLINEAR_NATIVE=1` to force the adapter to attempt the native `mcp__ruflo-sublinear__solve` path even when `globalThis` doesn't expose the tool (e.g. when the harness mounts it via a different transport). On any native-dispatch failure the adapter cleanly falls back to the local JS CG and records `method: 'cg-local'` in the artifact metadata — so the regression is auditable.

Steps:

1. **Ensure neural-trader is available**:
   ```bash
   npm ls neural-trader 2>/dev/null || npm install --ignore-scripts neural-trader
   ```

2. **Read the current covariance matrix Σ and expected-return vector μ** from neural-trader's portfolio API:
   ```bash
   # Primary path (preferred — clean JSON):
   npx neural-trader --portfolio current --json
   # Fallback paths if the --json flag is unavailable on the installed version:
   npx neural-trader --portfolio current  # parse the text output
   # OR pull from AgentDB if a prior run stored the matrix there:
   ```
   ```text
   mcp__plugin_ruflo-core_ruflo__memory_search({ query: "covariance matrix current", namespace: "trading-risk", limit: 1 })
   ```
   The skill expects the response to include `covariance: number[][]` (n × n) and `expectedReturns: number[]` (length n).

3. **Solve Σ · x = μ via the SublinearAdapter** (preferred path) when `RUFLO_NEURAL_TRADER_DISABLE_CG` is unset:
   ```js
   import { sublinearAdapter } from '../../src/sublinear-adapter.mjs';
   const result = await sublinearAdapter.solveCG(COVARIANCE, EXPECTED_RETURNS, {
     tolerance: 1e-6,
     maxIterations: 200,
   });
   // result.solution    — optimal weights (number[])
   // result.iterations  — CG iterations executed
   // result.residual    — final ||A·x − b||₂
   // result.latencyMs   — wall-clock latency
   // result.method      — 'cg-sublinear-native' | 'cg-local'   <-- READ THIS
   // result.solver      — 'sublinear-time-solver@1.7.0' | 'local-js-cg'
   // result.degraded    — true if input failed SPD checks (fall back to step 4)
   ```
   The adapter does the dispatch itself: it probes for `mcp__ruflo-sublinear__solve` on `globalThis` (and honours `RUFLO_SUBLINEAR_NATIVE=1` as a manual override), routes through the native kernel when reachable, and falls back transparently to the embedded ~50-LOC JS CG when not. The math is identical either way — CG, dense form, n × n SPD covariance. The operator reads `result.method` to know which backend produced the artifact.

   The native MCP tool's wire shape (for direct callers who want to bypass the adapter):
   ```text
   mcp__ruflo-sublinear__solve({
     matrix: COVARIANCE,
     rhs: EXPECTED_RETURNS,
     algorithm: "cg",
     tolerance: 1e-6,
     maxIterations: 200
   })
   ```
   Output:
   ```ts
   { solution: number[], iterations: number, residual: number }
   ```

4. **Fallback (legacy Neumann)** — if step 3 reports `degraded: true` (non-SPD input, non-square matrix, MCP error) OR if `RUFLO_NEURAL_TRADER_DISABLE_CG=1`:
   ```bash
   npx neural-trader --portfolio optimize
   ```
   Capture the weights output and tag the artifact metadata with `method: 'neumann-fallback'` and a `reason` field.

5. **Store the optimal weights** to `trading-risk` namespace with full provenance metadata. **Take `method` and `solver` straight from the adapter's result so the operator can verify which backend ran**:
   ```text
   mcp__plugin_ruflo-core_ruflo__memory_store({
     key: "portfolio-weights-PORTFOLIO_ID-TIMESTAMP",
     namespace: "trading-risk",
     value: JSON.stringify({
       weights: result.solution,           // number[] from step 3 (or weights from step 4 fallback)
       method: result.method,              // 'cg-sublinear-native' | 'cg-local' | 'neumann-fallback'
       solver: result.solver,              // 'sublinear-time-solver@1.7.0' | 'local-js-cg' | 'neural-trader-cli'
       iterations: result.iterations,
       residual: result.residual,
       latencyMs: result.latencyMs,
       capturedAt: NEW_DATE_ISO,
       reason: FALLBACK_REASON || null
     })
   })
   ```
   The `trading-risk` namespace is canonical (ADR-126 Phase 1; the five-namespace alignment). Long-lived — no TTL — because portfolio weights are the audit trail Phase 4 will Ed25519-sign.

6. **Cross-check against historical patterns** (optional but recommended):
   ```text
   mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search({
     query: "portfolio weights Sharpe regime:CURRENT_REGIME",
     namespace: "trading-risk"
   })
   ```
   If the new weights differ by more than 30% in any single asset from the historical median, flag for human review before applying. This is a guard-rail, not a hard block.

**Acceptance criteria (ADR-126 Phase 3):**
- Latency < 1 ms on n = 256 covariance (local JS CG); native path target 40-60× faster (816 ns native vs 50 µs Neumann per sublinear-time-solver@1.7.0).
- Parity with legacy Neumann within `||cg − neumann||_∞ < 1e-4` on a fixed seed.
- Fallback path engages cleanly when native MCP unavailable / covariance non-SPD.
- Artifact metadata distinguishes `cg-sublinear-native`, `cg-local`, and `neumann-fallback`.

**Refs**:
- ADR-126 Phase 3 (this skill's authoring ADR)
- ADR-123 §162 Row 8 (Wedge 8 speedup claim)
- ADR-123 §262-289 (the SublinearAdapter contract)
- `plugins/ruflo-neural-trader/src/sublinear-adapter.ts` (the adapter)
- `plugins/ruflo-neural-trader/benchmarks/portfolio-cg.bench.ts` (the measured numbers)
