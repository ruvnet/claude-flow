/**
 * ruRE CUDA launch plan, part 2 (ADR-501): what `analyzeCuda` found, turned into a plan for measuring. For each kernel of each architecture: the
 * theoretical occupancy at a set of block sizes, what limits it, and a few plain flags; and, on request, a small CUDA driver-API program (as text)
 * that a person can build and run to check those numbers on their own GPU. Pure: data in, data and text out. Nothing here compiles, loads or runs
 * GPU code, and the harness text holds nothing taken from the analyzed file (the kernel name and the file are arguments to the program).
 */
import type { CudaInfo, CudaKernel } from './cuda-parse.js';
import { limitsFor, occupancy, type Limiter, type Provenance } from './cuda-occupancy.js';

export const DEFAULT_BLOCK_SIZES: readonly number[] = [32, 64, 96, 128, 192, 256, 384, 512, 768, 1024];
export const MAX_BLOCK_SIZES = 24;
export const MAX_DYNAMIC_SHARED_BYTES = 1024 * 1024;
export const MAX_PLANNED_KERNELS = 200;

export interface PlanOptions {
  /** Only this architecture (`sm_86`). */
  arch?: string;
  blockSizes?: readonly number[];
  /** Dynamic shared memory per block the launch will ask for; it is not in the file, so it is a parameter. */
  dynamicSharedBytes?: number;
  includeHarness?: boolean;
}

export type PlanFlag = 'local-memory' | 'register-limited' | 'shared-memory-limited';

export interface PlannedBlockSize {
  blockSize: number;
  activeBlocksPerSM: number;
  activeWarpsPerSM: number;
  /** 0 to 1, four places. */
  occupancy: number;
  limitedBy: Limiter[];
}

export interface PlannedKernel {
  name: string;
  identifier: string | null;
  /** `staticSharedBytes` is the figure the driver and occupancy calculation use; `sharedSectionBytes` is what the file's section says (cuobjdump's SHARED), which differs on sm_90 and later. */
  resources: { registers: number | null; staticSharedBytes: number; sharedSectionBytes: number; localBytes: number; constantBytes: number | null; codeBytes: number | null };
  /** Absent when the file gave no register count: occupancy cannot be worked out without it. */
  blockSizes?: PlannedBlockSize[];
  best?: { blockSizes: number[]; occupancy: number; limitedBy: Limiter[] };
  flags: PlanFlag[];
  note?: string;
}

export interface PlannedArch {
  arch: string;
  /** False when there is no limits table for this architecture; then there are no kernels below. */
  supported: boolean;
  provenance: Provenance | null;
  limits?: { maxThreadsPerSM: number; maxBlocksPerSM: number; regsPerSM: number; sharedPerSM: number; sharedReservedPerBlock: number };
  kernels: PlannedKernel[];
  note?: string;
}

export interface LaunchPlan {
  archs: PlannedArch[];
  blockSizes: number[];
  dynamicSharedBytes: number;
  assumptions: string[];
  harness?: string;
  truncated: boolean;
}

export const ASSUMPTIONS: readonly string[] = [
  'Theoretical occupancy: how many warps can be resident on one multiprocessor given the kernel\'s registers and static shared memory. It bounds, and does not predict, performance.',
  'Static shared memory is the amount in the file, less the 1 KiB the driver reserves per block where the compiler folds it into that figure (sm_90 and later); a kernel with no static shared section uses none. Dynamic shared memory is not in the file, so it is the dynamicSharedBytes parameter (default 0), the same for every kernel.',
  'Default shared-memory carveout and cache configuration, one block barrier per block (the default), no cluster launch, and no opt-in to more than 48 KiB of shared memory per block.',
  'The registers in the file are what the compiler chose for that architecture; the driver may JIT PTX to different numbers.',
  'Running the plan is a separate step that you take; nothing here compiles or runs GPU code.',
];

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

