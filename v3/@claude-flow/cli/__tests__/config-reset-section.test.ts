import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configCommand } from '../src/commands/config.js';
import { CommandParser } from '../src/parser.js';
import { configManager } from '../src/services/config-file-manager.js';

let cwd: string;
const reset = configCommand.subcommands!.find(command => command.name === 'reset')!;
const initial = {
  agents: { maxConcurrent: 19 }, swarm: { maxAgents: 23 },
  memory: { backend: 'sqlite', persistPath: './owned-memory' },
  mcp: { serverPort: 4321 }, providers: [{ name: 'local', enabled: true }],
  custom: { keep: true },
};
const read = (file = 'claude-flow.config.json') => JSON.parse(readFileSync(join(cwd, file), 'utf8'));
const write = (file = 'claude-flow.config.json') => writeFileSync(join(cwd, file), JSON.stringify(initial));

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'config-reset-section-'));
  vi.stubEnv('CLAUDE_FLOW_CONFIG', '');
  write();
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(cwd, { recursive: true, force: true });
});

async function run(...args: string[]) {
  const parser = new CommandParser();
  parser.registerCommand(configCommand);
  const parsed = parser.parse(['config', 'reset', ...args]);
  const errors = parser.validateFlags(parsed.flags, reset);
  if (errors.length) return { success: false, errors };
  return reset.action!({ cwd, args: parsed.positional, flags: parsed.flags, interactive: false });
}

describe('config reset section ownership', () => {
  it.each(['agents', 'swarm', 'memory', 'mcp'])('resets only %s through the actual parser/action', async section => {
    expect((await run('--section', section, '--force'))?.success).toBe(true);
    expect(read()).toEqual({ ...initial, [section]: configManager.getDefaults()[section] });
  });

  it('clears only provider overrides so the provider command can use its defaults', async () => {
    expect((await run('--section', 'providers', '--force'))?.success).toBe(true);
    const { providers: _providers, ...remaining } = initial;
    expect(read()).toEqual(remaining);
  });

  it('removes flat overrides belonging to the selected section only', async () => {
    writeFileSync(join(cwd, 'claude-flow.config.json'), JSON.stringify({
      ...initial, 'memory.backend': 'sqlite', 'memory.persistPath': './flat-memory', 'swarm.maxAgents': 31,
    }));
    expect((await run('--section', 'memory', '--force'))?.success).toBe(true);
    expect(read()).toEqual({ ...initial, memory: configManager.getDefaults().memory, 'swarm.maxAgents': 31 });
    expect(configManager.get(cwd, 'memory.backend')).toBe('hybrid');
  });

  it.each([[], ['--section', 'all']])('keeps whole-reset compatibility for %j', async (...args) => {
    expect((await run(...args, '--force'))?.success).toBe(true);
    expect(read()).toEqual(configManager.getDefaults());
  });

  it.each([['--section'], ['--section', 'unknown'], ['--section=']])('rejects malformed section flags %j without changing bytes', async (...args) => {
    const before = readFileSync(join(cwd, 'claude-flow.config.json'), 'utf8');
    expect((await run(...args))?.success).toBe(false);
    expect(readFileSync(join(cwd, 'claude-flow.config.json'), 'utf8')).toBe(before);
  });

  it('uses the selected existing .claude-flow config without creating a shadow file', async () => {
    rmSync(join(cwd, 'claude-flow.config.json'));
    mkdirSync(join(cwd, '.claude-flow'));
    write('.claude-flow/config.json');
    expect((await run('--section', 'memory', '--force'))?.success).toBe(true);
    expect(read('.claude-flow/config.json')).toEqual({ ...initial, memory: configManager.getDefaults().memory });
    expect(existsSync(join(cwd, 'claude-flow.config.json'))).toBe(false);
  });

  it('uses an explicitly selected private config path', async () => {
    rmSync(join(cwd, 'claude-flow.config.json'));
    write('private-config.json');
    vi.stubEnv('CLAUDE_FLOW_CONFIG', join(cwd, 'private-config.json'));
    expect((await run('--section', 'swarm', '--force'))?.success).toBe(true);
    expect(read('private-config.json')).toEqual({ ...initial, swarm: configManager.getDefaults().swarm });
    expect(existsSync(join(cwd, 'claude-flow.config.json'))).toBe(false);
  });

  it('does not replace malformed configuration during a partial reset', async () => {
    const malformed = '{ "custom":';
    writeFileSync(join(cwd, 'claude-flow.config.json'), malformed);
    expect((await run('--section', 'memory', '--force'))?.success).toBe(false);
    expect(readFileSync(join(cwd, 'claude-flow.config.json'), 'utf8')).toBe(malformed);
  });
});
