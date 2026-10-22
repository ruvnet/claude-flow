/**
 * What the autopilot can honestly say about spend (ADR-470 §2.3). The cost ledger (ruflo-cost-tracker's ledger.mjs) filters rows by time
 * window and project (`--from --to --project`); it has NO per-session or per-process filter, so a reading is "every Claude Code turn in this
 * project in the window, priced at list price", yours included. That is the strictest reading the ledger can give and the one the ceilings
 * are enforced on: it over-counts rather than under-counts. Two things are made exact here that were not: a window never reaches back past
 * the Start (an hour window started 10 minutes ago no longer counts the 50 minutes before it), and a reading that cannot be trusted says
 * why (no tracker, an older tracker without the window filters, a model with no price) instead of waiting in silence.
 */
import { bumpKind, parseSemver } from '../updates'
import type { State } from '../state'
import { COST_PLUGIN, trackerOf } from './cost-ledger'
import { MISSION_COST_FROM } from './cost-probes'
import { missionCostArgv, parseMissionCost } from './mission-cost'
import type { Spend } from './ap-envelope'

/** Said wherever a spend figure is drawn. */
export const SPEND_BASIS = 'estimate at list price: every Claude Code turn in this project since Start, yours too (the ledger has no per-session reading)'

export type SpendSource = { kind: 'ready'; root: string } | { kind: 'unavailable'; why: string }

/** Whether the ledger can be asked for a window at all, and if not, the reason. */
export function spendSource(state: Pick<State, 'snapshot'>): SpendSource {
  const tracker = trackerOf(state)

  if (tracker.kind === 'absent') return { kind: 'unavailable', why: 'the ruflo-cost-tracker plugin is not installed, so there is no ledger to read' }
  if (tracker.kind === 'old') return { kind: 'unavailable', why: `ruflo-cost-tracker ${tracker.version} is older than the first release with the ledger` }

  const version = state.snapshot?.plugins.installed?.find(plugin => plugin.id === COST_PLUGIN)?.version ?? ''

  if (parseSemver(version) === null || bumpKind(version, MISSION_COST_FROM) !== null) return { kind: 'unavailable', why: `ruflo-cost-tracker ${version || '?'} lacks the window filters (needs ${MISSION_COST_FROM} or newer)` }

  return { kind: 'ready', root: tracker.root }
}

export type SpendArgvs = { hour: readonly string[] | null; day: readonly string[] | null; total: readonly string[] | null }

/** The three ledger commands. No window starts before the Start: the hour and day are `max(now - span, start)`. */
export function windowArgvs(root: string, startMs: number, nowMs: number, project: string): SpendArgvs {
  const at = (spanMs: number): number => Math.max(startMs, nowMs - spanMs)
  // Claude Code only: the hand-over is a prompt to this session, and a Codex reading adds nothing but rows (the ledger overflowed its stack on this machine's Codex history for a wide window).
  const claude = (argv: readonly string[] | null): readonly string[] | null => (argv === null ? null : [...argv, '--provider', 'claude'])

  return { hour: claude(missionCostArgv(root, at(3_600_000), null, project)), day: claude(missionCostArgv(root, at(86_400_000), null, project)), total: claude(missionCostArgv(root, startMs, null, project)) }
}

export type Reading = { spend: Spend; why: null } | { spend: null; why: string }

/**
 * The three ledger outputs as one reading. Unknown is never zero: a window that did not parse, or whose total is unknown, makes the whole
 * reading unknown, and so does a model with no price (its spend is missing from the total, so the total would under-count a ceiling).
 */
export function readingOf(out: { hour: string; day: string; total: string }): Reading {
  const [hour, day, total] = [parseMissionCost(out.hour), parseMissionCost(out.day), parseMissionCost(out.total)]

  if (hour === null || day === null || total === null) return { spend: null, why: 'the ledger did not answer with a reading' }

  const unpriced = [...new Set([...hour.unpriced, ...day.unpriced, ...total.unpriced])]

  if (unpriced.length > 0) return { spend: null, why: `no list price for ${unpriced.slice(0, 2).join(', ')}: the total would under-count, so it is not used` }
  if (hour.usd === null || day.usd === null || total.usd === null) return { spend: null, why: 'a window total is unknown' }

  return { spend: { hourUsd: hour.usd, dayUsd: day.usd, totalUsd: total.usd }, why: null }
}
