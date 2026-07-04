/**
 * Ed25519 provenance gate for the helper auto-refresh (ADR-174 security).
 *
 * The auto-refresh copies auto-executing hook code from the installed package.
 * These tests prove the fail-closed gate: a validly-signed manifest verifies,
 * ANY tampering (hash, signature, algorithm) is rejected, and the ACTUAL
 * shipped manifest is both signed by ruflo's key and matches the shipped
 * helper files byte-for-byte.
 */
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  verifyHelpersManifest, canonicalManifestBytes, sha256Hex,
  RUFLO_HELPERS_PUBKEY, HELPERS_MANIFEST_FILE,
  type HelpersManifest,
} from '../src/init/helper-signing.js';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HELPERS_DIR = join(PKG_ROOT, '.claude', 'helpers');

function makeSigned(manifest: HelpersManifest, privPem: string, algorithm = 'ed25519') {
  const sig = edSign(null, canonicalManifestBytes(manifest), privPem).toString('base64');
  return JSON.stringify({ manifest, signature: sig, algorithm });
}

describe('verifyHelpersManifest — fail-closed Ed25519 gate', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const manifest: HelpersManifest = { version: '9.9.9', files: { 'hook-handler.cjs': 'a'.repeat(64), 'intelligence.cjs': 'b'.repeat(64) } };

  it('accepts a validly-signed manifest and returns the trusted map', () => {
    const out = verifyHelpersManifest(makeSigned(manifest, privateKey), publicKey);
    expect(out).not.toBeNull();
    expect(out!.files['hook-handler.cjs']).toBe('a'.repeat(64));
  });

  it('REJECTS a manifest whose hash was tampered after signing', () => {
    const signed = JSON.parse(makeSigned(manifest, privateKey));
    signed.manifest.files['hook-handler.cjs'] = 'c'.repeat(64); // flip a hash, keep old signature
    expect(verifyHelpersManifest(JSON.stringify(signed), publicKey)).toBeNull();
  });

  it('REJECTS a manifest signed by a DIFFERENT key (wrong provenance)', () => {
    const other = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    expect(verifyHelpersManifest(makeSigned(manifest, other.privateKey), publicKey)).toBeNull();
  });

  it('REJECTS a non-ed25519 algorithm and malformed input', () => {
    expect(verifyHelpersManifest(makeSigned(manifest, privateKey, 'rsa'), publicKey)).toBeNull();
    expect(verifyHelpersManifest('not json', publicKey)).toBeNull();
    expect(verifyHelpersManifest('{}', publicKey)).toBeNull();
    expect(verifyHelpersManifest(JSON.stringify({ manifest, algorithm: 'ed25519' }), publicKey)).toBeNull(); // no signature
  });
});

describe('shipped helpers manifest — real signature + real content', () => {
  const manifestPath = join(HELPERS_DIR, HELPERS_MANIFEST_FILE);

  it('exists and verifies against the baked ruflo public key', () => {
    expect(existsSync(manifestPath)).toBe(true);
    const trusted = verifyHelpersManifest(readFileSync(manifestPath, 'utf-8'), RUFLO_HELPERS_PUBKEY);
    expect(trusted).not.toBeNull();
  });

  it('its hashes match the actual shipped helper files (a byte flip would break the gate)', () => {
    const trusted = verifyHelpersManifest(readFileSync(manifestPath, 'utf-8'), RUFLO_HELPERS_PUBKEY)!;
    for (const [name, expected] of Object.entries(trusted.files)) {
      const p = join(HELPERS_DIR, name);
      expect(existsSync(p), `${name} shipped`).toBe(true);
      expect(sha256Hex(readFileSync(p)), `${name} integrity`).toBe(expected);
    }
    // A tampered helper would NOT match → the refresh gate refuses.
    const anyName = Object.keys(trusted.files)[0];
    expect(sha256Hex(readFileSync(join(HELPERS_DIR, anyName)) + '// tampered')).not.toBe(trusted.files[anyName]);
  });
});
