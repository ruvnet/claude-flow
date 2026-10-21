/**
 * session_list computed `total` after applying `limit`, so `session list`
 * printed "Showing 10 of 10 sessions" even when more sessions were saved.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionTools } from '../src/mcp-tools/session-tools.js';

const tool = (name: string) => {
  const t = sessionTools.find(t => t.name === name);
  if (!t) throw new Error(`MCP tool not registered: ${name}`);
  return t;
};

type ListResult = { sessions: Array<{ sessionId: string }>; total: number; limit: number };

describe('session_list total', () => {
  let dir: string;
  let prevCwd: string | undefined;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-session-list-total-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
    const save = tool('session_save').handler;
    for (let i = 0; i < 4; i++) {
      await save({ name: `session ${i}`, includeMemory: false, includeTasks: false, includeAgents: false });
    }
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports every saved session in total, not just the returned page', async () => {
    const result = await tool('session_list').handler({ limit: 2 }) as ListResult;
    expect(result.sessions).toHaveLength(2);
    expect(result.total).toBe(4);
  });

  it('total equals the number of sessions when under the limit', async () => {
    const result = await tool('session_list').handler({}) as ListResult;
    expect(result.sessions).toHaveLength(4);
    expect(result.total).toBe(4);
  });
});
