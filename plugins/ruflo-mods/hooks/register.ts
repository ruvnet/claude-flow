import type { Register } from 'claude-code'

import { registerAgents } from './agents'
import { registerCompact } from './compact'
import { registerCost } from './cost'
import { registerDelivery } from './delivery'
import { registerDescribe } from './describe'
import { registerGuard } from './guard'
import { createGuidance } from './guidance'
import { registerLearn } from './learn'
import { registerNoun } from './noun'
import { readOptions } from './options'
import { registerProbe } from './probe'
import { registerRollup } from './rollup'
import { registerRoute } from './route'
import { registerSession } from './session'
import { createState } from './state'
import { registerTrust } from './trust'

/**
 * ruflo as a Claude Code mod (ADR-404).
 *
 * In-process equivalents of the classic hook-handler.cjs events that fire on
 * every prompt and every edit, tighten-only tool checks, the cost ladder, the
 * `$.ruflo` noun other mods compose with, and the mod trust gate. Additive
 * and opt-in: the classic hooks stay the default, keep every event the mod
 * does not own, and take everything back whenever the mod is not loaded.
 *
 * Registration order is nesting order (the first registered wraps the rest):
 * the trust gate first, so it judges modules before anything else of ours runs.
 */
export const register: Register = (on, options) => {
  const state = createState()
  const opts = readOptions(options)
  const guidance = createGuidance(state, opts)

  registerTrust(on, opts.modTrust, opts.modTrustAllow)
  if (opts.capabilityProbe) registerProbe(on, state, opts)
  if (opts.sessionRollup) registerRollup(on, state)
  state.grounding.enabled = opts.grounding
  registerNoun(on, state)
  registerSession(on, state, opts, guidance)
  registerRoute(on, state, opts, guidance)
  registerGuard(on, state, guidance)
  registerLearn(on, state, guidance)
  registerCost(on, state, opts)
  if (opts.toolHints) registerDescribe(on, state)
  if (opts.agentTrim) registerAgents(on, state, opts)
  if (opts.deliveryScreen) registerDelivery(on, state)
  if (opts.compactCarry) registerCompact(on, state)
}
