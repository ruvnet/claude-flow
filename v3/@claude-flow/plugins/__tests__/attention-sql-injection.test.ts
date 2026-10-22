import { describe, expect, it } from 'vitest';
import {
  MultiHeadAttention,
  SelfAttention,
  LocalAttention,
  FlashAttention,
  MemoryEfficientAttention,
  DilatedAttention,
} from '../src/integrations/ruvector/attention.js';

// toSQL output is executed verbatim by AttentionExecutor when a query executor
// is configured, and TypeScript types do not exist at runtime. Before hardening,
// a string vector element or config value was interpolated into executed SQL.
const input = { query: [[1, 2, 3]], key: [[0.5, -0.25, 1e-9]], value: [[-3, 4, 5]] };

describe('attention toSQL injection hardening', () => {
  it('emits unchanged SQL for legitimate numeric input', () => {
    expect(new MultiHeadAttention({ numHeads: 4, scale: 0.125, causal: true }).toSQL(input)).toBe(
      "SELECT ruvector.multi_head_attention(ARRAY['[1,2,3]'::vector], ARRAY['[0.5,-0.25,1e-9]'::vector], " +
      "ARRAY['[-3,4,5]'::vector], 4, 0.125, true)",
    );
    const f32 = { query: [new Float32Array([0.5])], key: [new Float32Array([1])], value: [new Float32Array([2])] };
    expect(new SelfAttention({ scale: 2 }).toSQL(f32)).toBe(
      "SELECT ruvector.self_attention(ARRAY['[0.5]'::vector], ARRAY['[1]'::vector], ARRAY['[2]'::vector], 2, false)",
    );
  });

  const mechanisms = [MultiHeadAttention, SelfAttention, LocalAttention, FlashAttention, MemoryEfficientAttention, DilatedAttention];

  it.each([
    ['a string element breaking out of the vector literal', ["1]'::vector); DROP TABLE t; --"]],
    ['a NaN element', [Number.NaN]],
    ['an Infinity element', [Number.POSITIVE_INFINITY]],
    ['an object whose toString is SQL', [{ toString: () => '1); DROP TABLE t; --' }]],
  ])('rejects %s in any vector', (_label, badRow) => {
    for (const Mechanism of mechanisms) {
      for (const field of ['query', 'key', 'value'] as const) {
        const bad = { ...input, [field]: [badRow] } as never;
        expect(() => new Mechanism({ scale: 1 }).toSQL(bad)).toThrow(TypeError);
      }
    }
  });

  it('rejects a matrix that is not an array', () => {
    expect(() => new MultiHeadAttention().toSQL({ ...input, query: "ARRAY['x']" } as never)).toThrow(TypeError);
  });

  it.each([
    ['numHeads', { numHeads: '8); DROP TABLE t; --' }, MultiHeadAttention],
    ['scale', { scale: '1) OR 1=1 --' }, SelfAttention],
    ['causal', { causal: 'true); DROP TABLE t; --' }, MultiHeadAttention],
    ['params.windowSize', { params: { windowSize: '1); DROP TABLE t; --' } }, LocalAttention],
    ['params.flashBlockSize', { params: { flashBlockSize: '64) --' } }, FlashAttention],
    ['params.checkpointing', { params: { checkpointing: 'yes' } }, MemoryEfficientAttention],
    ['params.dilationRate', { params: { dilationRate: Number.NaN } }, DilatedAttention],
  ])('rejects a non-numeric/non-boolean %s', (_name, config, Mechanism) => {
    expect(() => new Mechanism(config as never).toSQL(input)).toThrow(TypeError);
  });
});
