/**
 * Regression guard for ruvnet/ruflo#4300 — `agent spawn --name` was echoed
 * by the CLI but never persisted: the CLI sent the name only as
 * `metadata.name`, and the `agent_spawn` handler never read it, so the
 * AgentRecord in `.claude-flow/agents/store.json` had no `name` and
 * ruflo-console could only label agents by type.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentTools } from '../src/mcp-tools/agent-tools.js';

const tool = (name: string) => {
  const t = agentTools.find(t => t.name === name);
  if (!t) throw new Error(`MCP tool not registered: ${name}`);
  return t;
};

function readStoredAgents(dir: string): Record<string, { name?: string; agentType: string }> {
  const raw = JSON.parse(readFileSync(join(dir, '.claude-flow', 'agents', 'store.json'), 'utf8'));
  return raw.agents;
}

describe('#4300 — agent_spawn persists the agent name', () => {
  let dir: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-4300-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores a top-level name and reports it from agent_list and agent_status', async () => {
    const spawned = await tool('agent_spawn').handler({
      agentType: 'coordinator',
      name: 'game-director',
    }) as { success: boolean; agentId: string; name?: string };

    expect(spawned.success).toBe(true);
    expect(spawned.name).toBe('game-director');
    expect(readStoredAgents(dir)[spawned.agentId].name).toBe('game-director');

    const list = await tool('agent_list').handler({}) as { agents: Array<{ agentId: string; name?: string }> };
    expect(list.agents.find(a => a.agentId === spawned.agentId)?.name).toBe('game-director');

    const status = await tool('agent_status').handler({ agentId: spawned.agentId }) as { name?: string };
    expect(status.name).toBe('game-director');
  });

  it('falls back to metadata.name, which older CLI builds send', async () => {
    const spawned = await tool('agent_spawn').handler({
      agentType: 'architect',
      metadata: { name: 'technical-director', capabilities: [] },
    }) as { success: boolean; agentId: string };

    expect(spawned.success).toBe(true);
    expect(readStoredAgents(dir)[spawned.agentId].name).toBe('technical-director');
  });

  it('leaves name off the record when none is given', async () => {
    const spawned = await tool('agent_spawn').handler({ agentType: 'coder' }) as { agentId: string };
    expect(readStoredAgents(dir)[spawned.agentId]).not.toHaveProperty('name');
  });

  it('rejects a non-string name', async () => {
    const spawned = await tool('agent_spawn').handler({ agentType: 'coder', name: 42 }) as { success: boolean; error?: string };
    expect(spawned.success).toBe(false);
    expect(spawned.error).toMatch(/name must be a string/);
  });
});
