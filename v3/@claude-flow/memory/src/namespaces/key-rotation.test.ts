/**
 * Tests for ADR-321 P4 key-rotation policy + tooling (Task #8, ruvnet/ruflo#2630).
 *
 * The policy functions are pure and take a SealedKeyStore explicitly (no hidden
 * singleton), so they're unit-tested against a mocked key store. The adapter's
 * `rotateSealKey()` is exercised against the real AgentDBAdapter to confirm the
 * `seal:key-rotated` emit and that rotation invalidates historical seals (the
 * deliberate "not per-write" tradeoff the ADR calls out).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  isRotationDue,
  rotateIfDue,
  rotateNow,
  ON_DEMAND_ONLY_POLICY,
  type KeyRotationPolicy,
} from './key-rotation.js';
import type { SealedKeyStore } from './sealed-writer.js';
import { AgentDBAdapter } from '../agentdb-adapter.js';
import type { MemoryEntry } from '../types.js';

function mockKeyStore(createdAt?: number): SealedKeyStore & {
  getKey: ReturnType<typeof vi.fn>;
  rotateKey: ReturnType<typeof vi.fn>;
} {
  let epoch = 1;
  return {
    getKey: vi.fn(() => ({ key: new Uint8Array(32), epoch, createdAt })),
    rotateKey: vi.fn(() => { epoch += 1; }),
  };
}

describe('isRotationDue', () => {
  it('is false when maxKeyAgeMs is unset (on-demand-only)', () => {
    expect(isRotationDue(mockKeyStore(0), 'ns', ON_DEMAND_ONLY_POLICY, 1_000_000)).toBe(false);
  });

  it('is false when the key store does not track createdAt', () => {
    const policy: KeyRotationPolicy = { rotateOnDemand: true, maxKeyAgeMs: 1000 };
    expect(isRotationDue(mockKeyStore(undefined), 'ns', policy, 1_000_000)).toBe(false);
  });

  it('is true once the key is at least maxKeyAgeMs old', () => {
    const policy: KeyRotationPolicy = { rotateOnDemand: true, maxKeyAgeMs: 1000 };
    expect(isRotationDue(mockKeyStore(0), 'ns', policy, 1000)).toBe(true);
    expect(isRotationDue(mockKeyStore(0), 'ns', policy, 5000)).toBe(true);
  });

  it('is false while the key is younger than maxKeyAgeMs', () => {
    const policy: KeyRotationPolicy = { rotateOnDemand: true, maxKeyAgeMs: 1000 };
    expect(isRotationDue(mockKeyStore(500), 'ns', policy, 1000)).toBe(false); // age 500 < 1000
  });
});

describe('rotateIfDue', () => {
  it('rotates and returns true when due', () => {
    const ks = mockKeyStore(0);
    const policy: KeyRotationPolicy = { rotateOnDemand: false, maxKeyAgeMs: 1000 };
    expect(rotateIfDue(ks, 'ns', policy, 2000)).toBe(true);
    expect(ks.rotateKey).toHaveBeenCalledWith('ns');
  });

  it('does not rotate and returns false when not due', () => {
    const ks = mockKeyStore(0);
    const policy: KeyRotationPolicy = { rotateOnDemand: false, maxKeyAgeMs: 1000 };
    expect(rotateIfDue(ks, 'ns', policy, 500)).toBe(false);
    expect(ks.rotateKey).not.toHaveBeenCalled();
  });
});

describe('rotateNow', () => {
  it('rotates when rotateOnDemand is allowed', () => {
    const ks = mockKeyStore();
    expect(rotateNow(ks, 'ns', ON_DEMAND_ONLY_POLICY)).toBe(true);
    expect(ks.rotateKey).toHaveBeenCalledWith('ns');
  });

  it('refuses when rotateOnDemand is false', () => {
    const ks = mockKeyStore();
    expect(rotateNow(ks, 'ns', { rotateOnDemand: false })).toBe(false);
    expect(ks.rotateKey).not.toHaveBeenCalled();
  });
});

// ─── adapter rotateSealKey [integration] ──────────────────────────────────

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = Date.now();
  return {
    id: overrides.id ?? `e-${Math.random().toString(36).slice(2)}`,
    key: overrides.key ?? 'k1',
    content: overrides.content ?? 'payload',
    type: overrides.type ?? 'semantic',
    namespace: overrides.namespace ?? 'collaboration',
    tags: overrides.tags ?? [],
    metadata: overrides.metadata ?? {},
    ownerId: overrides.ownerId ?? 'agent-A',
    accessLevel: overrides.accessLevel ?? 'swarm',
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  } as MemoryEntry;
}

describe('AgentDBAdapter.rotateSealKey [integration]', () => {
  it('emits seal:key-rotated for the namespace', () => {
    const adapter = new AgentDBAdapter({ cacheEnabled: false });
    const spy = vi.fn();
    adapter.on('seal:key-rotated', spy);
    adapter.rotateSealKey('collaboration');
    expect(spy).toHaveBeenCalledWith({ namespace: 'collaboration' });
  });

  it('rotation invalidates a previously-sealed entry (the deliberate not-per-write tradeoff)', async () => {
    const adapter = new AgentDBAdapter({ cacheEnabled: false });
    const tamperSpy = vi.fn();
    adapter.on('seal:tamper-detected', tamperSpy);

    const entry = makeEntry({ id: 'rot-1', content: 'historical' });
    await adapter.store(entry);
    expect(await adapter.get('rot-1')).not.toBeNull(); // verifies under epoch 1

    adapter.rotateSealKey('collaboration'); // bump to epoch 2

    await adapter.get('rot-1'); // stale seal no longer matches the current key
    expect(tamperSpy).toHaveBeenCalledTimes(1);
  });
});
