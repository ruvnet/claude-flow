/**
 * #4157: when registry discovery falls back to the built-in entry, the result must say so.
 * It used to present a placeholder signature as a verified pattern with invented download
 * counts, a rating, and a lastUpdated stamped with the current time on every call.
 */
import { describe, expect, it } from 'vitest';
import { PatternDiscovery } from '../src/transfer/store/discovery.js';

describe('built-in fallback registry (#4157)', () => {
  const registry = (new PatternDiscovery() as unknown as { getGenesisRegistry(cid: string): any }).getGenesisRegistry('bafy-test');
  const entry = registry.patterns[0];

  it('is labelled as a built-in fallback, not live registry data', () => {
    expect(registry.source).toBe('builtin-fallback');
    expect(entry.source).toBe('builtin-fallback');
  });

  it('does not claim verification on a placeholder signature', () => {
    expect(entry.verified).toBe(false);
    expect(entry.trustLevel).toBe('unverified');
    expect(String(entry.signature ?? '')).not.toMatch(/placeholder|genesis-pattern-signature/);
    expect(registry.authors[0].verified).toBe(false);
  });

  it('does not invent popularity or freshness', () => {
    expect(entry.downloads).toBe(0);
    expect(entry.rating).toBe(0);
    expect(entry.ratingCount).toBe(0);
    expect(registry.totalDownloads).toBe(0);
    const again = (new PatternDiscovery() as unknown as { getGenesisRegistry(cid: string): any }).getGenesisRegistry('bafy-test');
    expect(again.patterns[0].lastUpdated).toBe(entry.lastUpdated); // a fixed date, not "now"
    expect(entry.lastUpdated).toBe(entry.createdAt);
  });

  it('carries no registry signature it did not compute', () => {
    expect(registry.registrySignature).toBeUndefined();
  });
});
