// SignedBacktestArtifact — runtime ES module mirror of signed-artifact.ts.
//
// Why this file exists:
//   The plugin (ruflo-neural-trader) has no package.json / tsconfig /
//   build step — it ships skills + agents + scripts only. The `.ts`
//   file is the documented type-shape + source of truth (ADR-126
//   Phase 4 spec). This `.mjs` file is the runtime that the smoke
//   (`scripts/smoke-neural-trader-backtest-signing.mjs`) imports
//   directly, with zero compile step.
//
// Both files MUST stay in sync — any change to one is a change to the
// other. The smoke contract-checks the .ts file and runtime-tests the
// .mjs file; a divergence will fail one half of the smoke.
//
// Refs: ADR-126 Phase 4, CWE-347 pattern (#1922), ADR-103 witness.

/**
 * Sign the body of a backtest artifact. Returns the fully-formed
 * SignedBacktestArtifact envelope including witnessPublicKey + witnessSignature.
 */
export async function signBacktestArtifact(body, privateKeyHex) {
  const ed = await import('@noble/ed25519');
  const privateKey = hexToBytes(privateKeyHex);
  if (privateKey.length !== 32) {
    throw new Error(
      `signBacktestArtifact: privateKey must be 32 bytes (got ${privateKey.length})`,
    );
  }
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
 * Verify a signed backtest artifact against a caller-supplied trusted key.
 *
 * Pins to `trustedPublicKey`, NOT to artifact.witnessPublicKey. The latter
 * is attacker-controllable; pinning to it defeats the entire verification.
 * (CWE-347 / #1922 — same pattern the plugin-registry verifier uses.)
 */
export async function verifyBacktestArtifact(artifact, trustedPublicKey) {
  if (!artifact || !artifact.witnessSignature || !trustedPublicKey) return false;
  const ed = await import('@noble/ed25519');
  const body = {
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

// ---------------------------------------------------------------------------
// helpers (parity with .ts source)
// ---------------------------------------------------------------------------

function canonicalBytes(body) {
  const message = JSON.stringify(body);
  return new TextEncoder().encode(message);
}

function hexToBytes(hex) {
  const clean = hex.replace(/^0x/, '');
  if (clean.length % 2 !== 0) {
    throw new Error('hexToBytes: odd-length hex string');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}
