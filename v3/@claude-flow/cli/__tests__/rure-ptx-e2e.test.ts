import { describe, it, expect } from 'vitest';
import { decompilePtx } from '../src/rure/ptx-decompile.js';
// The dependency-free evaluator is also runnable on a clean Node 24 host.
// @ts-expect-error test-only JavaScript evaluator has no declaration file
import { validate } from '../../../../plugins/ruflo-rure/scripts/ptx-e2e.mjs';

describe('PTX decompiler independent end-to-end confirmation', () => {
  it('preserves real nvcc instructions and executes frozen integer IR correctly', () => {
    const result = validate(decompilePtx);
    expect(result.status).toBe('pass');
    expect(result.cases).toBe(18);
    expect(result.realFixtureInstructions).toBe(32);
    expect(result.elementComparisons).toBeGreaterThan(3000);
  });

  it('rejects an instruction-IR semantic mutation even with an intact source digest', () => {
    expect(() => validate((text: string) => {
      const result = decompilePtx(text);
      const affine = result.functions.find(f => f.name === 'affine_i32');
      if (affine) {
        const instruction = affine.instructions.find(i =>
          i.opcode === 'mad.lo.s32' && i.operands[3] === '7');
        expect(instruction).toBeDefined();
        instruction!.operands[3] = '8';
      }
      return result;
    })).toThrow(/affine_i32 n=1 i=0/);
  });
});
