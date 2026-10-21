import { hasSecret } from './screen'
import { textsOf } from './screen'
export { textsOf }

/** `mcp__<server>__<tool>` into its two halves; tool names never hold a double underscore. */
export function splitName(name: string): { server: string; tool: string } | undefined {
  if (!name.startsWith('mcp__')) return undefined
  const at = name.lastIndexOf('__')
  return at > 5 ? { server: name.slice(5, at), tool: name.slice(at + 2) } : undefined
}

/** True for the tool calls this plugin guards: what `aidefence_learn` teaches the detector (patterns persist and are shown back later). */
export function owns(tool: string, input: unknown): boolean {
  const parts = splitName(tool)
  const name = parts?.tool ?? tool
  return name === 'aidefence_learn'
}

/** The reason a call is refused, or undefined when it may go. Never names or echoes the secret. */
export function verdict(tool: string, input: unknown): string | undefined {
  if (!owns(tool, input)) return undefined
  return textsOf(input).some(hasSecret) ? "ruflo-aidefence: this learning sample holds what looks like a secret (a key, token or password). Learned patterns are stored and replayed; describe the shape of the threat, not the live value." : undefined
}
