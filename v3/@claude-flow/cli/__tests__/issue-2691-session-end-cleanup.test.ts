import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeSessionEnd = vi.fn();
const shutdownBridge = vi.fn();

vi.mock('../src/memory/memory-bridge.js', () => ({
  bridgeSessionEnd,
  shutdownBridge,
}));

import { hooksSessionEnd } from '../src/mcp-tools/hooks-tools.js';

describe('hooks session-end native resource cleanup (#2691)', () => {
  beforeEach(() => {
    bridgeSessionEnd.mockReset();
    shutdownBridge.mockReset();
    bridgeSessionEnd.mockResolvedValue({ controller: 'test', persisted: true });
    shutdownBridge.mockResolvedValue(undefined);
  });

  it('shuts down the memory bridge after persisting a session', async () => {
    const result = await hooksSessionEnd.handler({ saveState: false, stopDaemon: false });

    expect(bridgeSessionEnd).toHaveBeenCalledOnce();
    expect(shutdownBridge).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      sessionPersistence: { controller: 'test', persisted: true },
    });
  });

  it('still shuts down a partially initialized bridge when persistence fails', async () => {
    bridgeSessionEnd.mockRejectedValueOnce(new Error('native initialization failed'));

    const result = await hooksSessionEnd.handler({ saveState: false, stopDaemon: false });

    expect(shutdownBridge).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      sessionPersistence: { controller: 'none', persisted: false },
    });
  });
});
