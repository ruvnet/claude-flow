import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(async () => false),
  // Every other enrollment gate is open, as in an interactive terminal.
  shouldOfferEnrollment: vi.fn((ctx: { noSignup: boolean }) => !ctx.noSignup),
  recordEnrollmentOutcome: vi.fn(),
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
  confirm: mocks.confirm, select: vi.fn(), multiSelect: vi.fn(), input: vi.fn(),
}));
vi.mock('../src/funnel/enrollment.js', () => ({
  ENROLLMENT_SCREEN: '', shouldOfferEnrollment: mocks.shouldOfferEnrollment,
  recordEnrollmentOutcome: mocks.recordEnrollmentOutcome,
}));
vi.mock('../src/services/harness-hosts.js', () => ({ commandExists: vi.fn(() => false) }));
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
  const cwd = mkdtempSync(join(tmpdir(), 'ruflo-init-no-signup-'));
  tempDirs.push(cwd);
  const parser = new CommandParser();
  parser.registerCommand(initCommand);
  const parsed = parser.parse(['init', '--full', '--force', '--no-global', '--no-codex-detect', '--no-skills-sh', ...flags]);
  const result = await initCommand.action!({ args: [], flags: parsed.flags, cwd, interactive: true });
  expect(result.success).toBe(true);
}

describe('init --no-signup through the real command parser', () => {
  it('skips the enrollment prompt and records no decision', async () => {
    await runInit(['--no-signup']);
    expect(mocks.shouldOfferEnrollment).toHaveBeenCalledWith(expect.objectContaining({ noSignup: true }));
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.recordEnrollmentOutcome).not.toHaveBeenCalled();
  });

  it('still offers enrollment once without the flag', async () => {
    await runInit([]);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.recordEnrollmentOutcome).toHaveBeenCalledWith(false);
  });
});
