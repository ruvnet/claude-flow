/**
 * The adversarial review of the mission autopilot (ADR-466): each test is a defect the review found, written to fail on the code as it
 * was merged. Pure rules first, then the live loop on the shared in-memory rig (fixtures/ap-rig.ts). Run with
 *   npx vitest run plugins/ruflo-console/tests/ap-review.spec.ts --testTimeout=30000
 */
import { describe, expect, it } from 'vitest'

import { rotate } from '../hooks/ap-maint'
import { apTick, refreshAutopilot, storeOf, stopNow, wireAutopilot } from '../hooks/ap-live'
import { outcomesOf, propose, reversal, type Tunables, DEFAULTS } from '../hooks/data/ap-adapt'
import { hashOf, type Envelope } from '../hooks/data/ap-envelope'
import { classifyTask } from '../hooks/data/ap-guard'
import { encodeLine, REFUSED_WHY, type JournalEvent } from '../hooks/data/ap-journal'
import { foldJournal, tick, whyParked, type Facts, type TaskFact } from '../hooks/data/ap-loop'
import { boardRows, defaultDraft, draftOf, startSpec } from '../hooks/views/ap-panel'
import { CWD, ENV, J, T0, envOf, flat, journal, rig, started, stateWith, task, words } from './fixtures/ap-rig'

const H = 3_600_000
const PURE: Envelope = { ...ENV, paths: ['/work/repo'], network: ['github.com'], repos: ['ruvnet/ruflo'], toolClasses: ['edit', 'read', 'test', 'network'], concurrency: 2 }
const fact = (id: string, over: Partial<TaskFact> = {}): TaskFact => ({ id, title: `do ${id}`, cls: 'edit', hardDeny: null, path: '/work/repo/a.ts', ...over })
const facts = (over: Partial<Facts> = {}): Facts => ({ nowMs: T0, killSeen: false, envelope: PURE, anatole: 'on', spend: { hourUsd: 0, dayUsd: 0, totalUsd: 0 }, task: fact('t1'), effects: {}, orphans: new Set(), tunables: { parallelism: 1, retries: 1, stepTimeoutMs: 600_000, tierOf: () => 'mid' }, preflight: {}, ...over })
const start = (env: Envelope = PURE): JournalEvent => ({ t: 'start', at: T0, envHash: hashOf(env), revision: 1, anatole: 'on' })

describe('what the envelope really checks', () => {
  it('reads every path, URL host and GitHub repository a task names, not only the first path', () => {
    const t = classifyTask('t1', 'Fix /work/repo/a.ts and copy it to /etc/cron.d/x', 'see https://evil.example.com/x and https://github.com/someone/else.git')

    expect(t.path).toBe('/work/repo/a.ts')
    expect(t.paths).toEqual(['/work/repo/a.ts', '/etc/cron.d/x'])
    expect(t.hosts).toEqual(['evil.example.com', 'github.com'])
    expect(t.repos).toEqual(['someone/else'])
  })

  it('parks a task whose second path, host or repo is outside the envelope, and passes one that is inside', () => {
    expect(whyParked(fact('a', { paths: ['/etc/passwd'] }), PURE, {})).toContain('/etc/passwd')
    expect(whyParked(fact('b', { cls: 'network', hosts: ['evil.example.com'] }), PURE, {})).toContain('network list')
    expect(whyParked(fact('c', { cls: 'network', hosts: ['github.com'], repos: ['someone/else'] }), PURE, {})).toContain('repo list')
    expect(whyParked(fact('d', { cls: 'network', paths: ['/work/repo/b.ts'], hosts: ['github.com'], repos: ['ruvnet/ruflo'] }), PURE, {})).toBeNull()
  })
})

describe('a permission deny is not the console to lift', () => {
  it('ignores an approve-once for a class the settings deny, and still lets one lift a class the settings only ask about', () => {
    const base = foldJournal([start(), { t: 'parked', at: T0 + 1, id: 'p-x', task: 't1', question: 'q' }, { t: 'answered', at: T0 + 2, id: 'p-x', answer: 'once' }])
    const asked = tick(base, facts({ nowMs: T0 + 5, preflight: { edit: 'ask' } }))
    const denied = tick(base, facts({ nowMs: T0 + 5, preflight: { edit: 'deny' } }))

    expect(asked.act).not.toBeNull()
    expect(denied.act).toBeNull()
    expect(denied.events.find(e => e.t === 'parked')).toMatchObject({ question: expect.stringContaining('can never do') })
  })
})

