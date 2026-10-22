import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandParser } from '../src/parser.js';

const { spawnSync } = vi.hoisted(() => ({ spawnSync: vi.fn(() => ({ status: 0 })) }));
vi.mock('child_process', () => ({ spawnSync }));
vi.mock('../src/output.js', () => ({ output: {} }));
vi.mock('../src/services/harness-flywheel-runtime.js', () => ({ runFlywheelWorker: vi.fn() }));
vi.mock('../src/services/flywheel-transaction.js', () => ({
  listFlywheelReceipts: vi.fn(), promoteFlywheelCandidate: vi.fn(), readFlywheelTransactionState: vi.fn(),
  resetSequentialEvidence: vi.fn(), verifyFlywheelLedger: vi.fn(),
}));
vi.mock('../src/services/policy-runtime.js', () => ({ evaluatePolicyRequest: vi.fn() }));
import { metaharnessCommand } from '../src/commands/metaharness.js';

beforeEach(() => spawnSync.mockClear());

async function dispatchedArgs(argv: string[]) {
  const parser = new CommandParser({ allowUnknownFlags: true });
  parser.registerCommand(metaharnessCommand);
  const parsed = parser.parse(['metaharness', ...argv]);
  const result = await metaharnessCommand.action!({
    args: parsed.positional, flags: parsed.flags, interactive: true,
  } as never);
  expect(result.success).toBe(true);
  expect(spawnSync).toHaveBeenCalledOnce();
  return (spawnSync.mock.calls[0] as unknown as [string, string[]])[1].slice(1);
}

describe('MetaHarness dispatcher with real parser defaults', () => {
  it.each([
    ['score', '--path', '.', '--format', 'json'],
    ['similarity', '--a', '/tmp/a.json', '--b', '/tmp/b.json', '--format', 'json'],
    ['drift-from-history', '--baseline-file', '/tmp/baseline.json', '--dry-run', '--format', 'json'],
  ])('forwards %s options without CLI-only interactive defaults', async (...argv) => {
    expect(await dispatchedArgs(argv)).toEqual(argv.slice(1));
  });

  it('consumes an explicit interactive flag while preserving plugin arguments', async () => {
    expect(await dispatchedArgs(['score', '--interactive', '--path', '.', '--format', 'json']))
      .toEqual(['--path', '.', '--format', 'json']);
  });

  it('still forwards unknown plugin flags so the script can reject mistakes', async () => {
    expect(await dispatchedArgs(['score', '--definitely-unknown', '--format', 'json']))
      .toContain('--definitely-unknown');
  });
});
