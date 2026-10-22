import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configCommand } from '../src/commands/config.js';
import { configManager, ConfigFileManager } from '../src/services/config-file-manager.js';
import { WorkerDaemon } from '../src/services/worker-daemon.js';
import { CommandParser } from '../src/parser.js';

vi.mock('../src/output.js', () => ({ output: { writeln: vi.fn(), printError: vi.fn() } }));
vi.mock('../src/prompt.js', () => ({ select: vi.fn(), input: vi.fn() }));

let cwd: string;
const set = configCommand.subcommands!.find(command => command.name === 'set')!;
const readDaemon = (dir: string) => (WorkerDaemon.prototype as any).readDaemonConfigFromFile(join(dir, '.claude-flow'));

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'config-daemon-'));
  vi.stubEnv('CLAUDE_FLOW_CONFIG', '');
  configManager.load(cwd);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(cwd, { recursive: true, force: true });
});

async function run(...args: string[]) {
  const parser = new CommandParser();
  parser.registerCommand(configCommand);
  const parsed = parser.parse(['config', 'set', ...args]);
  expect(parser.validateFlags(parsed.flags, set)).toEqual([]);
  return set.action!({ cwd, args: parsed.positional, flags: parsed.flags, interactive: false });
}

describe('CLI config set reaches daemon settings', () => {
  it.each([
    ['-k', 'daemon.idleSecs', '-v', '0'],
    ['--key=daemon.idleSecs', '--value=0'],
    ['daemon.idleSecs', '0'],
  ])('accepts zero via %j', async (...args) => {
    expect((await run(...args))?.success).toBe(true);
    expect(readDaemon(cwd).idleShutdownMs).toBe(0);
  });

  it('writes only explicit keys so setting the daemon does not relocate memory', async () => {
    expect((await run('daemon.resourceThresholds.minFreeMemoryPercent', '2'))?.success).toBe(true);
    expect(JSON.parse(readFileSync(configManager.getConfigPath()!, 'utf8'))).toEqual({
      daemon: { resourceThresholds: { minFreeMemoryPercent: 2 } },
    });
    expect(readDaemon(cwd).minFreeMemoryPercent).toBe(2);
  });

  it('reads nested updates to an existing .claude-flow config', () => {
    mkdirSync(join(cwd, '.claude-flow'));
    writeFileSync(join(cwd, '.claude-flow/config.json'), JSON.stringify({ unrelated: true }));
    const manager = new ConfigFileManager();
    manager.set(cwd, 'daemon.ttlSecs', 600);
    manager.set(cwd, 'daemon.autoStart', false);
    expect(readDaemon(cwd)).toMatchObject({ ttlMs: 600_000, autoStart: false });
    expect(manager.get(cwd, 'unrelated')).toBe(true);
  });

  it('updates an existing flat key instead of leaving a conflicting nested value', () => {
    mkdirSync(join(cwd, '.claude-flow'));
    writeFileSync(join(cwd, '.claude-flow/config.json'), JSON.stringify({ 'daemon.idleSecs': 60 }));
    const manager = new ConfigFileManager();
    manager.set(cwd, 'daemon.idleSecs', 0);
    expect(manager.get(cwd, 'daemon.idleSecs')).toBe(0);
    expect(readDaemon(cwd).idleShutdownMs).toBe(0);
  });

  it('rejects an absent value without writing a config', async () => {
    expect((await run('--key', 'daemon.idleSecs'))?.success).toBe(false);
    expect(configManager.getConfigPath()).toBeNull();
  });

  it('preserves flat scoped settings and zero/false precedence', () => {
    mkdirSync(join(cwd, '.claude-flow'));
    writeFileSync(join(cwd, '.claude-flow/config.json'), JSON.stringify({
      daemon: { idleSecs: 60, autoStart: true },
      scopes: { project: { 'daemon.idleSecs': 0, 'daemon.autoStart': false } },
    }));
    expect(readDaemon(cwd)).toMatchObject({ idleShutdownMs: 0, autoStart: false });
  });
});
