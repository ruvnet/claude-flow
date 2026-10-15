/**
 * What the autopilot may tune about its OWN way of working (ADR-466 §3), and the gate it must pass. Pure.
 *
 * Learning proposes and evaluates; it never decides and never widens. The tunables are step size, parallelism (never above the
 * envelope's cap), the model tier per class of step, the retry count and the ordering, each with a hard range. A change goes
 * propose -> evaluate (replay over the settled steps in the journal) -> promote, and only promote writes: it re-checks the result
 * against the envelope, and returns an immutable receipt whose hash chains to the one before. The current tunables are the fold of the
 * receipts over the defaults, so they survive a restart and every one can be reverted from its own receipt.
 *
 * Two kinds of change. A CONSERVATIVE one (lower parallelism, a higher tier, one more retry) is supported by evidence about the setting
 * being left: it is failing. An AGGRESSIVE one (higher parallelism, a lower tier) can only be supported by evidence about the setting
 * being left too (it is clean), so it enters a TRIAL and `reviewTrials` reverts it as soon as the new setting does worse. Steps that
 * finished without a verified effect are neither success nor failure here: an unverified step teaches nothing.
 */
import { canonical, sha256, type Envelope } from './ap-envelope'
import { REFUSED_WHY, type Receipt } from './ap-journal'
import type { StepRec } from './ap-loop'

export const TIERS = ['low', 'mid', 'high'] as const
export type Tier = (typeof TIERS)[number]
export const ORDERINGS = ['fifo', 'smallest-first'] as const
export type Ordering = (typeof ORDERINGS)[number]

export type Tunables = { stepSize: number; parallelism: number; retries: number; ordering: Ordering; tiers: Record<string, Tier>; defaultTier: Tier }

export const RANGE = { stepSize: [1, 5], parallelism: [1, 8], retries: [0, 3] } as const
export const MIN_SAMPLES = 6
export const TRIAL_SAMPLES = 6
export const FAIL_HIGH = 0.4
export const CLEAN = 0.1

export const DEFAULTS: Tunables = { stepSize: 1, parallelism: 1, retries: 1, ordering: 'fifo', tiers: {}, defaultTier: 'mid' }

const clampInt = (value: number, [lo, hi]: readonly [number, number], cap = hi): number => Math.max(lo, Math.min(Math.min(hi, cap), Math.round(Number.isFinite(value) ? value : lo)))

/** The tunables forced into every range and under the envelope's concurrency. The envelope is only read. */
export function clampToEnvelope(t: Tunables, env: Envelope): Tunables {
  const tiers: Record<string, Tier> = {}

  for (const [cls, tier] of Object.entries(t.tiers)) if ((TIERS as readonly string[]).includes(tier)) tiers[cls] = tier

  return {
    stepSize: clampInt(t.stepSize, RANGE.stepSize),
    parallelism: clampInt(t.parallelism, RANGE.parallelism, env.concurrency),
    retries: clampInt(t.retries, RANGE.retries),
    ordering: (ORDERINGS as readonly string[]).includes(t.ordering) ? t.ordering : 'fifo',
    tiers,
    defaultTier: (TIERS as readonly string[]).includes(t.defaultTier) ? t.defaultTier : 'mid',
  }
}

export const tierOf = (t: Tunables, cls: string): Tier => t.tiers[cls] ?? t.defaultTier

export type Change = { path: string; from: string; to: string }

const PATH = /^(parallelism|retries|stepSize|ordering|tier\.[a-z][a-z-]{1,23})$/

/** One change applied, or null when the path is not a tunable or the value is out of range. Nothing outside the tunables can be reached. */
export function applyChange(t: Tunables, change: Change): Tunables | null {
  if (!PATH.test(change.path)) return null

  const next: Tunables = { ...t, tiers: { ...t.tiers } }

  if (change.path.startsWith('tier.')) {
    if (!(TIERS as readonly string[]).includes(change.to)) return null
    next.tiers[change.path.slice(5)] = change.to as Tier

    return next
  }

  if (change.path === 'ordering') {
    if (!(ORDERINGS as readonly string[]).includes(change.to)) return null
    next.ordering = change.to as Ordering

    return next
  }

  const n = Number(change.to)
  const key = change.path as 'parallelism' | 'retries' | 'stepSize'

  if (!Number.isInteger(n) || n < RANGE[key][0] || n > RANGE[key][1]) return null
  next[key] = n

  return next
}

export type Outcome = { at: number; cls: string; tier: string; par: number; attempt: number; ok: boolean; durationMs: number }

