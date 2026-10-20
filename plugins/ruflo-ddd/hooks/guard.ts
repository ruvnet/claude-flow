import { hasSecret, textsOf } from './screen'

/** The tool name without its `mcp__<server>__` prefix. */
const tail = (name: string) => (name.startsWith('mcp__') ? name.slice(name.lastIndexOf('__') + 2) : name)

const WRITERS = new Set(['memory_store', 'agentdb_hierarchical-store'])
const DOMAIN = /^(?:ddd|domain)-|^(?:context|aggregate):/

/** The DDD skills' own entries: a key named ddd-* or domain-*, or a hierarchy edge whose ends are context:* or aggregate:*. */
function isDomainWrite(input: unknown): boolean {
  const o = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  return ['key', 'parent', 'child'].some(k => typeof o[k] === 'string' && DOMAIN.test(o[k] as string))
}

/** The reason a domain-model memory write is refused, or undefined when it may go. Never names or echoes the secret. */
export function verdict(tool: string, input: unknown): string | undefined {
  if (!WRITERS.has(tail(tool)) || !isDomainWrite(input)) return undefined
  return textsOf(input).some(hasSecret)
    ? 'ruflo-ddd: this domain-model entry holds what looks like a secret (a key, token or password). The model records contexts and aggregates, not credentials.'
    : undefined
}
