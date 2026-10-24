/**
 * GGUF inference engine tests.
 *
 * Uses Vitest (collected by the v3 root vitest config).
 * Run: cd v3 && npx vitest run __tests__/appliance/gguf-engine.test.ts
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  parseGgufHeader,
  GgufEngine,
  type GgufMetadata,
} from '../../@claude-flow/cli/src/appliance/gguf-engine.js';

// ---------------------------------------------------------------------------
// GGUF Binary Helpers
// ---------------------------------------------------------------------------

const GGUF_MAGIC_LE = 0x46554747; // "GGUF" in little-endian

/**
 * Write a GGUF string field: [length u64 LE][utf-8 bytes].
 */
function ggufString(str: string): Buffer {
  const strBuf = Buffer.from(str, 'utf-8');
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigUInt64LE(BigInt(strBuf.length), 0);
  return Buffer.concat([lenBuf, strBuf]);
}

/**
 * Write a GGUF KV entry: [key_string][value_type u32 LE][value_data].
 * Supports STRING (type 8) and UINT32 (type 4) values.
 */
function ggufKvString(key: string, value: string): Buffer {
  const keyBuf = ggufString(key);
  const typeBuf = Buffer.alloc(4);
  typeBuf.writeUInt32LE(8, 0); // STRING type
  const valueBuf = ggufString(value);
  return Buffer.concat([keyBuf, typeBuf, valueBuf]);
}

function ggufKvUint32(key: string, value: number): Buffer {
  const keyBuf = ggufString(key);
  const typeBuf = Buffer.alloc(4);
  typeBuf.writeUInt32LE(4, 0); // UINT32 type
  const valueBuf = Buffer.alloc(4);
  valueBuf.writeUInt32LE(value, 0);
  return Buffer.concat([keyBuf, typeBuf, valueBuf]);
}

/**
 * Build a minimal valid GGUF v3 binary buffer with the given KV pairs.
 */
function buildGgufBuffer(options?: {
  version?: number;
  tensorCount?: number;
  kvEntries?: Buffer[];
}): Buffer {
  const version = options?.version ?? 3;
  const tensorCount = options?.tensorCount ?? 0;
  const kvEntries = options?.kvEntries ?? [
    ggufKvString('general.architecture', 'llama'),
    ggufKvString('general.name', 'test-model'),
  ];

  const magicBuf = Buffer.alloc(4);
  magicBuf.writeUInt32LE(GGUF_MAGIC_LE, 0);

  const versionBuf = Buffer.alloc(4);
  versionBuf.writeUInt32LE(version, 0);

  const tensorCountBuf = Buffer.alloc(8);
  tensorCountBuf.writeBigUInt64LE(BigInt(tensorCount), 0);

  const kvCountBuf = Buffer.alloc(8);
  kvCountBuf.writeBigUInt64LE(BigInt(kvEntries.length), 0);

  return Buffer.concat([
    magicBuf,
    versionBuf,
    tensorCountBuf,
    kvCountBuf,
    ...kvEntries,
  ]);
}

// ---------------------------------------------------------------------------
// Temp file management
// ---------------------------------------------------------------------------

const cleanupPaths: string[] = [];

function tmpPath(suffix: string): string {
  const p = join(
    tmpdir(),
    `gguf-test-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`,
  );
  cleanupPaths.push(p);
  return p;
}

function writeGgufFile(buf: Buffer): string {
  const p = tmpPath('.gguf');
  writeFileSync(p, buf);
  return p;
}

afterEach(() => {
  for (const p of cleanupPaths) {
    try { unlinkSync(p); } catch { /* ignore */ }
  }
  cleanupPaths.length = 0;
});

// ---------------------------------------------------------------------------
// 1. GGUF header parsing
// ---------------------------------------------------------------------------

