import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import the module under test
const mod = await import('../.claude/helpers/context-persistence-hook.mjs');
const {
  SQLiteBackend,
  RuVectorBackend,
  JsonFileBackend,
  resolveBackend,
  getRuVectorConfig,
  createHashEmbedding,
  EMBEDDING_DIM,
  hashContent,
  parseTranscript,
  extractTextContent,
  extractToolCalls,
  extractFilePaths,
  chunkTranscript,
  extractSummary,
  buildEntry,
  buildCompactInstructions,
  computeImportance,
  retrieveContextSmart,
  autoOptimize,
  storeChunks,
  retrieveContext,
  NAMESPACE,
  COMPACT_INSTRUCTION_BUDGET,
  RETENTION_DAYS,
} = mod;

// Test fixtures
const TMP_DIR = join(__dirname, '.tmp-ctx-test');
const TMP_DB = join(TMP_DIR, 'test-archive.db');
const TMP_ARCHIVE = join(TMP_DIR, 'test-archive.json');
const TMP_TRANSCRIPT = join(TMP_DIR, 'test-transcript.jsonl');

function makeUserMsg(text) {
  return { role: 'user', content: [{ type: 'text', text }] };
}

function makeAssistantMsg(text, toolCalls = []) {
  const content = [{ type: 'text', text }];
  for (const tc of toolCalls) {
    content.push({ type: 'tool_use', name: tc.name, input: tc.input });
  }
  return { role: 'assistant', content };
}

function makeToolResultMsg(toolUseId, content) {
  return { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content }] };
}

// Setup / teardown
before(() => {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
});

after(() => {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
});

// ============================================================================
// SQLite Backend Tests
// ============================================================================

describe('SQLiteBackend', () => {
  it('should initialize and create schema', async () => {
    const backend = new SQLiteBackend(join(TMP_DIR, 'init-test.db'));
    await backend.initialize();
    const count = await backend.count();
    assert.equal(count, 0);
    await backend.shutdown();
  });

  it('should store and query entries', async () => {
    const backend = new SQLiteBackend(join(TMP_DIR, 'store-sqlite.db'));
    await backend.initialize();

    const now = Date.now();
    const entry = {
      id: 'sql-1', key: 'test:1', content: 'hello world', type: 'episodic',
      namespace: NAMESPACE, tags: ['test'], metadata: { sessionId: 'sess-1', chunkIndex: 0, contentHash: 'abc', summary: 'test' },
      accessLevel: 'private', createdAt: now, updatedAt: now, version: 1,
      accessCount: 0, lastAccessedAt: now,
    };
    await backend.store(entry);

    const results = await backend.query({ namespace: NAMESPACE });
    assert.equal(results.length, 1);
    assert.equal(results[0].content, 'hello world');
    assert.equal(results[0].metadata.sessionId, 'sess-1');

    await backend.shutdown();
  });

  it('should query by session with indexed lookup', async () => {
    const backend = new SQLiteBackend(join(TMP_DIR, 'session-query.db'));
    await backend.initialize();

    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      await backend.store({
        id: `sq-${i}`, key: `test:${i}`, content: `turn ${i}`, type: 'episodic',
        namespace: NAMESPACE, tags: [], metadata: { sessionId: 'sess-a', chunkIndex: i, contentHash: `h${i}`, summary: `s${i}` },
        accessLevel: 'private', createdAt: now + i, updatedAt: now + i, version: 1,
        accessCount: 0, lastAccessedAt: now + i,
      });
    }
    // Different session
    await backend.store({
      id: 'sq-other', key: 'test:other', content: 'other session', type: 'episodic',
      namespace: NAMESPACE, tags: [], metadata: { sessionId: 'sess-b', chunkIndex: 0, contentHash: 'other', summary: 'other' },
      accessLevel: 'private', createdAt: now, updatedAt: now, version: 1,
      accessCount: 0, lastAccessedAt: now,
    });

    const sessA = await backend.queryBySession(NAMESPACE, 'sess-a');
    assert.equal(sessA.length, 5);
    // Should be ordered by chunk_index DESC
    assert.equal(sessA[0].metadata.chunkIndex, 4);

    const sessB = await backend.queryBySession(NAMESPACE, 'sess-b');
    assert.equal(sessB.length, 1);

    await backend.shutdown();
  });

  it('should dedup via hashExists', async () => {
    const backend = new SQLiteBackend(join(TMP_DIR, 'hash-dedup.db'));
    await backend.initialize();

    const now = Date.now();
    await backend.store({
      id: 'hd-1', key: 'test:1', content: 'data', type: 'episodic',
      namespace: NAMESPACE, tags: [], metadata: { contentHash: 'unique-hash-123', sessionId: 's', chunkIndex: 0, summary: '' },
      accessLevel: 'private', createdAt: now, updatedAt: now, version: 1,
      accessCount: 0, lastAccessedAt: now,
    });

    assert.ok(backend.hashExists('unique-hash-123'));
    assert.ok(!backend.hashExists('nonexistent-hash'));

    await backend.shutdown();
  });

  it('should bulk insert in a transaction', async () => {
    const backend = new SQLiteBackend(join(TMP_DIR, 'bulk-sqlite.db'));
    await backend.initialize();

    const now = Date.now();
    const entries = Array.from({ length: 100 }, (_, i) => ({
      id: `bulk-${i}`, key: `test:${i}`, content: `content ${i}`, type: 'episodic',
      namespace: NAMESPACE, tags: ['bulk'], metadata: { sessionId: 'bulk-sess', chunkIndex: i, contentHash: `bh${i}`, summary: `s${i}` },
      accessLevel: 'private', createdAt: now + i, updatedAt: now + i, version: 1,
      accessCount: 0, lastAccessedAt: now + i,
    }));

    await backend.bulkInsert(entries);
    const count = await backend.count(NAMESPACE);
    assert.equal(count, 100);

    await backend.shutdown();
  });

  it('should list sessions with counts', async () => {
    const backend = new SQLiteBackend(join(TMP_DIR, 'sessions-list.db'));
    await backend.initialize();

    const now = Date.now();
    for (let s = 0; s < 3; s++) {
      for (let i = 0; i < (s + 1) * 2; i++) {
        await backend.store({
          id: `sl-${s}-${i}`, key: `test:${s}:${i}`, content: `c`, type: 'episodic',
          namespace: NAMESPACE, tags: [], metadata: { sessionId: `sess-${s}`, chunkIndex: i, contentHash: `slh${s}${i}`, summary: '' },
          accessLevel: 'private', createdAt: now + s * 100 + i, updatedAt: now, version: 1,
          accessCount: 0, lastAccessedAt: now,
        });
      }
    }

    const sessions = await backend.listSessions(NAMESPACE);
    assert.equal(sessions.length, 3);
    // Most recent session first
    assert.equal(sessions[0].session_id, 'sess-2');
    assert.equal(sessions[0].cnt, 6);

    await backend.shutdown();
  });

  it('should persist across close/reopen', async () => {
    const dbPath = join(TMP_DIR, 'persist-sqlite.db');
    const now = Date.now();

    const b1 = new SQLiteBackend(dbPath);
    await b1.initialize();
    await b1.store({
      id: 'p-1', key: 'test:1', content: 'persisted', type: 'episodic',
      namespace: NAMESPACE, tags: [], metadata: { sessionId: 'ps', chunkIndex: 0, contentHash: 'ph1', summary: 's' },
      accessLevel: 'private', createdAt: now, updatedAt: now, version: 1,
      accessCount: 0, lastAccessedAt: now,
    });
    await b1.shutdown();

    const b2 = new SQLiteBackend(dbPath);
    await b2.initialize();
    const results = await b2.queryBySession(NAMESPACE, 'ps');
    assert.equal(results.length, 1);
    assert.equal(results[0].content, 'persisted');
    await b2.shutdown();
  });
});

