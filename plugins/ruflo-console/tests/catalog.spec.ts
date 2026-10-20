/**
 * Parity for the copied ADR-406 command catalog: the copy's sourceDigest is the sha256 of its entries' canonical JSON
 * (keys sorted at every depth, no whitespace), as the ruflo CLI computes it, and the copy equals the CLI's own
 * generated catalog in this tree. Refresh the copy with:
 *   cp v3/@claude-flow/cli/src/mods/command-registry/catalog.generated.json plugins/ruflo-console/catalog/command-catalog.json
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { CATALOG_CONTRACT, commandsText, FALLBACK, parseCatalog } from '../hooks/data/catalog'

const here = dirname(fileURLToPath(import.meta.url))
const COPY = join(here, '../catalog/command-catalog.json')
const CANONICAL = join(here, '../../../v3/@claude-flow/cli/src/mods/command-registry/catalog.generated.json')

const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value !== null && typeof value === 'object'
      ? `{${Object.keys(value as object)
          .sort()
          .map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
          .join(',')}}`
      : JSON.stringify(value)

describe('command catalog copy', () => {
  const text = readFileSync(COPY, 'utf8')
  const catalog = JSON.parse(text) as { contractVersion: string; sourceDigest: string; entries: unknown[] }

  it('is the contract this plugin reads, and its digest matches its entries', () => {
    expect(catalog.contractVersion).toBe(CATALOG_CONTRACT)
    expect(`sha256:${createHash('sha256').update(canonical(catalog.entries)).digest('hex')}`).toBe(catalog.sourceDigest)
  })

  it('equals the CLI-generated catalog in this tree', () => {
    expect(JSON.parse(readFileSync(CANONICAL, 'utf8')).sourceDigest).toBe(catalog.sourceDigest)
  })

  it('parses into entries, the mod commands included, and lists them', () => {
    const parsed = parseCatalog(text)

    expect(parsed?.entries.length).toBe(catalog.entries.length)
    expect(parsed?.entries.filter(entry => entry.disposition === 'view').map(entry => entry.invocation)).toEqual(expect.arrayContaining(['/ruflo-mods', '/ruflo-swarm-pane']))
    expect(commandsText(parsed ?? FALLBACK, 'ruflo-swarm')).toMatch(/^\d+ of \d+ commands in the ruflo command catalog/)
    expect(parseCatalog('{"contractVersion":"other/9","entries":[]}')).toBeNull()
  })
})
