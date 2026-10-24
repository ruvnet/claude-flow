/**
 * ruRE Phase 5 (ADR-0006): the CUDA reader against REAL nvcc output. The fixtures in __tests__/fixtures/cuda/ were built here with nvcc 13.0
 * and 12.8 (k.cu in that folder); the `*.cuobjdump.txt` beside each is cuobjdump's own answer, kept as ground truth, and the tests compare
 * against it (kernel names, register counts, constant-bank sizes, how many cubins and PTX files and for which architecture).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeCuda, type CudaInfo } from '../src/rure/cuda-parse.js';
import { defaultZstd } from '../src/rure/cuda-fatbin.js';
import { smOfFlags } from '../src/rure/cuda-cubin.js';

const DIR = join(__dirname, 'fixtures', 'cuda');
const load = (name: string): Buffer => readFileSync(join(DIR, name));
const truth = (name: string): string => readFileSync(join(DIR, `${name}.cuobjdump.txt`), 'utf8');

/** `-res-usage` as cuobjdump printed it: per `arch = sm_NN` block, each function's REG and CONSTANT[0]. */
function resUsage(text: string): Record<string, Record<string, { reg: number; constant0: number }>> {
  const out: Record<string, Record<string, { reg: number; constant0: number }>> = {};

  for (const block of text.split('Fatbin elf code:').slice(1)) {
    const arch = /arch = (sm_\d+)/.exec(block)?.[1] as string;

    out[arch] ??= {};
    for (const m of block.matchAll(/Function (\S+):\s+REG:(\d+) .*?CONSTANT\[0\]:(\d+)/g)) (out[arch] as Record<string, { reg: number; constant0: number }>)[m[1] as string] = { reg: Number(m[2]), constant0: Number(m[3]) };
  }

  return out;
}
const lists = (text: string) => ({ cubins: [...text.matchAll(/^ELF file\s+\d+: \S+\.sm_(\d+)\.cubin$/gm)].map(m => `sm_${m[1]}`), ptx: [...text.matchAll(/^PTX file\s+\d+: \S+\.sm_(\d+)\.ptx$/gm)].map(m => `sm_${m[1]}`) });
const entryKernels = (info: CudaInfo) => info.kernels.filter(k => k.isEntry);
const HAVE_ZSTD = defaultZstd !== null;

/** What the tool says must equal what cuobjdump says, whatever the architecture and compression. */
function expectMatchesGroundTruth(info: CudaInfo, name: string): void {
  const { cubins, ptx } = lists(truth(name));
  const usage = resUsage(truth(name));

  expect(info.entries.filter(e => e.kind === 'cubin').map(e => e.arch)).toEqual(cubins);
  expect(info.entries.filter(e => e.kind === 'ptx').map(e => e.arch)).toEqual(ptx);

  for (const [arch, fns] of Object.entries(usage)) {
    for (const [fn, expected] of Object.entries(fns)) {
      const found = info.kernels.find(k => k.name === fn && k.arch === arch);

      expect(found, `${fn} in ${arch}`).toBeDefined();
      expect(found?.isEntry).toBe(true);
      expect(found?.registers, `${fn} registers in ${arch}`).toBe(expected.reg);
      expect(found?.constantBytes, `${fn} constant bank 0 in ${arch}`).toBe(expected.constant0);
    }
  }
}

