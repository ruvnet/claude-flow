import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bridgeStoreEntry, __setMemoryBridgeRegistryForTests } from '../src/memory/memory-bridge.js';

const root = mkdtempSync(join(tmpdir(), 'ruflo-structured-append-'));
const dbPath = join(root, 'memory.db');
const db = new Database(dbPath);
db.exec(`CREATE TABLE memory_entries (
  id TEXT PRIMARY KEY, key TEXT NOT NULL, namespace TEXT DEFAULT 'default', content TEXT NOT NULL,
  type TEXT, embedding TEXT, embedding_dimensions INTEGER, embedding_model TEXT, tags TEXT,
  metadata TEXT, provenance_type TEXT, created_at INTEGER, updated_at INTEGER, expires_at INTEGER,
  status TEXT DEFAULT 'active', UNIQUE(namespace,key));
  CREATE TABLE vector_indexes (id TEXT PRIMARY KEY, name TEXT UNIQUE, dimensions INTEGER,
  total_vectors INTEGER DEFAULT 0, updated_at INTEGER);
  INSERT INTO vector_indexes(id,name,dimensions,total_vectors) VALUES('fixture','fixture',384,1);
  INSERT INTO memory_entries(id,key,namespace,content,embedding,status)
  VALUES('vector','historical-vector','fixture','preserved','[1]','active');`);
const embed = vi.fn();
const sql: string[] = [];
const prepare = db.prepare.bind(db);
db.prepare = ((statement: string) => { sql.push(statement); return prepare(statement); }) as typeof db.prepare;
beforeEach(() => {
  sql.length = 0; embed.mockClear();
  __setMemoryBridgeRegistryForTests({ getAgentDB: () => ({ database: db, embedder: { embed } }), get: () => null });
});
afterAll(() => { __setMemoryBridgeRegistryForTests(null); db.close(); rmSync(root, { recursive: true, force: true }); });
const append = (key: string, value = 'exact redacted state') => bridgeStoreEntry({
  key, value, namespace: 'fixture', dbPath, generateEmbeddingFlag: false,
  requireNative: true, appendOnly: true, upsert: true, provenanceType: 'system_observation',
});

describe('native structured immutable append', () => {
  it('stores exact content and provenance without embedding or lifetime vector recount', async () => {
    const result = await append('new');
    expect(result?.success).toBe(true);
    expect(prepare('SELECT content,embedding,provenance_type FROM memory_entries WHERE key=?').get('new'))
      .toEqual({ content: 'exact redacted state', embedding: null, provenance_type: 'system_observation' });
    expect(embed).not.toHaveBeenCalled();
    expect(sql.some(s => /UPDATE vector_indexes SET[\s\S]*COUNT/.test(s))).toBe(false);
    expect(prepare('SELECT total_vectors FROM vector_indexes WHERE name=?').get('fixture')).toEqual({ total_vectors: 1 });
  });
  it('never overwrites an active or deleted key, even when upsert was also requested', async () => {
    expect((await append('new', 'overwrite'))?.success).not.toBe(true);
    expect(prepare('SELECT content FROM memory_entries WHERE key=?').get('new')).toEqual({ content: 'exact redacted state' });
    prepare("UPDATE memory_entries SET status='deleted' WHERE key=?").run('historical-vector');
    expect((await append('historical-vector', 'resurrection'))?.success).not.toBe(true);
    expect(prepare('SELECT content,status,embedding FROM memory_entries WHERE key=?').get('historical-vector'))
      .toEqual({ content: 'preserved', status: 'deleted', embedding: '[1]' });
  });
  it('refuses a WASM bridge before any write or embedding', async () => {
    __setMemoryBridgeRegistryForTests({ getAgentDB: () => ({ database: db, isWasm: true, embedder: { embed } }), get: () => null });
    const result = await append('wasm-refused');
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/non-native bridge/) });
    expect(prepare('SELECT 1 FROM memory_entries WHERE key=?').get('wasm-refused')).toBeUndefined();
    expect(embed).not.toHaveBeenCalled();
    expect(sql.some(s => /INSERT INTO memory_entries/.test(s))).toBe(false);
  });
});

