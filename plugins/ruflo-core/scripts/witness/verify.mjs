#!/usr/bin/env node
/**
 * Verify a signed witness manifest against the live tree (ADR-103).
 *
 * Project-agnostic — works without ruflo CLI being installed.
 *
 * Usage:
 *   node verify.mjs --manifest <path> [--root <path>] [--source-only] [--json]
 *
 * Exit codes:
 *   0  — signature valid + all fixes pass or drift (marker present)
 *   1  — signature invalid OR any fix regressed/missing (real failure)
 *   2  — bad arguments / file not found OR precondition not met
 *        (e.g. dist files not built during full-tree verification).
 *        Issue #1880: scheduled runners use this to distinguish a
 *        "needs install+build" environment from a real verification
 *        failure, so we stop filing recurring issues on every cron run.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  verify as verifyEd25519,
} from 'node:crypto';
import { fileSha256, fileContains } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.manifest) { console.error('--manifest <path> required'); process.exit(2); }

const manifestPath = resolve(args.manifest);
if (!existsSync(manifestPath)) { console.error(`not found: ${manifestPath}`); process.exit(2); }

const repoRoot = resolve(args.root ?? process.cwd());
const asJson = !!args.json;
const sourceOnly = !!args['source-only'];

const witness = JSON.parse(readFileSync(manifestPath, 'utf8'));

// ─── signature ────────────────────────────────────────────────────
const sig = verifySignature(witness);

// ─── per-fix marker check ─────────────────────────────────────────
const allFixes = witness.manifest.fixes;
const selectedFixes = sourceOnly
  ? allFixes.filter((fix) => !isGeneratedDistPath(fix.file))
  : allFixes;
const skippedGenerated = allFixes.length - selectedFixes.length;

if (sourceOnly && selectedFixes.length === 0) {
  const result = {
    ok: false,
    scope: 'source-only',
    precondition: 'no-source-entries',
    signature: sig,
  };
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else console.error('verify.mjs: manifest contains no source entries to verify');
  process.exit(2);
}

const fileResults = selectedFixes.map((fix) => {
  const installed = join(repoRoot, fix.file);
  if (!existsSync(installed)) {
    return { ...fix, status: 'missing', sha256Match: false, markerPresent: false };
  }
  const localSha256 = fileSha256(installed);
  const markerPresent = fileContains(installed, fix.marker);
  const sha256Match = localSha256 === fix.sha256;
  const status = sha256Match && markerPresent ? 'pass'
              : (markerPresent ? 'drift' : 'regressed');
  return { ...fix, status, sha256Match, markerPresent, localSha256 };
});

const summary = {
  pass: fileResults.filter(r => r.status === 'pass').length,
  drift: fileResults.filter(r => r.status === 'drift').length,
  regressed: fileResults.filter(r => r.status === 'regressed').length,
  missing: fileResults.filter(r => r.status === 'missing').length,
  skippedGenerated,
};

// Issue #1880 / #2528 — heuristic: if the only missing entries are
// generated `/dist/` artifacts and no marker regressed, the checkout was
// source-only (dependencies may be installed, but no build ran). That's a
// precondition failure, not a regression. Source-file drift is still
// reported in the JSON summary, but the operator action is the same:
// install + build before verifying the dist-layer witness entries.
const allMissing = fileResults.length > 0
                && summary.missing === fileResults.length;
const missingResults = fileResults.filter(r => r.status === 'missing');
const missingOnlyDist = missingResults.length > 0
  && missingResults.every(r => isGeneratedDistPath(r.file));
const referencesDist = fileResults.some(r => isGeneratedDistPath(r.file));
if (!sourceOnly && ((allMissing && referencesDist) || (missingOnlyDist && summary.regressed === 0))) {
  if (asJson) {
    console.log(JSON.stringify(
      { ok: false, scope: 'full', precondition: 'dist-not-built', signature: sig, summary },
      null, 2
    ));
  } else {
    console.error(
      `verify.mjs: every manifest entry is missing and the manifest references\n` +
      `dist/ artifacts. The checkout appears to be source-only (no build run).\n` +
      `\n` +
      `Fix: from the repo root, run \`npm ci && npm run build\` (or the\n` +
      `equivalent for the workspaces witness markers reference) before\n` +
      `invoking this script. See #1880 for the full diagnosis.`
    );
  }
  process.exit(2);
}

const ok = sig.signatureValid && sig.manifestHashOk && sig.publicKeyReproducible
        && summary.regressed === 0 && summary.missing === 0;

if (asJson) {
  console.log(JSON.stringify(
    { ok, scope: sourceOnly ? 'source-only' : 'full', signature: sig, summary, results: fileResults },
    null,
    2
  ));
} else {
  console.log(`Verification scope: ${sourceOnly ? 'source-only' : 'full'}`);
  console.log('Manifest signature:');
  console.log(`  hash matches:                    ${sig.manifestHashOk ? 'yes' : 'NO'}`);
  console.log(`  public key reproducible:         ${sig.publicKeyReproducible ? 'yes' : 'NO'}`);
  console.log(`  Ed25519 signature valid:         ${sig.signatureValid ? 'yes' : 'NO'}`);
  console.log('');
  console.log(`Summary: pass=${summary.pass} drift=${summary.drift} regressed=${summary.regressed} missing=${summary.missing} skipped-generated=${summary.skippedGenerated}`);
  if (summary.regressed > 0) {
    console.log('\nRegressed:');
    for (const r of fileResults.filter(r => r.status === 'regressed')) {
      console.log(`  ${r.id}  marker missing in ${r.file}`);
    }
  }
  if (summary.missing > 0) {
    console.log('\nMissing files:');
    for (const r of fileResults.filter(r => r.status === 'missing')) {
      console.log(`  ${r.id}  ${r.file}`);
    }
  }
}

process.exit(ok ? 0 : 1);

// ─── ed25519 helpers ─────────────────────────────────────────────
function verifySignature(witness) {
  try {
    const recomputed = createHash('sha256').update(JSON.stringify(witness.manifest)).digest('hex');
    const manifestHashOk = recomputed === witness.integrity.manifestHash;
    const seed = createHash('sha256')
      .update(witness.manifest.gitCommit + ':ruflo-witness/v1')
      .digest();

    // RFC 8410 DER wrappers let Node/OpenSSL derive and verify Ed25519 keys
    // without a package install. The witness format remains byte-compatible
    // with manifests produced by @noble/ed25519.
    const privateKey = createPrivateKey({
      key: Buffer.concat([
        Buffer.from('302e020100300506032b657004220420', 'hex'),
        seed,
      ]),
      format: 'der',
      type: 'pkcs8',
    });
    const reproducedKey = createPublicKey(privateKey)
      .export({ format: 'der', type: 'spki' })
      .subarray(-32);
    const publicKeyReproducible =
      reproducedKey.toString('hex') === witness.integrity.publicKey;

    const declaredKey = createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(witness.integrity.publicKey, 'hex'),
      ]),
      format: 'der',
      type: 'spki',
    });
    const signatureValid = verifyEd25519(
      null,
      Buffer.from(witness.integrity.manifestHash, 'hex'),
      declaredKey,
      Buffer.from(witness.integrity.signature, 'hex'),
    );
    return { manifestHashOk, publicKeyReproducible, signatureValid, verifier: 'node:crypto' };
  } catch (error) {
    return {
      manifestHashOk: false,
      publicKeyReproducible: false,
      signatureValid: false,
      verifier: 'node:crypto',
      reason: 'signature-verification-error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isGeneratedDistPath(file) {
  return typeof file === 'string' && file.split(/[\\/]/).includes('dist');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json' || a === '--help') { out[a.slice(2)] = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; }
      else { out[key] = true; }
    }
  }
  return out;
}
