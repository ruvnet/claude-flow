/** `mcp__<server>__<tool>` into its two halves; tool names never hold a double underscore. */
export function splitName(name: string): { server: string; tool: string } | undefined {
  if (!name.startsWith('mcp__')) return undefined
  const at = name.lastIndexOf('__')
  return at > 5 ? { server: name.slice(5, at), tool: name.slice(at + 2) } : undefined
}

const bare = (name: string) => splitName(name)?.tool ?? name

/** The name without its `mcp__<server>__` prefix. */
export const shortName = bare

/** This plugin's tools: counted in the status file. */
const OWNED = new Set([
  'memory_search',
  'memory_store',
  'memory_list',
])

/** The tools that put text somewhere durable or shared. A call through any of them is screened by the guard. */
const WRITERS = new Set([
  'hooks_remember',
  'hooks_compress_store',
  'hooks_learn',
  'rvf_ingest',
  'brain_share',
  'brain_transfer',
  'memory_store',
])

export const isOwned = (name: string) => OWNED.has(bare(name)) || splitName(name)?.server === 'ruvector'
export const isWriter = (name: string) => WRITERS.has(bare(name))