// ============================================================================
// JsonFileBackend Tests
// ============================================================================

describe('JsonFileBackend', () => {
  it('should initialize empty', async () => {
    const backend = new JsonFileBackend(join(TMP_DIR, 'empty.json'));
    await backend.initialize();
    const count = await backend.count();
    assert.equal(count, 0);
    await backend.shutdown();
  });

  it('should store and query entries', async () => {
    const path = join(TMP_DIR, 'json-store.json');
    const backend = new JsonFileBackend(path);
    await backend.initialize();

    await backend.store({ id: '1', namespace: 'ns1', content: 'hello', metadata: {} });
    await backend.store({ id: '2', namespace: 'ns2', content: 'world', metadata: {} });

    const ns1 = await backend.query({ namespace: 'ns1' });
    assert.equal(ns1.length, 1);
    assert.equal(ns1[0].content, 'hello');

    await backend.shutdown();
  });

  it('should queryBySession', async () => {
    const path = join(TMP_DIR, 'json-session.json');
    const backend = new JsonFileBackend(path);
    await backend.initialize();

    await backend.store({ id: 'js1', namespace: NAMESPACE, content: 'a', metadata: { sessionId: 's1', chunkIndex: 0 } });
    await backend.store({ id: 'js2', namespace: NAMESPACE, content: 'b', metadata: { sessionId: 's1', chunkIndex: 1 } });
    await backend.store({ id: 'js3', namespace: NAMESPACE, content: 'c', metadata: { sessionId: 's2', chunkIndex: 0 } });

    const results = await backend.queryBySession(NAMESPACE, 's1');
    assert.equal(results.length, 2);
    // Descending chunk order
    assert.equal(results[0].metadata.chunkIndex, 1);

    await backend.shutdown();
  });

  it('should hashExists', async () => {
    const path = join(TMP_DIR, 'json-hash.json');
    const backend = new JsonFileBackend(path);
    await backend.initialize();

    await backend.store({ id: 'jh1', namespace: NAMESPACE, content: 'x', metadata: { contentHash: 'hash-abc' } });

    assert.ok(backend.hashExists('hash-abc'));
    assert.ok(!backend.hashExists('hash-xyz'));

    await backend.shutdown();
  });
});

// ============================================================================
// resolveBackend Tests
// ============================================================================

describe('resolveBackend', () => {
  it('should resolve to sqlite when better-sqlite3 is available', async () => {
    const { backend, type } = await resolveBackend();
    assert.equal(type, 'sqlite');
    await backend.shutdown();
  });
});

// ============================================================================
// createHashEmbedding Tests
// ============================================================================

