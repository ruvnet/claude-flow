/**
 * Tests for the MAGE-style execution-state-tree prototype
 * (src/ruvector/trajectory-tree.ts) and its opt-in MCP surface
 * (hooks_intelligence_pattern-search strategy:"state-tree").
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TrajectoryTree, getTrajectoryTree, resetTrajectoryTree } from '../src/ruvector/trajectory-tree.js';
import { hooksPatternSearch } from '../src/mcp-tools/hooks-tools.js';

let dir: string;
let persistPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'traj-tree-'));
  persistPath = join(dir, 'tree.json');
  resetTrajectoryTree();
});

afterEach(() => {
  resetTrajectoryTree();
  rmSync(dir, { recursive: true, force: true });
});

function buildThreeLevelTrajectory(tree: TrajectoryTree) {
  // Level 1: session root, Level 2: trajectory, Level 3: steps
  tree.openTrajectory({ sessionId: 'sess-1', trajectoryId: 'traj-A', task: 'Build the feature', agent: 'coder' });
  tree.appendStep({ trajectoryId: 'traj-A', stepId: 'step-1', action: 'read spec', quality: 0.9 });
  tree.appendStep({ trajectoryId: 'traj-A', stepId: 'step-2', action: 'write module', quality: 0.8 });
  tree.appendStep({ trajectoryId: 'traj-A', stepId: 'step-3', action: 'run tests', quality: 0.95 });
}

describe('TrajectoryTree — recallPath', () => {
  it('returns the exact root→current path for a synthetic 3-level trajectory', () => {
    const tree = new TrajectoryTree(persistPath);
    buildThreeLevelTrajectory(tree);

    const recall = tree.recallPath({ sessionId: 'sess-1' });
    expect(recall.path.map(n => n.id)).toEqual(['session:sess-1', 'traj-A', 'step-3']);
    expect(recall.path.map(n => n.kind)).toEqual(['session', 'trajectory', 'step']);
    expect(recall.currentId).toBe('step-3');
    expect(recall.strategy).toBe('state-tree');
  });

  it('returns recent siblings of the current node (oldest→newest, windowed)', () => {
    const tree = new TrajectoryTree(persistPath);
    buildThreeLevelTrajectory(tree);

    const recall = tree.recallPath({ sessionId: 'sess-1', siblingWindow: 2 });
    expect(recall.siblings.map(n => n.id)).toEqual(['step-1', 'step-2']);
  });

  it('honors depth (deepest levels win)', () => {
    const tree = new TrajectoryTree(persistPath);
    buildThreeLevelTrajectory(tree);

    const recall = tree.recallPath({ sessionId: 'sess-1', depth: 2 });
    expect(recall.path.map(n => n.id)).toEqual(['traj-A', 'step-3']);
  });

  it('nests a trajectory started while another is open, and pops on close', () => {
    const tree = new TrajectoryTree(persistPath);
    tree.openTrajectory({ sessionId: 'sess-1', trajectoryId: 'traj-outer', task: 'outer task' });
    tree.openTrajectory({ sessionId: 'sess-1', trajectoryId: 'traj-inner', task: 'inner sub-task' });
    tree.appendStep({ trajectoryId: 'traj-inner', stepId: 'step-i1', action: 'inner work' });

    let recall = tree.recallPath({ sessionId: 'sess-1' });
    expect(recall.path.map(n => n.id)).toEqual(['session:sess-1', 'traj-outer', 'traj-inner', 'step-i1']);

    tree.closeTrajectory({ trajectoryId: 'traj-inner', success: true });
    recall = tree.recallPath({ sessionId: 'sess-1' });
    expect(recall.currentId).toBe('traj-outer');
    expect(recall.path.map(n => n.id)).toEqual(['session:sess-1', 'traj-outer']);
  });

  it('returns an empty path for an unknown session', () => {
    const tree = new TrajectoryTree(persistPath);
    const recall = tree.recallPath({ sessionId: 'nope' });
    expect(recall.path).toEqual([]);
    expect(recall.siblings).toEqual([]);
    expect(recall.currentId).toBeNull();
  });
});

describe('TrajectoryTree — persistence', () => {
  it('round-trips through the JSON snapshot', () => {
    const tree = new TrajectoryTree(persistPath);
    buildThreeLevelTrajectory(tree);
    tree.closeTrajectory({ trajectoryId: 'traj-A', success: true });

    const reloaded = new TrajectoryTree(persistPath);
    expect(reloaded.size).toBe(tree.size);
    const recall = reloaded.recallPath({ sessionId: 'sess-1' });
    // current popped to the trajectory's parent (the session root) on close
    expect(recall.currentId).toBe('session:sess-1');
    expect(recall.path.map(n => n.id)).toEqual(['session:sess-1']);
    // …and the closed trajectory survived the round-trip with its metadata
    const reloadedRecall = reloaded.recallPath({ sessionId: 'sess-1', depth: 1 });
    expect(reloadedRecall.path[0].kind).toBe('session');
  });
});

describe('hooks_intelligence_pattern-search — strategy flag', () => {
  it('default strategy is untouched (no state-tree fields in the response)', async () => {
    // Seed the singleton with a tmp persist path so nothing touches the repo.
    getTrajectoryTree(persistPath);
    const result = await hooksPatternSearch.handler({ query: 'authentication patterns' }) as Record<string, unknown>;
    expect(result.backend).not.toBe('state-tree');
    expect(result.path).toBeUndefined();
    expect(result.strategy).toBeUndefined();
    expect(Array.isArray(result.results)).toBe(true);
  });

  it('strategy:"state-tree" returns the positional path without embedding search', async () => {
    const tree = getTrajectoryTree(persistPath);
    buildThreeLevelTrajectory(tree);

    const result = await hooksPatternSearch.handler({
      query: 'irrelevant for positional recall',
      strategy: 'state-tree',
      sessionId: 'sess-1',
    }) as Record<string, unknown>;

    expect(result.backend).toBe('state-tree');
    expect(result.strategy).toBe('state-tree');
    const path = result.path as Array<{ id: string }>;
    expect(path.map(n => n.id)).toEqual(['session:sess-1', 'traj-A', 'step-3']);
    expect(result.currentId).toBe('step-3');
  });
});
