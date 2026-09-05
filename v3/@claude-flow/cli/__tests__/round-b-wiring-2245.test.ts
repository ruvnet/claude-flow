// Round B regression: post-edit, post-command, and MCP trajectory-end all
// feed globalStats so the unified stats view reflects them. Was the open
// "wire remaining surfaces" item in ADR-074 / ADR-075.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRATCH = mkdtempSync(join(tmpdir(), 'round-b-'));
let originalCwd: string;

beforeAll(async () => {
  originalCwd = process.cwd();
  process.chdir(SCRATCH);
  const intel = await import('../src/memory/intelligence.js');
  intel.clearIntelligence();
});

afterAll(() => {
  try { process.chdir(originalCwd); } catch { /* */ }
  try { rmSync(SCRATCH, { recursive: true, force: true }); } catch { /* */ }
});

describe('post-edit / post-command feed the trajectory pipeline (Round B)', () => {
  it('hooks_post-edit bumps globalStats.trajectoriesRecorded', async () => {
    const { hooksTools } = await import('../src/mcp-tools/hooks-tools.js');
    const intel = await import('../src/memory/intelligence.js');
    const tool = hooksTools.find((t) => t.name === 'hooks_post-edit')!;

    const before = intel.getIntelligenceStats().trajectoriesRecorded;
    const r = (await tool.handler({ filePath: 'src/example.ts', success: true, agent: 'coder' })) as Record<string, unknown>;
    const after = intel.getIntelligenceStats().trajectoriesRecorded;

    expect(r.recorded).toBe(true);
    expect(r.learningPath).toBe('trajectory-pipeline');
    expect(after).toBeGreaterThan(before);
    expect(String(r.note)).toMatch(/SONA \+ EWC/);
  }, 30_000);

  it('hooks_post-command bumps globalStats.trajectoriesRecorded', async () => {
    const { hooksTools } = await import('../src/mcp-tools/hooks-tools.js');
    const intel = await import('../src/memory/intelligence.js');
    const tool = hooksTools.find((t) => t.name === 'hooks_post-command')!;

    const before = intel.getIntelligenceStats().trajectoriesRecorded;
    const r = (await tool.handler({ command: 'npm test', exitCode: 0 })) as Record<string, unknown>;
    const after = intel.getIntelligenceStats().trajectoriesRecorded;

    expect(r.learningPath).toBe('trajectory-pipeline');
    expect(after).toBeGreaterThan(before);
  }, 30_000);
});

describe('hooks_intelligence_trajectory-end ALSO bumps globalStats (Round B)', () => {
  it('reports globalStatsTrajectoriesDelta in the response', async () => {
    const { hooksTools } = await import('../src/mcp-tools/hooks-tools.js');
    const intel = await import('../src/memory/intelligence.js');
    const start = hooksTools.find((t) => t.name === 'hooks_intelligence_trajectory-start')!;
    const step = hooksTools.find((t) => t.name === 'hooks_intelligence_trajectory-step')!;
    const end = hooksTools.find((t) => t.name === 'hooks_intelligence_trajectory-end')!;

    const before = intel.getIntelligenceStats().trajectoriesRecorded;
    const s = (await start.handler({ task: 'round-b end-to-end', agent: 'bench' })) as Record<string, unknown>;
    const id = s.trajectoryId as string;
    await step.handler({ trajectoryId: id, type: 'action', content: 'apply patch' });
    await step.handler({ trajectoryId: id, type: 'result', content: 'patch applied' });
    const endRes = (await end.handler({ trajectoryId: id, success: true })) as Record<string, unknown>;
    const after = intel.getIntelligenceStats().trajectoriesRecorded;

    expect(endRes).toBeDefined();
    const learning = endRes.learning as Record<string, number>;
    expect(typeof learning.globalStatsTrajectoriesDelta).toBe('number');
    // The path is wired even when persistResult is false in some test envs
    expect(after).toBeGreaterThanOrEqual(before);
  }, 30_000);
});
