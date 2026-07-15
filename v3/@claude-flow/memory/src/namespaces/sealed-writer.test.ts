/**
 * Tests for SealedMemoryWriter (ADR-321 P1, ruvnet/ruflo#2630).
 *
 * TDD London School: the only collaborator is the namespace key store, which is
 * MOCKED here so these tests isolate SealedMemoryWriter's own seal/verify logic
 * and never depend on real key material, AgentDB, or the ADR-178 VMG pipeline
 * (which does not exist yet — see the reconciled plan). All assertions are
 * black-box against the public seal()/verify() surface; the test never
 * re-implements the HMAC construction, so the exact seal formula stays an
 * implementation detail of the unit under test.
 *
 * Covers the ADR-321 P1 "Validation" section unit tests:
 *  - round-trip seal() -> verify() succeeds and returns the original content
 *  - any single-byte mutation of sealed content fails verification
 *  - mutating writerId or the seal bytes fails verification (same HMAC inputs)
 *  - a seal computed under one keyEpoch fails verification after rotation
 *
 * Plus one clearly-labeled namespace-scoping integration-style test (the ADR's
 * "sealed under a different namespace's key fails verify()" property), with the
 * ADR-145 Part B ACL + ADR-178 write_hash inputs mocked, since neither exists in
 * code yet. It is NOT proof the full write pipeline composed.
 *
 * CONTRACT THIS FILE ASSERTS (proposed to coordinator/architect — build to this
 * or tell the tester to adjust):
 *   interface SealedKeyStore {
 *     getKey(namespace: string): { key: Uint8Array; epoch: number };
 *     rotateKey(namespace: string): void;
 *   }
 *   class SealedMemoryWriter {
 *     constructor(keyStore: SealedKeyStore);              // DI collaborator
 *     seal(content: unknown, writerId: string, namespace: string): SealedEnvelope;
 *     verify(envelope: SealedEnvelope, namespace: string): { valid: boolean; content?: unknown };
 *   }
 *   // verify() recomputes the seal with the CURRENT key from getKey(namespace);
 *   // a stale-epoch envelope therefore fails after rotateKey() — matching the
 *   // ADR validation line "a seal computed under one keyEpoch fails verification
 *   // after rotation to the next".
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  SealedMemoryWriter,
  type SealedEnvelope,
  type SealedKeyStore,
} from './sealed-writer.js';

// ─── mocked collaborator ────────────────────────────────────────────────

/**
 * Namespace-aware in-memory key store standing in for the real server-side
 * SealedKeyStore. Each namespace lazily gets a distinct random 32-byte HMAC key
 * at epoch 1; rotateKey() bumps the epoch and swaps in fresh key material.
 * getKey/rotateKey are vi.fn spies so interaction can be asserted (London style).
 */
function makeKeyStoreMock(): SealedKeyStore & {
  getKey: ReturnType<typeof vi.fn>;
  rotateKey: ReturnType<typeof vi.fn>;
} {
  const keys = new Map<string, { key: Uint8Array; epoch: number }>();
  const ensure = (ns: string) => {
    if (!keys.has(ns)) keys.set(ns, { key: randomBytes(32), epoch: 1 });
    return keys.get(ns)!;
  };
  return {
    getKey: vi.fn((ns: string) => {
      const k = ensure(ns);
      return { key: k.key, epoch: k.epoch };
    }),
    rotateKey: vi.fn((ns: string) => {
      const k = ensure(ns);
      keys.set(ns, { key: randomBytes(32), epoch: k.epoch + 1 });
    }),
  };
}

const NS = 'collaboration';
const WRITER = 'agent-alpha';

// ─── unit tests ─────────────────────────────────────────────────────────

describe('SealedMemoryWriter — seal/verify round-trip (unit)', () => {
  let keyStore: ReturnType<typeof makeKeyStoreMock>;
  let writer: SealedMemoryWriter;

  beforeEach(() => {
    keyStore = makeKeyStoreMock();
    writer = new SealedMemoryWriter(keyStore);
  });

  it('seals content and verifies it back unchanged', () => {
    const content = { task: 'summarize', payload: [1, 2, 3], nested: { ok: true } };

    const envelope = writer.seal(content, WRITER, NS);

    // envelope shape (ADR-321 SealedEnvelope)
    expect(envelope.writerId).toBe(WRITER);
    expect(typeof envelope.seal).toBe('string');
    expect(envelope.seal.length).toBeGreaterThan(0);
    expect(envelope.keyEpoch).toBe(1);
    expect(typeof envelope.sealedAt).toBe('number');

    const result = writer.verify(envelope, NS);
    expect(result.valid).toBe(true);
    expect(result.content).toEqual(content);

    // London-style interaction check: the writer went through the key store
    // for the namespace, both to seal and to verify.
    expect(keyStore.getKey).toHaveBeenCalledWith(NS);
  });

  it('verifies primitive (non-object) content', () => {
    const envelope = writer.seal('a plain string payload', WRITER, NS);
    const result = writer.verify(envelope, NS);
    expect(result.valid).toBe(true);
    expect(result.content).toBe('a plain string payload');
  });
});

