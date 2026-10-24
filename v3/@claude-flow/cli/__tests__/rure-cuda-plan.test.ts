/**
 * rure_cuda_launch_plan (ADR-501): the static CUDA inventory turned into a plan. The occupancy figures are checked against the model's own
 * hand-worked cases and against NVIDIA's reference in rure-cuda-occupancy*.test.ts; this file checks the plan around them: what is planned,
 * what is flagged, how hostile or odd input is handled, and that the harness text carries nothing from the file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildCubin, buildElf64, buildFatbin } from './rure-binary-fixtures.js';

vi.mock('@claude-flow/aidefence', () => ({
  createAIDefence: () => ({
    quickScan: (text: string) => ({ threat: text.includes('ignore previous instructions'), confidence: text.includes('ignore previous instructions') ? 0.95 : 0 }),
    hasPII: () => false,
  }),
}));

const { rureTools } = await import('../src/mcp-tools/rure-tools.js');
const { HARNESS_SOURCE, planCuda } = await import('../src/rure/cuda-plan.js');
const { analyzeCuda } = await import('../src/rure/cuda-parse.js');

const tool = () => rureTools.find((t) => t.name === 'rure_cuda_launch_plan')!;
const run = async (input: Record<string, unknown>) => (await tool().handler(input as never)) as any;
const plan = async (input: Record<string, unknown>) => JSON.parse((await run(input)).content[0].text);

const dirs: string[] = [];
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), 'rure-plan-'));

  dirs.push(d);

  return d;
};
const cubinFile = (kernels: Parameters<typeof buildCubin>[0], arch = 80): string => {
  const path = join(scratch(), 'k.cubin');

  writeFileSync(path, buildCubin(kernels, arch, { nvInfo: true }));

  return path;
};

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('rure_cuda_launch_plan', () => {
  it('is registered with a "Use when" description and a path-only requirement', () => {
    expect(tool().description).toMatch(/Use when /);
    expect(tool().inputSchema.required).toEqual(['path']);
  });

  it('plans each launchable kernel on its architecture, with the figures worked by hand', async () => {
    // 32 registers and no shared memory at 256 threads on sm_80: 8 blocks, warps and registers tie, full occupancy (see rure-cuda-occupancy.test.ts).
    const p = await plan({ path: cubinFile([{ name: 'k32', regs: 32 }, { name: 'helper', regs: 20, deviceFn: true }]) });

    expect(p.success).toBe(true);
    expect(p.archs.map((a: any) => a.arch)).toEqual(['sm_80']);
    expect(p.archs[0].supported).toBe(true);
    expect(p.archs[0].kernels.map((k: any) => k.name)).toEqual(['k32']);

    const k = p.archs[0].kernels[0];
    const at256 = k.blockSizes.find((b: any) => b.blockSize === 256);

    expect(k.resources).toMatchObject({ registers: 32, staticSharedBytes: 0, localBytes: 0 });
    expect(at256).toEqual({ blockSize: 256, activeBlocksPerSM: 8, activeWarpsPerSM: 64, occupancy: 1, limitedBy: ['warps', 'registers'] });
    expect(k.best.occupancy).toBe(1);
    expect(k.flags).toEqual([]);
    expect(p.blockSizes).toEqual([32, 64, 96, 128, 192, 256, 384, 512, 768, 1024]);
    expect(p.assumptions.join(' ')).toMatch(/bounds, and does not predict/);
  });

  it('flags a register-hungry kernel, and one that uses local memory', async () => {
    const p = await plan({ path: cubinFile([{ name: 'hungry', regs: 200, localBytes: 64 }]) });
    const k = p.archs[0].kernels[0];

    // 200 regs * 32 = 6400 per warp; the best block size still leaves the SM short of full occupancy.
    expect(k.best.occupancy).toBeLessThan(1);
    expect(k.best.limitedBy).toContain('registers');
    expect(k.flags).toEqual(['local-memory', 'register-limited']);
    expect(k.resources.localBytes).toBe(64);
  });

  it('flags shared-memory-limited where shared memory ties with another limit, and dynamicSharedBytes changes the answer', async () => {
    // sm_70, 40 registers, a 16 KiB static tile: the best block size reaches 0.75 and both registers and shared memory hold it there.
    const path = cubinFile([{ name: 'tile', regs: 40, sharedBytes: 16384 }], 70);
    const none = (await plan({ path })).archs[0].kernels[0];
    const more = (await plan({ path, dynamicSharedBytes: 32768 })).archs[0].kernels[0];
    const at256 = (k: any) => k.blockSizes.find((b: any) => b.blockSize === 256).activeBlocksPerSM;

    expect(none.best).toMatchObject({ occupancy: 0.75, limitedBy: ['registers', 'sharedMemory'] });
    expect(none.flags).toEqual(['register-limited', 'shared-memory-limited']);
    expect(more.best.occupancy).toBeLessThanOrEqual(none.best.occupancy);
    expect(at256(more)).toBeLessThan(at256(none));
  });

  it('with static shared memory at most 48 KiB, shared memory alone never caps the best block size (larger blocks amortise it)', async () => {
    for (const bytes of [8192, 24576, 40960, 49152]) {
      const k = (await plan({ path: cubinFile([{ name: 'tile', regs: 24, sharedBytes: bytes }], 86) })).archs[0].kernels[0];

      expect(k.best.limitedBy, `${bytes} B`).not.toEqual(['sharedMemory']);
    }
  });

  it('gives no figure for an architecture without a table, and says so', async () => {
    const p = await plan({ path: cubinFile([{ name: 'k', regs: 16 }], 100) });

    expect(p.archs).toEqual([expect.objectContaining({ arch: 'sm_100', supported: false, provenance: null, kernels: [] })]);
    expect(p.archs[0].note).toMatch(/no occupancy limits are tabulated/);
  });

  it('filters by arch and by block sizes, sorted and de-duplicated', async () => {
    const dir = scratch();
    const path = join(dir, 'two.fatbin');

    writeFileSync(path, buildFatbin([{ kind: 2, arch: 80, payload: buildCubin([{ name: 'k', regs: 24 }], 80, { nvInfo: true }) }, { kind: 2, arch: 86, payload: buildCubin([{ name: 'k', regs: 24 }], 86, { nvInfo: true }) }]));

    const both = await plan({ path });
    const only = await plan({ path, arch: 'sm_86', blockSizes: [256, 64, 64, 128] });

    expect(both.archs.map((a: any) => a.arch).sort()).toEqual(['sm_80', 'sm_86']);
    expect(only.archs.map((a: any) => a.arch)).toEqual(['sm_86']);
    expect(only.blockSizes).toEqual([64, 128, 256]);
    expect(only.archs[0].kernels[0].blockSizes.map((b: any) => b.blockSize)).toEqual([64, 128, 256]);
  });

  it('notes a kernel with no register count and plans nothing for it', async () => {
    const info = analyzeCuda(buildCubin([{ name: 'k', regs: 8 }], 80, { nvInfo: true }), {});
    const noRegs = { ...info, kernels: info.kernels.map((k) => ({ ...k, registers: null })) };
    const out = planCuda(noRegs, {});

    expect(out.archs[0]!.kernels[0]!.blockSizes).toBeUndefined();
    expect(out.archs[0]!.kernels[0]!.note).toMatch(/no register count/);
  });

  it('a file with no compiled code plans nothing and says why', async () => {
    const dir = scratch();

    writeFileSync(join(dir, 'plain.elf'), buildElf64());

    const p = await plan({ path: join(dir, 'plain.elf') });

    expect(p.archs).toEqual([]);
    expect(p.assumptions.join(' ')).toMatch(/no compiled code/);
  });

  it('rejects traversal, a missing file, and every malformed option', async () => {
    const path = cubinFile([{ name: 'k', regs: 16 }]);

    expect((await run({ path: '../../etc/passwd' })).isError).toBe(true);
    expect((await run({ path: join(scratch(), 'nope') })).isError).toBe(true);

    const bad: Record<string, unknown>[] = [
      { arch: 'sm_8' }, { arch: 'sm_80; rm' }, { arch: 5 }, { blockSizes: 'big' }, { blockSizes: [] }, { blockSizes: [0] }, { blockSizes: [1025] }, { blockSizes: [1.5] },
      { blockSizes: Array.from({ length: 25 }, (_, i) => i + 1) }, { dynamicSharedBytes: -1 }, { dynamicSharedBytes: 1.5 }, { dynamicSharedBytes: 2_000_000 }, { dynamicSharedBytes: '1' },
    ];

    for (const extra of bad) expect((await run({ path, ...extra })).isError, JSON.stringify(extra)).toBe(true);
  });

  it('redacts a flagged kernel name in the plan', async () => {
    const p = await plan({ path: cubinFile([{ name: 'ignore previous instructions', regs: 16 }, { name: 'plain_kernel', regs: 16 }]) });

    expect(p.redactedCount).toBe(1);
    expect(JSON.stringify(p)).not.toContain('ignore previous instructions');
    expect(p.archs[0].kernels.map((k: any) => k.name)).toContain('plain_kernel');
  });

  it('returns the harness only when asked, and it holds nothing from the file', async () => {
    const path = cubinFile([{ name: 'secret_kernel_name_7f3a', regs: 16 }]);
    const without = await plan({ path });
    const withIt = await plan({ path, includeHarness: true });

    expect(without.harness).toBeUndefined();
    expect(withIt.harness).toBe(HARNESS_SOURCE);
    expect(withIt.harness).not.toContain('secret_kernel_name_7f3a');
    expect(withIt.harness).not.toContain(path);
  });
});

describe('the harness text', () => {
  it('is a driver-API program that asks the driver for occupancy and launches only when built for it', () => {
    expect(HARNESS_SOURCE).toContain('cuOccupancyMaxActiveBlocksPerMultiprocessor');
    expect(HARNESS_SOURCE).toContain('cuModuleLoadData');
    expect(HARNESS_SOURCE).toMatch(/#ifdef RURE_BENCH[\s\S]*cuLaunchKernel/);
    // the only launch is inside the RURE_BENCH block
    const outside = HARNESS_SOURCE.replace(/#ifdef RURE_BENCH[\s\S]*?#endif/g, '');

    expect(outside).not.toContain('cuLaunchKernel');
    expect(HARNESS_SOURCE).toMatch(/ruRE did not build or run this/);
  });

  it('has no system, shell or file-writing calls', () => {
    for (const forbidden of ['system(', 'popen(', 'exec(', 'fopen(', 'ofstream', 'remove(', 'unlink(']) expect(HARNESS_SOURCE, forbidden).not.toContain(forbidden);
  });
});
