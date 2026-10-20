/**
 * Hive-mind task dispatch, end to end over the real task + hive-mind tools.
 *
 * Before `hive-mind work`, a submitted task stayed `pending` and its worker
 * `idle` forever: nothing claimed the row, and task_assign/task_complete only
 * synced `.claude-flow/agents/store.json` while hive workers live in
 * `.claude-flow/agents.json`. Separately, `spawn --claude` passed
 * `~/.claude.json` as `--mcp-config`, which Claude rejects ("mcpServers:
 * Invalid input") wherever that file has no top-level `mcpServers`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ cwd: '' }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
vi.mock('../src/mcp-client.js', async () => {
  const { taskTools } = await import('../src/mcp-tools/task-tools.js');
  const { hiveMindTools } = await import('../src/mcp-tools/hive-mind-tools.js');
  const tools = [...taskTools, ...hiveMindTools];
  return {
    MCPClientError: class extends Error {},
    callMCPTool: async (name: string, input: any) => tools.find((t) => t.name === name)!.handler(input ?? {}),
  };
});

import { callMCPTool } from '../src/mcp-client.js';
import { resolveWorkerMcpConfig, workOnce, type TaskRunner } from '../src/commands/hive-mind-worker.js';

const call = (name: string, input: any = {}): Promise<any> => callMCPTool(name, input) as Promise<any>;
const tmp = (p: string) => (state.cwd = mkdtempSync(join(tmpdir(), p)));
afterEach(() => {
  if (state.cwd) rmSync(state.cwd, { recursive: true, force: true });
});

async function hiveWithOneTask() {
  await call('hive-mind_init', {});
  const spawned = await call('hive-mind_spawn', { count: 1 });
  const task = await call('task_create', { type: 'hive-mind', description: 'List the files', tags: ['hive-mind', 'timeout:42s'] });
  return { workerId: spawned.workers[0].agentId as string, taskId: task.taskId as string };
}

const worker = async (id: string) => (await call('hive-mind_status')).workers.find((w: any) => w.id === id);

describe('hive-mind work', () => {
  it('assigns a pending task to an idle worker, runs it, and records the result', async () => {
    tmp('ruflo-hive-work-');
    const { workerId, taskId } = await hiveWithOneTask();
    let seen: { prompt: string; timeoutMs: number; busy?: string } | undefined;
    const runner: TaskRunner = async (prompt, opts) => {
      // Observed mid-run: the worker is busy on exactly this task.
      seen = { prompt, timeoutMs: opts.timeoutMs, busy: (await worker(workerId)).status };
      return { ok: true, output: 'a.txt b.txt', exitCode: 0, durationMs: 5, sessionId: 's-1' };
    };

    const r = await workOnce({ cwd: state.cwd, mcpConfig: '/x.json', runner });

    expect(r).toMatchObject({ dispatched: true, taskId, workerId, status: 'completed' });
    expect(seen).toMatchObject({ busy: 'busy', timeoutMs: 42_000 });
    expect(seen!.prompt).toContain('List the files');
    const done = await call('task_status', { taskId });
    expect(done.status).toBe('completed');
    expect(done.assignedTo).toEqual([workerId]);
    expect(done.result).toMatchObject({ worker: workerId, output: 'a.txt b.txt', sessionId: 's-1' });
    expect(await worker(workerId)).toMatchObject({ status: 'idle', tasksCompleted: 1 });
  });

  it('records a failed run and frees the worker', async () => {
    tmp('ruflo-hive-fail-');
    const { workerId, taskId } = await hiveWithOneTask();
    const runner: TaskRunner = async () => ({ ok: false, output: 'boom', exitCode: 1, durationMs: 1 });

    const r = await workOnce({ cwd: state.cwd, mcpConfig: '/x.json', runner });

    expect(r).toMatchObject({ dispatched: true, status: 'failed' });
    const failed = await call('task_status', { taskId });
    expect(failed.status).toBe('failed');
    expect(failed.result).toMatchObject({ output: 'boom', exitCode: 1 });
    expect(await worker(workerId)).toMatchObject({ status: 'idle', currentTask: null });
  });

  it('does nothing, successfully, when the queue is empty or no worker is idle', async () => {
    tmp('ruflo-hive-empty-');
    await call('hive-mind_init', {});
    const runner = vi.fn<TaskRunner>();
    expect(await workOnce({ cwd: state.cwd, mcpConfig: '/x.json', runner })).toMatchObject({ dispatched: false });
    await call('task_create', { type: 'hive-mind', description: 'x' });
    expect(await workOnce({ cwd: state.cwd, mcpConfig: '/x.json', runner })).toMatchObject({
      dispatched: false,
      reason: expect.stringContaining('No idle hive worker'),
    });
    expect(runner).not.toHaveBeenCalled();
  });
});

describe('resolveWorkerMcpConfig', () => {
  const ruflo = { command: '/node', args: ['/cli.js', 'mcp', 'start'] };
  const resolve = (home: string, explicit?: string) =>
    resolveWorkerMcpConfig({ explicit, cwd: state.cwd, home, outDir: join(state.cwd, 'out'), swarmId: 's1', rufloServer: ruflo });
  const servers = (p: string) => JSON.parse(readFileSync(p, 'utf8')).mcpServers;

  it('never passes a Claude state file through; generates a config with a ruflo server', () => {
    const home = tmp('ruflo-mcpcfg-');
    // A fresh desktop's ~/.claude.json: no top-level mcpServers.
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ numStartups: 3, projects: {} }));
    const path = resolve(home);
    expect(path).toBe(join(state.cwd, 'out', 'mcp-s1.json'));
    expect(servers(path)).toEqual({ ruflo: { ...ruflo, env: { CLAUDE_FLOW_CWD: state.cwd } } });
  });

  it('keeps servers found in a source config and adds ruflo alongside them', () => {
    const home = tmp('ruflo-mcpcfg-');
    writeFileSync(join(state.cwd, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
    expect(Object.keys(servers(resolve(home))).sort()).toEqual(['other', 'ruflo']);
  });

  it('extracts project-scoped servers from ~/.claude.json and keeps an existing ruflo entry', () => {
    const home = tmp('ruflo-mcpcfg-');
    const mine = { command: 'npx', args: ['ruflo', 'mcp', 'start'] };
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: { [state.cwd]: { mcpServers: { ruflo: mine } } } }));
    expect(servers(resolve(home))).toEqual({ ruflo: mine });
  });

  it('uses an explicit --mcp-config verbatim', () => {
    const home = tmp('ruflo-mcpcfg-');
    expect(resolve(home, '/given.json')).toBe('/given.json');
  });
});
