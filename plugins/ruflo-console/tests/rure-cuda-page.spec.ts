/**
 * ruRE CUDA on the console (ADR-497): the CUDA row, its reader against the REAL captured CLI answers (tests/fixtures/rure/cuda-*.txt, from
 * nvcc 12.8 and 13.0 binaries built for ruflo's own CUDA fixtures), the hint a CUDA host binary gets from the native reader, a hostile
 * answer, and DETECT's routes for .cubin, .fatbin and .ptx.
 *   npx vitest run --dir plugins/ruflo-console/tests rure-cuda-page
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { devLines, emptyFields } from '../hooks/data/devtools'
import { RE_MAX_LINES } from '../hooks/data/rure'
import { detectReader } from '../hooks/data/rure-detect'
import { DEV, devSpec } from '../hooks/devtools'

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', 'rure', `${name}.txt`), 'utf8')
const linesOf = (id: string, name: string): string[] => devLines(id, fixture(name), '')
const wrapped = (inner: unknown) => `[INFO] Executing tool: x\n[OK] Tool executed in 6ms\nResult:\n${JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(inner) }] })}\n`

describe('the CUDA row', () => {
  it('calls rure_analyze_cuda with the sample, reads at once, and is on the native section', () => {
    const entry = DEV.find(item => item.id === 'dt-re-cuda')!
    const spec = devSpec(entry, { ...emptyFields(), sample: 'gpu/app' })!

    expect(spec.args.slice(0, 4)).toEqual(['mcp', 'exec', '-t', 'rure_analyze_cuda'])
    expect(JSON.parse(spec.args[5] as string)).toEqual({ path: 'gpu/app' })
    expect(spec.isReadOnly).toBe(true)
    expect(entry.group).toBe('rure-native')
  })
})

describe('the CUDA reader on real answers', () => {
  it('a CUDA 13 host binary: header, fatbin entries, kernels with what they cost, PTX', () => {
    const lines = linesOf('dt-re-cuda', 'cuda-host')
    const all = lines.join('\n')

    expect(lines[0]).toBe('CUDA · host · cubins sm_80 · PTX sm_80 · 2 kernels · 0 device functions')
    expect(all).toMatch(/fatbin in \.nv_fatbin at 0x[0-9a-f]+ \(7152 B\)/)
    expect(all).toContain('2 container(s), 3 entries:')
    expect(all).toMatch(/#0 cubin sm_80 · none · \d+ B/)
    expect(all).toMatch(/#2 ptx sm_80 · zstd · 1464 B/)
    expect(all).toContain('  saxpy · sm_80 · 10 reg · 384 B code (~24 instr) · const 376 B')
    expect(all).toContain('  scale_secret · sm_80 · 8 reg · 384 B code (~24 instr) · const 364 B')
    expect(all).toMatch(/PTX 9\.0 · sm_80 · 64-bit · kernels: _Z12scale_secretPfi, _Z5saxpyifPKfPf|PTX 9\.0 · sm_80 · 64-bit · kernels: _Z5saxpyifPKfPf, _Z12scale_secretPfi/)
    expect(all).toMatch(/host signals \(\d+\):/)
  })

  it('a two-architecture binary shows every kernel per architecture with that architecture\'s registers', () => {
    const all = linesOf('dt-re-cuda', 'cuda-multiarch').join('\n')

    expect(all).toContain('cubins sm_75, sm_90 · PTX sm_90 · 4 kernels')
    for (const arch of ['sm_75', 'sm_90']) {
      expect(all).toContain(`  saxpy · ${arch} · 10 reg`)
      expect(all).toContain(`  scale_secret · ${arch} · 8 reg`)
    }
  })

  it('a CUDA 12.8 binary with LZ4 PTX reads the same way', () => {
    const all = linesOf('dt-re-cuda', 'cuda-lz4').join('\n')

    expect(all).toMatch(/ptx sm_80 · lz4 · 1480 B/)
    expect(all).toMatch(/PTX 8\.\d · sm_80/)
    expect(all).toContain('  saxpy · sm_80 · 10 reg')
  })

  it('a standalone cubin has no fatbin lines, and says what it is', () => {
    const lines = linesOf('dt-re-cuda', 'cuda-cubin')

    expect(lines[0]).toMatch(/^CUDA · cubin · cubins sm_80 · PTX \(none\) · 2 kernels/)
    expect(lines.join('\n')).not.toContain('fatbin in')
    expect(lines.join('\n')).toContain('  saxpy · sm_80 · 10 reg')
  })

  it('an unread entry says why, instead of showing a size', () => {
    const lines = devLines('dt-re-cuda', wrapped({ success: true, source: 'host', containers: 1, entries: [{ index: 0, kind: 'ptx', arch: 'sm_90', compressed: 'zstd', read: false, size: null, note: 'this Node cannot read zstd (it needs 22.15 or later)' }], cubinArchs: [], ptxArchs: ['sm_90'], kernels: [], ptx: [], hostSignals: [], summary: { kernels: 0, deviceFunctions: 0 }, warnings: [], truncated: false, redactedCount: 0, screened: true }))

    expect(lines.join('\n')).toContain('#0 ptx sm_90 · zstd · unread: this Node cannot read zstd (it needs 22.15 or later)')
    expect(lines.join('\n')).toContain('  (none read)')
  })

  it('a not-CUDA answer keeps the tool\'s warning in front', () => {
    const lines = devLines('dt-re-cuda', wrapped({ success: true, source: 'host', containers: 0, entries: [], cubinArchs: [], ptxArchs: [], kernels: [], ptx: [], hostSignals: [], summary: { kernels: 0, deviceFunctions: 0 }, warnings: ['no .nv_fatbin section: this does not look like a CUDA program (format elf)'], truncated: false, redactedCount: 0, screened: true }))

    expect(lines[0]).toBe('⚠ no .nv_fatbin section: this does not look like a CUDA program (format elf)')
  })
})

describe('a CUDA host binary read by the native reader', () => {
  it('gets a line pointing at the CUDA row, and an ordinary ELF does not', () => {
    expect(linesOf('dt-re-bin', 'binary-cuda').join('\n')).toContain('holds CUDA code (a .nv_fatbin section): run CUDA for its kernels, architectures and PTX')
    expect(linesOf('dt-re-bin', 'binary-elf').join('\n')).not.toContain('holds CUDA code')
  })
})

describe('a hostile CUDA file', () => {
  const evil = '\u001b[31mRED\u001b[0m\u001b]52;c;aGk=\u0007‮TXT\u0000end'

  it('no kernel, entry note, host signal, PTX or section name puts an escape or control character in a line', () => {
    const lines = devLines('dt-re-cuda', wrapped({
      success: true, source: evil, hostSection: { name: evil, offset: 1, size: 2 }, hostSignals: [evil], containers: 1,
      entries: [{ index: 0, kind: evil, arch: evil, compressed: evil, read: false, size: null, note: evil }],
      cubinArchs: [evil], ptxArchs: [evil],
      kernels: [{ name: evil, identifier: evil, isEntry: true, arch: evil, registers: 8, codeBytes: 1, constantBytes: 1, sharedBytes: 1, instructionEstimate: 1 }],
      ptx: [{ version: evil, target: evil, addressSize: 64, entries: [{ name: evil, params: 1 }] }],
      summary: { kernels: 1, deviceFunctions: 0 }, warnings: [evil], truncated: false, redactedCount: 0, screened: true,
    }))

    expect(lines.length).toBeGreaterThan(5)
    // eslint-disable-next-line no-control-regex
    for (const line of lines) expect(line, JSON.stringify(line)).not.toMatch(/[\u0000-\u001f\u007f‪-‮]/)
  })

  it('numbers that are not measurements read n/a, and a huge answer is cut to the panel', () => {
    const kernels = Array.from({ length: 5000 }, (_, i) => ({ name: `k${i}`, identifier: null, isEntry: true, arch: 'sm_80', registers: 1e300, codeBytes: 1e300, constantBytes: 1e300, sharedBytes: 0, instructionEstimate: 1e300 }))
    const lines = devLines('dt-re-cuda', wrapped({ success: true, source: 'host', containers: 1e300, entries: [], cubinArchs: [], ptxArchs: [], kernels, ptx: [], hostSignals: [], summary: { kernels: 1e300, deviceFunctions: 0 }, warnings: [], truncated: false, redactedCount: 0, screened: true }))
    const all = lines.join('\n')

    expect(lines.length).toBeLessThanOrEqual(RE_MAX_LINES)
    expect(all).toContain('  k0 · sm_80 · n/a reg · n/a code · const n/a')
    expect(all).toContain('… +4940 more')
    expect(lines.every(line => line.length < 400)).toBe(true)
  })
})

describe('DETECT routes CUDA files to the CUDA row', () => {
  const fs = (kind: string) => ({ stat: async () => ({ kind }) })

  it('.cubin, .fatbin and .ptx, in any case, read as CUDA code', async () => {
    for (const name of ['gpu/k.cubin', 'gpu/k.fatbin', 'gpu/K.PTX']) expect(await detectReader(fs('file'), name), name).toMatchObject({ id: 'dt-re-cuda', tool: 'rure_analyze_cuda', params: { path: name } })
  })

  it('a folder still goes to the JS reader, and an extensionless binary still to the native one', async () => {
    expect(await detectReader(fs('dir'), 'gpu.ptx')).toMatchObject({ id: 'dt-re-js' })
    expect(await detectReader(fs('file'), 'gpu/app')).toMatchObject({ id: 'dt-re-bin' })
  })
})
