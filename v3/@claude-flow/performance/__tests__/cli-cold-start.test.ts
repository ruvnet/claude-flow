/**
 * Regression guard for the 2026-09-05 dream-cycle finding: the CLI
 * cold-start "benchmark" suite never called its own real, spawn-based
 * measurement function — every reported number (including a hardcoded
 * "V2 vs V3 Speedup") came from setTimeout() delays with no real code
 * behind them.
 *
 * Before the fix, `measureColdStart`/`runRealColdStartMeasurement` were
 * not exported at all, so this file fails to type-check / import against
 * the pre-fix source — that is the discriminating "baseline fails"
 * evidence for tonight's evaluation, alongside the assertions below.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import {
  measureColdStart,
  runRealColdStartMeasurement,
  CLI_BIN_PATH,
} from '../benchmarks/startup/cli-cold-start.bench.js';

describe('CLI cold start: real measurement (not synthetic)', () => {
  it('CLI_BIN_PATH resolves to a real file on disk', () => {
    expect(existsSync(CLI_BIN_PATH)).toBe(true);
    expect(CLI_BIN_PATH).toMatch(/cli[\\/]bin[\\/]cli\.js$/);
  });

  it('measureColdStart spawns a real child process and returns a plausible duration', async () => {
    const durationMs = await measureColdStart('node', ['-e', 'process.exit(0)']);
    expect(durationMs).toBeGreaterThan(0);
    expect(durationMs).toBeLessThan(10_000); // same ceiling as the function's own timeout
  }, 15_000);

  it('runRealColdStartMeasurement produces one real sample per iteration', async () => {
    const result = await runRealColdStartMeasurement(3);
    expect(result.samples).toHaveLength(3);
    for (const sample of result.samples) {
      expect(sample).toBeGreaterThan(0);
    }
    expect(result.mean).toBeGreaterThan(0);
    expect(result.min).toBeLessThanOrEqual(result.mean);
    expect(result.max).toBeGreaterThanOrEqual(result.mean);
  }, 30_000);

  it('does not reintroduce a hardcoded/deterministic-by-construction speedup benchmark', () => {
    const source = readFileSync(
      new URL('../benchmarks/startup/cli-cold-start.bench.ts', import.meta.url),
      'utf-8'
    );
    // The removed benchmark paired these two exact delays with no real code
    // between them, guaranteeing ~5.00x on every run. Guard against silently
    // re-adding that specific fabricated-by-construction pattern (matched by
    // its `runner.run()` identifiers, not by prose that merely discusses it).
    expect(source).not.toMatch(/setTimeout\(resolve,\s*100\)/);
    expect(source).not.toContain("'v2-cold-start-simulation'");
    expect(source).not.toContain("'v3-cold-start-simulation'");
  });
});