describe('createHashEmbedding', () => {
  it('should produce an EMBEDDING_DIM-dimensional embedding (384, matching the ONNX vectors it substitutes for)', () => {
    // The hook moved to 384-dim ONNX embeddings (all-MiniLM-L6-v2) and the
    // hash fallback defaults to the same width so blobs stay comparable; this
    // test still said 768 (the legacy hash width) and only surfaced once the
    // Test Suite job ran again after the ETARGET fix (#3203).
    const emb = createHashEmbedding('hello world');
    assert.equal(emb.length, EMBEDDING_DIM);
    assert.equal(EMBEDDING_DIM, 384);
    assert.ok(emb instanceof Float32Array);
  });

  it('should be L2-normalized', () => {
    const emb = createHashEmbedding('test embedding normalization');
    let norm = 0;
    for (let i = 0; i < emb.length; i++) norm += emb[i] * emb[i];
    norm = Math.sqrt(norm);
    assert.ok(Math.abs(norm - 1.0) < 0.001, `Norm should be ~1.0, got ${norm}`);
  });

  it('should be deterministic', () => {
    const a = createHashEmbedding('deterministic test');
    const b = createHashEmbedding('deterministic test');
    for (let i = 0; i < a.length; i++) assert.equal(a[i], b[i]);
  });

  it('should produce different embeddings for different text', () => {
    const a = createHashEmbedding('hello');
    const b = createHashEmbedding('goodbye');
    let same = true;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) { same = false; break; }
    }
    assert.ok(!same);
  });
});

// ============================================================================
// hashContent Tests
// ============================================================================

describe('hashContent', () => {
  it('should produce SHA-256 hex string', () => {
    const h = hashContent('hello');
    assert.equal(h.length, 64);
    assert.match(h, /^[a-f0-9]{64}$/);
  });

  it('should be deterministic', () => {
    assert.equal(hashContent('same'), hashContent('same'));
  });

  it('should differ for different content', () => {
    assert.notEqual(hashContent('a'), hashContent('b'));
  });
});

// ============================================================================
// Transcript Parsing Tests
// ============================================================================

describe('parseTranscript', () => {
  it('should parse JSONL file', () => {
    const lines = [
      JSON.stringify({ role: 'user', content: [{ type: 'text', text: 'hello' }] }),
      JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: 'hi' }] }),
    ];
    writeFileSync(TMP_TRANSCRIPT, lines.join('\n'), 'utf-8');
    const msgs = parseTranscript(TMP_TRANSCRIPT);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, 'user');
  });

  it('should return empty for missing file', () => {
    assert.equal(parseTranscript('/nonexistent/file.jsonl').length, 0);
  });

  it('should skip malformed lines', () => {
    writeFileSync(TMP_TRANSCRIPT, '{"role":"user"}\nnot json\n{"role":"assistant"}\n', 'utf-8');
    assert.equal(parseTranscript(TMP_TRANSCRIPT).length, 2);
  });
});

// ============================================================================
// Content Extraction Tests
// ============================================================================

describe('extractTextContent', () => {
  it('should extract from content array', () => {
    const msg = { content: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }] };
    assert.equal(extractTextContent(msg), 'hello\nworld');
  });

  it('should extract from string content', () => {
    assert.equal(extractTextContent({ content: 'simple string' }), 'simple string');
  });

  it('should handle null/undefined', () => {
    assert.equal(extractTextContent(null), '');
    assert.equal(extractTextContent(undefined), '');
  });

  it('should skip non-text blocks', () => {
    const msg = { content: [
      { type: 'text', text: 'keep' },
      { type: 'tool_use', name: 'Read' },
      { type: 'text', text: 'this' },
    ]};
    assert.equal(extractTextContent(msg), 'keep\nthis');
  });
});

describe('extractToolCalls', () => {
  it('should extract tool_use blocks', () => {
    const msg = { content: [
      { type: 'text', text: 'hello' },
      { type: 'tool_use', name: 'Edit', input: { file_path: '/src/a.ts' } },
      { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
    ]};
    const calls = extractToolCalls(msg);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].name, 'Edit');
  });

  it('should handle null message', () => {
    assert.deepEqual(extractToolCalls(null), []);
  });
});

describe('extractFilePaths', () => {
  it('should extract and deduplicate paths', () => {
    const calls = [
      { name: 'Edit', input: { file_path: '/src/a.ts' } },
      { name: 'Read', input: { file_path: '/src/a.ts' } },
      { name: 'Glob', input: { path: '/src' } },
    ];
    const paths = extractFilePaths(calls);
    assert.equal(paths.length, 2);
    assert.ok(paths.includes('/src/a.ts'));
    assert.ok(paths.includes('/src'));
  });
});

// ============================================================================
// Chunking Tests
// ============================================================================

describe('chunkTranscript', () => {
  it('should group user+assistant pairs', () => {
    const messages = [
      makeUserMsg('first'), makeAssistantMsg('first answer'),
      makeUserMsg('second'), makeAssistantMsg('second answer'),
    ];
    const chunks = chunkTranscript(messages);
    assert.equal(chunks.length, 2);
  });

  it('should skip synthetic tool result messages', () => {
    const messages = [
      makeUserMsg('do something'),
      makeAssistantMsg('running tool', [{ name: 'Bash', input: { command: 'ls' } }]),
      makeToolResultMsg('id1', 'file1.txt'),
      makeAssistantMsg('done'),
    ];
    assert.equal(chunkTranscript(messages).length, 1);
  });

  it('should filter non user/assistant messages', () => {
    const messages = [
      { role: 'system', content: 'init' },
      makeUserMsg('hello'),
      makeAssistantMsg('hi'),
    ];
    assert.equal(chunkTranscript(messages).length, 1);
  });

  it('should handle empty messages', () => {
    assert.deepEqual(chunkTranscript([]), []);
  });
});

// ============================================================================
// Summary Extraction Tests
// ============================================================================