/** Settled, verified steps only: a verified done is a success, a failed step a failure, everything else is dropped. */
export function outcomesOf(steps: readonly StepRec[]): Outcome[] {
  return steps.flatMap(step => {
    const ok = step.status === 'done' && step.verified === true

    if (!ok && step.status !== 'failed') return []
    // A hand-over the mission refused never ran: it says nothing about the setting it was started under.
    if (step.status === 'failed' && step.why === REFUSED_WHY) return []

    return [{ at: step.endedAt ?? step.startedAt, cls: step.cls, tier: step.tier, par: step.par ?? 1, attempt: step.attempt, ok, durationMs: Math.max(0, (step.endedAt ?? step.startedAt) - step.startedAt) }]
  })
}

export type Proposal = { id: string; change: Change; direction: 'conservative' | 'aggressive'; reason: string }
export type Verdict = { verdict: 'supported' | 'insufficient' | 'rejected'; evidence: string }

const rate = (list: readonly Outcome[]): number => (list.length === 0 ? 0 : list.filter(o => !o.ok).length / list.length)
const pct = (n: number): string => `${Math.round(n * 100)}%`
const nextTier = (tier: string, step: 1 | -1): Tier | null => TIERS[(TIERS as readonly string[]).indexOf(tier) + step] ?? null

/** What the measured outcomes suggest, as proposals only. Nothing is applied here. */
export function propose(outcomes: readonly Outcome[], t: Tunables, env: Envelope, receipts: readonly Receipt[] = []): Proposal[] {
  const out: Proposal[] = []
  const classes = [...new Set(outcomes.map(o => o.cls))]

  for (const cls of classes) {
    const tier = tierOf(t, cls)
    const arm = outcomes.filter(o => o.cls === cls && o.tier === tier)

    if (arm.length < MIN_SAMPLES) continue

    const up = nextTier(tier, 1)
    const down = nextTier(tier, -1)

    if (rate(arm) >= FAIL_HIGH && up !== null) out.push({ id: `tier-${cls}-${up}`, change: { path: `tier.${cls}`, from: tier, to: up }, direction: 'conservative', reason: `${cls} steps fail ${pct(rate(arm))} at ${tier}` })
    else if (rate(arm) <= CLEAN && arm.length >= 2 * MIN_SAMPLES && down !== null) out.push({ id: `tier-${cls}-${down}`, change: { path: `tier.${cls}`, from: tier, to: down }, direction: 'aggressive', reason: `${cls} steps are clean at ${tier} (${arm.length} of them)` })
  }

  const here = outcomes.filter(o => o.par === t.parallelism)

  if (here.length >= MIN_SAMPLES && rate(here) >= FAIL_HIGH - 0.1 && t.parallelism > RANGE.parallelism[0]) out.push({ id: `par-${t.parallelism - 1}`, change: { path: 'parallelism', from: String(t.parallelism), to: String(t.parallelism - 1) }, direction: 'conservative', reason: `${pct(rate(here))} of steps fail at parallelism ${t.parallelism}` })
  else if (here.length >= 2 * MIN_SAMPLES && rate(here) <= CLEAN && t.parallelism < Math.min(RANGE.parallelism[1], env.concurrency)) out.push({ id: `par-${t.parallelism + 1}`, change: { path: 'parallelism', from: String(t.parallelism), to: String(t.parallelism + 1) }, direction: 'aggressive', reason: `steps are clean at parallelism ${t.parallelism} (${here.length} of them)` })

  const retried = outcomes.filter(o => o.attempt > 1)

  if (retried.length >= MIN_SAMPLES && 1 - rate(retried) >= 0.6 && t.retries < RANGE.retries[1]) out.push({ id: `retries-${t.retries + 1}`, change: { path: 'retries', from: String(t.retries), to: String(t.retries + 1) }, direction: 'conservative', reason: `${pct(1 - rate(retried))} of retried steps succeed` })

  // A setting a trial was reverted away from is not tried again: the old clean history that proposed it is the very history the trial contradicted.
  const reverted = new Set(receipts.filter(r => r.id.startsWith('revert-')).map(r => `${r.path}=${r.from}`))

  return out.filter(p => applyChange(t, p.change) !== null && !(p.direction === 'aggressive' && reverted.has(`${p.change.path}=${p.change.to}`)))
}

