import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ cwd: '' }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
vi.mock('../src/mcp-tools/agent-execute-core.js', () => ({ executeAgentTask: vi.fn() }));
import { workflowTools } from '../src/mcp-tools/workflow-tools.js';
const call = (name: string, input: object) => workflowTools.find(t => t.name === name)!.handler(input) as Promise<any>;
const raw = () => readFileSync(join(state.cwd, '.claude-flow/workflows/store.json'), 'utf8');
beforeEach(() => { state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-step-bounds-')); });
afterEach(() => rmSync(state.cwd, { recursive: true, force: true }));
it.each([-1, 0.5, 3, NaN, Infinity, '1'])('rejects invalid start index %s before changing persisted state', async startFromStep => {
  const { workflowId } = await call('workflow_create', { name: 'bounds', steps: [{type:'wait'}, {type:'wait'}] });
  const before = raw();
  expect(await call('workflow_execute', { workflowId, startFromStep })).toMatchObject({ error: expect.stringContaining('startFromStep') });
  expect(raw()).toBe(before);
});
it.each([-1, 0.5, 3, Infinity, '1'])('rejects invalid condition target %s before changing persisted state', async thenStep => {
  const { workflowId } = await call('workflow_create', { name: 'jump', steps: [{type:'condition',config:{when:'true',thenStep}}, {type:'wait'}] });
  const before = raw();
  expect(await call('workflow_execute', { workflowId })).toMatchObject({ error: expect.stringContaining('thenStep') });
  expect(raw()).toBe(before);
});
it('allows a resume at the completed boundary and valid forward branch', async () => {
  const { workflowId } = await call('workflow_create', { name: 'valid', steps: [{type:'condition',config:{when:'true',thenStep:2}}, {type:'wait'}] });
  expect(await call('workflow_execute', { workflowId })).toMatchObject({status:'completed',stepsCompleted:1});
  expect(await call('workflow_execute', { workflowId,startFromStep:2 })).toMatchObject({status:'completed',stepsCompleted:0});
});
