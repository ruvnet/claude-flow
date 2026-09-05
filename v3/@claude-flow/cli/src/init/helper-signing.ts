/**
 * Ed25519 provenance for the auto-refreshed critical helpers (ADR-174 security).
 *
 * The helper auto-refresh copies auto-EXECUTING hook code (`hook-handler.cjs`
 * etc.) from the installed package into a project. npm verifies the tarball at
 * INSTALL time, but not the files on disk afterward — a sibling package's
 * postinstall (or disk tampering) could overwrite them, and the refresh would
 * faithfully propagate the tampered code. This gate closes that: every helper
 * is verified against a ruflo-signed manifest before install, and a mismatch is
 * REFUSED (fail-closed). The public key is baked in below; the private key is
 * never in the repo (see scripts/sign-helpers.mjs).
 *
 * Native Node crypto (RFC 8032 Ed25519), zero external deps — same primitive as
 * src/appliance/rvfa-signing.ts.
 */
import { createHash, verify as edVerify } from 'crypto';

/**
 * Ruflo helper-signing PUBLIC key (safe to commit). The matching private key is
 * held out-of-repo and provided to scripts/sign-helpers.mjs at publish time via
 * $RUFLO_HELPERS_SIGNING_KEY. Rotating the key = replace this constant + re-sign.
 *
 * ROTATED 2026-07-14 (v3.29.0): the previous key was accidentally exposed in a
 * Claude Code session transcript. Old GCP secret version 1 was destroyed (not
 * disabled) so it cannot be re-enabled; new v2 generated here. Users on old
 * ruflo versions keep the old pubkey and verify old manifests successfully;
 * upgrading to v3.29.0+ atomically picks up this new pubkey along with the
 * new-key-signed manifest.
 */
export const RUFLO_HELPERS_PUBKEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAyLl9cG+V/C+ffKWaSwvOsHdXSWmB5e3x1z9NUNvq6Ys=
-----END PUBLIC KEY-----`;

export const HELPERS_MANIFEST_FILE = 'helpers.manifest.json';

export interface HelpersManifest {
  version: string;
  files: Record<string, string>; // helper name -> sha256 hex
}
export interface SignedHelpersManifest {
  manifest: HelpersManifest;
  signature: string; // base64 Ed25519 signature over canonicalManifestBytes(manifest)
  algorithm: 'ed25519';
}

export function sha256Hex(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Deterministic canonical bytes of a manifest — file keys sorted so the signer
 * and verifier agree byte-for-byte regardless of object insertion order.
 */
export function canonicalManifestBytes(m: HelpersManifest): Buffer {
  const files: Record<string, string> = {};
  for (const k of Object.keys(m.files).sort()) files[k] = m.files[k];
  return Buffer.from(JSON.stringify({ version: m.version, files }), 'utf-8');
}

/**
 * Verify a signed helpers manifest against ruflo's public key. Returns the
 * trusted file->sha256 manifest, or null on ANY failure (bad signature,
 * malformed JSON, wrong algorithm). Fail-closed — the caller MUST refuse to
 * install unverified helpers.
 */
export function verifyHelpersManifest(
  signedJson: string,
  pubkeyPem: string = RUFLO_HELPERS_PUBKEY,
): HelpersManifest | null {
  try {
    const signed = JSON.parse(signedJson) as SignedHelpersManifest;
    if (!signed || signed.algorithm !== 'ed25519' || !signed.signature || !signed.manifest) return null;
    if (!signed.manifest.files || typeof signed.manifest.files !== 'object') return null;
    const bytes = canonicalManifestBytes(signed.manifest);
    const ok = edVerify(null, bytes, pubkeyPem, Buffer.from(signed.signature, 'base64'));
    return ok ? signed.manifest : null;
  } catch {
    return null;
  }
}
