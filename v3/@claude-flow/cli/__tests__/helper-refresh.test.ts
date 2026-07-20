/**
 * Version-stamped critical-helper auto-refresh.
 *
 * The propagation gap: Claude Code hooks run the project-local
 * `.claude/helpers/*.cjs`, not the npm package, so hook fixes don't reach
 * existing users without a manual re-init. This test proves the stamp-and-
 * refresh path closes it: a stale-stamped project silently re-copies the
 * current helpers on the next CLI startup; a current one is a no-op; and a
 * non-ruflo directory is never touched.
 *
 * The successful-copy tests use an ISOLATED, throwaway-keypair-signed
 * fixture (`makeSignedSource()`) rather than this repo's own real
 * `.claude/helpers` + its real Ed25519 signature. That coupling is
 * deliberately avoided: the real manifest is re-signed at publish time
 * (scripts/sign-helpers.mjs, needs a GCP secret or a local PEM key) and is
 * routinely stale mid-development whenever a critical helper changes without
 * an immediate re-sign — this suite must pass regardless of that state, and
 * only actually exercises `writeCriticalHelpers`' verify → hash → copy logic
 * when it does.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';
import * as semver from 'semver';

import { autoRefreshHelpersIfStale, getInstalledCliVersion, HELPERS_STAMP_FILE } from '../src/init/helper-refresh.js';
import { canonicalManifestBytes, sha256Hex } from '../src/init/helper-signing.js';

function makeProject(): { cwd: string; helpersDir: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'helper-refresh-'));
  const helpersDir = join(cwd, '.claude', 'helpers');
  mkdirSync(helpersDir, { recursive: true });
  return { cwd, helpersDir };
}

/**
 * Build a throwaway-keypair-signed `.claude/helpers` source fixture:
 * `hook-handler.cjs` with recognizable NEW content + a validly-signed
 * manifest for it. Returns the source dir and the matching public key PEM
 * to inject via `pubkeyPemOverride`.
 */
