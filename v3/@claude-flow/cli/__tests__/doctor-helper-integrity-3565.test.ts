/**
 * #3565: `ruflo doctor` reports signed critical helpers whose on-disk content
 * no longer matches the signed manifest. Uses a throwaway-keypair-signed
 * fixture (same approach as helper-refresh.test.ts) so the result does not
 * depend on the state of this repo's own signed manifest.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';

import { checkHelperIntegrity } from '../src/commands/doctor.js';
import { canonicalManifestBytes, sha256Hex } from '../src/init/helper-signing.js';

const GENUINE = 'intelligence.feedback(true); // genuine, signed content\n';

function makeSignedSource(content = GENUINE): { sourceDir: string; pubkeyPem: string } {
  const sourceDir = mkdtempSync(join(tmpdir(), 'doctor-helpers-source-'));
  writeFileSync(join(sourceDir, 'hook-handler.cjs'), content);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const manifest = { version: '9.9.9', files: { 'hook-handler.cjs': sha256Hex(content) } };
  const signature = edSign(null, canonicalManifestBytes(manifest), privateKey).toString('base64');
  writeFileSync(join(sourceDir, 'helpers.manifest.json'), JSON.stringify({ manifest, signature, algorithm: 'ed25519' }));
  return { sourceDir, pubkeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

function makeInstall(hookHandler: string): { cwd: string; helpersDir: string; homeDir: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'doctor-helpers-project-'));
  const helpersDir = join(cwd, '.claude', 'helpers');
  mkdirSync(helpersDir, { recursive: true });
  writeFileSync(join(helpersDir, 'hook-handler.cjs'), hookHandler);
  const homeDir = mkdtempSync(join(tmpdir(), 'doctor-helpers-home-')); // empty: no global helpers
  return { cwd, helpersDir, homeDir };
}

describe('doctor checkHelperIntegrity (#3565)', () => {
  const savedEnv = process.env.RUFLO_HELPERS_LOCKED;
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.RUFLO_HELPERS_LOCKED;
    else process.env.RUFLO_HELPERS_LOCKED = savedEnv;
  });

  it('passes when installed helpers match the signed manifest', async () => {
    const { cwd, homeDir } = makeInstall(GENUINE);
    const { sourceDir, pubkeyPem } = makeSignedSource();
    const r = await checkHelperIntegrity({ cwd, homeDir, sourceDirOverride: sourceDir, pubkeyPemOverride: pubkeyPem });
    expect(r.status).toBe('pass');
  });

  it('fails and names the file when an installed helper was tampered with', async () => {
    const { cwd, helpersDir, homeDir } = makeInstall('require("child_process").execSync("true"); // TAMPERED\n');
    const { sourceDir, pubkeyPem } = makeSignedSource();
    const r = await checkHelperIntegrity({ cwd, homeDir, sourceDirOverride: sourceDir, pubkeyPemOverride: pubkeyPem });
    expect(r.status).toBe('fail');
    expect(r.message).toContain(helpersDir);
    expect(r.message).toContain('hook-handler.cjs');
  });

  it('checks the global ~/.claude/helpers dir too', async () => {
    const { cwd, homeDir } = makeInstall(GENUINE);
    const globalDir = join(homeDir, '.claude', 'helpers');
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, 'hook-handler.cjs'), 'TAMPERED GLOBAL\n');
    const { sourceDir, pubkeyPem } = makeSignedSource();
    const r = await checkHelperIntegrity({ cwd, homeDir, sourceDirOverride: sourceDir, pubkeyPemOverride: pubkeyPem });
    expect(r.status).toBe('fail');
    expect(r.message).toContain(globalDir);
  });

  it('downgrades a mismatch to warn when .LOCKED marks a deliberate local edit', async () => {
    const { cwd, helpersDir, homeDir } = makeInstall('HAND-EDITED\n');
    writeFileSync(join(helpersDir, '.LOCKED'), '');
    const { sourceDir, pubkeyPem } = makeSignedSource();
    const r = await checkHelperIntegrity({ cwd, homeDir, sourceDirOverride: sourceDir, pubkeyPemOverride: pubkeyPem });
    expect(r.status).toBe('warn');
    expect(r.message).toContain('hook-handler.cjs');
  });

  it('treats RUFLO_HELPERS_LOCKED like .LOCKED', async () => {
    process.env.RUFLO_HELPERS_LOCKED = '1';
    const { cwd, homeDir } = makeInstall('HAND-EDITED\n');
    const { sourceDir, pubkeyPem } = makeSignedSource();
    const r = await checkHelperIntegrity({ cwd, homeDir, sourceDirOverride: sourceDir, pubkeyPemOverride: pubkeyPem });
    expect(r.status).toBe('warn');
  });

  it('fails closed when the package manifest signature does not verify', async () => {
    const { cwd, homeDir } = makeInstall(GENUINE);
    const { sourceDir } = makeSignedSource();
    const { publicKey: wrongKey } = generateKeyPairSync('ed25519');
    const r = await checkHelperIntegrity({
      cwd, homeDir, sourceDirOverride: sourceDir,
      pubkeyPemOverride: wrongKey.export({ type: 'spki', format: 'pem' }).toString(),
    });
    expect(r.status).toBe('fail');
    expect(r.message).toMatch(/signature invalid|missing/);
  });

  it('warns instead of claiming a pass when the package helper source cannot be found', async () => {
    const { cwd, homeDir } = makeInstall(GENUINE);
    const r = await checkHelperIntegrity({ cwd, homeDir, sourceDirOverride: null });
    expect(r.status).toBe('warn');
  });

  it('passes with nothing to verify outside a ruflo project', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'doctor-helpers-empty-'));
    const homeDir = mkdtempSync(join(tmpdir(), 'doctor-helpers-home-'));
    const r = await checkHelperIntegrity({ cwd, homeDir, sourceDirOverride: null });
    expect(r.status).toBe('pass');
  });
});
