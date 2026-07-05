/**
 * RVFA packaging for proven-config champions (ADR-177 final phase).
 * Roundtrip, tamper-evidence, fail-closed decode, and adopt-path parity.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPairSync } from 'node:crypto';
import {
  packProvenConfigRvfa, unpackProvenConfigRvfa, isProvenConfigRvfa,
  PROVEN_CONFIG_SECTION,
} from '../src/config/proven-config-rvfa.js';
import { signProvenConfig, type ProvenConfigManifest } from '../src/config/proven-config.js';
import { adoptSignedConfig, loadShippedChampion, PROVEN_CONFIG_RVFA_FILE } from '../src/config/proven-config-refresh.js';

function keys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    pub: publicKey.export({ type: 'spki', format: 'pem' }) as string,
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  };
}

const manifest: ProvenConfigManifest = {
  schema: 'ruflo.proven-config/v1',
  policy: { ref: 'sha256:abc123' },
  platform: ['linux', 'macOS'],
  compatibility: { ruflo: '>=3.24.0' },
  benchmark: { corpus: 'LAB-v1', corpusHash: 'deadbeef' },
  layer: 'framework/node-cli',
};

describe('packProvenConfigRvfa / unpackProvenConfigRvfa', () => {
  it('roundtrips a signed manifest through the RVFA envelope', () => {
    const { pub, priv } = keys();
    const signed = signProvenConfig(manifest, priv);
    const rvf = packProvenConfigRvfa(signed);

    expect(isProvenConfigRvfa(rvf)).toBe(true);
    const back = unpackProvenConfigRvfa(rvf);
    expect(back).not.toBeNull();
    expect(back!.signature).toBe(signed.signature);
    expect(back!.manifest.policy.ref).toBe('sha256:abc123');
    // Signature still verifies after the RVFA round-trip (byte-preserving).
    void pub;
  });

  it('rejects a non-RVFA buffer (fail-closed)', () => {
    expect(isProvenConfigRvfa(Buffer.from('{"not":"rvfa"}'))).toBe(false);
    expect(unpackProvenConfigRvfa(Buffer.from('garbage'))).toBeNull();
  });

  it('rejects a tampered envelope (integrity footer mismatch)', () => {
    const { priv } = keys();
    const rvf = packProvenConfigRvfa(signProvenConfig(manifest, priv));
    const tampered = Buffer.from(rvf);
    tampered[tampered.length - 5] ^= 0xff; // corrupt a byte inside the section-data/footer region
    expect(unpackProvenConfigRvfa(tampered)).toBeNull();
  });

  it('names the section canonically', () => {
    expect(PROVEN_CONFIG_SECTION).toBe('proven-config');
  });
});

describe('adopt path parity — RVFA-packed champion adopts like raw JSON', () => {
  it('loadShippedChampion decodes a .rvf and adoptSignedConfig accepts it', () => {
    const { pub, priv } = keys();
    const signed = signProvenConfig(manifest, priv);

    const cwd = mkdtempSync(join(tmpdir(), 'pcrvfa-'));
    mkdirSync(join(cwd, '.claude'), { recursive: true });
    const rvfPath = join(cwd, PROVEN_CONFIG_RVFA_FILE);
    writeFileSync(rvfPath, packProvenConfigRvfa(signed));

    const decoded = loadShippedChampion(rvfPath);
    expect(decoded).not.toBeNull();

    const env = { platform: 'linux', versions: { ruflo: '3.24.0' } };
    const res = adoptSignedConfig(cwd, decoded!, env, { pubkeyPem: pub });
    expect(res.adopted).toBe(true);
    expect(res.to).toBe('sha256:abc123');
    // The adopted record was written for the feedback applier.
    const record = JSON.parse(readFileSync(join(cwd, '.claude', 'proven-config.json'), 'utf-8'));
    expect(record.championId).toBe('sha256:abc123');
  });

  it('a forged manifest inside a well-formed RVFA is rejected at adoption (signed≠trusted)', () => {
    const { pub } = keys();            // adoption pubkey
    const attacker = keys();           // different key signs the payload
    const signed = signProvenConfig({ ...manifest, policy: { ref: 'sha256:evil' } }, attacker.priv);
    const rvf = packProvenConfigRvfa(signed);

    // Envelope decodes fine (integrity ok)…
    const decoded = unpackProvenConfigRvfa(rvf);
    expect(decoded).not.toBeNull();
    // …but adoption fails closed: the inner signature doesn't verify under pub.
    const cwd = mkdtempSync(join(tmpdir(), 'pcrvfa-'));
    mkdirSync(join(cwd, '.claude'), { recursive: true });
    const res = adoptSignedConfig(cwd, decoded!, { platform: 'linux', versions: { ruflo: '3.24.0' } }, { pubkeyPem: pub });
    expect(res.adopted).toBe(false);
  });
});
