/**
 * SignedBacktestArtifact — Phase 4 of ADR-126
 *
 * Ed25519-signed envelope for `trading-backtests` entries. The paper→live
 * promotion gate stores backtest results as the artifact below; the cloud
 * backtest pipeline (`trader-cloud-backtest`) verifies the signature with a
 * pinned trusted key BEFORE promoting any artifact to a live strategy.
 *
 * Signing scheme — mirrors the CWE-347 plugin-registry pattern exactly
 * (scripts/smoke-plugin-registry-signature.mjs:80-130, the verified-good
 * reference for "sign with Ed25519, pin to a trusted key, fail closed"):
 *
 *   1. Build the artifact body WITHOUT signature fields
 *      (no `witnessSignature`, no `witnessPublicKey`).
 *   2. `JSON.stringify(...)` plain — no whitespace, no sort.
 *   3. Sign the resulting bytes with Ed25519.
 *   4. Verify pins to a caller-supplied `trustedPublicKey`,
 *      NOT to the self-asserted `witnessPublicKey` field on the artifact
 *      (an attacker controls that field; pinning to it is a no-op).
 *
 * Key sourcing:
 *   - The signer accepts a 32-byte private key as a hex string. The
 *     `trader-backtest` skill resolves the key at runtime via the env var
 *     `RUFLO_WITNESS_KEY_PATH` (a JSON file with a `{ "privateKey": "<hex>" }`
 *     field). If unset, callers may fall back to the legacy ADR-103 witness
 *     key path; if neither is available, the skill stores the artifact in
 *     UNSIGNED degraded mode with a loud warning — never silently.
 *
 *   - The verifier accepts a `trustedPublicKey` as `"ed25519:<hex>"` or
 *     plain `<hex>`. Production deployments pin this in project config.
 *
 * Refs:
 *   - ADR-126 Phase 4   — the integration plan
 *   - ADR-103           — witness temporal history
 *   - CWE-347 / #1922   — the pattern this signing scheme matches
 *   - scripts/smoke-plugin-registry-signature.mjs — the reference smoke
 */

/* ---------------------------------------------------------------------- */
/* Public types                                                           */
/* ---------------------------------------------------------------------- */

export interface SignedBacktestArtifact {
  schema: 'ruflo-neural-trader-backtest/v1';
  strategyId: string;
  paramsHash: string;           // sha256 of canonical params JSON
  dataRange: { from: string; to: string };
  metrics: Record<string, number>;
  runsHash: string;             // sha256 of the canonical runs array JSON
  generatedAt: string;          // ISO timestamp
  witnessPublicKey: string;     // 'ed25519:<hex>' — self-asserted (NOT pinned by verifier)
  witnessSignature: string;     // hex of the Ed25519 signature over the canonical body
}

/** The body that gets signed — everything except the two signature fields. */
export type SignedBacktestArtifactBody = Omit<
  SignedBacktestArtifact,
  'witnessPublicKey' | 'witnessSignature' | 'schema'
>;

/* ---------------------------------------------------------------------- */
/* Signing + verification                                                 */
/* ---------------------------------------------------------------------- */

/**
 * Sign the body of a backtest artifact and return the fully-formed
 * `SignedBacktestArtifact` envelope.
 *
 * The signature covers the artifact body WITHOUT `witnessSignature` and
 * WITHOUT `witnessPublicKey` (CWE-347 pattern). This means an attacker who
 * swaps the served `witnessPublicKey` field cannot bypass verification when
 * the verifier pins to a trusted key (which is the only safe verifier).
 *
 * @param body                 — the artifact body (everything except signature fields + schema)
 * @param privateKeyHex        — 32-byte Ed25519 private key as hex string (no 'ed25519:' prefix)
 * @returns                      — the signed artifact ready to be stored
 */
export async function signBacktestArtifact(
  body: SignedBacktestArtifactBody,
  privateKeyHex: string,
): Promise<SignedBacktestArtifact> {
  const ed = await import('@noble/ed25519');
  const privateKey = hexToBytes(privateKeyHex);
  if (privateKey.length !== 32) {
    throw new Error(
      `signBacktestArtifact: privateKey must be 32 bytes (got ${privateKey.length})`,
    );
  }

  // Canonical body = the artifact WITHOUT signature fields, plain JSON.stringify.
  // Matches scripts/smoke-plugin-registry-signature.mjs:193-200.
  const canonical = canonicalBytes(body);
  const signatureBytes = await ed.signAsync(canonical, privateKey);
  const publicKeyBytes = await ed.getPublicKeyAsync(privateKey);

  return {
    schema: 'ruflo-neural-trader-backtest/v1',
    ...body,
    witnessPublicKey: `ed25519:${bytesToHex(publicKeyBytes)}`,
    witnessSignature: bytesToHex(signatureBytes),
  };
}

/**
 * Verify a signed backtest artifact against a caller-supplied trusted
 * public key. Returns `true` iff the signature is valid for the canonical
 * body under the TRUSTED key.
 *
 * IMPORTANT — the verifier pins to `trustedPublicKey`, NOT to the artifact's
 * `witnessPublicKey` field. The artifact's self-asserted public key is
 * untrusted input: an attacker who tampers with the stored entry can swap
 * that field freely. Pinning to a trusted key supplied by project config
 * is the only safe pattern (CWE-347 / #1922).
 *
 * @param artifact          — the artifact to verify (may have been tampered)
 * @param trustedPublicKey  — caller-supplied trusted pubkey, with or without 'ed25519:' prefix
 * @returns                   — true iff signature verifies against the trusted key
 */
export async function verifyBacktestArtifact(
  artifact: SignedBacktestArtifact,
  trustedPublicKey: string,
): Promise<boolean> {
  if (!artifact || !artifact.witnessSignature || !trustedPublicKey) return false;
  const ed = await import('@noble/ed25519');

  // Strip BOTH signature fields (and schema, which is constant) to get the
  // canonical body that was signed.
  const body: SignedBacktestArtifactBody = {
    strategyId: artifact.strategyId,
    paramsHash: artifact.paramsHash,
    dataRange: artifact.dataRange,
    metrics: artifact.metrics,
    runsHash: artifact.runsHash,
    generatedAt: artifact.generatedAt,
  };
  const canonical = canonicalBytes(body);

  try {
    const pubKeyHex = trustedPublicKey.replace(/^ed25519:/, '');
    const pubKey = hexToBytes(pubKeyHex);
    if (pubKey.length !== 32) return false;
    const sig = hexToBytes(artifact.witnessSignature);
    if (sig.length !== 64) return false;
    return await ed.verifyAsync(sig, canonical, pubKey);
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------- */
/* Helpers                                                                */
/* ---------------------------------------------------------------------- */

/**
 * Canonical bytes for signing = `JSON.stringify(body)` UTF-8 encoded.
 *
 * Matches the plugin-registry signer (publish-registry.ts:127-151) and the
 * CWE-347 smoke (smoke-plugin-registry-signature.mjs:193-200): plain
 * `JSON.stringify` with NO whitespace and NO key sort. The body shape is
 * authored by us (the signer), so deterministic key order is guaranteed by
 * construction — no canonicalizer needed.
 */
function canonicalBytes(body: SignedBacktestArtifactBody): Uint8Array {
  const message = JSON.stringify(body);
  return new TextEncoder().encode(message);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  if (clean.length % 2 !== 0) {
    throw new Error(`hexToBytes: odd-length hex string`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}
