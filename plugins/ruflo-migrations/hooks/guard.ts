import { hasSecret, secretsIn, textsOf } from './screen'
import type { ModOptions } from './options'
import type { Stats } from './status'

const WRITERS = new Set(['memory_store', 'agentdb_pattern-store', 'agentdb_hierarchical-store', 'agentdb_batch'])
const toolOf = (name: string) => (name.startsWith('mcp__') ? name.slice(name.lastIndexOf('__') + 2) : name)

/** This plugin's namespaces. A `memory_store` outside them is another plugin's write: still screened, but its refusal must not claim it. */
const OWN_NS = /^migration/i
const namespaceOf = (input: unknown): string | undefined => {
  const top = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const inner = typeof top.input === 'object' && top.input !== null ? (top.input as Record<string, unknown>) : {}
  return [top.namespace, inner.namespace].find((n): n is string => typeof n === 'string')
}
const foreignStore = (tool: string, input: unknown): boolean => /(?:^|__)memory_store$/.test(tool) && !OWN_NS.test(namespaceOf(input) ?? '')
/** The refusal for a secret in another plugin's `memory_store`: what was found and which namespace, never an owner and never content. */
function foreignRefusal(input: unknown): string {
  const ns = namespaceOf(input)
  const label = (ns ?? '').replace(/[^\w.:-]/g, '').slice(0, 40)
  const where = !ns ? 'no namespace' : label && !hasSecret(ns) && !hasSecret(label) ? `namespace "${label}"` : 'a namespace not shown here'
  return `ruflo-migrations: a secret-shaped value (a key, token or password) was found in a memory write; the call targeted ${where}. Store a reference to where it lives, not the value.`
}

/**
 * The reason a call is refused, or undefined when it may go. Migration SQL and connection strings are routinely pasted into memory, so a
 * memory write holding a secret or a database URL with an inline password is refused. Names the rule, never echoes the value.
 */
export function verdict(tool: string, input: unknown, _opts: ModOptions, stats: Stats): string | undefined {
  if (!WRITERS.has(toolOf(tool))) return undefined
  stats.checked++
  const found = textsOf(input).flatMap(secretsIn)
  if (found.length === 0) return undefined
  stats.lastBlock = found[0]
  if (foreignStore(tool, input)) return foreignRefusal(input)
  return 'ruflo-migrations: this memory write holds what looks like a secret or a database URL with a password. Store the migration name and a reference to where the credential lives, not the value.'
}
