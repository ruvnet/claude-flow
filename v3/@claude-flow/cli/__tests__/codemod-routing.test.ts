import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnhancedModelRouter } from '../src/ruvector/enhanced-model-router.js';

const dir = mkdtempSync(join(tmpdir(), 'codemod-routing-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const router = getEnhancedModelRouter();

describe('route-time dry-run (ADR-143 #3)', () => {
  it('keeps Tier-1 codemod when the file actually has work to do', async () => {
    const f = join(dir, 'has.js');
    writeFileSync(f, 'var a = 1;\nvar b = 2;\n');
    const r = await router.route('convert var to const', { filePath: f });
    expect(r.tier).toBe(1);
    expect(r.handler).toBe('codemod');
    expect(r.deterministic).toBe(true);
    expect(r.reasoning).toMatch(/\d+ edit/); // edit count from the dry-run
  });

  it('falls through to model routing when the codemod is a verified no-op', async () => {
    const f = join(dir, 'none.js');
    writeFileSync(f, 'const a = 1;\n'); // nothing to convert
    const r = await router.route('convert var to const', { filePath: f });
    expect(r.tier).not.toBe(1);
    expect(r.handler).not.toBe('codemod');
  });

  it('recommends best-effort Tier-1 when no file is available to dry-run', async () => {
    const r = await router.route('convert var to const');
    expect(r.tier).toBe(1);
    expect(r.handler).toBe('codemod');
  });

  it('never claims Tier-1 for a non-deterministic intent', async () => {
    const f = join(dir, 'typed.ts');
    writeFileSync(f, 'function f(a) { return a; }\n');
    const r = await router.route('add type annotations', { filePath: f });
    expect(r.tier).not.toBe(1);
    expect(r.handler).not.toBe('codemod');
  });
});
