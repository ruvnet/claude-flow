#!/usr/bin/env node
/**
 * Verify .claude/helpers/helpers.manifest.json against the shipped critical
 * helpers (ADR-174, issue #2593). Runs in prepublishOnly AFTER sign-helpers.mjs
 * so npm publish fails closed if the manifest ever drifts from disk again.
 *
 * Checks:
 *   1. Ed25519 signature over the canonical manifest bytes is valid under
 *      RUFLO_HELPERS_PUBKEY (same primitive as helper-signing.ts).
 *   2. manifest.version matches package.json version.
 *   3. Every critical helper on disk hashes to the manifest entry.
 *
 * Optional arg: path to a helpers dir (e.g. an extracted `npm pack` tarball).
 * Defaults to <cli-pkg>/.claude/helpers.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash, verify as edVerify } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const HELPERS_DIR = resolve(process.argv[2] || join(PKG_ROOT, '.claude', 'helpers'));
// Keep in sync with sign-helpers.mjs:CRITICAL and src/init/helper-refresh.ts:CRITICAL_HELPERS.
const CRITICAL = ['auto-memory-hook.mjs', 'hook-handler.cjs', 'intelligence.cjs', 'statusline.cjs'];

const RUFLO_HELPERS_PUBKEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAhnFv74/CRcGWd0hL8zjyZ+52bIJ9SfcSgOutuKgo0Vg=
-----END PUBLIC KEY-----`;

function die(msg) { console.error(`[verify-helpers] ${msg}`); process.exit(1); }

const manifestPath = join(HELPERS_DIR, 'helpers.manifest.json');
if (!existsSync(manifestPath)) die(`missing manifest: ${manifestPath}`);

let signed;
try { signed = JSON.parse(readFileSync(manifestPath, 'utf-8')); }
catch (e) { die(`manifest is not valid JSON: ${e.message}`); }

if (!signed || signed.algorithm !== 'ed25519' || !signed.signature || !signed.manifest?.files) {
  die('manifest is malformed (missing algorithm/signature/files)');
}

// Canonical bytes — sorted file keys, MUST match sign-helpers.mjs + helper-signing.ts.
const sortedFiles = {};
for (const k of Object.keys(signed.manifest.files).sort()) sortedFiles[k] = signed.manifest.files[k];
const canonical = Buffer.from(JSON.stringify({ version: signed.manifest.version, files: sortedFiles }), 'utf-8');

if (!edVerify(null, canonical, RUFLO_HELPERS_PUBKEY, Buffer.from(signed.signature, 'base64'))) {
  die('Ed25519 signature does not verify against RUFLO_HELPERS_PUBKEY');
}

const pkgVersion = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf-8')).version;
if (signed.manifest.version !== pkgVersion) {
  die(`manifest version ${signed.manifest.version} != package.json ${pkgVersion} — re-run sign-helpers.mjs`);
}

for (const name of CRITICAL) {
  const p = join(HELPERS_DIR, name);
  if (!existsSync(p)) die(`critical helper missing on disk: ${p}`);
  const actual = createHash('sha256').update(readFileSync(p)).digest('hex');
  const expected = signed.manifest.files[name];
  if (!expected) die(`manifest has no entry for ${name}`);
  if (actual !== expected) {
    die(`hash drift for ${name}\n  manifest: ${expected}\n  on disk:  ${actual}\n  → re-run sign-helpers.mjs`);
  }
}

console.log(`[verify-helpers] ok — ${CRITICAL.length} helpers match signed manifest @ ${signed.manifest.version}`);
