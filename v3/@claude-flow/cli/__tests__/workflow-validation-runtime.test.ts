import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ cwd: '', execute: vi.fn() }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
vi.mock('../src/mcp-tools/agent-execute-core.js', () => ({ executeAgentTask: state.execute }));
import { workflowTools } from '../src/mcp-tools/workflow-tools.js';
const call = (name: string, input: Record<string, unknown>) => workflowTools.find(t => t.name === name)!.handler(input) as Promise<any>;
const validate = async (doc: object) => {
  const file = join(state.cwd, 'workflow.json');
  writeFileSync(file, JSON.stringify(doc));
  return call('workflow_validate', { file, strict: true });
};
beforeEach(() => {
  state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-workflow-validation-'));
  state.execute.mockReset().mockResolvedValue({ success: true, output: 'done' });
});
afterEach(() => rmSync(state.cwd, { recursive: true, force: true }));
it('strictly validates the agentId that the runtime actually dispatches', async () => {
  const doc = { name: 'explicit', steps: [{ name: 'work', type: 'task', config: { agentId: 'worker', prompt: 'execute' } }] };
  const { workflowId } = await call('workflow_create', doc);
  expect(await call('workflow_execute', { workflowId })).toMatchObject({ status: 'completed' });
  expect(state.execute).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'worker', prompt: 'execute' }));
  expect(await validate(doc)).toMatchObject({ valid: true, warnings: [], stats: { stages: 1, agents: 1 } });
});
it('validates defaultAgentId and exempts control steps from needing their own agents', async () => {
  const doc = { name: 'mixed', variables: { defaultAgentId: 'default-worker' }, steps: [
    { name: 'wait', type: 'wait', config: { ms: 0 } },
    { name: 'branch', type: 'condition', config: { when: 'true' } },
    { name: 'work', type: 'task' },
    { name: 'override', type: 'task', config: { agentId: 'other-worker' } },
  ] };
  const { workflowId } = await call('workflow_create', doc);
  expect(await call('workflow_execute', { workflowId })).toMatchObject({ status: 'completed', stepsCompleted: 4 });
  expect(state.execute.mock.calls.map(([input]) => input.agentId)).toEqual(['default-worker', 'other-worker']);
  expect(await validate(doc)).toMatchObject({ valid: true, warnings: [], stats: { stages: 4, agents: 2 } });
});
it('still warns about a task with no available agent and keeps legacy agent declarations', async () => {
  expect(await validate({ steps: [{ name: 'missing', type: 'task' }] })).toMatchObject({ valid: false, warnings: [expect.objectContaining({ line: 1 })] });
  expect(await validate({ steps: [{ agent: 'legacy' }, { agentType: 'legacy' }, { agent_type: 'other' }] })).toMatchObject({ valid: true, stats: { agents: 2 } });
});
