import { hasSecret } from './screen'
import { textsOf } from './screen'
export { textsOf }

/** The tool's short name: `mcp__<server>__<tool>` to `<tool>`. */
export const shortName = (name: string) => (name.startsWith('mcp__') && name.lastIndexOf('__') > 5 ? name.slice(name.lastIndexOf('__') + 2) : name)

const field = (input: unknown, key: string): string => {
  const v = typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined
  return typeof v === 'string' ? v : ''
}

const NS = /^sparc/i
const WRITERS = new Set(['memory_store', 'agentdb_hierarchical-store', 'agentdb_pattern-store'])

/** The label of a write into a sparc namespace, else undefined: the guard only watches those. */
export function watched(tool: string, input: unknown): string | undefined {
  if (!WRITERS.has(shortName(tool))) return undefined
  return NS.test(field(input, 'namespace')) ? 'sparc artifact write' : undefined
}

/** The reason a sparc artifact write is refused, or undefined when it may go. Never names or echoes the secret. */
export function verdict(tool: string, input: unknown): string | undefined {
  if (watched(tool, input) === undefined) return undefined
  return textsOf(input).some(hasSecret)
    ? 'ruflo-sparc: this spec or artifact holds what looks like a secret (a key, token or password). Write a placeholder and name where the real value lives.'
    : undefined
}
