/**
 * ruRE CUDA end to end (ADR-497): the CUDA row and DETECT's CUDA routes, as the console runs them, against the REAL built ruflo CLI and the real
 * nvcc binaries committed for the CLI's own tests (v3/@claude-flow/cli/__tests__/fixtures/cuda, with cuobjdump's answers beside them). The
 * reader's lines are checked against those recorded cuobjdump numbers. Skips, saying so, when the CLI is not built or predates rure_analyze_cuda.
 *   cd v3/@claude-flow/cli && npx tsc; then: npx vitest run --dir plugins/ruflo-console/tests rure-cuda-e2e
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as zlib from 'node:zlib'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { emptyFields } from '../hooks/data/devtools'
import { DEV, devSpec } from '../hooks/devtools'
import type { Host } from '../hooks/host'

const CLI_DIR = resolve(__dirname, '../../../v3/@claude-flow/cli')
const CLI = join(CLI_DIR, 'bin', 'cli.js')
const TOOLS = join(CLI_DIR, 'dist', 'src', 'mcp-tools', 'rure-tools.js')
const FIXTURES = join(CLI_DIR, '__tests__', 'fixtures', 'cuda')
const HAVE_CUDA_TOOL = existsSync(CLI) && existsSync(TOOLS) && readFileSync(TOOLS, 'utf8').includes('rure_analyze_cuda')

if (!HAVE_CUDA_TOOL) console.log('SKIP ruRE CUDA e2e: build the CLI first (cd v3/@claude-flow/cli && npx tsc); it needs rure_analyze_cuda')

/** The CLI runs under this same Node: where it has no zstd (before 22.15; CI's Test Suite job is Node 20) a zstd entry must read as unread, not as data. */
const HAVE_ZSTD = typeof (zlib as unknown as { zstdDecompressSync?: unknown }).zstdDecompressSync === 'function'

let project = ''

/** `stat` as the host answers it, for the project. */
const fs = {
  stat: async (path: string) => {
    try {
      const info = lstatSync(join(project, path))

      return { kind: info.isDirectory() ? 'dir' : 'file', isLink: info.isSymbolicLink() }
    } catch {
      return undefined
    }
  },
}

/** A row exactly as the console runs it (its preflight may choose the reader), through the real CLI, read by the console's own reader. */
async function row(id: string, sample: string): Promise<{ lines: string[]; label: string; refused?: string }> {
  const spec = devSpec(DEV.find(item => item.id === id)!, { ...emptyFields(), sample })!
  const prep = await spec.preflight?.({ fs } as unknown as Host)

  if (typeof prep === 'string') return { lines: [], label: spec.label, refused: prep }

  const chosen = { ...spec, ...(prep ?? {}) }
  const done = spawnSync(process.execPath, [CLI, ...chosen.args], { cwd: project, encoding: 'utf8', timeout: 90_000, env: { ...process.env, NO_COLOR: '1' } })

  return { lines: chosen.lines?.(done.stdout ?? '', done.stderr ?? '') ?? [], label: chosen.label }
}

/** cuobjdump's recorded `-res-usage`: function -> registers and constant bank 0, per arch. */
function recorded(name: string): Record<string, Record<string, { reg: number; constant0: number }>> {
  const out: Record<string, Record<string, { reg: number; constant0: number }>> = {}

  for (const block of readFileSync(join(FIXTURES, `${name}.cuobjdump.txt`), 'utf8').split('Fatbin elf code:').slice(1)) {
    const arch = /arch = (sm_\d+)/.exec(block)?.[1] as string

    out[arch] ??= {}
    for (const m of block.matchAll(/Function (\S+):\s+REG:(\d+) .*?CONSTANT\[0\]:(\d+)/g)) (out[arch] as Record<string, { reg: number; constant0: number }>)[m[1] as string] = { reg: Number(m[2]), constant0: Number(m[3]) }
  }

  return out
}

beforeAll(() => {
  if (!HAVE_CUDA_TOOL) return

  project = mkdtempSync(join(tmpdir(), 'ruflo-console-cuda-e2e-'))
  mkdirSync(join(project, 'gpu'), { recursive: true })

  for (const name of ['host-default', 'host-multiarch', 'host-cuda128', 'host-cuda128-all', 'k80.cubin', 'k80.fatbin', 'k80.ptx']) copyFileSync(join(FIXTURES, name), join(project, 'gpu', name))
})

