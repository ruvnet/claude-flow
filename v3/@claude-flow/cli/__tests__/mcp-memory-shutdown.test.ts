import { describe, expect, it, vi } from 'vitest';

const shutdownBridge = vi.fn();

vi.mock('../src/memory/memory-bridge.js', () => ({ shutdownBridge }));

import { closeMemoryBridgeBeforeExit } from '../src/mcp-server.js';

describe('MCP memory shutdown ordering', () => {
  it('closes the native memory bridge before exiting', async () => {
    const order: string[] = [];
    shutdownBridge.mockImplementationOnce(async () => {
      await Promise.resolve();
      order.push('closed');
    });
    const exit = vi.fn(() => { order.push('exit'); });

    await closeMemoryBridgeBeforeExit(exit);

    expect(shutdownBridge).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
    expect(order).toEqual(['closed', 'exit']);
  });
});
