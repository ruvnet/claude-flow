import type { On } from 'claude-code'

import type { ModState } from '../state'
import { withHint } from './hints'

/**
 * `tool.describe` (ADR-451): adds one static usage hint to the description of
 * a few ruflo MCP tools, once per tool per session. Off unless the
 * `toolHints` option is on. It only appends text: placement (`isDeferred`)
 * and the engine's own description are kept, and a tool not in the hint
 * table, or from any other server, is left exactly as it came.
 */
export function registerDescribe(on: On, state: ModState) {
  state.toolHints.enabled = true

  on('tool.describe', { tool: /^mcp__(?:plugin_ruflo-core_ruflo|claude-flow|ruflo)__/ }, async (_$, e, next) => {
    const result = await next(e)
    const description = withHint(e.tool, result.description)
    if (description === result.description || typeof description !== 'string') return result
    state.toolHints.described.add(e.tool)
    return { ...result, description }
  })
}
