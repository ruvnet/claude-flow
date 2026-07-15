#!/usr/bin/env node
/**
 * Sign the critical helpers → .claude/helpers/helpers.manifest.json (ADR-174).
 *
 * Run at publish time WHENEVER a critical helper changes. NEVER commit the
 * private key. The public half is baked into src/init/helper-signing.ts
 * (RUFLO_HELPERS_PUBKEY).
 *
 * Private-key resolution (first that is set wins):
 *   1. GCP Secret Manager (PREFERRED for CI/publish):
 *        RUFLO_HELPERS_SIGNING_SECRET=<secret-name>   (e.g. ruflo-helpers-signing-key)
 *        RUFLO_HELPERS_SIGNING_PROJECT=<gcp-project>  (optional; defaults to the
 *                                                       active gcloud project)
 *      Fetched via `gcloud secrets versions access latest`. Refuses to run when
 *      stdout is an interactive TTY (ADR-322) — set RUFLO_HELPERS_ALLOW_TTY=1 to
 *      override, or prefer the --stdin-key pipe below instead.
 *   2. --stdin-key                                     (safe fallback; reads a PEM
 *        from stdin (fd 0) via a shell pipe, e.g.:
 *          gcloud secrets versions access latest --secret=ruflo-helpers-signing-key \
 *            | node scripts/sign-helpers.mjs --stdin-key
 *        Never run `gcloud secrets versions access` on its own and redirect/paste
 *        the output by hand — that shape is what leaked the v1 key. See ADR-322.)
 *   3. RUFLO_HELPERS_SIGNING_KEY=<pem-file-path>       (local / air-gapped)
 *   4. ~/.ruflo/helpers-signing.key                    (dev default)
 *
 * Usage:  RUFLO_HELPERS_SIGNING_SECRET=ruflo-helpers-signing-key node scripts/sign-helpers.mjs
 *         gcloud secrets versions access latest --secret=ruflo-helpers-signing-key | node scripts/sign-helpers.mjs --stdin-key
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash, sign as edSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';

const capturedStdoutLines = [];
const originalConsoleLog = console.log.bind(console);
console.log = (...args) => {
  capturedStdoutLines.push(args.map(String).join(' '));
  originalConsoleLog(...args);
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const HELPERS_DIR = join(PKG_ROOT, '.claude', 'helpers');
// Keep in sync with src/init/helper-refresh.ts:CRITICAL_HELPERS.
const CRITICAL = ['auto-memory-hook.mjs', 'hook-handler.cjs', 'intelligence.cjs', 'statusline.cjs'];

export function loadPrivateKey() {
  const secret = process.env.RUFLO_HELPERS_SIGNING_SECRET;
  if (secret) {
    if (process.stdout.isTTY && !process.env.RUFLO_HELPERS_ALLOW_TTY) {
      console.error(
        '[sign-helpers] refusing to fetch from GCP Secret Manager in an interactive/logged ' +
        'terminal. Use `gcloud secrets versions access latest --secret=<name> | node scripts/sign-helpers.mjs --stdin-key`, ' +
        'or set RUFLO_HELPERS_SIGNING_KEY=<pem-file>. To override, set RUFLO_HELPERS_ALLOW_TTY=1.'
      );
      process.exit(1);
    }
    const args = ['secrets', 'versions', 'access', 'latest', '--secret', secret];
    const project = process.env.RUFLO_HELPERS_SIGNING_PROJECT;
    if (project) args.push('--project', project);
    const gcloudBin = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
    try {
      // stdio: key on stdout (captured), stderr captured too — NOT inherited.
      // Inheriting would forward gcloud's stderr verbatim into whatever log
      // is capturing this process's output (CI, terminal); this key material
      // is sensitive enough that we never want an uncontrolled passthrough,
      // even though gcloud's normal error paths don't echo secret payloads.
      return execFileSync(gcloudBin, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      console.error(`[sign-helpers] failed to read GCP secret '${secret}'. Is gcloud authed? (gcloud auth login)`);
      process.exit(1);
    }
  }
  if (process.argv.includes('--stdin-key')) {
    return readFileSync(0, 'utf-8');
  }
  const keyPath = process.env.RUFLO_HELPERS_SIGNING_KEY || join(homedir(), '.ruflo', 'helpers-signing.key');
  if (!existsSync(keyPath)) {
    console.error(
      `[sign-helpers] no signing key. Set RUFLO_HELPERS_SIGNING_SECRET (GCP), pass --stdin-key ` +
      `(pipe a PEM via stdin), or set RUFLO_HELPERS_SIGNING_KEY (PEM path); tried ${keyPath}.`,
    );
    process.exit(1);
  }
  return readFileSync(keyPath, 'utf-8');
}

// Output-scanning safety net (ADR-322 §4): scan everything queued to console.log
// during the run for private-key markers and abort before exiting normally.
export function scanCapturedOutputForLeak(lines = capturedStdoutLines) {
  const emitted = lines.join('\n');
  if (/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/.test(emitted)) {
    console.error('[sign-helpers] FATAL: private key material detected in script output. Aborting.');
    process.exit(1);
  }
}

function main() {
  const privateKeyPem = loadPrivateKey();

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

  scanCapturedOutputForLeak();
}

// Run the signing only when invoked directly as a script (node scripts/sign-helpers.mjs),
// not when imported by unit tests exercising loadPrivateKey / scanCapturedOutputForLeak.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
