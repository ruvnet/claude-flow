/**
 * ruRE Phase 5 (ADR-0006), live end to end: compiles real CUDA programs with the local toolkit, runs the BUILT ruflo CLI's rure_analyze_cuda
 * on them (`ruflo mcp exec -t rure_analyze_cuda`, as an agent or the console would), and compares the answer with `cuobjdump`'s own, run live.
 * Skips, and says so, when there is no nvcc and cuobjdump (as in CI) or the CLI has not been built with the tool. The committed fixtures cover
 * the same ground without a toolkit (rure-cuda-parse.test.ts).
 *   cd v3/@claude-flow/cli && npx tsc && npx vitest run __tests__/rure-cuda-live.test.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI_DIR = resolve(__dirname, '..');
const CLI = join(CLI_DIR, 'bin', 'cli.js');
const TOOLS = join(CLI_DIR, 'dist', 'src', 'mcp-tools', 'rure-tools.js');
const HAVE_CLI = existsSync(CLI) && existsSync(TOOLS) && readFileSync(TOOLS, 'utf8').includes('rure_analyze_cuda');

function which(name: string): string | null {
  for (const dir of ['/usr/local/cuda/bin', ...(process.env.PATH ?? '').split(':')]) {
    if (dir !== '' && existsSync(join(dir, name))) return join(dir, name);
  }

  return null;
}

const NVCC = which('nvcc');
const CUOBJDUMP = which('cuobjdump');
const READY = HAVE_CLI && NVCC !== null && CUOBJDUMP !== null;

if (!READY) console.log(`SKIP ruRE CUDA live e2e: needs a built CLI with rure_analyze_cuda (${HAVE_CLI}), nvcc (${NVCC}) and cuobjdump (${CUOBJDUMP})`);

const SOURCE = `
#include <cstdio>
__global__ void saxpy(int n, float a, const float* x, float* y) { int i = blockIdx.x*blockDim.x + threadIdx.x; if (i < n) y[i] = a*x[i] + y[i]; }
__global__ void scale_secret(float* v, int n) { int i = threadIdx.x; if (i < n) v[i] *= 31337.0f; }
__device__ float helper_fn(float v) { return v * 2.0f; }
__global__ void uses_shared(float* v) { __shared__ float tile[256]; tile[threadIdx.x] = helper_fn(v[threadIdx.x]); __syncthreads(); v[threadIdx.x] = tile[255 - threadIdx.x]; }
int main() { float *x,*y; cudaMalloc(&x,4096); cudaMalloc(&y,4096); saxpy<<<4,256>>>(1024,2.0f,x,y); scale_secret<<<1,256>>>(y,256); uses_shared<<<1,256>>>(y); cudaDeviceSynchronize(); puts("done"); return 0; }
`;

let dir = '';

function sh(cmd: string, args: string[]): string {
  const done = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', timeout: 240_000 });

  if (done.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${done.stderr}`);

  return done.stdout;
}

/** The built CLI's answer for a file, as an agent gets it. */
function ruflo(path: string): Record<string, any> {
  const done = spawnSync(process.execPath, [CLI, 'mcp', 'exec', '-t', 'rure_analyze_cuda', '-p', JSON.stringify({ path })], { cwd: dir, encoding: 'utf8', timeout: 120_000, env: { ...process.env, NO_COLOR: '1' } });
  const wrapper = /\{\s*"content"[\s\S]*\}\s*$/.exec(done.stdout)?.[0];

  expect(wrapper, `the CLI printed a tool result: ${done.stdout.slice(0, 300)} ${done.stderr.slice(0, 300)}`).toBeDefined();

  return JSON.parse(JSON.parse(wrapper as string).content[0].text);
}

/** cuobjdump -res-usage, live: per arch and function, REG and CONSTANT[0] and SHARED. */
function groundTruth(file: string): Record<string, Record<string, { reg: number; constant0: number; shared: number }>> {
  const out: Record<string, Record<string, { reg: number; constant0: number; shared: number }>> = {};

  for (const block of sh(CUOBJDUMP!, ['-res-usage', file]).split('Fatbin elf code:').slice(1)) {
    const arch = /arch = (sm_\d+)/.exec(block)?.[1] as string;

    out[arch] ??= {};
    for (const m of block.matchAll(/Function (\S+):\s+REG:(\d+) STACK:\d+ SHARED:(\d+) .*?CONSTANT\[0\]:(\d+)/g)) (out[arch] as any)[m[1] as string] = { reg: Number(m[2]), shared: Number(m[3]), constant0: Number(m[4]) };
  }

  return out;
}

