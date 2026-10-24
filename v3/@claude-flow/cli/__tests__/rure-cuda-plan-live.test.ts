/**
 * rure_cuda_launch_plan against a real GPU (ADR-501), end to end: compiles real kernels with different footprints for the GPU in this machine,
 * asks the BUILT ruflo CLI for the plan and the harness as an agent would, builds that harness with nvcc, runs it, and requires the CUDA driver's
 * own answers (registers, static shared memory, blocks per multiprocessor at each block size, and the device's limits) to equal the static plan.
 * Then builds the harness in benchmark mode against an argument file of its own and checks the timing path runs.
 * Skips, saying so, without nvcc, a GPU, or a CLI built with the tool (CI has none of them).
 *   cd v3 && pnpm -r build && cd @claude-flow/cli && npx vitest run __tests__/rure-cuda-plan-live.test.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI_DIR = resolve(__dirname, '..');
const CLI = join(CLI_DIR, 'bin', 'cli.js');
const TOOLS = join(CLI_DIR, 'dist', 'src', 'mcp-tools', 'rure-tools.js');
const HAVE_CLI = existsSync(CLI) && existsSync(TOOLS) && readFileSync(TOOLS, 'utf8').includes('rure_cuda_launch_plan');

function which(name: string): string | null {
  for (const dir of ['/usr/local/cuda/bin', ...(process.env.PATH ?? '').split(':')]) if (dir !== '' && existsSync(join(dir, name))) return join(dir, name);

  return null;
}

const NVCC = which('nvcc');
const SMI = which('nvidia-smi');
const smi = SMI === null ? null : spawnSync(SMI, ['--query-gpu=compute_cap', '--format=csv,noheader'], { encoding: 'utf8' });
const CAP = smi !== null && smi.status === 0 ? smi.stdout.trim().split('\n')[0]!.replace('.', '') : null;
const ARCH = CAP === null || !/^\d{2,3}$/.test(CAP) ? null : `sm_${CAP}`;
const READY = HAVE_CLI && NVCC !== null && ARCH !== null;

if (!READY) console.log(`SKIP ruRE launch-plan live e2e: needs a built CLI with rure_cuda_launch_plan (${HAVE_CLI}), nvcc (${NVCC}) and a GPU (${ARCH})`);

const SOURCE = `
extern "C" __global__ void saxpy(float a, const float* x, float* y, int n) { int i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) y[i] = a * x[i] + y[i]; }
extern "C" __global__ void tile_static(const float* in, float* out) { __shared__ float t[12288]; int i = threadIdx.x; for (int k = i; k < 12288; k += blockDim.x) t[k] = in[k]; __syncthreads(); float s = 0; for (int k = i; k < 12288; k += blockDim.x) s += t[(k * 7) % 12288]; out[blockIdx.x * blockDim.x + i] = s; }
extern "C" __global__ void dyn_tile(const float* in, float* out) { extern __shared__ float t[]; int i = threadIdx.x; t[i] = in[blockIdx.x * blockDim.x + i]; __syncthreads(); out[blockIdx.x * blockDim.x + i] = t[(i + 1) % blockDim.x]; }
extern "C" __global__ void many_live(const float* x, float* y, int n) {
  int i = blockIdx.x * blockDim.x + threadIdx.x; if (i >= n) return;
  float acc[112];
  #pragma unroll
  for (int j = 0; j < 112; j++) acc[j] = x[(i + j * 977) % n];
  #pragma unroll
  for (int r = 0; r < 6; r++) {
    #pragma unroll
    for (int j = 0; j < 112; j++) acc[j] = acc[j] * acc[(j + 1) % 112] + acc[(j + 37) % 112];
  }
  float s = 0;
  #pragma unroll
  for (int j = 0; j < 112; j++) s += acc[j];
  y[i] = s;
}
__global__ void mangled_reduce(const float* in, float* out, int n) { __shared__ float t[256]; int i = threadIdx.x; t[i] = in[blockIdx.x * 256 + i]; __syncthreads(); if (i == 0) { float s = 0; for (int k = 0; k < 256; k++) s += t[k]; out[blockIdx.x] = s; } }
`;

// The arguments of saxpy(float a, const float* x, float* y, int n), for benchmark mode.
const BENCH_HEADER = `
#include <cuda.h>
static float h_a = 2.0f; static int h_n = 1 << 22; static CUdeviceptr d_x = 0, d_y = 0; static void* h_params[4];
static bool rure_prepare(void*** kernelParams) {
  if (cuMemAlloc(&d_x, h_n * sizeof(float)) != CUDA_SUCCESS || cuMemAlloc(&d_y, h_n * sizeof(float)) != CUDA_SUCCESS) return false;
  cuMemsetD32(d_x, 0x3f800000, h_n); cuMemsetD32(d_y, 0, h_n);
  h_params[0] = &h_a; h_params[1] = &d_x; h_params[2] = &d_y; h_params[3] = &h_n; *kernelParams = h_params; return true;
}
static unsigned rure_grid(int blockSize) { return (h_n + blockSize - 1) / blockSize; }
static void rure_release() { cuMemFree(d_x); cuMemFree(d_y); }
`;

const DYNAMIC = 8192;
let dir = '';
let plan: any;

function sh(cmd: string, args: string[]): string {
  const done = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', timeout: 240_000 });

  if (done.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${done.stderr}\n${done.stdout}`);

  return done.stdout;
}

/** The built CLI's plan for a file, as an agent gets it. */
function askCli(path: string): any {
  const done = spawnSync(process.execPath, [CLI, 'mcp', 'exec', '-t', 'rure_cuda_launch_plan', '-p', JSON.stringify({ path, includeHarness: true, dynamicSharedBytes: DYNAMIC })], { cwd: dir, encoding: 'utf8', timeout: 120_000, env: { ...process.env, NO_COLOR: '1' } });
  const wrapper = /\{\s*"content"[\s\S]*\}\s*$/.exec(done.stdout)?.[0];

  expect(wrapper, `the CLI printed a tool result: ${done.stdout.slice(0, 300)} ${done.stderr.slice(0, 300)}`).toBeDefined();

  return JSON.parse(JSON.parse(wrapper as string).content[0].text);
}

