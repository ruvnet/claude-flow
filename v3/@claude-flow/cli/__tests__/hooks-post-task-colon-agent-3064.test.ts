/**
 * Regression guard for #3064 — `hooks_post-task` silently dropped the
 * routing-outcome write when `--agent` contained a colon.
 *
 * The narrow ad-hoc regex `/^[a-zA-Z0-9_-]+$/` at the write gate rejected
 * every Claude Code plugin agent (which are always namespaced
 * `plugin:agent` — e.g. `ruflo-core:reviewer`, `feature-dev:code-explorer`),
 * so any project driving `post-task` from a `PostToolUse:Task` hook fed
 * the router zero usable signal from plugin agents.
 *
 * The canonical `validateIdentifier()` check earlier in the handler
 * already allows `:` and `.` (IDENTIFIER_RE in validate-input.ts), so the
 * redundant narrow regex was simply removed. This test locks in that
 * colon-namespaced agents now produce a routing-outcomes.json append.
 *
 * NOTE: hooks-tools.ts captures `ROUTING_OUTCOMES_PATH = resolve('.') + ...`
 * at module load, so the chdir MUST happen before the dynamic import.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Move cwd into a temp dir BEFORE the dynamic import below runs — otherwise
// the routing-outcomes file gets written into whatever cwd vitest ran from.
const testRoot = mkdtempSync(join(tmpdir(), 'ruflo-3064-'));
const origCwd = process.cwd();
process.chdir(testRoot);

const bridgeRecordFeedback = vi.fn(async () => ({ success: true, controller: 'mock', updated: 1 }));
const bridgeRecordCausalEdge = vi.fn(async () => ({ success: true, controller: 'mock' }));
const bridgeStoreEntry = vi.fn(async () => ({ success: true, controller: 'mock' }));

vi.mock('../src/memory/memory-bridge.js', () => ({
  bridgeRecordFeedback,
  bridgeRecordCausalEdge,
  bridgeStoreEntry,
}));

vi.mock('../src/memory/intelligence.js', () => ({
  recordTrajectory: vi.fn(async () => undefined),
}));
vi.mock('../src/memory/graph-edge-writer.js', () => ({
  insertGraphEdge: vi.fn(async () => undefined),
}));

const { hooksPostTask } = await import('../src/mcp-tools/hooks-tools.js');

const outcomesPath = join(testRoot, '.claude-flow', 'routing-outcomes.json');

function readOutcomes(): Array<{ task: string; agent: string; success: boolean }> {
  if (!existsSync(outcomesPath)) return [];
  const raw = JSON.parse(readFileSync(outcomesPath, 'utf-8'));
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.outcomes)) return raw.outcomes;
  return [];
}

beforeAll(() => {
  // Restore cwd for the rest of the test runner — the module has already
  // captured its own path, so it doesn't matter what cwd is now.
  process.chdir(origCwd);
});

beforeEach(() => {
  // Fresh outcomes file per test so counts start at 0.
  mkdirSync(join(testRoot, '.claude-flow'), { recursive: true });
  writeFileSync(outcomesPath, JSON.stringify({ outcomes: [] }));
});

afterAll(() => {
  try { rmSync(testRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('#3064 — hooks_post-task accepts colon-namespaced plugin agents', () => {
  const cases = [
    { label: 'plain identifier (baseline)', agent: 'reviewer' },
    { label: 'hyphenated identifier (baseline)', agent: 'ruflo-core-reviewer' },
    { label: 'colon-namespaced plugin agent (bug case)', agent: 'ruflo-core:reviewer' },
    { label: 'nested colon-namespaced plugin agent', agent: 'feature-dev:code-explorer' },
  ];

  for (const { label, agent } of cases) {
    it(`records the routing outcome for ${label}: "${agent}"`, async () => {
      const taskId = `probe-${agent.replace(/[^a-z0-9]/gi, '_')}`;

      await hooksPostTask.handler({
        taskId,
        task: `test task for ${agent}`,
        agent,
        success: true,
        quality: 0.85,
      });

      const outcomes = readOutcomes();
      expect(outcomes.length).toBe(1);

      const [only] = outcomes;
      expect(only.agent).toBe(agent);
      expect(only.success).toBe(true);
      expect(only.task).toBe(`test task for ${agent}`);
    });
  }
});
