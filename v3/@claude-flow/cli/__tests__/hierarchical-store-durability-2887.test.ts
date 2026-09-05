/**
 * agentdb_hierarchical-store durability contract (#2887).
 *
 * agentdb removed its `HierarchicalMemory` export at 3.0.0-alpha.17, so every
 * hierarchical-store call lands in @claude-flow/memory's TieredMemoryStore
 * fallback. While that fallback was purely in-process, the bridge still
 * reported `success: true` for writes that never reached disk and were never
 * recallable — silent data loss.
 *
 * These tests pin the decision the bridge makes about a store's durability:
 * a volatile backing store must never be described as durable, and every
 * result must name the controller actually in use plus why it was chosen.
 */

import { describe, expect, it } from 'vitest';
import { describeHierarchicalStore } from '../src/memory/memory-bridge.js';
import { agentdbHierarchicalStore, agentdbTools } from '../src/mcp-tools/agentdb-tools.js';

/** Minimal TieredMemoryStore stand-in with a switchable durability mode. */
function fakeTieredStore(durable: boolean) {
  return {
    isDurable: () => durable,
    getPersistence: () => (durable ? 'sqlite' : 'volatile'),
    countPersisted: () => (durable ? 1 : null),
  };
}

describe('describeHierarchicalStore — durability contract (#2887)', () => {
  it('marks a SQLite-backed fallback durable and names its cause', () => {
    const info = describeHierarchicalStore(fakeTieredStore(true), {
      reason: 'agentdb-export-missing',
    });

    expect(info).toEqual({
      controller: 'tieredMemoryStore',
      fallbackFrom: 'agentdb-export-missing',
      durable: true,
      persistence: 'sqlite',
    });
  });

  it('never describes a volatile fallback as durable', () => {
    const info = describeHierarchicalStore(fakeTieredStore(false), {
      reason: 'agentdb-unavailable',
    });

    expect(info.durable).toBe(false);
    expect(info.persistence).toBe('volatile');
    expect(info.controller).toBe('tieredMemoryStore');
  });

  it('still names the fallback when the registry cannot report a reason', () => {
    const info = describeHierarchicalStore(fakeTieredStore(true), null);

    expect(info.controller).toBe('tieredMemoryStore');
    expect(info.fallbackFrom).toBe('hierarchicalMemory');
  });

  it('treats a native agentdb controller (no isDurable) as the durable path', () => {
    const nativeHm = { getStats: () => ({}), promote: () => {}, store: async () => 'id' };

    const info = describeHierarchicalStore(nativeHm, null);

    expect(info).toEqual({
      controller: 'hierarchicalMemory',
      durable: true,
      persistence: 'agentdb',
    });
  });
});

describe('agentdb_hierarchical-store MCP surface (#2887)', () => {
  it('is registered as an MCP tool', () => {
    expect(agentdbTools.map((t) => t.name)).toContain('agentdb_hierarchical-store');
  });

  it('rejects an invalid tier without claiming a write happened', async () => {
    const result = await agentdbHierarchicalStore.handler({
      key: 'k',
      value: 'v',
      tier: 'not-a-real-tier',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/tier/i);
  });

  it('never returns a bare success — a durability verdict always accompanies it', async () => {
    const result = await agentdbHierarchicalStore.handler({
      key: 'durability-contract-probe',
      value: 'probe',
      tier: 'working',
    });

    // The bridge may be unavailable in a bare test env; what must never happen
    // is success:true with no statement about whether the write is durable.
    if (result.success === true) {
      expect(result.durable).toBe(true);
      expect(typeof result.persistence).toBe('string');
      expect(typeof result.controller).toBe('string');
    } else {
      expect(typeof result.error).toBe('string');
    }
  });
});
