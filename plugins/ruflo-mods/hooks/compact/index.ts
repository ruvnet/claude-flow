import type { On } from 'claude-code'

import type { ModState } from '../state'
import { carryBlock } from './block'

/**
 * `session.compact` (ADR-451 item 7): appends one short, bounded block to what the summary is told to keep, naming the live swarm
 * and open claims, so a compaction does not forget them. Off unless `compactCarry` is on.
 *
 * Append only: the person's own `/compact` text and every other hook's change stay in front, the messages are never touched, and a
 * subagent's or fork's own compaction (`agentId`) is left alone. The block is built from validated words and counts, never prompt
 * text, tool input, paths or file contents. Any failure passes the compaction on unchanged.
 */
export function registerCompact(on: On, state: ModState) {
  const c = state.compact
  c.enabled = true

  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const block = await carryBlock(
      { stat: path => $.fs.stat(path), read: path => $.fs.read(path) },
      state.root,
      { agent: state.lastRoute?.agent, routed: state.routed, budget: state.budget.level, policy: state.policy },
    )
    if (!block) return next(e)
    c.carried += 1
    return next({ ...e, instructions: e.instructions ? `${e.instructions}\n\n${block}` : block })
  }).catch(($, e, next) => next(e)) // fail open
}