describe('parseGgufHeader', () => {
  it('parses a minimal GGUF v3 file with string KV entries', async () => {
    const buf = buildGgufBuffer();
    const filePath = writeGgufFile(buf);

    const meta = await parseGgufHeader(filePath);

    expect(meta.magic).toBe('GGUF');
    expect(meta.version).toBe(3);
    expect(meta.tensorCount).toBe(0);
    expect(meta.kvCount).toBe(2);
    expect(meta.architecture).toBe('llama');
    expect(meta.name).toBe('test-model');
  });

  it('supports GGUF version 2', async () => {
    const buf = buildGgufBuffer({ version: 2 });
    const filePath = writeGgufFile(buf);

    const meta = await parseGgufHeader(filePath);
    expect(meta.version).toBe(2);
    expect(meta.architecture).toBe('llama');
  });

  it('supports GGUF version 3', async () => {
    const buf = buildGgufBuffer({ version: 3 });
    const filePath = writeGgufFile(buf);

    const meta = await parseGgufHeader(filePath);
    expect(meta.version).toBe(3);
  });

  it('parses tensor count correctly', async () => {
    const buf = buildGgufBuffer({ tensorCount: 42 });
    const filePath = writeGgufFile(buf);

    const meta = await parseGgufHeader(filePath);
    expect(meta.tensorCount).toBe(42);
  });

  it('parses integer KV entries (context_length, embedding_length)', async () => {
    const kvEntries = [
      ggufKvString('general.architecture', 'llama'),
      ggufKvString('general.name', 'test-model'),
      ggufKvUint32('llama.context_length', 4096),
      ggufKvUint32('llama.embedding_length', 2048),
    ];
    const buf = buildGgufBuffer({ kvEntries });
    const filePath = writeGgufFile(buf);

    const meta = await parseGgufHeader(filePath);
    expect(meta.contextLength).toBe(4096);
    expect(meta.embeddingLength).toBe(2048);
  });

  it('rejects a file with invalid magic bytes', async () => {
    const buf = Buffer.alloc(64);
    buf.writeUInt32LE(0xDEADBEEF, 0); // wrong magic
    buf.writeUInt32LE(3, 4); // version
    const filePath = writeGgufFile(buf);

    await expect(parseGgufHeader(filePath)).rejects.toThrow(/Invalid GGUF magic/);
  });

  it('rejects unsupported GGUF version (version 1)', async () => {
    const buf = buildGgufBuffer({ version: 1 });
    const filePath = writeGgufFile(buf);

    await expect(parseGgufHeader(filePath)).rejects.toThrow(/Unsupported GGUF version/);
  });

  it('rejects unsupported GGUF version (version 99)', async () => {
    const buf = buildGgufBuffer({ version: 99 });
    const filePath = writeGgufFile(buf);

    await expect(parseGgufHeader(filePath)).rejects.toThrow(/Unsupported GGUF version/);
  });

  it('handles a truncated buffer gracefully (partial KV data)', async () => {
    // Build a valid header but truncate partway through KV entries
    const fullBuf = buildGgufBuffer({
      kvEntries: [
        ggufKvString('general.architecture', 'llama'),
        ggufKvString('general.name', 'test-model'),
      ],
    });
    // Truncate the buffer to cut off the second KV entry
    const truncatedLen = 24 + 30; // preamble + first KV, partial second
    const truncated = fullBuf.subarray(0, Math.min(truncatedLen, fullBuf.length));
    const filePath = writeGgufFile(truncated);

    // Should not throw -- metadata is partially parsed
    const meta = await parseGgufHeader(filePath);
    expect(meta.magic).toBe('GGUF');
    expect(meta.version).toBe(3);
    expect(meta.kvCount).toBe(2);
  });

  it('reports fileSize correctly', async () => {
    const buf = buildGgufBuffer();
    const filePath = writeGgufFile(buf);

    const meta = await parseGgufHeader(filePath);
    expect(meta.fileSize).toBe(buf.length);
  });

  it('stores all parsed metadata in the metadata map', async () => {
    const buf = buildGgufBuffer();
    const filePath = writeGgufFile(buf);

    const meta = await parseGgufHeader(filePath);
    expect(meta.metadata['general.architecture']).toBe('llama');
    expect(meta.metadata['general.name']).toBe('test-model');
  });
});

// ---------------------------------------------------------------------------
// 2. GgufEngine lifecycle
// ---------------------------------------------------------------------------

