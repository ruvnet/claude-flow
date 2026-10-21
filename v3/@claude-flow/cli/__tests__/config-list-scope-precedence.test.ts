import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configTools } from '../src/mcp-tools/config-tools.js';

let root: string;
const invoke = async (name: string, input: Record<string, unknown>): Promise<any> =>
  configTools.find(tool => tool.name === name)!.handler(input);
const entry = (result: any, key: string) => result.configs.find((c: any) => c.key === key);

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'ruflo-config-scope-'));
  mkdirSync(join(root, '.claude-flow'));
  writeFileSync(join(root, '.claude-flow', 'config.json'), '{}');
  vi.stubEnv('CLAUDE_FLOW_CWD', root);
  vi.stubEnv('CLAUDE_FLOW_CONFIG', '');
  await invoke('config_set', { key: 'swarm.maxAgents', value: 23 });
  await invoke('config_set', { key: 'swarm.maxAgents', value: 7, scope: 'project' });
  await invoke('config_set', { key: 'project.only', value: 'p', scope: 'project' });
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

it('lists the stored value, not a scoped one, for the default scope', async () => {
  const listed = await invoke('config_list', { includeDefaults: false });
  const got = await invoke('config_get', { key: 'swarm.maxAgents' });
  const exported = await invoke('config_export', { includeDefaults: false });

  expect(got.value).toBe(23);
  expect(exported.config['swarm.maxAgents']).toBe(23);
  expect(entry(listed, 'swarm.maxAgents')).toEqual({ key: 'swarm.maxAgents', value: 23, source: 'stored' });
  // Scoped keys that nothing shadows are still listed.
  expect(entry(listed, 'project.only')).toEqual({ key: 'project.only', value: 'p', source: 'scope:project' });
});

it('lets the requested scope win', async () => {
  const listed = await invoke('config_list', { includeDefaults: false, scope: 'project' });
  expect(entry(listed, 'swarm.maxAgents')).toEqual({ key: 'swarm.maxAgents', value: 7, source: 'scope:project' });
  expect((await invoke('config_get', { key: 'swarm.maxAgents', scope: 'project' })).value).toBe(7);
});
