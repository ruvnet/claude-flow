#!/usr/bin/env node
/**
 * Regression guard for source-only witness verification (#2729).
 *
 * The standalone verifier must:
 *   1. cryptographically verify a signed manifest without node_modules;
 *   2. validate every source marker while explicitly skipping generated dist/;
 *   3. reject a tampered signature and a regressed source marker; and
 *   4. retain exit 2 for legacy full-tree checks when dist has not been built.
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = process.cwd();
const VERIFY = resolve(REPO_ROOT, 'plugins/ruflo-core/scripts/witness/verify.mjs');
const REAL_MANIFEST = resolve(REPO_ROOT, 'verification/macos/manifest.md.json');
const failures = [];

function record(name, condition, detail) {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${name}`);
  if (!condition) {
    if (detail) console.log(`        ${detail}`);
    failures.push(name);
  }
}

function run(root, manifest = REAL_MANIFEST, ...extra) {
  return spawnSync(
    process.execPath,
    [VERIFY, '--manifest', manifest, '--root', root, '--json', ...extra],
    { encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } },
  );
}

function parseOutput(out) {
  try {
    return JSON.parse(out.stdout);
  } catch {
    return null;
  }
}

if (!existsSync(VERIFY) || !existsSync(REAL_MANIFEST)) {
  console.error('smoke: verifier or signed manifest is missing');
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), 'witness-source-only-'));
try {
  const witness = JSON.parse(readFileSync(REAL_MANIFEST, 'utf8'));
  const sourceFixes = witness.manifest.fixes.filter(
    (fix) => !fix.file.split(/[\\/]/).includes('dist'),
  );
  const generatedFixes = witness.manifest.fixes.length - sourceFixes.length;

  for (const fix of sourceFixes) {
    const src = resolve(REPO_ROOT, fix.file);
    const dst = resolve(tmp, fix.file);
    if (!existsSync(src)) continue;
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst);
  }

  console.log('\nCase 1: source-only verification needs no installed dependency');
  const sourceOnly = run(tmp, REAL_MANIFEST, '--source-only');
  const sourceResult = parseOutput(sourceOnly);
  record(
    'signed manifest and all source markers verify',
    sourceOnly.status === 0 && sourceResult?.ok === true,
    `exit=${sourceOnly.status}, output=${(sourceOnly.stdout + sourceOnly.stderr).slice(0, 400)}`,
  );
  record(
    'scope and skipped generated entries are explicit',
    sourceResult?.scope === 'source-only'
      && sourceResult?.summary?.skippedGenerated === generatedFixes
      && sourceResult?.results?.length === sourceFixes.length,
    `result=${JSON.stringify(sourceResult?.summary)}`,
  );
  record(
    'built-in cryptographic verifier was used',
    sourceResult?.signature?.verifier === 'node:crypto'
      && sourceResult?.signature?.signatureValid === true
      && sourceResult?.signature?.publicKeyReproducible === true,
    `signature=${JSON.stringify(sourceResult?.signature)}`,
  );

  console.log('\nCase 2: signature tampering fails closed');
  const tampered = structuredClone(witness);
  tampered.integrity.signature =
    `${tampered.integrity.signature[0] === '0' ? '1' : '0'}${tampered.integrity.signature.slice(1)}`;
  const tamperedPath = join(tmp, 'tampered-manifest.json');
  writeFileSync(tamperedPath, JSON.stringify(tampered));
  const badSignature = run(tmp, tamperedPath, '--source-only');
  record(
    'one-byte signature change exits 1',
    badSignature.status === 1 && parseOutput(badSignature)?.signature?.signatureValid === false,
    `exit=${badSignature.status}, output=${badSignature.stdout.slice(0, 300)}`,
  );

  console.log('\nCase 3: source marker regression fails closed');
  const markerFix = sourceFixes.find((fix) => existsSync(resolve(tmp, fix.file)));
  if (!markerFix) {
    record('manifest has a locally present source entry', false);
  } else {
    const markerPath = resolve(tmp, markerFix.file);
    const source = readFileSync(markerPath, 'utf8');
    writeFileSync(markerPath, source.replace(markerFix.marker, 'ruflo-regressed-marker'));
    const regression = run(tmp, REAL_MANIFEST, '--source-only');
    const result = parseOutput(regression);
    record(
      'missing source marker exits 1 and is classified regressed',
      regression.status === 1 && result?.summary?.regressed >= 1,
      `exit=${regression.status}, summary=${JSON.stringify(result?.summary)}`,
    );
    writeFileSync(markerPath, source);
  }

  console.log('\nCase 4: legacy full-tree verification retains precondition exit');
  const full = run(tmp);
  const fullResult = parseOutput(full);
  record(
    'unbuilt full-tree verification exits 2',
    full.status === 2 && fullResult?.precondition === 'dist-not-built',
    `exit=${full.status}, output=${(full.stdout + full.stderr).slice(0, 300)}`,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('');
if (failures.length > 0) {
  console.error(`smoke-witness-verify-precondition: ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('smoke-witness-verify-precondition: all checks passed');
