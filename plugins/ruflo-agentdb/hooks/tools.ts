import type { ToolInfo } from 'claude-code'

import type { Source } from './options'

/** A memory-read tool found among the connected ones, split into what `$.mcp.call` takes. */
export type Reader = {
  readonly label: string
  readonly server: string
  readonly tool: string
  /** Semantic: the whole prompt is the right query, and its salient words add nothing. */
  readonly wholeOnly: boolean
  /** `memory_retrieve` on the same server, when connected: memory_search's values are cut to 60 characters and this has the rest. */
  readonly retrieve?: string
  readonly args: (query: string, limit: number) => Record<string, unknown>
}

/** Preference order. `memory_search` is the only one that embeds the query (HNSW over ONNX vectors, so a paraphrase finds its memory); the AgentDB tier and pattern tools match substrings and ruvector's recall is hash-based. */
const READERS = [
  { suffix: 'memory_search', label: 'agentdb', whole: true, args: (query: string, limit: number) => ({ query, limit }) },
  { suffix: 'agentdb_hierarchical-recall', label: 'agentdb', args: (query: string, limit: number) => ({ query, topK: limit }) },
  { suffix: 'agentdb_pattern-search', label: 'agentdb', args: (query: string, limit: number) => ({ query, topK: limit }) },
  { suffix: 'hooks_recall', label: 'ruvector', whole: true, args: (query: string, limit: number) => ({ query, top_k: limit }) },
] as const

/** `mcp__<server>__<tool>` into its two halves; tool names never hold a double underscore. */
export function splitName(name: string): { server: string; tool: string } | undefined {
  if (!name.startsWith('mcp__')) return undefined
  const at = name.lastIndexOf('__')
  return at > 5 ? { server: name.slice(5, at), tool: name.slice(at + 2) } : undefined
}

/** Every connected reader allowed by `source`, in preference order (hierarchical recall, pattern search, ruvector recall). */
export function pickReaders(tools: readonly ToolInfo[], source: Source): Reader[] {
  if (source === 'none') return []
  const found: Reader[] = []
  for (const reader of READERS) {
    if (source !== 'auto' && source !== reader.label) continue
    const hit = tools.find(t => t.mcp && splitName(t.name)?.tool === reader.suffix)
    const parts = hit && splitName(hit.name)
    if (!parts) continue
    const retrieve = reader.suffix === 'memory_search' && tools.some(t => t.mcp && t.name === `mcp__${parts.server}__memory_retrieve`) ? 'memory_retrieve' : undefined
    found.push({ label: reader.label, server: parts.server, tool: parts.tool, wholeOnly: 'whole' in reader, ...(retrieve === undefined ? {} : { retrieve }), args: reader.args })
  }
  return found
}

/** The tools that put text into memory. A write through any of them is screened by the guard. */
const WRITERS = new Set([
  'agentdb_hierarchical-store',
  'agentdb_pattern-store',
  'agentdb_batch',
  'agentdb_causal-edge',
  'memory_store',
  'hooks_remember',
  'hooks_intelligence_pattern-store',
  'agentdb_feedback',
  'agentdb_session-end',
  'hive-mind_memory',
  'session_save',
])

export const isWriter = (name: string) => WRITERS.has(splitName(name)?.tool ?? name)
