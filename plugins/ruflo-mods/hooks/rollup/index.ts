import type { On } from 'claude-code'

import { isRaised, type BudgetLevel } from '../cost/budget'
import type { ModState } from '../state'
import { append, readLedger, type Rollup } from './record'

const LEDGER = 'sessionRollup'

/** What the rollup counts in one process. Counters only: nothing from any payload is kept. */
export type RollupState = {
  enabled: boolean
  tools: number
  denied: number
  spawns: number
  /** The highest cost rung the session reached. */
  rung: BudgetLevel
  written: boolean
  /** The shared routed/tightened counters at this session's start: a record carries only this session's share. */
  base: { routed: number; tightened: number }
  /** The ledger as last read or written, for the report. */
  recent: Rollup[]
}

export const rollupState = (): RollupState => ({ enabled: false, tools: 0, denied: 0, spawns: 0, rung: 'OK', written: false, base: { routed: 0, tightened: 0 }, recent: [] })

/**
 * Session rollup (ADR-451 item 6): observability only. Off unless
 * `sessionRollup` is on. It counts tool calls, denied checks and agent spawns
 * (reading no payload, only the verdict word), and at `session.end` appends
 * one bounded record of counters to the user-global `$.store` ledger
 * (50 records, 512 bytes each, 32 KB in all, pruned on write). Every hook hands
 * the event on unchanged; any failure of its own is swallowed.
 */
export function registerRollup(on: On, state: ModState) {
  const r = state.rollup
  r.enabled = true

  on('session.start', { surface: /^[\s\S]*$/ }, async ($, e, next) => {
    const result = await next(e)
    try {
      r.recent = readLedger(await $.store.get(LEDGER))
    } catch {
      r.recent = []
    }
    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: /^[\s\S]*$/ }, ($, e, next) => {
    r.tools++
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.check', { tool: /^[\s\S]*$/ }, async ($, e, next) => {
    const result = await next(e)
    try {
      if ((result as { decision?: unknown }).decision === 'deny') r.denied++
    } catch {
      // counting must not change the verdict
    }
    return result
  }).catch(($, e, next) => next(e))

  on('agent.spawn', { description: /^[\s\S]*$/ }, ($, e, next) => {
    r.spawns++
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', { reason: /^[\s\S]*$/ }, async ($, e, next) => {
    if (!r.written) {
      r.written = true
      try {
        if (isRaised(r.rung, state.budget.level)) r.rung = state.budget.level
        const record: Rollup = { at: await $.clock.now(), tools: r.tools, routed: state.routed - r.base.routed, tightened: state.tightened - r.base.tightened, denied: r.denied, spawns: r.spawns, cost: r.rung }
        if (state.probe.enabled) {
          const names = [...state.probe.registered]
          record.probe = `${names.filter(n => (state.probe.fired.get(n) ?? 0) > 0).length}/${names.length}`
        }
        r.recent = append(readLedger(await $.store.get(LEDGER)), record)
        await $.store.set(LEDGER, r.recent)
      } catch {
        // an unwritable ledger only means this session has no record
      }
    }
    // /clear and /resume end this session and the process goes on under another
    // (no session.start fires for it): the next session gets its own counters and record.
    if (e.reason === 'clear' || e.reason === 'resume') Object.assign(r, { tools: 0, denied: 0, spawns: 0, rung: 'OK', written: false, base: { routed: state.routed, tightened: state.tightened } })
    return next(e)
  }).catch(($, e, next) => next(e))
}