interface Run { device: Record<string, number>; kernel: Record<string, number>; rows: { blockSize: number; blocks: number; warps: number; occupancy: number; ms?: number }[] }

function parseRun(out: string): Run {
  const lines = out.trim().split('\n');
  const num = (text: string, name: string): number => Number(new RegExp(`${name} (\\d+)`).exec(text)![1]);
  const device = lines[0]!;
  const kernel = lines[1]!;

  return {
    device: Object.fromEntries(['maxThreadsPerSM', 'maxBlocksPerSM', 'regsPerSM', 'sharedPerSM', 'sharedReservedPerBlock', 'sharedPerBlockOptin'].map((n) => [n, num(device, n)])),
    kernel: { registers: num(kernel, 'registers'), staticShared: num(kernel, 'static shared'), local: num(kernel, 'local') },
    rows: lines.slice(3).map((l) => { const [b, blocks, warps, occ, ms] = l.split(' ').map(Number); return { blockSize: b!, blocks: blocks!, warps: warps!, occupancy: occ!, ...(ms !== undefined && { ms }) }; }),
  };
}

beforeAll(() => {
  if (!READY) return;

  dir = mkdtempSync(join(tmpdir(), 'ruflo-rure-plan-live-'));
  writeFileSync(join(dir, 'k.cu'), SOURCE);
  sh(NVCC!, ['-cubin', `-arch=${ARCH}`, '-O3', '-o', 'k.cubin', 'k.cu']);
  plan = askCli(join(dir, 'k.cubin'));
  writeFileSync(join(dir, 'occ_check.cpp'), plan.harness);
  sh(NVCC!, ['-O2', '-o', 'occ_check', 'occ_check.cpp', '-lcuda']);
}, 300_000);

