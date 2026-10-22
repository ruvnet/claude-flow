import { hasSecret, textsOf } from './screen'

/** The tool name without its `mcp__<server>__` prefix. */
const tail = (name: string) => (name.startsWith('mcp__') ? name.slice(name.lastIndexOf('__') + 2) : name)

const isDocWrite = (input: unknown) => {
  const o = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  return ['key', 'namespace'].some(k => typeof o[k] === 'string' && /^doc|[-_]doc/i.test(o[k] as string))
}

/** The reason a docs write is refused, or undefined when it may go: doc-* memory entries and the document worker's dispatch. */
export function verdict(tool: string, input: unknown): string | undefined {
  const t = tail(tool)
  if (!((t === 'memory_store' && isDocWrite(input)) || (t === 'hooks_worker-dispatch' && JSON.stringify(input ?? {}).includes('"document"')))) return undefined
  return textsOf(input).some(hasSecret)
    ? 'ruflo-docs: this docs entry holds what looks like a secret (a key, token or password). Generated documentation is shared: describe where the value lives, not the value.'
    : undefined
}
