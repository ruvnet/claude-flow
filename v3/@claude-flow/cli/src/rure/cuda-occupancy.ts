/**
 * ruRE CUDA launch plan, part 1 (ADR-501): theoretical occupancy from what the static reader found. Given an architecture's limits and a
 * kernel's registers, static shared memory and a block size, how many blocks fit on one multiprocessor and which resource stops the next one.
 * Pure arithmetic over a table: no device, no driver, nothing is run. The model is the one CUDA's occupancy calculator uses (warp, block,
 * register and shared-memory limits, each with its allocation granularity); it was written here from that model and is checked, over the whole
 * grid of resource combinations, against NVIDIA's own `cuda_occupancy.h` (rure-cuda-occupancy-oracle.test.ts) and on real devices.
 * Theoretical occupancy bounds how many warps can be resident. It is not a performance number.
 */

export type Limiter = 'warps' | 'registers' | 'sharedMemory' | 'blocks' | 'barriers';

/** Where a table row's numbers come from: read off a device by the CUDA runtime, or taken from NVIDIA's documentation. */
export type Provenance = 'device-checked' | 'documentation';

export interface ArchLimits {
  /** `sm_NN`, as the fatbin names it. */
  arch: string;
  major: number;
  minor: number;
  maxThreadsPerSM: number;
  maxBlocksPerSM: number;
  maxThreadsPerBlock: number;
  regsPerSM: number;
  regsPerBlock: number;
  maxRegsPerThread: number;
  sharedPerSM: number;
  sharedPerBlock: number;
  sharedPerBlockOptin: number;
  /** Shared memory the driver reserves in every block (counted against the block's allocation). */
  sharedReservedPerBlock: number;
  /**
   * Whether a kernel's `.nv.shared.<kernel>` section already includes that reservation. From sm_90 it does (the compiler adds it, the driver reports
   * the size without it, and the occupancy calculation adds it back), so the figure to use is the section size less the reservation.
   */
  cubinSharedIncludesReserve: boolean;
  /** The shared-memory sizes an SM can be configured to, ascending; the SM's allocation rounds up to one of them. */
  carveouts: readonly number[];
  provenance: Provenance;
}

const K = 1024;
const WARP = 32;
const REG_UNIT = 256;
const SUB_PARTITIONS = 4;

const base = { maxThreadsPerBlock: 1024, regsPerSM: 65536, regsPerBlock: 65536, maxRegsPerThread: 256, sharedPerBlock: 48 * K } as const;

const row = (arch: string, major: number, minor: number, o: Omit<ArchLimits, 'arch' | 'major' | 'minor' | 'maxThreadsPerBlock' | 'regsPerSM' | 'regsPerBlock' | 'maxRegsPerThread' | 'sharedPerBlock'>): ArchLimits => ({ arch, major, minor, ...base, ...o });

/** Architectures with a table. Anything else gets no occupancy figure rather than a guess. */
export const ARCH_LIMITS: Readonly<Record<string, ArchLimits>> = Object.freeze({
  sm_70: row('sm_70', 7, 0, { maxThreadsPerSM: 2048, maxBlocksPerSM: 32, sharedPerSM: 96 * K, sharedPerBlockOptin: 96 * K, sharedReservedPerBlock: 0, cubinSharedIncludesReserve: false, carveouts: [0, 8 * K, 16 * K, 32 * K, 64 * K, 96 * K], provenance: 'documentation' }),
  sm_75: row('sm_75', 7, 5, { maxThreadsPerSM: 1024, maxBlocksPerSM: 16, sharedPerSM: 64 * K, sharedPerBlockOptin: 64 * K, sharedReservedPerBlock: 0, cubinSharedIncludesReserve: false, carveouts: [32 * K, 64 * K], provenance: 'documentation' }),
  sm_80: row('sm_80', 8, 0, { maxThreadsPerSM: 2048, maxBlocksPerSM: 32, sharedPerSM: 164 * K, sharedPerBlockOptin: 163 * K, sharedReservedPerBlock: K, cubinSharedIncludesReserve: false, carveouts: [0, 8 * K, 16 * K, 32 * K, 64 * K, 100 * K, 132 * K, 164 * K], provenance: 'device-checked' }),
  sm_86: row('sm_86', 8, 6, { maxThreadsPerSM: 1536, maxBlocksPerSM: 16, sharedPerSM: 100 * K, sharedPerBlockOptin: 99 * K, sharedReservedPerBlock: K, cubinSharedIncludesReserve: false, carveouts: [0, 8 * K, 16 * K, 32 * K, 64 * K, 100 * K], provenance: 'device-checked' }),
  sm_87: row('sm_87', 8, 7, { maxThreadsPerSM: 1536, maxBlocksPerSM: 16, sharedPerSM: 164 * K, sharedPerBlockOptin: 163 * K, sharedReservedPerBlock: K, cubinSharedIncludesReserve: false, carveouts: [0, 8 * K, 16 * K, 32 * K, 64 * K, 100 * K, 132 * K, 164 * K], provenance: 'documentation' }),
  sm_89: row('sm_89', 8, 9, { maxThreadsPerSM: 1536, maxBlocksPerSM: 24, sharedPerSM: 100 * K, sharedPerBlockOptin: 99 * K, sharedReservedPerBlock: K, cubinSharedIncludesReserve: false, carveouts: [0, 8 * K, 16 * K, 32 * K, 64 * K, 100 * K], provenance: 'device-checked' }),
  sm_90: row('sm_90', 9, 0, { maxThreadsPerSM: 2048, maxBlocksPerSM: 32, sharedPerSM: 228 * K, sharedPerBlockOptin: 227 * K, sharedReservedPerBlock: K, cubinSharedIncludesReserve: true, carveouts: [0, 8 * K, 16 * K, 32 * K, 64 * K, 100 * K, 132 * K, 164 * K, 196 * K, 228 * K], provenance: 'device-checked' }),
  sm_120: row('sm_120', 12, 0, { maxThreadsPerSM: 1536, maxBlocksPerSM: 24, sharedPerSM: 100 * K, sharedPerBlockOptin: 99 * K, sharedReservedPerBlock: K, cubinSharedIncludesReserve: true, carveouts: [0, 8 * K, 16 * K, 32 * K, 64 * K, 100 * K], provenance: 'device-checked' }),
});