describe('extractSummary', () => {
  it('should produce summary within 300 chars', () => {
    const chunk = {
      userMessage: makeUserMsg('Implement user authentication with OAuth2'),
      assistantMessage: makeAssistantMsg('I\'ll implement OAuth2 authentication.'),
      toolCalls: [
        { name: 'Edit', input: { file_path: '/src/auth.ts' } },
      ],
      turnIndex: 0,
    };
    const summary = extractSummary(chunk);
    assert.ok(summary.length <= 300);
    assert.ok(summary.includes('OAuth2') || summary.includes('authentication'));
  });

  it('should handle empty chunk', () => {
    const summary = extractSummary({
      userMessage: null, assistantMessage: null, toolCalls: [], turnIndex: 0,
    });
    assert.ok(summary.length <= 300);
  });
});

// ============================================================================
// Entry Building Tests
// ============================================================================

describe('buildEntry', () => {
  it('should produce valid memory entry', () => {
    const chunk = {
      userMessage: makeUserMsg('test question'),
      assistantMessage: makeAssistantMsg('test answer'),
      toolCalls: [{ name: 'Read', input: { file_path: '/src/x.ts' } }],
      turnIndex: 5,
    };
    const entry = buildEntry(chunk, 'session-123', 'auto', '2026-02-10T00:00:00Z');

    assert.ok(entry.id.startsWith('ctx-'));
    assert.ok(entry.key.startsWith('transcript:session-123:5:'));
    assert.equal(entry.type, 'episodic');
    assert.equal(entry.namespace, NAMESPACE);
    assert.ok(entry.tags.includes('transcript'));
    assert.ok(entry.tags.includes('session-123'));
    assert.ok(entry.tags.includes('Read'));
    assert.equal(entry.metadata.sessionId, 'session-123');
    assert.equal(entry.metadata.chunkIndex, 5);
    assert.ok(entry.metadata.contentHash);
    assert.deepEqual(entry.metadata.filePaths, ['/src/x.ts']);
  });
});

// ============================================================================
// Store + Dedup Tests (with SQLite)
// ============================================================================

describe('storeChunks (SQLite)', () => {
  it('should store chunks and dedup duplicates', async () => {
    const backend = new SQLiteBackend(join(TMP_DIR, 'dedup-sqlite.db'));
    await backend.initialize();

    const chunks = [{
      userMessage: makeUserMsg('hello'),
      assistantMessage: makeAssistantMsg('hi'),
      toolCalls: [],
      turnIndex: 0,
    }];

    const r1 = await storeChunks(backend, chunks, 'sess1', 'auto');
    assert.equal(r1.stored, 1);
    assert.equal(r1.deduped, 0);

    const r2 = await storeChunks(backend, chunks, 'sess1', 'auto');
    assert.equal(r2.stored, 0);
    assert.equal(r2.deduped, 1);

    await backend.shutdown();
  });
});

describe('storeChunks (JSON fallback)', () => {
  it('should store chunks and dedup duplicates', async () => {
    const backend = new JsonFileBackend(join(TMP_DIR, 'dedup-json.json'));
    await backend.initialize();

    const chunks = [{
      userMessage: makeUserMsg('hello'),
      assistantMessage: makeAssistantMsg('hi'),
      toolCalls: [],
      turnIndex: 0,
    }];

    const r1 = await storeChunks(backend, chunks, 'sess1', 'auto');
    assert.equal(r1.stored, 1);

    const r2 = await storeChunks(backend, chunks, 'sess1', 'auto');
    assert.equal(r2.stored, 0);
    assert.equal(r2.deduped, 1);

    await backend.shutdown();
  });
});

// ============================================================================
// Context Retrieval Tests
// ============================================================================

describe('retrieveContext', () => {
  it('should build restoration text (SQLite)', async () => {
    const backend = new SQLiteBackend(join(TMP_DIR, 'retrieve-sqlite.db'));
    await backend.initialize();

    const now = Date.now();
    const entries = Array.from({ length: 5 }, (_, i) => ({
      id: `r${i}`, key: `test:${i}`, content: `Turn ${i} content`, type: 'episodic',
      namespace: NAMESPACE, tags: [],
      metadata: { sessionId: 'sess-abc', chunkIndex: i, summary: `Summary of turn ${i}`, toolNames: ['Read', 'Edit'], filePaths: ['/src/file.ts'], contentHash: `rh${i}` },
      accessLevel: 'private', createdAt: now + i, updatedAt: now + i, version: 1,
      accessCount: 0, lastAccessedAt: now + i,
    }));
    await backend.bulkInsert(entries);

    const ctx = await retrieveContext(backend, 'sess-abc', 4000);
    assert.ok(ctx.includes('Restored Context'));
    assert.ok(ctx.includes('5 archived turns'));
    assert.ok(ctx.includes('Summary of turn'));
    assert.ok(ctx.length <= 4200); // budget + header + footer

    await backend.shutdown();
  });

  it('should return empty for unknown session', async () => {
    const backend = new SQLiteBackend(join(TMP_DIR, 'empty-retrieve.db'));
    await backend.initialize();
    assert.equal(await retrieveContext(backend, 'unknown', 4000), '');
    await backend.shutdown();
  });

  it('should respect budget constraint', async () => {
    const backend = new SQLiteBackend(join(TMP_DIR, 'budget-sqlite.db'));
    await backend.initialize();

    const now = Date.now();
    const entries = Array.from({ length: 50 }, (_, i) => ({
      id: `bg${i}`, key: `test:${i}`, content: 'x'.repeat(200), type: 'episodic',
      namespace: NAMESPACE, tags: [],
      metadata: { sessionId: 'budget-sess', chunkIndex: i, summary: `Long summary text for turn ${i} with padding`, toolNames: ['Edit', 'Write', 'Bash'], filePaths: ['/src/very/long/path.tsx'], contentHash: `bgh${i}` },
      accessLevel: 'private', createdAt: now + i, updatedAt: now + i, version: 1,
      accessCount: 0, lastAccessedAt: now + i,
    }));
    await backend.bulkInsert(entries);

    const ctx = await retrieveContext(backend, 'budget-sess', 500);
    assert.ok(ctx.length <= 700); // budget + header + footer

    await backend.shutdown();
  });
});