import { createHash } from 'node:crypto';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const conditioned = (key: string, epochKey: string, epochValue: string) => bridgeStoreEntry({
  key, value: 'publication', namespace: 'fixture', dbPath, generateEmbeddingFlag: false,
  requireNative: true, appendOnly: true,
  appendConditions: [{ namespace: 'fixture', key: epochKey, sha256: sha(epochValue), latestPrefix: 'epoch-' }],
});
describe('native atomic publication authority', () => {
  it('checks exact authority bytes and the latest epoch in the insertion transaction', async () => {
    expect((await append('epoch-0001', 'first'))?.success).toBe(true);
    expect((await conditioned('published-0001', 'epoch-0001', 'first'))?.success).toBe(true);
    expect((await append('epoch-0002', 'second'))?.success).toBe(true);
    expect(await conditioned('stale-publication', 'epoch-0001', 'first'))
      .toMatchObject({ success: false, error: expect.stringMatching(/newer parent\/authority/) });
    expect(prepare('SELECT 1 FROM memory_entries WHERE key=?').get('stale-publication')).toBeUndefined();
    expect(await conditioned('wrong-body', 'epoch-0002', 'forged'))
      .toMatchObject({ success: false, error: expect.stringMatching(/bytes changed/) });
    expect(prepare('SELECT 1 FROM memory_entries WHERE key=?').get('wrong-body')).toBeUndefined();
  });
  it('cannot rewind authority by deleting its newest epoch', async () => {
    prepare("UPDATE memory_entries SET status='deleted' WHERE key=?").run('epoch-0002');
    expect((await conditioned('rewound-publication', 'epoch-0001', 'first'))?.success).toBe(false);
    expect((await conditioned('deleted-authority-publication', 'epoch-0002', 'second'))?.success).toBe(false);
  });
  it('refuses conditions without the native and immutable prerequisites', async () => {
    const result = await bridgeStoreEntry({ key: 'unsafe-condition', value: 'unsafe', namespace: 'fixture', dbPath,
      generateEmbeddingFlag: false, appendConditions: [{ namespace: 'fixture', key: 'epoch-0001', sha256: sha('first') }] });
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/requires native append-only/) });
  });
});

describe('transactional genesis and legacy membership', () => {
  it('allows one project-wide genesis slot and refuses a second migration identity', async () => {
    const conditions = [{ namespace: 'fixture', absent: true as const, latestPrefix: 'genesis-' }];
    const first = await bridgeStoreEntry({ key: 'genesis-0001', value: 'one', namespace: 'fixture', dbPath,
      generateEmbeddingFlag: false, requireNative: true, appendOnly: true, appendConditions: conditions });
    expect(first?.success).toBe(true);
    const second = await bridgeStoreEntry({ key: 'genesis-0002', value: 'two', namespace: 'fixture', dbPath,
      generateEmbeddingFlag: false, requireNative: true, appendOnly: true, appendConditions: conditions });
    expect(second).toMatchObject({ success: false, error: expect.stringMatching(/newer parent\/authority/) });
    expect(prepare('SELECT 1 FROM memory_entries WHERE key=?').get('genesis-0002')).toBeUndefined();
  });
  it('refuses publication when an unsequenced legacy writer changes covered membership', async () => {
    const keys = prepare("SELECT key FROM memory_entries WHERE namespace='fixture' AND (status='active' OR status IS NULL)")
      .all().map((row: any) => row.key).sort();
    expect((await append('unsequenced-addition'))?.success).toBe(true);
    const result = await bridgeStoreEntry({ key: 'legacy-race-publication', value: 'unsafe', namespace: 'fixture', dbPath,
      generateEmbeddingFlag: false, requireNative: true, appendOnly: true,
      appendConditions: [{ namespace: 'fixture', count: keys.length, keysSha256: sha(JSON.stringify(keys)) }] });
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/membership changed/) });
    expect(prepare('SELECT 1 FROM memory_entries WHERE key=?').get('legacy-race-publication')).toBeUndefined();
  });
});

