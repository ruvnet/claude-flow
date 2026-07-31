/**
 * Regression guard for #2886 — a static TASK_PATTERNS match must not
 * short-circuit the outcome store.
 *
 * `hooks_route` picks the first semantic match clearing `score > 0.4`. Static
 * patterns need only that bar; learned patterns additionally need
 * `support >= 2 && reliability >= 0.75` (#2864). The bug was not that gate —
 * it was that a winning STATIC match skipped `suggestAgentsForTask()`
 * entirely, and that function holds a second learned stage: nearest-neighbour
 * over `.claude-flow/routing-outcomes.json`, gated at >= 2 overlapping
 * keywords. So a static pattern matching on a char-hash similarity score beat
 * an outcome match with 14 shared keywords.
 *
 * Measured on a 76-outcome replay before the fix: static was the least
 * accurate decision path (38%), below keyword-fallback (52%) and learned
 * (70%), while winning routes outright.
 *
 * The fix is deliberately narrow: only REAL evidence (`source:
 * 'outcome-overlap'`) outranks a static pattern. A `KEYWORD_PATTERNS`
 * substring hit still loses to a static semantic match — both are hardcoded
 * guesses, and preferring one over the other has no evidence behind it.
 *
 * These tests write a real `routing-outcomes.json` into a temp cwd, because
 * that file is what `suggestAgentsForTask()`'s second stage reads.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { hooksRoute } = await import('../src/mcp-tools/hooks-tools.js');

let origCwd: string;
let workdir: string;

/** Write outcomes whose keywords overlap `task` by >= 2, all for one agent. */
function seedOutcomes(outcomes: Array<{ task: string; agent: string; keywords: string[] }>) {
  mkdirSync(join(workdir, '.claude-flow'), { recursive: true });
  writeFileSync(
    join(workdir, '.claude-flow', 'routing-outcomes.json'),
    JSON.stringify({
      outcomes: outcomes.map(o => ({
        ...o,
        success: true,
        quality: 0.9,
        timestamp: new Date(0).toISOString(),
      })),
    }),
  );
}

beforeEach(() => {
  origCwd = process.cwd();
  workdir = mkdtempSync(join(tmpdir(), 'ruflo-2886-'));
  process.chdir(workdir);
});

afterEach(() => {
  process.chdir(origCwd);
  try { rmSync(workdir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('#2886 — static patterns must not preempt the outcome store', () => {
  it('prefers an outcome-overlap match over a static pattern, and says so', async () => {
    // "refactor" is a static TASK_PATTERNS keyword routing to architect/coder/reviewer.
    // The outcome store says tasks phrased like this were done by `tester`.
    const task = 'refactor the agency agent pack sync and reinstall the bundled plugins';
    seedOutcomes([
      { task: 'agency agent pack sync reinstall bundled plugins', agent: 'tester',
        keywords: ['agency', 'agent', 'pack', 'sync', 'reinstall', 'bundled', 'plugins'] },
      { task: 'agency agent pack bundled plugins refresh', agent: 'tester',
        keywords: ['agency', 'agent', 'pack', 'bundled', 'plugins', 'refresh'] },
    ]);

    const res: any = await hooksRoute.handler({ task });

    expect(res.matchedPattern).toBe('outcome-overlap');
    expect(res.primaryAgent.type).toBe('tester');
    // The outranked static pattern is named, so the decision is auditable
    // rather than silently different (issue ask #2).
    expect(res.routing.backend).toMatch(/preferred over static/);
  });

  it('leaves learned matches alone — they already carry support/reliability (#2864)', async () => {
    // Six outcomes for one agent build a `learned-coder` pattern that clears
    // support >= 2 and reliability >= 0.75. A learned win must NOT be
    // rerouted through the outcome-overlap branch.
    const kws = ['quantum', 'flux', 'capacitor', 'calibration', 'harness'];
    seedOutcomes(
      Array.from({ length: 6 }, (_, i) => ({
        task: `quantum flux capacitor calibration harness ${i}`,
        agent: 'coder',
        keywords: kws,
      })),
    );

    const res: any = await hooksRoute.handler({
      task: 'quantum flux capacitor calibration harness rebuild',
    });

    // Either a learned pattern wins outright, or nothing clears the score bar
    // and it falls back — but it must never be silently downgraded to static.
    expect(res.matchedPattern).not.toMatch(/^(refactor|feature|testing|security)-task$/);
  });

  it('does NOT let a bare KEYWORD_PATTERNS substring hit outrank a static match', async () => {
    // No outcomes at all -> suggestAgentsForTask can only return source
    // 'keyword' or 'default', neither of which should displace a static
    // semantic match. This pins the narrowness of the fix.
    seedOutcomes([]);

    const res: any = await hooksRoute.handler({
      task: 'refactor the deployment pipeline test coverage',
    });

    expect(res.matchedPattern).not.toBe('outcome-overlap');
  });

  it('still falls back to keyword matching when nothing clears the score bar', async () => {
    seedOutcomes([]);
    const res: any = await hooksRoute.handler({ task: 'zzzz' });
    expect(['keyword-fallback', 'outcome-overlap']).toContain(res.matchedPattern);
    expect(typeof res.primaryAgent.type).toBe('string');
    expect(res.primaryAgent.type.length).toBeGreaterThan(0);
  });
});