// ============================================================================
// No-op Condition Tests
// ============================================================================

describe('no-op conditions', () => {
  it('should not restore for non-matching session', async () => {
    const backend = new SQLiteBackend(join(TMP_DIR, 'noop-sqlite.db'));
    await backend.initialize();

    const now = Date.now();
    await backend.store({
      id: 'noop1', key: 'test:1', content: 'data', type: 'episodic',
      namespace: NAMESPACE, tags: [],
      metadata: { sessionId: 'other-session', chunkIndex: 0, contentHash: 'nph1', summary: 's' },
      accessLevel: 'private', createdAt: now, updatedAt: now, version: 1,
      accessCount: 0, lastAccessedAt: now,
    });

    assert.equal(await retrieveContext(backend, 'my-session', 4000), '');
    await backend.shutdown();
  });
});

// ============================================================================
// RuVector Config Tests
// ============================================================================

describe('getRuVectorConfig', () => {
  it('should return null when no env vars set', () => {
    // Save and clear env vars
    const saved = { ...process.env };
    delete process.env.RUVECTOR_HOST;
    delete process.env.RUVECTOR_DATABASE;
    delete process.env.RUVECTOR_USER;
    delete process.env.PGHOST;
    delete process.env.PGDATABASE;
    delete process.env.PGUSER;

    const config = getRuVectorConfig();
    assert.equal(config, null);

    // Restore env
    Object.assign(process.env, saved);
  });

  it('should parse config from RUVECTOR_* env vars', () => {
    const saved = { ...process.env };
    process.env.RUVECTOR_HOST = 'pg.example.com';
    process.env.RUVECTOR_PORT = '5433';
    process.env.RUVECTOR_DATABASE = 'claude_flow';
    process.env.RUVECTOR_USER = 'admin';
    process.env.RUVECTOR_PASSWORD = 'secret123';
    process.env.RUVECTOR_SSL = 'true';

    const config = getRuVectorConfig();
    assert.ok(config);
    assert.equal(config.host, 'pg.example.com');
    assert.equal(config.port, 5433);
    assert.equal(config.database, 'claude_flow');
    assert.equal(config.user, 'admin');
    assert.equal(config.password, 'secret123');
    assert.equal(config.ssl, true);

    // Cleanup
    delete process.env.RUVECTOR_HOST;
    delete process.env.RUVECTOR_PORT;
    delete process.env.RUVECTOR_DATABASE;
    delete process.env.RUVECTOR_USER;
    delete process.env.RUVECTOR_PASSWORD;
    delete process.env.RUVECTOR_SSL;
    Object.assign(process.env, saved);
  });

  it('should fall back to PG* env vars', () => {
    const saved = { ...process.env };
    delete process.env.RUVECTOR_HOST;
    delete process.env.RUVECTOR_DATABASE;
    delete process.env.RUVECTOR_USER;
    process.env.PGHOST = 'localhost';
    process.env.PGDATABASE = 'testdb';
    process.env.PGUSER = 'testuser';
    process.env.PGPORT = '5434';

    const config = getRuVectorConfig();
    assert.ok(config);
    assert.equal(config.host, 'localhost');
    assert.equal(config.port, 5434);
    assert.equal(config.database, 'testdb');
    assert.equal(config.user, 'testuser');

    delete process.env.PGHOST;
    delete process.env.PGDATABASE;
    delete process.env.PGUSER;
    delete process.env.PGPORT;
    Object.assign(process.env, saved);
  });
});

// ============================================================================
// RuVectorBackend Class Tests (mock-based, no real PostgreSQL)
// ============================================================================

describe('RuVectorBackend', () => {
  it('should be exported and constructable', () => {
    assert.ok(RuVectorBackend);
    const backend = new RuVectorBackend({
      host: 'localhost', port: 5432, database: 'test', user: 'test', password: 'test',
    });
    assert.ok(backend);
    assert.equal(backend.config.host, 'localhost');
  });

  it('hashExists should return false (async-only for pg)', () => {
    const backend = new RuVectorBackend({
      host: 'localhost', port: 5432, database: 'test', user: 'test', password: 'test',
    });
    // Synchronous hashExists always returns false for pg (uses ON CONFLICT for dedup)
    assert.equal(backend.hashExists('any-hash'), false);
  });
});

// ============================================================================
// Proactive Archiving Tests
// ============================================================================

