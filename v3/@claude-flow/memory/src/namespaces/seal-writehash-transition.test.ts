/**
 * ADR-321 ↔ ADR-178 composition test: seal() consuming the VMG writeHash
 * (Task #5/#11 transition, ruvnet/ruflo#2630).
 *
 * seal()'s new 4th arg `precomputedContentHash` lets AgentDBAdapter.sealEntry()
 * pass the real `entry.vmg.writeHash` instead of seal recomputing its own hash
 * (the ADR spec: HMAC over content + writerId + namespace + writeHash-from-178).
 * verify() deliberately does NOT accept this parameter — it always self-computes
 * from envelope.content — so these tests also pin the seal/verify asymmetry that
 * is the load-bearing tamper-detection property.
 */

import { describe, it, expect } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { SealedMemoryWriter, type SealedKeyStore } from './sealed-writer.js';

const KEY = Buffer.alloc(32, 7); // fixed key so the HMAC can be recomputed here
function fixedKeyStore(): SealedKeyStore {
  return {
    getKey: () => ({ key: new Uint8Array(KEY), epoch: 1 }),
    rotateKey: () => {},
  };
}
const expectedSeal = (hash: string, writerId: string, namespace: string) =>
  createHmac('sha256', KEY).update(`${hash}:${writerId}:${namespace}`).digest('hex');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('seal() precomputedContentHash (ADR-178 writeHash composition)', () => {
  it('uses the supplied precomputed hash as the HMAC content-hash input', () => {
    const writer = new SealedMemoryWriter(fixedKeyStore());
    const env = writer.seal('hello', 'agent-A', 'ns', 'deadbeef');
    expect(env.seal).toBe(expectedSeal('deadbeef', 'agent-A', 'ns'));
  });

  it('falls back to its own SHA-256 of content when no hash is supplied', () => {
    const writer = new SealedMemoryWriter(fixedKeyStore());
    const env = writer.seal('hello', 'agent-A', 'ns');
    expect(env.seal).toBe(expectedSeal(sha256('hello'), 'agent-A', 'ns'));
  });

  it('the VMG writeHash and the inline hash agree for string content (identical seal)', () => {
    const writer = new SealedMemoryWriter(fixedKeyStore());
    const withVmgHash = writer.seal('hello', 'agent-A', 'ns', sha256('hello'));
    const inline = writer.seal('hello', 'agent-A', 'ns');
    expect(withVmgHash.seal).toBe(inline.seal);
  });

  it('a DIFFERENT precomputed hash produces a different seal (the arg really drives it)', () => {
    const writer = new SealedMemoryWriter(fixedKeyStore());
    const a = writer.seal('hello', 'agent-A', 'ns', 'aaaa');
    const b = writer.seal('hello', 'agent-A', 'ns', 'bbbb');
    expect(a.seal).not.toBe(b.seal);
  });
});

describe('seal/verify asymmetry — verify never trusts a precomputed hash', () => {
  it('verify() succeeds when the precomputed hash equals the real content hash', () => {
    const writer = new SealedMemoryWriter();
    const env = writer.seal('hello', 'agent-A', 'collaboration', sha256('hello'));
    expect(writer.verify(env, 'collaboration').valid).toBe(true);
  });

  it('verify() FAILS when seal used a precomputed hash that lies about the content', () => {
    // If seal trusts a wrong hash but verify self-computes from content, the
    // mismatch is caught — the ClawWorm read-time-trust protection.
    const writer = new SealedMemoryWriter();
    const env = writer.seal('hello', 'agent-A', 'collaboration', sha256('not-the-content'));
    expect(writer.verify(env, 'collaboration').valid).toBe(false);
  });
});
