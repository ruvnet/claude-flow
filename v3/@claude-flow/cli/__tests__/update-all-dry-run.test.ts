import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeMultipleUpdates: vi.fn(async (..._args: unknown[]) => []),
}));

vi.mock('../src/output.js', () => ({
  output: {
    writeln: vi.fn(), printInfo: vi.fn(), printSuccess: vi.fn(), printError: vi.fn(),
    highlight: (text: string) => text, success: (text: string) => text, error: (text: string) => text,
  },
}));
vi.mock('../src/update/checker.js', () => ({
  DEFAULT_CONFIG: { autoUpdate: { patch: true, minor: false, major: false }, priority: {}, exclude: [] },
  checkForUpdates: async () => ({
    results: [{
      package: '@claude-flow/cli', currentVersion: '3.0.0', latestVersion: '3.1.0',
      updateType: 'minor', shouldAutoUpdate: false, priority: 'high',
    }],
    skipped: false,
  }),
  checkSinglePackage: vi.fn(),
  getInstalledVersion: () => '3.0.0',
}));
vi.mock('../src/update/executor.js', () => ({
  executeMultipleUpdates: mocks.executeMultipleUpdates,
  executeUpdate: vi.fn(), rollbackUpdate: vi.fn(), getUpdateHistory: vi.fn(), clearHistory: vi.fn(),
}));

import { CommandParser } from '../src/parser.js';
import updateCommand from '../src/commands/update.js';

afterEach(() => {
  vi.clearAllMocks();
});

async function runAll(flags: string[]): Promise<unknown> {
  const parser = new CommandParser();
  parser.registerCommand(updateCommand);
  const parsed = parser.parse(['update', 'all', ...flags]);
  const all = updateCommand.subcommands!.find((command) => command.name === 'all')!;
  await all.action!({ args: [], flags: parsed.flags, cwd: process.cwd(), interactive: false });
  expect(mocks.executeMultipleUpdates).toHaveBeenCalledTimes(1);
  return mocks.executeMultipleUpdates.mock.calls[0][2];
}

describe('update all --dry-run through the real command parser', () => {
  it('runs the updates as a dry run', async () => {
    expect(await runAll(['--dry-run'])).toBe(true);
  });

  it('still installs without the flag', async () => {
    expect(await runAll([])).toBeFalsy();
  });
});