describe('SealedMemoryWriter — tamper detection (unit)', () => {
  let keyStore: ReturnType<typeof makeKeyStoreMock>;
  let writer: SealedMemoryWriter;

  beforeEach(() => {
    keyStore = makeKeyStoreMock();
    writer = new SealedMemoryWriter(keyStore);
  });

  it('fails verification when a single byte of sealed content is mutated', () => {
    const content = { message: 'hello world' };
    const envelope = writer.seal(content, WRITER, NS);

    // Flip one byte of the content after sealing ('world' -> 'worlt').
    const tampered: SealedEnvelope = {
      ...envelope,
      content: { message: 'hello worlt' },
    };

    const result = writer.verify(tampered, NS);
    expect(result.valid).toBe(false);
    expect(result.content).toBeUndefined();
  });

  it('fails verification when the writerId is swapped', () => {
    const envelope = writer.seal({ n: 1 }, WRITER, NS);
    const tampered: SealedEnvelope = { ...envelope, writerId: 'agent-mallory' };
    expect(writer.verify(tampered, NS).valid).toBe(false);
  });

  it('fails verification when a single byte of the seal itself is flipped', () => {
    const envelope = writer.seal({ n: 1 }, WRITER, NS);
    const chars = envelope.seal.split('');
    // Flip the first hex nibble to a guaranteed-different value.
    chars[0] = chars[0] === '0' ? '1' : '0';
    const tampered: SealedEnvelope = { ...envelope, seal: chars.join('') };
    expect(writer.verify(tampered, NS).valid).toBe(false);
  });
});

describe('SealedMemoryWriter — key epoch rotation (unit)', () => {
  let keyStore: ReturnType<typeof makeKeyStoreMock>;
  let writer: SealedMemoryWriter;

  beforeEach(() => {
    keyStore = makeKeyStoreMock();
    writer = new SealedMemoryWriter(keyStore);
  });

  it('a seal computed under one keyEpoch fails verification after rotation', () => {
    const content = { state: 'clean' };
    const envelope = writer.seal(content, WRITER, NS);
    expect(envelope.keyEpoch).toBe(1);

    // Sanity: verifies before rotation.
    expect(writer.verify(envelope, NS).valid).toBe(true);

    // Rotate the namespace key to the next epoch.
    keyStore.rotateKey(NS);

    // The stale-epoch envelope must now fail against the current key.
    const result = writer.verify(envelope, NS);
    expect(result.valid).toBe(false);
  });

  it('content sealed under the new epoch verifies under the new key', () => {
    keyStore.rotateKey(NS); // now at epoch 2
    const envelope = writer.seal({ fresh: true }, WRITER, NS);
    expect(envelope.keyEpoch).toBe(2);
    expect(writer.verify(envelope, NS).valid).toBe(true);
  });
});

// ─── namespace-scoping (integration-style, boundaries MOCKED) ─────────────

describe('SealedMemoryWriter — namespace scoping [integration: ACL/write_hash MOCKED]', () => {
  // The ADR-321 integration test is: a write that passes ADR-145 Part B's ACL
  // check but is sealed under a DIFFERENT namespace's key fails verify(). Since
  // ADR-145 Part B (write ACL) and ADR-178 (write_hash) are not implemented,
  // this drives ONLY the namespace-scoping property of SealedMemoryWriter with
  // the ACL grant and VMG write_hash inputs assumed/mocked. It is NOT evidence
  // that the real ADR-145 -> ADR-178 -> ADR-321 -> AgentDB pipeline composed.
  let keyStore: ReturnType<typeof makeKeyStoreMock>;
  let writer: SealedMemoryWriter;

  beforeEach(() => {
    keyStore = makeKeyStoreMock();
    writer = new SealedMemoryWriter(keyStore);
  });

  it('a seal produced for namespace A does not verify under namespace B', () => {
    const content = { shared: 'note' };
    // Sealed under 'collaboration' (writer was ACL-authorized for it — mocked).
    const envelope = writer.seal(content, WRITER, 'collaboration');

    // Read attempted under a different sealed namespace's key.
    const result = writer.verify(envelope, 'team-secrets');
    expect(result.valid).toBe(false);

    // Confirms scoping is by namespace key, not merely by grant possession.
    expect(keyStore.getKey).toHaveBeenCalledWith('team-secrets');
  });

  it('the same content verifies only under the namespace it was sealed for', () => {
    const content = { shared: 'note' };
    const envelope = writer.seal(content, WRITER, 'collaboration');
    expect(writer.verify(envelope, 'collaboration').valid).toBe(true);
  });
});
