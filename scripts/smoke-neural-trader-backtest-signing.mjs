#!/usr/bin/env node
/**
 * Smoke test for ADR-126 Phase 4 (#2068) — Ed25519-signed backtest artifacts.
 *
 * Locks in three layers (modelled on scripts/smoke-plugin-registry-signature.mjs,
 * the CWE-347 reference for "sign with Ed25519, pin to a trusted key, fail
 * closed"):
 *
 *   [1/3] STATIC CONTRACT on signed-artifact.{ts,mjs}:
 *         - both files exist and export `signBacktestArtifact` +
 *           `verifyBacktestArtifact`
 *         - the verifier pins to a caller-supplied `trustedPublicKey`, NOT
 *           to artifact.witnessPublicKey (CWE-347 / #1922)
 *         - canonical message construction strips BOTH `witnessSignature`
 *           AND `witnessPublicKey` before stringifying — otherwise an
 *           attacker who swaps the served pubkey can re-sign the body.
 *         - canonical message is JSON.stringify (no whitespace, no sort) —
 *           matches the plugin-registry signer scheme exactly.
 *
 *   [2/3] CRYPTO ROUND-TRIP with real Ed25519 against the .mjs runtime:
 *         - signed fixture verifies with the trusted pubkey
 *         - tampered body fails
 *         - empty signature fails
 *         - empty pubkey fails
 *         - swapped served `witnessPublicKey` (attacker scenario) — still
 *           verifies because we pin to the TRUSTED pubkey, not the served field
 *         - wrong trusted pubkey fails (proves the pin is real, not a no-op)
 *
 *   [3/3] CALL-SITE BYTE check on trader-cloud-backtest/SKILL.md:
 *         - skill contains an `verifyBacktestArtifact(...)` call
 *         - skill contains a fail-closed branch on the failure path (refuse
 *           to promote / return early / error message)
 *
 * If a future PR drops the verify call, reverts the canonical-message
 * construction, or removes the fail-closed branch, this smoke catches it
 * before merge.
 *
 * Usage:  node scripts/smoke-neural-trader-backtest-signing.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TextEncoder } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PLUGIN_DIR = join(REPO_ROOT, 'plugins', 'ruflo-neural-trader');
const ARTIFACT_TS = join(PLUGIN_DIR, 'src', 'signed-artifact.ts');
const ARTIFACT_MJS = join(PLUGIN_DIR, 'src', 'signed-artifact.mjs');
const TRADER_BACKTEST_MD = join(PLUGIN_DIR, 'skills', 'trader-backtest', 'SKILL.md');
const CLOUD_BACKTEST_MD = join(PLUGIN_DIR, 'skills', 'trader-cloud-backtest', 'SKILL.md');

const failures = [];
function check(label, ok, detail = '') {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failures.push(label);
  }
}

// ---------------------------------------------------------------------------
// Part 1 — Static contract on signed-artifact.{ts,mjs}
// ---------------------------------------------------------------------------

console.log('[1/3] Static contract on signed-artifact.{ts,mjs}');

if (!existsSync(ARTIFACT_TS)) {
  failures.push('signed-artifact.ts not found');
} else {
  const src = readFileSync(ARTIFACT_TS, 'utf8');
  check(
    'TS exports `signBacktestArtifact` + `verifyBacktestArtifact`',
    /export\s+async\s+function\s+signBacktestArtifact\s*\(/.test(src) &&
      /export\s+async\s+function\s+verifyBacktestArtifact\s*\(/.test(src),
    'expected both functions to be exported as async',
  );
  check(
    'TS declares `SignedBacktestArtifact` interface with required fields',
    /interface\s+SignedBacktestArtifact/.test(src) &&
      /schema\s*:\s*'ruflo-neural-trader-backtest\/v1'/.test(src) &&
      /witnessPublicKey\s*:\s*string/.test(src) &&
      /witnessSignature\s*:\s*string/.test(src) &&
      /paramsHash\s*:\s*string/.test(src) &&
      /runsHash\s*:\s*string/.test(src),
    'shape per ADR-126 Phase 4 spec',
  );
  // Verifier MUST pin to caller's trustedPublicKey, not the served field.
  // We assert this by looking for the param `trustedPublicKey` in the
  // verifier signature AND for `replace(/^ed25519:/, '')` on it (the pin
  // path) AND for the absence of any `artifact.witnessPublicKey` usage
  // INSIDE the verifier body's pubkey computation.
  if (/export\s+async\s+function\s+verifyBacktestArtifact\s*\(\s*[^)]*trustedPublicKey/.test(src)) {
    check('TS verifier accepts `trustedPublicKey` as a parameter', true);
  } else {
    check('TS verifier accepts `trustedPublicKey` as a parameter', false, 'verifier MUST take trustedPublicKey as second arg, not infer from artifact');
  }
  // The verifier must NOT use artifact.witnessPublicKey when computing the
  // verification pubkey (the served field is attacker-controllable).
  const verifierBody = (() => {
    const m = /export\s+async\s+function\s+verifyBacktestArtifact[\s\S]*?\{([\s\S]*?)\n\}/.exec(src);
    return m ? m[1] : '';
  })();
  check(
    'TS verifier does NOT consume artifact.witnessPublicKey for verification',
    verifierBody && !/artifact\.witnessPublicKey/.test(verifierBody),
    'reading artifact.witnessPublicKey defeats the pin — pin to trustedPublicKey only',
  );
  // Canonical message construction must strip BOTH signature fields.
  // The TS version does this implicitly by building a `body` object that
  // omits `witnessPublicKey`, `witnessSignature`, and `schema`. We grep
  // for that pattern.
  check(
    'TS verifier builds canonical body WITHOUT witnessSignature + witnessPublicKey',
    /const\s+body[\s\S]{0,300}?strategyId:\s*artifact\.strategyId/.test(src) &&
      !/body\.witnessSignature\s*=/.test(src) &&
      !/body\.witnessPublicKey\s*=/.test(src),
    'canonical body MUST exclude both signature fields before stringify',
  );
  check(
    'TS canonical bytes use plain JSON.stringify (no whitespace, no sort)',
    /JSON\.stringify\(\s*body\s*\)/.test(src),
    'match the plugin-registry signer scheme: plain JSON.stringify',
  );
}

if (!existsSync(ARTIFACT_MJS)) {
  failures.push('signed-artifact.mjs (runtime mirror) not found');
} else {
  const mjs = readFileSync(ARTIFACT_MJS, 'utf8');
  check(
    'MJS runtime exports `signBacktestArtifact` + `verifyBacktestArtifact`',
    /export\s+async\s+function\s+signBacktestArtifact\b/.test(mjs) &&
      /export\s+async\s+function\s+verifyBacktestArtifact\b/.test(mjs),
    '.mjs mirror must keep parity with the .ts source',
  );
  check(
    'MJS verifier pins to caller-supplied `trustedPublicKey`',
    /verifyBacktestArtifact\s*\(\s*artifact\s*,\s*trustedPublicKey/.test(mjs) &&
      /trustedPublicKey\.replace\(\s*\/\^ed25519:\/\s*,\s*''\)/.test(mjs),
    'verifier param name must be trustedPublicKey AND it must be the one normalized',
  );
}

// ---------------------------------------------------------------------------
// Part 2 — Crypto round-trip with real Ed25519
// ---------------------------------------------------------------------------

console.log('\n[2/3] Crypto round-trip via the .mjs runtime');

let ed;
try {
  ed = await import('@noble/ed25519');
} catch (err) {
  failures.push('@noble/ed25519 not installed — run `npm install` at repo root');
  console.error(`  ✗ @noble/ed25519 import failed: ${err.message}`);
}

let signBacktestArtifact, verifyBacktestArtifact;
try {
  const mod = await import(pathToFileURL(ARTIFACT_MJS).href);
  signBacktestArtifact = mod.signBacktestArtifact;
  verifyBacktestArtifact = mod.verifyBacktestArtifact;
} catch (err) {
  failures.push('signed-artifact.mjs runtime import failed');
  console.error(`  ✗ runtime import failed: ${err.message}`);
}

if (ed && signBacktestArtifact && verifyBacktestArtifact) {
  // Deterministic test key (same scheme as the plugin-registry smoke).
  const privateKey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) privateKey[i] = (i * 19 + 7) % 256;
  const privateKeyHex = Buffer.from(privateKey).toString('hex');
  const publicKeyBytes = await ed.getPublicKeyAsync(privateKey);
  const trustedPubKeyHex = `ed25519:${Buffer.from(publicKeyBytes).toString('hex')}`;

  const body = {
    strategyId: 'momentum-spy-2024',
    paramsHash: 'a'.repeat(64),
    dataRange: { from: '2020-01-01', to: '2024-12-31' },
    metrics: { sharpe: 1.8, maxDrawdown: 0.11, totalReturn: 0.42 },
    runsHash: 'b'.repeat(64),
    generatedAt: '2026-05-19T12:00:00.000Z',
  };

  const signed = await signBacktestArtifact(body, privateKeyHex);

  // (a) happy path
  check(
    'signed fixture verifies with the trusted pubkey',
    await verifyBacktestArtifact(signed, trustedPubKeyHex),
  );

  // sanity: artifact has the documented shape
  check(
    'signed artifact carries schema + witnessPublicKey + witnessSignature',
    signed.schema === 'ruflo-neural-trader-backtest/v1' &&
      typeof signed.witnessPublicKey === 'string' &&
      signed.witnessPublicKey.startsWith('ed25519:') &&
      typeof signed.witnessSignature === 'string' &&
      signed.witnessSignature.length === 128,
    `got: schema=${signed.schema} pk-len=${signed.witnessPublicKey?.length} sig-len=${signed.witnessSignature?.length}`,
  );

  // (b) tamper one byte of the body → verify fails
  const tampered = JSON.parse(JSON.stringify(signed));
  tampered.metrics.sharpe = 99.9; // attacker inflates Sharpe to clear promotion gate
  check(
    'tampered body (sharpe inflated) fails verification',
    !(await verifyBacktestArtifact(tampered, trustedPubKeyHex)),
    'inflating metrics MUST invalidate the signature',
  );

  // (c) empty signature fails
  check(
    'empty signature fails',
    !(await verifyBacktestArtifact({ ...signed, witnessSignature: '' }, trustedPubKeyHex)),
  );

  // (d) empty pubkey fails
  check(
    'empty trusted pubkey fails',
    !(await verifyBacktestArtifact(signed, '')),
  );

  // (e) swap served witnessPublicKey to a different value → verify still
  //     succeeds because we pin to the TRUSTED key (CWE-347 / #1922).
  const swappedServed = {
    ...signed,
    witnessPublicKey: 'ed25519:' + '0'.repeat(64),
  };
  check(
    'verifier ignores swapped served witnessPublicKey (pinned to trusted key)',
    await verifyBacktestArtifact(swappedServed, trustedPubKeyHex),
    'pin to trustedPublicKey MUST override the served self-asserted pubkey',
  );

  // (f) different trusted pubkey fails — proves the pin is real
  const wrongTrusted = 'ed25519:' + '0'.repeat(64);
  check(
    'wrong trusted pubkey fails (pin is real, not a no-op)',
    !(await verifyBacktestArtifact(signed, wrongTrusted)),
  );
}

// ---------------------------------------------------------------------------
// Part 3 — Call-site byte check on trader-cloud-backtest/SKILL.md
// ---------------------------------------------------------------------------

console.log('\n[3/3] Call-site byte check on trader-cloud-backtest/SKILL.md');

if (!existsSync(CLOUD_BACKTEST_MD)) {
  failures.push('trader-cloud-backtest/SKILL.md not found');
} else {
  const skill = readFileSync(CLOUD_BACKTEST_MD, 'utf8');
  check(
    'skill calls `verifyBacktestArtifact(artifact, trustedPublicKey)`',
    /verifyBacktestArtifact\s*\([^)]*trustedPublicKey/.test(skill),
    'skill must invoke the verifier with the pinned trusted pubkey before promotion',
  );
  check(
    'skill documents the fail-closed branch (refuse to promote)',
    /refuse to promote/i.test(skill) &&
      (/return\s+early/i.test(skill) || /return\s*;/.test(skill) || /\[ERROR\]/.test(skill)),
    'skill must show explicit refusal + early-return on verify failure',
  );
  check(
    'skill references the pinned trusted pubkey path (NOT the served field)',
    /trustedPublicKey/.test(skill) && /NOT\s+the\s+`?artifact\.witnessPublicKey`?\s+field|attacker-controllable/i.test(skill),
    'docs must call out CWE-347: pin to trusted key, not served self-asserted field',
  );
}

// Also verify the trader-backtest skill mentions signing in its flow.
if (!existsSync(TRADER_BACKTEST_MD)) {
  failures.push('trader-backtest/SKILL.md not found');
} else {
  const skill = readFileSync(TRADER_BACKTEST_MD, 'utf8');
  check(
    'trader-backtest skill references signBacktestArtifact',
    /signBacktestArtifact/.test(skill),
    'skill must invoke the signer when a key is present',
  );
  check(
    'trader-backtest skill documents the degraded-unsigned warning path',
    /UNSIGNED degraded mode/.test(skill) || /unsigned.*degraded/i.test(skill),
    'no-key case must be logged loudly, never silent',
  );
  check(
    'trader-backtest skill documents RUFLO_WITNESS_KEY_PATH env var',
    /RUFLO_WITNESS_KEY_PATH/.test(skill),
    'production key sourcing must be documented',
  );
}

// ---------------------------------------------------------------------------
console.log('');
if (failures.length > 0) {
  console.log(`FAIL: ${failures.length} issue(s) — see above`);
  process.exit(1);
} else {
  console.log('OK: ADR-126 Phase 4 backtest-signing — schema + signer + verifier + skill gates verified');
  process.exit(0);
}
