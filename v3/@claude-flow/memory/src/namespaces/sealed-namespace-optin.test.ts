/**
 * Tests for ADR-321 P3 sealed-namespace opt-in (Task #7, ruvnet/ruflo#2630).
 *
 * P3 makes the sealed-namespace set a runtime, mutable, Set-backed control on
 * AgentDBAdapter: `isNamespaceSealed()` queries it, `markNamespaceSealed()`
 * extends it. Sealing/verify logic itself is unchanged — this only verifies the
 * opt-in surface and that a newly-marked namespace actually seals on write.
 */

import { describe, it, expect } from 'vitest';
import { AgentDBAdapter } from '../agentdb-adapter.js';
import type { MemoryEntry } from '../types.js';

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = Date.now();
  return {
    id: overrides.id ?? `e-${Math.random().toString(36).slice(2)}`,
    key: overrides.key ?? 'k1',
    content: overrides.content ?? 'payload',
    type: overrides.type ?? 'semantic',
    namespace: overrides.namespace ?? 'default',
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

describe('AgentDBAdapter — sealed-namespace opt-in (ADR-321 P3)', () => {
  it('seals the default collaboration namespace but not others', () => {
    const adapter = new AgentDBAdapter({ cacheEnabled: false });
    expect(adapter.isNamespaceSealed('collaboration')).toBe(true);
    expect(adapter.isNamespaceSealed('learnings')).toBe(false);
  });

  it('config.sealedNamespaces overrides the default set', () => {
    const adapter = new AgentDBAdapter({ cacheEnabled: false, sealedNamespaces: ['team-secrets'] });
    expect(adapter.isNamespaceSealed('team-secrets')).toBe(true);
    expect(adapter.isNamespaceSealed('collaboration')).toBe(false);
  });

  it('markNamespaceSealed extends the sealed set at runtime', () => {
    const adapter = new AgentDBAdapter({ cacheEnabled: false });
    expect(adapter.isNamespaceSealed('project-x')).toBe(false);
    adapter.markNamespaceSealed('project-x');
    expect(adapter.isNamespaceSealed('project-x')).toBe(true);
  });

  it('a newly-marked namespace actually seals on write and round-trips on read', async () => {
    const adapter = new AgentDBAdapter({ cacheEnabled: false });
    adapter.markNamespaceSealed('project-x');

    const entry = makeEntry({ id: 'optin-1', namespace: 'project-x', content: 'sensitive' });
    await adapter.store(entry);

    expect((entry.metadata as any).sealed).toBeDefined();
    const got = await adapter.get('optin-1');
    expect(got).not.toBeNull();
    expect(got!.content).toBe('sensitive');
  });

  it('an un-marked namespace is not sealed on write', async () => {
    const adapter = new AgentDBAdapter({ cacheEnabled: false });
    const entry = makeEntry({ id: 'optin-2', namespace: 'ordinary' });
    await adapter.store(entry);
    expect((entry.metadata as any).sealed).toBeUndefined();
  });
});
