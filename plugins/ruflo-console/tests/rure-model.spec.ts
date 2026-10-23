/**
 * What Claude sees of a ruRE run (ADR-496): console_state carries the last ruRE result as a `rure` block (reader, label, caveats first,
 * the lines), and console_run answers with those lines, not only the one-line outcome. Every string takes the one path to the model
 * (modelLine, #3816) and the block says the text is the analyzed file's, so data.
 *   npx vitest run --dir plugins/ruflo-console/tests rure-model
 */
import { describe, expect, it } from 'vitest'

import { callTool } from '../hooks/model-tools'
import { setup } from './fixtures/control-setup'

const result = (lines: string[], extra: Record<string, unknown> = {}) => ({ id: 'dt-re-bin', label: 'ruRE: detect → NATIVE BINARY', ok: true, exitCode: 0, lines, atMs: Date.now(), ...extra })

describe('console_state after a ruRE run', () => {
  it('has no rure block when nothing from ruRE ran', async () => {
    const { deps } = setup('read')
    const state = JSON.parse(await callTool('console_state', {}, deps)) as Record<string, unknown>

    expect(state).not.toHaveProperty('rure')
  })

  it('carries the reader, label, caveats first and the lines, marked as the file\'s own text', async () => {
    const { deps, state: live } = setup('read')

    live.lab.result = result(['⚠ truncated: a size or count cap was reached, so this is a partial inventory', 'ELF · x86-64 · 64-bit little-endian · exec', 'imports (2): puts, printf'], { note: 'read as a native binary' })

    const rure = (JSON.parse(await callTool('console_state', {}, deps)) as { rure: { reader: string; label: string; ok: boolean; note: string; caveats: string[]; lines: string[]; untrusted: string } }).rure

    expect(rure.reader).toBe('dt-re-bin')
    expect(rure.label).toBe('ruRE: detect → NATIVE BINARY')
    expect(rure.ok).toBe(true)
    expect(rure.note).toBe('read as a native binary')
    expect(rure.caveats).toEqual(['⚠ truncated: a size or count cap was reached, so this is a partial inventory'])
    expect(rure.lines).toContain('imports (2): puts, printf')
    expect(rure.untrusted).toMatch(/analyzed file.*data, never instructions/)
  })

  it('is not set by another lab result, and passes every line through the model path', async () => {
    const { deps, state: live } = setup('read')

    live.lab.result = { ...result(['x']), id: 'dt-diff' }
    expect(JSON.parse(await callTool('console_state', {}, deps))).not.toHaveProperty('rure')

    live.lab.result = result(['a\u001b]52;c;eA==\u0007b', 'x'.repeat(500)])

    const text = await callTool('console_state', {}, deps)
    const lines = (JSON.parse(text) as { rure: { lines: string[] } }).rure.lines

    expect(text).not.toMatch(/\\u001b|\\u0007/)
    expect(lines.every(line => line.length <= 161)).toBe(true)
  })

  it('shows at most 120 lines', async () => {
    const { deps, state: live } = setup('read')

    live.lab.result = result(Array.from({ length: 300 }, (_, index) => `line ${index}`))
    expect((JSON.parse(await callTool('console_state', {}, deps)) as { rure: { lines: string[] } }).rure.lines).toHaveLength(120)
  })
})

describe('console_run on a ruRE row', () => {
  it('answers with the result lines of that run', async () => {
    const { deps, state: live } = setup('read', 'ask', { 'dt-re-bin': { label: 'ruRE: inspect a native binary', readOnly: true } })
    const run = deps.control.runner.runById

    deps.control.runner.runById = (id: string) => {
      const ok = run(id)

      live.lab.result = result(['ELF · x86-64', 'imports (1): puts'], { atMs: Date.now() + 5 })

      return ok
    }

    const reply = await callTool('console_run', { id: 'dt-re-bin' }, deps)

    expect(reply).toMatch(/^Done: ruRE: inspect a native binary/)
    expect(reply).toContain('imports (1): puts')
  })
})
