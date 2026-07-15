/**
 * Tests for ADR-321 P2 replay/propagation-chain detection (Task #6, ruvnet/ruflo#2630).
 *
 * The ClawWorm propagation shape: the SAME content, re-sealed under a DIFFERENT
 * writerId within CLAUDE_FLOW_SEAL_REPLAY_WINDOW_MS, is flagged; outside the
 * window it is not. Propagation is a heuristic signal — it NEVER flips a valid
 * seal to invalid (the seal is still cryptographically genuine).
 *
 * Unit tests use the default in-process key store (real HMAC) and drive the
 * public verify()/checkPropagation() surface. The window-boundary tests use
 * fake timers to move time deterministically across the replay window.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SealedMemoryWriter } from './sealed-writer.js';
import { AgentDBAdapter } from '../agentdb-adapter.js';
import type { MemoryEntry } from '../types.js';

const NS = 'collaboration';

describe('SealedMemoryWriter — propagation detection (unit)', () => {
  let writer: SealedMemoryWriter;
  beforeEach(() => { writer = new SealedMemoryWriter(); });

  it('flags the same content re-sealed under a different writerId (within window)', () => {
    const content = { shared: 'worm-payload' };
    writer.seal(content, 'agent-A', NS);
    const envB = writer.seal(content, 'agent-B', NS);

    const result = writer.verify(envB, NS);
    expect(result.valid).toBe(true);          // seal is still genuine
    expect(result.propagationDetected).toBe(true);
  });

  it('does NOT flag a single writer sealing its own content', () => {
    const env = writer.seal({ note: 'mine' }, 'agent-A', NS);
    const result = writer.verify(env, NS);
    expect(result.valid).toBe(true);
    expect(result.propagationDetected).toBe(false);
  });

  it('does NOT flag the same writer sealing the same content twice', () => {
    const content = { note: 'again' };
    writer.seal(content, 'agent-A', NS);
    const env2 = writer.seal(content, 'agent-A', NS);
    expect(writer.verify(env2, NS).propagationDetected).toBe(false);
  });

  it('does NOT flag different writers sealing DIFFERENT content', () => {
    writer.seal({ a: 1 }, 'agent-A', NS);
    const envB = writer.seal({ b: 2 }, 'agent-B', NS);
    expect(writer.verify(envB, NS).propagationDetected).toBe(false);
  });
});

describe('SealedMemoryWriter — replay window boundary (unit, fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.CLAUDE_FLOW_SEAL_REPLAY_WINDOW_MS; // default 5 min
  });
  afterEach(() => { vi.useRealTimers(); });

  it('flags propagation INSIDE the replay window', () => {
    const writer = new SealedMemoryWriter();
    const content = { hop: 1 };
    vi.setSystemTime(0);
    writer.seal(content, 'agent-A', NS);
    vi.setSystemTime(100_000); // 100s later, inside the 5-min window
    const envB = writer.seal(content, 'agent-B', NS);
    expect(writer.verify(envB, NS).propagationDetected).toBe(true);
  });

  it('does NOT flag propagation OUTSIDE the replay window', () => {
    const writer = new SealedMemoryWriter();
    const content = { hop: 2 };
    vi.setSystemTime(0);
    writer.seal(content, 'agent-A', NS);
    vi.setSystemTime(400_000); // 400s later, beyond the 5-min (300s) window
    const envB = writer.seal(content, 'agent-B', NS);
    // agent-A's observation has been pruned, so no cross-writer hit remains.
    expect(writer.verify(envB, NS).propagationDetected).toBe(false);
  });
});

// ─── adapter-level emit [integration] ─────────────────────────────────────

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = Date.now();
  return {
    id: overrides.id ?? `e-${Math.random().toString(36).slice(2)}`,
    key: overrides.key ?? `k-${Math.random().toString(36).slice(2)}`,
    content: overrides.content ?? 'payload',
    type: overrides.type ?? 'semantic',
    namespace: overrides.namespace ?? NS,
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

describe('ADR-321 P2 — AgentDBAdapter emits seal:propagation-detected [integration]', () => {
  it('emits when the same content is stored under two different owners then read', async () => {
    const adapter = new AgentDBAdapter({ cacheEnabled: false });
    const spy = vi.fn();
    adapter.on('seal:propagation-detected', spy);

    const shared = 'identical-shared-content';
    await adapter.store(makeEntry({ id: 'prop-A', content: shared, ownerId: 'agent-A' }));
    await adapter.store(makeEntry({ id: 'prop-B', content: shared, ownerId: 'agent-B' }));

    await adapter.get('prop-B');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 'prop-B' }));
  });

  it('does not emit for a single owner storing unique content', async () => {
    const adapter = new AgentDBAdapter({ cacheEnabled: false });
    const spy = vi.fn();
    adapter.on('seal:propagation-detected', spy);

    await adapter.store(makeEntry({ id: 'solo', content: 'unique-content', ownerId: 'agent-A' }));
    await adapter.get('solo');
    expect(spy).not.toHaveBeenCalled();
  });
});
