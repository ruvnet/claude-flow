import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ cwd: '', failSave: false, failAgentSave: false }));
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
    if (state.failSave && String(args[0]).endsWith('/tasks/store.json')) throw new Error('save failed');
    if (state.failAgentSave && String(args[0]).endsWith('/agents/store.json')) throw new Error('agent save failed');
    return fs.writeFileSync(...args);
  } };
});
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
import { taskTools } from '../src/mcp-tools/task-tools.js';
const call = (name: string, input: Record<string, unknown>) => taskTools.find(t => t.name === name)!.handler(input) as Promise<any>;
const stores = ['agents/store.json', 'agents.json'];
const agents = (file: string) => JSON.parse(readFileSync(join(state.cwd, '.claude-flow', file), 'utf8')).agents;
beforeEach(() => {
  state.failSave = false;
  state.failAgentSave = false;
  state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-task-reassign-'));
  mkdirSync(join(state.cwd, '.claude-flow/agents'), { recursive: true });
  for (const file of stores) writeFileSync(join(state.cwd, '.claude-flow', file), JSON.stringify({ agents: {
    old: { status: 'idle', currentTask: null, taskCount: 0 },
    next: { status: 'idle', currentTask: null, taskCount: 0 },
  } }));
});
afterEach(() => rmSync(state.cwd, { recursive: true, force: true }));
it('reassigns through task_update and synchronizes newly assigned workers in both stores', async () => {
  const { taskId } = await call('task_create', { type: 'test', description: 'work' });
  await call('task_assign', { taskId, agentIds: ['old'] });
  await call('task_update', { taskId, assignTo: ['next'] });
  for (const file of stores) {
    expect(agents(file).old).toMatchObject({ status: 'idle', currentTask: null });
    expect(agents(file).next).toMatchObject({ status: 'busy', currentTask: taskId });
  }
  await call('task_complete', { taskId });
  for (const file of stores) expect(agents(file).next).toMatchObject({ status: 'idle', currentTask: null, taskCount: 1 });
});
it('an empty assignment releases the former worker', async () => {
  const { taskId } = await call('task_create', { type: 'test', description: 'work' });
  await call('task_assign', { taskId, agentIds: ['old'] });
  await call('task_update', { taskId, assignTo: [] });
  for (const file of stores) expect(agents(file).old).toMatchObject({ status: 'idle', currentTask: null });
});
it.each(['completed', 'failed', 'cancelled'])('a simultaneous %s and reassignment frees the workers that actually held the task', async status => {
  const { taskId } = await call('task_create', { type: 'test', description: 'work' });
  await call('task_assign', { taskId, agentIds: ['old'] });
  await call('task_update', { taskId, status, assignTo: ['next'] });
  for (const file of stores) {
    expect(agents(file).old).toMatchObject({ status: 'idle', currentTask: null, taskCount: status === 'completed' ? 1 : 0 });
    expect(agents(file).next).toMatchObject({ status: 'idle', currentTask: null, taskCount: 0 });
  }
});

it('preserves both worker stores when saving the reassignment fails', async () => {
  const { taskId } = await call('task_create', { type: 'test', description: 'work' });
  await call('task_assign', { taskId, agentIds: ['old'] });
  const before = stores.map(file => readFileSync(join(state.cwd, '.claude-flow', file), 'utf8'));
  state.failSave = true;
  await expect(call('task_update', { taskId, assignTo: ['next'] })).rejects.toThrow('save failed');
  expect(stores.map(file => readFileSync(join(state.cwd, '.claude-flow', file), 'utf8'))).toEqual(before);
});
it('does not free a former assignee who now holds another task', async () => {
  const first = await call('task_create', { type: 'test', description: 'first' });
  const second = await call('task_create', { type: 'test', description: 'second' });
  await call('task_assign', { taskId: first.taskId, agentIds: ['old'] });
  await call('task_assign', { taskId: second.taskId, agentIds: ['old'] });
  await call('task_update', { taskId: first.taskId, assignTo: ['next'] });
  for (const file of stores) expect(agents(file).old).toMatchObject({ status: 'busy', currentTask: second.taskId });
});

