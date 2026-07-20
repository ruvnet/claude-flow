/**
 * meta-proxy release verification (ADR-307) — mirrors src/init/helper-signing.ts's
 * raw-EdDSA `crypto.verify(null, ...)` pattern almost exactly, and matches the
 * exact scheme confirmed live 2026-07-16 against a real v0.1.0 release: ONE
 * combined `SHA256SUMS.sig` (raw Ed25519 over the `SHA256SUMS` file's bytes,
 * base64-encoded — not a per-binary signature), then a per-asset SHA-256
 * check against the matching `SHA256SUMS` line. Refuse-all-or-nothing on any
 * mismatch, same discipline as `writeCriticalHelpers()`.
 *
 * @module proxy/verify
 */

import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';

/**
 * meta-proxy's committed release-signing public key (SPKI PEM), confirmed
 * live 2026-07-16 by verifying a real `SHA256SUMS.sig` from the v0.1.0
 * release against it (crypto.verify -> true).
 */
export const PROXY_RELEASE_PUBKEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAjhLDomjIGdcltYC7j+aiESQFD4LWoHaULietG1PuDjw=
-----END PUBLIC KEY-----`;

export class ReleaseVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseVerificationError';
  }
}

/** Raw EdDSA verify of `SHA256SUMS.sig` (base64) over `SHA256SUMS`'s exact bytes. */
export function verifySha256SumsSignature(
  sumsBytes: Buffer,
  sigBase64: string,
  pubkeyPem: string = PROXY_RELEASE_PUBKEY_PEM,
): boolean {
  const pubkey = createPublicKey(pubkeyPem);
  const sig = Buffer.from(sigBase64.trim(), 'base64');
  return cryptoVerify(null, sumsBytes, pubkey, sig);
}

export type ParsedChecksums = Record<string, string>; // filename -> lowercase hex sha256

/** Parses `<sha256>  <filename>` lines (sha256sum's own output format). */
export function parseSha256Sums(sumsText: string): ParsedChecksums {
  const result: ParsedChecksums = {};
  for (const line of sumsText.split(/\r?\n/)) {
    const match = line.match(/^([0-9a-f]{64})\s+(.+)$/i);
    if (!match) continue;
    result[match[2]] = match[1].toLowerCase();
  }
  return result;
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface VerifyReleaseInput {
  sumsBytes: Buffer;
  sigBase64: string;
  assetBytes: Buffer;
  assetFilename: string;
  pubkeyPem?: string;
}

export interface VerifyReleaseResult {
  sha256: string;
}

/**
 * Full verification: signature over SHA256SUMS, then the asset's own hash
 * against the matching line. Throws `ReleaseVerificationError` on ANY
 * failure — there is no partial-trust outcome, matching ADR-307's "refuses
 * on any mismatch" requirement.
 */
export function verifyRelease(input: VerifyReleaseInput): VerifyReleaseResult {
  if (!verifySha256SumsSignature(input.sumsBytes, input.sigBase64, input.pubkeyPem)) {
    throw new ReleaseVerificationError('SHA256SUMS.sig failed Ed25519 verification — refusing to install');
  }

  const sums = parseSha256Sums(input.sumsBytes.toString('utf-8'));
  const expected = sums[input.assetFilename];
  if (!expected) {
    throw new ReleaseVerificationError(`SHA256SUMS has no entry for ${input.assetFilename}`);
  }

  const actual = sha256Hex(input.assetBytes);
  if (actual !== expected) {
    throw new ReleaseVerificationError(
      `sha256 mismatch for ${input.assetFilename}: expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…`,
    );
  }

  return { sha256: actual };
}
