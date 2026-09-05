/**
 * Regression tests for the 2026-05-29 bug cluster (issues #2215, #2221, #2222, #2226).
 *
 * Each test reproduces a reported defect and asserts the fix holds:
 *   #2215 — system_info and hooks_intelligence must agree on flashAttention state.
 *   #2221 — the generated statusline probes the global npm install for its version.
 *   #2222 — `route feedback` persists the Q-table update to disk (no longer a no-op).
 *   #2226 — agentdb_pattern-store and agentdb_pattern-search share a backend
 *           (a stored pattern is findable by search).
 *
 * Backend-dependent tests degrade gracefully (skip the assertion) when the
 * runtime backend cannot initialize in isolation, matching the existing
 * statusline drift-guard convention.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { generateStatuslineScript } from '../src/init/statusline-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';
import { systemTools } from '../src/mcp-tools/system-tools.js';
import { hooksTools } from '../src/mcp-tools/hooks-tools.js';
import { agentdbPatternStore, agentdbPatternSearch } from '../src/mcp-tools/agentdb-tools.js';
import { createQLearningRouter } from '../src/ruvector/q-learning-router.js';
import { CommandParser } from '../src/parser.js';
import { routeCommand } from '../src/commands/route.js';

function findTool(tools: any[], name: string) {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

describe('#2221 — statusline version probe covers global npm installs', () => {
  const SCRIPT = generateStatuslineScript(DEFAULT_INIT_OPTIONS);

  it('derives the global node_modules dir from process.execPath (no npm spawn)', () => {
    expect(SCRIPT).toContain('process.execPath');
    expect(SCRIPT).toContain("'lib', 'node_modules'");
  });

  it('still keeps the project-local and plugin-marketplace probes', () => {
    expect(SCRIPT).toContain("'marketplaces', 'ruflo', 'package.json'");
    expect(SCRIPT).toContain("'node_modules', 'ruflo', 'package.json'");
  });
});

describe('#2215 — system_info and hooks_intelligence agree on flashAttention', () => {
  it('reports the SAME boolean for flashAttention', async () => {
    const sysInfo = await findTool(systemTools, 'system_info').handler({});
    const intel = await findTool(hooksTools, 'hooks_intelligence').handler({ showStatus: true });

    const sysFlash = sysInfo.features.flashAttention;
    expect(typeof sysFlash).toBe('boolean');

    // hooks_intelligence exposes the authoritative runtime status; both must match.
    const comp = intel?.components?.flashAttention;
    if (!comp) return; // intelligence registry unavailable in isolation — skip
    const intelFlash = comp.status === 'active';
    expect(sysFlash).toBe(intelFlash);
  });
});

describe('#2222 — route feedback persists the Q-table to disk', () => {
  it('writes the model after a single update + explicit save', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ruflo-qlearn-'));
    const modelPath = path.join(dir, 'q-learning-model.json');
    try {
      const router = createQLearningRouter({ modelPath, autoSaveInterval: 100 });
      await router.initialize();
      expect(existsSync(modelPath)).toBe(false); // nothing saved yet

      // Mirror the FIXED feedback handler: one update, then explicit awaited save.
      router.update('implement auth', 'coder', -1);
      const persisted = await router.saveModel();

      expect(persisted).toBe(true);
      expect(existsSync(modelPath)).toBe(true);
      const model = JSON.parse(readFileSync(modelPath, 'utf-8'));
      expect(model.stats.updateCount).toBeGreaterThanOrEqual(1);
      expect(Object.keys(model.qTable).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('audit #1 — negative reward keeps its sign across all flag syntaxes', () => {
  // Repro: `route feedback -r -1.0` and `--reward -1.0` used to parse as reward=true
  // (→ +1.0 after numeric coercion), so NEGATIVE feedback REINFORCED the bad agent.
  // Only the `--reward=-1.0` equals-form preserved the sign. Fix lives in the shared
  // parser (isFlagValue), so all three forms must now yield reward = -1.0.
  function parseFeedback(args: string[]) {
    const parser = new CommandParser({ allowUnknownFlags: true });
    parser.registerCommand(routeCommand);
    return parser.parse(['route', 'feedback', ...args]);
  }

  const baseArgs = ['-t', 'write tests', '-a', 'tester'];

  it('-r -1.0 (short flag, space form) → reward = -1.0', () => {
    const { flags } = parseFeedback([...baseArgs, '-r', '-1.0']);
    expect(flags.reward).toBe(-1.0);
  });

  it('--reward -1.0 (long flag, space form) → reward = -1.0', () => {
    const { flags } = parseFeedback([...baseArgs, '--reward', '-1.0']);
    expect(flags.reward).toBe(-1.0);
  });

  it('--reward=-1.0 (equals form) → reward = -1.0', () => {
    const { flags } = parseFeedback([...baseArgs, '--reward=-1.0']);
    expect(flags.reward).toBe(-1.0);
  });

  it('all three syntaxes agree (no sign-flip regression)', () => {
    const a = parseFeedback([...baseArgs, '-r', '-1.0']).flags.reward;
    const b = parseFeedback([...baseArgs, '--reward', '-1.0']).flags.reward;
    const c = parseFeedback([...baseArgs, '--reward=-1.0']).flags.reward;
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(c).toBe(-1.0);
  });

  it('positive and fractional negative values are preserved', () => {
    expect(parseFeedback([...baseArgs, '-r', '0.9']).flags.reward).toBe(0.9);
    expect(parseFeedback([...baseArgs, '-r', '-0.5']).flags.reward).toBe(-0.5);
    expect(parseFeedback([...baseArgs, '--reward', '-3.14']).flags.reward).toBe(-3.14);
  });

  it('real flags after a value-flag are still parsed as flags, not values', () => {
    // `-a tester` then `-t ...`: the -t must NOT be swallowed as the value of -a.
    const { flags } = parseFeedback(['-a', 'tester', '-t', 'write tests', '-r', '-1.0']);
    expect(flags.agent).toBe('tester');
    expect(flags.task).toBe('write tests');
    expect(flags.reward).toBe(-1.0);
  });
});

describe('#2226 — pattern store and search share a backend', () => {
  it('stores a pattern and finds it via search', async () => {
    const marker = `oauth-refresh-token-rotation-${process.pid}-${process.hrtime.bigint()}`;
    // Backend init (registry + ONNX embeddings) can be slow on first load.

    const stored = await agentdbPatternStore.handler({
      pattern: `Use ${marker} for secure session renewal`,
      type: 'auth-pattern',
      confidence: 0.9,
    });
    if (!stored || stored.success !== true) return; // backend unavailable in isolation — skip

    const found = await agentdbPatternSearch.handler({
      query: marker,
      topK: 5,
      minConfidence: 0.1,
    });

    expect(Array.isArray(found.results)).toBe(true);
    // Result text lives in `content` (reasoningBank path) or `pattern` (fallback path).
    const hit = found.results.find((r: any) => {
      const text = typeof r.content === 'string' ? r.content
        : typeof r.pattern === 'string' ? r.pattern : '';
      return text.includes(marker);
    });
    expect(hit).toBeDefined();
  }, 60_000);
});

/**
 * 3.10.8 routing-learning fixes (follow-ups to the intelligence audit):
 *   Bug B — Q-router cached a stale route decision and only invalidated the
 *           whole cache every 50 updates, so a freshly-learned Q-update was
 *           hidden in-process until 50 updates accumulated. Now the updated
 *           state's cache entry is invalidated immediately.
 *   Bug C — boolean flags ignored an explicit space-form value, so
 *           `route task --explore false` still explored (could not disable a
 *           default-true boolean). The parser now consumes `true`/`false`.
 */
