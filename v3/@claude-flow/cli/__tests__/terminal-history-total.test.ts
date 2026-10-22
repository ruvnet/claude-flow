/**
 * terminal_history without a sessionId computed `total` after applying
 * `limit`/`offset`, so it reported the size of the returned page instead of
 * the number of stored entries (the single-session branch already counts
 * every entry).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { terminalTools } from '../src/mcp-tools/terminal-tools.js';

const historyTool = terminalTools.find(t => t.name === 'terminal_history')!;

type HistoryResult = { history: Array<{ command: string; sessionId?: string }>; total: number };

const entry = (command: string, minute: number) => ({
  command,
  output: '',
  exitCode: 0,
  timestamp: `2026-01-01T00:0${minute}:00.000Z`,
});

const session = (id: string, history: ReturnType<typeof entry>[]) => ({
  id,
  name: id,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastActivity: '2026-01-01T00:00:00.000Z',
  workingDir: '/',
  history,
  env: {},
});

describe('terminal_history total', () => {
  let dir: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-terminal-history-total-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
    const storeDir = join(dir, '.claude-flow', 'terminals');
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(join(storeDir, 'store.json'), JSON.stringify({
      version: '3.0.0',
      sessions: {
        'term-a': session('term-a', [entry('echo 1', 1), entry('echo 3', 3)]),
        'term-b': session('term-b', [entry('echo 2', 2)]),
      },
    }));
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  it('counts every stored entry across sessions, not just the returned page', async () => {
    const result = await historyTool.handler({ limit: 2 }) as HistoryResult;
    expect(result.history.map(h => h.command)).toEqual(['echo 3', 'echo 2']);
    expect(result.total).toBe(3);
  });

  it('keeps the total when an offset skips entries', async () => {
    const result = await historyTool.handler({ limit: 2, offset: 2 }) as HistoryResult;
    expect(result.history.map(h => h.command)).toEqual(['echo 1']);
    expect(result.total).toBe(3);
  });

  it('matches the single-session branch, which already counts the whole history', async () => {
    const result = await historyTool.handler({ sessionId: 'term-a', limit: 1 }) as HistoryResult;
    expect(result.history).toHaveLength(1);
    expect(result.total).toBe(2);
  });
});
