/**
 * Integration tests for ADR-321 P1 sealing wired into AgentDBAdapter
 * (ruvnet/ruflo#2630).
 *
 * These drive the REAL AgentDBAdapter store()/get()/getByKey() path with the
 * default in-process key store — NOT a mocked SealedMemoryWriter. They prove the
 * composition seam coder built: writes into `config.sealedNamespaces` are sealed
 * on store and verified on read, tamper emits `seal:tamper-detected`, and
 * withholding is gated on `CLAUDE_FLOW_STRICT_SEALING`.
 *
 * Scope honesty: this is the AgentDBAdapter integration point, which is the real
 * P1 wiring location (the ADR's post-edit.ts / ADR-145 Part B ACL / ADR-178
 * write_hash stages do not exist in code — see reconciled plan). `writerId`
 * comes from `entry.ownerId`; there is no grant system to authorize it against
 * yet, so this does not exercise an end-to-end ACL->VMG->seal pipeline.
 *
 * Cache is disabled in these adapters so every get() re-runs verification against
 * main storage rather than returning a cached object.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentDBAdapter } from '../agentdb-adapter.js';
import type { MemoryEntry } from '../types.js';

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = Date.now();
  return {
    id: overrides.id ?? `e-${Math.random().toString(36).slice(2)}`,
    key: overrides.key ?? 'k1',
    content: overrides.content ?? 'shared collaboration note',
    type: overrides.type ?? 'semantic',
    namespace: overrides.namespace ?? 'collaboration',
    tags: overrides.tags ?? [],
    metadata: overrides.metadata ?? {},
    ownerId: overrides.ownerId ?? 'agent-alpha',
    accessLevel: overrides.accessLevel ?? 'swarm',
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  } as MemoryEntry;
}

function makeAdapter() {
  return new AgentDBAdapter({ cacheEnabled: false });
}

describe('ADR-321 P1 — AgentDBAdapter sealing wiring [integration]', () => {
  const priorStrict = process.env.CLAUDE_FLOW_STRICT_SEALING;

  afterEach(() => {
    if (priorStrict === undefined) delete process.env.CLAUDE_FLOW_STRICT_SEALING;
    else process.env.CLAUDE_FLOW_STRICT_SEALING = priorStrict;
    vi.restoreAllMocks();
  });

  it('seals an entry written to the collaboration namespace', async () => {
    const adapter = makeAdapter();
    const entry = makeEntry({ namespace: 'collaboration' });

    await adapter.store(entry);

    const sealed = (entry.metadata as any).sealed;
    expect(sealed).toBeDefined();
    expect(typeof sealed.seal).toBe('string');
    expect(sealed.seal.length).toBeGreaterThan(0);
    expect(sealed.writerId).toBe('agent-alpha');
    expect(sealed.keyEpoch).toBe(1);
  });

  it('round-trips a sealed entry through get() with content intact', async () => {
    const adapter = makeAdapter();
    const entry = makeEntry({ id: 'rt-1', content: 'verified payload' });

    await adapter.store(entry);
    const got = await adapter.get('rt-1');

    expect(got).not.toBeNull();
    expect(got!.content).toBe('verified payload');
  });

  it('round-trips a sealed entry through getByKey()', async () => {
    const adapter = makeAdapter();
    const entry = makeEntry({ key: 'shared-key', namespace: 'collaboration' });

    await adapter.store(entry);
    const got = await adapter.getByKey('collaboration', 'shared-key');

    expect(got).not.toBeNull();
    expect(got!.content).toBe('shared collaboration note');
  });

  it('does NOT seal entries written to a non-sealed namespace', async () => {
    const adapter = makeAdapter();
    const entry = makeEntry({ id: 'ns-1', namespace: 'learnings' });

    await adapter.store(entry);
    expect((entry.metadata as any).sealed).toBeUndefined();

    const got = await adapter.get('ns-1');
    expect(got).not.toBeNull();
    expect(got!.content).toBe('shared collaboration note');
  });

  it('emits seal:tamper-detected when a stored sealed entry is mutated', async () => {
    const adapter = makeAdapter();
    const tamperSpy = vi.fn();
    adapter.on('seal:tamper-detected', tamperSpy);

    const entry = makeEntry({ id: 'tp-1', content: 'original' });
    await adapter.store(entry);

    // Simulate tamper-in-storage: the stored object is the same reference.
    entry.content = 'attacker-controlled';

    await adapter.get('tp-1');

    expect(tamperSpy).toHaveBeenCalledTimes(1);
    expect(tamperSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tp-1', namespace: 'collaboration' }),
    );
  });

  it('warn mode (default): tampered entry is still returned', async () => {
    delete process.env.CLAUDE_FLOW_STRICT_SEALING;
    const adapter = makeAdapter();
    const entry = makeEntry({ id: 'warn-1', content: 'original' });
    await adapter.store(entry);

    entry.content = 'attacker-controlled';
    const got = await adapter.get('warn-1');

    expect(got).not.toBeNull(); // warn-then-block rollout: not withheld yet
  });

  it('strict mode: tampered entry is withheld (null)', async () => {
    process.env.CLAUDE_FLOW_STRICT_SEALING = 'true';
    const adapter = makeAdapter();
    const tamperSpy = vi.fn();
    adapter.on('seal:tamper-detected', tamperSpy);

    const entry = makeEntry({ id: 'strict-1', content: 'original' });
    await adapter.store(entry);

    entry.content = 'attacker-controlled';
    const got = await adapter.get('strict-1');

    expect(tamperSpy).toHaveBeenCalledTimes(1); // always emitted
    expect(got).toBeNull(); // withheld under strict sealing
  });
});
