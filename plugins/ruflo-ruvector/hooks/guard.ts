import { hasSecret } from './screen'
import { isWriter } from './tools'
import { textsOf } from './screen'
export { textsOf }

/** This plugin's namespaces. A `memory_store` outside them is another plugin's write: still screened, but its refusal must not claim it. */
const OWN_NS = /^(?:vector|hyperbolic|ruvector)/i
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
  return `ruflo-ruvector: a secret-shaped value (a key, token or password) was found in a memory write; the call targeted ${where}. Store a reference to where it lives, not the value.`
}

/** The reason a call is refused, or undefined when it may go. Never names or echoes the secret. */
export function verdict(tool: string, input: unknown): string | undefined {
  if (!isWriter(tool)) return undefined
  return textsOf(input).some(hasSecret)
    ? foreignStore(tool, input)
      ? foreignRefusal(input)
      : 'ruflo-ruvector: this call holds what looks like a secret (a key, token or password). Keep secrets out of the vector store and the shared brain; store a reference instead.'
    : undefined
}