describe('clocks and sleep', () => {
  it('a clock set back after a failure does not hold the loop for the size of the jump', () => {
    const s = foldJournal([start(), { t: 'step.started', at: T0, id: 's-1', task: 'old', cls: 'edit', attempt: 1, deadline: T0 + 1, tier: 'mid' }, { t: 'step.failed', at: T0 + 10 * H, id: 's-1', why: 'x' }])
    const back = tick(s, facts({ nowMs: T0 + 2 * H, task: fact('t2') }))

    expect(back.act?.task.id).toBe('t2')
  })

  it('forgives a step the time the machine slept before it counts as timed out', () => {
    const s = foldJournal([start(), { t: 'step.started', at: T0, id: 's-1', task: 't1', cls: 'edit', attempt: 1, deadline: T0 + 1000, tier: 'mid' }])

    expect(tick(s, facts({ nowMs: T0 + 5000 })).events.some(e => e.t === 'step.failed')).toBe(true)
    expect(tick(s, facts({ nowMs: T0 + 5000, slack: { 's-1': 8 * H } })).events.some(e => e.t === 'step.failed')).toBe(false)
  })

  it('apTick credits a long gap between passes to the steps in flight', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending')])

    started(r, [{ t: 'step.started', at: T0 + 10, id: 's-sleeper0000001', task: 't1', cls: 'edit', attempt: 1, deadline: T0 + 100_000, tier: 'mid' }])
    wireAutopilot(state, r.host)
    storeOf(state).bootMs = T0 - 1
    storeOf(state).spend = { hourUsd: 0, dayUsd: 0, totalUsd: 0 }
    storeOf(state).spendAtMs = T0 + 1
    await apTick(state, r.host, T0 + 50_000)
    await apTick(state, r.host, T0 + 8 * H)

    expect(storeOf(state).slack['s-sleeper0000001']).toBe(8 * H - 50_000)
    expect(journal(r).some(e => e.t === 'step.failed')).toBe(false)
  })
})

describe('stop is never undone', () => {
  it('a stop pressed while a pass gathers its facts wins: no step starts after it', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'completed'), task('r2', 'completed'), task('r3', 'pending')])

    started(r, [{ t: 'step.started', at: T0 + 10, id: 's-verifyme0000009', task: 't1', cls: 'edit', attempt: 1, deadline: T0 + 1e9, tier: 'mid' }])

    const run = r.host.run

    r.host.run = (async (argv: readonly string[], timeout: number, stdin?: string) => {
      if (argv[0] === 'true') await stopNow(state, r.host, 'pressed during verify')

      return run(argv, timeout, stdin)
    }) as typeof r.host.run
    wireAutopilot(state, r.host)
    storeOf(state).bootMs = T0 - 1
    storeOf(state).spend = { hourUsd: 0, dayUsd: 0, totalUsd: 0 }
    storeOf(state).spendAtMs = T0 + 1000
    await apTick(state, r.host, T0 + 1000)

    expect(r.prompts).toEqual([])
    expect(journal(r).filter(e => e.t === 'step.started').length).toBe(1)
  })

  it('a stop that reaches neither the journal nor the flag is held and said, and a re-read does not resume the loop', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending'), task('r2', 'pending'), task('r3', 'pending')])

    started(r)
    wireAutopilot(state, r.host)
    await refreshAutopilot(state, r.host, T0)

    const run = r.host.run

    r.host.run = (async () => ({ exitCode: 1, stdout: '', stderr: 'no space left on device' })) as unknown as typeof r.host.run
    await stopNow(state, r.host, 'disk is full')
    expect(r.toasts.join()).toContain('this session only')

    r.host.run = run
    storeOf(state).spend = { hourUsd: 0, dayUsd: 0, totalUsd: 0 }
    storeOf(state).spendAtMs = T0 + 1000
    await apTick(state, r.host, T0 + 1000)

    expect(r.prompts).toEqual([])
    expect(storeOf(state).loop.phase).toBe('stopped')
    // Once the disk answers again the held stop is written, so a new process sees it too.
    expect(journal(r).at(-1)).toMatchObject({ t: 'stop', reason: 'disk is full' })
  })

  it('no verify command is run for a class the person\'s settings deny', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'completed'), task('r2', 'pending'), task('r3', 'pending')])

    started(r, [{ t: 'step.started', at: T0 + 10, id: 's-verifyme0000008', task: 't1', cls: 'edit', attempt: 1, deadline: T0 + 1e9, tier: 'mid' }])
    wireAutopilot(state, r.host, { toolCheck: async () => 'deny' })
    storeOf(state).spend = { hourUsd: 0, dayUsd: 0, totalUsd: 0 }
    storeOf(state).spendAtMs = T0 + 1000
    await apTick(state, r.host, T0 + 1000)

    expect(r.runs.some(a => a[0] === 'true')).toBe(false)
    expect(journal(r).some(e => e.t === 'step.done' && e.id === 's-verifyme0000008')).toBe(false)
    expect(journal(r).some(e => e.t === 'step.failed' && e.id === 's-verifyme0000008')).toBe(true)
  })
})

