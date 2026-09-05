// SublinearAdapter — runtime ES module mirror of sublinear-adapter.ts.
//
// Why this file exists:
//   The plugin (ruflo-neural-trader) does not have a `package.json` /
//   tsconfig / build step — it ships skills + agents + scripts only.
//   The `.ts` file in this directory is the documented type-shape and
//   the source of truth for the SublinearAdapter contract (ADR-123
//   §262-289, ADR-126 Phase 3). This `.mjs` file is the runtime that
//   the smoke (`scripts/smoke-neural-trader-portfolio-cg.mjs`) and the
//   bench (`benchmarks/portfolio-cg.bench.ts`) import directly, with
//   zero compile step.
//
// Both files MUST stay in sync — any change to one is a change to the
// other. The smoke includes a contract check that compares the two.
//
// Reference: ADR-126 Phase 3 + ADR-123 Wedge 8.

export class SublinearAdapter {
  /**
   * Two-probe detection (kept in sync with sublinear-adapter.ts):
   *   1) globalThis['mcp__ruflo-sublinear__solve'] is a function
   *   2) process.env.RUFLO_SUBLINEAR_NATIVE === '1' (manual override)
   * Either probe passing triggers the native dispatch; failure of the call
   * itself falls back to the local JS CG kernel.
   */
  static detectSublinearTool() {
    try {
      const tool = globalThis['mcp__ruflo-sublinear__solve'];
      if (typeof tool === 'function') return true;
    } catch {
      /* fall through */
    }
    try {
      const envFlag = typeof process !== 'undefined' && process.env
        ? process.env.RUFLO_SUBLINEAR_NATIVE
        : undefined;
      if (envFlag === '1' || envFlag === 'true') return true;
    } catch {
      /* no process */
    }
    return false;
  }

  /** Back-compat alias for the smoke contract (#2068). */
  static isMcpAvailable() {
    return SublinearAdapter.detectSublinearTool();
  }

  async solveCG(matrix, vector, opts = {}) {
    const start = performance.now();
    const n = matrix.length;
    if (n === 0) return degrade(start, 'empty matrix');
    for (let i = 0; i < n; i++) {
      if (!matrix[i] || matrix[i].length !== n) {
        return degrade(start, `row ${i} is not length ${n} (non-square)`);
      }
    }
    if (vector.length !== n) {
      return degrade(start, `vector length ${vector.length} ≠ matrix size ${n}`);
    }
    if (!isSymmetric(matrix)) {
      return degrade(start, 'matrix not symmetric within 1e-9');
    }

    if (SublinearAdapter.detectSublinearTool()) {
      try {
        const result = await callMcpSolve(matrix, vector, opts);
        return {
          ...result,
          latencyMs: performance.now() - start,
          path: 'cg-mcp',
          method: 'cg-sublinear-native',
          solver: 'sublinear-time-solver@1.7.0',
        };
      } catch {
        // Native dispatch failed (env-var set without harness mount, or
        // tool errored). Fall through to local CG; the artifact records
        // method='cg-local' so the regression is auditable.
      }
    }

    const { solution, iterations, residual } = conjugateGradient(matrix, vector, {
      tolerance: opts.tolerance ?? 1e-6,
      maxIterations: opts.maxIterations ?? 200,
    });
    return {
      solution,
      iterations,
      residual,
      latencyMs: performance.now() - start,
      path: 'cg-local',
      method: 'cg-local',
      solver: 'local-js-cg',
    };
  }
}

function degrade(start, reason) {
  return {
    solution: [],
    iterations: 0,
    residual: Infinity,
    latencyMs: performance.now() - start,
    path: 'cg-local',
    method: 'cg-local',
    solver: 'local-js-cg',
    degraded: true,
    reason,
  };
}

