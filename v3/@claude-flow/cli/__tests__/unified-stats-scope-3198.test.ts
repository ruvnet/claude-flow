import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalCwd = process.cwd();
const project = mkdtempSync(join(tmpdir(), 'ruflo-sona-scope-3198-'));
const statsDir = join(project, '.claude-flow', 'neural');
mkdirSync(statsDir, { recursive: true });
writeFileSync(join(statsDir, 'stats.json'), JSON.stringify({
  trajectoriesRecorded: 30_622,
  patternsLearned: 0,
  signalsProcessed: 0,
  lastAdaptation: null,
}));

afterAll(() => {
  process.chdir(originalCwd);
  rmSync(project, { recursive: true, force: true });
});

describe('#3198 unified learning counters have different lifetimes', () => {
  it('does not call a fresh process-local SONA count drift from persisted history', async () => {
    process.chdir(project);
    vi.resetModules();
    const intel = await import('../src/memory/intelligence.js');
    const init = await intel.initializeIntelligence();
    expect(init.success).toBe(true);

    const stats = await intel.getUnifiedLearningStats();
    expect(stats.global.trajectoriesRecorded).toBe(30_622);
    expect(stats.sona.trajectoriesTotal).toBe(0);
    expect(stats.global.scope).toBe('project-persisted');
    expect(stats.sona.scope).toBe('process-local');
    expect(stats.sona.metric).toBe('recent-buffered-trajectories');
    expect(stats.consistency.sonaTracksGlobal).toBeNull();
    expect(stats.consistency.sonaTracksGlobalDelta).toBeNull();
    expect(stats.consistency.notes.join(' ')).toMatch(/different (scopes|lifetimes)|not comparable/i);
    expect(stats.consistency.notes.join(' ')).not.toMatch(/expected to track within/i);

    // The coordinator's actual stats() key is trajectoryCount. The old
    // aggregator read nonexistent trajectoriesTotal/trajectoriesProcessed keys,
    // so this stayed 0 even after a trajectory completed in this process.
    expect(await intel.recordTrajectory([], 'failure')).toBe(true);
    const after = await intel.getUnifiedLearningStats();
    expect(after.global.trajectoriesRecorded).toBe(30_623);
    expect(after.sona.trajectoriesTotal).toBeGreaterThan(0);
  });
});