const taskStorePath = () => join(state.cwd, '.claude-flow/tasks/store.json');
it('an echoed assignee keeps the other task it acquired', async () => {
  const first = await call('task_create', { type: 'test', description: 'first' });
  const second = await call('task_create', { type: 'test', description: 'second' });
  await call('task_assign', { taskId: first.taskId, agentIds: ['old'] });
  await call('task_assign', { taskId: second.taskId, agentIds: ['old'] });
  await call('task_update', { taskId: first.taskId, progress: 50, assignTo: ['old', 'next'] });
  for (const file of stores) {
    expect(agents(file).old).toMatchObject({ status: 'busy', currentTask: second.taskId });
    expect(agents(file).next).toMatchObject({ status: 'busy', currentTask: first.taskId });
  }
});
it.each(['task_update', 'task_assign'])('%s does not mutate an inherited prototype entry', async name => {
  const { taskId } = await call('task_create', { type: 'test', description: 'work' });
  const previous = new Map(['status', 'currentTask'].map(key => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)]));
  try {
    await call(name, name === 'task_update' ? { taskId, assignTo: ['__proto__'] } : { taskId, agentIds: ['__proto__'] });
    expect(Object.getOwnPropertyDescriptor(Object.prototype, 'status')).toEqual(previous.get('status'));
    expect(Object.getOwnPropertyDescriptor(Object.prototype, 'currentTask')).toEqual(previous.get('currentTask'));
    for (const file of stores) expect(Object.keys(agents(file))).toEqual(['old', 'next']);
  } finally {
    for (const key of ['status', 'currentTask']) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(Object.prototype, key, descriptor);
      else delete (Object.prototype as Record<string, unknown>)[key];
    }
  }
});
it.each(['old', 7, null, {}, [''], ['old', 7], ['old', '../bad']].map(value => [value]))('refuses malformed assignTo %j before either store changes', async assignTo => {
  const { taskId } = await call('task_create', { type: 'test', description: 'work' });
  await call('task_assign', { taskId, agentIds: ['old'] });
  const paths = [taskStorePath(), ...stores.map(file => join(state.cwd, '.claude-flow', file))];
  const before = paths.map(path => readFileSync(path, 'utf8'));
  expect(await call('task_update', { taskId, progress: 50, assignTo })).toMatchObject({ success: false });
  expect(paths.map(path => readFileSync(path, 'utf8'))).toEqual(before);
});
it('repairing an already malformed stored assignment succeeds', async () => {
  const { taskId } = await call('task_create', { type: 'test', description: 'work' });
  const store = JSON.parse(readFileSync(taskStorePath(), 'utf8'));
  store.tasks[taskId].assignedTo = 7;
  writeFileSync(taskStorePath(), JSON.stringify(store));
  expect(await call('task_update', { taskId, progress: 50, assignTo: ['next'] })).toMatchObject({ success: true, assignedTo: ['next'], progress: 50 });
  for (const file of stores) expect(agents(file).next).toMatchObject({ currentTask: taskId, status: 'busy' });
});
it('reopening with echoed assignees does not count the same completed work twice', async () => {
  const { taskId } = await call('task_create', { type: 'test', description: 'work' });
  await call('task_assign', { taskId, agentIds: ['old'] });
  await call('task_complete', { taskId });
  await call('task_update', { taskId, status: 'pending', assignTo: ['old'] });
  await call('task_update', { taskId, status: 'completed' });
  for (const file of stores) expect(agents(file).old).toMatchObject({ currentTask: null, status: 'idle', taskCount: 1 });
});
it('an unchanged active assignee remains bound', async () => {
  const { taskId } = await call('task_create', { type: 'test', description: 'work' });
  await call('task_assign', { taskId, agentIds: ['old'] });
  await call('task_update', { taskId, progress: 50, assignTo: ['old'] });
  for (const file of stores) expect(agents(file).old).toMatchObject({ currentTask: taskId, status: 'busy', taskCount: 0 });
});
it('characterizes the existing pending-task transition separately from worker synchronization', async () => {
  const { taskId } = await call('task_create', { type: 'test', description: 'work' });
  await call('task_update', { taskId, assignTo: ['next'] });
  expect(await call('task_status', { taskId })).toMatchObject({ status: 'pending', startedAt: null });
  for (const file of stores) expect(agents(file).next).toMatchObject({ currentTask: taskId, status: 'busy' });
});
it('characterizes the existing best-effort agent-store write failure', async () => {
  const { taskId } = await call('task_create', { type: 'test', description: 'work' });
  await call('task_assign', { taskId, agentIds: ['old'] });
  state.failAgentSave = true;
  expect(await call('task_update', { taskId, assignTo: ['next'] })).toMatchObject({ success: true });
  state.failAgentSave = false;
  await call('task_update', { taskId, assignTo: ['next'] });
  expect(agents(stores[0]).old).toMatchObject({ currentTask: taskId, status: 'busy' });
  expect(agents(stores[1]).old).toMatchObject({ currentTask: null, status: 'idle' });
});
