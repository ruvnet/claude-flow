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
 * keywords.
 *
 * The fix is deliberately narrow: only REAL evidence (`source:
 * 'outcome-overlap'`) outranks a static pattern. A `KEYWORD_PATTERNS`
 * substring hit still loses — both are hardcoded guesses, and preferring one
 * over the other has no evidence behind it.
 *
 * ⚠️ TWO TRAPS, both of which silently made an earlier draft of this file
 * vacuous. They are why the module is imported INSIDE each case rather than
 * at the top, and why the task strings look the way they do.
 *
 *  1. `ROUTING_OUTCOMES_PATH` (hooks-tools.ts) is a MODULE-LEVEL const:
 *
 *         const ROUTING_OUTCOMES_PATH = join(resolve('.'), '.claude-flow/...')
 *
 *     It is frozen at IMPORT time. A `process.chdir()` in `beforeEach` runs
 *     after the top-level `await import(...)`, so the seeded fixture is never
 *     read and the outcome stage can never fire. Both the read (:226) and the
 *     write (:240) use that same frozen const, so they agree with each other —
 *     the only consequence is that a test cannot redirect either after import.
 *     Note the sibling `hooks-post-task-...-2786.test.ts` uses exactly that
 *     top-level-import shape and IS correct, but for a reason that does not
 *     transfer: it asserts on `.claude-flow/memory/store.json`, built from a
 *     relative const and resolved inside the handler (`MEMORY_DIR` :493,
 *     `resolve(MEMORY_DIR)` :1636), so chdir does redirect that one.
 *     So here: chdir FIRST, then `vi.resetModules()`, then import.
 *
 *  2. `suggestAgentsForTask()` checks `KEYWORD_PATTERNS` substrings BEFORE the
 *     outcome stage and returns immediately on a hit. `refactor`, `test`,
 *     `fix`, `api`, `security`, `memory`, `deploy` … are all in that table, so
 *     a task containing one can never reach the branch under test. Cases that
 *     must reach it use keyword-free task strings; the case that pins the
 *     narrowness deliberately uses a keyword-bearing one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let origCwd: string;
let workdir: string;

/** Write outcomes into the temp cwd. Must be called BEFORE `load()`. */
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

/** Import hooks-tools AFTER the cwd is set — see trap 1 in the header. */
async function load() {
  vi.resetModules();
  return await import('../src/mcp-tools/hooks-tools.js');
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
    // Deliberately free of every KEYWORD_PATTERNS substring (trap 2), so the
    // outcome stage is actually reachable. The store says tasks phrased like
    // this were done by `tester`; a static pattern would say otherwise.
    const task = 'agency agent pack sync reinstall the bundled plugins';
    seedOutcomes([
      { task: 'agency agent pack sync reinstall bundled plugins', agent: 'tester',
        keywords: ['agency', 'agent', 'pack', 'sync', 'reinstall', 'bundled', 'plugins'] },
      { task: 'agency agent pack bundled plugins refresh', agent: 'tester',
        keywords: ['agency', 'agent', 'pack', 'bundled', 'plugins', 'refresh'] },
    ]);

    const { hooksRoute } = await load();
    const res: any = await (hooksRoute as any).handler({ task });

    expect(res.matchedPattern).toBe('outcome-overlap');
    expect(res.primaryAgent.type).toBe('tester');
    // The outranked static pattern is named, so the decision is auditable
    // rather than silently different (issue ask #2).
    expect(res.routing.backend).toMatch(/preferred over static \S+/);
  });

  it('leaves learned matches alone — they already carry support/reliability (#2864)', async () => {
    // Six outcomes for one agent build a `learned-coder` pattern clearing
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

    const { hooksRoute } = await load();
    // ⚠️ The task string is load-bearing and was chosen by measurement, not
    // taste. Semantic scoring is a char-hash, so which pattern tops the list
    // is sensitive to words that carry no meaning here: the same store and the
    // same five keywords give `learned-coder` for '... harness run' but a
    // static `security-task` for '... harness rebuild'. Only the former puts a
    // LEARNED match on top, which is the precondition this case needs. It is
    // also free of every KEYWORD_PATTERNS substring, so the outcome branch is
    // genuinely reachable — otherwise the case would pass for the wrong reason.
    const res: any = await (hooksRoute as any).handler({
      task: 'quantum flux capacitor calibration harness run',
    });

    // A learned pattern must win outright, and must not be rerouted through
    // the outcome-overlap branch. Removing the `semanticIsLearned` guard in
    // hooksRoute turns this into 'outcome-overlap' — the #2864 regression.
    expect(res.matchedPattern).toMatch(/^learned-/);
    expect(res.primaryAgent.type).toBe('coder');
  });

  it('does NOT let a bare KEYWORD_PATTERNS substring hit outrank a static match', async () => {
    // An EMPTY but reachable outcome store: suggestAgentsForTask can only
    // return source 'keyword' (the task contains `refactor` and `test`) or
    // 'default'. Neither may displace a static semantic match. This pins the
    // narrowness — the aggressive variant would turn this into
    // 'outcome-overlap' or a keyword agent set.
    seedOutcomes([]);

    const { hooksRoute } = await load();
    const res: any = await (hooksRoute as any).handler({
      task: 'refactor the deployment pipeline test coverage',
    });

    expect(res.matchedPattern).not.toBe('outcome-overlap');
    expect(res.matchedPattern).toMatch(/-task$/);
  });

  it('still falls back to keyword matching when nothing clears the score bar', async () => {
    seedOutcomes([]);
    const { hooksRoute } = await load();
    const res: any = await (hooksRoute as any).handler({ task: 'zzzz' });
    expect(['keyword-fallback', 'outcome-overlap']).toContain(res.matchedPattern);
    expect(typeof res.primaryAgent.type).toBe('string');
    expect(res.primaryAgent.type.length).toBeGreaterThan(0);
  });
});
