/**
 * Proven-configuration propagation to existing installs (ADR-177).
 * Adoption is doubly-gated (authenticity + suitability), fail-closed, additive.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPairSync } from 'node:crypto';
import { adoptSignedConfig, PROVEN_CONFIG_STAMP, ADOPTED_CONFIG_FILE } from '../src/config/proven-config-refresh.js';
import { signProvenConfig, type ProvenConfigManifest, type InstallEnv } from '../src/config/proven-config.js';

const kp = generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

function manifest(over: Partial<ProvenConfigManifest> = {}): ProvenConfigManifest {
  return {
    schema: 'ruflo.proven-config/v1',
    policy: { ref: 'sha256:' + 'a'.repeat(64) },
    platform: ['linux', 'macOS'],
    compatibility: { ruflo: '>=3.24.0' },
    rollback: { previousManifest: 'sha256:' + 'z'.repeat(64) },
    ...over,
  };
}
const env: InstallEnv = { platform: 'darwin', versions: { ruflo: '3.24.0' } };

function project(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'pcfg-'));
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  return cwd;
}

describe('adoptSignedConfig (ADR-177 propagation)', () => {
  it('adopts an authentic + suitable champion, records it, advances the stamp', () => {
    const cwd = project();
    const signed = signProvenConfig(manifest(), kp.privateKey);
    const r = adoptSignedConfig(cwd, signed, env, { pubkeyPem: kp.publicKey });
    expect(r.adopted).toBe(true);
    expect(readFileSync(join(cwd, '.claude', PROVEN_CONFIG_STAMP), 'utf-8').trim()).toBe(signed.manifest.policy.ref);
    const rec = JSON.parse(readFileSync(join(cwd, '.claude', ADOPTED_CONFIG_FILE), 'utf-8'));
    expect(rec.championId).toBe(signed.manifest.policy.ref);
    expect(rec.previous).toBe('sha256:' + 'z'.repeat(64)); // rollback pointer retained
  });

  it('REFUSES a bad signature (authenticity gate) and does not stamp', () => {
    const cwd = project();
    const other = generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    const r = adoptSignedConfig(cwd, signProvenConfig(manifest(), other.privateKey), env, { pubkeyPem: kp.publicKey });
    expect(r.adopted).toBe(false);
    expect(existsSync(join(cwd, '.claude', PROVEN_CONFIG_STAMP))).toBe(false);
  });

  it('SAFE-SKIPS a signed-but-unsuitable champion (backwards-compat version gate)', () => {
    const cwd = project();
    const signed = signProvenConfig(manifest({ compatibility: { ruflo: '>=9.9.9' } }), kp.privateKey);
    const r = adoptSignedConfig(cwd, signed, env, { pubkeyPem: kp.publicKey });
    expect(r.adopted).toBe(false);
    expect(r.skipped).toMatch(/not suitable/);
    expect(existsSync(join(cwd, '.claude', PROVEN_CONFIG_STAMP))).toBe(false); // never advanced
  });

  it('is a fast no-op when the stamp already matches (idempotent)', () => {
    const cwd = project();
    const signed = signProvenConfig(manifest(), kp.privateKey);
    writeFileSync(join(cwd, '.claude', PROVEN_CONFIG_STAMP), signed.manifest.policy.ref);
    const r = adoptSignedConfig(cwd, signed, env, { pubkeyPem: kp.publicKey });
    expect(r.adopted).toBe(false);
    expect(r.skipped).toBeUndefined();
  });

  it('is a no-op outside a ruflo project (no .claude)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'not-ruflo-'));
    const r = adoptSignedConfig(cwd, signProvenConfig(manifest(), kp.privateKey), env, { pubkeyPem: kp.publicKey });
    expect(r.adopted).toBe(false);
  });
});