describe('the journal over a long run', () => {
  it('rotates a journal past 80% of its cap into an archive and a snapshot that folds to the same state', async () => {
    const r = rig()
    const state = stateWith([])

    started(r, [])
    r.files.set(J, `${r.files.get(J) as string}${encodeLine({ t: 'beat', at: T0 + 1 }).repeat(42_000)}`)
    wireAutopilot(state, r.host)
    storeOf(state).spend = { hourUsd: 0, dayUsd: 0, totalUsd: 0 }
    storeOf(state).spendAtMs = T0 + 1000
    await apTick(state, r.host, T0 + 2000)

    const names = [...r.files.keys()].filter(name => name.startsWith(`${J}.`))

    expect(names.length).toBe(1)
    expect((r.files.get(J) as string).length).toBeLessThan(2_000)
    await refreshAutopilot(state, r.host, T0 + 3000)
    expect(storeOf(state).loop.phase).toBe('running')
    expect(storeOf(state).loop.startedAtMs).toBe(T0)
  })
})

describe('rotation waits for the write chain', () => {
  it('a write still in flight lands before the snapshot is taken: nothing is archived or replaced until the chain is free', async () => {
    const r = rig()
    const state = stateWith([])

    started(r, [])
    wireAutopilot(state, r.host)
    await refreshAutopilot(state, r.host, T0 + 1000)

    const store = storeOf(state)
    let release: () => void = () => undefined

    store.chain = new Promise<void>(resolve => { release = resolve })

    const before = r.files.get(J)
    const done = rotate(store, r.host, CWD, T0 + 5000)

    await new Promise(resolve => setTimeout(resolve, 20))
    expect([...r.files.keys()].some(name => name.startsWith(`${J}.`))).toBe(false)
    expect(r.files.get(J)).toBe(before)
    release()
    await done
    expect([...r.files.keys()].some(name => name.startsWith(`${J}.`))).toBe(true)
  })
})

describe('what adaptation learns', () => {
  const step = (over: Record<string, unknown>) => ({ id: 's', task: 't', cls: 'edit', attempt: 1, startedAt: 0, deadline: 1, status: 'failed' as const, tier: 'mid', par: 1, endedAt: 10, ...over })

  it('a hand-over the mission refused is a step that never ran and teaches nothing', () => {
    expect(outcomesOf([step({ why: REFUSED_WHY }), step({ why: 'timed out' })]).length).toBe(1)
  })

  it('does not propose again a setting a trial was reverted away from', () => {
    const outcomes = Array.from({ length: 14 }, (_, i) => ({ at: i, cls: 'edit', tier: 'mid', par: 1, attempt: 1, ok: true, durationMs: 1 }))
    const t: Tunables = { ...DEFAULTS }
    const before = propose(outcomes, t, PURE)

    expect(before.some(p => p.change.path === 'tier.edit' && p.change.to === 'low')).toBe(true)

    const trial = { id: 'tier-edit-low', at: 1, path: 'tier.edit', from: 'mid', to: 'low', direction: 'aggressive' as const, evidence: 'e', prev: 'genesis', hash: 'a'.repeat(64) }
    const revert = { ...reversal(trial), at: 2, path: 'tier.edit', from: 'low', to: 'mid', direction: 'conservative' as const, evidence: 'e', prev: 'a'.repeat(64), hash: 'b'.repeat(64) }

    expect(propose(outcomes, t, PURE, [trial, revert]).some(p => p.change.path === 'tier.edit' && p.change.to === 'low')).toBe(false)
  })
})

describe('the panel', () => {
  it('the Stop button carries no hotkey (the digits are view keys), so no key can open another page instead of stopping', () => {
    const r = rig()
    const state = stateWith([])

    wireAutopilot(state, r.host)

    const hotkeys = flat(boardRows(envOf(state, T0))).filter(el => el.kind === 'Button' && el.props.hotkey !== undefined).map(el => el.props.hotkey)

    expect(hotkeys).not.toContain('9')
  })

  it('wraps its button rows so none is pushed off an 80 column page', () => {
    const r = rig()
    const state = stateWith([])

    wireAutopilot(state, r.host)

    const wrapped = flat(boardRows(envOf(state, T0))).filter(el => el.kind === 'Box' && el.props.flexWrap === 'wrap')

    expect(wrapped.length).toBeGreaterThanOrEqual(3)
  })

  it('shows the confirm card the exact verify commands this console will run after every step', () => {
    const r = rig()
    const state = stateWith([])

    wireAutopilot(state, r.host)
    draftOf(state).value = { ...defaultDraft(CWD), verify: [['npm', 'test'], ['cargo', 'test', '--workspace']] }

    const spec = startSpec(envOf(state, T0))

    expect(spec?.shows).toContain('npm test')
    expect(spec?.shows).toContain('cargo test --workspace')
    expect(spec?.shows).toContain('run by this console')
  })

  it('says plainly that network, repos and secret names are checked against what a task says, not sandboxed', async () => {
    const r = rig()
    const state = stateWith([])

    started(r)
    wireAutopilot(state, r.host)
    await refreshAutopilot(state, r.host, T0)

    const text = words(boardRows(envOf(state, T0)))

    expect(text).toContain('is not a sandbox')
    expect(text).toContain('Secret names are a record only')
  })
})