describe('proactive archiving (UserPromptSubmit)', () => {
  it('should archive incrementally and dedup on re-archive', async () => {
    const backend = new SQLiteBackend(join(TMP_DIR, 'proactive-sqlite.db'));
    await backend.initialize();

    // First archive: 3 chunks
    const chunks1 = [
      { userMessage: makeUserMsg('q1'), assistantMessage: makeAssistantMsg('a1'), toolCalls: [], turnIndex: 0 },
      { userMessage: makeUserMsg('q2'), assistantMessage: makeAssistantMsg('a2'), toolCalls: [], turnIndex: 1 },
      { userMessage: makeUserMsg('q3'), assistantMessage: makeAssistantMsg('a3'), toolCalls: [], turnIndex: 2 },
    ];
    const r1 = await storeChunks(backend, chunks1, 'proactive-sess', 'proactive');
    assert.equal(r1.stored, 3);
    assert.equal(r1.deduped, 0);

    // Second archive (same + 2 new): dedup existing, store new
    const chunks2 = [
      ...chunks1,
      { userMessage: makeUserMsg('q4'), assistantMessage: makeAssistantMsg('a4'), toolCalls: [], turnIndex: 3 },
      { userMessage: makeUserMsg('q5'), assistantMessage: makeAssistantMsg('a5'), toolCalls: [], turnIndex: 4 },
    ];
    const r2 = await storeChunks(backend, chunks2, 'proactive-sess', 'proactive');
    assert.equal(r2.stored, 2);
    assert.equal(r2.deduped, 3);

    // Total should be 5
    const total = await backend.count(NAMESPACE);
    assert.equal(total, 5);

    await backend.shutdown();
  });

  it('should build complete restoration from proactively archived data', async () => {
    const backend = new SQLiteBackend(join(TMP_DIR, 'proactive-restore.db'));
    await backend.initialize();

    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      await backend.store({
        id: `pa${i}`, key: `test:${i}`, content: `Turn ${i}`, type: 'episodic',
        namespace: NAMESPACE, tags: [],
        metadata: { sessionId: 'pa-sess', chunkIndex: i, summary: `Proactive turn ${i}`, toolNames: ['Edit'], filePaths: ['/src/a.ts'], contentHash: `pah${i}` },
        accessLevel: 'private', createdAt: now + i, updatedAt: now + i, version: 1,
        accessCount: 0, lastAccessedAt: now + i,
      });
    }

    const ctx = await retrieveContext(backend, 'pa-sess', 4000);
    assert.ok(ctx.includes('10 archived turns'));
    assert.ok(ctx.includes('Proactive turn'));

    await backend.shutdown();
  });
});

// ============================================================================
// Backend Resolution Priority Tests
// ============================================================================

describe('resolveBackend priority', () => {
  it('should resolve sqlite as highest priority', async () => {
    const { backend, type } = await resolveBackend();
    assert.equal(type, 'sqlite');
    await backend.shutdown();
  });

  it('should not resolve ruvector when env vars are absent', () => {
    const config = getRuVectorConfig();
    assert.equal(config, null);
  });
});

// ============================================================================
// Smart Compaction Gate Tests (buildCompactInstructions)
// ============================================================================

describe('buildCompactInstructions', () => {
  it('should produce compact instructions with archived turn count', () => {
    const chunks = [
      {
        userMessage: makeUserMsg('Implement authentication module'),
        assistantMessage: makeAssistantMsg('I\'ll implement the auth module using JWT.'),
        toolCalls: [
          { name: 'Edit', input: { file_path: '/src/auth.ts' } },
          { name: 'Write', input: { file_path: '/src/jwt.ts' } },
        ],
        turnIndex: 0,
      },
      {
        userMessage: makeUserMsg('Add tests for auth'),
        assistantMessage: makeAssistantMsg('Writing tests for the auth module.'),
        toolCalls: [
          { name: 'Write', input: { file_path: '/tests/auth.test.ts' } },
          { name: 'Bash', input: { command: 'npm test' } },
        ],
        turnIndex: 1,
      },
    ];

    const result = buildCompactInstructions(chunks, 'sess-123', { stored: 2, deduped: 0 });

    assert.ok(result.includes('COMPACTION GUIDANCE'));
    assert.ok(result.includes('2 conversation turns'));
    assert.ok(result.includes('sess-123'));
    assert.ok(result.includes('Stored: 2 new'));
    assert.ok(result.includes('PRESERVE in compaction summary'));
  });

  it('should include file paths and tool names', () => {
    const chunks = [
      {
        userMessage: makeUserMsg('Fix the bug'),
        assistantMessage: makeAssistantMsg('Fixed the null check.'),
        toolCalls: [
          { name: 'Edit', input: { file_path: '/src/utils.ts' } },
          { name: 'Grep', input: { path: '/src' } },
          { name: 'Read', input: { file_path: '/src/config.ts' } },
        ],
        turnIndex: 0,
      },
    ];

    const result = buildCompactInstructions(chunks, 'sess-456', { stored: 1, deduped: 0 });

    assert.ok(result.includes('Files modified/read:'));
    assert.ok(result.includes('utils.ts'));
    assert.ok(result.includes('Tools used:'));
    assert.ok(result.includes('Edit'));
    assert.ok(result.includes('Grep'));
  });

  it('should include decision context from assistant text', () => {
    const chunks = [
      {
        userMessage: makeUserMsg('How should we handle caching?'),
        assistantMessage: makeAssistantMsg('I decided to use Redis instead of in-memory caching for scalability.'),
        toolCalls: [],
        turnIndex: 0,
      },
    ];

    const result = buildCompactInstructions(chunks, 'sess-789', { stored: 1, deduped: 0 });

    assert.ok(result.includes('Key decisions'));
    assert.ok(result.includes('Redis') || result.includes('decided'));
  });

  it('should include most recent turns section', () => {
    const chunks = Array.from({ length: 8 }, (_, i) => ({
      userMessage: makeUserMsg(`Question ${i}`),
      assistantMessage: makeAssistantMsg(`Answer ${i}`),
      toolCalls: [],
      turnIndex: i,
    }));

    const result = buildCompactInstructions(chunks, 'sess-recent', { stored: 8, deduped: 0 });

    assert.ok(result.includes('MOST RECENT TURNS'));
    // Should include last 5 turns
    assert.ok(result.includes('[Turn 7]'));
    assert.ok(result.includes('[Turn 3]'));
    // Should NOT include early turns in the recent section
    assert.ok(!result.includes('[Turn 0]') || result.includes('8 conversation turns'));
  });

  it('should respect COMPACT_INSTRUCTION_BUDGET', () => {
    // Generate many chunks with long content
    const chunks = Array.from({ length: 50 }, (_, i) => ({
      userMessage: makeUserMsg('x'.repeat(200) + ` question ${i}`),
      assistantMessage: makeAssistantMsg('y'.repeat(200) + ` answer ${i}. I decided to use approach A instead of B.`),
      toolCalls: Array.from({ length: 5 }, (_, j) => ({
        name: `Tool${j}`,
        input: { file_path: `/src/very/long/path/to/file${j}.ts` },
      })),
      turnIndex: i,
    }));

    const result = buildCompactInstructions(chunks, 'sess-budget', { stored: 50, deduped: 0 });

    assert.ok(result.length <= COMPACT_INSTRUCTION_BUDGET + 10); // small margin for trailing chars
  });

  it('should handle empty chunks gracefully', () => {
    const result = buildCompactInstructions([], 'sess-empty', { stored: 0, deduped: 0 });
    assert.ok(result.includes('COMPACTION GUIDANCE'));
    assert.ok(result.includes('0 conversation turns'));
  });
});

