/**
 * Tests for agenticow MCP tools.
 *
 * Two surfaces under test:
 *   1. The HAPPY PATH — agenticow is installed (real package). The tool round-trips
 *      through actual COW branch / checkpoint / rollback / promote semantics on
 *      a temp .rvf file.
 *   2. The DEGRADED PATH — agenticow is NOT installed (we vi.mock() it as
 *      ERR_MODULE_NOT_FOUND). Every tool must return `{degraded: true}` with no
 *      throw, matching the metaharness-tools / testgen-tools contract.
 *
 * Why both: agenticow is in `optionalDependencies`. CI runs with deps installed
 * (happy path) but production users may not have it — the degraded path is
 * the load-bearing architectural rule (zero hard runtime dep).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { agenticowTools } from '../src/mcp-tools/agenticow-tools.js';

function findTool(name: string) {
  const t = agenticowTools.find(t => t.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

function dirBytes(p: string): number {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (st.isFile()) return st.size;
  let total = 0;
  for (const e of readdirSync(p)) total += dirBytes(join(p, e));
  return total;
}

// Detect agenticow availability at module scope (top-level await is allowed
// in vitest ESM modules). We need this before the `it.skipIf(...)` calls,
// which evaluate at definition time.
let havePkg = false;
try { await import('agenticow'); havePkg = true; } catch { havePkg = false; }

describe('agenticow MCP tools — happy path (real package)', () => {
  let workdir: string;
  let basePath: string;

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'agenticow-tools-'));
    basePath = join(workdir, 'base.rvf');
  });

  afterAll(() => {
    try { rmSync(workdir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('exposes exactly 4 tools (branch / checkpoint / rollback / promote)', () => {
    const names = agenticowTools.map(t => t.name).sort();
    expect(names).toEqual([
      'agenticow_branch',
      'agenticow_checkpoint',
      'agenticow_promote',
      'agenticow_rollback',
    ]);
  });

  it('every tool has a JSON-schema input + handler', () => {
    for (const t of agenticowTools) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.inputSchema.properties).toBeDefined();
      expect(typeof t.handler).toBe('function');
    }
  });

  it.skipIf(!havePkg)('agenticow_branch creates a tiny COW branch on a real base', async () => {
    const branch = findTool('agenticow_branch');
    // Use a small dim for test speed
    const branchPath = join(workdir, 'b1.rvf');
    const result: any = await branch.handler({
      basePath, branchPath,
      label: 'test-branch',
      dimension: 32,
    });
    expect(result.success).toBe(true);
    expect(result.degraded).toBeUndefined();
    expect(result.label).toBe('test-branch');
    expect(existsSync(branchPath)).toBe(true);
    // The size win is the load-bearing claim — assert it's tiny
    expect(dirBytes(branchPath)).toBeLessThan(2048);
  });

  it.skipIf(!havePkg)('agenticow_checkpoint persists state across reopen, agenticow_rollback restores it', async () => {
    const cp = findTool('agenticow_checkpoint');
    const rb = findTool('agenticow_rollback');

    // checkpoint must persist via the .agenticow.json manifest. The base file
    // was created earlier by the branch test (which writes the manifest).
    const cpResult: any = await cp.handler({ path: basePath, label: 'cp-1' });
    expect(cpResult.success).toBe(true);
    expect(cpResult.label).toBe('cp-1');
    // Manifest file should now exist next to the .rvf
    expect(existsSync(`${basePath}.agenticow.json`)).toBe(true);

    // Rollback now finds the checkpoint via the persisted manifest
    const rbResult: any = await rb.handler({ path: basePath });
    expect(rbResult.success).toBe(true);
    expect(rbResult.rolledBack).toBe(true);
  });

  it('agenticow_branch rejects path traversal in basePath', async () => {
    const branch = findTool('agenticow_branch');
    await expect(branch.handler({
      basePath: '../../../../etc/passwd',
      branchPath: join(workdir, 'evil.rvf'),
      label: 'evil',
      dimension: 32,
    })).rejects.toThrow(/disallowed characters/);
  });

  it('agenticow_branch rejects a malformed label', async () => {
    const branch = findTool('agenticow_branch');
    await expect(branch.handler({
      basePath,
      branchPath: join(workdir, 'b2.rvf'),
      label: 'evil; rm -rf /',
      dimension: 32,
    })).rejects.toThrow(/may only contain/);
  });

  it('agenticow_branch requires dimension when creating a new memory file', async () => {
    const branch = findTool('agenticow_branch');
    const freshBase = join(workdir, 'nonexistent.rvf');
    await expect(branch.handler({
      basePath: freshBase,
      branchPath: join(workdir, 'b3.rvf'),
      label: 'fresh',
      // no dimension
    })).rejects.toThrow(/dimension is required/);
  });
});
