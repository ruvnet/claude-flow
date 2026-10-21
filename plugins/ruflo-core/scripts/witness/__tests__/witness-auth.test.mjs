import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { regenerate } from '../lib.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../..');
const REPO_V3 = resolve(HERE, '../../../../../v3');
const ED_ROOTS = [process.env.WITNESS_ED25519_ROOT, REPO_ROOT, REPO_V3].filter(Boolean);
const VERIFY = resolve(HERE, '../verify.mjs');

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'witness-auth-'));
  writeFileSync(join(root, 'README.md'), 'fixture\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Witness Test'], { cwd: root });
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  return root;
}

function runVerify(root, manifestPath, env = {}, extraArgs = []) {
  return execFileSync(process.execPath, [VERIFY, '--manifest', manifestPath, '--root', root, '--json', ...extraArgs], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function runVerifyFailing(root, manifestPath, env = {}, extraArgs = []) {
  try {
    runVerify(root, manifestPath, env, extraArgs);
    assert.fail('verify.mjs was expected to exit non-zero');
  } catch (error) {
    assert.equal(error.status, 1);
    return JSON.parse(error.stdout);
  }
}

test('external signing key verifies only with the pinned public key', () => {
  const root = makeRepo();
  try {
    const manifestPath = join(root, 'verification.md.json');
    const seed = randomBytes(32);
    const result = regenerate({
      repoRoot: root,
      manifestPath,
      ed25519Roots: ED_ROOTS,
      signingSeed: seed,
    });
    writeFileSync(manifestPath, JSON.stringify(result.witness, null, 2));
    const publicKey = result.witness.integrity.publicKey;

    const pinned = JSON.parse(runVerify(root, manifestPath, { RUFLO_WITNESS_PUBLIC_KEY: publicKey }));
    assert.equal(pinned.ok, true);
    assert.equal(pinned.signature.authenticity, 'external-key');
    assert.equal(pinned.signature.pinnedKeyConfigured, true);
    assert.equal(pinned.signature.pinnedKeyMatches, true);
    assert.equal(pinned.signature.publicKeyReproducible, true);

    const unpinned = runVerifyFailing(root, manifestPath);
    assert.equal(unpinned.ok, false);
    assert.equal(unpinned.signature.authenticity, 'external-key');
    assert.equal(unpinned.signature.publicKeyReproducible, false);

    const wrongKey = randomBytes(32).toString('hex');
    // --public-key takes precedence over a conflicting env var.
    const flagWins = JSON.parse(runVerify(
      root,
      manifestPath,
      { RUFLO_WITNESS_PUBLIC_KEY: wrongKey },
      ['--public-key', publicKey]
    ));
    assert.equal(flagWins.ok, true);
    assert.equal(flagWins.signature.pinnedKeyMatches, true);

    const flagLoses = runVerifyFailing(
      root,
      manifestPath,
      { RUFLO_WITNESS_PUBLIC_KEY: publicKey },
      ['--public-key', wrongKey]
    );
    assert.equal(flagLoses.ok, false);
    assert.equal(flagLoses.signature.pinnedKeyMatches, false);

    const wrong = runVerifyFailing(root, manifestPath, {
      RUFLO_WITNESS_PUBLIC_KEY: wrongKey,
    });
    assert.equal(wrong.ok, false);
    assert.equal(wrong.signature.pinnedKeyMatches, false);
    assert.equal(wrong.signature.publicKeyReproducible, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('legacy commit-derived seed is reported as self-attested', () => {
  const root = makeRepo();
  try {
    const manifestPath = join(root, 'verification.md.json');
    const result = regenerate({ repoRoot: root, manifestPath, ed25519Roots: ED_ROOTS });
    writeFileSync(manifestPath, JSON.stringify(result.witness, null, 2));

    const legacy = JSON.parse(runVerify(root, manifestPath));
    assert.equal(legacy.ok, true);
    assert.equal(legacy.signature.authenticity, 'self-attested');
    assert.equal(legacy.signature.pinnedKeyConfigured, false);
    assert.equal(legacy.signature.publicKeyReproducible, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('invalid RUFLO_WITNESS_SEED is rejected instead of silently falling back', () => {
  const root = makeRepo();
  try {
    assert.throws(
      () => regenerate({ repoRoot: root, manifestPath: join(root, 'verification.md.json'), ed25519Roots: ED_ROOTS, signingSeed: 'abcd' }),
      /32 bytes/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