describe('a host binary from nvcc 13.0 (zstd PTX)', () => {
  const info = analyzeCuda(load('host-default'));

  it('is a host file with its fatbin located and the CUDA names it carries', () => {
    expect(info.source).toBe('host');
    expect(info.hostSection?.name).toBe('.nv_fatbin');
    expect(info.hostSignals).toEqual(expect.arrayContaining(['.nv_fatbin', '.nvFatBinSegment']));
    expect(info.hostSignals.some(s => /cudart/.test(s))).toBe(true);
  });

  it('has two containers and three entries: two cubins and one PTX, all sm_80', () => {
    expect(info.containers).toBe(2);
    expect(info.entries.map(e => [e.kind, e.arch])).toEqual([['cubin', 'sm_80'], ['cubin', 'sm_80'], ['ptx', 'sm_80']]);
    expect(info.cubinArchs).toEqual(['sm_80']);
    expect(info.ptxArchs).toEqual(['sm_80']);
  });

  it('matches cuobjdump: the cubins, the kernels, their registers and constant bank', () => {
    expectMatchesGroundTruth(info, 'host-default');
    expect(entryKernels(info).map(k => k.name).sort()).toEqual(['_Z12scale_secretPfi', '_Z5saxpyifPKfPf']);
    expect(entryKernels(info).map(k => k.identifier).sort()).toEqual(['saxpy', 'scale_secret']);
  });

  it('gives code size and an instruction estimate (SM 8.0: 16-byte instructions)', () => {
    const saxpy = info.kernels.find(k => k.identifier === 'saxpy')!;

    expect(saxpy.codeBytes).toBe(384);
    expect(saxpy.instructionEstimate).toBe(24);
    expect(saxpy.sharedBytes).toBeNull();
  });

  it.skipIf(!HAVE_ZSTD)('reads the zstd PTX: size equals the header, target and kernels', () => {
    const ptx = info.entries.find(e => e.kind === 'ptx')!;

    expect(ptx.compressed).toBe('zstd');
    expect(ptx.read).toBe(true);
    expect(ptx.size).toBe(1464);
    expect(info.ptx[0]).toMatchObject({ version: '9.0', target: 'sm_80', addressSize: 64 });
    expect(info.ptx[0]?.entries.map(e => e.name).sort()).toEqual(['_Z12scale_secretPfi', '_Z5saxpyifPKfPf']);
    expect(info.ptx[0]?.entries.find(e => e.name === '_Z5saxpyifPKfPf')?.params).toBe(4);
  });

  it('on a Node with no zstd the PTX is reported as unread, and the cubins are still read', () => {
    const noZstd = analyzeCuda(load('host-default'), { zstd: null });
    const ptx = noZstd.entries.find(e => e.kind === 'ptx')!;

    expect(ptx).toMatchObject({ compressed: 'zstd', read: false, size: null });
    expect(ptx.note).toMatch(/cannot read zstd/);
    expect(noZstd.ptx).toEqual([]);
    expect(entryKernels(noZstd)).toHaveLength(2);
  });
});

describe('a host binary built for two architectures', () => {
  const info = analyzeCuda(load('host-multiarch'));

  it('lists both cubin architectures and the PTX architecture, with every kernel per architecture', () => {
    expect(info.cubinArchs).toEqual(['sm_75', 'sm_90']);
    expect(info.ptxArchs).toEqual(['sm_90']);
    expect(entryKernels(info)).toHaveLength(4);
    expectMatchesGroundTruth(info, 'host-multiarch');
  });
});

describe('a host binary whose cubins are compressed with zstd', () => {
  it.skipIf(!HAVE_ZSTD)('reads the compressed cubins and finds the kernels', () => {
    const info = analyzeCuda(load('host-cubinonly'));

    expect(info.entries.map(e => [e.kind, e.compressed, e.read])).toEqual([['cubin', 'zstd', true], ['cubin', 'zstd', true]]);
    expect(info.ptx).toEqual([]);
    expectMatchesGroundTruth(info, 'host-cubinonly');
  });
});

describe('binaries from nvcc 12.8 (LZ4)', () => {
  it('reads LZ4 PTX, and the sizes equal the headers', () => {
    const info = analyzeCuda(load('host-cuda128'));
    const ptx = info.entries.find(e => e.kind === 'ptx')!;

    expect(ptx).toMatchObject({ compressed: 'lz4', read: true, size: 1480 });
    expect(info.ptx[0]).toMatchObject({ target: 'sm_80' });
    expect(info.ptx[0]?.version).toMatch(/^8\./);
    expectMatchesGroundTruth(info, 'host-cuda128');
  });

  it('reads LZ4 cubins too (everything compressed) and finds the kernels with their registers', () => {
    const info = analyzeCuda(load('host-cuda128-all'));

    expect(info.entries.map(e => e.compressed)).toEqual(['lz4', 'lz4', 'lz4']);
    expect(info.entries.every(e => e.read)).toBe(true);
    expectMatchesGroundTruth(info, 'host-cuda128-all');
  });
});

