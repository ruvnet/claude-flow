/**
 * The autopilot's adaptation gate and guards (ADR-466), split from ap-core.spec.ts for the 500-line limit. Pure and fast. Run with
 *   npx vitest run plugins/ruflo-console/tests/ap-adapt.spec.ts --testTimeout=30000
 */
import { describe, expect, it } from 'vitest'

import { applyChange, clampToEnvelope, DEFAULTS, evaluate, lastHash, outcomesOf, promote, propose, reviewTrials, tunablesFrom, verifyReceipts, type Tunables } from '../hooks/data/ap-adapt'
import { canonical, hashOf, HARD_DENIES, open, pathAllowed, seal, sha256, validateEnvelope, widened, type Envelope } from '../hooks/data/ap-envelope'
import { anatoleFact, classifyTask, effectOf, preflightAll } from '../hooks/data/ap-guard'
import { appendArgv, encodeLine, parseJournal, parseLine, type JournalEvent } from '../hooks/data/ap-journal'
import { bandText, emptyLoop, FAILURE_BUDGET, foldJournal, skipSet, snapshotEvents, stepId, summarize, tick, type Facts, type LoopState, type TaskFact } from '../hooks/data/ap-loop'

const T0 = Date.parse('2026-10-06T00:00:00.000Z')
const H = 3_600_000

const ENV: Envelope = { name: 'night shift', toolClasses: ['edit', 'read', 'test'], paths: ['/work/repo'], repos: ['ruvnet/ruflo'], network: [], secretEnv: [], spend: { hourUsd: 2, dayUsd: 10, totalUsd: 40 }, concurrency: 2, maxDurationMs: 7 * 24 * H, verify: [['true']], acceptWithoutAnatole: false }
const task = (id: string, over: Partial<TaskFact> = {}): TaskFact => ({ id, title: `do ${id}`, cls: 'edit', hardDeny: null, path: '/work/repo/src/a.ts', ...over })

const facts = (over: Partial<Facts> = {}): Facts => ({ nowMs: T0, killSeen: false, envelope: ENV, anatole: 'on', spend: { hourUsd: 0, dayUsd: 0, totalUsd: 0 }, task: task('t1'), effects: {}, orphans: new Set(), tunables: { parallelism: 1, retries: 1, stepTimeoutMs: 10 * 60_000, tierOf: () => 'mid' }, preflight: {}, ...over })

const started = (at = T0): JournalEvent => ({ t: 'start', at, envHash: hashOf(ENV), revision: 1, anatole: 'on' })
const running = (): LoopState => foldJournal([started()])

describe('adaptation', () => {
  const step = (over: Partial<Parameters<typeof outcomesOf>[0][number]>) => ({ id: 's', task: 't', cls: 'edit', attempt: 1, startedAt: 0, deadline: 1, status: 'done' as const, verified: true, tier: 'mid', par: 1, endedAt: 10, ...over })
  const many = (n: number, over: Partial<Parameters<typeof outcomesOf>[0][number]>) => Array.from({ length: n }, (_v, i) => step({ ...over, id: `s${i}`, startedAt: i }))

  it('counts only verified successes and failures; an unverified step teaches nothing', () => {
    expect(outcomesOf([step({}), step({ verified: false }), step({ status: 'failed', verified: undefined }), step({ status: 'started' })]).length).toBe(2)
  })

  it('proposes a higher tier for failing steps and promotes it with a chained receipt', () => {
    const outcomes = outcomesOf(many(8, { status: 'failed', verified: undefined }))
    const [p] = propose(outcomes, DEFAULTS, ENV)

    expect(p?.change).toEqual({ path: 'tier.edit', from: 'mid', to: 'high' })

    const verdict = evaluate(p!, outcomes, DEFAULTS)

    expect(verdict.verdict).toBe('supported')

    const first = promote(p!, verdict, DEFAULTS, ENV, lastHash([]), T0)

    expect(first.ok).toBe(true)

    const t = first.ok ? first.tunables : DEFAULTS

    expect(t.tiers.edit).toBe('high')
    expect(tunablesFrom(first.ok ? [first.receipt] : [], ENV).tiers.edit).toBe('high')
    expect(verifyReceipts(first.ok ? [first.receipt] : []).ok).toBe(true)
  })

  it('refuses to promote without evidence, and a tampered receipt breaks the chain', () => {
    const few = outcomesOf(many(3, { status: 'failed', verified: undefined }))
    const p = { id: 'x', change: { path: 'tier.edit', from: 'mid', to: 'high' }, direction: 'conservative' as const, reason: '' }

    expect(promote(p, evaluate(p, few, DEFAULTS), DEFAULTS, ENV, 'genesis', T0).ok).toBe(false)

    const good = outcomesOf(many(8, { status: 'failed', verified: undefined }))
    const a = promote(p, evaluate(p, good, DEFAULTS), DEFAULTS, ENV, 'genesis', T0)

    if (!a.ok) throw new Error('setup')

    expect(verifyReceipts([{ ...a.receipt, to: 'low' }]).ok).toBe(false)
    expect(verifyReceipts([a.receipt, { ...a.receipt, prev: 'genesis' }]).ok).toBe(false)
  })

  it('aggressive changes need clean history and are reverted if the trial does worse', () => {
    const clean = outcomesOf(many(14, { tier: 'mid' }))
    const [p] = propose(clean, DEFAULTS, ENV)

    expect(p).toMatchObject({ direction: 'aggressive', change: { path: 'tier.edit', to: 'low' } })

    const ok = promote(p!, evaluate(p!, clean, DEFAULTS), DEFAULTS, ENV, 'genesis', 100)

    if (!ok.ok) throw new Error('setup')

    const worse = outcomesOf(many(8, { tier: 'low', status: 'failed', verified: undefined, startedAt: 200, endedAt: 210 }))

    expect(reviewTrials([ok.receipt], worse).map(r => r.change)).toEqual([{ path: 'tier.edit', from: 'low', to: 'mid' }])
    expect(reviewTrials([ok.receipt], outcomesOf(many(8, { tier: 'low', startedAt: 200, endedAt: 210 }))).length).toBe(0)
  })

  it('no sequence of proposals, valid or hostile, can take a tunable past the envelope or change the envelope', () => {
    const env = Object.freeze({ ...ENV, concurrency: 2 }) as Envelope
    const before = canonical(env)
    let t: Tunables = DEFAULTS

    for (const [path, to] of [['parallelism', '9'], ['parallelism', '2'], ['parallelism', '3'], ['parallelism', '-1'], ['retries', '99'], ['stepSize', '6'], ['ordering', 'chaos'], ['tier.edit', 'ultra'], ['__proto__.x', '1'], ['concurrency', '8'], ['tier.edit', 'low'], ['tier.A;B', 'low']] as const) {
      const applied = applyChange(t, { path, from: '', to })

      if (applied !== null) t = clampToEnvelope(applied, env)

      expect(t.parallelism).toBeLessThanOrEqual(env.concurrency)
      expect(t.retries).toBeLessThanOrEqual(3)
      expect(t.stepSize).toBeLessThanOrEqual(5)
    }

    const huge = promote({ id: 'p', change: { path: 'parallelism', from: '1', to: '3' }, direction: 'conservative', reason: '' }, { verdict: 'supported', evidence: 'forced' }, DEFAULTS, env, 'genesis', T0)

    expect(huge.ok).toBe(false)
    expect(canonical(env)).toBe(before)
    expect(clampToEnvelope({ ...DEFAULTS, parallelism: 8 }, env).parallelism).toBe(2)
  })
})

