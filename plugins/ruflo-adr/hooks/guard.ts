import { hasSecret } from './screen'
import { textsOf } from './screen'
export { textsOf }

/** `mcp__<server>__<tool>` into its two halves; tool names never hold a double underscore. */
export function splitName(name: string): { server: string; tool: string } | undefined {
  if (!name.startsWith('mcp__')) return undefined
  const at = name.lastIndexOf('__')
  return at > 5 ? { server: name.slice(5, at), tool: name.slice(at + 2) } : undefined
}

const namespaceOf = (input: unknown): string => {
  const ns = (input as { namespace?: unknown } | null)?.namespace
  return typeof ns === 'string' ? ns : ''
}

/** An ADR entry id as the plugin's skills write it: `mem:ADR-0007`, `ADR-0007`. */
const ADR_ID = /^(?:mem:)?ADR-/i

const field = (input: unknown, key: string): string => {
  const v = (input as Record<string, unknown> | null)?.[key]
  return typeof v === 'string' ? v : ''
}

/**
 * True for the tool calls this plugin guards: ADR writes. `memory_store` into an `adr*` namespace; `agentdb_hierarchical-store` (which has no namespace
 * field, so the entry is told apart by its `mem:ADR-NNN` key) and `agentdb_causal-edge` (by its `mem:ADR-NNN` ends), as the adr-create skill calls them.
 */
export function owns(tool: string, input: unknown): boolean {
  const parts = splitName(tool)
  const name = parts?.tool ?? tool
  const adrNamespace = /adr/i.test(namespaceOf(input))
  if (name === 'memory_store') return adrNamespace
  if (name === 'agentdb_hierarchical-store') return adrNamespace || ADR_ID.test(field(input, 'key'))
  if (name === 'agentdb_causal-edge') return adrNamespace || ADR_ID.test(field(input, 'sourceId')) || ADR_ID.test(field(input, 'targetId'))
  return false
}

/** The reason a call is refused, or undefined when it may go. Never names or echoes the secret. */
export function verdict(tool: string, input: unknown): string | undefined {
  if (!owns(tool, input)) return undefined
  return textsOf(input).some(hasSecret) ? "ruflo-adr: this ADR write holds what looks like a secret (a key, token or password). An ADR records a decision; name where the secret lives, not its value." : undefined
}
