import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../src/output.js', () => ({ output: new Proxy({}, {
  get: (_target, name) => name === 'writeln' ? () => {} : (value: unknown) => value,
}) }));
import { cleanupCommand } from '../src/commands/cleanup.js';
import { CommandParser } from '../src/parser.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cleanup-keep-config-'));
  mkdirSync(join(root, '.claude-flow'));
  mkdirSync(join(root, '.claude'));
  writeFileSync(join(root, 'claude-flow.config.json'), '{"memory":{"persistPath":".swarm"}}\n');
  writeFileSync(join(root, '.claude', 'settings.json'), '{"hooks":{"Stop":[]},"claudeFlow":{"enabled":true}}\n');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function cleanup(argv: string[]): Promise<void> {
  const parser = new CommandParser();
  parser.registerCommand(cleanupCommand);
  const { flags } = parser.parse(['cleanup', '--force', ...argv]);
  const result = await cleanupCommand.action!({ args: [], flags, cwd: root, interactive: false });
  expect(result?.success).toBe(true);
  expect(existsSync(join(root, '.claude-flow'))).toBe(false);
}

const settings = () => JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf-8'));

describe('cleanup --force --keep-config through the real command parser', () => {
  it.each(['--keep-config', '-k'])('keeps the config files with %s', async (flag) => {
    await cleanup([flag]);
    expect(existsSync(join(root, 'claude-flow.config.json'))).toBe(true);
    expect(settings()).toEqual({ hooks: { Stop: [] }, claudeFlow: { enabled: true } });
  });

  it('still removes them without the flag', async () => {
    await cleanup([]);
    expect(existsSync(join(root, 'claude-flow.config.json'))).toBe(false);
    expect(settings()).toEqual({});
  });
});
