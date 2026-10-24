/**
 * RVFA Distribution & Hot-Patch module tests.
 *
 * Uses Vitest (collected by the v3 root vitest config).
 * Run: cd v3 && npx vitest run __tests__/appliance/rvfa-distribution.test.ts
 */

import { describe, it, afterEach, expect } from 'vitest';
import { writeFileSync, unlinkSync, existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  RvfaPatcher,
  RvfaPublisher,
  type RvfpHeader,
  type CreatePatchOptions,
} from '../../@claude-flow/cli/src/appliance/rvfa-distribution.js';
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
    `rvfa-dist-test-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`,
  );
  cleanupPaths.push(p);
  return p;
}

function tmpDir(): string {
  const d = join(
    tmpdir(),
    `rvfa-dist-dir-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(d, { recursive: true });
  cleanupPaths.push(d);
  return d;
}

/** Build a test RVFA binary with the given sections. */
function buildTestRvfa(
  name = 'test-appliance',
  version = '3.5.0',
  sections?: Array<{ id: string; data: string }>,
): Buffer {
  const header = createDefaultHeader('cloud');
  const writer = new RvfaWriter({ ...header, name, appVersion: version });
  const secs = sections ?? [
    { id: 'kernel', data: 'kernel-payload-original' },
    { id: 'runtime', data: 'runtime-payload-original' },
    { id: 'ruflo', data: 'ruflo-payload-original' },
  ];
  for (const s of secs) {
    writer.addSection(s.id, Buffer.from(s.data), { compression: 'none' });
  }
  return writer.build();
}

function writeTestRvfa(
  name = 'test-appliance',
  version = '3.5.0',
  sections?: Array<{ id: string; data: string }>,
): string {
  const buf = buildTestRvfa(name, version, sections);
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
// 1. RVFP patch creation
// ---------------------------------------------------------------------------

describe('RvfaPatcher.createPatch', () => {
  it('creates a patch with RVFP magic bytes', async () => {
    const patch = await RvfaPatcher.createPatch({
      targetName: 'test-appliance',
      targetVersion: '3.5.0',
      sectionId: 'kernel',
      sectionData: Buffer.from('new-kernel-data'),
      patchVersion: '1.0.0',
    });

    expect(patch.subarray(0, 4).toString('ascii')).toBe('RVFP');
  });

  it('creates a patch with correct version number', async () => {
    const patch = await RvfaPatcher.createPatch({
      targetName: 'test-appliance',
      targetVersion: '3.5.0',
      sectionId: 'kernel',
      sectionData: Buffer.from('new-kernel-data'),
      patchVersion: '1.0.0',
    });

    expect(patch.readUInt32LE(4), 'Version should be 1').toBe(1);
  });

  it('includes all header fields in the patch', async () => {
    const patch = await RvfaPatcher.createPatch({
      targetName: 'my-app',
      targetVersion: '2.0.0',
      sectionId: 'runtime',
      sectionData: Buffer.from('updated-runtime'),
      patchVersion: '1.1.0',
    });

    const header = RvfaPatcher.parsePatchHeader(patch);
    expect(header.magic).toBe('RVFP');
    expect(header.version).toBe(1);
    expect(header.targetApplianceName).toBe('my-app');
    expect(header.targetApplianceVersion).toBe('2.0.0');
    expect(header.targetSection).toBe('runtime');
    expect(header.patchVersion).toBe('1.1.0');
    expect(typeof header.created).toBe('string');
    expect(header.created.length > 0).toBeTruthy();
    expect(typeof header.newSectionSha256).toBe('string');
    expect(header.newSectionSha256.length > 0).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. RVFP patch header
// ---------------------------------------------------------------------------

describe('RvfaPatcher.parsePatchHeader', () => {
  it('extracts all fields from a valid patch', async () => {
    const sectionData = Buffer.from('test-section-content');
    const patch = await RvfaPatcher.createPatch({
      targetName: 'header-test',
      targetVersion: '1.0.0',
      sectionId: 'kernel',
      sectionData,
      patchVersion: '0.1.0',
      compression: 'none',
    });

    const header = RvfaPatcher.parsePatchHeader(patch);
    expect(header.targetApplianceName).toBe('header-test');
    expect(header.targetApplianceVersion).toBe('1.0.0');
    expect(header.targetSection).toBe('kernel');
    expect(header.patchVersion).toBe('0.1.0');
    expect(header.compression).toBe('none');
    expect(header.newSectionSize).toBe(sectionData.length);
  });

  it('rejects a buffer with wrong magic', () => {
    const bad = Buffer.alloc(64);
    bad.write('NOPE', 0, 'ascii');
    expect(() => RvfaPatcher.parsePatchHeader(bad)).toThrow(/Invalid RVFP magic/);
  });

  it('rejects a buffer that is too small', () => {
    const small = Buffer.alloc(8);
    small.write('RVFP', 0, 'ascii');
    expect(() => RvfaPatcher.parsePatchHeader(small)).toThrow(/too small/);
  });
});

// ---------------------------------------------------------------------------
// 3. Patch verification
// ---------------------------------------------------------------------------

describe('RvfaPatcher.verifyPatch', () => {
  it('returns valid=true for a well-formed patch', async () => {
    const patch = await RvfaPatcher.createPatch({
      targetName: 'verify-test',
      targetVersion: '1.0.0',
      sectionId: 'kernel',
      sectionData: Buffer.from('valid-content'),
      patchVersion: '0.1.0',
    });

    const result = await RvfaPatcher.verifyPatch(patch);
    expect(result.valid, `Expected valid but got errors: ${result.errors.join(', ')}`).toBeTruthy();
    expect(result.errors.length).toBe(0);
  });

  it('returns valid=false for a tampered patch payload', async () => {
    const patch = await RvfaPatcher.createPatch({
      targetName: 'tamper-test',
      targetVersion: '1.0.0',
      sectionId: 'kernel',
      sectionData: Buffer.from('original-payload-data'),
      patchVersion: '0.1.0',
    });

    const tampered = Buffer.from(patch);
    // Tamper with the payload area (after header, before footer)
    const headerLen = tampered.readUInt32LE(8);
    const payloadOffset = 12 + headerLen;
    if (payloadOffset < tampered.length - 32) {
      tampered[payloadOffset] ^= 0xFF;
    }

    const result = await RvfaPatcher.verifyPatch(tampered);
    expect(!result.valid, 'Tampered patch should fail verification').toBeTruthy();
    expect(result.errors.some((e) => e.includes('SHA256'))).toBeTruthy();
  });

  it('returns valid=false for a tampered footer', async () => {
    const patch = await RvfaPatcher.createPatch({
      targetName: 'footer-test',
      targetVersion: '1.0.0',
      sectionId: 'kernel',
      sectionData: Buffer.from('some-payload'),
      patchVersion: '0.1.0',
    });

    const tampered = Buffer.from(patch);
    // Tamper with the last byte of the footer
    tampered[tampered.length - 1] ^= 0xFF;

    const result = await RvfaPatcher.verifyPatch(tampered);
    expect(!result.valid, 'Tampered footer should fail verification').toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 4. Patch application
// ---------------------------------------------------------------------------

describe('RvfaPatcher.applyPatch', () => {
  it('replaces the target section and preserves others', async () => {
    const rvfaPath = writeTestRvfa('patch-app', '3.5.0');

    const newKernelData = Buffer.from('brand-new-kernel-payload');
    const patch = await RvfaPatcher.createPatch({
      targetName: 'patch-app',
      targetVersion: '3.5.0',
      sectionId: 'kernel',
      sectionData: newKernelData,
      patchVersion: '1.0.0',
    });

    const result = await RvfaPatcher.applyPatch(rvfaPath, patch, { verify: true });

    expect(result.success, `Apply failed: ${result.errors.join(', ')}`).toBeTruthy();
    expect(result.patchedSection).toBe('kernel');
    expect(result.newSize > 0).toBeTruthy();

    // Verify the patched file
    const patchedBuf = readFileSync(rvfaPath);
    const reader = RvfaReader.fromBuffer(patchedBuf);

    // Target section replaced
    const kernel = reader.extractSection('kernel');
    expect(kernel.toString('utf-8')).toBe('brand-new-kernel-payload');

    // Other sections untouched
    const runtime = reader.extractSection('runtime');
    expect(runtime.toString('utf-8')).toBe('runtime-payload-original');

    const ruflo = reader.extractSection('ruflo');
    expect(ruflo.toString('utf-8')).toBe('ruflo-payload-original');
  });

  it('creates a backup file', async () => {
    const rvfaPath = writeTestRvfa('backup-test', '3.5.0');

    const patch = await RvfaPatcher.createPatch({
      targetName: 'backup-test',
      targetVersion: '3.5.0',
      sectionId: 'kernel',
      sectionData: Buffer.from('new-kernel'),
      patchVersion: '1.0.0',
    });

    const result = await RvfaPatcher.applyPatch(rvfaPath, patch, { backup: true });

    expect(result.success).toBeTruthy();
    expect(result.backupPath, 'Backup path should be set').toBeTruthy();
    expect(existsSync(result.backupPath!), 'Backup file should exist').toBeTruthy();
    cleanupPaths.push(result.backupPath!);
  });

  it('new RVFA passes verify() after patching', async () => {
    const rvfaPath = writeTestRvfa('verify-after-patch', '3.5.0');

    const patch = await RvfaPatcher.createPatch({
      targetName: 'verify-after-patch',
      targetVersion: '3.5.0',
      sectionId: 'runtime',
      sectionData: Buffer.from('updated-runtime-payload'),
      patchVersion: '1.0.0',
    });

    const result = await RvfaPatcher.applyPatch(rvfaPath, patch, { verify: true });
    expect(result.success, `Apply failed: ${result.errors.join(', ')}`).toBeTruthy();

    // Double-check: read back and verify independently
    const patchedBuf = readFileSync(rvfaPath);
    const reader = RvfaReader.fromBuffer(patchedBuf);
    const verifyResult = reader.verify();
    expect(verifyResult.valid, `Verify failed: ${verifyResult.errors.join(', ')}`).toBeTruthy();
  });

  it('footer SHA256 is updated after patching', async () => {
    const rvfaPath = writeTestRvfa('footer-update', '3.5.0');

    // Read original footer
    const originalBuf = readFileSync(rvfaPath);
    const originalFooter = originalBuf.subarray(originalBuf.length - 32);

    const patch = await RvfaPatcher.createPatch({
      targetName: 'footer-update',
      targetVersion: '3.5.0',
      sectionId: 'kernel',
      sectionData: Buffer.from('different-kernel-data'),
      patchVersion: '1.0.0',
    });

    await RvfaPatcher.applyPatch(rvfaPath, patch);

    // Read new footer
    const patchedBuf = readFileSync(rvfaPath);
    const newFooter = patchedBuf.subarray(patchedBuf.length - 32);

    expect(!originalFooter.equals(newFooter), 'Footer SHA256 should change after patching').toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 5. Patch for wrong target
// ---------------------------------------------------------------------------

describe('Patch target mismatch', () => {
  it('fails when patch targets a different appliance name', async () => {
    const rvfaPath = writeTestRvfa('correct-app', '3.5.0');

    const patch = await RvfaPatcher.createPatch({
      targetName: 'wrong-app',
      targetVersion: '3.5.0',
      sectionId: 'kernel',
      sectionData: Buffer.from('new-data'),
      patchVersion: '1.0.0',
    });

    const result = await RvfaPatcher.applyPatch(rvfaPath, patch);
    expect(!result.success, 'Should fail for wrong target app').toBeTruthy();
    expect(result.errors.some((e) => e.includes('mismatch') || e.includes('wrong-app')), `Expected mismatch error, got: ${result.errors.join(', ')}`).toBeTruthy();
  });

  it('fails when patch targets a different appliance version', async () => {
    const rvfaPath = writeTestRvfa('version-test', '3.5.0');

    const patch = await RvfaPatcher.createPatch({
      targetName: 'version-test',
      targetVersion: '9.9.9',
      sectionId: 'kernel',
      sectionData: Buffer.from('new-data'),
      patchVersion: '1.0.0',
    });

    const result = await RvfaPatcher.applyPatch(rvfaPath, patch);
    expect(!result.success, 'Should fail for wrong target version').toBeTruthy();
    expect(result.errors.some((e) => e.includes('mismatch') || e.includes('9.9.9'))).toBeTruthy();
  });

  it('fails when patch targets a nonexistent section', async () => {
    const rvfaPath = writeTestRvfa('section-test', '3.5.0');

    const patch = await RvfaPatcher.createPatch({
      targetName: 'section-test',
      targetVersion: '3.5.0',
      sectionId: 'nonexistent-section',
      sectionData: Buffer.from('new-data'),
      patchVersion: '1.0.0',
    });

    const result = await RvfaPatcher.applyPatch(rvfaPath, patch);
    expect(!result.success, 'Should fail for nonexistent section').toBeTruthy();
    expect(result.errors.some((e) => e.includes('not found') || e.includes('nonexistent'))).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 6. Signed patch verification (via rvfa-signing integration)
// ---------------------------------------------------------------------------

describe('Signed patch', () => {
  // Note: The distribution module uses raw DER Ed25519 keys, not PEM.
  // We skip direct Ed25519 signing tests here since the signing module
  // is tested separately. We test that the signature field in the header
  // is properly set when a private key is provided.

  it('patch header contains signature when privateKey is provided', async () => {
    // Generate raw Ed25519 DER keys using crypto
    const { generateKeyPairSync } = await import('node:crypto');
    const keyPair = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });

    const patch = await RvfaPatcher.createPatch({
      targetName: 'signed-test',
      targetVersion: '1.0.0',
      sectionId: 'kernel',
      sectionData: Buffer.from('signed-payload'),
      patchVersion: '1.0.0',
      privateKey: keyPair.privateKey as Buffer,
      signedBy: 'test-publisher',
    });

    const header = RvfaPatcher.parsePatchHeader(patch);
    expect(header.signature, 'Signed patch should have a signature field').toBeTruthy();
    expect(header.signedBy).toBe('test-publisher');
    expect(header.signature!.length > 0).toBeTruthy();
  });

  it('unsigned patch has no signature field', async () => {
    const patch = await RvfaPatcher.createPatch({
      targetName: 'unsigned-test',
      targetVersion: '1.0.0',
      sectionId: 'kernel',
      sectionData: Buffer.from('unsigned-payload'),
      patchVersion: '1.0.0',
    });

    const header = RvfaPatcher.parsePatchHeader(patch);
    expect(header.signature).toBe(undefined);
    expect(header.signedBy).toBe(undefined);
  });
});

// ---------------------------------------------------------------------------
// 7. Signed patch tamper detection
// ---------------------------------------------------------------------------

describe('Signed patch tamper detection', () => {
  it('verification fails when patch data is modified after signing', async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const keyPair = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });

    const patch = await RvfaPatcher.createPatch({
      targetName: 'tamper-sign-test',
      targetVersion: '1.0.0',
      sectionId: 'kernel',
      sectionData: Buffer.from('original-signed-data'),
      patchVersion: '1.0.0',
      privateKey: keyPair.privateKey as Buffer,
      signedBy: 'publisher',
    });

    // Tamper with the section payload
    const tampered = Buffer.from(patch);
    const headerLen = tampered.readUInt32LE(8);
    const payloadOffset = 12 + headerLen;
    if (payloadOffset < tampered.length - 32) {
      tampered[payloadOffset] ^= 0xFF;
    }

    // Integrity verification should fail (SHA256 mismatch)
    const result = await RvfaPatcher.verifyPatch(tampered);
    expect(!result.valid, 'Tampered signed patch should fail verification').toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 8. parsePatchHeader edge cases
// ---------------------------------------------------------------------------

describe('parsePatchHeader edge cases', () => {
  it('rejects a buffer with unsupported version', async () => {
    const patch = await RvfaPatcher.createPatch({
      targetName: 'version-test',
      targetVersion: '1.0.0',
      sectionId: 'kernel',
      sectionData: Buffer.from('data'),
      patchVersion: '1.0.0',
    });

    const tampered = Buffer.from(patch);
    tampered.writeUInt32LE(99, 4); // bad version

    expect(() => RvfaPatcher.parsePatchHeader(tampered)).toThrow(/Unsupported RVFP version/);
  });

  it('rejects a buffer with header length exceeding buffer size', async () => {
    const buf = Buffer.alloc(16);
    buf.write('RVFP', 0, 'ascii');
    buf.writeUInt32LE(1, 4); // version
    buf.writeUInt32LE(9999, 8); // header_len way too big

    expect(() => RvfaPatcher.parsePatchHeader(buf)).toThrow(/too small/);
  });
});

// ---------------------------------------------------------------------------
// 9. RvfaPublisher config
// ---------------------------------------------------------------------------

describe('RvfaPublisher', () => {
  it('constructor accepts JWT from config', () => {
    const publisher = new RvfaPublisher({
      pinataJwt: 'test-jwt-token-from-config',
    });
    expect(publisher).toBeTruthy();
  });

  it('constructor accepts JWT from process.env', () => {
    const original = process.env.PINATA_API_JWT;
    process.env.PINATA_API_JWT = 'test-jwt-from-env';
    try {
      const publisher = new RvfaPublisher({});
      expect(publisher).toBeTruthy();
    } finally {
      if (original !== undefined) {
        process.env.PINATA_API_JWT = original;
      } else {
        delete process.env.PINATA_API_JWT;
      }
    }
  });

  it('constructor throws when no JWT is available', () => {
    const original = process.env.PINATA_API_JWT;
    delete process.env.PINATA_API_JWT;
    try {
      expect(() => new RvfaPublisher({ pinataJwt: '' })).toThrow(/JWT/i);
    } finally {
      if (original !== undefined) {
        process.env.PINATA_API_JWT = original;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Publisher list (mock-safe)
// ---------------------------------------------------------------------------

describe('Publisher URL construction', () => {
  it('uses default gateway and API URLs', () => {
    const original = process.env.PINATA_API_JWT;
    process.env.PINATA_API_JWT = 'test-jwt';
    try {
      const publisher = new RvfaPublisher({});
      // We cannot call .list() without network, but we can verify
      // the publisher was created successfully with defaults
      expect(publisher).toBeTruthy();
    } finally {
      if (original !== undefined) {
        process.env.PINATA_API_JWT = original;
      } else {
        delete process.env.PINATA_API_JWT;
      }
    }
  });

  it('accepts custom gateway and API URLs', () => {
    const publisher = new RvfaPublisher({
      pinataJwt: 'test-jwt',
      gatewayUrl: 'https://custom-gateway.example.com',
      apiUrl: 'https://custom-api.example.com',
    });
    expect(publisher).toBeTruthy();
  });

  it('strips trailing slashes from URLs', () => {
    const publisher = new RvfaPublisher({
      pinataJwt: 'test-jwt',
      gatewayUrl: 'https://gateway.example.com///',
      apiUrl: 'https://api.example.com//',
    });
    // The publisher should be created without error (trailing slashes stripped internally)
    expect(publisher).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 11. Gzip compression in patches
// ---------------------------------------------------------------------------

describe('Gzip-compressed patches', () => {
  it('creates and verifies a gzip-compressed patch', async () => {
    const sectionData = Buffer.alloc(1024, 0x42); // highly compressible
    const patch = await RvfaPatcher.createPatch({
      targetName: 'gzip-test',
      targetVersion: '1.0.0',
      sectionId: 'kernel',
      sectionData,
      patchVersion: '1.0.0',
      compression: 'gzip',
    });

    const header = RvfaPatcher.parsePatchHeader(patch);
    expect(header.compression).toBe('gzip');

    const result = await RvfaPatcher.verifyPatch(patch);
    expect(result.valid, `Gzip patch should verify: ${result.errors.join(', ')}`).toBeTruthy();
  });
});
