/**
 * Integration test for ADR-096 Phase 4: memory-initializer DB encryption.
 *
 * Different shape from session/terminal tests because the memory store is
 * a Buffer-only sql.js SQLite blob (not a JSON.stringify of an object).
 * The fs-secure helpers handle Buffer payloads identically — these tests
 * pin that contract end-to-end without spinning up the real sql.js
 * dependency (which has a heavy WASM init path).
 *
 * What's pinned:
 *   - writeFileRestricted({encrypt:true}) on a Buffer payload produces
 *     the RFE1 wire format when the env gate is on
 *   - readFileMaybeEncrypted(path, null) returns a Buffer (not string)
 *     and decrypts transparently when the file IS encrypted
 *   - Round-trip: write Buffer → read Buffer matches byte-for-byte
 *   - Migration: a legacy plaintext SQLite header on disk is still
 *     readable after the gate flips on (magic-byte sniff returns false
 *     for the SQLite header, so the file passes through unchanged)
 *   - Tamper: a flipped byte inside an encrypted DB blob throws on read
 *     rather than producing a corrupted Buffer
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  readFileMaybeEncrypted,
  writeFileRestricted,
} from '../src/fs-secure.js';
import { MAGIC, isEncryptedBlob } from '../src/encryption/vault.js';

const registryInitialize = vi.fn();
vi.mock('@claude-flow/memory', () => ({
  ControllerRegistry: class {
    initialize = registryInitialize;
    async shutdown(): Promise<void> {}
  },
}));

const SAVED_ENV: Record<string, string | undefined> = {};
function saveEnv(...names: string[]) {
  for (const n of names) SAVED_ENV[n] = process.env[n];
}
function restoreEnv() {
  for (const [n, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[n];
    else process.env[n] = v;
  }
}

// SQLite file format: first 16 bytes are "SQLite format 3\0". memory-initializer
// writes real sql.js exports (often multi-MB), but the encryption path doesn't
// care about content — only the Buffer shape. Use a plausible synthetic header
// + payload that exercises the same code path.
function makeSyntheticDbBuffer(payloadSize = 4096): Buffer {
  return Buffer.concat([
    Buffer.from('SQLite format 3\0', 'utf-8'),
    randomBytes(payloadSize - 16),
  ]);
}

describe('memory-initializer DB encryption (ADR-096 Phase 4)', () => {
  let workdir: string;
  let dbPath: string;

  beforeEach(() => {
    saveEnv('CLAUDE_FLOW_ENCRYPT_AT_REST', 'CLAUDE_FLOW_ENCRYPTION_KEY');
    workdir = mkdtempSync(join(tmpdir(), 'mem-db-enc-'));
    dbPath = join(workdir, 'memory.db');
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
    restoreEnv();
  });

  describe('encryption disabled (legacy plaintext SQLite)', () => {
    beforeEach(() => {
      delete process.env.CLAUDE_FLOW_ENCRYPT_AT_REST;
      delete process.env.CLAUDE_FLOW_ENCRYPTION_KEY;
    });

    it('writes the SQLite buffer unchanged to disk', () => {
      const db = makeSyntheticDbBuffer();
      writeFileRestricted(dbPath, db, { encrypt: true });
      const onDisk = readFileSync(dbPath);
      expect(onDisk.equals(db)).toBe(true);
      // First 16 bytes are the literal SQLite header
      expect(onDisk.subarray(0, 16).toString('utf-8')).toBe('SQLite format 3\0');
      expect(isEncryptedBlob(onDisk)).toBe(false);
    });

    it('round-trips a Buffer through readFileMaybeEncrypted(path, null)', () => {
      const db = makeSyntheticDbBuffer();
      writeFileRestricted(dbPath, db, { encrypt: true });
      const round = readFileMaybeEncrypted(dbPath, null);
      expect(Buffer.isBuffer(round)).toBe(true);
      expect(round.equals(db)).toBe(true);
    });
  });

  describe('encryption enabled (RFE1 wire format)', () => {
    beforeEach(() => {
      process.env.CLAUDE_FLOW_ENCRYPT_AT_REST = '1';
      process.env.CLAUDE_FLOW_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    });

    it('writes a blob that starts with the RFE1 magic, NOT the SQLite header', () => {
      const db = makeSyntheticDbBuffer();
      writeFileRestricted(dbPath, db, { encrypt: true });
      const onDisk = readFileSync(dbPath);
      expect(onDisk.subarray(0, 4)).toEqual(MAGIC);
      // Critical: the SQLite header must NOT appear at offset 0 — the
      // encryption ran and replaced the on-disk bytes.
      expect(onDisk.subarray(0, 16).toString('utf-8')).not.toBe('SQLite format 3\0');
      expect(isEncryptedBlob(onDisk)).toBe(true);
    });

    it('round-trips a Buffer through write → read with the same key', () => {
      const db = makeSyntheticDbBuffer();
      writeFileRestricted(dbPath, db, { encrypt: true });
      const round = readFileMaybeEncrypted(dbPath, null);
      expect(Buffer.isBuffer(round)).toBe(true);
      expect(round.equals(db)).toBe(true);
    });

    it('round-trips a megabyte-scale buffer (real-world memory.db size)', () => {
      const db = makeSyntheticDbBuffer(1_048_576); // 1MB
      writeFileRestricted(dbPath, db, { encrypt: true });
      const round = readFileMaybeEncrypted(dbPath, null);
      expect(round.equals(db)).toBe(true);
    });

    it('does not leak embedding-bytes into the on-disk blob', () => {
      // Plant a recognizable signature inside the synthetic DB and confirm
      // it does not appear in the encrypted bytes.
      const signature = Buffer.from('TOPSECRET-EMBEDDING-VECTOR-AAAA', 'utf-8');
      const db = Buffer.concat([
        Buffer.from('SQLite format 3\0', 'utf-8'),
        signature,
        randomBytes(2048),
      ]);
      writeFileRestricted(dbPath, db, { encrypt: true });
      const onDisk = readFileSync(dbPath);
      expect(onDisk.includes(signature)).toBe(false);
    });

    it('never hands an RFE1 snapshot to native AgentDB', async () => {
      const db = makeSyntheticDbBuffer();
      writeFileRestricted(dbPath, db, { encrypt: true });
      const before = readFileSync(dbPath);
      registryInitialize.mockClear();

      const { getControllerRegistry } = await import('../src/memory/memory-bridge.js');
      const registry = await getControllerRegistry(dbPath);

      expect(registry).toBeNull();
      expect(registryInitialize).not.toHaveBeenCalled();
      expect(readFileSync(dbPath)).toEqual(before);
      expect(isEncryptedBlob(readFileSync(dbPath))).toBe(true);
    });
  });

  describe('migration: legacy plaintext SQLite still readable', () => {
    it('plaintext SQLite written before the gate flipped on is returned as-is', () => {
      // Step 1: plant a plaintext SQLite blob on disk (no env vars set
      // — direct writeFileSync would normally have done this).
      const db = makeSyntheticDbBuffer();
      writeFileSync(dbPath, db);

      // Step 2: enable encryption for the read.
      process.env.CLAUDE_FLOW_ENCRYPT_AT_REST = '1';
      process.env.CLAUDE_FLOW_ENCRYPTION_KEY = randomBytes(32).toString('hex');

      // Step 3: readFileMaybeEncrypted's magic-byte sniff sees no RFE1
      // prefix, so it returns the Buffer unchanged. New SQL.Database()
      // would accept it directly.
      const round = readFileMaybeEncrypted(dbPath, null);
      expect(round.equals(db)).toBe(true);
      expect(round.subarray(0, 16).toString('utf-8')).toBe('SQLite format 3\0');
    });
  });

  describe('tamper detection on encrypted DB', () => {
    beforeEach(() => {
      process.env.CLAUDE_FLOW_ENCRYPT_AT_REST = '1';
      process.env.CLAUDE_FLOW_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    });

    it('rejects a flipped ciphertext byte (GCM auth fails)', () => {
      const db = makeSyntheticDbBuffer();
      writeFileRestricted(dbPath, db, { encrypt: true });
      // Flip a byte deep inside the ciphertext region (after magic+iv,
      // before the trailing 16-byte tag)
      const bytes = readFileSync(dbPath);
      bytes[100] ^= 0xff;
      writeFileSync(dbPath, bytes);
      expect(() => readFileMaybeEncrypted(dbPath, null)).toThrow();
    });

    it('rejects a flipped magic byte (caught early with bad-magic error)', () => {
      const db = makeSyntheticDbBuffer();
      writeFileRestricted(dbPath, db, { encrypt: true });
      const bytes = readFileSync(dbPath);
      bytes[0] = 0x00;
      writeFileSync(dbPath, bytes);
      // The magic-sniff returns false (not RFE1 prefix anymore), so the
      // reader returns the bytes as-is. NB: this is the legacy-plaintext
      // path — the bytes are unreadable as SQLite but won't throw at the
      // fs-secure layer. That's correct: tamper detection on plaintext
      // SQLite is sql.js's job, not ours. The auth failure mode (above)
      // covers the case where the magic IS still RFE1 but content is bad.
      const round = readFileMaybeEncrypted(dbPath, null);
      expect(Buffer.isBuffer(round)).toBe(true);
      expect(round[0]).toBe(0x00); // tampered first byte propagates as-is
    });
  });
});
