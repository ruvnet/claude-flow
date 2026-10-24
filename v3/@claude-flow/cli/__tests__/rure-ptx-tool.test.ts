import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

vi.mock('@claude-flow/aidefence', () => ({ createAIDefence: () => ({
  quickScan: (text: string) => ({ threat: text.includes('evil_marker'), confidence: 0.99 }),
  hasPII: () => false,
}) }));
const { rureTools } = await import('../src/mcp-tools/rure-tools.js');
const tool = rureTools.find(t => t.name === 'rure_decompile_ptx')!;
const dirs: string[] = [];
function input(bytes: string | Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'ptx-mcp-'));
  dirs.push(dir);
  const path = join(dir, 'test.ptx');
  writeFileSync(path, bytes);
  return path;
}
async function run(path: string): Promise<any> {
  const result: any = await tool.handler({ path });
  return JSON.parse(result.content[0].text);
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const ptx = '.version 8.0\n.target sm_80\n.address_size 64\n.visible .entry test() { ret; }';
describe('PTX MCP boundary', () => {
  it('reads original bytes and preserves their digest', async () => {
    const result = await run(input(ptx));
    expect(result.success).toBe(true);
    expect(result.sourceSha256).toBe(createHash('sha256').update(ptx).digest('hex'));
    expect(result.functions).toHaveLength(1);
    expect(result.screened).toBe(true);
    expect(result.presentationModified).toBe(false);
  });
  it('refuses oversized and malformed UTF-8 input', async () => {
    expect((await run(input('a'.repeat(262145)))).success).toBe(false);
    expect((await run(input(Buffer.from([0xff, 0xfe, 0x80])))).success).toBe(false);
  });
  it('binds a BOM-bearing file to its exact bytes', async () => {
    const bytes = Buffer.from('\ufeff' + ptx);
    const result = await run(input(bytes));
    expect(result.sourceSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
  it('refuses traversal and directories', async () => {
    expect((await run('../../etc/passwd')).success).toBe(false);
    const path = input(ptx);
    expect((await run(join(path, '..'))).success).toBe(false);
  });
  it('screens attacker-derived names and declares modification', async () => {
    const result = await run(input(ptx.replace('test()', 'evil_marker()')));
    expect(result.success).toBe(true);
    expect(JSON.stringify(result)).not.toContain('evil_marker');
    expect(result.presentationModified).toBe(true);
    expect(result.redactedCount).toBeGreaterThan(0);
  });
  it('preserves prototype-like labels and screens label keys', async () => {
    const proto = await run(input(ptx.replace('ret;', '__proto__: ret;')));
    expect(Object.hasOwn(proto.functions[0].labels, '__proto__')).toBe(true);
    const flagged = await run(input(ptx.replace('ret;', 'evil_marker: ret;')));
    expect(flagged.success).toBe(true);
    expect(JSON.stringify(flagged)).not.toContain('evil_marker');
    expect(flagged.presentationModified).toBe(true);
  });
  it('refuses screening collisions instead of silently losing labels', async () => {
    const result = await run(input(ptx.replace('ret;', 'evil_marker_1: mov.u32 %r, 1; evil_marker_2: ret;')));
    expect(result.success).toBe(false);
    expect(result.error).toContain('distinct identifiers');
  });
});