afterAll(() => {
  if (project !== '') rmSync(project, { recursive: true, force: true })
})

describe.skipIf(!HAVE_CUDA_TOOL)('the CUDA row against the real CLI', () => {
  for (const name of ['host-default', 'host-multiarch', 'host-cuda128', 'host-cuda128-all']) {
    it(`${name}: every kernel's registers and constant bank in the lines equal cuobjdump's`, async () => {
      const { lines } = await row('dt-re-cuda', `gpu/${name}`)
      const all = lines.join('\n')

      expect(lines.some(line => line.startsWith('CUDA · host'))).toBe(true)

      for (const [arch, fns] of Object.entries(recorded(name))) {
        for (const [fn, expected] of Object.entries(fns)) {
          const plain = /^_Z\d+(\w+?)(?:Pf|if|Pfi|[A-Z])/.exec(fn)?.[1] ?? fn
          const identifier = fn.includes('scale_secret') ? 'scale_secret' : fn.includes('saxpy') ? 'saxpy' : plain

          expect(all, `${identifier} in ${arch}`).toContain(`  ${identifier} · ${arch} · ${expected.reg} reg`)
          expect(all, `${identifier} constant in ${arch}`).toMatch(new RegExp(`  ${identifier} · ${arch} · ${expected.reg} reg · \\d+ B code.* · const ${expected.constant0} B`))
        }
      }
    })
  }

  it('LZ4 (CUDA 12) PTX is read on every Node', async () => {
    const lz4 = (await row('dt-re-cuda', 'gpu/host-cuda128')).lines.join('\n')

    expect(lz4).toMatch(/ptx sm_80 · lz4 · 1480 B/)
    expect(lz4).toMatch(/PTX 8\.\d · sm_80 · 64-bit · kernels:/)
  })

  it(HAVE_ZSTD ? 'zstd (CUDA 13) PTX is read' : 'zstd (CUDA 13) PTX is shown as unread, with the reason, on a Node without zstd (the rest still reads)', async () => {
    const zstd = (await row('dt-re-cuda', 'gpu/host-default')).lines.join('\n')

    expect(zstd).toMatch(/kernels \(2\):/)
    expect(zstd).toContain('  saxpy · sm_80 · 10 reg')

    if (HAVE_ZSTD) {
      expect(zstd).toMatch(/ptx sm_80 · zstd · 1464 B/)
      expect(zstd).toMatch(/PTX 9\.0 · sm_80 · 64-bit · kernels:/)
    } else {
      expect(zstd).toMatch(/ptx sm_80 · zstd · unread: this Node cannot read zstd/)
      expect(zstd).not.toMatch(/PTX 9\.0/)
    }
  })

  it('a CUDA host binary read by the native row points at the CUDA row, and a non-CUDA file does not', async () => {
    expect((await row('dt-re-bin', 'gpu/host-default')).lines.some(line => line.startsWith('holds CUDA code'))).toBe(true)
    expect((await row('dt-re-bin', 'gpu/k80.cubin')).lines.some(line => line.startsWith('holds CUDA code'))).toBe(false)
  })
})

describe.skipIf(!HAVE_CUDA_TOOL)('DETECT routes CUDA files to the CUDA reader through the real CLI', () => {
  for (const [file, source] of [['k80.cubin', 'cubin'], ['k80.fatbin', 'fatbin'], ['k80.ptx', 'ptx']] as const) {
    it(`${file} is read as CUDA code (${source})`, async () => {
      const answer = await row('dt-re-auto', `gpu/${file}`)

      expect(answer.label).toBe('ruRE: detect → CUDA')
      expect(answer.lines.some(line => line.startsWith(`CUDA · ${source}`))).toBe(true)
    })
  }

  it('the standalone PTX lists its kernels and target', async () => {
    const all = (await row('dt-re-auto', 'gpu/k80.ptx')).lines.join('\n')

    expect(all).toMatch(/PTX 9\.0 · sm_80 · 64-bit · kernels: /)
    expect(all).toContain('_Z5saxpyifPKfPf')
  })
})
