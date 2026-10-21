import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { sessionCommand } from '../src/commands/session.js';
import { callMCPTool } from '../src/mcp-client.js';

interface SavedSession { sessionId: string }

describe('session YAML export through the public command', () => {
  let root: string;
  let previous: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ruflo-session-yaml-'));
    previous = process.cwd();
    process.chdir(root);
  });

  afterEach(() => {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  });

  it.each([
    ['true', 'plain description'],
    ['00123', 'first line\nsecond line # comment'],
    ['null', 'path: "quoted" and \\backslash'],
    ['normal', 'retain # this text'],
  ])('preserves the saved strings for %s', async (name, description) => {
    const saved = await callMCPTool<SavedSession>('session_save', {
      name, description, includeMemory: false, includeTasks: false, includeAgents: false,
    });
    const snapshot = await callMCPTool<{ data: unknown }>('session_export', {
      sessionId: saved.sessionId,
    });
    const action = sessionCommand.subcommands?.find(command => command.name === 'export')?.action;
    if (!action) throw new Error('session export action is unavailable');
    const result = await action({
      args: [saved.sessionId],
      flags: { _: [], format: 'yaml', output: 'export.yaml', 'include-memory': false },
      cwd: root, interactive: false,
    });
    expect(result?.success).toBe(true);
    expect(parse(readFileSync(join(root, 'export.yaml'), 'utf8'))).toEqual(snapshot.data);
  });

  it('retains the JSON export format', async () => {
    const saved = await callMCPTool<SavedSession>('session_save', {
      name: 'true', includeMemory: false, includeTasks: false, includeAgents: false,
    });
    const snapshot = await callMCPTool<{ data: unknown }>('session_export', { sessionId: saved.sessionId });
    const action = sessionCommand.subcommands?.find(command => command.name === 'export')?.action;
    if (!action) throw new Error('session export action is unavailable');
    const result = await action({
      args: [saved.sessionId], flags: { _: [], format: 'json', output: 'export.json', 'include-memory': false },
      cwd: root, interactive: false,
    });
    expect(result?.success).toBe(true);
    expect(JSON.parse(readFileSync(join(root, 'export.json'), 'utf8'))).toEqual(snapshot.data);
  });

  it('preserves nested task arrays and empty collections', async () => {
    const tasks = { tasks: { example: { description: 'quoted: "value"',
      tags: ['true', '00123'], history: [{ status: 'queued', notes: [] }], metadata: {} } } };
    mkdirSync(join(root, '.claude-flow', 'tasks'), { recursive: true });
    writeFileSync(join(root, '.claude-flow', 'tasks', 'store.json'), JSON.stringify(tasks));
    const saved = await callMCPTool<SavedSession>('session_save', {
      name: 'nested', includeMemory: false, includeTasks: true, includeAgents: false,
    });
    const snapshot = await callMCPTool<{ data: unknown }>('session_export', { sessionId: saved.sessionId });
    const action = sessionCommand.subcommands?.find(command => command.name === 'export')?.action;
    if (!action) throw new Error('session export action is unavailable');
    const result = await action({
      args: [saved.sessionId], flags: { _: [], format: 'yaml', output: 'export.yaml', 'include-memory': false },
      cwd: root, interactive: false,
    });
    expect(result?.success).toBe(true);
    expect(parse(readFileSync(join(root, 'export.yaml'), 'utf8'))).toEqual(snapshot.data);
  });
});
