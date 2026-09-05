/**
 * RVFA packaging for proven-configuration manifests (ADR-177, final phase).
 *
 * Keeps champion propagation inside the ruvnet RVFA ecosystem: the *already
 * config-signed* SignedProvenConfig is carried as the sole section of a small
 * RVFA appliance binary. This adds a ruvnet-native transport + tamper-evident
 * envelope (RVFA's SHA256 footer + per-section hash) WITHOUT a second trust
 * root — adoption still verifies the inner manifest's Ed25519 signature against
 * RUFLO_CONFIG_PUBKEY (see adoptSignedConfig). Signed ≠ suitable is unchanged:
 * unpack → verifyProvenConfig → isSuitable, fail-closed at every step.
 *
 * Pure Node (RvfaWriter/RvfaReader) — no LLM, no network, $0. Additive: a raw
 * `.signed.json` champion still adopts exactly as before; the `.rvf` form is a
 * second, optional packaging the same adopt path understands.
 */
import { RvfaWriter, RvfaReader, RVFA_MAGIC } from '../appliance/rvfa-format.js';
import type { SignedProvenConfig } from './proven-config.js';

/** The single RVFA section id that carries the signed manifest JSON. */
export const PROVEN_CONFIG_SECTION = 'proven-config';
/** Header capability marker so a reader can tell this appliance apart. */
export const PROVEN_CONFIG_CAPABILITY = 'proven-config';

/**
 * Pack a signed proven-config manifest into an RVFA appliance binary.
 *
 * The whole SignedProvenConfig (manifest + signature + algorithm) becomes the
 * payload, so the config-root signature travels inside the envelope. The RVFA
 * layer contributes integrity (footer + section hash), not authenticity.
 */
export function packProvenConfigRvfa(signed: SignedProvenConfig): Buffer {
  const m = signed.manifest;
  const writer = new RvfaWriter({
    name: `proven-config:${m.policy?.ref ?? 'unknown'}`,
    // Carry the compat floor for humans/tools; the real gate is isSuitable.
    appVersion: m.compatibility?.ruflo ?? '0',
    platform: m.platform?.[0] ?? 'any',
    arch: 'any',
    profile: 'offline',
    capabilities: [PROVEN_CONFIG_CAPABILITY],
  });
  writer.addSection(PROVEN_CONFIG_SECTION, Buffer.from(JSON.stringify(signed), 'utf-8'), {
    compression: 'gzip',
    type: 'application/json',
  });
  return writer.build();
}

/** True if `buf` looks like an RVFA container (starts with the RVFA magic). */
export function isProvenConfigRvfa(buf: Buffer): boolean {
  return buf.length >= RVFA_MAGIC.length && buf.subarray(0, RVFA_MAGIC.length).equals(RVFA_MAGIC);
}

/**
 * Unpack + integrity-check an RVFA-packed champion. Returns the inner
 * SignedProvenConfig, or null on ANY failure (bad magic, corrupt footer,
 * missing section, malformed JSON). Fail-closed — does NOT verify the Ed25519
 * signature; that stays with adoptSignedConfig (single config trust root).
 */
export function unpackProvenConfigRvfa(buf: Buffer): SignedProvenConfig | null {
  try {
    if (!isProvenConfigRvfa(buf)) return null;
    const reader = RvfaReader.fromBuffer(buf);
    const integrity = reader.verify();
    if (!integrity.valid) return null; // tampered envelope → reject
    const payload = reader.extractSection(PROVEN_CONFIG_SECTION);
    const signed = JSON.parse(payload.toString('utf-8')) as SignedProvenConfig;
    if (!signed || signed.algorithm !== 'ed25519' || !signed.signature || !signed.manifest) return null;
    return signed;
  } catch {
    return null;
  }
}
