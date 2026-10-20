import type { On } from 'claude-code'

import type { ModOptions } from '../options'
import type { ModState } from '../state'

/**
 * Capability probe (ADR-451 item 5): observability only. Off unless
 * `capabilityProbe` is on. It counts which of the events this module registered
 * fired, and keeps the engine version `$.session.version()`
 * reports, so `/ruflo-mods` can say "registered but never fired" when a build
 * renames or withholds an event. It reads no event payload, answers nothing,
 * writes nothing of its own and never changes, delays or denies a hook: each
 * event is handed on unchanged.
 */
export type ProbeState = {
  enabled: boolean
  /** Engine version as `$.session.version()` gave it; undefined when the build does not expose it. */
  version?: string
  /** Event names the module registered (pattern strings, ours, never payload). */
  registered: Set<string>
  fired: Map<string, number>
}

export const probeState = (): ProbeState => ({ enabled: false, registered: new Set(), fired: new Map() })

const MAX_LINE = 240

/**
 * The events this module registers, by name. The engine reads `on` calls
 * statically (it refuses a wrapped or aliased `on`), so the list is kept here;
 * tests/probe.test.ts fails when it drifts from what register() hooks under any option combination.
 */
const ALWAYS = ['command.run', 'engine.create', 'prompt.submit', 'session.end', 'session.start', 'tool.call', 'tool.check', 'turn.complete'] as const

type EventOptions = Pick<ModOptions, 'toolHints' | 'agentTrim' | 'deliveryScreen'> &
  Partial<Pick<ModOptions, 'compactCarry' | 'costBudgetUsd' | 'costHardStop' | 'sessionRollup' | 'modTrust'>>

export function registeredEvents(opts: EventOptions): string[] {
  const names: string[] = [...ALWAYS]
  // Registered only under these options, so "never fired" is not reported for an event the mod did not hook.
  if (opts.modTrust !== 'off') names.push('plugin.register')
  if (opts.costBudgetUsd !== undefined) names.push('session.measure')
  if ((opts.costBudgetUsd !== undefined && opts.costHardStop) || opts.sessionRollup || opts.agentTrim) names.push('agent.spawn')
  if (opts.toolHints) names.push('tool.describe')
  if (opts.agentTrim) names.push('agent.offer')
  if (opts.deliveryScreen) names.push('session.receive', 'session.send')
  if (opts.compactCarry) names.push('session.compact')
  return names.sort()
}

/**
 * One pass-through hook on every event: it counts the events the module
 * registered and hands the event on unchanged, answering nothing. Any failure
 * of its own passes the event on.
 */
export function registerProbe(on: On, state: ModState, opts: ModOptions) {
  state.probe.enabled = true
  for (const name of registeredEvents(opts)) state.probe.registered.add(name)
  on('*', ($, e, next) => {
    try {
      const name = (next as { event?: unknown }).event
      if (typeof name === 'string' && state.probe.registered.has(name)) state.probe.fired.set(name, (state.probe.fired.get(name) ?? 0) + 1)
    } catch {
      // counting must not change what any hook does
    }
    return next(e)
  }).catch(($, e, next) => next(e))
}

/** The version string kept from `$.session.version()`: printable, short; anything else is "not exposed". */
export function versionText(value: unknown): string | undefined {
  const { version, base } = (value ?? {}) as { version?: unknown; base?: unknown }
  const text = typeof base === 'string' && base ? base : version
  return typeof text === 'string' && /^[A-Za-z0-9._+-]{1,40}$/.test(text) ? text : undefined
}

/** The bounded status text the `probe:` row of `/ruflo-mods` shows (no label of its own: the report adds it). */
export function probeLine(probe: ProbeState): string {
  if (!probe.enabled) return 'off (set the capabilityProbe option)'
  const names = [...probe.registered].sort()
  const fired = names.filter(n => (probe.fired.get(n) ?? 0) > 0).length
  const never = names.filter(n => !probe.fired.get(n))
  const engine = probe.version ? `engine ${probe.version}` : 'engine version not exposed'
  const tail = never.length ? ` · never fired: ${never.join(', ')}` : ''
  const line = `${engine} · events fired ${fired}/${names.length}${tail}`
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line
}