describe('withdrawn authority while an older writer is inflight', () => {
  it('rejects the old publication when its delayed work resumes after a newer epoch commits', async () => {
    expect((await append('inflight-epoch-0001', 'first'))?.success).toBe(true);
    let resume!: (vector: number[]) => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    embed.mockImplementationOnce(() => { entered(); return new Promise<number[]>(resolve => { resume = resolve; }); });
    const old = bridgeStoreEntry({ key: 'inflight-stale-publication', value: 'old', namespace: 'fixture', dbPath,
      generateEmbeddingFlag: true, requireNative: true, appendOnly: true,
      appendConditions: [{ namespace: 'fixture', key: 'inflight-epoch-0001', sha256: sha('first'), latestPrefix: 'inflight-epoch-' }] });
    await waiting;
    expect((await append('inflight-epoch-0002', 'second'))?.success).toBe(true);
    resume([1, 2, 3]);
    expect(await old).toMatchObject({ success: false, error: expect.stringMatching(/newer parent\/authority/) });
    expect(prepare('SELECT 1 FROM memory_entries WHERE key=?').get('inflight-stale-publication')).toBeUndefined();
  });
});

describe('durable backend and legacy logical-key invariants', () => {
  it('refuses a native in-memory or wrong-file handle before writing a record', async () => {
    const ephemeral = new Database(':memory:');
    __setMemoryBridgeRegistryForTests({ getAgentDB: () => ({ database: ephemeral, embedder: { embed } }), get: () => null });
    expect((await append('ephemeral'))?.success).toBe(false);
    expect(ephemeral.prepare("SELECT 1 FROM memory_entries WHERE key='ephemeral'").get()).toBeUndefined();
    ephemeral.close();
    const otherPath = join(root, 'different-file.db'); const other = new Database(otherPath);
    __setMemoryBridgeRegistryForTests({ getAgentDB: () => ({ database: other, embedder: { embed } }), get: () => null });
    expect((await append('wrong-file'))?.success).toBe(false);
    expect(other.prepare("SELECT 1 FROM memory_entries WHERE key='wrong-file'").get()).toBeUndefined();
    other.close();
  });
  it('rejects duplicate and tombstoned logical slots on a legacy table without a UNIQUE constraint', async () => {
    const legacyPath = join(root, 'legacy.db'); const legacy = new Database(legacyPath);
    // CTAS deliberately drops every UNIQUE/primary-key constraint while preserving the shape.
    legacy.exec(`ATTACH DATABASE '${dbPath.replaceAll("'", "''")}' AS original;
      CREATE TABLE memory_entries AS SELECT * FROM original.memory_entries;
      CREATE TABLE vector_indexes AS SELECT * FROM original.vector_indexes; DETACH DATABASE original;`);
    __setMemoryBridgeRegistryForTests({ getAgentDB: () => ({ database: legacy, embedder: { embed } }), get: () => null });
    const write = (key: string) => bridgeStoreEntry({ key, value: 'changed', namespace: 'fixture', dbPath: legacyPath,
      generateEmbeddingFlag: false, requireNative: true, appendOnly: true });
    expect((await write('new'))?.success).toBe(false);
    expect((await write('historical-vector'))?.success).toBe(false);
    expect(legacy.prepare("SELECT count(*) AS count FROM memory_entries WHERE key='new'").get()).toEqual({ count: 1 });
    expect((await write('new-legacy-slot'))?.success).toBe(true);
    expect((await write('new-legacy-slot'))?.success).toBe(false);
    legacy.close();
  });
});
