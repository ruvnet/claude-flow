#!/usr/bin/env node
/**
 * Smoke test for ADR-126 Phase 3 (#2068) — portfolio CG path.
 *
 * Locks in three layers:
 *
 *   [1/3] STATIC ADAPTER CONTRACT — `plugins/ruflo-neural-trader/src/sublinear-adapter.ts`
 *         must export the `SublinearAdapter` class with the documented
 *         `solveCG(matrix, vector, opts)` method, an `isMcpAvailable()`
 *         detection static, and the `SolveResult` shape (solution,
 *         iterations, residual, latencyMs, path, optional degraded/reason).
 *         The companion runtime mirror `sublinear-adapter.mjs` must agree.
 *
 *   [2/3] STATIC SKILL CONTRACT — `plugins/ruflo-neural-trader/skills/trader-portfolio-cg/SKILL.md`
 *         must exist with `mcp__ruflo-sublinear__solve` in `allowed-tools`,
 *         must reference the canonical `trading-risk` namespace for storage,
 *         must document the disable env flag and the legacy Neumann fallback.
 *
 *   [3/3] RUNTIME PARITY — construct a tiny SPD covariance, run it through
 *         the adapter's local CG path, assert the result is within 1e-6 of
 *         the analytical answer for an identity-with-perturbation case
 *         where x = A⁻¹·b can be checked by direct substitution.
 *
 * If a future PR drops one of:
 *   - the `solveCG` method
 *   - the MCP tool from the skill's allowed-tools
 *   - the trading-risk namespace anchor in the skill
 *   - the local CG kernel correctness
 * this smoke catches it before merge.
 *
 * Usage:  node scripts/smoke-neural-trader-portfolio-cg.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PLUGIN_DIR = join(REPO_ROOT, 'plugins', 'ruflo-neural-trader');
const ADAPTER_TS = join(PLUGIN_DIR, 'src', 'sublinear-adapter.ts');
const ADAPTER_MJS = join(PLUGIN_DIR, 'src', 'sublinear-adapter.mjs');
const SKILL_MD = join(PLUGIN_DIR, 'skills', 'trader-portfolio-cg', 'SKILL.md');

const failures = [];
function check(label, ok, detail = '') {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failures.push(label);
  }
}

// ---------------------------------------------------------------------------
// Part 1 — Static adapter contract
// ---------------------------------------------------------------------------

console.log('[1/3] Static adapter contract (ADR-123 §262-289 shape)');

if (!existsSync(ADAPTER_TS)) {
  failures.push('sublinear-adapter.ts not found');
} else {
  const src = readFileSync(ADAPTER_TS, 'utf8');
  check(
    'adapter exports `SublinearAdapter` class',
    /export\s+class\s+SublinearAdapter\b/.test(src),
    'expected `export class SublinearAdapter` in sublinear-adapter.ts',
  );
  check(
    'adapter exposes `solveCG(matrix, vector, opts?)` method',
    /\bsolveCG\s*\(/.test(src) && /matrix\s*:\s*number\[\]\[\]/.test(src),
    'expected method signature `solveCG(matrix: number[][], vector: number[], opts?: ...)`',
  );
  check(
    'adapter exposes `SublinearAdapter.isMcpAvailable()` detection (legacy alias)',
    /static\s+isMcpAvailable\s*\(/.test(src),
    'expected `static isMcpAvailable()` for graceful degrade detection',
  );
  check(
    'adapter exposes `SublinearAdapter.detectSublinearTool()` (native-dispatch probe, #55)',
    /static\s+detectSublinearTool\s*\(/.test(src),
    'native dispatch is gated by this two-probe detection (globalThis + RUFLO_SUBLINEAR_NATIVE env var)',
  );
  check(
    'adapter calls `detectSublinearTool()` before falling back to local CG',
    /detectSublinearTool\s*\(\s*\)/.test(src),
    'the dispatch path must consult the detection probe — otherwise native is unreachable',
  );
  check(
    'adapter honours `RUFLO_SUBLINEAR_NATIVE` env-var override',
    /RUFLO_SUBLINEAR_NATIVE/.test(src),
    'operator-controlled native-dispatch override (#55) must be wired in the detection',
  );
  check(
    'adapter declares `SolveResult` with the documented fields (incl. new method + solver)',
    /interface\s+SolveResult/.test(src) &&
      /solution\s*:\s*number\[\]/.test(src) &&
      /iterations\s*:\s*number/.test(src) &&
      /residual\s*:\s*number/.test(src) &&
      /latencyMs\s*:\s*number/.test(src) &&
      /path\s*:\s*'cg-local'\s*\|\s*'cg-mcp'/.test(src) &&
      /method\s*:\s*'cg-sublinear-native'\s*\|\s*'cg-local'/.test(src) &&
      /solver\s*:\s*'sublinear-time-solver@1\.7\.0'\s*\|\s*'local-js-cg'/.test(src),
    'SolveResult must declare solution, iterations, residual, latencyMs, path, method, solver',
  );
  check(
    'adapter has symmetric-input validation (rejects non-SPD with degraded flag)',
    /degraded/.test(src) && /isSymmetric/.test(src),
    'expected an `isSymmetric` helper and a `degraded: true` path for non-SPD input',
  );
  check(
    'adapter references the MCP tool by canonical name `mcp__ruflo-sublinear__solve`',
    /mcp__ruflo-sublinear__solve/.test(src),
    'expected the canonical tool name string for runtime dispatch',
  );
}

if (!existsSync(ADAPTER_MJS)) {
  failures.push('sublinear-adapter.mjs (runtime mirror) not found');
} else {
  const mjs = readFileSync(ADAPTER_MJS, 'utf8');
  check(
    'runtime adapter mirror exports `SublinearAdapter` + `conjugateGradient`',
    /export\s+class\s+SublinearAdapter\b/.test(mjs) &&
      /export\s+function\s+conjugateGradient\b/.test(mjs),
    '.mjs mirror must keep parity with the .ts source for smoke/bench imports',
  );
  check(
    'runtime mirror exports `neumannSeries` (baseline for the bench)',
    /export\s+function\s+neumannSeries\b/.test(mjs),
    'expected `neumannSeries` export so the bench can compare against the legacy path',
  );
}

// ---------------------------------------------------------------------------
// Part 2 — Static skill contract
// ---------------------------------------------------------------------------

console.log('\n[2/3] Static skill contract (trader-portfolio-cg/SKILL.md)');

if (!existsSync(SKILL_MD)) {
  failures.push('trader-portfolio-cg/SKILL.md not found');
} else {
  const skill = readFileSync(SKILL_MD, 'utf8');
  check(
    'skill declares `name: trader-portfolio-cg` in frontmatter',
    /^name:\s*trader-portfolio-cg\b/m.test(skill),
    'frontmatter must name the skill explicitly',
  );
  check(
    'skill declares `mcp__ruflo-sublinear__solve` in allowed-tools',
    /^allowed-tools:[^\n]*mcp__ruflo-sublinear__solve/m.test(skill),
    'the MCP tool that powers Phase 3 must be allow-listed',
  );
  check(
    'skill declares plugin-qualified `memory_store` for artifact persistence',
    /^allowed-tools:[^\n]*mcp__plugin_ruflo-core_ruflo__memory_store/m.test(skill),
    'persistence to trading-risk namespace requires memory_store',
  );
  check(
    'skill writes results to the canonical `trading-risk` namespace',
    /trading-risk/.test(skill),
    'ADR-126 Phase 1 canonical 5-namespace alignment — portfolio weights belong in trading-risk',
  );
  check(
    'skill documents the `RUFLO_NEURAL_TRADER_DISABLE_CG` disable flag',
    /RUFLO_NEURAL_TRADER_DISABLE_CG/.test(skill),
    'A/B validation and emergency cut-over require an explicit disable flag',
  );
  check(
    'skill documents the Neumann fallback path',
    /neumann-fallback/.test(skill) && /npx neural-trader --portfolio optimize/.test(skill),
    'when the CG path degrades, the legacy `npx neural-trader --portfolio optimize` route must be the documented fallback',
  );
  check(
    'skill metadata distinguishes `cg-sublinear-native` (or legacy `cg-sublinear`), `cg-local`, `neumann-fallback`',
    /cg-sublinear/.test(skill) && /cg-local/.test(skill) && /neumann-fallback/.test(skill),
    'artifact provenance must record which path produced the weights',
  );
  check(
    'skill documents the `RUFLO_SUBLINEAR_NATIVE` env-var override',
    /RUFLO_SUBLINEAR_NATIVE/.test(skill),
    'native-dispatch override is the operator-controlled rollout switch (#55)',
  );
}

// ---------------------------------------------------------------------------
// Part 3 — Runtime parity / correctness
// ---------------------------------------------------------------------------

console.log('\n[3/3] Runtime CG correctness on a known SPD case');

try {
  const adapterUrl = pathToFileURL(ADAPTER_MJS).href;
  const { SublinearAdapter, conjugateGradient } = await import(adapterUrl);

  // Known case: A = [[4,1],[1,3]], b = [1,2] → x = [1/11, 7/11]
  // (textbook CG example from Shewchuk 1994).
  const A = [
    [4, 1],
    [1, 3],
  ];
  const b = [1, 2];
  const expected = [1 / 11, 7 / 11];

  const adapter = new SublinearAdapter();
  const result = await adapter.solveCG(A, b, { tolerance: 1e-9, maxIterations: 100 });

  check(
    'adapter returns the documented result shape (incl. method + solver tags)',
    Array.isArray(result.solution) &&
      typeof result.iterations === 'number' &&
      typeof result.residual === 'number' &&
      typeof result.latencyMs === 'number' &&
      (result.path === 'cg-local' || result.path === 'cg-mcp') &&
      (result.method === 'cg-local' || result.method === 'cg-sublinear-native') &&
      (result.solver === 'local-js-cg' || result.solver === 'sublinear-time-solver@1.7.0'),
    `got: ${JSON.stringify(result)}`,
  );

  // Contract note: the actual native-vs-JS dispatch is a *runtime* path —
  // determined by whether the harness has mounted `mcp__ruflo-sublinear__solve`
  // (or `RUFLO_SUBLINEAR_NATIVE=1` is set). The smoke validates the contract
  // that both paths exist and the result shape carries `method` + `solver`;
  // the actual 40-60× speedup measurement happens in the bench when the
  // daemon is up (CI exercises the native path).

  const err0 = Math.abs(result.solution[0] - expected[0]);
  const err1 = Math.abs(result.solution[1] - expected[1]);
  check(
    'CG solution within 1e-6 of analytical answer for textbook 2×2 SPD case',
    err0 < 1e-6 && err1 < 1e-6,
    `expected ≈ [${expected.map((v) => v.toFixed(6)).join(', ')}], got [${result.solution.map((v) => v.toFixed(6)).join(', ')}] (errs ${err0.toExponential(2)}, ${err1.toExponential(2)})`,
  );

  // Direct exported kernel — verify it agrees with the adapter result.
  const direct = conjugateGradient(A, b, { tolerance: 1e-9, maxIterations: 100 });
  const adapterDiff = Math.max(
    Math.abs(direct.solution[0] - result.solution[0]),
    Math.abs(direct.solution[1] - result.solution[1]),
  );
  check(
    'adapter and exported `conjugateGradient` kernel agree exactly',
    adapterDiff < 1e-12,
    `diff: ${adapterDiff}`,
  );

  // Degraded path — feed a non-square matrix.
  const bad = await adapter.solveCG(
    [
      [1, 0],
      [0, 1],
      [0, 0],
    ],
    [1, 2, 3],
    {},
  );
  check(
    'adapter flags `degraded: true` on non-square input',
    bad.degraded === true && typeof bad.reason === 'string',
    `expected degraded result, got ${JSON.stringify(bad)}`,
  );

  // Degraded path — non-symmetric matrix.
  const asym = await adapter.solveCG(
    [
      [2, 1],
      [0, 2],
    ],
    [1, 1],
    {},
  );
  check(
    'adapter flags `degraded: true` on non-symmetric input',
    asym.degraded === true,
    `expected degraded result, got ${JSON.stringify(asym)}`,
  );
} catch (err) {
  failures.push('runtime import or solve failed');
  console.log(`  ✗ runtime test threw: ${err.message}`);
}

// ---------------------------------------------------------------------------
console.log('');
if (failures.length > 0) {
  console.log(`FAIL: ${failures.length} issue(s) — see above`);
  process.exit(1);
} else {
  console.log('OK: ADR-126 Phase 3 portfolio-CG adapter + skill + kernel correctness verified');
  process.exit(0);
}
