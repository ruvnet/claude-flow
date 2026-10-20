import type { On } from 'claude-code'

import type { ModOptions } from '../options'
import { redraw, type ModState } from '../state'
import { alertLevel, isRaised, type BudgetLevel } from './budget'

/**
 * ruflo-cost-tracker's budget ladder on the session's live cost:
 * `session.measure` pushes the figure after each turn, so no transcript parse
 * and no node spawn. Crossing a rung up says so once. With `costHardStop`,
 * the HARD_STOP rung does what budget.mjs recommends at 100%: new subagent
 * spawns are refused (a deny on `agent.spawn`; tightening only).
 */
export function registerCost(on: On, state: ModState, options: ModOptions) {
  const limit = options.costBudgetUsd
  if (limit === undefined) return
  state.budget = { level: 'OK', limit }
  let announced: BudgetLevel = 'OK' // the highest rung told this session; a fall and a second rise stay quiet

  // The budget is per session. /clear ends one (session.end, reason clear; no
  // session.start follows) and the process goes on with the next one's cost
  // counted from zero, so the ladder and the hard stop start over. Registered
  // after the rollup, which records this session's rung before this runs.
  on('session.end', { reason: /^clear$/ }, ($, e, next) => {
    announced = 'OK'
    state.budget = { level: 'OK', limit }
    redraw(state)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    const usd = e.cost?.usd
    if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) return result

    const level = alertLevel(usd / limit)
    const raised = isRaised(announced, level)
    if (raised) announced = level
    state.budget = { level, usd, limit }
    if (isRaised(state.rollup.rung, level)) state.rollup.rung = level // the session rollup keeps the highest rung reached
    if (raised) {
      // INFO and WARNING are heads-up; CRITICAL and HARD_STOP are errors, which the toast policy never drops (ADR-477).
      await state.say({ level: level === 'INFO' ? 'info' : level === 'WARNING' ? 'warn' : 'error', text: `ruflo budget ${level}: $${usd.toFixed(2)} of $${limit.toFixed(2)} this session`, timeoutMs: 8000 })
      redraw(state)
    }
    return result
  })

  if (options.costHardStop) {
    on('agent.spawn', ($, e, next) =>
      state.budget.level === 'HARD_STOP'
        ? { deny: `ruflo budget: $${(state.budget.usd ?? 0).toFixed(2)} of $${limit.toFixed(2)} spent; new agents are halted (costHardStop)` }
        : next(e),
    )
  }
}
