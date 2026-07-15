/**
 * ADR-321 seal/verify overhead benchmark (Task #9, ruvnet/ruflo#2630).
 *
 * Measures the per-operation cost of HMAC-SHA256 sealing and verification
 * against the `<100ms` MCP response target in v3/CLAUDE.md. HMAC-SHA256 is
 * cheap, so these are expected to be sub-millisecond — the point is a real
 * measured baseline + a regression guard, not a tight SLA.
 *
 * The P2 propagation-history replay window is pinned to 1ms here so the
 * cross-namespace observation map stays bounded under millions of bench
 * iterations — otherwise we'd be measuring unbounded map growth from sealing
 * the same content repeatedly, not the crypto cost. Real callers seal varied
 * content and the default 5-min window prunes normally.
 */

import { bench, describe } from 'vitest';
import { SealedMemoryWriter } from '../src/namespaces/sealed-writer.js';

process.env.CLAUDE_FLOW_SEAL_REPLAY_WINDOW_MS = '1';

const writer = new SealedMemoryWriter();
const content = { task: 'summarize', items: [1, 2, 3, 4, 5], text: 'lorem ipsum dolor '.repeat(20) };
const envelope = writer.seal(content, 'agent-A', 'collaboration');

describe('ADR-321 sealed-namespace crypto overhead (target: <100ms MCP)', () => {
  bench('seal()', () => {
    writer.seal(content, 'agent-A', 'collaboration');
  });

  bench('verify()', () => {
    writer.verify(envelope, 'collaboration');
  });

  bench('seal() + verify() round-trip', () => {
    const e = writer.seal(content, 'agent-A', 'collaboration');
    writer.verify(e, 'collaboration');
  });
});
