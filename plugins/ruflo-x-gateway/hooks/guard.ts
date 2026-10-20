import { hasSecret } from './screen'
import { textsOf } from './screen'
export { textsOf }

/** The tool's short name: `mcp__<server>__<tool>` to `<tool>`. */
export const shortName = (name: string) => (name.startsWith('mcp__') && name.lastIndexOf('__') > 5 ? name.slice(name.lastIndexOf('__') + 2) : name)

const field = (input: unknown, key: string): string => {
  const v = typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined
  return typeof v === 'string' ? v : ''
}

const PUBLISH = new Set(['x_federation_publish', 'x_federation_channel_publish', 'x_federation_invite_mint'])

/** The label of a federation publish, else undefined: the guard only watches calls that put content on the swarm or mint a credential for it. */
export function watched(tool: string, _input: unknown): string | undefined {
  const t = shortName(tool)
  return PUBLISH.has(t) ? t.replace('x_federation_', '').replace('_', ' ') : undefined
}

/** The reason a publish is refused, or undefined when it may go. Never names or echoes the secret. */
export function verdict(tool: string, input: unknown): string | undefined {
  if (watched(tool, input) === undefined) return undefined
  return textsOf(input).some(hasSecret)
    ? 'ruflo-x-gateway: this message holds what looks like a secret (a key, token or password). The swarm is shared and signed messages are permanent; send a reference, not the value.'
    : undefined
}