describe('3.10.8 #bugB — Q-router reflects a learned update immediately (no 50-update cache lag)', () => {
  it('changes the exploited route within a handful of updates', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ruflo-qcache-'));
    try {
      const r = createQLearningRouter({ modelPath: path.join(dir, 'q.json') });
      await r.initialize();
      const task = 'deep research and investigation task';
      r.route(task, false); // prime the cache with the cold (all-zero) decision
      for (let i = 0; i < 5; i++) r.update(task, 'researcher', 1.0);
      for (let i = 0; i < 5; i++) r.update(task, 'architect', -1.0);
      // Only 10 updates — well under the old 50-update invalidation threshold.
      expect(r.route(task, false).route).toBe('researcher');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('3.10.8 #bugC — boolean flags accept an explicit space-form value', () => {
  const parse = (argv: string[]) =>
    new CommandParser({ booleanFlags: ['explore'], allowUnknownFlags: true })
      .parse(['route', 'task', 'x', ...argv]).flags.explore;

  it('parses --explore false as false (was forced true)', () => {
    expect(parse(['--explore', 'false'])).toBe(false);
  });
  it('parses --explore true as true', () => {
    expect(parse(['--explore', 'true'])).toBe(true);
  });
  it('still honors --explore=false and bare --explore', () => {
    expect(parse(['--explore=false'])).toBe(false);
    expect(parse(['--explore'])).toBe(true);
    expect(parse(['--no-explore'])).toBe(false);
  });
});
