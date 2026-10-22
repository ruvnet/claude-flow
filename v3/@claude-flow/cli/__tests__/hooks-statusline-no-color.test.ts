import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const lines = vi.hoisted(() => [] as string[]);
vi.mock('../src/output.js', () => ({ output: new Proxy({}, {
  get: (_target, name) => name === 'writeln'
    ? (text = '') => { lines.push(String(text)); }
    : (value: unknown) => value,
}) }));
vi.mock('../src/mcp-client.js', () => ({ callMCPTool: vi.fn(), MCPClientError: class extends Error {} }));
vi.mock('../src/funnel/index.js', () => ({ getFunnelPromo: () => null }));
vi.mock('../src/funnel/local-signals.js', () => ({
  getSecurityStatus: () => ({ status: 'CLEAN', findings: 0, cvesFixed: 0, totalCves: 0 }),
  getSwarmStatus: () => ({ activeAgents: 0, maxAgents: 15, coordinationActive: false }),
  getGitUncommittedCount: () => 0,
}));
import { hooksCommand } from '../src/commands/hooks.js';
import { CommandParser } from '../src/parser.js';

const cwd = process.cwd();
let root: string;
beforeEach(() => {
  lines.length = 0;
  root = mkdtempSync(join(tmpdir(), 'hooks-statusline-no-color-'));
  process.chdir(root);
  // A terminal run: no Claude Code JSON waiting on stdin.
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
});
afterEach(() => {
  delete (process.stdin as { isTTY?: boolean }).isTTY;
  process.chdir(cwd);
  rmSync(root, { recursive: true, force: true });
});

async function statusline(argv: string[]): Promise<string> {
  const parser = new CommandParser();
  parser.registerCommand(hooksCommand);
  const { flags } = parser.parse(['hooks', 'statusline', '--full', ...argv]);
  const command = hooksCommand.subcommands!.find(c => c.name === 'statusline')!;
  const result = await command.action!({ args: [], flags, cwd: root, interactive: false });
  expect(result?.success).toBe(true);
  return lines.join('\n');
}

describe('hooks statusline --no-color', () => {
  it('prints no ANSI escape codes', async () => {
    const text = await statusline(['--no-color']);
    expect(text).toContain('RuFlo V3');
    expect(text).not.toContain('\x1b[');
  });

  it('keeps colors without the flag', async () => {
    expect(await statusline([])).toContain('\x1b[');
  });
});
