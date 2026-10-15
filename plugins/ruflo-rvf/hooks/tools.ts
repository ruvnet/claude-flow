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
  'memory_delete',
  'memory_import_claude',
  'memory_list',
  'memory_migrate',
  'memory_retrieve',
  'memory_stats',
  'memory_store',
  'session_delete',
  'session_info',
  'session_list',
  'session_restore',
  'session_save',
  'hooks_session-start',
  'hooks_session-end',
  'hooks_session-restore',
  'hooks_transfer',
])

/** The tools that put text somewhere durable or shared. A call through any of them is screened by the guard. */
const WRITERS = new Set([
  'memory_store',
  'session_save',
  'session_import',
  'memory_import',
  'config_import',
  'hooks_session-end',
  'hooks_transfer',
])

export const isOwned = (name: string) => OWNED.has(bare(name))
export const isWriter = (name: string) => WRITERS.has(bare(name))
