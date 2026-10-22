/**
 * #2889: getBridgeDb() must distinguish a legitimately RFE1-encrypted-at-rest
 * memory.db from genuine corruption/unavailability before attempting the
 * native better-sqlite3 open. The native open throws SQLITE_NOTADB on an
 * encrypted file, which the generic catch previously swallowed identically
 * to real corruption — nothing stopped a caller from concluding the store
 * was broken and running the destructive `memory init`, which creates a
 * fresh EMPTY store instead of using the existing encrypted data.
 *
 * Modeled on __tests__/graph-writer-shared-sqlite-3693.test.ts for the
 * mock-hermeticity helper (setSharedSqliteMock) — vitest applies a queued
 * doUnmock/doMock pair in resolve-completion order, not call order, so a
 * naive afterEach(doUnmock) can leave the previous test's mock active.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const req = createRequire(import.meta.url);
let RealBetterSqlite3: any;
let native = true;

beforeAll(() => {
  try {
    RealBetterSqlite3 = req('better-sqlite3');
    const probe = new RealBetterSqlite3(':memory:');
    probe.close();
  } catch {
    native = false;
  }
});

const SHARED_SQLITE = '../src/memory/shared-sqlite.js';
const GRAPH_EDGE_WRITER = '../src/memory/graph-edge-writer.js';

/** Same hermetic mock helper as the #3693 test — see that file's header
 * comment for why a plain doUnmock/doMock pair is not safe here. */
async function setSharedSqliteMock(factory?: () => unknown) {
  vi.resetModules();
  vi.doUnmock(SHARED_SQLITE);
  await import(SHARED_SQLITE);
  vi.resetModules();
  if (factory) vi.doMock(SHARED_SQLITE, factory as never);
}

/** Fresh graph-edge-writer module instance with loadBetterSqlite3 mocked to
 * a call-tracking wrapper around the real native constructor. */
async function freshGraphWriterWithSpy() {
  const loadSpy = vi.fn(async () => RealBetterSqlite3);
  await setSharedSqliteMock(() => ({ loadBetterSqlite3: loadSpy }));
  const gw = await import(GRAPH_EDGE_WRITER);
  return { gw, loadSpy };
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ruflo-2889-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await setSharedSqliteMock(); // clear any mock, drained, so the next test starts clean
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('#2889 graph-edge-writer RFE1 encryption guard', () => {
  it.skipIf(!native)('a genuinely RFE1-encrypted file returns null without attempting the native open, and warns once per dbPath (deduped across repeat calls on the same path)', async () => {
    const { encryptBuffer } = await import('../src/encryption/vault.js');
    const key = randomBytes(32);
    const blob = encryptBuffer(Buffer.from('irrelevant plaintext payload'), key);
    const dbPath = join(root, 'memory.db');
    writeFileSync(dbPath, blob);

    const { gw, loadSpy } = await freshGraphWriterWithSpy();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const first = await gw.getBridgeDb(dbPath);
    const second = await gw.getBridgeDb(dbPath);

    expect(first).toBeNull();
    expect(second).toBeNull();
    // The native constructor path (loadBetterSqlite3) must never even be
    // reached for a detected-encrypted file — the guard returns before it.
    expect(loadSpy).not.toHaveBeenCalled();

    const rfe1Warnings = errSpy.mock.calls.filter((call) =>
      String(call[0]).includes('encrypted at rest') && String(call[0]).includes('memory init'),
    );
    expect(rfe1Warnings).toHaveLength(1);
    expect(rfe1Warnings[0][0]).toContain('#2889');
    expect(rfe1Warnings[0][0]).toContain('Do NOT run `memory init`'); // explicitly warns against it, never recommends it
    expect(rfe1Warnings[0][0]).toContain('NOT lost or damaged');
  });

  it.skipIf(!native)('a genuinely corrupted (non-encrypted) file returns null WITHOUT the encrypted-store warning', async () => {
    const dbPath = join(root, 'memory.db');
    writeFileSync(dbPath, Buffer.from('this is not a sqlite database and not RFE1 either, just garbage bytes'));

    const { gw, loadSpy } = await freshGraphWriterWithSpy();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const db = await gw.getBridgeDb(dbPath);

    expect(db).toBeNull();
    // Unlike the encrypted case, a genuine corruption attempt DOES reach the
    // native constructor (and throws there, caught by the generic catch).
    expect(loadSpy).toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it.skipIf(!native)('a normal valid plaintext memory.db is unaffected by the new header sniff', async () => {
    const dbPath = join(root, 'memory.db');
    const seed = new RealBetterSqlite3(dbPath);
    seed.pragma('journal_mode = WAL');
    seed.close();

    const { gw, loadSpy } = await freshGraphWriterWithSpy();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const db = await gw.getBridgeDb(dbPath);

    expect(db).not.toBeNull();
    expect(loadSpy).toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
    // Regression check: graph_edges table is still created on the common path.
    const row = db.prepare(`SELECT COUNT(*) AS n FROM graph_edges`).get();
    expect(row.n).toBe(0);

    gw._resetBridgeDb();
  });

  it.skipIf(!native)('warns separately for TWO distinct encrypted dbPaths in the same process — dedup must be keyed by path, not a single global flag', async () => {
    const { encryptBuffer } = await import('../src/encryption/vault.js');
    const key = randomBytes(32);

    const pathA = join(root, 'a.db');
    const pathB = join(root, 'b.db');
    writeFileSync(pathA, encryptBuffer(Buffer.from('payload-a'), key));
    writeFileSync(pathB, encryptBuffer(Buffer.from('payload-b'), key));

    const { gw } = await freshGraphWriterWithSpy();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await gw.getBridgeDb(pathA)).toBeNull();
    expect(await gw.getBridgeDb(pathB)).toBeNull();
    // Repeat pathA — must NOT produce a second warning for the same path.
    expect(await gw.getBridgeDb(pathA)).toBeNull();

    const warningsFor = (p: string) => errSpy.mock.calls.filter((call) => String(call[0]).includes(p));
    expect(warningsFor(pathA)).toHaveLength(1);
    expect(warningsFor(pathB)).toHaveLength(1);
  });

  it.skipIf(!native)('isBridgeDbEncryptedAtRest distinguishes the encrypted case from plaintext/corrupt/missing', async () => {
    const { encryptBuffer } = await import('../src/encryption/vault.js');
    const key = randomBytes(32);

    const encPath = join(root, 'enc.db');
    writeFileSync(encPath, encryptBuffer(Buffer.from('payload'), key));

    const corruptPath = join(root, 'corrupt.db');
    writeFileSync(corruptPath, Buffer.from('garbage, not a db, not rfe1'));

    const plainPath = join(root, 'plain.db');
    const seed = new RealBetterSqlite3(plainPath);
    seed.close();

    const missingPath = join(root, 'does-not-exist.db');

    const { gw } = await freshGraphWriterWithSpy();

    expect(gw.isBridgeDbEncryptedAtRest(encPath)).toBe(true);
    expect(gw.isBridgeDbEncryptedAtRest(corruptPath)).toBe(false);
    expect(gw.isBridgeDbEncryptedAtRest(plainPath)).toBe(false);
    expect(gw.isBridgeDbEncryptedAtRest(missingPath)).toBe(false);
  });
});
