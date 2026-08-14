/**
 * Regression: a failed bridge init must be diagnosable and recoverable.
 *
 * `getRegistry()` latches `bridgeAvailable = false` for the life of the
 * process, so one transient init failure routes every later write to the
 * sql.js whole-image fallback — which then refuses whenever -wal/-shm
 * sidecars are present. Observed in the wild: an MCP server silently dropped
 * every `memory_store` for hours while CLI writes through the same database
 * succeeded, and the only symptom was a refusal naming a cause the operator
 * could not check.
 *
 * Three properties close that:
 *   1. the failure reason is recorded rather than swallowed by a bare catch;
 *   2. `shutdownBridge()` clears the latch even when init never produced a
 *      registry — previously the reset sat inside `if (registryInstance)`,
 *      which is null in exactly the case needing a reset;
 *   3. a degradation notice is never filtered out as init noise.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// `@claude-flow/memory` is externalized in vitest.config.ts (it is a try/catch
// dynamic import that degrades to the sql.js path), so the import inside
// getRegistry() always throws here. That is the init failure under test — the
// assertions deliberately check the recorded/cleared behaviour rather than the
// flavour of the underlying error, which is not the property that matters.

describe('bridge failure diagnostics', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should report null before the bridge has been tried', async () => {
    const { getBridgeFailureReason } = await import('../src/memory/memory-bridge.js');

    expect(getBridgeFailureReason()).toBeNull();
  });

  it('should record why init failed instead of swallowing the error', async () => {
    const bridge = await import('../src/memory/memory-bridge.js');

    await bridge.bridgeStoreEntry({ key: 'k', value: 'v' });

    const reason = bridge.getBridgeFailureReason();
    expect(reason).toBeTruthy();
    expect(typeof reason).toBe('string');
  });

  it('should return null from bridgeStoreEntry so the caller falls back', async () => {
    const bridge = await import('../src/memory/memory-bridge.js');

    const result = await bridge.bridgeStoreEntry({ key: 'k', value: 'v' });

    expect(result).toBeNull();
  });

  it('should clear the latched failure on shutdown even with no registry instance', async () => {
    const bridge = await import('../src/memory/memory-bridge.js');
    await bridge.bridgeStoreEntry({ key: 'k', value: 'v' });
    expect(bridge.getBridgeFailureReason()).toBeTruthy();

    await bridge.shutdownBridge();

    expect(bridge.getBridgeFailureReason()).toBeNull();
  });

  it('should re-attempt init after shutdown rather than staying latched', async () => {
    const bridge = await import('../src/memory/memory-bridge.js');
    await bridge.bridgeStoreEntry({ key: 'k', value: 'v' });
    await bridge.shutdownBridge();
    expect(bridge.getBridgeFailureReason()).toBeNull();

    // A latched `bridgeAvailable === false` short-circuits getRegistry() before
    // it retries, so the reason would stay null. Repopulating it proves the
    // retry actually happened.
    await bridge.bridgeStoreEntry({ key: 'k2', value: 'v2' });

    expect(bridge.getBridgeFailureReason()).toBeTruthy();
  });
});

describe('#3024 Windows native-bridge safety gate', () => {
  it('disables the native bridge on Windows by default', async () => {
    const { shouldDisableNativeBridge } = await import('../src/memory/memory-bridge.js');

    expect(shouldDisableNativeBridge('win32', {})).toBe(true);
  });

  it('allows an explicit Windows diagnostic opt-in', async () => {
    const { shouldDisableNativeBridge } = await import('../src/memory/memory-bridge.js');

    expect(shouldDisableNativeBridge('win32', {
      CLAUDE_FLOW_ENABLE_NATIVE_BRIDGE_ON_WINDOWS: '1',
    })).toBe(false);
  });

  it('keeps the explicit disable flag authoritative on every platform', async () => {
    const { shouldDisableNativeBridge } = await import('../src/memory/memory-bridge.js');

    expect(shouldDisableNativeBridge('linux', { CLAUDE_FLOW_DISABLE_BRIDGE: '1' })).toBe(true);
    expect(shouldDisableNativeBridge('win32', {
      CLAUDE_FLOW_DISABLE_BRIDGE: '1',
      CLAUDE_FLOW_ENABLE_NATIVE_BRIDGE_ON_WINDOWS: '1',
    })).toBe(true);
  });

  it('leaves the native bridge enabled by default off Windows', async () => {
    const { shouldDisableNativeBridge } = await import('../src/memory/memory-bridge.js');

    expect(shouldDisableNativeBridge('linux', {})).toBe(false);
    expect(shouldDisableNativeBridge('darwin', {})).toBe(false);
  });
});

describe('init log suppression', () => {
  it('should suppress a noisy init banner', async () => {
    const { shouldSuppressInitLog } = await import('../src/memory/memory-bridge.js');

    expect(shouldSuppressInitLog('[AgentDB] Initialized with better-sqlite3 + ruvector')).toBe(true);
  });

  it('should NOT suppress the better-sqlite3 fallback notice', async () => {
    const { shouldSuppressInitLog } = await import('../src/memory/memory-bridge.js');

    expect(shouldSuppressInitLog('[AgentDB] better-sqlite3 not available, using sql.js WASM')).toBe(false);
  });

  it('should NOT suppress a generic falling-back notice', async () => {
    const { shouldSuppressInitLog } = await import('../src/memory/memory-bridge.js');

    expect(shouldSuppressInitLog('[HNSWLibBackend] falling back to brute force')).toBe(false);
  });

  it('should leave unrelated output alone', async () => {
    const { shouldSuppressInitLog } = await import('../src/memory/memory-bridge.js');

    expect(shouldSuppressInitLog('user-facing progress line')).toBe(false);
  });
});
