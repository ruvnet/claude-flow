import type { PluginOptions } from 'claude-code'

import { budgetOf } from './cost/budget'
import type { TrustPolicy } from './trust'

/** The plugin's `userConfig` options, validated: a bad value is the default. */
export type ModOptions = {
  readonly routeContext: boolean
  readonly guidanceContext: boolean
  readonly guidanceLearning: boolean
  readonly statusLine: boolean
  readonly costBudgetUsd?: number
  readonly costHardStop: boolean
  readonly toolHints: boolean
  readonly agentTrim: boolean
  readonly agentTrimKeep: ReadonlySet<string>
  readonly deliveryScreen: boolean
  readonly compactCarry: boolean
  readonly rureOffer: boolean
  readonly capabilityProbe: boolean
  readonly sessionRollup: boolean
  readonly sessionAttention: boolean
  readonly selfCheck: boolean
  readonly grounding: boolean
  readonly modTrust: TrustPolicy
  readonly modTrustAllow: ReadonlySet<string>
}

const bool = (value: unknown, fallback: boolean) =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : fallback

const TRUST: readonly TrustPolicy[] = ['observe', 'refuse-risky', 'off']

/** Plugin ids (`name@marketplace`), from a comma list or a string array; anything else is none. */
function names(value: unknown): ReadonlySet<string> {
  const list = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : []
  return new Set(list.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(v => /^[A-Za-z0-9._-]{1,64}@[A-Za-z0-9._-]{1,64}$/.test(v)))
}

export function readOptions(options: PluginOptions | undefined): ModOptions {
  const o = options ?? {}
  return {
    routeContext: bool(o.routeContext, true),
    guidanceContext: bool(o.guidanceContext, false),
    guidanceLearning: bool(o.guidanceLearning, false),
    statusLine: bool(o.statusLine, true),
    costBudgetUsd: budgetOf(o.costBudgetUsd),
    costHardStop: bool(o.costHardStop, false),
    toolHints: bool(o.toolHints, false),
    agentTrim: bool(o.agentTrim, false),
    agentTrimKeep: keepNames(o.agentTrimKeep),
    deliveryScreen: bool(o.deliveryScreen, false),
    compactCarry: bool(o.compactCarry, false),
    rureOffer: bool(o.rureOffer, false),
    capabilityProbe: bool(o.capabilityProbe, false),
    sessionRollup: bool(o.sessionRollup, false),
    sessionAttention: bool(o.sessionAttention, false),
    selfCheck: bool(o.selfCheck, true),
    grounding: bool(o.grounding, false),
    modTrust: TRUST.includes(o.modTrust as TrustPolicy) ? (o.modTrust as TrustPolicy) : 'observe',
    modTrustAllow: names(o.modTrustAllow),
  }
}

/** Agent type names to never hide, from a comma list or a string array; lower case, plain names only. */
function keepNames(value: unknown): ReadonlySet<string> {
  const list = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : []
  return new Set(list.filter((v): v is string => typeof v === 'string').map(v => v.trim().toLowerCase()).filter(v => /^[a-z0-9._:-]{1,64}$/.test(v)))
}