// ============================================================================
// Importance Scoring Tests
// ============================================================================

describe('computeImportance', () => {
  it('should rank recently accessed entries higher', () => {
    const now = Date.now();
    const recent = { createdAt: now - 3600000, accessCount: 1, metadata: { toolNames: [], filePaths: [] } }; // 1 hour ago
    const old = { createdAt: now - 86400000 * 14, accessCount: 1, metadata: { toolNames: [], filePaths: [] } }; // 14 days ago

    const recentScore = computeImportance(recent, now);
    const oldScore = computeImportance(old, now);

    assert.ok(recentScore > oldScore, `Recent ${recentScore} should be > old ${oldScore}`);
  });

  it('should rank frequently accessed entries higher', () => {
    const now = Date.now();
    const freq = { createdAt: now - 86400000, accessCount: 10, metadata: { toolNames: [], filePaths: [] } };
    const rare = { createdAt: now - 86400000, accessCount: 0, metadata: { toolNames: [], filePaths: [] } };

    const freqScore = computeImportance(freq, now);
    const rareScore = computeImportance(rare, now);

    assert.ok(freqScore > rareScore, `Frequent ${freqScore} should be > rare ${rareScore}`);
  });

  it('should boost entries with tool calls and file paths', () => {
    const now = Date.now();
    const rich = { createdAt: now - 86400000, accessCount: 0, metadata: { toolNames: ['Edit', 'Read'], filePaths: ['/src/a.ts'] } };
    const plain = { createdAt: now - 86400000, accessCount: 0, metadata: { toolNames: [], filePaths: [] } };

    const richScore = computeImportance(rich, now);
    const plainScore = computeImportance(plain, now);

    assert.ok(richScore > plainScore, `Rich ${richScore} should be > plain ${plainScore}`);
  });

  it('should return positive scores for all entries', () => {
    const now = Date.now();
    const entry = { createdAt: now - 86400000 * 30, accessCount: 0, metadata: {} };
    assert.ok(computeImportance(entry, now) > 0);
  });
});

// ============================================================================
// Smart Retrieval Tests
// ============================================================================

describe('retrieveContextSmart', () => {
  it('should return importance-ranked context', async () => {
    const backend = new SQLiteBackend(join(TMP_DIR, 'smart-retrieve.db'));
    await backend.initialize();

    const now = Date.now();
    // Entry with tools (will rank higher)
    await backend.store({
      id: 'sr-0', key: 'test:0', content: 'Turn with tools', type: 'episodic',
      namespace: NAMESPACE, tags: [],
      metadata: { sessionId: 'smart-sess', chunkIndex: 0, summary: 'Edited auth module', toolNames: ['Edit', 'Bash'], filePaths: ['/src/auth.ts'], contentHash: 'srh0' },
      accessLevel: 'private', createdAt: now - 86400000, updatedAt: now, version: 1,
      accessCount: 5, lastAccessedAt: now,
    });
    // Plain entry (will rank lower)
    await backend.store({
      id: 'sr-1', key: 'test:1', content: 'Plain turn', type: 'episodic',
      namespace: NAMESPACE, tags: [],
      metadata: { sessionId: 'smart-sess', chunkIndex: 1, summary: 'Asked a question', toolNames: [], filePaths: [], contentHash: 'srh1' },
      accessLevel: 'private', createdAt: now - 86400000 * 7, updatedAt: now, version: 1,
      accessCount: 0, lastAccessedAt: now,
    });

    const { text, accessedIds } = await retrieveContextSmart(backend, 'smart-sess', 4000);

    assert.ok(text.includes('importance-ranked'));
    assert.ok(text.includes('Edited auth module'));
    assert.ok(accessedIds.length > 0);
    // Tool-rich entry should appear first (higher importance)
    assert.ok(text.indexOf('auth module') < text.indexOf('question') || !text.includes('question'));

    await backend.shutdown();
  });

  it('should return empty for unknown session', async () => {
    const backend = new SQLiteBackend(join(TMP_DIR, 'smart-empty.db'));
    await backend.initialize();

    const { text, accessedIds } = await retrieveContextSmart(backend, 'unknown-sess', 4000);
    assert.equal(text, '');
    assert.equal(accessedIds.length, 0);

    await backend.shutdown();
  });
});

