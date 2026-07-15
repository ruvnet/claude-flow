/**
 * Tests for ADR-178 Primitive 1 — VMG metadata (Task #11, ruvnet/ruflo#2630).
 *
 * Pure derivation unit tests for `vmg.ts` (computeWriteHash, deriveVmgPolicyTag,
 * computeVmgMetadata) plus AgentDBAdapter chain-integrity + rollback integration
 * (store → update → rollback maintains the writeHash/parentHash chain).
 */

import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  computeWriteHash,
  deriveVmgPolicyTag,
  computeVmgMetadata,
} from './vmg.js';
import { AgentDBAdapter } from '../agentdb-adapter.js';
import type { MemoryEntry } from '../types.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('computeWriteHash', () => {
  it('is the hex SHA-256 of content', () => {
    expect(computeWriteHash('hello')).toBe(sha256('hello'));
    expect(computeWriteHash('hello')).not.toBe(computeWriteHash('hellp')); // single-byte sensitivity
  });
});

describe('deriveVmgPolicyTag', () => {
  it('maps cache->ephemeral, working->session, everything else->persistent', () => {
    expect(deriveVmgPolicyTag('cache')).toBe('ephemeral');
    expect(deriveVmgPolicyTag('working')).toBe('session');
    expect(deriveVmgPolicyTag('semantic')).toBe('persistent');
    expect(deriveVmgPolicyTag('episodic')).toBe('persistent');
    expect(deriveVmgPolicyTag('procedural')).toBe('persistent');
  });
});

describe('computeVmgMetadata', () => {
  it('starts a fresh chain on the first write (version 1, no parentHash)', () => {
    const vmg = computeVmgMetadata({ content: 'v1', ownerId: 'agent-A', type: 'semantic', priorEntry: null });
    expect(vmg.version).toBe(1);
    expect(vmg.parentHash).toBeUndefined();
    expect(vmg.policyTag).toBe('persistent');
    expect(vmg.writeHash).toBe(sha256('v1'));
    expect(vmg.provenance.startsWith('agent-A:')).toBe(true);
  });

  it('extends the chain from a prior entry (version+1, parentHash=prior writeHash)', () => {
    const prior = { vmg: { version: 1, writeHash: sha256('v1') } } as unknown as MemoryEntry;
    const vmg = computeVmgMetadata({ content: 'v2', ownerId: 'agent-A', type: 'semantic', priorEntry: prior });
    expect(vmg.version).toBe(2);
    expect(vmg.parentHash).toBe(sha256('v1'));
    expect(vmg.writeHash).toBe(sha256('v2'));
  });

  it('uses "unknown" provenance when ownerId is absent', () => {
    const vmg = computeVmgMetadata({ content: 'x', type: 'cache', priorEntry: null });
    expect(vmg.provenance.startsWith('unknown:')).toBe(true);
    expect(vmg.policyTag).toBe('ephemeral');
  });
});

// ─── adapter chain integrity + rollback [integration] ─────────────────────

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = Date.now();
  return {
    id: overrides.id ?? `e-${Math.random().toString(36).slice(2)}`,
    key: overrides.key ?? 'k1',
    content: overrides.content ?? 'v1',
    type: overrides.type ?? 'semantic',
    namespace: overrides.namespace ?? 'learnings', // non-sealed, avoids seal interplay
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

describe('AgentDBAdapter — VMG chain integrity + rollback [integration]', () => {
  it('store attaches a v1 VMG chain head', async () => {
    const adapter = new AgentDBAdapter({ cacheEnabled: false });
    const entry = makeEntry({ id: 'vmg-1', content: 'v1' });
    await adapter.store(entry);
    expect(entry.vmg).toBeDefined();
    expect(entry.vmg!.version).toBe(1);
    expect(entry.vmg!.parentHash).toBeUndefined();
    expect(entry.vmg!.writeHash).toBe(sha256('v1'));
  });

  it('update on changed content extends the chain (version 2, parentHash links v1)', async () => {
    const adapter = new AgentDBAdapter({ cacheEnabled: false });
    const entry = makeEntry({ id: 'vmg-2', content: 'v1' });
    await adapter.store(entry);
    const v1Hash = entry.vmg!.writeHash;

    const updated = await adapter.update('vmg-2', { content: 'v2' });
    expect(updated).not.toBeNull();
    expect(updated!.vmg!.version).toBe(2);
    expect(updated!.vmg!.parentHash).toBe(v1Hash);
    expect(updated!.vmg!.writeHash).toBe(sha256('v2'));
  });

  it('rollback restores the pre-update content and emits entry:rolled-back', async () => {
    const adapter = new AgentDBAdapter({ cacheEnabled: false });
    const rolledSpy = vi.fn();
    adapter.on('entry:rolled-back', rolledSpy);

    const entry = makeEntry({ id: 'vmg-3', content: 'original' });
    await adapter.store(entry);
    await adapter.update('vmg-3', { content: 'mutated' });

    const restored = await adapter.rollback('vmg-3');
    expect(restored).not.toBeNull();
    expect(restored!.content).toBe('original');
    expect(rolledSpy).toHaveBeenCalledTimes(1);
  });

  it('rollback returns null for an id with no update history', async () => {
    const adapter = new AgentDBAdapter({ cacheEnabled: false });
    await adapter.store(makeEntry({ id: 'vmg-4' }));
    expect(await adapter.rollback('vmg-4')).toBeNull();       // stored but never updated
    expect(await adapter.rollback('never-existed')).toBeNull();
  });
});
