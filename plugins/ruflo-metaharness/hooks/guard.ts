import { hasSecret } from './screen'
import type { ModOptions } from './options'
import { textsOf } from './screen'
export { textsOf }

/** `mcp__<server>__<tool>` into its tool half; tool names never hold a double underscore. */
export function shortName(name: string): string {
  const at = name.lastIndexOf('__')
  return name.startsWith('mcp__') && at > 5 ? name.slice(at + 2) : name
}

const field = (input: unknown, key: string): unknown => (typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined)


/** The tools this plugin owns: every `metaharness_*` tool. */
export const isOwn = (name: string, _input?: unknown): boolean => name.startsWith('metaharness_')

/** The reason a call is refused, or undefined when it may go. Never names or echoes a secret. */
export function verdict(name: string, input: unknown, _opts: ModOptions, _calls: Record<string, number>): string | undefined {
  if (textsOf(input).some(hasSecret)) {
    return 'ruflo-metaharness: this input holds what looks like a secret (a key, token or password). MetaHarness records its inputs in audit memory; pass a path or a reference instead.'
  }
  if (name === 'metaharness_flywheel' && ['promote', 'evidence-reset'].includes(String(field(input, 'operation'))) && field(input, 'confirm') !== true) {
    return 'ruflo-metaharness: promoting a receipt or resetting evidence changes the active harness. Ask the user, then retry with confirm: true.'
  }
  return undefined
}
