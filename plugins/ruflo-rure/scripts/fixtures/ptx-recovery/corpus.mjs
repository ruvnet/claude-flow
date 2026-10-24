// Independent synthetic semantics corpus. Authored without reading the recovery
// backend. These are small integer programs, not a real-world SOTA benchmark.
import { createHash } from 'node:crypto';

const u32 = x => BigInt.asUintN(32, x);
const s32 = x => BigInt.asIntN(32, x);
const u64 = x => BigInt.asUintN(64, x);
const s64 = x => BigInt.asIntN(64, x);
const def = (id, split, bits, outBits, body, oracle, opts = {}) => ({ id, split, bits, outBits, body, oracle, ...opts });

// Oracle uses BigInt modular arithmetic, not the candidate emitter or its IR.
export const kernels = [
  def('copy32', 'development', 32, 32, 'mov.b32 %r4, %r2;', a => a),
  def('add7_wrap32', 'development', 32, 32, 'add.u32 %r4, %r2, 7;', a => u32(a + 7n)),
  def('subtract32', 'development', 32, 32, 'sub.s32 %r4, %r2, %r3;', (a,b) => u32(a-b)),
  def('multiply_low32', 'development', 32, 32, 'mul.lo.u32 %r4, %r2, %r3;', (a,b) => u32(a*b)),
  def('multiply_add32', 'development', 32, 32, 'mad.lo.s32 %r4, %r2, %r3, -19;', (a,b) => u32(a*b-19n)),
  def('signed_min32', 'development', 32, 32, 'mov.b32 %r4, %r2;\nsetp.lt.s32 %p1, %r3, %r2;\n@%p1 mov.b32 %r4, %r3;', (a,b) => s32(a) < s32(b) ? a : b),
  def('unsigned_max32', 'development', 32, 32, 'mov.b32 %r4, %r2;\nsetp.gt.u32 %p1, %r3, %r2;\n@%p1 mov.b32 %r4, %r3;', (a,b) => a > b ? a : b),
  def('absolute_wrap32', 'development', 32, 32, 'mov.b32 %r4, %r2;\nsetp.lt.s32 %p1, %r2, 0;\n@%p1 sub.s32 %r4, 0, %r2;', a => s32(a)<0n ? u32(-s32(a)):a),
  def('branch_clamp32', 'development', 32, 32, 'mov.b32 %r4, %r2;\nsetp.lt.s32 %p1, %r2, 0;\n@!%p1 bra POS;\nmov.u32 %r4, 0;\nPOS:', a => s32(a)<0n ? 0n:a),
  def('conditional_sum32', 'development', 32, 32, 'mov.b32 %r4, %r2;\nsetp.ne.u32 %p1, %r3, 0;\n@%p1 add.s32 %r4, %r2, %r3;', (a,b) => b ? u32(a+b):a),
  def('wide_unsigned', 'development', 32, 64, 'mul.wide.u32 %d12, %r2, %r3;', (a,b) => a*b),
  def('wide_signed', 'development', 32, 64, 'mul.wide.s32 %d12, %r2, %r3;', (a,b) => u64(s32(a)*s32(b))),
  def('add64', 'development', 64, 64, 'add.s64 %d12, %d9, %d10;', (a,b) => u64(a+b)),
  def('subtract64', 'development', 64, 64, 'sub.u64 %d12, %d9, %d10;', (a,b) => u64(a-b)),
  def('multiply_low64', 'development', 64, 64, 'mul.lo.s64 %d12, %d9, %d10;', (a,b) => u64(a*b)),
  def('multiply_add64', 'development', 64, 64, 'mad.lo.u64 %d12, %d9, %d10, 18446744073709551615;', (a,b) => u64(a*b-1n)),
  // Confirmation families are compositions, not secret real-world projects.
  // They are withheld from the implementation worker until candidate freeze.
  def('prefix_loop32', 'confirmation', 32, 32, 'mov.u32 %r4, 0;\nmov.u32 %r5, 0;\nLOOP:\nsetp.ge.u32 %p1, %r5, %r0;\n@%p1 bra DONE;\nadd.u32 %r4, %r4, %r5;\nadd.u32 %r5, %r5, 1;\nbra LOOP;\nDONE:', (_a,_b,i) => BigInt(i*(i-1)/2)),
  def('memory_offset32', 'confirmation', 32, 32, 'ld.global.u32 %r5, [%d6+4];\nsub.u32 %r4, %r5, %r2;', (a,_b,i,input) => u32(input[i+1]-a)),
  def('memory_offset64', 'confirmation', 64, 64, 'ld.global.u64 %d13, [%d6+8];\nadd.u64 %d12, %d13, %d9;', (a,_b,i,input) => u64(input[i+1]+a)),
  def('signed_select64', 'confirmation', 64, 64, 'setp.lt.s64 %p1, %d9, %d10;\nmov.b64 %d12, %d10;\n@%p1 mov.b64 %d12, %d9;', (a,b) => s64(a)<s64(b)?a:b),
  def('unsigned_select64', 'confirmation', 64, 64, 'setp.le.u64 %p1, %d9, %d10;\nmov.b64 %d12, %d9;\n@!%p1 mov.b64 %d12, %d10;', (a,b) => a<=b?a:b),
  def('predicate_branch_diamond', 'confirmation', 32, 32, 'setp.ge.s32 %p1, %r2, %r3;\n@%p1 bra GREATER;\nadd.s32 %r4, %r2, 3;\nbra JOIN;\nGREATER:\nsub.s32 %r4, %r3, 5;\nJOIN:', (a,b) => s32(a)>=s32(b)?u32(b-5n):u32(a+3n)),
  def('global_index32', 'confirmation', 32, 32, 'mad.lo.u32 %r4, %r0, %r3, %r2;', (a,b,i) => u32(BigInt(i)*b+a)),
  def('signed_wide_accumulate', 'confirmation', 32, 64, 'mul.wide.s32 %d13, %r2, %r3;\nsub.s64 %d12, %d13, 9223372036854775807;', (a,b) => u64(s32(a)*s32(b)-9223372036854775807n)),
];

