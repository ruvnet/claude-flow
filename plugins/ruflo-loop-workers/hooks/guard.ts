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


/** The tools this plugin owns: the hooks_worker-* family. */
export const isOwn = (name: string, _input?: unknown): boolean => name.startsWith('hooks_worker-')

/** The reason a call is refused, or undefined when it may go. Never names or echoes a secret. */
export function verdict(name: string, input: unknown, opts: ModOptions, calls: Record<string, number>): string | undefined {
  if (name !== 'hooks_worker-dispatch') return undefined
  if (textsOf(input).some(hasSecret)) {
    return 'ruflo-loop-workers: this worker context holds what looks like a secret (a key, token or password). Workers log their context; pass a reference to where it lives.'
  }
  if ((calls[name] ?? 0) >= opts.maxDispatch) {
    return `ruflo-loop-workers: ${opts.maxDispatch} workers were dispatched this session, the cap. A loop that keeps dispatching is probably stuck; check hooks_worker-status, or raise maxDispatch.`
  }
  return undefined
}
