/**
 * Tests for TieredMemoryStore temporal validity (Zep/Graphiti-style).
 *
 * Covers: supersede flow (invalidate, not delete), expired filtering,
 * the includeExpired escape hatch, and backward compatibility for legacy
 * entries without temporal fields.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TieredMemoryStore, isTemporallyValid } from './tiered-memory.js';

describe('TieredMemoryStore — legacy behavior (backward compatibility)', () => {
  let store: TieredMemoryStore;

  beforeEach(() => {
    store = new TieredMemoryStore();
  });

  it('stores and recalls entries without temporal fields exactly as before', () => {
    store.store('auth-pattern', 'JWT with refresh tokens', 'semantic');
    store.store('scratch', 'temp note', 'working');

    const results = store.recall('jwt', 5);
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe('auth-pattern');
    expect(results[0].tier).toBe('semantic');
    expect(results[0].validFrom).toBeUndefined();
    expect(results[0].validUntil).toBeUndefined();
    expect(results[0].supersededBy).toBeUndefined();
  });

  it('same-key store within a tier overwrites (legacy semantics)', () => {
    store.store('k1', 'first value', 'working');
    store.store('k1', 'second value', 'working');

    const results = store.recall('value', 10);
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe('second value');
  });

  it('defaults invalid tiers to working', () => {
    store.store('k1', 'v1', 'nonsense-tier');
    expect(store.getTierStats().working).toBe(1);
  });

  it('reports per-tier stats plus superseded archive size', () => {
    store.store('a', 'v', 'working');
    store.store('b', 'v', 'episodic');
    const stats = store.getTierStats();
    expect(stats.working).toBe(1);
    expect(stats.episodic).toBe(1);
    expect(stats.semantic).toBe(0);
    expect(stats.superseded).toBe(0);
  });

  it('remove() hard-deletes an active entry by key', () => {
    store.store('gone', 'delete me', 'working');
    expect(store.remove('gone')).toBe(true);
    expect(store.recall('delete me', 5)).toHaveLength(0);
    expect(store.remove('gone')).toBe(false);
  });
});

describe('TieredMemoryStore — supersede flow', () => {
  let store: TieredMemoryStore;

  beforeEach(() => {
    store = new TieredMemoryStore();
  });

  it('invalidates (not deletes) the superseded entry and links supersededBy', () => {
    const oldFact = store.store('ceo', 'The CEO is Alice', 'semantic');
    const newFact = store.store('ceo-2026', 'The CEO is Bob', 'semantic', {
      supersedes: oldFact.id,
    });

    expect(newFact.superseded).not.toBeNull();
    expect(newFact.superseded!.id).toBe(oldFact.id);
    expect(newFact.superseded!.validUntil).toBeTruthy();

    // Default recall: only the new fact is visible
    const current = store.recall('CEO', 10);
    expect(current).toHaveLength(1);
    expect(current[0].key).toBe('ceo-2026');

    // Escape hatch: both facts visible, old one carries the invalidation stamp
    const audit = store.recall('CEO', 10, { includeExpired: true });
    expect(audit).toHaveLength(2);
    const old = audit.find((e) => e.key === 'ceo');
    expect(old).toBeDefined();
    expect(old!.supersededBy).toBe(newFact.id);
    expect(Date.parse(old!.validUntil!)).toBeLessThanOrEqual(Date.now());
  });

  it('resolves supersedes by key when no id matches', () => {
    store.store('policy', 'Old policy text', 'semantic');
    const result = store.store('policy-v2', 'New policy text', 'semantic', {
      supersedes: 'policy',
    });

    expect(result.superseded).not.toBeNull();
    expect(result.superseded!.key).toBe('policy');
    expect(store.recall('policy text', 10)).toHaveLength(1);
    expect(store.recall('policy text', 10, { includeExpired: true })).toHaveLength(2);
  });

  it('superseding with the SAME key preserves the old fact in the archive', () => {
    const oldFact = store.store('config', 'timeout=30', 'semantic');
    store.store('config', 'timeout=60', 'semantic', { supersedes: oldFact.id });

    const current = store.recall('timeout', 10);
    expect(current).toHaveLength(1);
    expect(current[0].value).toBe('timeout=60');

    const audit = store.recall('timeout', 10, { includeExpired: true });
    expect(audit).toHaveLength(2);
    expect(audit.map((e) => e.value).sort()).toEqual(['timeout=30', 'timeout=60']);
  });

  it('returns null superseded when the target does not exist', () => {
    const result = store.store('k', 'v', 'working', { supersedes: 'no-such-entry' });
    expect(result.superseded).toBeNull();
  });
});

describe('TieredMemoryStore — validity-window filtering', () => {
  let store: TieredMemoryStore;

  beforeEach(() => {
    store = new TieredMemoryStore();
  });

  it('filters entries whose validUntil is in the past by default', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    store.store('expired-fact', 'promo code SAVE20', 'semantic', { validUntil: past });
    store.store('live-fact', 'promo code SAVE30', 'semantic');

    const results = store.recall('promo code', 10);
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe('live-fact');
  });

  it('includeExpired returns expired entries too (audit escape hatch)', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    store.store('expired-fact', 'promo code SAVE20', 'semantic', { validUntil: past });
    store.store('live-fact', 'promo code SAVE30', 'semantic');

    const results = store.recall('promo code', 10, { includeExpired: true });
    expect(results).toHaveLength(2);
  });

  it('keeps entries whose validUntil is in the future', () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    store.store('ttl-fact', 'valid for one hour', 'working', { validUntil: future });

    expect(store.recall('one hour', 5)).toHaveLength(1);
  });

  it('hides not-yet-valid entries (validFrom in the future) by default', () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    store.store('scheduled-fact', 'new pricing takes effect', 'semantic', { validFrom: future });

    expect(store.recall('pricing', 5)).toHaveLength(0);
    expect(store.recall('pricing', 5, { includeExpired: true })).toHaveLength(1);
  });

  it('treats unparseable timestamps as absent instead of hiding the entry', () => {
    store.store('weird', 'garbage timestamp entry', 'working', { validUntil: 'not-a-date' });
    expect(store.recall('garbage', 5)).toHaveLength(1);
  });
});

describe('isTemporallyValid', () => {
  const now = Date.parse('2026-07-03T12:00:00Z');

  it('entries without fields are always valid', () => {
    expect(isTemporallyValid({}, now)).toBe(true);
  });

  it('respects validFrom / validUntil boundaries', () => {
    expect(isTemporallyValid({ validFrom: '2026-07-03T13:00:00Z' }, now)).toBe(false);
    expect(isTemporallyValid({ validFrom: '2026-07-03T11:00:00Z' }, now)).toBe(true);
    expect(isTemporallyValid({ validUntil: '2026-07-03T11:00:00Z' }, now)).toBe(false);
    expect(isTemporallyValid({ validUntil: '2026-07-03T13:00:00Z' }, now)).toBe(true);
    // validUntil exactly now → expired (window is half-open)
    expect(isTemporallyValid({ validUntil: '2026-07-03T12:00:00Z' }, now)).toBe(false);
  });
});