afterAll(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!READY)(`rure_cuda_launch_plan against this machine's GPU (${ARCH})`, () => {
  it('plans the architecture of the GPU in this machine, from the cubin alone', () => {
    expect(plan.success).toBe(true);
    expect(plan.archs.map((a: any) => a.arch)).toEqual([ARCH]);
    expect(plan.archs[0].supported).toBe(true);
    expect(plan.archs[0].kernels.map((k: any) => k.identifier ?? k.name).sort()).toEqual(['dyn_tile', 'mangled_reduce', 'many_live', 'saxpy', 'tile_static']);
  });

  it("the architecture table equals the device's own limits", () => {
    const run = parseRun(sh(join(dir, 'occ_check'), ['k.cubin', 'saxpy', String(DYNAMIC)]));
    const limits = plan.archs[0].limits;

    expect(run.device).toMatchObject({ maxThreadsPerSM: limits.maxThreadsPerSM, maxBlocksPerSM: limits.maxBlocksPerSM, regsPerSM: limits.regsPerSM, sharedPerSM: limits.sharedPerSM, sharedReservedPerBlock: limits.sharedReservedPerBlock });
  });

  it("every kernel: registers, static shared and local memory equal the driver's, and so does the occupancy at every block size", () => {
    for (const k of plan.archs[0].kernels) {
      const run = parseRun(sh(join(dir, 'occ_check'), ['k.cubin', k.name, String(DYNAMIC)]));
      const label = k.identifier ?? k.name;

      expect(run.kernel, label).toEqual({ registers: k.resources.registers, staticShared: k.resources.staticSharedBytes, local: k.resources.localBytes });
      expect(run.rows.map((r) => r.blockSize), label).toEqual(plan.blockSizes);

      for (const [i, row] of run.rows.entries()) {
        const planned = k.blockSizes[i];

        expect({ blocks: row.blocks, warps: row.warps }, `${label} @ ${row.blockSize}`).toEqual({ blocks: planned.activeBlocksPerSM, warps: planned.activeWarpsPerSM });
        expect(Math.abs(row.occupancy - planned.occupancy), `${label} @ ${row.blockSize}`).toBeLessThan(1e-4);
      }
    }
  });

  it('agrees on the interesting cases: a register-bound kernel, one that cannot launch with its shared memory, and the block-size ceiling', () => {
    const by = (name: string) => plan.archs[0].kernels.find((k: any) => (k.identifier ?? k.name) === name);

    // 128 registers: the driver caps a block at 512 threads, and the plan has nothing launchable above that.
    const live = by('many_live');

    expect(live.flags).toContain('register-limited');
    expect(live.blockSizes.filter((b: any) => b.blockSize > 512).every((b: any) => b.activeBlocksPerSM === 0)).toBe(true);
    // 48 KiB of static shared memory plus 8 KiB of dynamic: over the per-block limit, so nothing launches.
    expect(by('tile_static').blockSizes.every((b: any) => b.activeBlocksPerSM === 0)).toBe(true);
    expect(by('tile_static').note).toMatch(/no listed block size can launch/);
  });

  it('benchmark mode: built against an argument file, the harness launches the kernel and reports a time for each launchable size', () => {
    writeFileSync(join(dir, 'rure_bench.h'), BENCH_HEADER);
    sh(NVCC!, ['-O2', '-DRURE_BENCH', '-o', 'occ_bench', 'occ_check.cpp', '-lcuda']);

    const run = parseRun(sh(join(dir, 'occ_bench'), ['k.cubin', 'saxpy', '0']));

    for (const row of run.rows) {
      if (row.blocks > 0) expect(row.ms, `${row.blockSize}`).toBeGreaterThan(0);
      else expect(row.ms).toBe(-1);
    }
    expect(run.rows.filter((r) => (r.ms ?? -1) > 0).length).toBeGreaterThanOrEqual(8);
  });
});
