import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ call: vi.fn(), confirm: vi.fn(), events: [] as string[] }));
vi.mock('../src/mcp-client.js', () => ({ callMCPTool: mocks.call, MCPClientError: class extends Error {} }));
vi.mock('../src/prompt.js', () => ({ confirm: mocks.confirm }));
vi.mock('../src/output.js', () => ({ output: new Proxy({}, { get: () => (value: unknown) => value }) }));
vi.mock('../src/commands/memory-distill.js', () => ({ distillCommand: {} }));
vi.mock('../src/commands/memory-backup.js', () => ({ backupCommand: {} }));
vi.mock('../src/memory/memory-initializer.js', () => ({ resolveDbPath: (p: string) => p }));
import { memoryCommand } from '../src/commands/memory.js';
const cleanup = memoryCommand.subcommands!.find(c => c.name === 'cleanup')!;
const run = (flags: Record<string, unknown> = {}) => cleanup.action!({ args: [], flags: { dryRun: false, force: false, ...flags } } as any);

beforeEach(() => {
  mocks.events.length = 0;
  mocks.call.mockReset().mockImplementation(async (_name, args) => {
    mocks.events.push(args.dryRun ? 'preview' : 'delete');
    return { dryRun: args.dryRun, candidates: { expired: 2, stale: 0, lowQuality: 0, total: 2 },
      deleted: { entries: args.dryRun ? 0 : 2, vectors: 0, patterns: 0 }, freed: { bytes: 10, formatted: '10 B' }, duration: 1 };
  });
  mocks.confirm.mockReset().mockImplementation(async () => { mocks.events.push('confirm'); return false; });
});

describe('memory cleanup destructive confirmation', () => {
  it('declining cleanup never dispatches a deleting call', async () => {
    await run();
    expect(mocks.events).toEqual(['preview', 'confirm']);
  });
  it('deletes only after confirmation and keeps the preview selectors', async () => {
    mocks.confirm.mockImplementation(async () => { mocks.events.push('confirm'); return true; });
    await run({ namespace: 'commands', olderThan: '7d' });
    expect(mocks.events).toEqual(['preview', 'confirm', 'delete']);
    expect(mocks.call.mock.calls[1][1]).toMatchObject({ dryRun: false, namespace: 'commands', olderThan: '7d' });
  });
  it('dry run previews without confirmation or deletion', async () => {
    await run({ dryRun: true });
    expect(mocks.events).toEqual(['preview']);
  });
  it('force explicitly authorizes a single deleting call', async () => {
    await run({ force: true });
    expect(mocks.events).toEqual(['delete']);
  });
  it('JSON automation must choose a preview or explicitly force deletion', async () => {
    const result = await run({ format: 'json' });
    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it('a failed preview cannot reach confirmation or mutation', async () => {
    mocks.call.mockRejectedValueOnce(new Error('database unavailable'));
    const result = await run();
    expect(result.success).toBe(false);
    expect(mocks.call).toHaveBeenCalledTimes(1);
    expect(mocks.call.mock.calls[0][1].dryRun).toBe(true);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('JSON with --force deletes without an interactive prompt', async () => {
    await run({ format: 'json', force: true });
    expect(mocks.events).toEqual(['delete']);
  });
});
