// Cross-process learning-stats persistence regression suite.
//
// Symptom (field report): `ruvllm_status` / `hooks_intelligence_stats` showed
// `trajectories: 0` even though hooks and a long-running daemon had been
// recording learning signals for hours. Root causes covered here:
//
//   1. CLOBBER — `savePersistedStats()` wrote the *process-local* globalStats
//      snapshot over `.claude-flow/neural/stats.json`. Any process that never
//      called initializeIntelligence() (e.g. memory-bridge's
//      recordSignalProcessed() path, which persists every 16 writes) wrote
//      `trajectoriesRecorded: 0` over the real count. Two long-lived processes
//      (MCP server + daemon) likewise overwrote each other's increments.
//   2. READ — getIntelligenceStats() never loaded stats.json unless the
//      process had initialised intelligence, so a fresh status process
//      reported 0 regardless of what was on disk.
//   3. PATH — the neural data dir ignored CLAUDE_FLOW_CWD (the project-root
//      override every MCP tool honours via getProjectCwd()).
//
// Each process is simulated with vi.resetModules() + a fresh dynamic import,
// which gives an independent module instance (independent globalStats).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Intel = typeof import('../src/memory/intelligence.js');

let scratch: string;
let originalCwd: string;
let savedEnv: string | undefined;

async function freshProcess(): Promise<Intel> {
  vi.resetModules();
  return (await import('../src/memory/intelligence.js')) as Intel;
}

function statsPath(root = scratch): string {
  return join(root, '.claude-flow', 'neural', 'stats.json');
}

function readStats(root = scratch): Record<string, number> {
  return JSON.parse(readFileSync(statsPath(root), 'utf-8'));
}

// Pre-embedded step: keeps recordTrajectory off the embedding-model path.
const step = (content: string) => ({
  type: 'result' as const,
  content,
  embedding: Array.from({ length: 16 }, (_, i) => ((i * 7 + content.length) % 11) / 11),
  timestamp: Date.now(),
});

beforeEach(() => {
  originalCwd = process.cwd();
  savedEnv = process.env.CLAUDE_FLOW_CWD;
  delete process.env.CLAUDE_FLOW_CWD;
  scratch = mkdtempSync(join(tmpdir(), 'learn-xproc-'));
  mkdirSync(join(scratch, '.claude-flow', 'neural'), { recursive: true });
  process.chdir(scratch);
});

afterEach(() => {
  try { process.chdir(originalCwd); } catch { /* best-effort */ }
  if (savedEnv === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = savedEnv;
  try { rmSync(scratch, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('learning stats survive cross-process writers', () => {
  it('an uninitialised signal writer does not reset persisted trajectory counts', async () => {
    writeFileSync(statsPath(), JSON.stringify({
      trajectoriesRecorded: 42, patternsLearned: 7, signalsProcessed: 3, lastAdaptation: 1000,
    }));

    // e.g. a memory-bridge write path: never calls initializeIntelligence().
    const intel = await freshProcess();
    for (let i = 0; i < 16; i++) intel.recordSignalProcessed(); // triggers a persist
    intel.flushIntelligenceStats();

    const disk = readStats();
    expect(disk.trajectoriesRecorded).toBe(42);
    expect(disk.patternsLearned).toBe(7);
    expect(disk.signalsProcessed).toBe(3 + 16);
  });

  it('two concurrent long-lived processes both contribute their trajectories', async () => {
    const a = await freshProcess();
    await a.initializeIntelligence();
    const b = await freshProcess();
    await b.initializeIntelligence();

    expect(await a.recordTrajectory([step('daemon worker map done')], 'success')).toBe(true);
    expect(await b.recordTrajectory([step('mcp hook post-task')], 'success')).toBe(true);
    expect(await a.recordTrajectory([step('daemon worker audit done')], 'failure')).toBe(true);

    expect(readStats().trajectoriesRecorded).toBe(3);
  });

  it('a fresh read-only status process reports the persisted trajectory count', async () => {
    writeFileSync(statsPath(), JSON.stringify({
      trajectoriesRecorded: 135, patternsLearned: 9, signalsProcessed: 40, lastAdaptation: 2000,
    }));
    const intel = await freshProcess();
    const s = intel.getIntelligenceStats();
    expect(s.trajectoriesRecorded).toBe(135);
    expect(s.signalsProcessed).toBe(40);
    expect(s.lastAdaptation).toBe(2000);
  });

  it('honours CLAUDE_FLOW_CWD for the neural data dir (same rule as getProjectCwd)', async () => {
    const project = mkdtempSync(join(tmpdir(), 'learn-proj-'));
    try {
      mkdirSync(join(project, '.claude-flow'), { recursive: true });
      process.env.CLAUDE_FLOW_CWD = project;
      const intel = await freshProcess();
      expect(intel.getNeuralDataDir()).toBe(join(project, '.claude-flow', 'neural'));
      await intel.initializeIntelligence();
      await intel.recordTrajectory([step('env-rooted')], 'success');
      expect(existsSync(statsPath(project))).toBe(true);
      expect(readStats(project).trajectoriesRecorded).toBe(1);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('ruvllm_status surfaces the persisted cross-process count', () => {
  it('reports native.trajectoriesRecorded from stats.json in a fresh MCP process', async () => {
    writeFileSync(statsPath(), JSON.stringify({
      trajectoriesRecorded: 135, patternsLearned: 0, signalsProcessed: 0, lastAdaptation: null,
    }));
    vi.resetModules();
    vi.doMock('../src/ruvector/ruvllm-wasm.js', () => ({
      getRuvllmStatus: vi.fn().mockResolvedValue({ available: false, initialized: false }),
      initRuvllmWasm: vi.fn(),
    }));
    vi.doMock('../src/memory/sona-optimizer.js', () => ({
      getSONAStats: vi.fn().mockResolvedValue({ _contrastiveTrainer: 'unavailable' }),
    }));
    // Input validators are irrelevant to ruvllm_status (no args); stubbed so
    // the test does not depend on a built @claude-flow/cli-core dist.
    vi.doMock('../src/mcp-tools/validate-input.js', () => ({
      validateIdentifier: vi.fn(() => ({ valid: true })),
      validateText: vi.fn(() => ({ valid: true })),
    }));
    try {
      const { ruvllmWasmTools } = await import('../src/mcp-tools/ruvllm-tools.js');
      const tool = ruvllmWasmTools.find((t) => t.name === 'ruvllm_status')!;
      const res = (await tool.handler({})) as { content: Array<{ text: string }> };
      const data = JSON.parse(res.content[0].text);
      expect(data.native.trajectoriesRecorded).toBe(135);
      // process-local buffer field is unchanged (still present)
      expect(data.native).toHaveProperty('trajectories');
    } finally {
      vi.doUnmock('../src/ruvector/ruvllm-wasm.js');
      vi.doUnmock('../src/memory/sona-optimizer.js');
      vi.doUnmock('../src/mcp-tools/validate-input.js');
    }
  });
});
