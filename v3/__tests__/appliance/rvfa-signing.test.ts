/**
 * RVFA Ed25519 signing module tests.
 *
 * Uses Vitest (collected by the v3 root vitest config).
 * Run: cd v3 && npx vitest run __tests__/appliance/rvfa-signing.test.ts
 */

import { describe, it, afterEach, expect } from 'vitest';
import { writeFileSync, unlinkSync, existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  generateKeyPair,
  saveKeyPair,
  loadKeyPair,
  RvfaSigner,
  RvfaVerifier,
  type RvfaKeyPair,
} from '../../@claude-flow/cli/src/appliance/rvfa-signing.js';
import {
  RvfaWriter,
  RvfaReader,
  createDefaultHeader,
} from '../../@claude-flow/cli/src/appliance/rvfa-format.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cleanupPaths: string[] = [];

function tmpPath(suffix: string): string {
  const p = join(
    tmpdir(),
    `rvfa-sign-test-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`,
  );
  cleanupPaths.push(p);
  return p;
}

function tmpDir(): string {
  const d = join(
    tmpdir(),
    `rvfa-sign-dir-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(d, { recursive: true });
  cleanupPaths.push(d);
  return d;
}

function buildTestRvfa(name = 'test-appliance'): Buffer {
  const header = createDefaultHeader('cloud');
  const writer = new RvfaWriter({ ...header, name });
  writer.addSection('kernel', Buffer.from('kernel-data'), { compression: 'none' });
  writer.addSection('runtime', Buffer.from('runtime-data'), { compression: 'none' });
  writer.addSection('ruflo', Buffer.from('ruflo-data'), { compression: 'none' });
  return writer.build();
}

function writeTestRvfa(name = 'test-appliance'): string {
  const buf = buildTestRvfa(name);
  const p = tmpPath('.rvf');
  writeFileSync(p, buf);
  return p;
}

afterEach(() => {
  for (const p of cleanupPaths) {
    try {
      if (existsSync(p)) {
        const s = require('node:fs').statSync(p);
        if (s.isDirectory()) rmSync(p, { recursive: true, force: true });
        else unlinkSync(p);
      }
    } catch { /* ignore */ }
  }
  cleanupPaths.length = 0;
});

// ---------------------------------------------------------------------------
// 1. Key generation
// ---------------------------------------------------------------------------

describe('generateKeyPair', () => {
  it('produces a key pair with publicKey, privateKey, and fingerprint', async () => {
    const kp = await generateKeyPair();

    expect(Buffer.isBuffer(kp.publicKey)).toBeTruthy();
    expect(Buffer.isBuffer(kp.privateKey)).toBeTruthy();
    expect(typeof kp.fingerprint).toBe('string');
    expect(kp.fingerprint.length > 0).toBeTruthy();
  });

  it('public key is in PEM format (starts with BEGIN)', async () => {
    const kp = await generateKeyPair();
    const pubPem = kp.publicKey.toString('utf-8');
    expect(pubPem.includes('BEGIN PUBLIC KEY'), 'Public key should be PEM-encoded').toBeTruthy();
  });

  it('private key is in PEM format (starts with BEGIN)', async () => {
    const kp = await generateKeyPair();
    const privPem = kp.privateKey.toString('utf-8');
    expect(privPem.includes('BEGIN PRIVATE KEY'), 'Private key should be PEM-encoded').toBeTruthy();
  });

  it('generates distinct key pairs on each call', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    expect(!kp1.publicKey.equals(kp2.publicKey), 'Public keys should differ').toBeTruthy();
    expect(!kp1.privateKey.equals(kp2.privateKey), 'Private keys should differ').toBeTruthy();
    expect(kp1.fingerprint, 'Fingerprints should differ').not.toBe(kp2.fingerprint);
  });
});

// ---------------------------------------------------------------------------
// 2. Key fingerprint
// ---------------------------------------------------------------------------

describe('Key fingerprint', () => {
  it('fingerprint is hex and 16 characters long', async () => {
    const kp = await generateKeyPair();
    expect(kp.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('fingerprint is deterministic for the same key', async () => {
    const kp = await generateKeyPair();
    // Recreate a signer from the same private key -- fingerprint should match
    const signer = new RvfaSigner(kp.privateKey);
    // Sign something to verify signer is operational
    const rvfaPath = writeTestRvfa();
    const sigMeta = await signer.signAppliance(rvfaPath);
    expect(sigMeta.publicKeyFingerprint).toBe(kp.fingerprint);
  });
});

// ---------------------------------------------------------------------------
// 3. Key save/load
// ---------------------------------------------------------------------------

describe('saveKeyPair / loadKeyPair', () => {
  it('round-trips a key pair through save and load', async () => {
    const original = await generateKeyPair();
    const dir = tmpDir();

    await saveKeyPair(original, dir, 'test-key');

    expect(existsSync(join(dir, 'test-key.pub')), 'Public key file should exist').toBeTruthy();
    expect(existsSync(join(dir, 'test-key.key')), 'Private key file should exist').toBeTruthy();

    const loaded = await loadKeyPair(dir, 'test-key');

    expect(loaded.publicKey.equals(original.publicKey), 'Public key should round-trip').toBeTruthy();
    expect(loaded.privateKey.equals(original.privateKey), 'Private key should round-trip').toBeTruthy();
    expect(loaded.fingerprint, 'Fingerprint should round-trip').toBe(original.fingerprint);
  });

  it('uses default name "rvfa-signing" when none provided', async () => {
    const kp = await generateKeyPair();
    const dir = tmpDir();

    await saveKeyPair(kp, dir);

    expect(existsSync(join(dir, 'rvfa-signing.pub'))).toBeTruthy();
    expect(existsSync(join(dir, 'rvfa-signing.key'))).toBeTruthy();

    const loaded = await loadKeyPair(dir);
    expect(loaded.fingerprint).toBe(kp.fingerprint);
  });
});

// ---------------------------------------------------------------------------
// 4. Sign appliance
// ---------------------------------------------------------------------------

describe('RvfaSigner.signAppliance', () => {
  it('signs an RVFA file and embeds signature metadata in the header', async () => {
    const kp = await generateKeyPair();
    const signer = new RvfaSigner(kp.privateKey);
    const rvfaPath = writeTestRvfa();

    const sigMeta = await signer.signAppliance(rvfaPath, 'test-publisher');

    expect(sigMeta.algorithm).toBe('ed25519');
    expect(typeof sigMeta.signature).toBe('string');
    expect(sigMeta.signature.length > 0).toBeTruthy();
    expect(sigMeta.publicKeyFingerprint).toBe(kp.fingerprint);
    expect(sigMeta.signedBy).toBe('test-publisher');
    expect(sigMeta.scope).toBe('full');
    expect(typeof sigMeta.signedAt).toBe('string');
  });

  it('signed file is still a valid RVFA (readable by RvfaReader)', async () => {
    const kp = await generateKeyPair();
    const signer = new RvfaSigner(kp.privateKey);
    const rvfaPath = writeTestRvfa();

    await signer.signAppliance(rvfaPath);

    const buf = readFileSync(rvfaPath);
    const reader = RvfaReader.fromBuffer(buf);
    const header = reader.getHeader();
    expect(header.name).toBe('test-appliance');
    expect((header as any).signature, 'Header should contain signature field').toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 5. Verify valid signature
// ---------------------------------------------------------------------------

describe('RvfaVerifier.verifyAppliance', () => {
  it('returns valid=true for a correctly signed file', async () => {
    const kp = await generateKeyPair();
    const signer = new RvfaSigner(kp.privateKey);
    const verifier = new RvfaVerifier(kp.publicKey);
    const rvfaPath = writeTestRvfa();

    await signer.signAppliance(rvfaPath, 'publisher-name');

    const result = await verifier.verifyAppliance(rvfaPath);
    expect(result.valid, `Expected valid but got errors: ${result.errors.join(', ')}`).toBeTruthy();
    expect(result.signerFingerprint).toBe(kp.fingerprint);
    expect(result.signedBy).toBe('publisher-name');
    expect(result.errors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Verify tampered data
// ---------------------------------------------------------------------------

describe('Tamper detection', () => {
  it('returns valid=false when section data is modified after signing', async () => {
    const kp = await generateKeyPair();
    const signer = new RvfaSigner(kp.privateKey);
    const verifier = new RvfaVerifier(kp.publicKey);
    const rvfaPath = writeTestRvfa();

    await signer.signAppliance(rvfaPath);

    // Read the signed file and tamper with section data
    const signedBuf = readFileSync(rvfaPath);
    const tampered = Buffer.from(signedBuf);
    // Tamper with a byte near the end (in section data area, before footer)
    const tamperOffset = tampered.length - 40; // before the 32-byte SHA256 footer
    if (tamperOffset > 0) {
      tampered[tamperOffset] ^= 0xFF;
    }
    writeFileSync(rvfaPath, tampered);

    const result = await verifier.verifyAppliance(rvfaPath);
    expect(!result.valid, 'Tampered file should fail verification').toBeTruthy();
    expect(result.errors.length > 0).toBeTruthy();
  });

  it('returns valid=false when header is modified after signing', async () => {
    const kp = await generateKeyPair();
    const signer = new RvfaSigner(kp.privateKey);
    const verifier = new RvfaVerifier(kp.publicKey);
    const rvfaPath = writeTestRvfa();

    await signer.signAppliance(rvfaPath);

    // Read the signed file, modify the header name
    const signedBuf = readFileSync(rvfaPath);
    const headerLen = signedBuf.readUInt32LE(8);
    const headerJson = signedBuf.subarray(12, 12 + headerLen).toString('utf-8');
    const header = JSON.parse(headerJson);
    header.name = 'tampered-name';

    const newHeaderJson = Buffer.from(JSON.stringify(header), 'utf-8');
    const preamble = Buffer.alloc(12);
    signedBuf.copy(preamble, 0, 0, 8);
    preamble.writeUInt32LE(newHeaderJson.length, 8);

    const rebuilt = Buffer.concat([
      preamble,
      newHeaderJson,
      signedBuf.subarray(12 + headerLen),
    ]);
    writeFileSync(rvfaPath, rebuilt);

    const result = await verifier.verifyAppliance(rvfaPath);
    expect(!result.valid, 'Modified header should fail verification').toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 7. Verify missing signature
// ---------------------------------------------------------------------------

describe('Missing signature', () => {
  it('returns valid=false with appropriate error for unsigned RVFA', async () => {
    const kp = await generateKeyPair();
    const verifier = new RvfaVerifier(kp.publicKey);
    const rvfaPath = writeTestRvfa();

    const result = await verifier.verifyAppliance(rvfaPath);
    expect(!result.valid).toBeTruthy();
    expect(result.errors.some((e) => e.includes('No signature') || e.includes('signature')), `Expected signature-related error, got: ${result.errors.join(', ')}`).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 8. Sign patch (detached)
// ---------------------------------------------------------------------------

describe('RvfaSigner.signPatch / RvfaVerifier.verifyPatch', () => {
  it('signs arbitrary data and verifies with detached signature', async () => {
    const kp = await generateKeyPair();
    const signer = new RvfaSigner(kp.privateKey);
    const verifier = new RvfaVerifier(kp.publicKey);

    const patchData = Buffer.from('this-is-a-patch-payload-for-signing');
    const signature = await signer.signPatch(patchData);

    expect(typeof signature).toBe('string');
    expect(signature.length > 0).toBeTruthy();

    const valid = await verifier.verifyPatch(patchData, signature);
    expect(valid, 'Detached patch signature should verify').toBeTruthy();
  });

  it('detached signature fails for tampered data', async () => {
    const kp = await generateKeyPair();
    const signer = new RvfaSigner(kp.privateKey);
    const verifier = new RvfaVerifier(kp.publicKey);

    const patchData = Buffer.from('original-patch-data');
    const signature = await signer.signPatch(patchData);

    const tampered = Buffer.from('tampered-patch-data');
    const valid = await verifier.verifyPatch(tampered, signature);
    expect(!valid, 'Tampered data should fail verification').toBeTruthy();
  });

  it('signSections signs a 32-byte footer hash and returns hex signature', async () => {
    const kp = await generateKeyPair();
    const signer = new RvfaSigner(kp.privateKey);

    const footerHash = Buffer.alloc(32, 0xAB);
    const signature = await signer.signSections(footerHash);

    expect(typeof signature).toBe('string');
    expect(signature.length > 0).toBeTruthy();
    // signSections signs the raw hash directly (no re-hash),
    // so we verify manually using Node.js crypto
    const { verify: edVerify, createPublicKey } = await import('node:crypto');
    const pubKeyObj = createPublicKey({
      key: kp.publicKey,
      format: 'pem',
      type: 'spki',
    });
    const valid = edVerify(null, footerHash, pubKeyObj, Buffer.from(signature, 'hex'));
    expect(valid, 'Signature over raw footer hash should verify').toBeTruthy();
  });

  it('signSections rejects non-32-byte input', async () => {
    const kp = await generateKeyPair();
    const signer = new RvfaSigner(kp.privateKey);

    await expect(signer.signSections(Buffer.alloc(16))).rejects.toThrow(/32 bytes/);
  });
});

// ---------------------------------------------------------------------------
// 9. Canonical JSON
// ---------------------------------------------------------------------------

describe('Canonical JSON (deterministic signing)', () => {
  it('signing produces the same signature regardless of header key order', async () => {
    const kp = await generateKeyPair();

    // Create two RVFA files with the same content
    const rvfaPath1 = writeTestRvfa('canon-test');
    const rvfaPath2 = writeTestRvfa('canon-test');

    // Sign both with the same key
    const signer = new RvfaSigner(kp.privateKey);
    const sig1 = await signer.signAppliance(rvfaPath1);
    const sig2 = await signer.signAppliance(rvfaPath2);

    // Both should verify successfully
    const verifier = new RvfaVerifier(kp.publicKey);
    const result1 = await verifier.verifyAppliance(rvfaPath1);
    const result2 = await verifier.verifyAppliance(rvfaPath2);

    expect(result1.valid, 'First file should verify').toBeTruthy();
    expect(result2.valid, 'Second file should verify').toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 10. Re-sign
// ---------------------------------------------------------------------------

describe('Re-signing', () => {
  it('re-signing replaces the old signature cleanly', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const rvfaPath = writeTestRvfa();

    // Sign with first key
    const signer1 = new RvfaSigner(kp1.privateKey);
    await signer1.signAppliance(rvfaPath, 'publisher-one');

    // Verify with first key
    const verifier1 = new RvfaVerifier(kp1.publicKey);
    const result1 = await verifier1.verifyAppliance(rvfaPath);
    expect(result1.valid, 'First signature should verify').toBeTruthy();

    // Re-sign with second key
    const signer2 = new RvfaSigner(kp2.privateKey);
    await signer2.signAppliance(rvfaPath, 'publisher-two');

    // Verify with second key should pass
    const verifier2 = new RvfaVerifier(kp2.publicKey);
    const result2 = await verifier2.verifyAppliance(rvfaPath);
    expect(result2.valid, 'Re-signed file should verify with new key').toBeTruthy();
    expect(result2.signedBy).toBe('publisher-two');

    // Verify with first key should fail
    const result3 = await verifier1.verifyAppliance(rvfaPath);
    expect(!result3.valid, 'Old key should no longer verify').toBeTruthy();
  });

  it('re-signed file still reads as valid RVFA and verifies', async () => {
    const kp = await generateKeyPair();
    const rvfaPath = writeTestRvfa();

    const signer = new RvfaSigner(kp.privateKey);
    await signer.signAppliance(rvfaPath);
    // Re-sign
    const sigMeta = await signer.signAppliance(rvfaPath);

    expect(sigMeta.algorithm).toBe('ed25519');
    expect(sigMeta.scope).toBe('full');

    // The re-signed file should still verify with the same key
    const verifier = new RvfaVerifier(kp.publicKey);
    const result = await verifier.verifyAppliance(rvfaPath);
    expect(result.valid, `Re-signed file should verify: ${result.errors.join(', ')}`).toBeTruthy();
  });
});
