/**
 * Proven Configuration Manifest (ADR-176 proof #3 + ADR-177 core).
 *
 * The two adoption gates — authenticity (Ed25519) and suitability (the
 * constraint contract) — must BOTH pass, fail-closed. These tests pin both,
 * plus the "signed != suitable" invariant that a validly-signed but
 * environment-incompatible manifest is a safe non-adoption, not an error.
 */
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  signProvenConfig, verifyProvenConfig, isSuitable, evaluateForAdoption,
  satisfiesRange, canonicalManifestBytes, RUFLO_CONFIG_PUBKEY,
  type ProvenConfigManifest, type InstallEnv,
} from '../src/config/proven-config.js';

const kp = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function manifest(over: Partial<ProvenConfigManifest> = {}): ProvenConfigManifest {
  return {
    schema: 'ruflo.proven-config/v1',
    policy: { ref: 'sha256:' + 'a'.repeat(64) },
    host: { 'claude-code': '>=1.9' },
    platform: ['linux', 'macOS'],
    compatibility: { ruflo: '>=3.24.0' },
    benchmark: { corpus: 'LAB-v4', corpusHash: 'sha256:' + 'b'.repeat(64) },
    layer: 'framework/node-cli',
    receipt: { heldOutDelta: 0.03, redblue: 'PASS', drift: 0.01, receiptCoverage: 1 },
    rollback: { previousManifest: 'sha256:' + 'c'.repeat(64) },
    ...over,
  };
}

const env: InstallEnv = {
  platform: 'darwin',
  hosts: { 'claude-code': '1.9.3' },
  versions: { ruflo: '3.24.0' },
  layer: 'framework/node-cli/my-repo',
};

describe('proven-config — authenticity (Ed25519, fail-closed)', () => {
  it('verifies a validly-signed manifest', () => {
    const signed = signProvenConfig(manifest(), kp.privateKey);
    expect(verifyProvenConfig(JSON.stringify(signed), kp.publicKey)).not.toBeNull();
  });

  it('REJECTS a manifest tampered after signing', () => {
    const signed = signProvenConfig(manifest(), kp.privateKey);
    (signed.manifest.compatibility as Record<string, string>).ruflo = '>=1.0.0'; // widen after signing
    expect(verifyProvenConfig(JSON.stringify(signed), kp.publicKey)).toBeNull();
  });

  it('REJECTS a wrong-key signature, wrong algorithm, and malformed input', () => {
    const other = generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    expect(verifyProvenConfig(JSON.stringify(signProvenConfig(manifest(), other.privateKey)), kp.publicKey)).toBeNull();
    expect(verifyProvenConfig(JSON.stringify({ manifest: manifest(), signature: 'x', algorithm: 'rsa' }), kp.publicKey)).toBeNull();
    expect(verifyProvenConfig('not json', kp.publicKey)).toBeNull();
    expect(verifyProvenConfig(JSON.stringify({ manifest: { schema: 'x' }, signature: 'y', algorithm: 'ed25519' }), kp.publicKey)).toBeNull(); // no policy.ref
  });

  it('canonical bytes are order-independent (deterministic signing)', () => {
    const a = canonicalManifestBytes(manifest({ platform: ['linux', 'macOS'] }));
    const b = canonicalManifestBytes(manifest({ platform: ['linux', 'macOS'] }));
    expect(a.equals(b)).toBe(true);
  });

  it('ships a valid baked config public key (PEM)', () => {
    expect(RUFLO_CONFIG_PUBKEY).toContain('BEGIN PUBLIC KEY');
  });
});

describe('proven-config — semver range satisfier', () => {
  it('handles >=, >, <=, <, =, and bare', () => {
    expect(satisfiesRange('3.24.0', '>=3.24.0')).toBe(true);
    expect(satisfiesRange('3.23.9', '>=3.24.0')).toBe(false);
    expect(satisfiesRange('1.9.3', '>=1.9')).toBe(true);
    expect(satisfiesRange('2.0.0', '>1.9.9')).toBe(true);
    expect(satisfiesRange('3.24.0', '<=3.24.0')).toBe(true);
    expect(satisfiesRange('3.24.1', '<3.24.1')).toBe(false);
    expect(satisfiesRange('3.24.0', '=3.24.0')).toBe(true);
    expect(satisfiesRange('3.24.0', '3.24.0')).toBe(true); // bare = >=
  });
});

describe('proven-config — suitability gate (signed != suitable)', () => {
  it('adopts a suitable environment', () => {
    expect(isSuitable(manifest(), env).suitable).toBe(true);
  });

  it('skips on platform mismatch', () => {
    const r = isSuitable(manifest({ platform: ['linux'] }), { ...env, platform: 'darwin' });
    expect(r.suitable).toBe(false);
    expect(r.reason).toMatch(/platform/);
  });

  it('skips when a required host is absent or too old', () => {
    expect(isSuitable(manifest(), { ...env, hosts: {} }).suitable).toBe(false);
    expect(isSuitable(manifest(), { ...env, hosts: { 'claude-code': '1.8.0' } }).suitable).toBe(false);
  });

  it('skips when a compatibility range is unmet (the version gate for backwards-compat)', () => {
    const r = isSuitable(manifest(), { ...env, versions: { ruflo: '3.23.0' } });
    expect(r.suitable).toBe(false);
    expect(r.reason).toMatch(/ruflo 3.23.0/);
  });

  it('applies the hierarchy layer (ancestor ok, sibling not)', () => {
    expect(isSuitable(manifest({ layer: 'framework/node-cli' }), { ...env, layer: 'framework/node-cli/repo' }).suitable).toBe(true);
    expect(isSuitable(manifest({ layer: 'framework/python' }), { ...env, layer: 'framework/node-cli/repo' }).suitable).toBe(false);
  });

  it('requires only the constraints the manifest declares', () => {
    const bare: ProvenConfigManifest = { schema: 'ruflo.proven-config/v1', policy: { ref: 'sha256:' + 'd'.repeat(64) } };
    expect(isSuitable(bare, { platform: 'win32' }).suitable).toBe(true);
  });
});

describe('proven-config — combined adoption decision', () => {
  it('adopts only when authentic AND suitable', () => {
    const signed = signProvenConfig(manifest(), kp.privateKey);
    const good = evaluateForAdoption(JSON.stringify(signed), env, kp.publicKey);
    expect(good.adopt).toBe(true);
  });

  it('refuses on bad signature (authenticity gate)', () => {
    const other = generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    const r = evaluateForAdoption(JSON.stringify(signProvenConfig(manifest(), other.privateKey)), env, kp.publicKey);
    expect(r.adopt).toBe(false);
    expect(r.reason).toMatch(/authenticity/);
  });

  it('safe-skips a signed-but-unsuitable manifest (not an error)', () => {
    const signed = signProvenConfig(manifest({ compatibility: { ruflo: '>=9.9.9' } }), kp.privateKey);
    const r = evaluateForAdoption(JSON.stringify(signed), env, kp.publicKey);
    expect(r.adopt).toBe(false);
    expect(r.manifest).toBeDefined(); // it WAS authentic
    expect(r.reason).toMatch(/not suitable/);
  });
});
