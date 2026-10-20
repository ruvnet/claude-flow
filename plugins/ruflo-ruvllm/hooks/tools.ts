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
  'ruvllm_chat_format',
  'ruvllm_generate_config',
  'ruvllm_hnsw_add',
  'ruvllm_hnsw_create',
  'ruvllm_hnsw_route',
  'ruvllm_microlora_adapt',
  'ruvllm_microlora_create',
  'ruvllm_sona_adapt',
  'ruvllm_sona_create',
  'ruvllm_status',
])

/** The tools that put text somewhere durable or shared. A call through any of them is screened by the guard. */
const WRITERS = new Set([
  'ruvllm_hnsw_add',
  'ruvllm_microlora_adapt',
  'ruvllm_sona_adapt',
])

export const isOwned = (name: string) => OWNED.has(bare(name))
export const isWriter = (name: string) => WRITERS.has(bare(name))
