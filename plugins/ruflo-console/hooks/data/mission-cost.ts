/**
 * Mission spend (ADR-443 §2.3). The console asks the ruflo-cost-tracker plugin's `ledger.mjs` for the spend inside a
 * mission's time window and project, and compares it with an optional USD cap on the ADR-437 ladder (50, 75, 90, 100
 * percent of the cap). Pure: it builds the command and reads the answer; the probe runner does the running. Local only,
 * and USD and Codex credits are never added together; a model without a price is listed, never counted as $0.
 */
import { budgetAmount, ladderDollars } from '../cost'
import { jsonAfter } from './cli'
import { safeInstallPath } from './cost-ledger'
import { numberOf, plain, recordOf } from './parse'
import { hasParentSegment, isAbsolutePath, joinPath } from './paths'

export type MissionCost = { usd: number | null; credits: number | null; unpriced: string[]; rows: number; /** The window's start the ledger reports back: it says which mission the reading is for. */ fromMs: number | null }
export type CapLevel = 'none' | 'OK' | 'INFO' | 'WARNING' | 'CRITICAL' | 'HARD_STOP'
export type CapState = { level: CapLevel; percent: number | null }

/** An absolute path (POSIX, drive-lettered or UNC): no control characters, no `..` segment. It is one argv element, never part of a shell line. */
const safeProject = (value: unknown): string | undefined => {
  const path = typeof value === 'string' ? value : ''

  return isAbsolutePath(path) && path.length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/.test(path) && !hasParentSegment(path) ? path : undefined
}

/**
 * The ledger command for one mission: its window (`fromMs`, and `toMs` once it has ended) in its `project`. `null` when
 * the plugin root or the project fails the path checks, or a time is not a real instant. A mission still running has
 * `toMs === null`, so no `--to` is sent and the window stays open at the right.
 */
export function missionCostArgv(root: string, fromMs: number, toMs: number | null, project: string): readonly string[] | null {
  const base = safeInstallPath(root)
  const where = safeProject(project)
  const iso = (ms: number): string | undefined => (Number.isFinite(ms) && Math.abs(ms) < 8.64e15 ? new Date(ms).toISOString() : undefined)
  const from = iso(fromMs)
  const to = toMs === null ? null : iso(toMs)

  if (base === undefined || where === undefined || from === undefined || to === undefined) return null
  if (to !== null && Date.parse(to) < Date.parse(from)) return null

  return ['node', joinPath(base, 'scripts', 'ledger.mjs'), '--format', 'json', '--from', from, ...(to === null ? [] : ['--to', to]), '--project', where]
}

/** What `ledger.mjs --format json` printed for the window. A total that is missing is `null` (unknown), not zero. */
export function parseMissionCost(stdout: string): MissionCost | null {
  const value = recordOf(jsonAfter(stdout))
  const totals = recordOf(value?.totals)

  if (value === null || totals === null) return null

  const rows = Math.max(0, Math.floor(numberOf(value.rows) ?? 0))
  const usd = numberOf(totals.usd)
  const credits = numberOf(totals.credits)

  return {
    // No rows at all is a true $0; rows that are all unpriced leave the total unknown, which is not the same thing.
    usd: usd !== undefined && usd >= 0 ? usd : rows === 0 ? 0 : null,
    credits: credits !== undefined && credits >= 0 ? credits : null,
    unpriced: Object.keys(recordOf(value.unpriced) ?? {}).slice(0, 10).map(name => plain(name, 50)),
    rows,
    fromMs: windowFromMs(value.window),
  }
}

function windowFromMs(window: unknown): number | null {
  const from = recordOf(window)?.from
  const ms = typeof from === 'string' ? Date.parse(from) : NaN

  return Number.isFinite(ms) ? ms : null
}

/** Where `spendUsd` sits on the ladder of `cap`; `none` without a spend or a cap. `percent` is the share of the cap used. */
export function capState(spendUsd: number | null, cap: number | null): CapState {
  if (spendUsd === null || cap === null || !Number.isFinite(spendUsd) || !Number.isFinite(cap) || cap <= 0 || spendUsd < 0) return { level: 'none', percent: null }

  const reached = ladderDollars(cap).filter(rung => rung.usd !== null && spendUsd >= rung.usd).at(-1)

  return { level: (reached?.level as CapLevel | undefined) ?? 'OK', percent: spendUsd / cap * 100 }
}

/** Auto-run stops at the cap, and only when auto-run is on: a warning level never pauses anything. */
export const shouldPause = (state: CapState, autoRun: boolean): boolean => autoRun && state.level === 'HARD_STOP'

/** A cap typed by the person: 0.01 to 10000 dollars, decimal digits only (same rule as the budget setter). */
export const capUsd = (text: string): number | null => budgetAmount(text)