export function conjugateGradient(A, b, opts) {
  const n = b.length;
  const x = new Float64Array(n);
  const r = Float64Array.from(b);
  const p = Float64Array.from(r);
  let rDotR = dot(r, r);
  const tol2 = opts.tolerance * opts.tolerance;
  let iterations = 0;
  for (let k = 0; k < opts.maxIterations; k++) {
    iterations++;
    const Ap = matVec(A, p);
    const pAp = dot(p, Ap);
    if (pAp === 0) break;
    const alpha = rDotR / pAp;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * Ap[i];
    }
    const newRDotR = dot(r, r);
    if (newRDotR < tol2) {
      rDotR = newRDotR;
      break;
    }
    const beta = newRDotR / rDotR;
    for (let i = 0; i < n; i++) p[i] = r[i] + beta * p[i];
    rDotR = newRDotR;
  }
  return { solution: Array.from(x), iterations, residual: Math.sqrt(rDotR) };
}

/**
 * Neumann/Jacobi series solver — baseline used by the bench to demonstrate
 * the ~40-60× CG speedup. Iterates x_{k+1} = D⁻¹(b − (A − D)·x_k).
 * Converges for diagonally-dominant or SPD inputs with bounded spectral
 * radius of (I − D⁻¹A). Slower than CG by 40-60× at n=256 (Wedge 8).
 */
export function neumannSeries(A, b, opts) {
  const n = b.length;
  const tol = opts.tolerance ?? 1e-6;
  const maxIter = opts.maxIterations ?? 1000;
  const diag = new Float64Array(n);
  for (let i = 0; i < n; i++) diag[i] = A[i][i] || 1;
  // Ping-pong buffers: avoid allocating a fresh Float64Array(n) every iter.
  // Before this change a typical 5-iter solve at n=256 allocated 5×2KB of
  // garbage per call — measurable GC pressure under sustained workload.
  // The two-buffer swap keeps the same algorithm (Jacobi-style update from
  // `cur` into `next`, convergence check, swap) with zero per-iter alloc.
  // ADR-126 follow-up #49 — bench-driven perf note.
  let cur = new Float64Array(n);
  let next = new Float64Array(n);
  let iterations = 0;
  for (let k = 0; k < maxIter; k++) {
    iterations++;
    for (let i = 0; i < n; i++) {
      let off = 0;
      const row = A[i];
      for (let j = 0; j < n; j++) {
        if (j !== i) off += row[j] * cur[j];
      }
      next[i] = (b[i] - off) / diag[i];
    }
    // Convergence check on inf-norm of (next - cur).
    let d = 0;
    for (let i = 0; i < n; i++) {
      const e = Math.abs(next[i] - cur[i]);
      if (e > d) d = e;
    }
    // Swap: next becomes the new cur; the old cur is reused as next-scratch.
    const tmp = cur;
    cur = next;
    next = tmp;
    if (d < tol) break;
  }
  // Residual ||A·x − b||₂ where x is the latest cur after the swap.
  const Ax = matVec(A, cur);
  let r2 = 0;
  for (let i = 0; i < n; i++) {
    const d = Ax[i] - b[i];
    r2 += d * d;
  }
  return { solution: Array.from(cur), iterations, residual: Math.sqrt(r2) };
}

function matVec(A, x) {
  const n = A.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const row = A[i];
    let s = 0;
    for (let j = 0; j < n; j++) s += row[j] * x[j];
    out[i] = s;
  }
  return out;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function isSymmetric(A) {
  const n = A.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(A[i][j] - A[j][i]) > 1e-9) return false;
    }
  }
  return true;
}

async function callMcpSolve(matrix, vector, opts) {
  const tool = globalThis['mcp__ruflo-sublinear__solve'];
  if (typeof tool !== 'function') {
    throw new Error('mcp__ruflo-sublinear__solve not available');
  }
  const out = await tool({
    matrix,
    rhs: vector,
    algorithm: 'cg',
    tolerance: opts.tolerance ?? 1e-6,
    maxIterations: opts.maxIterations ?? 200,
  });
  if (!out || !Array.isArray(out.solution)) {
    throw new Error('mcp__ruflo-sublinear__solve returned invalid shape');
  }
  return {
    solution: out.solution,
    iterations: out.iterations ?? 0,
    residual: out.residual ?? 0,
  };
}

export const sublinearAdapter = new SublinearAdapter();
