/**
 * RVFA Builder pipeline tests.
 *
 * Uses Vitest (collected by the v3 root vitest config).
 * Run: cd v3 && npx vitest run __tests__/appliance/rvfa-builder.test.ts
 */

import { describe, it, afterEach, expect } from 'vitest';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  RvfaBuilder,
  encryptApiKeys,
  decryptApiKeys,
} from '../../@claude-flow/cli/src/appliance/rvfa-builder.js';
import { RvfaReader } from '../../@claude-flow/cli/src/appliance/rvfa-format.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXPECTED_SECTION_IDS = ['kernel', 'runtime', 'ruflo', 'models', 'data', 'verify'];

/** Paths to clean up after each test. */
const cleanupPaths: string[] = [];

function tmpPath(suffix: string): string {
  const p = join(tmpdir(), `rvfa-test-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`);
  cleanupPaths.push(p);
  return p;
}

function writeEnvFile(content: string): string {
  const p = tmpPath('.env');
  writeFileSync(p, content, 'utf-8');
  return p;
}

function makeBuilder(profile: 'cloud' | 'hybrid' | 'offline' = 'cloud'): RvfaBuilder {
  return new RvfaBuilder({
    profile,
    arch: 'x86_64',
    output: tmpPath('.rvfa'),
    verbose: false,
  });
}

afterEach(() => {
  for (const p of cleanupPaths) {
    try { unlinkSync(p); } catch { /* ignore */ }
  }
  cleanupPaths.length = 0;
});

// ---------------------------------------------------------------------------
// Builder tests
// ---------------------------------------------------------------------------

describe('RvfaBuilder', () => {
  it('creates a valid RVFA for cloud profile', async () => {
    const builder = makeBuilder('cloud');
    const result = await builder.build();
    expect(result.size > 0).toBeTruthy();
    expect(result.profile).toBe('cloud');
    expect(existsSync(result.outputPath)).toBeTruthy();
  });

  it('creates a valid RVFA for hybrid profile', async () => {
    const builder = makeBuilder('hybrid');
    const result = await builder.build();
    expect(result.profile).toBe('hybrid');
    expect(result.size > 0).toBeTruthy();
  });

  it('creates a valid RVFA for offline profile', async () => {
    const builder = makeBuilder('offline');
    const result = await builder.build();
    expect(result.profile).toBe('offline');
    expect(result.size > 0).toBeTruthy();
  });

  it('output file is readable by RvfaReader', async () => {
    const builder = makeBuilder('cloud');
    const result = await builder.build();
    const buf = readFileSync(result.outputPath);
    const reader = RvfaReader.fromBuffer(buf);
    const header = reader.getHeader();
    expect(header.magic).toBe('RVFA');
    expect(header.profile).toBe('cloud');
  });

  it('all expected sections present in result', async () => {
    const builder = makeBuilder('cloud');
    const result = await builder.build();
    const sectionIds = result.sections.map((s) => s.id);
    for (const expected of EXPECTED_SECTION_IDS) {
      expect(sectionIds.includes(expected), `Missing section: ${expected}`).toBeTruthy();
    }
  });

  it('section checksums validate', async () => {
    const builder = makeBuilder('cloud');
    const result = await builder.build();
    const buf = readFileSync(result.outputPath);
    const reader = RvfaReader.fromBuffer(buf);
    const verification = reader.verify();
    expect(verification.valid, `Checksum errors: ${verification.errors.join(', ')}`).toBeTruthy();
  });

  it('duration is tracked', async () => {
    const builder = makeBuilder('cloud');
    const result = await builder.build();
    expect(typeof result.duration).toBe('number');
    expect(result.duration >= 0).toBeTruthy();
  });

  it('each section has originalSize > 0', async () => {
    const builder = makeBuilder('cloud');
    const result = await builder.build();
    for (const sec of result.sections) {
      expect(sec.originalSize > 0, `Section "${sec.id}" has zero originalSize`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Encryption tests
// ---------------------------------------------------------------------------

describe('encryptApiKeys / decryptApiKeys', () => {
  it('round-trips correctly', () => {
    const envPath = writeEnvFile('ANTHROPIC_API_KEY=sk-ant-xxx\nOPENAI_API_KEY=sk-yyy');
    const encrypted = encryptApiKeys(envPath, 'my-secret');
    const decrypted = decryptApiKeys(encrypted, 'my-secret');
    expect(decrypted['ANTHROPIC_API_KEY']).toBe('sk-ant-xxx');
    expect(decrypted['OPENAI_API_KEY']).toBe('sk-yyy');
  });

  it('decryption fails with wrong passphrase', () => {
    const envPath = writeEnvFile('API_KEY=secret123');
    const encrypted = encryptApiKeys(envPath, 'correct-pass');
    expect(() => decryptApiKeys(encrypted, 'wrong-pass')).toThrow(/Unsupported state|unable to authenticate|Invalid/i);
  });

  it('handles empty .env', () => {
    const envPath = writeEnvFile('');
    const encrypted = encryptApiKeys(envPath, 'pass');
    const decrypted = decryptApiKeys(encrypted, 'pass');
    expect(decrypted).toStrictEqual({});
  });

  it('handles multiline .env with comments and quoted values', () => {
    const envContent = [
      '# This is a comment',
      'KEY1=value1',
      'KEY2="quoted-value"',
      "KEY3='single-quoted'",
      '',
      'KEY4=multi=equals=signs',
    ].join('\n');

    const envPath = writeEnvFile(envContent);
    const encrypted = encryptApiKeys(envPath, 'pass123');
    const decrypted = decryptApiKeys(encrypted, 'pass123');
    expect(decrypted['KEY1']).toBe('value1');
    expect(decrypted['KEY2']).toBe('quoted-value');
    expect(decrypted['KEY3']).toBe('single-quoted');
    expect(decrypted['KEY4']).toBe('multi=equals=signs');
  });

  it('produces different ciphertext for same input (random salt/IV)', () => {
    const envPath = writeEnvFile('API_KEY=test');
    const enc1 = encryptApiKeys(envPath, 'pass');
    const enc2 = encryptApiKeys(envPath, 'pass');
    // Salt and IV are random, so ciphertext should differ
    expect(!enc1.equals(enc2)).toBeTruthy();
  });

  it('rejects truncated encrypted payload', () => {
    const envPath = writeEnvFile('API_KEY=secret');
    const encrypted = encryptApiKeys(envPath, 'pass');
    const truncated = encrypted.subarray(0, 10); // too short
    expect(() => decryptApiKeys(truncated, 'pass')).toThrow(/too short/i);
  });

  it('skips comment lines and empty lines', () => {
    const envContent = [
      '# comment',
      '',
      '  ',
      'REAL_KEY=real_value',
      '# another comment',
    ].join('\n');

    const envPath = writeEnvFile(envContent);
    const encrypted = encryptApiKeys(envPath, 'pass');
    const decrypted = decryptApiKeys(encrypted, 'pass');
    expect(Object.keys(decrypted).length).toBe(1);
    expect(decrypted['REAL_KEY']).toBe('real_value');
  });
});
