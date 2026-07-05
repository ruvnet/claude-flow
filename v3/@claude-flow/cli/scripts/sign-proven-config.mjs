#!/usr/bin/env node
/**
 * Sign a proven-configuration manifest → .claude/proven-config.signed.json (ADR-177).
 *
 * The champion emitted by the self-optimizing loop (ADR-176) is signed here at
 * publish time with the CONFIG key (distinct from the helper-signing key).
 * Private-key resolution mirrors sign-helpers.mjs:
 *   1. GCP Secret Manager  — RUFLO_CONFIG_SIGNING_SECRET (default: ruflo-config-signing-key)
 *                            + optional RUFLO_CONFIG_SIGNING_PROJECT
 *   2. RUFLO_CONFIG_SIGNING_KEY  — a local PEM path (air-gapped)
 *   3. ~/.ruflo/config-signing.key  — dev default
 *
 * Usage:  node scripts/sign-proven-config.mjs <manifest.json>
 *         (defaults to .claude/proven-config.manifest.json if omitted)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { sign as edSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

function loadPrivateKey() {
  const secret = process.env.RUFLO_CONFIG_SIGNING_SECRET || 'ruflo-config-signing-key';
  if (process.env.RUFLO_CONFIG_SIGNING_SECRET || (!process.env.RUFLO_CONFIG_SIGNING_KEY && !existsSync(join(homedir(), '.ruflo', 'config-signing.key')))) {
    const args = ['secrets', 'versions', 'access', 'latest', '--secret', secret];
    const project = process.env.RUFLO_CONFIG_SIGNING_PROJECT || 'ruv-dev';
    if (project) args.push('--project', project);
    try {
      return execFileSync('gcloud', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit'] });
    } catch {
      console.error(`[sign-proven-config] failed to read GCP secret '${secret}'. gcloud authed? (gcloud auth login)`);
      process.exit(1);
    }
  }
  const keyPath = process.env.RUFLO_CONFIG_SIGNING_KEY || join(homedir(), '.ruflo', 'config-signing.key');
  if (!existsSync(keyPath)) { console.error(`[sign-proven-config] no key at ${keyPath}`); process.exit(1); }
  return readFileSync(keyPath, 'utf-8');
}

// Canonical bytes — MUST match src/config/proven-config.ts canonicalManifestBytes (recursive key sort).
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = canon(v[k]); return o; }
  return v;
}

const manifestPath = process.argv[2] || join(PKG_ROOT, '.claude', 'proven-config.manifest.json');
if (!existsSync(manifestPath)) { console.error(`[sign-proven-config] manifest not found: ${manifestPath}`); process.exit(1); }
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
const bytes = Buffer.from(JSON.stringify(canon(manifest)), 'utf-8');
const signature = edSign(null, bytes, loadPrivateKey()).toString('base64');

const signed = { manifest, signature, algorithm: 'ed25519' };
const outPath = join(PKG_ROOT, '.claude', 'proven-config.signed.json');
writeFileSync(outPath, JSON.stringify(signed, null, 2) + '\n', 'utf-8');
console.log(`[sign-proven-config] signed → ${outPath} (policy ${manifest.policy?.ref?.slice(0, 20)}…)`);

// ADR-177 final phase: also emit the RVFA-packaged champion when the built
// module is available (post-build publish flow). Additive — the raw JSON above
// is always written and remains a valid adopt source.
try {
  const rvfaMod = join(PKG_ROOT, 'dist', 'src', 'config', 'proven-config-rvfa.js');
  if (existsSync(rvfaMod)) {
    const { packProvenConfigRvfa } = await import(`file://${rvfaMod}`);
    const rvfPath = join(PKG_ROOT, '.claude', 'proven-config.signed.rvf');
    writeFileSync(rvfPath, packProvenConfigRvfa(signed));
    console.log(`[sign-proven-config] packaged → ${rvfPath} (RVFA envelope)`);
  } else {
    console.log('[sign-proven-config] dist not built — skipped RVFA packaging (run npm run build first)');
  }
} catch (e) {
  console.log(`[sign-proven-config] RVFA packaging skipped: ${e?.message ?? e}`);
}
