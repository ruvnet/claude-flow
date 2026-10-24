/**
 * The occupancy model against NVIDIA's reference (ADR-501). Builds a small C++ program around the toolkit's own `cuda_occupancy.h` (not shipped
 * or copied here: it is read from the installed toolkit), asks it the same 221,277 questions per architecture that rure-cuda-occupancy-grid.ts
 * asks the model, and requires every answer, and every "limited by" set, to match. Skips, saying so, without g++ or the header (as in CI);
 * rure-cuda-occupancy.test.ts holds the committed fingerprints of these answers so CI still checks the model without a toolkit.
 *   cd v3/@claude-flow/cli && npx vitest run __tests__/rure-cuda-occupancy-oracle.test.ts
 *   RURE_OCC_PRINT_GOLDEN=1 ... prints the fingerprints to commit
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ARCH_LIMITS } from '../src/rure/cuda-occupancy.js';
import { gridLines } from './rure-cuda-occupancy-grid.js';

const HEADER_DIRS = [process.env.CUDA_HOME ? join(process.env.CUDA_HOME, 'include') : '', '/usr/local/cuda/include', '/usr/local/cuda-13.0/include', '/usr/local/cuda-12.8/include'];
const HEADER_DIR = HEADER_DIRS.find((dir) => dir !== '' && existsSync(join(dir, 'cuda_occupancy.h'))) ?? null;
const GXX = spawnSync('g++', ['--version'], { encoding: 'utf8' }).status === 0;
const READY = HEADER_DIR !== null && GXX;

if (!READY) console.log(`SKIP occupancy oracle: needs g++ (${GXX}) and cuda_occupancy.h (${HEADER_DIR})`);

const ORACLE = `
#include <cstdio>
#include <cstdlib>
#include <climits>
#include <vector>
#include "cuda_occupancy.h"
int main(int argc, char** argv) {
  if (argc != 11) return 2;
  cudaOccDeviceProp p{};
  p.computeMajor = atoi(argv[1]); p.computeMinor = atoi(argv[2]);
  p.maxThreadsPerMultiprocessor = atoi(argv[3]); p.maxThreadsPerBlock = atoi(argv[4]);
  p.regsPerBlock = atoi(argv[5]); p.regsPerMultiprocessor = atoi(argv[6]);
  p.warpSize = 32; p.sharedMemPerBlock = atol(argv[7]); p.sharedMemPerMultiprocessor = atol(argv[8]);
  p.sharedMemPerBlockOptin = atol(argv[9]); p.reservedSharedMemPerBlock = atol(argv[10]); p.numSms = 1;
  cudaOccDeviceState st{}; st.cacheConfig = CACHE_PREFER_NONE; st.carveoutConfig = SHAREDMEM_CARVEOUT_DEFAULT;
  std::vector<int> blocks; for (int b = 32; b <= 1024; b += 32) blocks.push_back(b);
  for (int b : {1, 17, 31, 33, 48, 100, 250, 1000, 1023}) blocks.push_back(b);
  std::vector<long> statics = {0, 1, 512, 4096, 16384, 40000, 49152};
  std::vector<long> dyns = {0, 1024, 16384};
  for (int regs = 1; regs <= 257; regs++) for (int b : blocks) for (long s : statics) for (long d : dyns) {
    cudaOccFuncAttributes a{}; a.maxThreadsPerBlock = INT_MAX; a.numRegs = regs; a.sharedSizeBytes = s;
    a.partitionedGCConfig = PARTITIONED_GC_OFF; a.shmemLimitConfig = FUNC_SHMEM_LIMIT_DEFAULT; a.maxDynamicSharedSizeBytes = 0; a.numBlockBarriers = 1;
    cudaOccResult r{};
    cudaOccError e = cudaOccMaxActiveBlocksPerMultiprocessor(&r, &p, &a, &st, b, (size_t)d);
    printf("%d %d %ld %ld %d %u\\n", regs, b, s, d, e == CUDA_OCC_SUCCESS ? r.activeBlocksPerMultiprocessor : -1, e == CUDA_OCC_SUCCESS ? r.limitingFactors : 0u);
  }
}
`;

let dir = '';

beforeAll(() => {
  if (!READY) return;
  dir = mkdtempSync(join(tmpdir(), 'ruflo-occ-oracle-'));
  writeFileSync(join(dir, 'oracle.cpp'), ORACLE);

  const built = spawnSync('g++', ['-O2', '-std=c++17', `-I${HEADER_DIR}`, '-o', join(dir, 'oracle'), join(dir, 'oracle.cpp')], { encoding: 'utf8' });

  if (built.status !== 0) throw new Error(`oracle build failed: ${built.stderr}`);
});

afterAll(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!READY)('the occupancy model equals NVIDIA\'s cuda_occupancy.h on the whole grid', () => {
  for (const limits of Object.values(ARCH_LIMITS)) {
    it(`${limits.arch}: every combination, blocks and limiting set`, () => {
      const args = [limits.major, limits.minor, limits.maxThreadsPerSM, limits.maxThreadsPerBlock, limits.regsPerBlock, limits.regsPerSM, limits.sharedPerBlock, limits.sharedPerSM, limits.sharedPerBlockOptin, limits.sharedReservedPerBlock].map(String);
      const done = spawnSync(join(dir, 'oracle'), args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

      expect(done.status).toBe(0);

      const expected = done.stdout.trimEnd().split('\n');
      const mine = [...gridLines(limits)];

      expect(mine.length).toBe(expected.length);

      const wrong: string[] = [];

      for (let i = 0; i < expected.length && wrong.length < 8; i++) if (mine[i] !== expected[i]) wrong.push(`model "${mine[i]}" vs NVIDIA "${expected[i]}"`);

      expect(wrong, wrong.join('\n')).toEqual([]);

      if (process.env.RURE_OCC_PRINT_GOLDEN === '1') console.log(`GOLDEN ${limits.arch} ${createHash('sha256').update(expected.join('\n')).digest('hex')} ${expected.length}`);
    }, 120_000);
  }
});