export function ptxFor(k) {
  const inputStride=k.bits/8, outputStride=k.outBits/8;
  return `.version 7.0\n.target sm_70\n.address_size 64\n.visible .entry ${k.id}(\n.param .u64 input, .param .u64 aux, .param .u64 output, .param .u32 count, .param .u64 scalar\n) {\n.reg .b32 %r<16>;\n.reg .b64 %d<16>;\n.reg .pred %p<8>;\nld.param.u64 %d0, [input];\nld.param.u64 %d1, [aux];\nld.param.u64 %d2, [output];\nld.param.u32 %r1, [count];\nmov.u32 %r0, %ctaid.x;\nmov.u32 %r6, %ntid.x;\nmov.u32 %r7, %tid.x;\nmad.lo.u32 %r0, %r0, %r6, %r7;\nsetp.ge.u32 %p0, %r0, %r1;\n@%p0 bra END;\ncvta.to.global.u64 %d0, %d0;\ncvta.to.global.u64 %d1, %d1;\ncvta.to.global.u64 %d2, %d2;\nmul.wide.u32 %d3, %r0, ${inputStride};\nmul.wide.u32 %d4, %r0, ${outputStride};\nadd.u64 %d6, %d0, %d3;\nadd.u64 %d7, %d1, %d3;\nadd.u64 %d8, %d2, %d4;\nld.global.u${k.bits} ${k.bits===32?'%r2':'%d9'}, [%d6];\nld.global.u${k.bits} ${k.bits===32?'%r3':'%d10'}, [%d7];\n${k.body}\nst.global.u${k.outBits} [%d8], ${k.outBits===32?'%r4':'%d12'};\nEND:\nret;\n}\n`;
}

export const sizes = [0,1,2,7,31,33,65];
const edge32=[0n,1n,0xffffffffn,0x80000000n,0x7fffffffn,0xffff0000n,0x10000n,17n,0xdeadbeefn,0xabcdef01n,0x80000001n];
const edge64=[0n,1n,0xffffffffffffffffn,0x8000000000000000n,0x7fffffffffffffffn,0xffffffff00000000n,0x100000000n,17n,0xdeadbeefabcdefffn,0xabcdef0123456789n,0x8000000000000001n];
export function vectors(k, n) {
  const edge=k.bits===32?edge32:edge64;
  const input=Array.from({length:n+8},(_,i)=>edge[i%edge.length]);
  const aux=Array.from({length:n+8},(_,i)=>edge[(i*7+3)%edge.length]);
  const sentinel=k.outBits===32?0xa5a5a5a5n:0xa5a5a5a5a5a5a5a5n;
  const expected=Array.from({length:n+8},(_,i)=>i<n?k.oracle(input[i],aux[i],i,input):sentinel);
  return {input,aux,expected,sentinel};
}

const module = body => `.version 7.0\n.target sm_70\n.address_size 64\n.visible .entry reject(.param .u64 output) {\n.reg .b32 %r<3>;\n.reg .b64 %d<3>;\n.reg .pred %p<2>;\n${body}\nret;\n}\n`;
export const rejectionCases = [
  ['float', module('mov.f32 %r0, 0f3f800000;')],
  ['barrier', module('bar.sync 0;')],
  ['shared', module('ld.shared.u32 %r0, [%d0];')],
  ['unknown', module('future.foo %r0, 1;')],
  ['uninitialized_data', module('add.u32 %r0, %r1, 1;')],
  ['uninitialized_predicate', module('@%p0 mov.u32 %r0, 1;')],
  ['undeclared_register', module('mov.u32 %r99, 1;')],
  ['width_mismatch', module('mov.u64 %r0, 1;')],
  ['path_uninitialized', module('mov.u32 %r0, %tid.x;\nsetp.eq.u32 %p0, %r0, 0;\n@%p0 bra SKIP;\nmov.u32 %r1, 7;\nSKIP:\nadd.u32 %r2, %r1, 1;')],
  ['predicated_definition', module('mov.u32 %r0, %tid.x;\nsetp.eq.u32 %p0, %r0, 0;\n@%p0 mov.u32 %r1, 7;\nadd.u32 %r2, %r1, 1;')],
  ['oversized_register_array', module('.reg .b64 %huge<999999999>;')],
  ['malformed', '.version 7.0\n.target sm_70\n.address_size 64\n.visible .entry bad( {'],
];

export const hash = text => createHash('sha256').update(text).digest('hex');
export const corpusManifest = () => ({
  schemaVersion:1,
  evidenceClass:'synthetic-correctness',
  independence:'Authored by a separate evaluator before viewing candidate implementation; not a blinded external laboratory.',
  scope:'24 small hand-authored integer programs; seven launch sizes; edge-value arrays. Not project-disjoint real-world coverage and not a SOTA comparison.',
  kernels:kernels.map(k=>({id:k.id,split:k.split,inputBits:k.bits,outputBits:k.outBits,sourceSha256:hash(ptxFor(k)),cases:sizes.map(n=>({count:n,oracleSha256:hash(JSON.stringify(vectors(k,n),(_k,v)=>typeof v==='bigint'?v.toString():v))}))})),
  rejections:rejectionCases.map(([id,ptx])=>({id,sourceSha256:hash(ptx)})),
});
