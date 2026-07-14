/**
 * ADR-321 — atomic write interaction contract (London-school, mocked fs).
 *
 * The cache must never expose a half-written file to a concurrent reader.
 * ADR-321 mandates write-to-temp-then-rename (rename is atomic within a
 * filesystem on both POSIX and Windows). Here we mock `fs` entirely and
 * assert the *interaction*: writeSnapshot writes to a unique `.tmp-*` path
 * FIRST, then renames that temp onto the real target — the target is never
 * written directly. Two writes must use two distinct temp paths (so they
 * can't clobber each other mid-write) and each renames onto the same target.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory fs, shared with the mock factory via vi.hoisted so it survives
// the mock hoist. Honors the `wx` exclusive-create flag and records call
// order so we can assert write-before-rename.
const mem = vi.hoisted(() => {
  interface Call {
    fn: string;
    path: string;
    dest?: string;
  }
  const files = new Map<string, string>();
  const calls: Call[] = [];
  const enoent = (p: string) => Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
  const eexist = (p: string) => Object.assign(new Error(`EEXIST: ${p}`), { code: 'EEXIST' });
  return { files, calls, enoent, eexist, reset: () => { files.clear(); calls.length = 0; } };
});

// IMPORTANT: preserve ALL real fs exports and override only the five the
// module-under-test touches. A non-preserving factory (returning just these
// five) leaks a crippled `fs` into any other module loaded in the same worker
// (e.g. worker-daemon.ts's readdirSync/existsSync), causing order-dependent
// "X is not defined" failures in the full-suite batch — a real determinism bug.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const readFileSync = (p: string) => {
    mem.calls.push({ fn: 'readFileSync', path: p });
    if (!mem.files.has(p)) throw mem.enoent(p);
    return mem.files.get(p)!;
  };
  const writeFileSync = (p: string, data: string, opts?: { flag?: string }) => {
    mem.calls.push({ fn: 'writeFileSync', path: p });
    if (opts && opts.flag === 'wx' && mem.files.has(p)) throw mem.eexist(p);
    mem.files.set(p, String(data));
  };
  const renameSync = (a: string, b: string) => {
    mem.calls.push({ fn: 'renameSync', path: a, dest: b });
    if (!mem.files.has(a)) throw mem.enoent(a);
    mem.files.set(b, mem.files.get(a)!);
    mem.files.delete(a);
  };
  const unlinkSync = (p: string) => {
    mem.calls.push({ fn: 'unlinkSync', path: p });
    if (!mem.files.has(p)) throw mem.enoent(p);
    mem.files.delete(p);
  };
  const mkdirSync = (p: string) => {
    mem.calls.push({ fn: 'mkdirSync', path: p });
  };
  const overrides = { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync };
  const actualDefault = (actual as unknown as { default?: object }).default ?? actual;
  return { ...actual, ...overrides, default: { ...actualDefault, ...overrides } };
});

// Imported AFTER vi.mock so the module binds to the mocked fs.
const { writeSnapshot } = await import('../src/session/foreground-snapshot.js');

const ROOT = '/proj';
const ID = 'sess-1';
const TARGET_SUFFIX = 'foreground-snapshot.json';

beforeEach(() => {
  mem.reset();
});

describe('ADR-321 write-to-temp-then-rename interaction', () => {
  it('writes a unique temp file first, then renames it onto the real target', () => {
    const ok = writeSnapshot(ID, ROOT, { sampledBy: 'hook:pre-tool-use' });
    expect(ok).toBe(true);

    const writeCall = mem.calls.find((c) => c.fn === 'writeFileSync');
    const renameCall = mem.calls.find((c) => c.fn === 'renameSync');
    expect(writeCall).toBeDefined();
    expect(renameCall).toBeDefined();

    // The write targets a temp path, never the real snapshot path directly.
    expect(writeCall!.path).toMatch(/foreground-snapshot\.json\.tmp-/);
    expect(writeCall!.path).not.toMatch(/foreground-snapshot\.json$/);

    // The rename lifts that exact temp onto the real target.
    expect(renameCall!.path).toBe(writeCall!.path);
    expect(renameCall!.dest!.endsWith(TARGET_SUFFIX)).toBe(true);

    // Ordering: the temp write happens strictly before the rename.
    const writeIdx = mem.calls.indexOf(writeCall!);
    const renameIdx = mem.calls.indexOf(renameCall!);
    expect(writeIdx).toBeLessThan(renameIdx);

    // Only the final target survives; the temp is gone.
    const survivors = [...mem.files.keys()].filter((k) => k.includes(TARGET_SUFFIX));
    expect(survivors.some((k) => k.endsWith(TARGET_SUFFIX))).toBe(true);
    expect(survivors.some((k) => k.includes('.tmp-'))).toBe(false);
  });

  it('uses distinct temp paths for two writes so concurrent writers cannot clobber each other', () => {
    writeSnapshot(ID, ROOT, { sampledBy: 'a' });
    writeSnapshot(ID, ROOT, { sampledBy: 'b' });

    const tmpWrites = mem.calls.filter((c) => c.fn === 'writeFileSync').map((c) => c.path);
    expect(tmpWrites).toHaveLength(2);
    expect(tmpWrites[0]).not.toBe(tmpWrites[1]);

    const renameDests = mem.calls.filter((c) => c.fn === 'renameSync').map((c) => c.dest);
    expect(renameDests).toHaveLength(2);
    expect(renameDests[0]).toBe(renameDests[1]); // both land on the same target
    expect(renameDests[0]!.endsWith(TARGET_SUFFIX)).toBe(true);
  });
});
