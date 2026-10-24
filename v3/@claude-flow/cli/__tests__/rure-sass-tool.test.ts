import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const screening = vi.hoisted(() => ({ flagKey: '' }));
vi.mock('@claude-flow/aidefence', () => ({ createAIDefence: () => ({
  quickScan: (text: string) => ({ threat: text.includes('evil_marker') || (screening.flagKey !== '' && text === screening.flagKey), confidence: 0.99 }),
  hasPII: () => false,
}) }));
const { rureTools } = await import('../src/mcp-tools/rure-tools.js');
const tool = rureTools.find(t => t.name === 'rure_recover_sass')!;
const fixtureRoot = new URL('../../../../plugins/ruflo-rure/scripts/baselines/culifter/crosspath-inputs/', import.meta.url);
const sass = readFileSync(new URL('copy32.sass', fixtureRoot), 'utf8');
const elf = readFileSync(new URL('copy32.elf', fixtureRoot), 'utf8');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const dirs: string[] = [];
function inputs(sassBytes: string | Buffer = sass, elfBytes: string | Buffer = elf) {
  const dir = mkdtempSync(join(tmpdir(), 'sass-mcp-'));
  dirs.push(dir);
  const sassPath = join(dir, 'input.sass'), elfPath = join(dir, 'input.elf');
  writeFileSync(sassPath, sassBytes); writeFileSync(elfPath, elfBytes);
  return { sassPath, elfPath };
}
async function run(input: Record<string, unknown>): Promise<any> {
  const result: any = await tool.handler(input);
  return JSON.parse(result.content[0].text);
}
afterEach(() => { screening.flagKey = ''; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('SASS MCP text boundary', () => {
  it('emits unproven CUDA from the actual development dumps without execution', async () => {
    const result = await run(inputs());
    expect(result).toMatchObject({ success: true, status: 'emitted', language: 'cuda-cpp', proofStatus: 'not-proven',
      sourceSha256: hash(sass), elfSha256: hash(elf), presentationModified: false, screened: true });
    expect(result.code).toContain('__global__');
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe('copy32');
    expect(result.assumptions.length).toBeGreaterThan(0);
  });
  it('withholds code when presentation screening changes a name', async () => {
    const result = await run(inputs(sass.replaceAll('copy32', 'evil_marker'), elf.replaceAll('copy32', 'evil_marker')));
    expect(result).toMatchObject({ success: true, status: 'unsupported', code: null, presentationModified: true });
    expect(JSON.stringify(result)).not.toContain('evil_marker');
  });
  it.each(['code', 'status'])('retains no executable source or emitted status after screening the %s key', async key => {
    screening.flagKey = key;
    const result = await run(inputs());
    expect(result).toMatchObject({ success: true, status: 'unsupported', code: null, presentationModified: true });
    expect(JSON.stringify(result)).not.toContain('__global__');
    expect(JSON.stringify(result)).not.toContain('"emitted"');
  });
  it('requires both paths and rejects additional execution or source inputs', async () => {
    const paths = inputs();
    expect((await run({ sassPath: paths.sassPath })).success).toBe(false);
    expect((await run({ elfPath: paths.elfPath })).success).toBe(false);
    expect((await run({ ...paths, execute: true })).success).toBe(false);
    expect((await run({ ...paths, originalPtx: 'source' })).success).toBe(false);
  });
  it('withholds unsupported and mismatched kernel input', async () => {
    const unsupported = await run(inputs(sass.replace('MOV R5, 0x4', 'FADD R5, R2, R3')));
    expect(unsupported.code).toBeNull();
    expect(unsupported.status).not.toBe('emitted');
    const mismatch = await run(inputs(sass, elf.replaceAll('copy32', 'other_kernel')));
    expect(mismatch.code).toBeNull();
    expect(mismatch.status).not.toBe('emitted');
  });
  it.each(['sass', 'elf'])('bounds %s input and requires valid UTF-8', async target => {
    const oversized = 'a'.repeat(262145);
    const malformed = Buffer.from([0xff, 0xfe, 0x80]);
    expect((await run(target === 'sass' ? inputs(oversized) : inputs(sass, oversized))).success).toBe(false);
    expect((await run(target === 'sass' ? inputs(malformed) : inputs(sass, malformed))).success).toBe(false);
  });
  it('binds BOM-bearing text to exact file bytes', async () => {
    const s = '\ufeff' + sass, e = '\ufeff' + elf;
    const result = await run(inputs(s, e));
    expect(result.sourceSha256).toBe(hash(s));
    expect(result.elfSha256).toBe(hash(e));
  });
  it('rejects traversal and directories on either path', async () => {
    const paths = inputs();
    for (const key of ['sassPath', 'elfPath']) {
      expect((await run({ ...paths, [key]: 'copy32.sass' })).error).toContain('absolute paths');
      expect((await run({ ...paths, [key]: '../../etc/passwd' })).success).toBe(false);
      expect((await run({ ...paths, [key]: dirs[0] })).success).toBe(false);
    }
  });
  it.skipIf(process.platform === 'win32')('rejects a FIFO on either path without waiting for a writer', () => {
    const paths = inputs();
    const fifo = join(dirs[0], 'fifo');
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    const require = createRequire(import.meta.url);
    const toolPath = fileURLToPath(new URL('../src/mcp-tools/rure-tools.ts', import.meta.url));
    for (const key of ['sassPath', 'elfPath']) {
      const child = spawnSync(process.execPath, ['--import', require.resolve('tsx'), '--input-type=module', '-e',
        'const {rureTools}=await import(process.argv[1]); const t=rureTools.find(t=>t.name==="rure_recover_sass"); console.log(JSON.stringify(await t.handler(JSON.parse(process.argv[2]))));',
        toolPath, JSON.stringify({ ...paths, [key]: fifo })],
      { encoding: 'utf8', timeout: 2500, env: { PATH: process.env.PATH, HOME: dirs[0] } });
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      const result = JSON.parse(JSON.parse(child.stdout).content[0].text);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not a regular file');
    }
  });
});