describe('standalone files', () => {
  it('a fatbin with uncompressed PTX', () => {
    const info = analyzeCuda(load('k80.fatbin'));

    expect(info.source).toBe('fatbin');
    expect(info.entries.map(e => [e.kind, e.compressed])).toEqual([['cubin', 'none'], ['ptx', 'none']]);
    expect(info.ptx[0]?.entries.map(e => e.name).sort()).toEqual(['_Z12scale_secretPfi', '_Z5saxpyifPKfPf']);
    expectMatchesGroundTruth(info, 'k80.fatbin');
  });

  it('a cubin', () => {
    const info = analyzeCuda(load('k80.cubin'));

    expect(info.source).toBe('cubin');
    expect(info.cubinArchs).toEqual(['sm_80']);
    expect(info.entries).toEqual([]);
    expect(entryKernels(info).map(k => [k.identifier, k.registers])).toEqual(expect.arrayContaining([['saxpy', 10], ['scale_secret', 8]]));
  });

  it('PTX text, and the text only when asked for', () => {
    const plain = analyzeCuda(load('k80.ptx'));
    const withText = analyzeCuda(load('k80.ptx'), { includePtx: true });

    expect(plain.source).toBe('ptx');
    expect(plain.ptx[0]).toMatchObject({ target: 'sm_80', addressSize: 64 });
    expect(plain.ptx[0]?.text).toBeUndefined();
    expect(withText.ptx[0]?.text).toContain('.visible .entry _Z5saxpyifPKfPf');
    expect(withText.ptx[0]?.textTruncated).toBe(false);
  });
});

describe('standalone cubins from nvcc 12.8 (the older ELF ABI, SM number in the low byte of e_flags)', () => {
  // CUDA 12.8 writes ELF OS ABI 51 for sm_70 to sm_90: sm_70 is e_flags 0x460546. Reading the second byte, as for CUDA 13 (OS ABI 65, sm_80 is 0x06005004),
  // gave "sm_5" for all of them. Found when a V100 and a T4 were to check the launch plan (ADR-501); the older fixtures here were all host binaries.
  for (const arch of [70, 75, 90]) {
    it(`sm_${arch}: the architecture, the kernels, their registers and constant bank equal cuobjdump's`, () => {
      const name = `k${arch}-cuda128.cubin`;
      const info = analyzeCuda(load(name));
      const expected = [...truth(name).matchAll(/Function (\S+):\s+REG:(\d+) .*?CONSTANT\[0\]:(\d+)/g)].map(m => ({ fn: m[1] as string, reg: Number(m[2]), constant0: Number(m[3]) }));

      expect(info.source).toBe('cubin');
      expect(info.cubinArchs).toEqual([`sm_${arch}`]);
      expect(expected.length).toBe(2);

      for (const e of expected) {
        const found = entryKernels(info).find(k => k.name === e.fn);

        expect(found, e.fn).toBeDefined();
        expect(found?.arch).toBe(`sm_${arch}`);
        expect(found?.registers, `${e.fn} registers`).toBe(e.reg);
        expect(found?.constantBytes, `${e.fn} constant bank 0`).toBe(e.constant0);
        expect(found?.instructionEstimate, `${e.fn} instructions (16-byte, SM 7.0 and later)`).toBe(Math.floor((found?.codeBytes as number) / 16));
      }
    });
  }

  it('decodes e_flags by the ELF OS ABI, and by plausibility for one it has not seen', () => {
    expect(smOfFlags(0x460546, 51)).toBe(70);
    expect(smOfFlags(0x4b054b, 51)).toBe(75);
    expect(smOfFlags(0x5a055a, 51)).toBe(90);
    expect(smOfFlags(0x06005004, 65)).toBe(80);
    expect(smOfFlags(0x06007802, 65)).toBe(120);
    expect(smOfFlags(0x460546, 99)).toBe(70);
    expect(smOfFlags(0x06005004, 99)).toBe(80);
    expect(smOfFlags(0x00000000, 99)).toBeNull();
    expect(smOfFlags(0xffffffff, 99)).toBeNull();
  });
});

describe('not a CUDA file', () => {
  it('a host binary without a fatbin says so', () => {
    const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]), Buffer.alloc(120)]);
    const info = analyzeCuda(elf);

    expect(info.source).toBe('host');
    expect(info.entries).toEqual([]);
    expect(info.warnings.join(' ')).toMatch(/no \.nv_fatbin section|does not look like a CUDA/);
  });

  it('arbitrary bytes do not throw', () => {
    expect(() => analyzeCuda(Buffer.from('hello world, this is not a binary'))).not.toThrow();
    expect(() => analyzeCuda(Buffer.alloc(0))).not.toThrow();
  });
});
