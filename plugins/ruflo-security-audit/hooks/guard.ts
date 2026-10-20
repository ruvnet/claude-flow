import { hasSecret } from './screen'
import { textsOf } from './screen'
export { textsOf }

/** The tool's short name: `mcp__<server>__<tool>` to `<tool>`. */
export const shortName = (name: string) => (name.startsWith('mcp__') && name.lastIndexOf('__') > 5 ? name.slice(name.lastIndexOf('__') + 2) : name)

const field = (input: unknown, key: string): string => {
  const v = typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined
  return typeof v === 'string' ? v : ''
}

const NS = /^(?:security|audit|cve|vuln|findings|secaudit)/i
const WRITERS = new Set(['memory_store', 'agentdb_hierarchical-store', 'agentdb_pattern-store'])

/** The label of an audit-memory write, else undefined: the guard only watches writes into audit namespaces. */
export function watched(tool: string, input: unknown): string | undefined {
  if (!WRITERS.has(shortName(tool))) return undefined
  return NS.test(field(input, 'namespace')) ? 'audit-memory write' : undefined
}

/** The reason an audit-memory write is refused, or undefined when it may go. Never names or echoes the secret. */
export function verdict(tool: string, input: unknown): string | undefined {
  if (watched(tool, input) === undefined) return undefined
  return textsOf(input).some(hasSecret)
    ? 'ruflo-security-audit: this finding holds what looks like a live secret. Record the file, line and secret type, and redact the value, before storing it.'
    : undefined
}
