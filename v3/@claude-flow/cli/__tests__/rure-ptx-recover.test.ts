import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recoverPtx, MAX_PTX_RECOVERY_REGISTERS } from '../src/rure/ptx-recover.js';

const header = '.version 8.0\n.target sm_80\n.address_size 64\n';
const moduleOf = (body: string, params = '') => `${header}.visible .entry sample(${params}) {\n${body}\n}`;
const declarations = '.reg .b32 %r<8>; .reg .b64 %rd<8>; .reg .pred %p<4>;';

function compileAndRun(code: string, main: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'rure-recover-test-'));
  try {
    const file = join(directory, 'recovered.cpp'), binary = join(directory, 'recovered');
    writeFileSync(file, '#define __global__\n#define __device__\nstruct dim3 { unsigned x, y, z; };\ndim3 threadIdx{}, blockIdx{}, blockDim{1,1,1}, gridDim{1,1,1};\n' + code + '\n#include <stdio.h>\n#include <stdlib.h>\n' + main);
    execFileSync('g++', ['-std=c++17', '-O2', '-fsanitize=undefined', '-fno-sanitize-recover=all', file, '-o', binary], { timeout: 20_000, encoding: 'utf8' });
    return execFileSync(binary, [], { timeout: 5000, encoding: 'utf8' });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe('conservative executable integer PTX recovery', () => {
  it('emits source, ABI metadata, and an explicit unproven status', () => {
    const result = recoverPtx(moduleOf(`${declarations} ld.param.u64 %rd0, [out]; mov.u32 %r0, 7; st.global.u32 [%rd0], %r0; ret;`, '.param .u64 out'));
    expect(result).toMatchObject({ status: 'emitted', language: 'cuda-cpp', proofStatus: 'not-proven', diagnostics: [] });
    expect(result.functions).toEqual([{ name: 'sample', emittedName: 'rure_kernel_0', parameters: [{ name: 'out', emittedName: 'rure_arg_0', type: 'uint64_t' }] }]);
    expect(result.code).not.toMatch(/\basm\b|ptx_mov|ptx_st/);
    expect(result.code).toContain('extern "C" __global__ void rure_kernel_0(uint64_t rure_arg_0)');
    expect(compileAndRun(result.code!, 'int main() { uint32_t value=0; rure_kernel_0(reinterpret_cast<uintptr_t>(&value)); if(value!=7) return 1; puts("pass"); }')).toBe('pass\n');
  });

  it('compiles both retained integer kernels and executes a loop with overflow and sentinels', () => {
    const source = readFileSync(join(__dirname, 'fixtures/cuda/ptx-decompile-confirmation.ptx'), 'utf8');
    const result = recoverPtx(source);
    expect(result.status, result.diagnostics.join('\n')).toBe('emitted');
    expect(compileAndRun(result.code!, `int main() {
      uint32_t input[] = {0, 1, 4, 0xffffffffu, 0x7fffffffu, 0x80000000u};
      uint32_t output[8]; for(unsigned i=0;i<8;i++) output[i]=0xdeadbeefu;
      const uint32_t expected[] = {7,10,19,4,0x80000004u,0x80000007u};
      blockDim.x=8;
      for(threadIdx.x=0;threadIdx.x<8;threadIdx.x++) rure_kernel_0(reinterpret_cast<uintptr_t>(input),reinterpret_cast<uintptr_t>(output),6);
      for(unsigned i=0;i<6;i++) if(output[i]!=expected[i]) return 1;
      if(output[6]!=0xdeadbeefu || output[7]!=0xdeadbeefu) return 2;
      uint32_t bounded[] = {0,1,4,9,0xffffffffu,0x80000000u};
      const uint32_t sums[] = {0,0,6,36,0,0};
      for(threadIdx.x=0;threadIdx.x<8;threadIdx.x++) rure_kernel_1(reinterpret_cast<uintptr_t>(bounded),reinterpret_cast<uintptr_t>(output),6);
      for(unsigned i=0;i<6;i++) if(output[i]!=sums[i]) return 3;
      if(output[6]!=0xdeadbeefu || output[7]!=0xdeadbeefu) return 4;
      puts("pass");
    }`)).toBe('pass\n');
  });

  it('preserves 64-bit wraparound, signed ordering, signed wide multiplication and address offsets', () => {
    const source = moduleOf(`${declarations}
      ld.param.u64 %rd0, [out];
      mov.u64 %rd1, 18446744073709551615;
      add.s64 %rd2, %rd1, 2;
      st.global.u64 [%rd0], %rd2;
      sub.s64 %rd2, 0, 1;
      st.global.b64 [%rd0+8], %rd2;
      mul.lo.u64 %rd2, %rd1, %rd1;
      st.global.u64 [%rd0+16], %rd2;
      mad.lo.s64 %rd2, %rd1, %rd1, %rd1;
      st.global.u64 [%rd0+24], %rd2;
      mov.s32 %r0, -2147483648;
      mul.wide.s32 %rd2, %r0, -1;
      st.global.u64 [%rd0+32], %rd2;
      setp.lt.s64 %p0, %rd1, 0;
      mov.u64 %rd2, 0;
      @%p0 mov.u64 %rd2, 1;
      st.global.u64 [%rd0+40], %rd2;
      setp.gt.u64 %p1, %rd1, 0;
      @!%p1 mov.u64 %rd2, 9;
      st.global.u64 [%rd0+48], %rd2;
      add.u64 %rd0, %rd0, 56;
      mul.wide.u32 %rd2, 4294967295, 4294967295;
      st.global.u64 [%rd0], %rd2;
      st.global.u64 [%rd0-8], %rd2;
      ret;
    `, '.param .u64 out');
    const result = recoverPtx(source);
    expect(result.status, result.diagnostics.join('\n')).toBe('emitted');
    expect(compileAndRun(result.code!, `int main(){ uint64_t values[8]={};
      rure_kernel_0(reinterpret_cast<uintptr_t>(values));
      const uint64_t expected[]={1,0xffffffffffffffffULL,1,0,2147483648ULL,1,18446744065119617025ULL,18446744065119617025ULL};
      for(unsigned i=0;i<8;i++) if(values[i]!=expected[i]) return i+1;
      puts("pass"); }`)).toBe('pass\n');
  });

  it('mangles all untrusted identifiers including C++ keywords and prototype-shaped names', () => {
    const result = recoverPtx(header + '.entry __proto__(.param .u64 class) { .reg .b64 %class; ld.param.u64 %class,[class]; bra __proto__; __proto__: st.global.u64 [%class],7; ret; }');
    expect(result.status).toBe('emitted');
    expect(result.code).not.toMatch(/__proto__|\bclass\b/);
    expect(compileAndRun(result.code!, 'int main(){ uint64_t x=0; rure_kernel_0(reinterpret_cast<uintptr_t>(&x)); return x==7?0:1; }')).toBe('');
  });

  it('interprets octal integers and address offsets using PTX literal rules', () => {
    const result = recoverPtx(moduleOf(`${declarations} ld.param.u64 %rd0,[out]; mov.u32 %r0,010; st.global.u32 [%rd0+010],%r0; mov.u32 %r0,-010; st.global.u32 [%rd0],%r0; ret;`, '.param .u64 out'));
    expect(result.status).toBe('emitted');
    expect(compileAndRun(result.code!, 'int main(){ uint32_t out[3]={}; rure_kernel_0(reinterpret_cast<uintptr_t>(out)); return out[0]==0xfffffff8u && out[1]==0 && out[2]==8?0:1; }')).toBe('');
    expect(recoverPtx(moduleOf(declarations+'mov.u32 %r0,09; ret;')).status).toBe('unsupported');
  });

  it('retains executable instructions following same-line debug directives', () => {
    const result = recoverPtx(header + '.file 1 "input.cu" .entry sample(.param .u64 out) { .reg .b64 %rd0; .reg .b32 %r0; ld.param.u64 %rd0,[out]; mov.u32 %r0,1; .loc 1 1 0 mov.u32 %r0,2; st.global.u32 [%rd0],%r0; .loc 1 2 0 ret; }');
    expect(result.status).toBe('emitted');
    expect(compileAndRun(result.code!, 'int main(){ uint32_t out=0; rure_kernel_0(reinterpret_cast<uintptr_t>(&out)); return out==2?0:1; }')).toBe('');
    expect(recoverPtx(moduleOf(declarations+'.loc 1 1 0 atom.global.add.u32 %r0,[%rd0],1;\nret;'))).toMatchObject({ status: 'unsupported', code: null });
  });

  it.each([
    ['undefined register', 'mov.u32 %r0, %r1; ret;'],
    ['undefined predicate', '@%p0 mov.u32 %r0, 1; ret;'],
    ['conditional definition', 'mov.u32 %r0,0; setp.eq.u32 %p0,%r0,0; @%p0 mov.u32 %r1,1; mov.u32 %r2,%r1; ret;'],
    ['path bypasses definition', 'mov.u32 %r0,0; setp.eq.u32 %p0,%r0,0; @%p0 bra L; mov.u32 %r1,1; L: mov.u32 %r2,%r1; ret;'],
    ['loop backedge cannot initialize entry', 'L: add.u32 %r0,%r0,1; bra L;'],
    ['register width mismatch', 'mov.u64 %r0, 7; ret;'],
    ['predicate width mismatch', 'mov.u32 %p0, 1; ret;'],
    ['out-of-domain immediate', 'mov.u32 %r0,4294967296; ret;'],
    ['negative out-of-domain immediate', 'mov.u32 %r0,-2147483649; ret;'],
    ['unsupported special register', 'mov.u32 %r0,%laneid; ret;'],
    ['special register width', 'mov.u64 %rd0,%tid.x; ret;'],
    ['float operation', 'add.f32 %r0,%r1,%r2; ret;'],
    ['barrier', 'bar.sync 0; ret;'],
    ['atomic', 'atom.global.add.u32 %r0,[%rd0],1; ret;'],
    ['new modifier', 'add.sat.s32 %r0,%r1,%r2; ret;'],
    ['fallthrough', 'mov.u32 %r0,7;'],
    ['predicated final terminator', 'mov.u32 %r0,0; setp.eq.u32 %p0,%r0,0; @%p0 ret;'],
    ['parameter mismatch', 'ld.param.u64 %rd0,[not_declared]; ret;'],
    ['huge address offset', 'mov.u64 %rd0,0; ld.global.u32 %r0,[%rd0+9223372036854775808]; ret;'],
  ])('declines %s without emitting executable fragments', (_name, body) => {
    const result = recoverPtx(moduleOf(declarations + body));
    expect(result.status).toBe('unsupported');
    expect(result.code).toBeNull();
    expect(result.functions).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('intersects definitions at branch joins and accepts when both paths initialize', () => {
    const result = recoverPtx(moduleOf(`${declarations}
      mov.u32 %r0,%tid.x; setp.eq.u32 %p0,%r0,0; @%p0 bra L;
      mov.u32 %r1,2; bra J;
      L: mov.u32 %r1,3;
      J: add.u32 %r2,%r1,1; ret;`));
    expect(result.status, result.diagnostics.join('\n')).toBe('emitted');
  });

  it('caps register expansion before allocating expansion-sized arrays', () => {
    const result = recoverPtx(moduleOf('.reg .b32 %r<99999999999999999999999999999>; ret;'));
    expect(result.status).toBe('unsupported');
    expect(result.diagnostics[0]).toContain(String(MAX_PTX_RECOVERY_REGISTERS));
    expect(recoverPtx(moduleOf('.reg .b32 %r<256>; .reg .pred %p; ret;')).status).toBe('unsupported');
  });

  it.each([
    `${header}.entry sample(.param .u32 x,.param .u32 x) {ret;}`,
    `${header}.entry sample(.param .align 8 .b8 x[8]) {ret;}`,
    `${header}.entry sample() {.reg .b32 %r0,%r0; ret;}`,
    `${header}.entry sample() {.reg .f32 %f0; ret;}`,
    `${header}.func sample() {ret;}`,
    `${header.replace('size 64', 'size 32')}.entry sample() {ret;}`,
  ])('declines unsupported or ambiguous declarations %#', source => {
    expect(recoverPtx(source)).toMatchObject({ status: 'unsupported', code: null });
  });

  it('preserves parser invalidity and never emits a partially recovered module', () => {
    expect(recoverPtx('not PTX')).toMatchObject({ status: 'invalid', code: null });
    const result = recoverPtx(header + '.entry good(){ret;}\n.entry bad(){bar.sync 0;ret;}');
    expect(result).toMatchObject({ status: 'unsupported', code: null, functions: [] });
  });
});
