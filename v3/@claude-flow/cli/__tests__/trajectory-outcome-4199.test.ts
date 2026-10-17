import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { forwarded } = vi.hoisted(() => ({ forwarded: vi.fn() }));
vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  return {
    ...actual,
    createRequire: (url: string) => {
      const originalRequire = actual.createRequire(url);
      return (id: string) => id === '@ruvector/ruvllm'
        ? { SonaCoordinator: class { recordTrajectory = forwarded; }, DEFAULT_SONA_CONFIG: {} }
        : originalRequire(id);
    },
  };
});

// Keep this forwarding contract independent of the optional cli-core build.
vi.mock('../src/mcp-tools/types.js', () => ({
  getProjectCwd: () => process.env.CLAUDE_FLOW_CWD!,
}));

let scratch: string;
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'trajectory-outcome-'));
  mkdirSync(join(scratch, '.claude-flow'));
  vi.stubEnv('CLAUDE_FLOW_CWD', scratch);
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});

describe('ruvllm trajectory outcome (#4199)', () => {
  it.each([
    ['success', 1], ['failure', 0], ['partial', 0.5],
  ] as const)('forwards %s with its outcome and reward', async (verdict, reward) => {
    const { recordTrajectory } = await import('../src/memory/intelligence.js');
    forwarded.mockClear();
    expect(await recordTrajectory([
      { type: verdict === 'partial' ? 'route' : 'test', content: `trajectory ${verdict}`, embedding: [1, 0, 0] },
    ], verdict)).toBe(true);
    expect(forwarded).toHaveBeenCalledOnce();
    expect(forwarded).toHaveBeenCalledWith(expect.objectContaining({
      outcome: verdict,
      totalReward: reward,
      steps: [{ type: verdict === 'partial' ? 'route' : 'generate', input: `trajectory ${verdict}`, output: '', durationMs: 0, confidence: reward }],
    }));
  });
});
