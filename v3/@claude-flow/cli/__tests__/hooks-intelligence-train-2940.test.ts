/**
 * #2940: `hooks intelligence --train` exited 0 and printed a full success
 * dashboard (Neural Persistence + V3 Performance Gains tables) without ever
 * training anything. The `--train` handler (`hooks_intelligence` MCP tool)
 * declared a `forceTraining` input but never read it — `commands/hooks.ts`'s
 * CLI action just slept 500ms and printed a canned "Training cycle
 * completed". `lastAdaptation` (what `--status` reports as "Last Training")
 * never moved, so it could only ever *age*, no matter how many times
 * `--train` ran — a naive read looked like "the number changed" when it had
 * changed in the wrong direction.
 *
 * Fixed by actually calling `distillLearning()` (memory/intelligence.ts,
 * already existed and already bumps `lastAdaptation` when it runs) from the
 * `hooks_intelligence` handler when `forceTraining` is set, and reporting
 * what happened instead of a fixed message: distilled N patterns, ran with
 * nothing new to distill, or could not run.
 *
 * Black-box against the real built CLI — same pattern as
 * mcp-http-foreground-2984.test.ts — because the bug is in how two command
 * modules communicate a real outcome through the MCP-tool boundary, not
 * pure logic a unit test could isolate.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { tmpdir } from 'os';

const CLI_BIN = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const CLI_BUILT = existsSync(CLI_BIN);

// `output.printWarning` writes to stderr — merge both streams so assertions
// can see a warning-path message the same way a terminal user would.
function cli(args: string[], cwd: string): { out: string; code: number } {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    encoding: 'utf-8',
    timeout: 30_000,
    cwd,
  });
  return { out: `${result.stdout ?? ''}${result.stderr ?? ''}`, code: result.status ?? 1 };
}

function lastTrainingSeconds(statusOut: string): number | null {
  const m = statusOut.match(/Last Training:\s*(?:(\d+)s ago|(Never))/);
  if (!m) return null;
  if (m[2]) return null; // "Never"
  return Number(m[1]);
}

describe.skipIf(!CLI_BUILT)('#2940 hooks intelligence --train actually trains', () => {
  it('moves "Last Training" to ~0s ago instead of only ever aging', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ruflo-2940-'));
    try {
      const init = cli(['memory', 'init'], cwd);
      expect(init.code).toBe(0);

      const before = cli(['hooks', 'intelligence', '--status'], cwd);
      expect(before.code).toBe(0);
      expect(lastTrainingSeconds(before.out)).toBeNull(); // "Never" — no training has run yet

      const trained = cli(['hooks', 'intelligence', '--train'], cwd);
      expect(trained.code).toBe(0);
      // Pre-fix: this printed the exact same "Training cycle completed" no
      // matter what happened. Post-fix: it's conditioned on a real outcome,
      // so it always contains one of these two honest phrases.
      expect(trained.out).toMatch(/Training cycle completed|Training cycle ran/);

      const after = cli(['hooks', 'intelligence', '--status'], cwd);
      expect(after.code).toBe(0);
      const seconds = lastTrainingSeconds(after.out);
      // Pre-fix: still "Never" (lastAdaptation was never written) — the
      // defect this test pins. Post-fix: a fresh, small elapsed time.
      expect(seconds).not.toBeNull();
      expect(seconds as number).toBeLessThan(30);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60_000);
});
