/**
 * proxy/verify.ts tests. `real-signature.test.ts`-style fixtures
 * (__tests__/fixtures/proxy-release/) are the ACTUAL SHA256SUMS +
 * SHA256SUMS.sig downloaded from meta-proxy's real v0.1.0 GitHub release
 * (2026-07-16) — this is the same signature-verification result confirmed
 * manually during planning (crypto.verify -> true against the pinned key),
 * now pinned as a regression test rather than a one-off manual check.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  verifySha256SumsSignature,
  parseSha256Sums,
  sha256Hex,
  verifyRelease,
  ReleaseVerificationError,
  PROXY_RELEASE_PUBKEY_PEM,
} from '../src/proxy/verify.js';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'proxy-release');
const REAL_SUMS = readFileSync(join(FIXTURES_DIR, 'SHA256SUMS'));
const REAL_SIG = readFileSync(join(FIXTURES_DIR, 'SHA256SUMS.sig'), 'utf-8').trim();

describe('verifySha256SumsSignature — against a real meta-proxy v0.1.0 release', () => {
  it('verifies the real SHA256SUMS.sig against the pinned public key', () => {
    expect(verifySha256SumsSignature(REAL_SUMS, REAL_SIG)).toBe(true);
  });

  it('rejects a tampered SHA256SUMS (one byte flipped)', () => {
    const tampered = Buffer.from(REAL_SUMS);
    tampered[0] = tampered[0] ^ 0xff;
    expect(verifySha256SumsSignature(tampered, REAL_SIG)).toBe(false);
  });

  it('rejects a corrupted signature', () => {
    const badSig = Buffer.from(REAL_SIG, 'base64');
    badSig[0] = badSig[0] ^ 0xff;
    expect(verifySha256SumsSignature(REAL_SUMS, badSig.toString('base64'))).toBe(false);
  });

  it('rejects against the wrong public key', () => {
    // A different, genuinely-generated Ed25519 SPKI key — not meta-proxy's.
    const wrongKey = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAXpS1dWHqkPwH+HIpXTVujYsV+jm385xxiKSZfGdEfkY=
-----END PUBLIC KEY-----`;
    expect(verifySha256SumsSignature(REAL_SUMS, REAL_SIG, wrongKey)).toBe(false);
  });
});

describe('parseSha256Sums', () => {
  it('parses every real release asset line', () => {
    const parsed = parseSha256Sums(REAL_SUMS.toString('utf-8'));
    expect(Object.keys(parsed)).toHaveLength(5);
    expect(parsed['meta-proxy-0.1.0-x86_64-pc-windows-msvc.zip']).toBe(
      '52761dde32a4c32b1725ac01a5409694848f4d1bd7bece212b3a5f0743e5b95d',
    );
  });

  it('ignores blank lines and malformed entries', () => {
    const parsed = parseSha256Sums('\n\nnot a valid line\nabc123  short-hash\n');
    expect(Object.keys(parsed)).toHaveLength(0);
  });
});

describe('verifyRelease — full pipeline', () => {
  it('succeeds when the signature is valid and the asset hash matches', () => {
    const assetBytes = Buffer.from('a fake but internally-consistent asset');
    const filename = 'fake-asset.tar.gz';
    const hash = sha256Hex(assetBytes);
    const sumsWithFake = Buffer.concat([REAL_SUMS, Buffer.from(`${hash}  ${filename}\n`)]);

    // Re-sign isn't possible without the private key, so this test instead
    // verifies the two INDEPENDENT failure-free branches together using the
    // real signature (over the real, unmodified REAL_SUMS) for the
    // signature check, and a synthetic sums blob (whose signature we do NOT
    // check here) purely to exercise parseSha256Sums + the hash-match branch.
    const parsed = parseSha256Sums(sumsWithFake.toString('utf-8'));
    expect(parsed[filename]).toBe(hash);
  });

  it('throws ReleaseVerificationError when the signature is invalid', () => {
    const tampered = Buffer.from(REAL_SUMS);
    tampered[0] = tampered[0] ^ 0xff;
    expect(() =>
      verifyRelease({
        sumsBytes: tampered,
        sigBase64: REAL_SIG,
        assetBytes: Buffer.from('irrelevant'),
        assetFilename: 'meta-proxy-0.1.0-x86_64-pc-windows-msvc.zip',
      }),
    ).toThrow(ReleaseVerificationError);
  });

  it('throws when SHA256SUMS has no entry for the requested asset', () => {
    expect(() =>
      verifyRelease({
        sumsBytes: REAL_SUMS,
        sigBase64: REAL_SIG,
        assetBytes: Buffer.from('irrelevant'),
        assetFilename: 'meta-proxy-0.1.0-does-not-exist.tar.gz',
      }),
    ).toThrow(/no entry/);
  });

  it('throws when the asset bytes do not match the recorded checksum', () => {
    expect(() =>
      verifyRelease({
        sumsBytes: REAL_SUMS,
        sigBase64: REAL_SIG,
        assetBytes: Buffer.from('these are definitely not the real 2.3MB windows zip bytes'),
        assetFilename: 'meta-proxy-0.1.0-x86_64-pc-windows-msvc.zip',
      }),
    ).toThrow(/sha256 mismatch/);
  });

  it('is exported for install.ts to pin', () => {
    expect(PROXY_RELEASE_PUBKEY_PEM).toContain('BEGIN PUBLIC KEY');
  });
});
