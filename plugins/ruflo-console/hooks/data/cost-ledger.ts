/**
 * The Cost page's multi-provider ledger. The mod cannot read the agents' logs itself, so it asks the ruflo-cost-tracker
 * plugin's `ledger.mjs` (installed under Claude Code's plugin cache) for one local JSON summary: Claude Code and Codex
 * spend, cache hit ratio and optimisation findings. Local only: nothing here reaches the network, and the script path
 * comes from `installed_plugins.json`, validated, never from typed text. USD and Codex credits are never added together.
 */
import { jsonAfter, type Probe } from './cli'
import { numberOf, plain, recordOf, stringOf } from './parse'
import { hasParentSegment } from './paths'

import type { State } from '../state'

export const COST_PLUGIN = 'ruflo-cost-tracker@ruflo'

export type Money = { usd?: number; credits?: number }
export type LedgerModel = { provider: string; model: string; cost: Money; messages: number; output: number }
export type Finding = { id: string; title: string; evidence: string; action: string; saving: number | null; unit: 'usd' | 'credits' | null }
export type Ledger = {
  since: string
  priceDate: string
  totals: Money
  providers: { name: string; cost: Money; hitRatio: number | null }[]
  models: LedgerModel[]
  days: { day: string; usd: number }[]
  unpriced: string[]
  approx: string[]
  findings: Finding[]
}

const moneyOf = (value: unknown): Money => {
  const record = recordOf(value)
  const usd = numberOf(record?.usd)
  const credits = numberOf(record?.credits)

  return { ...(usd !== undefined && { usd }), ...(credits !== undefined && { credits }) }
}

/** An absolute path of a plugin's install directory (POSIX, or drive-lettered on Windows): no `..`, no control characters, no shell-looking text. */
export const safeInstallPath = (value: unknown): string | undefined => {
  const path = typeof value === 'string' ? value : ''

  return (/^\/[A-Za-z0-9._@+/ -]{1,300}$/.test(path) || /^[A-Za-z]:[\\/][A-Za-z0-9._@+\\/ -]{1,300}$/.test(path)) && !hasParentSegment(path) ? path : undefined
}

/** The ledger JSON `ledger.mjs --format json --advise` prints. */
export function parseLedger(stdout: string): Ledger | null {
  const value = recordOf(jsonAfter(stdout))
  const totals = recordOf(value?.totals)
  const byProvider = recordOf(value?.byProvider)

  if (value === null || totals === null || byProvider === null) return null

  const cache = recordOf(value.cache) ?? {}
  const byModel = recordOf(value.byModel) ?? {}
  const tokens = recordOf(value.tokens) ?? {}
  const byDay = recordOf(value.byDay) ?? {}
  const unpriced = recordOf(value.unpriced) ?? {}
  const findings = Array.isArray(value.findings) ? value.findings : []

  return {
    since: stringOf(value.since, 12) ?? '7d',
    priceDate: stringOf(value.priceDate, 12) ?? 'unknown',
    totals: moneyOf(totals),
    providers: Object.entries(byProvider).slice(0, 8).map(([name, cost]) => ({ name: plain(name, 20), cost: moneyOf(cost), hitRatio: numberOf(recordOf(cache[name])?.hitRatio) ?? null })),
    models: Object.entries(byModel).slice(0, 40).map(([key, cost]) => {
      const [provider = '', model = ''] = key.split('|')
      const t = recordOf(tokens[key])

      return { provider: plain(provider, 20), model: plain(model, 50), cost: moneyOf(cost), messages: numberOf(t?.messages) ?? 0, output: numberOf(t?.output) ?? 0 }
    }),
    days: Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).slice(-14).map(([day, cost]) => ({ day: plain(day, 10), usd: moneyOf(cost).usd ?? 0 })),
    unpriced: Object.keys(unpriced).slice(0, 10).map(name => plain(name, 50)),
    approx: (Array.isArray(value.approx) ? value.approx : []).slice(0, 10).map(name => plain(name, 50)),
    findings: findings.slice(0, 12).flatMap(item => {
      const finding = recordOf(item)
      const title = stringOf(finding?.title, 140)

      return finding === null || title === undefined ? [] : [{ id: stringOf(finding.id, 40) ?? 'finding', title, evidence: stringOf(finding.evidence, 300) ?? '', action: stringOf(finding.action, 300) ?? '', saving: numberOf(finding.saving) ?? null, unit: finding.unit === 'usd' || finding.unit === 'credits' ? finding.unit : null }]
    }),
  }
}

/** The first release with the ledger script: an older install has no `ledger.mjs` to run. */
export const LEDGER_FROM = [0, 27, 0] as const

const atLeast = (version: string, from: readonly number[]): boolean => {
  const parts = /^(\d+)\.(\d+)\.(\d+)/.exec(version)?.slice(1).map(Number) ?? []

  for (let i = 0; i < 3; i++) if ((parts[i] ?? 0) !== from[i]) return (parts[i] ?? 0) > (from[i] ?? 0)

  return parts.length === 3
}

/** Whether the tracker is absent, too old to have the ledger, or ready (with the script's directory). */
export function trackerOf(state: Pick<State, 'snapshot'>): { kind: 'absent' } | { kind: 'old'; version: string } | { kind: 'ready'; root: string } {
  const entry = state.snapshot?.plugins.installed?.find(plugin => plugin.id === COST_PLUGIN)
  const root = safeInstallPath(entry?.installPath)

  if (entry === undefined || root === undefined) return { kind: 'absent' }

  return atLeast(entry.version, LEDGER_FROM) ? { kind: 'ready', root } : { kind: 'old', version: entry.version }
}

/** Where the plugin's ledger script is, or null when it is absent or too old (the probe then does not run). */
export function ledgerArgv(state: Pick<State, 'snapshot'>): readonly string[] | null {
  const tracker = trackerOf(state)

  return tracker.kind === 'ready' ? ['node', `${tracker.root}/scripts/ledger.mjs`, '--since', '7d', '--format', 'json', '--advise'] : null
}

export const costLedgerProbe: Probe<Ledger> = {
  id: 'cost-ledger', args: [], argvOf: ledgerArgv, views: ['cost'], everyMs: 300_000, timeoutMs: 60_000, parse: parseLedger,
}

export const COST_PROBES = [costLedgerProbe] as const
