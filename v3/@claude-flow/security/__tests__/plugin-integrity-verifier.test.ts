/**
 * Tests for PluginIntegrityVerifier (ADR-145 P1, ruvnet/ruflo#2254).
 *
 * Covers:
 *  - canonicalize is deterministic (key order doesn't change the digest)
 *  - findAnchor matches by exact key, by exact-id scope, and by glob scope
 *  - findAnchor rejects expired anchors
 *  - verify reports `signature-missing` for unsigned manifests
 *  - verify reports `manifest-hash-mismatch` when the manifest is tampered
 *  - verify reports `unknown-signer` when the key isn't in trust anchors
 *  - verify reports `pass` on a valid round-trip sign → verify
 *  - verify reports `signature-invalid` on a flipped signature byte
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import {
  PluginIntegrityVerifier,
  canonicalize,
  hashManifest,
  findAnchor,
  type PluginManifest,
  type SignedPluginManifest,
  type TrustAnchor,
  type TrustAnchors,
} from '../src/plugins/integrity-verifier.js';

// ─── helpers ────────────────────────────────────────────────────────────

let ed: typeof import('@noble/ed25519') | null = null;
beforeAll(async () => {
  try {
    ed = await import('@noble/ed25519');
    if (!ed.etc.sha512Sync) {
      ed.etc.sha512Sync = (...m: Uint8Array[]) => {
        const h = createHash('sha512');
        for (const x of m) h.update(x);
        return h.digest();
      };
    }
  } catch {
    ed = null;
  }
});

function hex(b: Uint8Array): string {
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

async function makeSigner(): Promise<{ priv: Uint8Array; pub: string }> {
  if (!ed) throw new Error('ed25519 not available');
  const priv = ed.utils.randomPrivateKey();
  const pub = hex(await ed.getPublicKey(priv));
  return { priv, pub };
}

async function sign(
  manifest: PluginManifest,
  priv: Uint8Array,
  pub: string,
): Promise<SignedPluginManifest> {
  if (!ed) throw new Error('ed25519 not available');
  const manifestHash = hashManifest(manifest);
  const sig = await ed.sign(hexBytes(manifestHash), priv);
  return { manifest, manifestHash, signature: hex(sig), publicKey: pub };
}

function hexBytes(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

function anchorsFor(pub: string, scope = '*'): TrustAnchors {
  return {
    version: 1,
    anchors: [{ publicKey: pub, owner: 'test', scope }],
  };
}

// ─── canonicalize ──────────────────────────────────────────────────────

describe('canonicalize — deterministic JSON for hashing', () => {
  it('orders keys deterministically at every level', () => {
    const a = canonicalize({ b: 1, a: 2, c: { y: 1, x: 2 } });
    const b = canonicalize({ a: 2, c: { x: 2, y: 1 }, b: 1 });
    expect(a).toBe(b);
  });

  it('arrays preserve order', () => {
    expect(canonicalize({ k: [3, 1, 2] })).toBe('{"k":[3,1,2]}');
  });

  it('different content yields different output', () => {
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: 2 }));
  });
});

// ─── findAnchor ────────────────────────────────────────────────────────

describe('findAnchor — trust resolution', () => {
  const NOW = Date.now();

  it('matches by exact key + matching exact scope', () => {
    const anchors: TrustAnchor[] = [
      { publicKey: 'PK', owner: 'o', scope: '@claude-flow/memory' },
    ];
    expect(findAnchor(anchors, '@claude-flow/memory', 'PK', NOW)).not.toBeNull();
  });

  it('matches by exact key + wildcard scope', () => {
    const anchors: TrustAnchor[] = [{ publicKey: 'PK', owner: 'o', scope: '@claude-flow/*' }];
    expect(findAnchor(anchors, '@claude-flow/anything', 'PK', NOW)).not.toBeNull();
  });

  it('rejects exact-key with out-of-scope plugin id', () => {
    const anchors: TrustAnchor[] = [
      { publicKey: 'PK', owner: 'o', scope: '@claude-flow/*' },
    ];
    expect(findAnchor(anchors, '@third-party/x', 'PK', NOW)).toBeNull();
  });

  it('rejects wrong key even if scope matches', () => {
    const anchors: TrustAnchor[] = [{ publicKey: 'PK', owner: 'o', scope: '*' }];
    expect(findAnchor(anchors, 'anything', 'OTHER', NOW)).toBeNull();
  });

  it('rejects expired anchor', () => {
    const anchors: TrustAnchor[] = [
      { publicKey: 'PK', owner: 'o', scope: '*', expiresAt: '2020-01-01' },
    ];
    expect(findAnchor(anchors, 'x', 'PK', NOW)).toBeNull();
  });
});

// ─── verify ────────────────────────────────────────────────────────────

describe('PluginIntegrityVerifier.verify', () => {
  const skipMsg = '@noble/ed25519 unavailable — skipping signature round-trip tests';

  it('returns signature-missing when signature is empty', async () => {
    const v = new PluginIntegrityVerifier({ trustAnchors: anchorsFor('PK') });
    const r = await v.verify({
      manifest: { id: 'p', version: '1.0.0' },
      manifestHash: 'abc',
      signature: '',
      publicKey: 'PK',
    });
    expect(r.status).toBe('signature-missing');
    expect(r.pluginId).toBe('p');
  });

  it('returns manifest-hash-mismatch when the manifest is tampered', async () => {
    if (!ed) { console.warn(skipMsg); return; }
    const { priv, pub } = await makeSigner();
    const signed = await sign({ id: 'p', version: '1.0.0' }, priv, pub);
    // Tamper: change the manifest after signing
    const tampered: SignedPluginManifest = {
      ...signed,
      manifest: { id: 'p', version: '1.0.0', extra: 'sneaky' },
    };
    const v = new PluginIntegrityVerifier({ trustAnchors: anchorsFor(pub) });
    const r = await v.verify(tampered);
    expect(r.status).toBe('manifest-hash-mismatch');
  });

  it('returns unknown-signer when the publicKey is not in trust anchors', async () => {
    if (!ed) { console.warn(skipMsg); return; }
    const { priv, pub } = await makeSigner();
    const signed = await sign({ id: 'p', version: '1.0.0' }, priv, pub);
    const v = new PluginIntegrityVerifier({
      trustAnchors: anchorsFor('OTHER-PUBLIC-KEY'),
    });
    const r = await v.verify(signed);
    expect(r.status).toBe('unknown-signer');
  });

  it('passes a valid round-trip sign → verify', async () => {
    if (!ed) { console.warn(skipMsg); return; }
    const { priv, pub } = await makeSigner();
    const signed = await sign({ id: 'p', version: '1.0.0' }, priv, pub);
    const v = new PluginIntegrityVerifier({ trustAnchors: anchorsFor(pub) });
    const r = await v.verify(signed);
    expect(r.status).toBe('pass');
    expect(r.signerFingerprint).toBe(pub.slice(0, 16));
  });

  it('returns signature-invalid when a signature byte is flipped', async () => {
    if (!ed) { console.warn(skipMsg); return; }
    const { priv, pub } = await makeSigner();
    const signed = await sign({ id: 'p', version: '1.0.0' }, priv, pub);
    // Flip the first byte of the signature
    const flipped = signed.signature.slice(0, 2) === 'ff' ? '00' : 'ff';
    const tampered = { ...signed, signature: flipped + signed.signature.slice(2) };
    const v = new PluginIntegrityVerifier({ trustAnchors: anchorsFor(pub) });
    const r = await v.verify(tampered);
    expect(r.status).toBe('signature-invalid');
  });
});
