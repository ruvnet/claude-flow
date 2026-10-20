import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ call: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('../src/mcp-client.js', () => ({ callMCPTool: mocks.call, MCPClientError: class extends Error {} }));
vi.mock('../src/output.js', () => ({
  output: new Proxy({}, {
    get: (_t, prop) => (prop === 'printSuccess' ? mocks.success : prop === 'printError' ? mocks.error : (value: unknown) => value),
  }),
}));
vi.mock('../src/commands/memory-distill.js', () => ({ distillCommand: {} }));
vi.mock('../src/commands/memory-backup.js', () => ({ backupCommand: {} }));
vi.mock('../src/memory/memory-initializer.js', () => ({ resolveDbPath: (p: string) => p }));
import { memoryCommand } from '../src/commands/memory.js';

const exportCmd = memoryCommand.subcommands!.find(c => c.name === 'export')!;
const run = () => exportCmd.action!({ args: [], flags: { output: 'out.json' } } as any);

beforeEach(() => {
  mocks.call.mockReset();
  mocks.success.mockReset();
  mocks.error.mockReset();
});

describe('memory export when the tool fails (#4204)', () => {
  it('reports the tool error instead of printing success and crashing', async () => {
    mocks.call.mockResolvedValue({ error: 'Could not read memory for export' });
    const result = await run();
    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('Could not read memory for export'));
    expect(mocks.error).not.toHaveBeenCalledWith(expect.stringContaining('TypeError'));
  });

  it('still prints the summary when the export succeeds', async () => {
    mocks.call.mockResolvedValue({
      outputPath: '/tmp/out.json', format: 'json', fileSize: '1 KB',
      exported: { entries: 2, vectors: 1, patterns: 0 },
    });
    const result = await run();
    expect(result).toMatchObject({ success: true });
    expect(mocks.success).toHaveBeenCalledWith('Exported to /tmp/out.json');
  });
});