function cleanSizes(sizes: readonly number[] | undefined): number[] {
  const wanted = sizes === undefined ? [...DEFAULT_BLOCK_SIZES] : [...sizes];

  if (wanted.length === 0 || wanted.length > MAX_BLOCK_SIZES) throw new RangeError(`blockSizes must hold 1 to ${MAX_BLOCK_SIZES} sizes`);
  for (const size of wanted) if (!Number.isInteger(size) || size < 1 || size > 1024) throw new RangeError('each block size must be an integer from 1 to 1024');

  return [...new Set(wanted)].sort((a, b) => a - b);
}

function planKernel(kernel: CudaKernel, arch: string, sizes: number[], dynamic: number): PlannedKernel {
  const limits = limitsFor(arch)!;
  const sectionShared = kernel.sharedBytes ?? 0;
  const staticShared = Math.max(0, sectionShared - (limits.cubinSharedIncludesReserve ? limits.sharedReservedPerBlock : 0));
  const local = kernel.localBytes ?? 0;
  const out: PlannedKernel = {
    name: kernel.name,
    identifier: kernel.identifier,
    resources: { registers: kernel.registers, staticSharedBytes: staticShared, sharedSectionBytes: sectionShared, localBytes: local, constantBytes: kernel.constantBytes, codeBytes: kernel.codeBytes },
    flags: [],
  };

  if (local > 0) out.flags.push('local-memory');
  if (kernel.registers === null || kernel.registers < 1) {
    out.note = 'the file holds no register count for this kernel, so occupancy cannot be worked out';

    return out;
  }

  out.blockSizes = sizes.map((blockSize) => {
    const r = occupancy(limits, { registers: kernel.registers as number, staticSharedBytes: staticShared, dynamicSharedBytes: dynamic, blockSize });

    return { blockSize, activeBlocksPerSM: r.blocks, activeWarpsPerSM: r.activeWarps, occupancy: round4(r.occupancy), limitedBy: r.limiters };
  });

  const top = Math.max(...out.blockSizes.map((b) => b.occupancy));
  const best = out.blockSizes.filter((b) => b.occupancy === top);

  if (top > 0) {
    // The limiters at the smallest best size are the ones to report: a larger one only repeats them.
    const first = best[0] as PlannedBlockSize;

    out.best = { blockSizes: best.map((b) => b.blockSize), occupancy: top, limitedBy: first.limitedBy };
    if (top < 1 && first.limitedBy.includes('registers')) out.flags.push('register-limited');
    if (top < 1 && first.limitedBy.includes('sharedMemory')) out.flags.push('shared-memory-limited');
  } else out.note = 'no listed block size can launch with these resources';

  return out;
}

export function planCuda(info: CudaInfo, options: PlanOptions = {}): LaunchPlan {
  const sizes = cleanSizes(options.blockSizes);
  const dynamic = options.dynamicSharedBytes ?? 0;

  if (!Number.isInteger(dynamic) || dynamic < 0 || dynamic > MAX_DYNAMIC_SHARED_BYTES) throw new RangeError(`dynamicSharedBytes must be an integer from 0 to ${MAX_DYNAMIC_SHARED_BYTES}`);

  const wanted = options.arch === undefined ? info.cubinArchs : [options.arch];
  const archs: PlannedArch[] = [];
  let planned = 0;
  let truncated = false;

  for (const arch of wanted) {
    const limits = limitsFor(arch);

    if (limits === null) {
      archs.push({ arch, supported: false, provenance: null, kernels: [], note: `no occupancy limits are tabulated for ${arch}` });
      continue;
    }

    const entries = info.kernels.filter((kernel) => kernel.isEntry && kernel.arch === arch);
    const kernels: PlannedKernel[] = [];

    for (const kernel of entries) {
      if (planned >= MAX_PLANNED_KERNELS) {
        truncated = true;
        break;
      }
      kernels.push(planKernel(kernel, arch, sizes, dynamic));
      planned++;
    }

    archs.push({
      arch,
      supported: true,
      provenance: limits.provenance,
      limits: { maxThreadsPerSM: limits.maxThreadsPerSM, maxBlocksPerSM: limits.maxBlocksPerSM, regsPerSM: limits.regsPerSM, sharedPerSM: limits.sharedPerSM, sharedReservedPerBlock: limits.sharedReservedPerBlock },
      kernels,
      ...(entries.length === 0 && { note: `${arch} is in the file but holds no launchable kernel` }),
    });
  }

  const noCubins = info.cubinArchs.length === 0;

  return {
    archs,
    blockSizes: sizes,
    dynamicSharedBytes: dynamic,
    assumptions: [...ASSUMPTIONS, ...(noCubins ? ['The file holds no compiled code for any architecture (PTX only, or nothing readable), so there are no register counts to plan from.'] : [])],
    ...(options.includeHarness === true && { harness: HARNESS_SOURCE }),
    truncated,
  };
}

