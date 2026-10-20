import type { On } from 'claude-code'

import { cachedFile, type Read } from '../files'
import type { GuidanceHooks } from '../guidance'
import { redraw, under, type ModState } from '../state'
import { dangerousCommandVerdict } from './dangerous-command'
import { parseProjection, policyOpinion, PROJECTION_PATH, type Projection } from './policy'
import { researchCheck } from './research'
import { stricter, type Verdict } from './verdict'

/** What `tool.check` answers when ruflo's own check could not run. */
export const CHECK_FAILED: Verdict = {
  decision: 'ask',
  reason: 'ruflo: its policy check could not run, so this call is put to you instead of allowed',
}

/**
 * Ruflo's opinion on one call, from the dangerous-command list and the read
 * policy projection; `observed` is set when observe mode would have acted.
 */
export function opinionOf(
  state: ModState,
  read: Read<Projection>,
  tool: string,
  input: unknown,
): { verdict?: Verdict; observed?: string } {
  const danger = dangerousCommandVerdict(tool, input)
  if (danger) return { verdict: danger }

  if (read.kind === 'absent') {
    state.policy = 'none'
    return {}
  }
  if (read.kind === 'error') {
    // The CLI writes a projection only where policy is in force: one that
    // exists and cannot be read fails closed, by one step.
    state.policy = 'unreadable'
    return { verdict: { ...CHECK_FAILED, reason: `ruflo: policy projection unreadable (${read.message}); asking instead of allowing` } }
  }
  state.policy = read.value.mode
  const { verdict, wouldBe } = policyOpinion(read.value, tool, input)
  return wouldBe ? { observed: wouldBe } : { verdict }
}

/**
 * `tool.check`: tighten only. The chain runs first (engine rules, mode, the
 * PreToolUse hooks, every plugin beneath); ruflo's opinion is merged with
 * `stricter`, so an allow may become an ask or a deny and nothing ever
 * becomes looser. The dangerous-command list always applies; ruflo policy
 * applies when the CLI projected rules for Claude Code tools.
 */
export function registerGuard(on: On, state: ModState, guidance?: GuidanceHooks) {
  const projection = cachedFile(() => under(state, PROJECTION_PATH), parseProjection)
  const research = researchCheck(state)

  on('tool.check', async ($, e, next) => {
    const task = guidance?.active()
    const chain = await next(e)
    const tool = typeof e.tool === 'string' ? e.tool : ''
    const read = await projection({ stat: path => $.fs.stat(path), read: path => $.fs.read(path) })
    const { verdict, observed } = opinionOf(state, read, tool, e.input)
    if (observed) {
      state.observed++
      try {
        $.ui.log(`ruflo policy (observe): ${tool} ${observed}`, { to: 'debug' })
      } catch {
        // a refused log never turns an observation into a failure
      }
    }
    // The research guard (ADR-440) sees what ruflo's own opinion left standing.
    const merged = await research({ stat: path => $.fs.stat(path), read: path => $.fs.read(path) }, tool, stricter(chain, verdict))
    if (merged !== chain) {
      state.tightened++
      redraw(state)
    }
    guidance?.check(task, merged.decision)
    return merged
  }).catch(async ($, e, next) => {
    // ruflo could not judge. Fail closed by one step: the chain's verdict
    // stands where it is already ask or deny; an allow is put to the person.
    const chain = await next(e).catch(() => undefined)
    const result = chain ? stricter(chain, CHECK_FAILED) : CHECK_FAILED
    guidance?.check(guidance.active(), result.decision)
    return result
  })
}