/** Replays the proposal over what the journal holds: does the evidence about the setting being left support leaving it? */
export function evaluate(p: Proposal, outcomes: readonly Outcome[], t: Tunables): Verdict {
  const key = p.change.path
  const arm = key.startsWith('tier.') ? outcomes.filter(o => o.cls === key.slice(5) && o.tier === p.change.from) : key === 'parallelism' ? outcomes.filter(o => o.par === Number(p.change.from)) : key === 'retries' ? outcomes.filter(o => o.attempt > 1) : []

  if (arm.length < MIN_SAMPLES) return { verdict: 'insufficient', evidence: `${arm.length} settled steps on the current setting, ${MIN_SAMPLES} needed` }

  const failing = rate(arm)

  if (p.direction === 'conservative') {
    const good = key === 'retries' ? 1 - failing >= 0.6 : failing >= FAIL_HIGH - 0.1

    return good ? { verdict: 'supported', evidence: `${arm.length} steps replayed: ${key === 'retries' ? `${pct(1 - failing)} of retries succeed` : `${pct(failing)} fail`}` } : { verdict: 'rejected', evidence: `${arm.length} steps replayed: not enough of a problem (${pct(failing)} fail)` }
  }

  return arm.length >= 2 * MIN_SAMPLES && failing <= CLEAN ? { verdict: 'supported', evidence: `${arm.length} steps replayed: ${pct(failing)} fail on the current setting; enters a trial and is reverted if the new setting does worse` } : { verdict: 'rejected', evidence: `${arm.length} steps replayed: ${pct(failing)} fail, not clean enough to try less caution` }
}

export type Promoted = { ok: true; tunables: Tunables; receipt: Receipt } | { ok: false; why: string }

export const GENESIS = 'genesis'
const receiptHash = (r: Omit<Receipt, 'hash'>): string => sha256(canonical(r))

/** The governed gate. Only a `supported` verdict passes; the result must stay inside the ranges and the envelope's concurrency; the receipt chains to `prev`. */
export function promote(p: Proposal, verdict: Verdict, t: Tunables, env: Envelope, prev: string, nowMs: number): Promoted {
  if (verdict.verdict !== 'supported') return { ok: false, why: `not promoted: ${verdict.verdict} (${verdict.evidence})` }

  const applied = applyChange(t, p.change)

  if (applied === null) return { ok: false, why: 'not promoted: that is not a tunable or the value is out of range' }

  const clamped = clampToEnvelope(applied, env)

  if (canonical(clamped) !== canonical(applied)) return { ok: false, why: 'not promoted: the result would sit outside the envelope or a range' }

  const body = { id: p.id, at: nowMs, path: p.change.path, from: p.change.from, to: p.change.to, direction: p.direction, evidence: verdict.evidence.slice(0, 300), prev }

  return { ok: true, tunables: clamped, receipt: { ...body, hash: receiptHash(body) } }
}

/** The receipts in order, each hashing its own body and naming the one before. A broken link is where the chain was edited. */
export function verifyReceipts(receipts: readonly Receipt[]): { ok: boolean; badAt: number | null } {
  let prev = GENESIS

  for (const [index, r] of receipts.entries()) {
    const { hash, ...body } = r

    if (r.prev !== prev || receiptHash(body) !== hash) return { ok: false, badAt: index }
    prev = hash
  }

  return { ok: true, badAt: null }
}

export const lastHash = (receipts: readonly Receipt[]): string => receipts.at(-1)?.hash ?? GENESIS

/** The tunables now: the defaults with each receipt applied in order, clamped to the envelope. A receipt that no longer applies is skipped (and is visible in the list). */
export function tunablesFrom(receipts: readonly Receipt[], env: Envelope, base: Tunables = DEFAULTS): Tunables {
  let t = clampToEnvelope(base, env)
  // Only the intact prefix of the chain counts: a forged or edited receipt (and everything after it) changes nothing, so a journal line cannot tune the loop.
  const chain = verifyReceipts(receipts)

  for (const r of chain.ok ? receipts : receipts.slice(0, chain.badAt ?? 0)) t = clampToEnvelope(applyChange(t, { path: r.path, from: r.from, to: r.to }) ?? t, env)

  return t
}

/** Reverses a receipt: the proposal that puts `from` back. A reversal is always conservative-by-construction (it restores what ran before). */
export const reversal = (r: Receipt): Proposal => ({ id: `revert-${r.id}`.slice(0, 60), change: { path: r.path, from: r.to, to: r.from }, direction: 'conservative', reason: `revert ${r.id}` })

/** Aggressive receipts still on trial that the outcomes since then say did worse: returns the reversals to apply. */
export function reviewTrials(receipts: readonly Receipt[], outcomes: readonly Outcome[]): Proposal[] {
  const out: Proposal[] = []

  for (const [index, r] of receipts.entries()) {
    if (r.direction !== 'aggressive' || receipts.slice(index + 1).some(later => later.path === r.path)) continue

    const since = outcomes.filter(o => o.at >= r.at && (r.path.startsWith('tier.') ? o.cls === r.path.slice(5) && o.tier === r.to : r.path === 'parallelism' ? o.par === Number(r.to) : false))

    if (since.length >= TRIAL_SAMPLES && rate(since) > CLEAN + 0.1) out.push(reversal(r))
  }

  return out
}
