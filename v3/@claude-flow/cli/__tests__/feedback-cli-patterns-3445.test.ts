import { describe, expect, it, vi } from 'vitest';
const callMCPTool = vi.fn(async () => ({ success: true }));
vi.mock('../src/mcp-client.js', () => ({ callMCPTool, MCPClientError: class extends Error {} }));
const { hooksCommand } = await import('../src/commands/hooks.js');
const command = hooksCommand.subcommands!.find(c => c.name === 'post-task')!;

describe('post-task CLI patterns (#3445)', () => {
  it('declares the patterns option and forwards parsed JSON', async () => {
    expect(command.options?.some(option => option.name === 'patterns')).toBe(true);
    await command.action!({ args: [], flags: { taskId: '3445', patterns: '["validate first"]', format: 'json' } } as any);
    expect(callMCPTool).toHaveBeenCalledWith('hooks_post-task', expect.objectContaining({ patterns: ['validate first'] }));
  });
  it('rejects malformed JSON without calling MCP', async () => {
    callMCPTool.mockClear();
    expect(await command.action!({ args: [], flags: { patterns: '{' } } as any)).toMatchObject({ success: false });
    expect(callMCPTool).not.toHaveBeenCalled();
  });
});
