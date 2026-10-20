import { hasSecret, textsOf } from './screen'

/** The tool name without its `mcp__<server>__` prefix. */
const tail = (name: string) => (name.startsWith('mcp__') ? name.slice(name.lastIndexOf('__') + 2) : name)

/** Federation tools that put content in front of another installation, plus a federation-namespaced memory write. */
const OUTBOUND = /^(?:x_federation_(?:publish|channel_publish|sync|invite_mint)|federation_bbs_(?:publish|sync))$/

/** US SSN, and a 13-16 digit run that passes the Luhn check and starts with a card network digit 2-6 (a card number; a 13-digit epoch-millisecond timestamp starts with 1 and must not read as one). */
const SSN = /\b\d{3}-\d{2}-\d{4}\b/
const CARD = /\b[2-6](?:\d[ -]?){11,14}\d\b/g

function luhn(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) d = d > 4 ? d * 2 - 9 : d * 2
    sum += d
  }
  return sum % 10 === 0
}

const hasPii = (text: string) => SSN.test(text) || (text.match(CARD) ?? []).some(m => luhn(m.replace(/\D/g, '')))

const isFederationMemory = (input: unknown) => {
  const o = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  return o.namespace === 'federation'
}

/** The reason an outbound federation call is refused, or undefined when it may go. Names the category, never the value. */
export function verdict(tool: string, input: unknown): string | undefined {
  const t = tail(tool)
  if (!(OUTBOUND.test(t) || (t === 'memory_store' && isFederationMemory(input)))) return undefined
  const texts = textsOf(input)
  if (texts.some(hasSecret)) return 'ruflo-federation: this message holds what looks like a secret (a key, token or password). It would leave this installation: remove it.'
  if (texts.some(hasPii)) return 'ruflo-federation: this message holds what looks like personal data (an SSN or card number). It would leave this installation: remove it or route it through the PII pipeline.'
  return undefined
}
