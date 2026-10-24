/**
 * The CUDA occupancy model (ADR-501), without a toolkit. The fingerprints below are SHA-256 of NVIDIA's own answers (cuda_occupancy.h) for the
 * grid in rure-cuda-occupancy-grid.ts, taken once by rure-cuda-occupancy-oracle.test.ts (RURE_OCC_PRINT_GOLDEN=1) on 2026-10-24 from CUDA 13.0:
 * the model must reproduce all 221,277 answers per architecture, blocks and limiting set, byte for byte. A few values are also worked by hand.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { ARCH_LIMITS, limitsFor, occupancy } from '../src/rure/cuda-occupancy.js';
import { gridLines } from './rure-cuda-occupancy-grid.js';

const GOLDEN: Record<string, string> = {
  sm_70: '05e9b6ca0f350c2e850c90b0eee556cb1d9fcd361331ea2df46d4836fbca103d',
  sm_75: 'd2b742e547f9260b5f3af86e2e37a7f5849a7f12d089eb06750583e06cafd3be',
  sm_80: '024eec16c8d664c52a00537e861df93088e7d8282012979d4f3fa0c27550ae0d',
  sm_86: '9f722d4fdd28e04e08dbbb229a94619931308463e9db5274f7abeed4d8871202',
  sm_87: '1975271311cc80c484dbd603502801cf49a6c2c1ea29c8fb5d6a07ebd78cef6e',
  sm_89: 'a5b23090dfd23249ad94396215f2ba0e5bf435b1ae7d8a2792cc87e1b4bae838',
  sm_90: 'a59759afc15bf17c9501ee4e830489614b1e91819aea4f32d1711f8991063a70',
  sm_120: '18c488a77a9a5d5d61c721e519e8ebce44151fb63e4e3c296d9bbd31afcee32f',
};

const at = (arch: string) => limitsFor(arch)!;
const k = (registers: number, blockSize: number, staticSharedBytes = 0, dynamicSharedBytes = 0) => ({ registers, blockSize, staticSharedBytes, dynamicSharedBytes });

describe('the occupancy model reproduces NVIDIA\'s reference answers', () => {
  it('has a fingerprint for every architecture it knows, and no other', () => {
    expect(Object.keys(GOLDEN).sort()).toEqual(Object.keys(ARCH_LIMITS).sort());
  });

  for (const arch of Object.keys(GOLDEN)) {
    it(`${arch}: all 221,277 grid answers (blocks and limiting set) hash to NVIDIA's`, () => {
      const hash = createHash('sha256');
      let count = 0;
      let first = true;

      for (const line of gridLines(at(arch))) {
        hash.update(first ? line : `\n${line}`);
        first = false;
        count++;
      }

      expect(count).toBe(221_277);
      expect(hash.digest('hex')).toBe(GOLDEN[arch]);
    });
  }
});

describe('values worked by hand', () => {
  it('sm_80, 32 registers, 256 threads: 8 blocks, and warps and registers tie', () => {
    // 2048 threads / 256 = 8 blocks. 32 regs * 32 lanes = 1024 per warp, 8 warps = 8192 per block, 65536 / 8192 = 8.
    const r = occupancy(at('sm_80'), k(32, 256));

    expect(r.blocks).toBe(8);
    expect(r.limiters).toEqual(['warps', 'registers']);
    expect(r.occupancy).toBe(1);
  });

  it('sm_86, 64 registers, 256 threads: registers allow 4 blocks of 1536 threads, not 6', () => {
    // 64*32 = 2048 per warp * 8 warps = 16384 per block; 65536 / 16384 = 4. Warps alone would allow 1536/256 = 6.
    const r = occupancy(at('sm_86'), k(64, 256));

    expect(r.blocks).toBe(4);
    expect(r.limiters).toEqual(['registers']);
    expect(r.activeWarps).toBe(32);
    expect(r.occupancy).toBeCloseTo(32 / 48, 10);
  });

  it('sm_86, a 48 KiB static tile in 256 threads: shared memory is the limit, at 2 blocks', () => {
    // 49152 + 1024 reserved is 50176 per block (already a multiple of 128); the 102400-byte multiprocessor holds floor(102400 / 50176) = 2.
    const r = occupancy(at('sm_86'), k(32, 256, 49152));

    expect(r.blocks).toBe(2);
    expect(r.limiters).toContain('sharedMemory');
  });

  it('a block over 1024 threads cannot launch; neither can 257 registers', () => {
    expect(occupancy(at('sm_80'), k(32, 1025)).blocks).toBe(0);
    expect(occupancy(at('sm_80'), k(257, 128)).blocks).toBe(0);
  });

  it('sm_120 names the barrier slots next to the block slots, as NVIDIA does; sm_90 does not', () => {
    expect(occupancy(at('sm_120'), k(16, 32)).limiters).toEqual(['blocks', 'barriers']);
    expect(occupancy(at('sm_90'), k(16, 32)).limiters).toEqual(['blocks']);
  });
});

describe('properties of the model', () => {
  it('more registers never allow more blocks, on any architecture', () => {
    for (const limits of Object.values(ARCH_LIMITS)) {
      for (const blockSize of [32, 96, 256, 1024]) {
        let previous = Infinity;

        for (let registers = 1; registers <= 256; registers++) {
          const blocks = occupancy(limits, k(registers, blockSize)).blocks;

          expect(blocks, `${limits.arch} ${registers} regs ${blockSize}`).toBeLessThanOrEqual(previous);
          previous = blocks;
        }
      }
    }
  });

  it('more shared memory never allows more blocks', () => {
    for (const limits of Object.values(ARCH_LIMITS)) {
      let previous = Infinity;

      for (let bytes = 0; bytes <= 49152; bytes += 256) {
        const blocks = occupancy(limits, { ...k(32, 128), staticSharedBytes: bytes }).blocks;

        expect(blocks, `${limits.arch} ${bytes} B`).toBeLessThanOrEqual(previous);
        previous = blocks;
      }
    }
  });

  it('the reported occupancy is warps resident over warp capacity, 0 to 1', () => {
    for (const limits of Object.values(ARCH_LIMITS)) {
      const r = occupancy(limits, k(40, 192));

      expect(r.occupancy).toBeGreaterThan(0);
      expect(r.occupancy).toBeLessThanOrEqual(1);
      expect(r.activeWarps).toBe(r.blocks * 6);
    }
  });

  it('rejects numbers that are not whole and non-negative, and knows only the architectures it has a table for', () => {
    for (const bad of [-1, 1.5, NaN, Infinity]) expect(() => occupancy(at('sm_80'), k(bad, 128))).toThrow(RangeError);
    expect(() => occupancy(at('sm_80'), k(32, 0))).toThrow(RangeError);
    expect(limitsFor('sm_100')).toBeNull();
    expect(limitsFor(null)).toBeNull();
    expect(limitsFor('__proto__')).toBeNull();
    expect(limitsFor('constructor')).toBeNull();
  });

  it('names exactly the architectures that were read off a real device (ADR-501 section 4.1): sm_80, sm_86, sm_89, sm_90 and sm_120', () => {
    expect(Object.values(ARCH_LIMITS).filter((l) => l.provenance === 'device-checked').map((l) => l.arch).sort()).toEqual(['sm_120', 'sm_80', 'sm_86', 'sm_89', 'sm_90']);
    expect(Object.values(ARCH_LIMITS).filter((l) => l.provenance === 'documentation').map((l) => l.arch).sort()).toEqual(['sm_70', 'sm_75', 'sm_87']);
  });

  it('every table is ascending in its carveouts, inside the multiprocessor, and says where its numbers come from', () => {
    for (const l of Object.values(ARCH_LIMITS)) {
      expect([...l.carveouts]).toEqual([...l.carveouts].sort((a, b) => a - b));
      expect(l.carveouts.at(-1)).toBe(l.sharedPerSM);
      expect(l.sharedPerBlockOptin).toBeLessThanOrEqual(l.sharedPerSM);
      expect(['device-checked', 'documentation']).toContain(l.provenance);
    }
  });
});
