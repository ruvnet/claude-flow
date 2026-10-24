/**
 * The grid of resource combinations the occupancy model is checked on (ADR-501): the same loops as the C++ oracle in
 * rure-cuda-occupancy-oracle.test.ts, so a line here and a line there describe the same question. 221,277 lines per architecture.
 */
import { occupancy, type ArchLimits } from '../src/rure/cuda-occupancy.js';

const BIT = { warps: 1, registers: 2, sharedMemory: 4, blocks: 8, barriers: 16 } as const;

export const BLOCK_SIZES: number[] = [...Array.from({ length: 32 }, (_, i) => (i + 1) * 32), 1, 17, 31, 33, 48, 100, 250, 1000, 1023];
export const STATIC_SHARED = [0, 1, 512, 4096, 16384, 40000, 49152];
export const DYNAMIC_SHARED = [0, 1024, 16384];

/** `regs block static dynamic blocks limiterMask`, one line per combination, in the oracle's order. */
export function* gridLines(limits: ArchLimits): Generator<string> {
  for (let registers = 1; registers <= 257; registers++) {
    for (const blockSize of BLOCK_SIZES) {
      for (const staticSharedBytes of STATIC_SHARED) {
        for (const dynamicSharedBytes of DYNAMIC_SHARED) {
          const r = occupancy(limits, { registers, staticSharedBytes, dynamicSharedBytes, blockSize });
          const mask = r.limiters.reduce((m, name) => m | BIT[name], 0);

          yield `${registers} ${blockSize} ${staticSharedBytes} ${dynamicSharedBytes} ${r.blocks} ${mask}`;
        }
      }
    }
  }
}