/**
 * A program a person can build and run. It is text, fixed in this file: it contains nothing from the analyzed file. Run as
 *   ./occ_check <file.cubin|file.fatbin> <kernel name as listed> [dynamicSharedBytes]
 * it asks the CUDA driver how many blocks fit per multiprocessor at each block size (compare with the plan), and, if built with -DRURE_BENCH and a
 * rure_bench.h of your own that sets up the kernel's arguments, times launches. It loads the file's code onto the GPU; the benchmark mode runs it.
 */
export const HARNESS_SOURCE = `// occ_check.cpp: written by ruflo's rure_cuda_launch_plan. ruRE did not build or run this; building and running it is your decision.
// Build:  nvcc -O2 -o occ_check occ_check.cpp -lcuda            (add -DRURE_BENCH with your own rure_bench.h to time launches)
// Run:    ./occ_check <file.cubin|file.fatbin> <kernel name> [dynamicSharedBytes]
// Without RURE_BENCH it loads the code onto device 0 and asks the driver for occupancy; it launches nothing.
// With RURE_BENCH it LAUNCHES THE KERNEL with the arguments your rure_bench.h gives it. Only do that for code you trust, on a GPU you can spare.
#include <cuda.h>
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <vector>
#ifdef RURE_BENCH
// rure_bench.h must define:
//   bool rure_prepare(void*** kernelParams);   allocate buffers, fill an array of pointers to the kernel's arguments
//   unsigned rure_grid(int blockSize);         how many blocks to launch at this block size
//   void rure_release();
#include "rure_bench.h"
#endif

#define CK(call) do { CUresult r_ = (call); if (r_ != CUDA_SUCCESS) { const char* m_ = nullptr; cuGetErrorString(r_, &m_); fprintf(stderr, "line %d: %s\\n", __LINE__, m_ ? m_ : "error"); return 1; } } while (0)

int main(int argc, char** argv) {
  if (argc < 3) { fprintf(stderr, "usage: %s <file.cubin|file.fatbin> <kernel name> [dynamicSharedBytes]\\n", argv[0]); return 2; }
  size_t dyn = argc > 3 ? strtoull(argv[3], nullptr, 10) : 0;
  std::ifstream in(argv[1], std::ios::binary);
  std::vector<char> image((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
  if (image.empty()) { fprintf(stderr, "cannot read %s\\n", argv[1]); return 2; }

  CK(cuInit(0));
  CUdevice dev; CK(cuDeviceGet(&dev, 0));
  CUcontext ctx; CK(cuDevicePrimaryCtxRetain(&ctx, dev)); CK(cuCtxSetCurrent(ctx));
  CUmodule mod; CK(cuModuleLoadData(&mod, image.data()));
  CUfunction fn; CK(cuModuleGetFunction(&fn, mod, argv[2]));

  int regs, shared, local, maxThreads, maxThreadsSM, major, minor, blocksSM, regsSM, sharedSM, reserved, optin;
  CK(cuFuncGetAttribute(&regs, CU_FUNC_ATTRIBUTE_NUM_REGS, fn));
  CK(cuFuncGetAttribute(&shared, CU_FUNC_ATTRIBUTE_SHARED_SIZE_BYTES, fn));
  CK(cuFuncGetAttribute(&local, CU_FUNC_ATTRIBUTE_LOCAL_SIZE_BYTES, fn));
  CK(cuFuncGetAttribute(&maxThreads, CU_FUNC_ATTRIBUTE_MAX_THREADS_PER_BLOCK, fn));
  CK(cuDeviceGetAttribute(&maxThreadsSM, CU_DEVICE_ATTRIBUTE_MAX_THREADS_PER_MULTIPROCESSOR, dev));
  CK(cuDeviceGetAttribute(&major, CU_DEVICE_ATTRIBUTE_COMPUTE_CAPABILITY_MAJOR, dev));
  CK(cuDeviceGetAttribute(&minor, CU_DEVICE_ATTRIBUTE_COMPUTE_CAPABILITY_MINOR, dev));
  CK(cuDeviceGetAttribute(&blocksSM, CU_DEVICE_ATTRIBUTE_MAX_BLOCKS_PER_MULTIPROCESSOR, dev));
  CK(cuDeviceGetAttribute(&regsSM, CU_DEVICE_ATTRIBUTE_MAX_REGISTERS_PER_MULTIPROCESSOR, dev));
  CK(cuDeviceGetAttribute(&sharedSM, CU_DEVICE_ATTRIBUTE_MAX_SHARED_MEMORY_PER_MULTIPROCESSOR, dev));
  CK(cuDeviceGetAttribute(&reserved, CU_DEVICE_ATTRIBUTE_RESERVED_SHARED_MEMORY_PER_BLOCK, dev));
  CK(cuDeviceGetAttribute(&optin, CU_DEVICE_ATTRIBUTE_MAX_SHARED_MEMORY_PER_BLOCK_OPTIN, dev));
  printf("device sm_%d%d: maxThreadsPerSM %d, maxBlocksPerSM %d, regsPerSM %d, sharedPerSM %d, sharedReservedPerBlock %d, sharedPerBlockOptin %d\\n", major, minor, maxThreadsSM, blocksSM, regsSM, sharedSM, reserved, optin);
  printf("kernel: registers %d, static shared %d, local %d, max threads per block %d\\n", regs, shared, local, maxThreads);
  printf("blockSize activeBlocksPerSM activeWarpsPerSM occupancy%s\\n",
#ifdef RURE_BENCH
         " medianMs");
#else
         "");
#endif

  const int sizes[] = {32, 64, 96, 128, 192, 256, 384, 512, 768, 1024};
  for (int b : sizes) {
    int blocks = 0;
    if (cuOccupancyMaxActiveBlocksPerMultiprocessor(&blocks, fn, b, dyn) != CUDA_SUCCESS) blocks = 0;
    int warps = blocks * ((b + 31) / 32);
    printf("%d %d %d %.4f", b, blocks, warps, (double)warps / (maxThreadsSM / 32));
#ifdef RURE_BENCH
    double ms = -1;
    if (blocks > 0) {
      void** params = nullptr;
      if (!rure_prepare(&params)) { fprintf(stderr, "rure_prepare failed\\n"); return 1; }
      CUevent t0, t1; CK(cuEventCreate(&t0, CU_EVENT_DEFAULT)); CK(cuEventCreate(&t1, CU_EVENT_DEFAULT));
      std::vector<float> times;
      for (int i = 0; i < 23; i++) {
        CK(cuEventRecord(t0, 0));
        CK(cuLaunchKernel(fn, rure_grid(b), 1, 1, b, 1, 1, (unsigned)dyn, 0, params, 0));
        CK(cuEventRecord(t1, 0)); CK(cuEventSynchronize(t1));
        float t; CK(cuEventElapsedTime(&t, t0, t1));
        if (i >= 3) times.push_back(t);
      }
      std::sort(times.begin(), times.end());
      ms = times[times.size() / 2];
      rure_release();
    }
    printf(" %.4f", ms);
#endif
    printf("\\n");
  }
  return 0;
}
`;
