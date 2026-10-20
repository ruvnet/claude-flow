import { hasSecret } from './screen'
import { isWriter } from './tools'
import { textsOf } from './screen'
export { textsOf }

/** The shared walker's budgets (screen.ts NODES, CHARS). Past either, textsOf drops the rest silently, so the guard refuses instead of passing it. */
const NODE_CAP = 20_000
const CHAR_CAP = 2_000_000
const NAME_FIELD = /^(?:key|name|field|label|variable|env|header|param|property)$/i
const VALUE_FIELD = /^(?:value|val|content|secret|data|text|string)$/i

/**
 * What the shared walker cannot see: `{ key: 'api_key', value: '...' }` and `['api_key', '...']` hold the name and the value in two strings, so
 * the key-assignment rule never sees them together. Returns those pairs as `name=value` texts and whether the input is past the walker's budgets.
 */
export function extras(input: unknown): { readonly pairs: string[]; readonly oversize: boolean } {
  const pairs: string[] = []
  const queue: unknown[] = [input]
  let chars = 0
  for (let head = 0; head < queue.length; head++) {
    if (queue.length > NODE_CAP) return { pairs, oversize: true }
    const node = queue[head]
    if (typeof node === 'string') {
      chars += node.length
      if (chars > CHAR_CAP) return { pairs, oversize: true }
    } else if (Array.isArray(node)) {
      if (node.length === 2 && typeof node[0] === 'string' && typeof node[1] === 'string') pairs.push(`${node[0]}=${node[1]}`)
      for (const v of node) queue.push(v)
    } else if (typeof node === 'object' && node !== null) {
      const o = node as Record<string, unknown>
      const keys = Object.keys(o)
      const name = keys.find(k => NAME_FIELD.test(k) && typeof o[k] === 'string')
      const value = keys.find(k => VALUE_FIELD.test(k) && typeof o[k] === 'string')
      if (name && value) pairs.push(`${o[name]}=${o[value]}`)
      for (const k of keys) {
        chars += k.length
        queue.push(o[k])
      }
    }
  }
  return { pairs, oversize: false }
}

export const SECRET_REFUSAL = 'ruflo-agentdb: this memory write holds what looks like a secret (a key, token or password). Store a reference to where it lives, not the value.'

/** Whether `input` holds a secret, judged like a write but never refusing for size: the best-effort file layer fails open past the budgets. */
export const holdsSecret = (input: unknown): boolean => textsOf(input).some(hasSecret) || extras(input).pairs.some(hasSecret)

/** The reason a memory write is refused, or undefined when it may go. Never names or echoes the secret. */
export function verdict(tool: string, input: unknown): string | undefined {
  if (!isWriter(tool)) return undefined
  const { pairs, oversize } = extras(input)
  if (oversize) return 'ruflo-agentdb: this memory write is too large to screen for secrets in full. Store it in smaller pieces.'
  return textsOf(input).some(hasSecret) || pairs.some(hasSecret)
    ? SECRET_REFUSAL
    : undefined
}
