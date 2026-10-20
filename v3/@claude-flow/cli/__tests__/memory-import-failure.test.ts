import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ call: vi.fn(), success: vi.fn(), error: vi.fn(), warn: vi.fn() }));
vi.mock('../src/mcp-client.js', () => ({ callMCPTool: mocks.call, MCPClientError: class extends Error {} }));
vi.mock('../src/output.js', () => ({
  output: new Proxy({}, {
    get: (_t, prop) =>
      prop === 'printSuccess' ? mocks.success
        : prop === 'printError' ? mocks.error
        : prop === 'printWarning' ? mocks.warn
        : (value: unknown) => value,
  }),
}));
vi.mock('../src/commands/memory-distill.js', () => ({ distillCommand: {} }));
vi.mock('../src/commands/memory-backup.js', () => ({ backupCommand: {} }));
vi.mock('../src/memory/memory-initializer.js', () => ({ resolveDbPath: (p: string) => p }));
import { memoryCommand } from '../src/commands/memory.js';

const importCmd = memoryCommand.subcommands!.find(c => c.name === 'import')!;
const run = () => importCmd.action!({ args: [], flags: { input: 'in.json' } } as any);

beforeEach(() => {
  mocks.call.mockReset();
  mocks.success.mockReset();
  mocks.error.mockReset();
  mocks.warn.mockReset();
});

describe('memory import when the tool fails', () => {
  it('reports a tool error instead of printing success and crashing', async () => {
    mocks.call.mockResolvedValue({ error: 'File not found: in.json' });
    const result = await run();
    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('File not found: in.json'));
    expect(mocks.error).not.toHaveBeenCalledWith(expect.stringContaining('TypeError'));
  });

  it('fails when some entries were rejected, even though a summary came back', async () => {
    mocks.call.mockResolvedValue({
      success: false,
      error: '1 memory write(s) failed: a: disk full',
      failed: 1,
      inputPath: 'in.json',
      imported: { entries: 1, vectors: 1, patterns: 0 },
      skipped: 0,
      duration: 3,
    });
    const result = await run();
    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('disk full'));
  });

  it('still prints the summary when the import succeeds', async () => {
    mocks.call.mockResolvedValue({
      success: true,
      failed: 0,
      inputPath: 'in.json',
      imported: { entries: 2, vectors: 2, patterns: 0 },
      skipped: 0,
      duration: 3,
    });
    const result = await run();
    expect(result).toMatchObject({ success: true });
    expect(mocks.success).toHaveBeenCalledWith('Imported from in.json');
  });
});
