import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_SASS_RECOVERY_BYTES, recoverSass } from '../src/rure/sass-recover.js';

const inputs = resolve(__dirname, '../../../../plugins/ruflo-rure/scripts/baselines/culifter/crosspath-inputs');
const load = (id: string) => ({ sass: readFileSync(join(inputs, `${id}.sass`), 'utf8'), elf: readFileSync(join(inputs, `${id}.elf`), 'utf8') });
function execute(code: string, main: string): void {
  const directory = mkdtempSync(join(tmpdir(), 'rure-sass-test-'));
  try {
    const source = join(directory, 'recovered.cpp'), binary = join(directory, 'recovered');
    writeFileSync(source, '#define __global__\n#define __device__\nstruct dim3 { unsigned x,y,z; };\ndim3 threadIdx{},blockIdx{},blockDim{1,1,1},gridDim{1,1,1};\n' + code + '\n' + main);
    execFileSync('g++', ['-std=c++17', '-O2', '-fsanitize=undefined', '-fno-sanitize-recover=all', source, '-o', binary], { timeout: 20_000 });
    execFileSync(binary, [], { timeout: 5000 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe('SASS text recovery with explicit ABI assumptions', () => {
  it.each(['copy32', 'add7_wrap32', 'multiply_low64', 'wide_signed'])('admits the frozen development export %s', id => {
    const input = load(id), result = recoverSass(input.sass, input.elf);
    expect(result.status, result.diagnostics.join('\n')).toBe('emitted');
    expect(result).toMatchObject({ architecture: 'sm_86', binaryDecoder: false, proofStatus: 'not-proven' });
    expect(result.functions[0]!.name).toBe(id);
    expect(result.functions[0]!.parameters.map(p => [p.ordinal, p.offset, p.size])).toEqual([[0,0,8],[1,8,8],[2,16,8],[3,24,4],[4,32,8]]);
    expect(result.code).not.toMatch(/\basm\b|ld\.global|\.entry/);
    expect(result.elisions).toHaveLength(2);
    const common = 'blockDim.x=8; for(threadIdx.x=0;threadIdx.x<8;threadIdx.x++) rure_sass_kernel_0(reinterpret_cast<uintptr_t>(input),reinterpret_cast<uintptr_t>(aux),reinterpret_cast<uintptr_t>(output),6,0);';
    const main = id === 'copy32' || id === 'add7_wrap32' ? `int main(){
      uint32_t input[]={0,1,0xffffffffu,0xfffffffau,0x80000000u,0x7fffffffu}; uint32_t aux[6]={}; uint32_t output[8]={}; output[6]=output[7]=0xdeadbeefu;
      ${common}
      for(unsigned i=0;i<6;i++) if(output[i]!=static_cast<uint32_t>(input[i]+${id === 'copy32' ? 0 : 7}u)) return 1;
      return output[6]==0xdeadbeefu && output[7]==0xdeadbeefu?0:2;
    }` : id === 'multiply_low64' ? `int main(){
      uint64_t input[]={0,1,0xffffffffffffffffULL,0x8000000000000000ULL,0xffffffffULL,0x1234567801234567ULL};
      uint64_t aux[]={9,7,0xffffffffffffffffULL,2,0xffffffffULL,0x9876543298765432ULL}; uint64_t output[8]={}; output[6]=output[7]=0xdeadbeefULL;
      ${common}
      for(unsigned i=0;i<6;i++) if(output[i]!=input[i]*aux[i]) return 1;
      return output[6]==0xdeadbeefULL && output[7]==0xdeadbeefULL?0:2;
    }` : `int main(){
      uint32_t input[]={0,1,0xffffffffu,0x80000000u,0x80000000u,0x7fffffffu}; uint32_t aux[]={9,7,3,0xffffffffu,0x80000000u,0x7fffffffu};
      uint64_t output[8]={}; output[6]=output[7]=0xdeadbeefULL;
      const uint64_t expected[]={0,7,0xfffffffffffffffdULL,2147483648ULL,4611686018427387904ULL,4611686014132420609ULL};
      ${common}
      for(unsigned i=0;i<6;i++) if(output[i]!=expected[i]) return 1;
      return output[6]==0xdeadbeefULL && output[7]==0xdeadbeefULL?0:2;
    }`;
    execute(result.code!, main);
  });

  it.each([
    ['wrong architecture', (s: string) => s.replace('code for sm_86', 'code for sm_89')],
    ['unknown opcode', (s: string) => s.replace('S2R R4', 'DANGEROUS R4')],
    ['unknown modifier', (s: string) => s.replace('LDG.E R3', 'LDG.E.UNKNOWN R3')],
    ['undefined register', (s: string) => s.replace('MOV R5, 0x4', 'MOV R5, R0')],
    ['implicit pair reads stack pointer', (s: string) => s.replace('[R2.64]', '[R0.64]')],
    ['missing descriptor', (s: string) => s.replace('ULDC.64 UR4, c[0x0][0x118]', 'NOP')],
    ['wrong descriptor', (s: string) => s.replace('ULDC.64 UR4', 'ULDC.64 UR6')],
    ['unvalidated explicit descriptor syntax', (s: string) => s.replace('[R2.64]', 'desc[UR4][R2.64]')],
    ['unknown constant bank', (s: string) => s.replace('c[0x0][0x160]', 'c[0x1][0x160]')],
    ['unvalidated wide immediate addend', (s: string) => s.replace('c[0x0][0x160]', '0xffffffff')],
    ['parameter padding read', (s: string) => s.replace('c[0x0][0x178]', 'c[0x0][0x17c]')],
    ['branch outside text', (s: string) => s.replace('BRA 0xd0', 'BRA 0xffff')],
    ['pair crosses zero register', (s: string) => s.replace('[R2.64]', '[R254.64]')],
    ['unknown trailing text', (s: string) => s+'\nmalicious\n'],
    ['changed encoding', (s: string) => s.replace('00000a0000017a02', '00000a0000017a03')],
  ])('rejects %s without executable output', (_label, mutate) => {
    const input = load('copy32'), result = recoverSass(mutate(input.sass), input.elf);
    expect(result.status).not.toBe('emitted'); expect(result.code).toBeNull(); expect(result.functions).toEqual([]);
  });

  it('kills prior R1 definitions at an elided stack reset instead of reusing stale bits', () => {
    const input = load('copy32');
    const sass = input.sass.replace('MOV R1, c[0x0][0x28]', 'MOV R1, 0x9')
      .replace('S2R R3, SR_TID.X', 'MOV R1, c[0x0][0x28]')
      .replace('IMAD R4, R4, c[0x0][0x0], R3', 'IMAD R4, R4, c[0x0][0x0], R1');
    const result = recoverSass(sass, input.elf);
    expect(result).toMatchObject({ status: 'unsupported', code: null });
    expect(result.diagnostics[0]).toContain('undefined register');
  });

  it.each([
    ['ordinal hole', (e: string) => e.replace('Ordinal : 0x4', 'Ordinal : 0x5')],
    ['size disagreement', (e: string) => e.replace('Value:\t0x28\n', 'Value:\t0x30\n')],
    ['offset hole', (e: string) => e.replace('Offset  : 0x20', 'Offset  : 0x28')],
    ['overlapping parameters', (e: string) => e.replace('Offset  : 0x20', 'Offset  : 0x18')],
    ['wrong constant bank symbol', (e: string) => e.replace('Value:\t0x2 0x280160', 'Value:\t0x3 0x280160')],
    ['constant bank extent', (e: string) => e.replace('    a    418    188', '    a    418    180')],
    ['section numeric junk', (e: string) => e.replace('    a    418    188', '    a    418    188garbage')],
    ['relocation targets text', (e: string) => e.replace('REL       40    3        4 .rel.debug_frame', 'REL       40    3        b .rel.debug_frame')],
    ['unlisted code relocation', (e: string) => e+'\n.section .rel.text.copy32\n0x0 R_CUDA_32I_32 copy32\n'],
    ['unrecognized CUDA relocation', (e: string) => e.replace('EIVALUE_SYM_KIND_ADDR,0,0,17,37,0,5,54', 'EIVALUE_SYM_KIND_ADDR,0,1,17,37,0,5,54')],
    ['wrong symbol type', (e: string) => e.replace('0x2               0               0      0x3', '0x2               0               0      0x2')],
    ['stack use', (e: string) => e.replace('frame size: 0x0', 'frame size: 0x10')],
    ['kernel mismatch', (e: string) => e.replaceAll('copy32', 'other')],
    ['ABI mismatch', (e: string) => e.replace('abi=7', 'abi=9')],
    ['exit mismatch', (e: string) => e.replace('0x50 0xc0', '0x50 0xb0')],
  ])('rejects malformed ELF: %s', (_label, mutate) => {
    const input = load('copy32'), result = recoverSass(input.sass, mutate(input.elf));
    expect(result.status).not.toBe('emitted'); expect(result.code).toBeNull();
  });

  it('requires bounded ASCII inputs and reports that comments are not decoding authentication', () => {
    const input = load('copy32');
    expect(recoverSass(' '.repeat(MAX_SASS_RECOVERY_BYTES+1), input.elf).status).toBe('invalid');
    expect(recoverSass(input.sass+'\0', input.elf).status).toBe('invalid');
    expect(recoverSass(input.sass+' '.repeat(2049), input.elf).status).toBe('invalid');
    expect(recoverSass(input.sass, input.elf).assumptions[0]).toContain('do not validate mnemonic decoding');
  });
});