beforeAll(() => {
  if (!READY) return;

  dir = mkdtempSync(join(tmpdir(), 'ruflo-rure-cuda-live-'));
  writeFileSync(join(dir, 'k.cu'), SOURCE);
}, 30_000);

afterAll(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!READY)('rure_analyze_cuda against freshly compiled programs and cuobjdump', () => {
  const variants: { name: string; flags: string[] }[] = [
    { name: 'default', flags: ['-cudart', 'shared', '-gencode', 'arch=compute_80,code=[sm_80,compute_80]'] },
    { name: 'cubin-only-compressed', flags: ['-cudart', 'shared', '-gencode', 'arch=compute_80,code=sm_80', '-Xfatbin', '-compress-all'] },
    { name: 'two-archs', flags: ['-cudart', 'shared', '-gencode', 'arch=compute_75,code=sm_75', '-gencode', 'arch=compute_90,code=[sm_90,compute_90]'] },
    { name: 'static-runtime', flags: ['-gencode', 'arch=compute_80,code=[sm_80,compute_80]'] },
  ];

  for (const variant of variants) {
    it(`${variant.name}: kernels, registers, constant and shared memory equal cuobjdump's`, () => {
      sh(NVCC!, [...variant.flags, '-o', variant.name, 'k.cu']);

      const truth = groundTruth(variant.name);
      const tool = ruflo(join(dir, variant.name));

      expect(tool.success).toBe(true);
      expect(tool.source).toBe('host');
      expect(tool.screened).toBe(true);
      expect(Object.keys(truth).length).toBeGreaterThan(0);

      for (const [arch, fns] of Object.entries(truth)) {
        for (const [fn, expected] of Object.entries(fns)) {
          const found = tool.kernels.find((k: any) => k.name === fn && k.arch === arch);

          expect(found, `${fn} in ${arch}`).toBeDefined();
          expect(found.isEntry, `${fn} is a launchable kernel`).toBe(fn !== '_Z9helper_fnf');
          expect(found.registers, `${fn} registers in ${arch}`).toBe(expected.reg);
          expect(found.constantBytes, `${fn} constant bank 0 in ${arch}`).toBe(expected.constant0);
          expect(found.sharedBytes ?? 0, `${fn} shared memory in ${arch}`).toBe(expected.shared);
        }
      }

      const cuobjdumpArchs = [...new Set(Object.keys(truth))].sort();

      expect(tool.cubinArchs).toEqual(cuobjdumpArchs);
    });
  }

  it('the shared-memory kernel really reports its 1 KiB of static shared memory', () => {
    const tool = ruflo(join(dir, 'default'));
    const shared = tool.kernels.find((k: any) => k.identifier === 'uses_shared');

    expect(shared.sharedBytes).toBe(1024);
  });

  it('a standalone cubin and PTX from the same source read the same kernels', () => {
    sh(NVCC!, ['-cubin', '-arch=sm_80', '-o', 'k.cubin', 'k.cu']);
    sh(NVCC!, ['-ptx', '-arch=compute_80', '-o', 'k.ptx', 'k.cu']);

    const cubin = ruflo(join(dir, 'k.cubin'));
    const ptx = ruflo(join(dir, 'k.ptx'));

    expect(cubin.source).toBe('cubin');
    expect(ptx.source).toBe('ptx');
    expect(cubin.kernels.filter((k: any) => k.isEntry).map((k: any) => k.name).sort()).toEqual(ptx.ptx[0].entries.map((e: any) => e.name).sort());
  });

  it('a program that is not CUDA is said to be one, through the same tool', () => {
    writeFileSync(join(dir, 'plain.c'), 'int main(void){return 0;}\n');
    sh('cc', ['-o', 'plain', 'plain.c']);

    const tool = ruflo(join(dir, 'plain'));

    expect(tool.success).toBe(true);
    expect(tool.entries).toEqual([]);
    expect(tool.warnings.join(' ')).toMatch(/no \.nv_fatbin section/);
  });
});
