import { hasSecret, textsOf } from './screen'
import { bare } from './tools'
import type { ModOptions } from './options'

/** The engine's tools are named `sublinear/<verb>` and surface as `sublinear_*` once an MCP server carries them. */
export const isGraphTool = (name: string) => /^sublinear[/_-]|graph[-_]intelligence/i.test(bare(name))

/**
 * The reason a graph-intelligence call is refused, or undefined when it may go. Its inputs (graph ids, node ids, seed nodes) end up in
 * signed reasoning artifacts and federation-distributable vectors, so a secret there is copied to every peer. Never echoes the value.
 */
export function verdict(tool: string, input: unknown, _opts: ModOptions): string | undefined {
  if (!isGraphTool(tool)) return undefined
  return textsOf(input).some(hasSecret)
    ? 'ruflo-graph-intelligence: this call holds what looks like a secret (a key, token or password). Graph ids and node ids end up in signed artifacts that federation can copy; use an opaque id.'
    : undefined
}