function makeSignedSource(version: string): { sourceDir: string; pubkeyPem: string } {
  const sourceDir = mkdtempSync(join(tmpdir(), 'helper-refresh-source-'));
  const content = 'intelligence.feedback(!toolFailed); // NEW, real failure capture\n';
  writeFileSync(join(sourceDir, 'hook-handler.cjs'), content);

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const manifest = { version, files: { 'hook-handler.cjs': sha256Hex(content) } };
  const signature = edSign(null, canonicalManifestBytes(manifest), privateKey).toString('base64');
  writeFileSync(
    join(sourceDir, 'helpers.manifest.json'),
    JSON.stringify({ manifest, signature, algorithm: 'ed25519' }),
  );

  return { sourceDir, pubkeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

describe('autoRefreshHelpersIfStale', () => {
  let version: string;
  beforeEach(() => { version = getInstalledCliVersion(); });

  it('refreshes a project whose helpers are stamped with an older version', async () => {
    const { cwd, helpersDir } = makeProject();
    // Old, hardcoded-success hook-handler + a stale stamp.
    writeFileSync(join(helpersDir, 'hook-handler.cjs'), 'intelligence.feedback(true); // OLD, no failure capture\n');
    writeFileSync(join(helpersDir, HELPERS_STAMP_FILE), '0.0.1-old');
    const { sourceDir, pubkeyPem } = makeSignedSource(version);

    const r = await autoRefreshHelpersIfStale(cwd, { sourceDirOverride: sourceDir, pubkeyPemOverride: pubkeyPem });
    expect(r.refreshed).toBe(true);
    expect(r.from).toBe('0.0.1-old');
    expect(r.to).toBe(version);

    // The stamp now matches the installed version.
    expect(readFileSync(join(helpersDir, HELPERS_STAMP_FILE), 'utf-8').trim()).toBe(version);
    // And the copied hook-handler carries the NEW failure-capture logic.
    const refreshed = readFileSync(join(helpersDir, 'hook-handler.cjs'), 'utf-8');
    expect(refreshed).toMatch(/toolFailed/);
    expect(refreshed).not.toContain('// OLD, no failure capture');
  });

  it('refuses to refresh when the source manifest signature does not verify (fail-closed)', async () => {
    const { cwd, helpersDir } = makeProject();
    const marker = 'PROJECT-HANDLER-UNTOUCHED-ON-BAD-SIGNATURE';
    writeFileSync(join(helpersDir, 'hook-handler.cjs'), marker);
    writeFileSync(join(helpersDir, HELPERS_STAMP_FILE), '0.0.1-old');
    // Sign with one keypair, verify with an unrelated one — signature must fail.
    const { sourceDir } = makeSignedSource(version);
    const { publicKey: wrongPubkey } = generateKeyPairSync('ed25519');

    const r = await autoRefreshHelpersIfStale(cwd, {
      sourceDirOverride: sourceDir,
      pubkeyPemOverride: wrongPubkey.export({ type: 'spki', format: 'pem' }).toString(),
    });
    expect(r.refreshed).toBe(false);
    expect(r.blocked).toMatch(/signature invalid|missing/);
    expect(readFileSync(join(helpersDir, 'hook-handler.cjs'), 'utf-8')).toBe(marker);
  });

  it('is a no-op when the stamp already matches the installed version', async () => {
    const { cwd, helpersDir } = makeProject();
    const marker = 'CURRENT-HANDLER-DO-NOT-OVERWRITE';
    writeFileSync(join(helpersDir, 'hook-handler.cjs'), marker);
    writeFileSync(join(helpersDir, HELPERS_STAMP_FILE), version);

    const r = await autoRefreshHelpersIfStale(cwd);
    expect(r.refreshed).toBe(false);
    // Untouched — the fast path never copied over our marker file.
    expect(readFileSync(join(helpersDir, 'hook-handler.cjs'), 'utf-8')).toBe(marker);
  });

  it('refreshes an UNSTAMPED (pre-feature) project on first run', async () => {
    const { cwd, helpersDir } = makeProject();
    writeFileSync(join(helpersDir, 'hook-handler.cjs'), 'intelligence.feedback(true);\n');
    // no stamp file at all
    const { sourceDir, pubkeyPem } = makeSignedSource(version);

    const r = await autoRefreshHelpersIfStale(cwd, { sourceDirOverride: sourceDir, pubkeyPemOverride: pubkeyPem });
    expect(r.refreshed).toBe(true);
    expect(r.from).toBe('(unstamped)');
    expect(existsSync(join(helpersDir, HELPERS_STAMP_FILE))).toBe(true);
  });

  it('is a safe no-op outside a ruflo project (never creates files)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'not-ruflo-'));
    const r = await autoRefreshHelpersIfStale(cwd);
    expect(r.refreshed).toBe(false);
    expect(existsSync(join(cwd, '.claude'))).toBe(false); // did not scaffold anything
  });

  it('never downgrades — an OLDER installed version than the stamp is a no-op', async () => {
    // Real trigger: a stray/older installed binary (stale npx cache,
    // marketplace install lagging an unpublished dev-tree fix) running any
    // command against a project whose helpers are stamped with a NEWER
    // version than that binary reports. Must never silently overwrite the
    // project's (fresher, hand-fixed) helpers with the older binary's own.
    const { cwd, helpersDir } = makeProject();
    const marker = 'NEWER-HANDLER-DO-NOT-DOWNGRADE';
    writeFileSync(join(helpersDir, 'hook-handler.cjs'), marker);
    const futureVersion = `${semver.major(version) + 1}.0.0`;
    writeFileSync(join(helpersDir, HELPERS_STAMP_FILE), futureVersion);

    const r = await autoRefreshHelpersIfStale(cwd);
    expect(r.refreshed).toBe(false);
    expect(readFileSync(join(helpersDir, 'hook-handler.cjs'), 'utf-8')).toBe(marker);
    // Stamp itself is also left untouched — not silently rolled back either.
    expect(readFileSync(join(helpersDir, HELPERS_STAMP_FILE), 'utf-8').trim()).toBe(futureVersion);
  });

  it('alsoRefreshGlobal:true refreshes ~/.claude/helpers under a redirected HOME (regression: pre-3.31.3 the global copy never refreshed, so the 2026-07-13 promo row never reached existing installs)', async () => {
    const { cwd } = makeProject(); // project dir is a real ruflo project so the project pass has something to do
    const projectHelpers = join(cwd, '.claude', 'helpers');
    writeFileSync(join(projectHelpers, 'hook-handler.cjs'), 'intelligence.feedback(true); // OLD project\n');
    writeFileSync(join(projectHelpers, HELPERS_STAMP_FILE), '0.0.1-old');

    // Redirect HOME so we don't touch the developer's real ~/.claude/helpers.
    // Populate the "global" helpers dir with a stale-stamped hook-handler.
    const fakeHome = mkdtempSync(join(tmpdir(), 'helper-refresh-home-'));
    const globalHelpers = join(fakeHome, '.claude', 'helpers');
    mkdirSync(globalHelpers, { recursive: true });
    writeFileSync(join(globalHelpers, 'hook-handler.cjs'), 'intelligence.feedback(true); // OLD global\n');
    writeFileSync(join(globalHelpers, HELPERS_STAMP_FILE), '0.0.1-old');

    const { sourceDir, pubkeyPem } = makeSignedSource(version);
    const savedHome = process.env.HOME;
    const savedUserProfile = process.env.USERPROFILE;
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome; // Node's os.homedir() reads USERPROFILE on Windows
    try {
      const r = await autoRefreshHelpersIfStale(cwd, {
        sourceDirOverride: sourceDir,
        pubkeyPemOverride: pubkeyPem,
        alsoRefreshGlobal: true,
      });
      // Project pass fired (top-level fields are the project result — API compat)
      expect(r.refreshed).toBe(true);
      expect(r.to).toBe(version);
      // Global pass ALSO fired, carried in the new `global` field
      expect(r.global?.refreshed).toBe(true);
      expect(r.global?.from).toBe('0.0.1-old');
      expect(r.global?.to).toBe(version);
      // Global hook-handler was actually rewritten (not just the stamp)
      const refreshedGlobal = readFileSync(join(globalHelpers, 'hook-handler.cjs'), 'utf-8');
      expect(refreshedGlobal).toMatch(/toolFailed/);
      expect(refreshedGlobal).not.toContain('// OLD global');
    } finally {
      if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
      if (savedUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedUserProfile;
    }
  });

  it('alsoRefreshGlobal defaults to false — tests without the flag never touch $HOME (invariant that keeps every OTHER test in this file safe)', async () => {
    const { cwd, helpersDir } = makeProject();
    writeFileSync(join(helpersDir, 'hook-handler.cjs'), 'intelligence.feedback(true);\n');
    writeFileSync(join(helpersDir, HELPERS_STAMP_FILE), '0.0.1-old');

    // Redirect HOME to an empty scratch dir with no .claude/helpers. If the
    // global pass fired despite the flag being unset, this test would either
    // create files under fakeHome (assertion below catches it) or surface a
    // `global` field on the result (also checked).
    const fakeHome = mkdtempSync(join(tmpdir(), 'helper-refresh-should-not-touch-home-'));
    const savedHome = process.env.HOME;
    const savedUserProfile = process.env.USERPROFILE;
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    try {
      const { sourceDir, pubkeyPem } = makeSignedSource(version);
      const r = await autoRefreshHelpersIfStale(cwd, { sourceDirOverride: sourceDir, pubkeyPemOverride: pubkeyPem });
      expect(r.refreshed).toBe(true); // project pass still fired
      expect(r.global).toBeUndefined(); // global pass DID NOT fire
      expect(existsSync(join(fakeHome, '.claude'))).toBe(false); // never scaffolded under HOME
    } finally {
      if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
      if (savedUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedUserProfile;
    }
  });

  it('never downgrades — an EQUAL-but-differently-formatted stamp is a no-op', async () => {
    // e.g. stamp has a build/prerelease suffix that string-compares unequal
    // to the installed version but is semver-equal or newer.
    const { cwd, helpersDir } = makeProject();
    const marker = 'SAME-VERSION-DIFFERENT-STRING';
    writeFileSync(join(helpersDir, 'hook-handler.cjs'), marker);
    writeFileSync(join(helpersDir, HELPERS_STAMP_FILE), `${version}+build.1`);

    const r = await autoRefreshHelpersIfStale(cwd);
    expect(r.refreshed).toBe(false);
    expect(readFileSync(join(helpersDir, 'hook-handler.cjs'), 'utf-8')).toBe(marker);
  });
});
