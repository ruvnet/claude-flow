import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ cwd: '' }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
import { statusOf, taskTools } from '../src/mcp-tools/task-tools.js';
const call = (name: string, input: any): Promise<any> => taskTools.find(t => t.name === name)!.handler(input) as Promise<any>;
const stored = (id: string) => JSON.parse(readFileSync(join(state.cwd, '.claude-flow/tasks/store.json'), 'utf8')).tasks[id];
beforeEach(() => { state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-task-status-')); });
afterEach(() => rmSync(state.cwd, { recursive: true, force: true }));

it('stores a known alias as its canonical status', async () => {
  const { taskId } = await call('task_create', { type: 'test', description: 'task' });
  const result = await call('task_update', { taskId, status: 'complete' });
  expect(result.success).toBe(true);
  expect(stored(taskId).status).toBe('completed');
});

it('refuses a status that is none of the five and leaves the task unchanged', async () => {
  const { taskId } = await call('task_create', { type: 'test', description: 'task' });
  const result = await call('task_update', { taskId, status: 'finished-ish', progress: 50 });
  expect(result).toMatchObject({ success: false });
  expect(result.error).toContain('pending, in_progress, completed, failed, cancelled');
  expect(stored(taskId)).toMatchObject({ status: 'pending', progress: 0 });
});

it('accepts the canonical statuses in any case and rejects prototype keys', () => {
  expect(['pending', 'IN_PROGRESS', ' failed ', 'running', 'canceled'].map(statusOf)).toEqual(['pending', 'in_progress', 'failed', 'in_progress', 'cancelled']);
  expect(['constructor', '__proto__', 'toString', 42, null].map(statusOf)).toEqual([null, null, null, null, null]);
});

it('keeps aliases reachable on every transport: no schema enum for the registry to reject first', () => {
  const schema = taskTools.find(t => t.name === 'task_update')!.inputSchema as any;
  expect(schema.properties.status.enum).toBeUndefined();
  expect(schema.properties.status.description).toContain('pending, in_progress, completed, failed or cancelled');
});

it('refuses an empty status instead of treating it as absent', async () => {
  const { taskId } = await call('task_create', { type: 'test', description: 'task' });
  expect(await call('task_update', { taskId, status: '' })).toMatchObject({ success: false });
});

it('completing through task_update finishes the task like task_complete: progress, time, worker freed and counted once', async () => {
  mkdirSync(join(state.cwd, '.claude-flow/agents'), { recursive: true });
  writeFileSync(join(state.cwd, '.claude-flow/agents/store.json'), JSON.stringify({ agents: { worker: { agentId: 'worker', status: 'idle', currentTask: null, taskCount: 0 } }, version: '3.0.0' }));
  const { taskId } = await call('task_create', { type: 'test', description: 'task' });
  await call('task_assign', { taskId, agentIds: ['worker'] });
  await call('task_update', { taskId, status: 'complete' });
  await call('task_update', { taskId, status: 'completed' });
  expect(stored(taskId)).toMatchObject({ status: 'completed', progress: 100 });
  expect(stored(taskId).completedAt).toEqual(expect.any(String));
  const worker = JSON.parse(readFileSync(join(state.cwd, '.claude-flow/agents/store.json'), 'utf8')).agents.worker;
  expect(worker).toMatchObject({ status: 'idle', currentTask: null, taskCount: 1 });
});

it('complete -> pending -> complete without reassignment counts the worker once', async () => {
  mkdirSync(join(state.cwd, '.claude-flow/agents'), { recursive: true });
  writeFileSync(join(state.cwd, '.claude-flow/agents/store.json'), JSON.stringify({ agents: { worker: { agentId: 'worker', status: 'idle', currentTask: null, taskCount: 0 } }, version: '3.0.0' }));
  const { taskId } = await call('task_create', { type: 'test', description: 'task' });
  await call('task_assign', { taskId, agentIds: ['worker'] });
  await call('task_update', { taskId, status: 'completed' });
  await call('task_update', { taskId, status: 'pending' });
  await call('task_update', { taskId, status: 'completed', progress: 40 });
  const worker = JSON.parse(readFileSync(join(state.cwd, '.claude-flow/agents/store.json'), 'utf8')).agents.worker;
  expect(worker.taskCount).toBe(1);
  expect(stored(taskId).progress).toBe(100);
});
