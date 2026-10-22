import { beforeEach, describe, expect, it, vi } from 'vitest';
const callMCPTool = vi.fn();
const trackRequest = vi.fn();
vi.mock('../src/mcp-client.js', () => ({ callMCPTool, hasTool: (name: string) => name === 'test_tool', listMCPTools: () => [] }));
vi.mock('../src/mcp-tools/request-tracker.js', () => ({ trackRequest }));
vi.mock('../src/mcp-tools/policy-enforcer.js', () => ({ isPolicyEnforcementEnabled: () => false }));
const { MCPServerManager } = await import('../src/mcp-server.js');
const manager = new MCPServerManager({ transport: 'stdio' });
const call = () => (manager as any).handleMCPMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'test_tool', arguments: {} } }, 'test-session');
beforeEach(() => { callMCPTool.mockReset(); trackRequest.mockClear(); });

describe('CLI MCP tool error envelope', () => {
  it.each([{ success: false, error: 'key is required' }, { results: [], error: 'database unavailable' }])('marks in-band handler failures as tool errors', async (payload) => {
    callMCPTool.mockResolvedValue(payload);
    const response = await call();
    expect(response.error).toBeUndefined();
    expect(response.result.isError).toBe(true);
    expect(JSON.parse(response.result.content[0].text)).toEqual(payload);
    expect(trackRequest).toHaveBeenCalledWith('test_tool', false);
  });
  it('does not confuse a recorded failed task outcome with tool failure', async () => {
    callMCPTool.mockResolvedValue({ success: false, recorded: true });
    const response = await call();
    expect(response.result.isError).not.toBe(true);
    expect(trackRequest).toHaveBeenCalledWith('test_tool', true);
  });
  it('preserves successful tool output', async () => {
    callMCPTool.mockResolvedValue({ success: true, result: 42 });
    const response = await call();
    expect(response.result.isError).not.toBe(true);
    expect(JSON.parse(response.result.content[0].text)).toEqual({ success: true, result: 42 });
  });
  it('keeps unknown tools as protocol errors', async () => {
    const response = await (manager as any).handleMCPMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'missing' } }, 'test-session');
    expect(response.error.code).toBe(-32601);
    expect(callMCPTool).not.toHaveBeenCalled();
  });
});
