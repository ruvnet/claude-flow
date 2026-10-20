import type { EngineInterface, On } from 'claude-code'

import type { ModOptions } from '../options'
import type { ModState } from '../state'
import { isKept, readUsage, type Usage } from './trim'

const LEDGER = 'agentUse'

/**
 * `agent.offer` (ADR-451 item 2): keeps agent types the project does not use
 * out of the model's listing. Off unless `agentTrim` is
 * on. A type stays when it is built in, a pinned core role, named in
 * `agentTrimKeep`, used in the last 30 days (the `$.store` ledger, fed by
 * `agent.spawn`), or named in the current prompt. Tighten-only on what the
 * model sees (measured live, 2026-10: a hidden type the prompt does NOT name is refused at dispatch, one the prompt names plainly is accepted; the
 * listing is built before the first prompt in a headless session, so a prompt naming a type does not put it back in the listing there). Any failure offers the type (the hook is skipped).
 */
export function registerAgents(on: On, state: ModState, options: ModOptions) {
  state.agentTrim.enabled = true

  on('agent.spawn', { subagentType: /^.+$/ }, async ($, e, next) => {
    try {
      const usage = await loadLedger($, state)
      usage[e.subagentType] = await $.clock.now()
      await $.store.set(LEDGER, usage)
    } catch {
      // an unwritable ledger only means the type may be hidden next session
    }
    return next(e)
  })

  on('agent.offer', async ($, e, next) => {
    const result = await next(e)
    if (!result.isOffered) return result
    const kept = isKept(e, { keep: options.agentTrimKeep, usage: await loadLedger($, state), prompt: state.agentTrim.prompt, now: await $.clock.now() })
    if (kept) return result
    const first = state.agentTrim.hidden.size === 0
    state.agentTrim.hidden.add(e.agent)
    if (first) {
      await state.say({ level: 'info', text: 'ruflo agentTrim: unused agent types are hidden from the model (see /ruflo-mods)' })
    }
    return { ...result, isOffered: false }
  }).catch(($, e, next) => next(e)) // fail open: a broken trim offers the type
}

/** The usage ledger, read once per process; a failed read is an empty ledger. */
function loadLedger($: EngineInterface, state: ModState): Promise<Usage> {
  return (state.agentTrim.ledger ??= $.store.get(LEDGER).then(readUsage, () => readUsage(undefined)))
}
