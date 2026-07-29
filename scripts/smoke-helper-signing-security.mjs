#!/usr/bin/env node
/**
 * Offline regression guard for helper-signing issues #2674 and #2675.
 */
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, verify } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = process.cwd();
const cli = resolve(root, 'v3/@claude-flow/cli');
const signer = join(cli, 'scripts/sign-helpers.mjs');
const verifier = join(cli, 'scripts/verify-helpers.mjs');
const failures = [];

function check(name, condition, detail = '') {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${name}`);
  if (!condition) {
    if (detail) console.log(`        ${detail}`);
    failures.push(name);
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'helper-signing-security-'));
try {
  const fixture = join(tmp, 'cli');
  mkdirSync(join(fixture, 'scripts'), { recursive: true });
  mkdirSync(join(fixture, '.claude', 'helpers'), { recursive: true });
  cpSync(signer, join(fixture, 'scripts', 'sign-helpers.mjs'));
  for (const name of ['auto-memory-hook.mjs', 'hook-handler.cjs', 'intelligence.cjs', 'statusline.cjs']) {
    cpSync(join(cli, '.claude', 'helpers', name), join(fixture, '.claude', 'helpers', name));
  }
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ version: '0.0.0-security-test' }));

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const result = spawnSync(
    process.execPath,
    [join(fixture, 'scripts', 'sign-helpers.mjs'), '--stdin-key'],
    { input: privatePem, encoding: 'utf8', env: { ...process.env } },
  );

  check('stdin-only signing succeeds', result.status === 0, result.stderr);
  check(
    'private key never reaches signer output',
    !/BEGIN PRIVATE KEY|PRIVATE KEY-----/.test(result.stdout + result.stderr)
      && !(result.stdout + result.stderr).includes(privatePem.slice(30, 70)),
    (result.stdout + result.stderr).slice(0, 300),
  );

  const signed = JSON.parse(readFileSync(
    join(fixture, '.claude', 'helpers', 'helpers.manifest.json'),
    'utf8',
  ));
  const sortedFiles = {};
  for (const key of Object.keys(signed.manifest.files).sort()) sortedFiles[key] = signed.manifest.files[key];
  const canonical = Buffer.from(JSON.stringify({
    version: signed.manifest.version,
    files: sortedFiles,
  }));
  check(
    'stdin key produced a valid Ed25519 signature',
    verify(null, canonical, publicKey, Buffer.from(signed.signature, 'base64')),
  );

  const invalid = '-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----\n';
  const rejected = spawnSync(
    process.execPath,
    [join(fixture, 'scripts', 'sign-helpers.mjs'), '--stdin-key'],
    { input: invalid, encoding: 'utf8' },
  );
  check(
    'invalid key fails with a redacted diagnostic',
    rejected.status === 1
      && /not a valid Ed25519 private key/.test(rejected.stderr)
      && !rejected.stderr.includes('not-a-key'),
    rejected.stderr,
  );

  const signerSource = readFileSync(signer, 'utf8');
  check(
    'Windows uses the executable gcloud.cmd shim',
    /process\.platform === 'win32'\s*\?\s*'gcloud\.cmd'\s*:\s*'gcloud'/.test(signerSource),
  );

  const verifierSource = readFileSync(verifier, 'utf8');
  check(
    'runtime helper-signing module is the sole public-key source',
    !verifierSource.includes('BEGIN PUBLIC KEY')
      && verifierSource.includes("import('../dist/src/init/helper-signing.js')"),
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`smoke-helper-signing-security: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('smoke-helper-signing-security: all checks passed');
