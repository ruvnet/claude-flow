import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigFileManager } from '../src/services/config-file-manager.js';
import { configTools } from '../src/mcp-tools/config-tools.js';
import { configCommand } from '../src/commands/config.js';
import { CommandParser } from '../src/parser.js';

let root: string;
let path: string;
const tool = (name: string) => configTools.find(tool => tool.name === name)!;
const invoke = async (name: string, input: Record<string, unknown>): Promise<any> => tool(name).handler(input);
const document = () => JSON.parse(readFileSync(path, 'utf8'));
const cliGet = (key: string) => new ConfigFileManager().get(root, key);
async function cliSet(key: string, value: string): Promise<void> {
  const parser = new CommandParser();
  parser.registerCommand(configCommand);
  const set = configCommand.subcommands!.find(command => command.name === 'set')!;
  const parsed = parser.parse(['config', 'set', key, value]);
  expect(parser.validateFlags(parsed.flags, set)).toEqual([]);
  expect((await set.action!({ cwd: root, args: parsed.positional, flags: parsed.flags, interactive: false }))?.success).toBe(true);
}
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'ruflo-config-interop-'));
  mkdirSync(join(root, '.claude-flow'));
  path = join(root, '.claude-flow', 'config.json');
  writeFileSync(path, '{}');
  vi.stubEnv('CLAUDE_FLOW_CWD', root);
  vi.stubEnv('CLAUDE_FLOW_CONFIG', '');
  for (const [key, value] of [['daemon.idleSecs', '0'], ['swarm.maxAgents', '23'], ['swarm.autoScale', 'false']]) {
    await cliSet(key, value);
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});
it('reads actual CLI-produced zero and false values', async () => {
  expect((await invoke('config_get', { key: 'daemon.idleSecs' })).value).toBe(0);
  expect((await invoke('config_get', { key: 'swarm.autoScale' })).value).toBe(false);
});
it('writes CLI-readable nested values and preserves other sections', async () => {
  const result = await invoke('config_set', { key: 'swarm.maxAgents', value: 7 });
  expect(result.previousValue).toBe(23);
  expect(cliGet('swarm.maxAgents')).toBe(7);
  expect(cliGet('daemon.idleSecs')).toBe(0);
  expect(document()).not.toHaveProperty('values');
});
it('lists and exports actual CLI-produced leaves with prefix filtering', async () => {
  const result = await invoke('config_list', { includeDefaults: false, prefix: 'swarm.' });
  expect(result.configs).toEqual([
    { key: 'swarm.autoScale', value: false, source: 'stored' },
    { key: 'swarm.maxAgents', value: 23, source: 'stored' },
  ]);
  expect((await invoke('config_export', { includeDefaults: false })).config).toEqual({
    'daemon.idleSecs': 0, 'swarm.maxAgents': 23, 'swarm.autoScale': false,
  });
});
it('preserves literal dotted keys and their precedence over nested values', async () => {
  writeFileSync(path, JSON.stringify({ 'swarm.maxAgents': 12, swarm: { maxAgents: 23 } }));
  expect((await invoke('config_get', { key: 'swarm.maxAgents' })).value).toBe(12);
  expect((await invoke('config_export', { includeDefaults: false })).config['swarm.maxAgents']).toBe(12);
  await invoke('config_set', { key: 'swarm.maxAgents', value: 7 });
  expect(cliGet('swarm.maxAgents')).toBe(7);
  expect(document()).toMatchObject({ 'swarm.maxAgents': 7, swarm: { maxAgents: 23 } });
});
it('reads and writes whole objects and arrays without flattening persisted values', async () => {
  await invoke('config_set', { key: 'custom', value: { enabled: false, ports: [3, 5] } });
  expect((await invoke('config_get', { key: 'custom' })).value).toEqual({ enabled: false, ports: [3, 5] });
  expect(cliGet('custom.ports')).toEqual([3, 5]);
  expect(document().custom).toEqual({ enabled: false, ports: [3, 5] });
});
it('can set a nested value below an existing null section', async () => {
  writeFileSync(path, JSON.stringify({ custom: null }));
  await invoke('config_set', { key: 'custom.enabled', value: false });
  expect(cliGet('custom.enabled')).toBe(false);
});
it('resets a single plain key while preserving unrelated values', async () => {
  const result = await invoke('config_reset', { key: 'swarm.maxAgents' });
  expect(result.resetKeys).toEqual(['swarm.maxAgents']);
  expect(cliGet('swarm.maxAgents')).toBeUndefined();
  expect((await invoke('config_get', { key: 'swarm.maxAgents' })).value).toBe(10);
  expect(cliGet('daemon.idleSecs')).toBe(0);
});
it('merges flat exported keys back into a CLI-readable document', async () => {
  await invoke('config_import', { config: { 'swarm.maxAgents': 4, 'custom.enabled': false } });
  expect(cliGet('swarm.maxAgents')).toBe(4);
  expect(cliGet('custom.enabled')).toBe(false);
  expect(cliGet('daemon.idleSecs')).toBe(0);
  expect(document()).not.toHaveProperty('values');
});
it('replaces and resets all values while retaining the plain format', async () => {
  await invoke('config_import', { config: { 'swarm.maxAgents': 4 }, merge: false });
  expect(cliGet('swarm.maxAgents')).toBe(4);
  expect(cliGet('daemon.idleSecs')).toBeUndefined();
  await invoke('config_reset', {});
  expect(cliGet('swarm.maxAgents')).toBe(10);
  expect(document()).not.toHaveProperty('values');
});
it('persists scoped values separately from plain CLI settings', async () => {
  await invoke('config_set', { key: 'swarm.maxAgents', value: 5, scope: 'project' });
  expect((await invoke('config_get', { key: 'swarm.maxAgents', scope: 'project' })).value).toBe(5);
  expect(cliGet('swarm.maxAgents')).toBe(23);
  expect(document().scopes.project['swarm.maxAgents']).toBe(5);
  await invoke('config_reset', { scope: 'project' });
  expect((await invoke('config_get', { key: 'swarm.maxAgents', scope: 'project' })).value).toBe(23);
});
it('retains an existing MCP envelope through get, set, import and reset', async () => {
  writeFileSync(path, JSON.stringify({ values: { 'swarm.maxAgents': 8 }, scopes: {}, version: '3.0.0', updatedAt: '' }));
  expect((await invoke('config_get', { key: 'swarm.maxAgents' })).value).toBe(8);
  await invoke('config_set', { key: 'swarm.maxAgents', value: 9 });
  await invoke('config_import', { config: { 'custom.enabled': false } });
  expect(document().values).toEqual({ 'swarm.maxAgents': 9, 'custom.enabled': false });
  expect(document()).not.toHaveProperty('swarm');
  await invoke('config_reset', { key: 'custom.enabled' });
  expect(document().values).toEqual({ 'swarm.maxAgents': 9 });
});
it('keeps new MCP stores in the existing envelope format', async () => {
  rmSync(path);
  await invoke('config_set', { key: 'swarm.maxAgents', value: 9 });
  expect(document().values['swarm.maxAgents']).toBe(9);
  expect((await invoke('config_get', { key: 'swarm.maxAgents' })).value).toBe(9);
});

it('does not mistake an actual CLI values section for an MCP envelope', async () => {
  await cliSet('values.enabled', 'true');
  expect((await invoke('config_get', { key: 'values.enabled' })).value).toBe(true);
  await invoke('config_set', { key: 'values.enabled', value: false });
  expect(cliGet('values.enabled')).toBe(false);
  expect(cliGet('swarm.maxAgents')).toBe(23);
  expect(document()).not.toHaveProperty('scopes');
});
it('updates an actual CLI array element without dropping its siblings', async () => {
  await cliSet('custom.ports', '[3,5]');
  await invoke('config_set', { key: 'custom.ports.0', value: 7 });
  expect(cliGet('custom.ports')).toEqual([7, 5]);
  expect((await invoke('config_get', { key: 'custom.ports.1' })).value).toBe(5);
});