export const limitsFor = (arch: string | null): ArchLimits | null => (arch !== null && Object.hasOwn(ARCH_LIMITS, arch) ? (ARCH_LIMITS[arch] as ArchLimits) : null);

export interface Kernel {
  registers: number;
  staticSharedBytes: number;
  dynamicSharedBytes: number;
  blockSize: number;
}

export interface Occupancy {
  /** Blocks resident on one multiprocessor; 0 means the block cannot be launched at all. */
  blocks: number;
  /** Every resource that sets that number (ties are all listed). */
  limiters: Limiter[];
  /** What each resource alone would allow. */
  limits: Record<Limiter, number>;
  warpsPerBlock: number;
  activeWarps: number;
  /** activeWarps over the multiprocessor's warp capacity, 0 to 1. */
  occupancy: number;
}

const up = (n: number, unit: number): number => Math.ceil(n / unit) * unit;
const FOREVER = Number.MAX_SAFE_INTEGER;

const whole = (v: number, name: string, min: number): void => {
  if (!Number.isInteger(v) || v < min || v > 2 ** 31) throw new RangeError(`${name} must be an integer from ${min}`);
};

/** The block's shared-memory allocation, rounded up to the smallest configuration the multiprocessor offers; null when none is large enough. */
const carveoutFor = (l: ArchLimits, bytes: number): number | null => l.carveouts.find((size) => bytes <= size && (bytes > 0 || size === 0 || l.major === 7)) ?? null;

export function occupancy(l: ArchLimits, k: Kernel): Occupancy {
  whole(k.registers, 'registers', 0);
  whole(k.staticSharedBytes, 'staticSharedBytes', 0);
  whole(k.dynamicSharedBytes, 'dynamicSharedBytes', 0);
  whole(k.blockSize, 'blockSize', 1);

  const warps = Math.ceil(k.blockSize / WARP);
  const warpCapacity = l.maxThreadsPerSM / WARP;

  const byWarps = k.blockSize > l.maxThreadsPerBlock ? 0 : Math.floor(warpCapacity / warps);
  const byBlocks = l.maxBlocksPerSM;

  const perWarp = up(k.registers * WARP, REG_UNIT);
  const perBlock = perWarp * warps;
  const assumed = perWarp * up(warps, SUB_PARTITIONS);
  let byRegisters = FOREVER;
  if (l.regsPerBlock < assumed || l.regsPerBlock < perBlock || k.registers > l.maxRegsPerThread) byRegisters = 0;
  else if (perWarp > 0) byRegisters = Math.floor((Math.floor(l.regsPerSM / SUB_PARTITIONS / perWarp) * SUB_PARTITIONS) / warps);

  const granule = l.major >= 8 ? 128 : 256;
  const allocated = up(k.staticSharedBytes + l.sharedReservedPerBlock + k.dynamicSharedBytes, granule);
  const blockLimit = l.sharedPerBlock + (l.major >= 8 ? l.sharedReservedPerBlock : 0);
  let bySharedMemory = 0;
  if (allocated <= blockLimit) {
    const preferred = carveoutFor(l, l.sharedPerSM);
    const fits = preferred !== null && preferred >= allocated ? preferred : l.major >= 7 ? carveoutFor(l, allocated) : l.sharedPerSM;
    bySharedMemory = fits === null ? 0 : allocated > 0 ? Math.floor(fits / allocated) : FOREVER;
  }

  // From compute capability 9 each resident block holds a hardware barrier; a kernel using one barrier (the default) is held to the slots there are.
  // On sm_90 there are two per block slot, so this never binds; on sm_120 there is one, so it ties with the block limit and NVIDIA reports both.
  const byBarriers = l.major < 9 ? FOREVER : l.major === 9 ? byBlocks * 2 : byBlocks;

  const limits: Record<Limiter, number> = { warps: byWarps, registers: byRegisters, sharedMemory: bySharedMemory, blocks: byBlocks, barriers: byBarriers };
  const blocks = Math.min(byWarps, byRegisters, bySharedMemory, byBlocks, byBarriers);
  const order: Limiter[] = ['warps', 'registers', 'sharedMemory', 'blocks', 'barriers'];

  return { blocks, limiters: order.filter((name) => limits[name] === blocks), limits, warpsPerBlock: warps, activeWarps: blocks * warps, occupancy: (blocks * warps) / warpCapacity };
}
