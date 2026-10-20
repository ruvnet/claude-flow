/**
 * Parity: types/index.d.ts vendors the `$.ruflo` contract from plugins/ruflo-mods/types/index.d.ts (ADR-404). If the
 * source changes shape, this fails instead of the console silently reading "ruflo-mods not seated".
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const VENDORED = join(here, '../types/index.d.ts')
const SOURCE = join(here, '../../ruflo-mods/types/index.d.ts')

const norm = (text: string) => text.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim()
const pick = (text: string, re: RegExp) => norm(re.exec(text)?.[0] ?? '')

describe.skipIf(!existsSync(SOURCE))('vendored $.ruflo', () => {
  const vendored = readFileSync(VENDORED, 'utf8')
  const source = readFileSync(SOURCE, 'utf8')

  it.each([
    ['RufloSegment', /export type RufloSegment = [^\n]+/],
    ['RufloRoute', /export type RufloRoute = \{[\s\S]*?\n\}/],
    ['RufloSnapshot', /export type RufloSnapshot = \{[\s\S]*?\n\}/],
  ])('%s matches ruflo-mods', (_name, re) => {
    expect(pick(source, re)).not.toBe('')
    expect(pick(vendored, re)).toBe(pick(source, re))
  })

  it('the three methods keep their signatures', () => {
    for (const method of ['segment: (input: RufloSegment) => Promise<void>', 'lastRoute: () => Promise<RufloRoute | null>', 'snapshot: () => Promise<RufloSnapshot>']) {
      expect(source).toContain(method)
      expect(vendored).toContain(method)
    }
  })
})
