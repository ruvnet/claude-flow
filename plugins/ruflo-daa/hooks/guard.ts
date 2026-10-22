import { hasSecret, textsOf } from './screen'

/** The tool name without its `mcp__<server>__` prefix. */
const tail = (name: string) => (name.startsWith('mcp__') ? name.slice(name.lastIndexOf('__') + 2) : name)

/** The reason a daa_* call is refused, or undefined when it may go. Never names or echoes the secret. */
export function verdict(tool: string, input: unknown): string | undefined {
  if (!tail(tool).startsWith('daa_')) return undefined
  return textsOf(input).some(hasSecret)
    ? 'ruflo-daa: this call holds what looks like a secret (a key, token or password). Agents, patterns and shared knowledge persist: pass a reference to where it lives, not the value.'
    : undefined
}
