import { hasSecret, textsOf } from './screen'
import { bare, namespaceOf } from './tools'
import type { ModOptions } from './options'

/** Learning writes: a secret in a stored pattern, trajectory or training row would be learned, recalled and, via transfer, published. */
const LEARNERS = new Set(['hooks_intelligence_pattern-store', 'hooks_intelligence_trajectory-step', 'hooks_intelligence_trajectory-end', 'neural_train', 'hooks_transfer', 'memory_store'])
const PATTERN_NS = /^(?:patterns?|intelligence|sona|neural|trajector)/i

// `hooks_transfer` publishes to IPFS, which is public; an email address is personal data the plugin's own skill says to strip first.
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,}/

const isReset = (name: string) => name.replace(/_/g, '-') === 'hooks-intelligence-reset'

/** The reason an intelligence call is refused, or undefined when it may go. Never names or echoes the value. */
export function verdict(tool: string, input: unknown, opts: ModOptions): string | undefined {
  const name = bare(tool)

  if (isReset(name)) {
    if (!opts.confirmReset || (input as { confirm?: unknown } | null)?.confirm === true) return undefined
    return 'ruflo-intelligence: resetting the intelligence store erases every learned pattern. Ask the user first; once they agree, call again with confirm: true.'
  }

  if (!LEARNERS.has(name)) return undefined
  if (name === 'memory_store' && !PATTERN_NS.test(namespaceOf(input))) return undefined
  const texts = textsOf(input)
  if (texts.some(hasSecret)) {
    return 'ruflo-intelligence: this learning write holds what looks like a secret (a key, token or password). Learned patterns are recalled and can be published, so leave it out.'
  }
  if (name === 'hooks_transfer' && texts.some(t => EMAIL.test(t))) {
    return 'ruflo-intelligence: this transfer holds an email address, and IPFS is public. Strip personal data first (aidefence_has_pii), then publish.'
  }
  return undefined
}
