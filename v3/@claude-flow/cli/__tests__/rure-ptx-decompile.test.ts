import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decompilePtx, MAX_PTX_DECOMPILE_BYTES } from '../src/rure/ptx-decompile.js';

const header = '.version 8.0\n.target sm_80\n.address_size 64\n';
const moduleOf = (body: string) => `${header}.visible .entry sample() {\n${body}\n}`;

describe('bounded PTX decompiler: preserved evidence, not semantic equivalence', () => {
  it('lifts the existing real nvcc fixture without inventing recovered CUDA', () => {
    const text = readFileSync(join(__dirname, 'fixtures/cuda/k80.ptx'), 'utf8');
    const result = decompilePtx(text);
    expect(result).toMatchObject({ schemaVersion: 1, language: 'ptx', status: 'complete', truncated: false, ptxVersion: '9.0', target: 'sm_80', addressSize: 64, totalInstructionCount: 32, supportedInstructionCount: 32, warnings: [] });
    expect(result.sourceSha256).toBe(createHash('sha256').update(text).digest('hex'));
    expect(result.functions.map(f => [f.name, f.instructions.length])).toEqual([['_Z5saxpyifPKfPf', 20], ['_Z12scale_secretPfi', 12]]);
    const fn = result.functions[0]!;
    const fma = fn.instructions.find(i => i.opcode.startsWith('fma'))!;
    expect(fma).toMatchObject({ opcode: 'fma.rn.f32', operands: ['%f4', '%f2', '%f1', '%f3'], predicate: null, supported: true });
    expect(text.split('\n')[fma.line - 1]).toContain('fma.rn.f32');
    expect(fn.pseudocode).toContain('registers["%f4"] = ptx_fma_rn_f32(registers["%f2"], registers["%f1"], registers["%f3"]);');
    expect(fn.pseudocode).toContain('not an equivalence proof');
    expect(fn.blocks).toEqual([
      { id: 'b0', labels: [], start: 0, end: 10, successors: ['b19', 'b10'] },
      { id: 'b10', labels: [], start: 10, end: 19, successors: ['b19'] },
      { id: 'b19', labels: ['$L__BB0_2'], start: 19, end: 20, successors: [] },
    ]);
  });

  it('preserves backwards edges, fallthrough and inverted predication', () => {
    const result = decompilePtx(moduleOf('.reg .b32 %r<2>;\n.reg .pred %p;\nmov.u32 %r0, 0;\nloop: add.u32 %r0, %r0, 1;\nsetp.lt.u32 %p, %r0, 5;\n@%p bra loop;\n@!%p ret;\nexit;'));
    expect(result.status).toBe('complete');
    const fn = result.functions[0]!;
    expect(fn.blocks).toEqual([
      { id: 'b0', labels: [], start: 0, end: 1, successors: ['b1'] },
      { id: 'b1', labels: ['loop'], start: 1, end: 4, successors: ['b1', 'b4'] },
      { id: 'b4', labels: [], start: 4, end: 5, successors: ['b5'] },
      { id: 'b5', labels: [], start: 5, end: 6, successors: [] },
    ]);
    expect(fn.instructions[4]!.predicate).toBe('!%p');
    expect(fn.pseudocode).toContain('if (!registers["%p"]) { ptx_ret(); }');
    expect(fn.pseudocode).toContain('if (registers["%p"]) { goto loop; }');
    expect(fn.pseudocode).not.toContain('while (');
  });

  it('keeps register assignment order and distinct special-register names', () => {
    const fn = decompilePtx(moduleOf('mov.u32 %r0, %ctaid.x;\nmov.u32 %r1, %ctaid_x;\nadd.u32 %r0, %r0, %r1;\nret;')).functions[0]!;
    expect(fn.pseudocode).toContain('registers["%ctaid.x"]');
    expect(fn.pseudocode).toContain('registers["%ctaid_x"]');
    expect(fn.pseudocode.indexOf('ptx_mov_u32')).toBeLessThan(fn.pseudocode.indexOf('ptx_add_u32'));
  });

  it('retains address spaces, signed widths and rounding modes as distinct intrinsics', () => {
    const result = decompilePtx(moduleOf('ld.global.u32 %r0, [%rd0+4];\nld.param.u64 %rd1, [arg];\nmul.wide.s32 %rd2, %r0, -4;\nfma.rz.f64 %fd0, %fd1, %fd2, %fd3;\nst.global.u32 [%rd0-4], %r0;\nret;'));
    expect(result.status).toBe('complete');
    expect(result.functions[0]!.instructions[0]!.operands).toEqual(['%r0', '[ %rd0 + 4 ]']);
    for (const name of ['ptx_ld_global_u32', 'ptx_ld_param_u64', 'ptx_mul_wide_s32', 'ptx_fma_rz_f64', 'ptx_st_global_u32']) expect(result.functions[0]!.pseudocode).toContain(name);
  });

  it('does not inherit support for unknown modifiers, vector forms or atomics', () => {
    const result = decompilePtx(moduleOf('fma.rn.ftz.f32 %f0, %f1, %f2, %f3;\nld.global.v2.u32 {%r0, %r1}, [%rd0];\natom.global.add.u32 %r2, [%rd0], 1;\nret;'));
    expect(result.status).toBe('partial');
    expect(result.totalInstructionCount).toBe(4);
    expect(result.supportedInstructionCount).toBe(1);
    expect(result.functions[0]!.instructions[1]!.operands).toEqual(['{ %r0 , %r1 }', '[ %rd0 ]']);
    expect(result.functions[0]!.unsupported.map(u => u.opcode)).toEqual(['fma.rn.ftz.f32', 'ld.global.v2.u32', 'atom.global.add.u32']);
    expect(result.functions[0]!.pseudocode).toContain('unsupported_ptx("atom.global.add.u32"');
    expect(result.warnings[0]).toContain('CFG models supported control flow only');
  });

  it('retains device return parameters while explicitly declining a complete lift', () => {
    const result = decompilePtx(`${header}.func (.param .b32 result) device(.param .b32 arg) { ret; }`);
    expect(result.status).toBe('partial');
    expect(result.functions[0]).toMatchObject({ kind: 'func', params: ['.param .b32 arg'], returnParams: ['.param .b32 result'] });
    expect(result.functions[0]!.pseudocode).toContain('-> (.param .b32 result)');
  });

  it('does not claim bodies exist for external declarations', () => {
    const result = decompilePtx(`${header}.extern .func external(.param .b32 x);`);
    expect(result.status).toBe('partial');
    expect(result.functions[0]!.instructions).toEqual([]);
    expect(result.functions[0]!.unsupported[0]!.reason).toContain('no body');
  });

  it('preserves source lines across both comment forms', () => {
    const result = decompilePtx(moduleOf('/* comment\nsecond line */\n// third comment\nmov.u32 %r1, 7; ret;'));
    expect(result.status).toBe('complete');
    expect(result.functions[0]!.instructions.map(i => i.line)).toEqual([8, 8]);
  });

  it('does not let prototype-shaped labels modify the result object', () => {
    const result = decompilePtx(moduleOf('bra __proto__;\n__proto__: ret;'));
    expect(result.status).toBe('complete');
    const labels = result.functions[0]!.labels;
    expect(Object.getPrototypeOf(labels)).toBeNull();
    expect(Object.hasOwn(labels, '__proto__')).toBe(true);
    expect(JSON.parse(JSON.stringify(labels))).toEqual({ ['__proto__']: 1 });
  });

  it.each([
    ['unknown label', 'bra absent; ret;'],
    ['duplicate label', 'L: mov.u32 %r0, 0; L: ret;'],
    ['branch into empty tail', 'bra end; ret; end:'],
    ['missing semicolon', 'mov.u32 %r0, 0 }'],
    ['unbalanced address', 'ld.global.u32 %r0, [%rd0; ret;'],
    ['empty operand', 'add.u32 %r0,,1; ret;'],
    ['trailing operand comma', 'add.u32 %r0,%r1,; ret;'],
    ['unclosed comment', 'ret; /*'],
    ['nested scope', '{ ret; }'],
    ['bad register declaration', '.reg .b32 hello; ret;'],
    ['bad predicate', '@window.alert ret;'],
    ['empty body', ''],
    ['non-ASCII', 'ret; // \u202e hidden'],
    ['control character', 'ret;\x00'],
  ])('fails closed for %s', (_name, body) => {
    const result = decompilePtx(moduleOf(body));
    expect(result.status).toBe('invalid');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('does not call malformed operands supported', () => {
    expect(decompilePtx(moduleOf('ld.global.u32 %r0, [%rd0 %rd1]; ret;')).status).toBe('partial');
    expect(decompilePtx(moduleOf('mov.u32 %r0; ret;')).status).toBe('partial');
  });

  it.each([
    `${header}.entry sample(bogus) { ret; }`,
    `${header}.entry (.param .u32 r) sample() { ret; }`,
    `${header}.version 8.0\n.entry sample() { ret; }`,
    `${header}.target sm_90\n.entry sample() { ret; }`,
    `${header}.address_size 32\n.entry sample() { ret; }`,
    '.entry sample() { ret; }',
    '.version 8.0\n.target sm_80\n.address_size 128\n.entry sample() { ret; }',
    `${header}.global .u32 data;\n.entry sample() { ret; }`,
  ])('fails closed for unsupported module/signature syntax %#', text => {
    expect(decompilePtx(text).status).toBe('invalid');
  });

  it('caps input before token allocation and reports truncation honestly', () => {
    const result = decompilePtx(' '.repeat(MAX_PTX_DECOMPILE_BYTES + 1));
    expect(result).toMatchObject({ status: 'invalid', truncated: true, functions: [] });
    expect(result.warnings[0]).toContain('bytes');
  });

  it('caps token length, tokens, instructions, functions and global blocks', () => {
    const cases = [
      moduleOf(`${'a'.repeat(513)};`),
      'x '.repeat(100_001),
      moduleOf('ret;'.repeat(4097)),
      header + Array.from({ length: 65 }, (_, n) => `.entry f${n}() { ret; }`).join('\n'),
      header + [0, 1].map(n => `.entry f${n}() { ${'ret;'.repeat(1025)} }`).join('\n'),
      moduleOf(Array.from({ length: 4097 }, (_, n) => `L${n}:`).join('\n') + 'ret;'),
    ];
    for (const source of cases) expect(decompilePtx(source)).toMatchObject({ status: 'invalid', truncated: true });
  });

  it('handles dense same-instruction aliases without quadratic label copying', () => {
    const source = moduleOf(Array.from({ length: 4096 }, (_, n) => `L${n}:`).join('\n') + 'ret;');
    const started = performance.now();
    const result = decompilePtx(source);
    expect(result.status).toBe('complete');
    expect(result.functions[0]!.blocks[0]!.labels).toHaveLength(4096);
    // Generous guard against accidental superlinear rescanning, not a speed claim.
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('is deterministic and never interprets hostile strings as code', () => {
    const source = moduleOf('unknown "process.exit(1)", "${danger}"; ret;');
    const first = decompilePtx(source);
    expect(first.status).toBe('partial');
    expect(first.functions[0]!.instructions[0]!.operands).toEqual(['"process.exit(1)"', '"${danger}"']);
    expect(decompilePtx(source)).toEqual(first);
  });
});