describe('guards', () => {
  it('classifies by the most privileged class the words suggest, and never defaults', () => {
    expect(classifyTask('a', 'Review the auth module').cls).toBe('read')
    expect(classifyTask('a', 'Fix the parser and run the tests').cls).toBe('edit')
    expect(classifyTask('a', 'Create a worktree and merge').cls).toBe('git-branch')
    expect(classifyTask('a', 'Completion: Learn: store the outcome').cls).toBeNull()
    expect(classifyTask('a', 'Edit /work/repo/src/x.ts').path).toBe('/work/repo/src/x.ts')
  })

  it('flags every hard deny family in a task', () => {
    const deny = (text: string): string | null => classifyTask('a', text).hardDeny

    expect(deny('npm publish the package')).toBe('publish')
    expect(deny('cut a release and tag')).toBe('release')
    expect(deny('deploy to production')).toBe('deploy')
    expect(deny('git push --force origin main')).toBe('force-push')
    expect(deny('read the API key from gcloud secrets')).toBe('secret-access')
    expect(deny('rm -rf / to clean up')).toBe('delete-outside-worktree')
    expect(deny('widen the envelope to allow network')).toBe('envelope-edit')
    expect(deny('refactor the parser')).toBeNull()
  })

  it('reads the Anatole gate from what the mod reported', () => {
    expect(anatoleFact(undefined)).toBe('absent')
    expect(anatoleFact({ present: false, status: null, modeOverride: null, overrides: {}, alerts: [], refused: [], badAlerts: 0 })).toBe('absent')
    expect(anatoleFact({ present: true, status: { mode: 'off' } as never, modeOverride: null, overrides: {}, alerts: [], refused: [], badAlerts: 0 })).toBe('off')
    expect(anatoleFact({ present: true, status: { mode: 'notify' } as never, modeOverride: null, overrides: {}, alerts: [], refused: [], badAlerts: 0 })).toBe('on')
  })

  it('preflight: absent check is unwired, a deny is deny, a throw is unwired', async () => {
    expect((await preflightAll(undefined)).edit).toBe('unwired')
    expect((await preflightAll(async tool => (tool === 'Edit' ? { decision: 'deny' } : 'allow'))).edit).toBe('deny')
    expect((await preflightAll(async () => 'allow')).read).toBe('allow')
    expect((await preflightAll(async () => Promise.reject(new Error('x')))).read).toBe('unwired')
  })

  it('an effect needs the store AND the verify commands; a store status alone is a claim', () => {
    expect(effectOf('completed', { ran: 0, failed: 0 })).toBe('done-unverified')
    expect(effectOf('completed', { ran: 2, failed: 0 })).toBe('done')
    expect(effectOf('completed', { ran: 2, failed: 1 })).toBe('failed')
    expect(effectOf('in_progress', { ran: 0, failed: 0 })).toBe('unknown')
    expect(effectOf('failed', { ran: 0, failed: 0 })).toBe('failed')
  })
})
