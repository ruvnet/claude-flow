import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  commandExists: vi.fn(() => false),
}));

vi.mock('../src/output.js', () => {
  const passthrough = (value: string) => value;
  return { output: {
    writeln: vi.fn(), printInfo: vi.fn(), printSuccess: vi.fn(), printWarning: vi.fn(),
    printError: vi.fn(), printBox: vi.fn(), printList: vi.fn(), printJson: vi.fn(),
    bold: passthrough, dim: passthrough, success: passthrough,
    warning: passthrough, highlight: passthrough,
    createSpinner: () => ({ start: vi.fn(), succeed: vi.fn(), fail: vi.fn() }),
  } };
});
vi.mock('../src/prompt.js', () => ({
  confirm: vi.fn(), select: vi.fn(), multiSelect: vi.fn(), input: vi.fn(),
}));
vi.mock('../src/funnel/enrollment.js', () => ({
  ENROLLMENT_SCREEN: '', shouldOfferEnrollment: () => false,
  recordEnrollmentOutcome: vi.fn(),
}));
vi.mock('../src/services/harness-hosts.js', () => ({ commandExists: mocks.commandExists }));
vi.mock('../src/init/index.js', () => {
  const options = {
    components: {
      claudeMd: false, settings: false, skills: false, commands: false,
      agents: false, helpers: false, statusline: false, mcp: false, runtime: false,
    },
    agents: { all: false },
    mcp: { ruvSwarm: false, flowNexus: false },
  };
  return {
    DEFAULT_INIT_OPTIONS: options, MINIMAL_INIT_OPTIONS: options, FULL_INIT_OPTIONS: options,
    executeInit: vi.fn(async () => ({
      success: true,
      created: { directories: [], files: [] }, skipped: [],
      summary: { hooksEnabled: 0, skillsCount: 0, commandsCount: 0, agentsCount: 0 },
    })),
    executeUpgrade: vi.fn(), executeUpgradeWithMissing: vi.fn(),
  };
});

import { CommandParser } from '../src/parser.js';
import { initCommand } from '../src/commands/init.js';

const tempDirs: string[] = [];
afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function runInit(flags: string[]) {
  const cwd = mkdtempSync(join(tmpdir(), 'ruflo-init-optouts-3167-'));
  tempDirs.push(cwd);
  const parser = new CommandParser();
  parser.registerCommand(initCommand);
  const parsed = parser.parse(['init', '--full', '--force', '--no-global', '--no-signup', ...flags]);
  const result = await initCommand.action!({ args: [], flags: parsed.flags, cwd, interactive: false });
  expect(result.success).toBe(true);
  return cwd;
}

describe('#3167 init host opt-outs through the real command parser', () => {
  it('--no-codex-detect skips the Codex probe independently', async () => {
    const cwd = await runInit(['--no-codex-detect']);
    expect(mocks.commandExists).not.toHaveBeenCalled();
    expect(existsSync(join(cwd, '.agents', 'skills', 'ruflo', 'SKILL.md'))).toBe(true);
  });

  it('--no-skills-sh skips skill materialization independently', async () => {
    const cwd = await runInit(['--no-skills-sh']);
    expect(mocks.commandExists).toHaveBeenCalledWith('codex');
    expect(existsSync(join(cwd, '.agents', 'skills', 'ruflo', 'SKILL.md'))).toBe(false);
  });

  it('both opt-outs remain absent after a forced rerun', async () => {
    const cwd = await runInit(['--no-codex-detect', '--no-skills-sh']);
    expect(mocks.commandExists).not.toHaveBeenCalled();
    expect(existsSync(join(cwd, '.agents'))).toBe(false);
    const parser = new CommandParser();
    parser.registerCommand(initCommand);
    const parsed = parser.parse(['init', '--full', '--force', '--no-global', '--no-signup', '--no-codex-detect', '--no-skills-sh']);
    const result = await initCommand.action!({ args: [], flags: parsed.flags, cwd, interactive: false });
    expect(result.success).toBe(true);
    expect(mocks.commandExists).not.toHaveBeenCalled();
    expect(existsSync(join(cwd, '.agents'))).toBe(false);
  });
});