describe('GgufEngine', () => {
  let engine: GgufEngine;

  beforeEach(() => {
    engine = new GgufEngine({
      contextSize: 2048,
      maxTokens: 256,
      temperature: 0.5,
      verbose: false,
    });
  });

  afterEach(async () => {
    await engine.shutdown();
  });

  it('constructs with provided config', () => {
    expect(engine).toBeTruthy();
  });

  it('initialize succeeds even without node-llama-cpp', async () => {
    await engine.initialize();
    // Should not throw -- degrades gracefully
  });

  it('loadModel parses GGUF header from a test file', async () => {
    await engine.initialize();

    const buf = buildGgufBuffer({
      kvEntries: [
        ggufKvString('general.architecture', 'llama'),
        ggufKvString('general.name', 'engine-test-model'),
      ],
    });
    const filePath = writeGgufFile(buf);

    const meta = await engine.loadModel(filePath);
    expect(meta.architecture).toBe('llama');
    expect(meta.name).toBe('engine-test-model');
  });

  it('getLoadedModels returns models after loadModel', async () => {
    await engine.initialize();

    const buf = buildGgufBuffer();
    const filePath = writeGgufFile(buf);

    await engine.loadModel(filePath);
    const models = engine.getLoadedModels();
    expect(models.length).toBe(1);
    expect(models[0].architecture).toBe('llama');
  });

  it('shutdown clears loaded models', async () => {
    await engine.initialize();

    const buf = buildGgufBuffer();
    const filePath = writeGgufFile(buf);

    await engine.loadModel(filePath);
    expect(engine.getLoadedModels().length).toBe(1);

    await engine.shutdown();
    expect(engine.getLoadedModels().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Generate in metadata-only mode
// ---------------------------------------------------------------------------

describe('GgufEngine.generate (metadata-only)', () => {
  it('returns a metadata-only response when node-llama-cpp is unavailable', async () => {
    const engine = new GgufEngine({ verbose: false });
    await engine.initialize();

    const buf = buildGgufBuffer({
      kvEntries: [
        ggufKvString('general.architecture', 'llama'),
        ggufKvString('general.name', 'fallback-model'),
      ],
    });
    const filePath = writeGgufFile(buf);
    await engine.loadModel(filePath);

    const response = await engine.generate({ prompt: 'Hello world' });
    expect(response.metadataOnly).toBe(true);
    expect(response.text.includes('metadata-only')).toBeTruthy();
    expect(response.text.includes('fallback-model')).toBeTruthy();
    expect(response.tokensUsed).toBe(0);
    expect(response.latencyMs >= 0).toBeTruthy();

    await engine.shutdown();
  });

  it('returns a no-model placeholder when no model is loaded', async () => {
    const engine = new GgufEngine({ verbose: false });
    await engine.initialize();

    const response = await engine.generate({ prompt: 'Hello world' });
    expect(response.metadataOnly).toBe(true);
    expect(response.text.includes('No model loaded')).toBeTruthy();

    await engine.shutdown();
  });
});

// ---------------------------------------------------------------------------
// 4. KV cache persistence (RVKV format)
// ---------------------------------------------------------------------------

describe('KV cache persistence', () => {
  it('writes and reads back KV cache entries (round-trip)', async () => {
    const engine = new GgufEngine({ verbose: false });
    await engine.initialize();

    // Load a model so there's an active model path
    const buf = buildGgufBuffer();
    const filePath = writeGgufFile(buf);
    await engine.loadModel(filePath);

    // Store some entries
    engine.setKvEntry('key-alpha', Buffer.from('value-alpha'));
    engine.setKvEntry('key-beta', Buffer.from('value-beta'));
    engine.setKvEntry('key-gamma', Buffer.from('value-gamma'));

    // Persist
    const cachePath = tmpPath('.rvkv');
    await engine.persistKvCache(cachePath);

    // Create a fresh engine and load the cache
    const engine2 = new GgufEngine({ verbose: false });
    await engine2.initialize();
    await engine2.loadKvCache(cachePath);

    expect(engine2.getKvEntry('key-alpha')).toStrictEqual(Buffer.from('value-alpha'));
    expect(engine2.getKvEntry('key-beta')).toStrictEqual(Buffer.from('value-beta'));
    expect(engine2.getKvEntry('key-gamma')).toStrictEqual(Buffer.from('value-gamma'));

    await engine.shutdown();
    await engine2.shutdown();
  });

  it('RVKV file starts with magic "RVKV" (0x564B5652 LE)', async () => {
    const engine = new GgufEngine({ verbose: false });
    await engine.initialize();
    const buf = buildGgufBuffer();
    await engine.loadModel(writeGgufFile(buf));

    engine.setKvEntry('test', Buffer.from('data'));

    const cachePath = tmpPath('.rvkv');
    await engine.persistKvCache(cachePath);

    const data = readFileSync(cachePath);
    expect(data.readUInt32LE(0), 'Magic should be RVKV').toBe(0x564B5652);
    expect(data.readUInt32LE(4), 'Version should be 1').toBe(1);

    await engine.shutdown();
  });

  it('loadKvCache rejects a file with invalid magic', async () => {
    const engine = new GgufEngine({ verbose: false });
    await engine.initialize();

    const badFile = tmpPath('.rvkv');
    const badBuf = Buffer.alloc(64);
    badBuf.writeUInt32LE(0xDEADBEEF, 0);
    writeFileSync(badFile, badBuf);

    await expect(engine.loadKvCache(badFile)).rejects.toThrow(/Invalid KV cache magic/);

    await engine.shutdown();
  });

  it('loadKvCache rejects a file that is too small', async () => {
    const engine = new GgufEngine({ verbose: false });
    await engine.initialize();

    const smallFile = tmpPath('.rvkv');
    writeFileSync(smallFile, Buffer.alloc(10));

    await expect(engine.loadKvCache(smallFile)).rejects.toThrow(/too small/);

    await engine.shutdown();
  });

  it('SHA256 footer is verified on loadKvCache', async () => {
    const engine = new GgufEngine({ verbose: false });
    await engine.initialize();
    const ggufBuf = buildGgufBuffer();
    await engine.loadModel(writeGgufFile(ggufBuf));

    engine.setKvEntry('important', Buffer.from('secret-data'));

    const cachePath = tmpPath('.rvkv');
    await engine.persistKvCache(cachePath);

    // Tamper with the SHA256 footer (last 32 bytes) to trigger hash mismatch
    const data = readFileSync(cachePath);
    const tampered = Buffer.from(data);
    // Flip a byte in the footer hash area (last 32 bytes)
    tampered[tampered.length - 1] ^= 0xFF;
    writeFileSync(cachePath, tampered);

    const engine2 = new GgufEngine({ verbose: false });
    await engine2.initialize();

    await expect(engine2.loadKvCache(cachePath)).rejects.toThrow(/hash mismatch/);

    await engine.shutdown();
    await engine2.shutdown();
  });

  it('handles empty KV cache (zero entries)', async () => {
    const engine = new GgufEngine({ verbose: false });
    await engine.initialize();
    const ggufBuf = buildGgufBuffer();
    await engine.loadModel(writeGgufFile(ggufBuf));

    // No entries set -- persist should still work
    const cachePath = tmpPath('.rvkv');
    await engine.persistKvCache(cachePath);

    const engine2 = new GgufEngine({ verbose: false });
    await engine2.initialize();
    await engine2.loadKvCache(cachePath);

    expect(engine2.getKvEntry('nonexistent')).toBe(undefined);

    await engine.shutdown();
    await engine2.shutdown();
  });
});

// ---------------------------------------------------------------------------
// 5. Stream
// ---------------------------------------------------------------------------

describe('GgufEngine.stream', () => {
  it('yields at least one token from the async iterator', async () => {
    const engine = new GgufEngine({ verbose: false });
    await engine.initialize();

    const ggufBuf = buildGgufBuffer({
      kvEntries: [
        ggufKvString('general.architecture', 'llama'),
        ggufKvString('general.name', 'stream-test'),
      ],
    });
    await engine.loadModel(writeGgufFile(ggufBuf));

    const tokens: string[] = [];
    for await (const token of engine.stream({ prompt: 'Hello' })) {
      tokens.push(token);
    }

    expect(tokens.length >= 1, 'Stream should yield at least one token').toBeTruthy();
    // In metadata-only mode, it yields the full metadata response as one chunk
    expect(tokens[0].includes('metadata-only')).toBeTruthy();

    await engine.shutdown();
  });

  it('yields the no-model fallback when no model is loaded', async () => {
    const engine = new GgufEngine({ verbose: false });
    await engine.initialize();

    const tokens: string[] = [];
    for await (const token of engine.stream({ prompt: 'Hello' })) {
      tokens.push(token);
    }

    expect(tokens.length >= 1).toBeTruthy();
    expect(tokens[0].includes('No model loaded')).toBeTruthy();

    await engine.shutdown();
  });
});
