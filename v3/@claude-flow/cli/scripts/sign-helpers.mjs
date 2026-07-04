#!/usr/bin/env node
/**
 * Sign the critical helpers → .claude/helpers/helpers.manifest.json (ADR-174).
 *
 * Run at publish time WHENEVER a critical helper changes. Reads the private key
 * from $RUFLO_HELPERS_SIGNING_KEY (a PEM file path), defaulting to
 * ~/.ruflo/helpers-signing.key. NEVER commit the private key. The public half
 * is baked into src/init/helper-signing.ts (RUFLO_HELPERS_PUBKEY).
 *
 * Usage:  RUFLO_HELPERS_SIGNING_KEY=/path/to/key node scripts/sign-helpers.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash, sign as edSign } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const HELPERS_DIR = join(PKG_ROOT, '.claude', 'helpers');
const CRITICAL = ['auto-memory-hook.mjs', 'hook-handler.cjs', 'intelligence.cjs'];

const keyPath = process.env.RUFLO_HELPERS_SIGNING_KEY || join(homedir(), '.ruflo', 'helpers-signing.key');
if (!existsSync(keyPath)) {
  console.error(`[sign-helpers] private key not found: ${keyPath}\n  set RUFLO_HELPERS_SIGNING_KEY to the PEM path.`);
  process.exit(1);
}
const privateKeyPem = readFileSync(keyPath, 'utf-8');

const version = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf-8')).version;
const files = {};
for (const name of CRITICAL) {
  const p = join(HELPERS_DIR, name);
  if (!existsSync(p)) { console.error(`[sign-helpers] missing helper: ${p}`); process.exit(1); }
  files[name] = createHash('sha256').update(readFileSync(p)).digest('hex');
}

const manifest = { version, files };
// Canonical bytes: sorted file keys — MUST match helper-signing.ts.
const sortedFiles = {};
for (const k of Object.keys(manifest.files).sort()) sortedFiles[k] = manifest.files[k];
const canonical = Buffer.from(JSON.stringify({ version: manifest.version, files: sortedFiles }), 'utf-8');
const signature = edSign(null, canonical, privateKeyPem).toString('base64');

const signed = { manifest, signature, algorithm: 'ed25519' };
const outPath = join(HELPERS_DIR, 'helpers.manifest.json');
writeFileSync(outPath, JSON.stringify(signed, null, 2) + '\n', 'utf-8');
console.log(`[sign-helpers] signed ${CRITICAL.length} helpers → ${outPath}`);
for (const [n, h] of Object.entries(files)) console.log(`  ${n}: ${h.slice(0, 16)}…`);