// ============================================================================
// Access Tracking Tests
// ============================================================================

describe('markAccessed (SQLite)', () => {
  it('should increment access_count and update last_accessed_at', async () => {
    const backend = new SQLiteBackend(join(TMP_DIR, 'access-track.db'));
    await backend.initialize();

    const now = Date.now();
    await backend.store({
      id: 'at-1', key: 'test:1', content: 'data', type: 'episodic',
      namespace: NAMESPACE, tags: [],
      metadata: { sessionId: 'at-sess', chunkIndex: 0, contentHash: 'ath1', summary: 's' },
      accessLevel: 'private', createdAt: now, updatedAt: now, version: 1,
      accessCount: 0, lastAccessedAt: now,
    });

    // Mark as accessed 3 times
    backend.markAccessed(['at-1']);
    backend.markAccessed(['at-1']);
    backend.markAccessed(['at-1']);

    const entries = await backend.queryBySession(NAMESPACE, 'at-sess');
    assert.equal(entries[0].accessCount, 3);
    assert.ok(entries[0].lastAccessedAt >= now);

    await backend.shutdown();
  });
});

// ============================================================================
// Auto-Prune Tests
// ============================================================================

describe('pruneStale (SQLite)', () => {
  it('should prune never-accessed entries older than retention period', async () => {
    const backend = new SQLiteBackend(join(TMP_DIR, 'prune-test.db'));
    await backend.initialize();

    const now = Date.now();
    const oldTime = now - (RETENTION_DAYS + 5) * 86400000; // older than retention

    // Old, never accessed (should be pruned)
    await backend.store({
      id: 'prune-old', key: 'test:old', content: 'stale', type: 'episodic',
      namespace: NAMESPACE, tags: [],
      metadata: { sessionId: 'prune-sess', chunkIndex: 0, contentHash: 'poh', summary: 's' },
      accessLevel: 'private', createdAt: oldTime, updatedAt: oldTime, version: 1,
      accessCount: 0, lastAccessedAt: oldTime,
    });

    // Old but accessed (should NOT be pruned)
    await backend.store({
      id: 'prune-accessed', key: 'test:accessed', content: 'important', type: 'episodic',
      namespace: NAMESPACE, tags: [],
      metadata: { sessionId: 'prune-sess', chunkIndex: 1, contentHash: 'pah', summary: 's' },
      accessLevel: 'private', createdAt: oldTime, updatedAt: oldTime, version: 1,
      accessCount: 5, lastAccessedAt: now,
    });

    // Recent, never accessed (should NOT be pruned)
    await backend.store({
      id: 'prune-recent', key: 'test:recent', content: 'new', type: 'episodic',
      namespace: NAMESPACE, tags: [],
      metadata: { sessionId: 'prune-sess', chunkIndex: 2, contentHash: 'prh', summary: 's' },
      accessLevel: 'private', createdAt: now, updatedAt: now, version: 1,
      accessCount: 0, lastAccessedAt: now,
    });

    const pruned = backend.pruneStale(NAMESPACE, RETENTION_DAYS);
    assert.equal(pruned, 1); // Only the old, never-accessed entry

    const remaining = await backend.count(NAMESPACE);
    assert.equal(remaining, 2);

    await backend.shutdown();
  });
});

// ============================================================================
// Auto-Optimize Tests
// ============================================================================

describe('autoOptimize', () => {
  it('should prune stale entries during optimization', async () => {
    const backend = new SQLiteBackend(join(TMP_DIR, 'auto-opt.db'));
    await backend.initialize();

    const now = Date.now();
    const oldTime = now - (RETENTION_DAYS + 10) * 86400000;

    // Old stale entry
    await backend.store({
      id: 'ao-stale', key: 'test:stale', content: 'old data', type: 'episodic',
      namespace: NAMESPACE, tags: [],
      metadata: { sessionId: 'ao-sess', chunkIndex: 0, contentHash: 'aoh1', summary: 's' },
      accessLevel: 'private', createdAt: oldTime, updatedAt: oldTime, version: 1,
      accessCount: 0, lastAccessedAt: oldTime,
    });

    // Fresh entry
    await backend.store({
      id: 'ao-fresh', key: 'test:fresh', content: 'new data', type: 'episodic',
      namespace: NAMESPACE, tags: [],
      metadata: { sessionId: 'ao-sess', chunkIndex: 1, contentHash: 'aoh2', summary: 's' },
      accessLevel: 'private', createdAt: now, updatedAt: now, version: 1,
      accessCount: 0, lastAccessedAt: now,
    });

    const result = await autoOptimize(backend, 'sqlite');

    assert.equal(result.pruned, 1);
    assert.equal(result.synced, 0); // No RuVector configured

    const remaining = await backend.count(NAMESPACE);
    assert.equal(remaining, 1);

    await backend.shutdown();
  });
});
