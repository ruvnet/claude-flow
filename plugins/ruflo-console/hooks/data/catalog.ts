/**
 * ADR-406 command catalog (`ruflo.command-catalog/1`), copied from the ruflo CLI's generated
 * `v3/@claude-flow/cli/src/mods/command-registry/catalog.generated.json` into this plugin's `catalog/` folder (a mod may
 * read only its own files); tests/catalog.spec.ts holds the copy to its digest. `/ruflo commands` browses it. A prompt
 * workflow (`delegate`) is shown with its invocation for the person to type: the console never submits one (§7).
 */
import { plain, recordOf } from './parse'

export const CATALOG_CONTRACT = 'ruflo.command-catalog/1'
export const CATALOG_PATH = 'catalog/command-catalog.json'

export type CatalogEntry = { id: string; invocation: string; disposition: string; kind: string; owner: string; status: string }
export type Catalog = { source: 'catalog' | 'fallback'; sourceCommit?: string; entries: CatalogEntry[] }

/** What `/ruflo commands` lists when the catalog file is missing or not this contract: the ruflo mod commands only. */
export const FALLBACK: Catalog = {
  source: 'fallback',
  entries: [
    { id: 'ruflo-console/ruflo', invocation: '/ruflo', disposition: 'view', kind: 'mod', owner: 'ruflo-console', status: 'shipped' },
    { id: 'ruflo-console/ruflo-console', invocation: '/ruflo-console', disposition: 'view', kind: 'mod', owner: 'ruflo-console', status: 'shipped' },
    { id: 'ruflo-mods/ruflo-mods', invocation: '/ruflo-mods', disposition: 'view', kind: 'mod', owner: 'ruflo-mods', status: 'shipped' },
    ...['pane', 'status', 'topology', 'claims', 'consensus'].map(sub => ({ id: `ruflo-swarm/ruflo-swarm-${sub}`, invocation: `/ruflo-swarm-${sub}`, disposition: 'view', kind: 'mod', owner: 'ruflo-swarm', status: 'shipped' })),
  ],
}

/** The catalog's entries as the console lists them, or null for anything that is not this contract. */
export function parseCatalog(text: string | null): Catalog | null {
  let value: unknown

  try {
    value = text === null ? null : JSON.parse(text)
  } catch {
    return null
  }

  const catalog = recordOf(value)

  if (catalog === null || catalog.contractVersion !== CATALOG_CONTRACT || !Array.isArray(catalog.entries)) return null

  const entries = catalog.entries.slice(0, 2_000).flatMap(raw => {
    const entry = recordOf(raw)
    const definition = recordOf(entry?.definition)
    const source = recordOf(Array.isArray(entry?.sources) ? entry.sources[0] : null)
    const id = typeof definition?.id === 'string' ? plain(definition.id, 120) : ''
    const invocation = typeof source?.observedInvocation === 'string' ? plain(source.observedInvocation, 120) : ''

    return entry === null || definition === null || id === '' || invocation === ''
      ? []
      : [
          {
            id,
            invocation,
            disposition: plain(definition.disposition, 20) || 'unknown',
            kind: plain(definition.kind, 20) || 'unknown',
            owner: plain(definition.ownerPlugin, 40) || 'unknown',
            status: plain(entry.status, 20) || 'unknown',
          },
        ]
  })

  return { source: 'catalog', ...(typeof catalog.sourceCommit === 'string' && { sourceCommit: plain(catalog.sourceCommit, 40) }), entries }
}

/** `/ruflo commands [query]`: matching entries (by invocation, id or owner), the mod commands first, at most `max`. */
export function commandsText(catalog: Catalog, query: string, max = 40): string {
  const q = query.trim().toLowerCase()
  const hits = catalog.entries
    .filter(entry => q === '' || entry.invocation.toLowerCase().includes(q) || entry.id.toLowerCase().includes(q) || entry.owner.toLowerCase().includes(q))
    .sort((a, b) => (a.kind === 'mod' ? 0 : 1) - (b.kind === 'mod' ? 0 : 1) || a.invocation.localeCompare(b.invocation))
  const lines = hits.slice(0, max).map(entry => `${entry.invocation.padEnd(40)} ${entry.disposition.padEnd(9)} ${entry.owner}${entry.status !== 'shipped' ? ` (${entry.status})` : ''}`)
  const head =
    catalog.source === 'catalog'
      ? `${hits.length} of ${catalog.entries.length} commands in the ruflo command catalog${catalog.sourceCommit !== undefined ? ` (ADR-406, source ${catalog.sourceCommit.slice(0, 9)})` : ''}`
      : `${hits.length} ruflo mod commands (the command catalog is not readable here, so this is the built-in list)`

  return [head, 'view: runs here · delegate: a prompt workflow you type yourself (never submitted for you) · legacy: documentation', '', ...lines, ...(hits.length > max ? [`+${hits.length - max} more: /ruflo commands <word>`] : [])].join('\n')
}
