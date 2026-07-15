/**
 * Integration tests for ADR-145 Part B write-ACL enforcement wired into
 * AgentDBAdapter (Task #10, ruvnet/ruflo#2630).
 *
 * Drives the REAL adapter with the resolved `store(entry, grant?)` signature
 * (team-lead: grant is an explicit typed second parameter, NOT buried in
 * entry.metadata, so the enforcement boundary is explicit). Enforcement gate:
 *   - CLAUDE_FLOW_STRICT_MEMORY === 'true' AND checkWrite().allowed === false
 *       -> store() rejects with MemoryWriteDenied; the entry is NOT persisted.
 *   - otherwise (legacy/default) -> store() resolves, entry IS persisted, with
 *       a warning logged (warn-then-block rollout, same shape as ADR-144/145).
 *   - undefined grant -> legacy-permissive, always stored (grants are opt-in in
 *       P1; the v4.0 strict-default flip is out of scope here).
 *
 * This maps to team-lead's stated Validation target: "an agent spawned with
 * writeNamespaces:['a'] cannot memory_store to namespace 'b' under strict mode;
 * legacy mode allows with a warning log."
 *
 * NOTE: bulkInsert() enforcement is deliberately NOT tested yet — the grant-
 * passing signature for bulkInsert wasn't resolved (store got `grant?`, but
 * bulkInsert's 2nd param is already `options`). Will add once coordinator
 * confirms how the grant reaches bulkInsert.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { AgentDBAdapter } from '../agentdb-adapter.js';
import type { MemoryEntry } from '../types.js';
import type { NamespaceGrant } from './authorization.js';

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = Date.now();
  return {
    id: overrides.id ?? `e-${Math.random().toString(36).slice(2)}`,
    key: overrides.key ?? 'k1',
    content: overrides.content ?? 'payload',
    type: overrides.type ?? 'semantic',
    namespace: overrides.namespace ?? 'learnings',
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

const grant = (writeNamespaces: string[]): NamespaceGrant => ({
  agentId: 'agent-alpha',
  writeNamespaces,
});

describe('ADR-145 Part B — store() write-ACL enforcement [integration]', () => {
  const prior = process.env.CLAUDE_FLOW_STRICT_MEMORY;
  afterEach(() => {
    if (prior === undefined) delete process.env.CLAUDE_FLOW_STRICT_MEMORY;
    else process.env.CLAUDE_FLOW_STRICT_MEMORY = prior;
  });

  it('strict mode: write to a namespace outside the grant is rejected and NOT persisted', async () => {
    process.env.CLAUDE_FLOW_STRICT_MEMORY = 'true';
    const adapter = new AgentDBAdapter({ cacheEnabled: false });
    const entry = makeEntry({ id: 'acl-1', namespace: 'b' });

    await expect(adapter.store(entry, grant(['a']))).rejects.toThrow();
    expect(await adapter.get('acl-1')).toBeNull();
  });

  it('legacy mode (default): out-of-grant write is allowed and persisted', async () => {
    delete process.env.CLAUDE_FLOW_STRICT_MEMORY;
    const adapter = new AgentDBAdapter({ cacheEnabled: false });
    const entry = makeEntry({ id: 'acl-2', namespace: 'b' });

    await expect(adapter.store(entry, grant(['a']))).resolves.toBeUndefined();
    expect(await adapter.get('acl-2')).not.toBeNull();
  });

  it('write to a namespace within the grant is allowed in strict mode', async () => {
    process.env.CLAUDE_FLOW_STRICT_MEMORY = 'true';
    const adapter = new AgentDBAdapter({ cacheEnabled: false });
    const entry = makeEntry({ id: 'acl-3', namespace: 'a' });

    await expect(adapter.store(entry, grant(['a']))).resolves.toBeUndefined();
    expect(await adapter.get('acl-3')).not.toBeNull();
  });

  it('undefined grant is legacy-permissive: stored even in strict mode', async () => {
    process.env.CLAUDE_FLOW_STRICT_MEMORY = 'true';
    const adapter = new AgentDBAdapter({ cacheEnabled: false });
    const entry = makeEntry({ id: 'acl-4', namespace: 'anything' });

    await expect(adapter.store(entry)).resolves.toBeUndefined();
    expect(await adapter.get('acl-4')).not.toBeNull();
  });
});

describe('ADR-145 Part B — bulkInsert() write-ACL enforcement [integration]', () => {
  const prior = process.env.CLAUDE_FLOW_STRICT_MEMORY;
  afterEach(() => {
    if (prior === undefined) delete process.env.CLAUDE_FLOW_STRICT_MEMORY;
    else process.env.CLAUDE_FLOW_STRICT_MEMORY = prior;
  });

  it('strict mode: rejects the WHOLE batch if any entry is outside the grant; none persisted', async () => {
    process.env.CLAUDE_FLOW_STRICT_MEMORY = 'true';
    const adapter = new AgentDBAdapter({ cacheEnabled: false });
    const inGrant = makeEntry({ id: 'bulk-a', namespace: 'a' });
    const outOfGrant = makeEntry({ id: 'bulk-b', namespace: 'b' });

    await expect(adapter.bulkInsert([inGrant, outOfGrant], undefined, grant(['a']))).rejects.toThrow();
    // Whole-call-rejects semantics: neither entry is persisted.
    expect(await adapter.get('bulk-a')).toBeNull();
    expect(await adapter.get('bulk-b')).toBeNull();
  });

  it('legacy mode: an out-of-grant batch is allowed and persisted', async () => {
    delete process.env.CLAUDE_FLOW_STRICT_MEMORY;
    const adapter = new AgentDBAdapter({ cacheEnabled: false });
    const entries = [makeEntry({ id: 'bulk-c', namespace: 'b' }), makeEntry({ id: 'bulk-d', namespace: 'b' })];

    await expect(adapter.bulkInsert(entries, undefined, grant(['a']))).resolves.toBeUndefined();
    expect(await adapter.get('bulk-c')).not.toBeNull();
    expect(await adapter.get('bulk-d')).not.toBeNull();
  });
});
