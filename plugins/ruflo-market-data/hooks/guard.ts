import { hasSecret } from './screen'
import type { ModOptions } from './options'
import { textsOf } from './screen'
export { textsOf }

/** `mcp__<server>__<tool>` into its tool half; tool names never hold a double underscore. */
export function shortName(name: string): string {
  const at = name.lastIndexOf('__')
  return name.startsWith('mcp__') && at > 5 ? name.slice(at + 2) : name
}

const field = (input: unknown, key: string): unknown => (typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined)


// A feed URL that carries its credential in the query string, or in user:pass@host form. Built from strings so no literal is easy to mistake for a key.
const FEED_CREDENTIAL = new RegExp('[?&](?:api_?key|apikey|token|access_token|secret)=[A-Za-z0-9._~-]{12,}|://[^/\\s:@]+:[^/\\s@]{6,}@', 'i')

const WRITERS = new Set(['memory_store', 'agentdb_pattern-store', 'agentdb_hierarchical-store', 'ruvllm_hnsw_add'])
const READERS = new Set(['memory_search', 'memory_list', 'agentdb_pattern-search', 'agentdb_hierarchical-recall', 'agentdb_semantic-route', 'embeddings_generate', 'ruvllm_hnsw_route', 'ruvllm_hnsw_create'])

const inMarketNamespace = (input: unknown): boolean => /^market/.test(String(field(input, 'namespace') ?? ''))

/** The tools this plugin owns: the HNSW router, and the memory and pattern tools when they address a `market-*` namespace. */
export const isOwn = (name: string, input?: unknown): boolean =>
  name.startsWith('ruvllm_hnsw_') || ((WRITERS.has(name) || READERS.has(name)) && (input === undefined || inMarketNamespace(input)))

/** The reason a call is refused, or undefined when it may go. Never names or echoes a secret. */
export function verdict(name: string, input: unknown, _opts: ModOptions, _calls: Record<string, number>): string | undefined {
  if (!WRITERS.has(name)) return undefined
  const texts = textsOf(input)
  if (texts.some(hasSecret) || texts.some(t => FEED_CREDENTIAL.test(t))) {
    return 'ruflo-market-data: this market write holds what looks like a credential (a key, a token, or a feed URL with one in it). Store the feed name, not the credentialed URL.'
  }
  return undefined
}
