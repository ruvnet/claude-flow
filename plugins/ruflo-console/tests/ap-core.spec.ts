/**
 * The autopilot's pure core (ADR-466): envelope validation and sealing, the journal, the step machine (including the kill-switch and
 * crash-resume properties, run over a seeded random walk), the adaptation gate and the guards. Pure and fast. Run with
 *   npx vitest run plugins/ruflo-console/tests/ap-core.spec.ts --testTimeout=30000
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

describe('sha256', () => {
  it('matches the published vectors', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3')
  })
})

describe('envelope', () => {
  it('accepts a good envelope and canonicalises it', () => {
    const ok = validateEnvelope({ ...ENV, toolClasses: ['test', 'read', 'edit', 'read'] })

    expect(ok.ok).toBe(true)
    expect(ok.ok && ok.envelope.toolClasses).toEqual(['edit', 'read', 'test'])
    expect(canonical({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}')
  })

  it('rejects every hard deny named as a class, never trims it', () => {
    for (const deny of HARD_DENIES) {
      const bad = validateEnvelope({ ...ENV, toolClasses: ['edit', deny] })

      expect(bad.ok).toBe(false)
      expect(!bad.ok && bad.errors.join(' ')).toContain('hard deny')
    }
  })

  it('rejects unknown fields, bad paths, secrets as values, bad spend and duration', () => {
    const errs = (patch: Record<string, unknown>): string => {
      const r = validateEnvelope({ ...ENV, ...patch })

      return r.ok ? '' : r.errors.join('|')
    }

    expect(errs({ grants: ['publish'] })).toContain('unknown field')
    expect(errs({ paths: ['/work/../etc'] })).toContain('paths')
    expect(errs({ paths: ['/'] })).toContain('paths')
    expect(errs({ paths: ['relative'] })).toContain('paths')
    expect(errs({ secretEnv: ['sk-live-abc123'] })).toContain('secretEnv')
    expect(errs({ spend: { hourUsd: 5, dayUsd: 2, totalUsd: 40 } })).toContain('hour must not exceed day')
    expect(errs({ spend: { hourUsd: 0, dayUsd: 2, totalUsd: 40 } })).toContain('spend')
    expect(errs({ maxDurationMs: 365 * 86_400_000 })).toContain('maxDurationMs')
    expect(errs({ concurrency: 99 })).toContain('concurrency')
    expect(errs({ network: ['*.evil.com'] })).toContain('network')
    expect(errs({ verify: ['rm -rf /'] })).toContain('verify')
    expect(errs({ repos: ['not a repo'] })).toContain('repos')
  })

  it('seals with a hash and opens only an untouched file', () => {
    const sealed = seal(ENV, 3, T0)
    const text = JSON.stringify(sealed)

    expect(open(text).ok).toBe(true)

    const edited = JSON.stringify({ ...sealed, envelope: { ...ENV, spend: { ...ENV.spend, totalUsd: 4000 } } })
    const result = open(edited)

    expect(result.ok).toBe(false)
    expect(!result.ok && result.why).toContain('does not match its hash')
    expect(open(null).ok).toBe(false)
    expect(open('{nope').ok).toBe(false)
  })

  it('says what widened and treats a pure narrowing as nothing', () => {
    expect(widened(ENV, { ...ENV, toolClasses: ['read'] })).toEqual([])
    expect(widened(ENV, { ...ENV, toolClasses: [...ENV.toolClasses, 'network'], concurrency: 4, acceptWithoutAnatole: true }).length).toBe(3)
    expect(widened(ENV, { ...ENV, spend: { ...ENV.spend, totalUsd: 80 } })[0]).toContain('totalUsd')
  })

  it('compares paths at a folder boundary and refuses ..', () => {
    expect(pathAllowed(ENV, '/work/repo')).toBe(true)
    expect(pathAllowed(ENV, '/work/repo/src/x.ts')).toBe(true)
    expect(pathAllowed(ENV, '/work/repository')).toBe(false)
    expect(pathAllowed(ENV, '/work/repo/../etc')).toBe(false)
  })
})

describe('journal', () => {
  it('round-trips events and drops what does not validate', () => {
    const events: JournalEvent[] = [started(), { t: 'step.started', at: T0 + 1, id: 's-1', task: 't1', cls: 'edit', attempt: 1, deadline: T0 + 99, tier: 'mid', par: 1 }, { t: 'step.done', at: T0 + 2, id: 's-1', verified: true }, { t: 'beat', at: T0 + 3 }]
    const text = events.map(encodeLine).join('')
    const parsed = parseJournal(`${text}{"t":"step.done","at":1\n{"t":"nope","at":1}\n[1]\n`)

    expect(parsed.events).toEqual(events)
    expect(parsed.bad).toBe(3)
  })

  it('washes escapes, control and tag characters and credentials before a line is written', () => {
    const line = encodeLine({ t: 'stop', at: T0, reason: `\u001b[31mred\u001b[0m‮evil\u{e0041} sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789` })

    expect(line).not.toMatch(/\u001b|‮|[\u{e0000}-\u{e0fff}]u/u)
    expect(line).not.toContain('sk-ant-api03-abcdef')
    expect(line.endsWith('\n')).toBe(true)
    expect(parseLine(line.trim())?.t).toBe('stop')
  })

  it('appends with a fixed argv, the path as one element', () => {
    expect(appendArgv('/p/j; rm -rf /.jsonl', 'gnu')).toEqual(['dd', 'of=/p/j; rm -rf /.jsonl', 'oflag=append', 'conv=notrunc', 'bs=1M', 'iflag=fullblock', 'status=none'])
  })

  it.skipIf(process.platform !== 'linux')('with the real GNU dd, eight writers of whole journal batches never tear a line (ADR-466)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ap-dd-'))

    try {
      const batch = (c: string): string => Array.from({ length: 60 }, (_, i) => `{"w":"${c}","n":${i},"pad":"${c.repeat(900)}"}\n`).join('')
      const file = join(dir, 'journal.jsonl')
      const argv = (appendArgv(file, 'gnu') as string[]).map(arg => `'${arg}'`).join(' ')
      const script = Array.from({ length: 8 }, (_, w) => {
        const src = join(dir, `b${w}.txt`)

        writeFileSync(src, batch(w % 2 === 0 ? 'A' : 'B'))

        return `( for k in 1 2 3 4 5; do cat '${src}' | ${argv}; done ) &`
      }).join('\n')

      expect(spawnSync('bash', ['-c', `${script}\nwait`]).status).toBe(0)

      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)

      expect(lines).toHaveLength(8 * 5 * 60)
      expect(lines.filter(line => !/^\{"w":"(A+|B+)","n":\d+,"pad":"(A+|B+)"\}$/.test(line) || line.length < 900)).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('loop: ordering of the safety checks', () => {
  it('does nothing before a start, and nothing after a stop without a new start', () => {
    expect(tick(emptyLoop(), facts()).act).toBeNull()

    const stopped = foldJournal([started(), { t: 'stop', at: T0 + 1, reason: 'x' }])

    expect(tick(stopped, facts()).act).toBeNull()
    expect(tick(foldJournal([started(), { t: 'stop', at: T0 + 1, reason: 'x' }, started(T0 + 5)]), facts()).act).not.toBeNull()
  })

  it('starts one step with a deterministic id and a deadline', () => {
    const d = tick(running(), facts())

    expect(d.act?.id).toBe(stepId('t1', 1))
    expect(d.act?.deadline).toBe(T0 + 10 * 60_000)
    expect(d.events[0]?.t).toBe('step.started')
  })

  it('the kill flag stops before anything else, even with a step in flight', () => {
    const s = foldJournal([started(), { t: 'step.started', at: T0, id: 's-a', task: 't0', cls: 'edit', attempt: 1, deadline: T0 + H, tier: 'mid' }])
    const d = tick(s, facts({ killSeen: true, effects: { 's-a': 'done' } }))

    expect(d.act).toBeNull()
    expect(d.events.map(e => e.t)).toEqual(['stop'])
  })

  it('stops on a missing or tampered envelope and when the duration passes', () => {
    expect(tick(running(), facts({ envelope: null })).events[0]).toMatchObject({ t: 'stop' })
    expect(tick(running(), facts({ nowMs: T0 + 8 * 24 * H })).events[0]).toMatchObject({ t: 'stop' })
  })

  it('refuses to run without Anatole unless that was accepted in the envelope', () => {
    expect(tick(running(), facts({ anatole: 'off' })).events[0]).toMatchObject({ t: 'pause', reason: 'Project Anatole is off' })
    expect(tick(running(), facts({ anatole: 'absent' })).events[0]).toMatchObject({ t: 'pause' })
    expect(tick(running(), facts({ anatole: 'absent', envelope: { ...ENV, acceptWithoutAnatole: true } })).act).not.toBeNull()
  })

  it('spend ladder: unread waits, 80% of total pauses, 100% stops, hour and day ceilings hold back', () => {
    expect(tick(running(), facts({ spend: null })).status).toContain('spend not read')
    expect(tick(running(), facts({ spend: null })).act).toBeNull()
    expect(tick(running(), facts({ spend: { hourUsd: 0, dayUsd: 0, totalUsd: 31.9 } })).act).not.toBeNull()
    expect(tick(running(), facts({ spend: { hourUsd: 0, dayUsd: 0, totalUsd: 32 } })).events[0]).toMatchObject({ t: 'pause' })
    expect(tick(running(), facts({ spend: { hourUsd: 0, dayUsd: 0, totalUsd: 40 } })).events[0]).toMatchObject({ t: 'stop' })
    expect(tick(running(), facts({ spend: { hourUsd: 2, dayUsd: 3, totalUsd: 5 } })).status).toContain('hour spend')
    expect(tick(running(), facts({ spend: { hourUsd: 0, dayUsd: 10, totalUsd: 20 } })).status).toContain('day spend')
  })

  it('an 80% pause never cuts a step in flight: it is still settled, not failed', () => {
    const s = foldJournal([started(), { t: 'step.started', at: T0, id: 's-a', task: 't0', cls: 'edit', attempt: 1, deadline: T0 + H, tier: 'mid' }])
    const d = tick(s, facts({ nowMs: T0 + 60_000, spend: { hourUsd: 0, dayUsd: 0, totalUsd: 33 }, effects: { 's-a': 'done' } }))

    expect(d.events.map(e => e.t)).toEqual(['step.done', 'pause'])
  })

  it('settles in-flight steps: done, failed report, timeout, and lost-on-restart only for orphans', () => {
    const s = foldJournal([started(), { t: 'step.started', at: T0, id: 's-a', task: 't0', cls: 'edit', attempt: 1, deadline: T0 + 1000, tier: 'mid' }])

    expect(tick(s, facts({ nowMs: T0 + 10, effects: { 's-a': 'done-unverified' } })).events[0]).toMatchObject({ t: 'step.done', verified: false })
    expect(tick(s, facts({ nowMs: T0 + 10, effects: { 's-a': 'failed' } })).events[0]).toMatchObject({ t: 'step.failed' })
    expect(tick(s, facts({ nowMs: T0 + 2000 })).events[0]).toMatchObject({ t: 'step.failed', why: 'timed out' })
    expect(tick(s, facts({ nowMs: T0 + 10, effects: { 's-a': 'absent' } })).events.length).toBe(0)
    expect(tick(s, facts({ nowMs: T0 + 10, effects: { 's-a': 'absent' }, orphans: new Set(['s-a']) })).events[0]).toMatchObject({ t: 'step.failed' })
  })

  it('waits at the concurrency cap and never starts a task twice', () => {
    const s = foldJournal([started(), { t: 'step.started', at: T0, id: 's-a', task: 't0', cls: 'edit', attempt: 1, deadline: T0 + H, tier: 'mid' }])

    expect(tick(s, facts({ nowMs: T0 + 5 })).act).toBeNull()
    expect(tick(s, facts({ nowMs: T0 + 5, tunables: { parallelism: 2, retries: 1, stepTimeoutMs: 1000, tierOf: () => 'mid' } })).act?.task.id).toBe('t1')
    expect(tick(s, facts({ nowMs: T0 + 5, task: task('t0'), tunables: { parallelism: 2, retries: 1, stepTimeoutMs: 1000, tierOf: () => 'mid' } })).act).toBeNull()
  })

  it('failure ladder: backoff after one, pause at the budget, resume clears it', () => {
    const fail = (n: number): JournalEvent[] => Array.from({ length: n }, (_v, i) => [{ t: 'step.started', at: T0 + i * 10, id: `s-${i}`, task: `f${i}`, cls: 'edit', attempt: 1, deadline: T0 + 1e9, tier: 'mid' }, { t: 'step.failed', at: T0 + i * 10 + 1, id: `s-${i}`, why: 'x' }] as JournalEvent[]).flat()
    const one = foldJournal([started(), ...fail(1)])

    expect(tick(one, facts({ nowMs: T0 + 5000 })).status).toContain('backing off')
    expect(tick(one, facts({ nowMs: T0 + 5000 + 61_000 })).act).not.toBeNull()

    const many = foldJournal([started(), ...fail(FAILURE_BUDGET)])

    expect(tick(many, facts({ nowMs: T0 + 1e7 })).events[0]).toMatchObject({ t: 'pause' })
    expect(foldJournal([started(), ...fail(FAILURE_BUDGET), { t: 'pause', at: T0 + 9e3, reason: 'r' }, { t: 'resume', at: T0 + 9e3 + 1 }]).failures).toBe(0)
  })

  it('parks what is outside the envelope or ambiguous, with a question, and does not repeat the park', () => {
    for (const t of [task('h', { hardDeny: 'publish' }), task('c', { cls: null }), task('n', { cls: 'network' }), task('p', { path: '/etc/passwd' })]) {
      const d = tick(running(), facts({ task: t }))

      expect(d.act).toBeNull()
      expect(d.events[0]).toMatchObject({ t: 'parked', task: t.id })

      const after = foldJournal([started(), ...d.events])

      expect(tick(after, facts({ task: t })).events).toEqual([])
      expect(skipSet(after).has(t.id)).toBe(true)
    }
  })

  it('parks when the permission preflight would deny or ask, and proceeds when it is not wired', () => {
    expect(tick(running(), facts({ preflight: { edit: 'deny' } })).events[0]).toMatchObject({ t: 'parked' })
    expect(tick(running(), facts({ preflight: { edit: 'ask' } })).events[0]).toMatchObject({ t: 'parked' })
    expect(tick(running(), facts({ preflight: { edit: 'unwired' } })).act).not.toBeNull()
  })

  it('approve-once lets exactly one step run; a hard deny can never be approved; deny is final', () => {
    const t = task('n', { cls: 'network' })
    const parked = tick(running(), facts({ task: t })).events

    const once = foldJournal([started(), ...parked, { t: 'answered', at: T0 + 1, id: (parked[0] as { id: string }).id, answer: 'once' }])
    const go = tick(once, facts({ task: t, nowMs: T0 + 2 }))

    expect(go.act?.task.id).toBe('n')

    const ran = foldJournal([started(), ...parked, { t: 'answered', at: T0 + 1, id: (parked[0] as { id: string }).id, answer: 'once' }, ...go.events, { t: 'step.failed', at: T0 + 3, id: go.act?.id ?? '', why: 'x' }])

    expect(ran.parked[0]?.isUsed).toBe(true)
    expect(tick(ran, facts({ task: t, nowMs: T0 + 3_600_000 })).act).toBeNull()

    const hard = task('h', { hardDeny: 'deploy' })
    const hp = tick(running(), facts({ task: hard })).events
    const approved = foldJournal([started(), ...hp, { t: 'answered', at: T0 + 1, id: (hp[0] as { id: string }).id, answer: 'once' }])

    expect(tick(approved, facts({ task: hard, nowMs: T0 + 2 })).act).toBeNull()

    const denied = foldJournal([started(), ...parked, { t: 'answered', at: T0 + 1, id: (parked[0] as { id: string }).id, answer: 'deny' }])

    expect(skipSet(denied).has('n')).toBe(true)
  })

  it('retries are bounded by the policy and then the task is parked', () => {
    let s = running()
    let at = T0

    for (let i = 0; i < 2; i++) {
      const d = tick(s, facts({ nowMs: at }))

      expect(d.act).not.toBeNull()
      s = foldJournal([...[started()], ...(s.steps.flatMap(step => [{ t: 'step.started', at: step.startedAt, id: step.id, task: step.task, cls: step.cls, attempt: step.attempt, deadline: step.deadline, tier: step.tier }, { t: 'step.failed', at: step.startedAt + 1, id: step.id, why: 'x' }] as JournalEvent[]) ), ...d.events, { t: 'step.failed', at: at + 1, id: d.act?.id ?? '', why: 'x' }])
      at += 2 * H
    }

    expect(tick(s, facts({ nowMs: at })).events[0]).toMatchObject({ t: 'parked' })
  })
})

describe('loop: properties over a seeded random walk', () => {
  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000)

  const randomFacts = (r: () => number, now: number, s: LoopState, killAt: number, i: number): Facts => {
    const open = s.steps.filter(step => step.status === 'started')

    return facts({
      nowMs: now,
      killSeen: i >= killAt,
      anatole: r() < 0.9 ? 'on' : 'off',
      spend: r() < 0.9 ? { hourUsd: r() * 3, dayUsd: r() * 12, totalUsd: r() * 30 } : null,
      task: r() < 0.8 ? task(`t${Math.floor(r() * 12)}`, { cls: r() < 0.8 ? 'edit' : r() < 0.5 ? null : 'network' }) : null,
      effects: Object.fromEntries(open.map(step => [step.id, (['done', 'failed', 'unknown', 'absent', 'done-unverified'] as const)[Math.floor(r() * 5)] as never])),
      orphans: new Set(open.filter(() => r() < 0.3).map(step => step.id)),
    })
  }

  it('once the kill flag is seen no tick ever acts again, whatever else is true, and nothing restarts it', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed)
      const killAt = Math.floor(r() * 40)
      let s = running()
      let now = T0

      for (let i = 0; i < 80; i++) {
        now += Math.floor(r() * 5 * 60_000)

        const d = tick(s, randomFacts(r, now, s, killAt, i))

        if (i >= killAt) expect(d.act).toBeNull()

        s = foldJournal(d.events, s)
        if (i > killAt) expect(s.phase).toBe('stopped')
      }
    }
  })

  it('no task has two live steps, no step id repeats, and a step only starts while the loop is running', () => {
    for (let seed = 100; seed < 160; seed++) {
      const r = rng(seed)
      let s = running()
      let now = T0

      for (let i = 0; i < 120; i++) {
        now += Math.floor(r() * 10 * 60_000)

        const d = tick(s, randomFacts(r, now, s, 1e9, i))

        if (d.act !== null) {
          expect(s.phase).toBe('running')
          expect(s.steps.some(step => step.task === d.act?.task.id && step.status !== 'failed')).toBe(false)
          expect(s.steps.some(step => step.id === d.act?.id)).toBe(false)
        }

        s = foldJournal(d.events, s)
        if (s.phase === 'paused' && r() < 0.3) s = foldJournal([{ t: 'resume', at: now }], s)

        const live = s.steps.filter(step => step.status === 'started')

        expect(new Set(live.map(step => step.task)).size).toBe(live.length)
        expect(live.length).toBeLessThanOrEqual(1)
      }
    }
  })

  it('crash-resume: folding the journal from any prefix and ticking never starts an already-started or finished task', () => {
    for (let seed = 200; seed < 230; seed++) {
      const r = rng(seed)
      const journal: JournalEvent[] = [started()]
      let s = running()
      let now = T0

      for (let i = 0; i < 60; i++) {
        now += 90_000

        const d = tick(s, randomFacts(r, now, s, 1e9, i))

        journal.push(...d.events)
        s = foldJournal(d.events, s)
        if (s.phase !== 'running') s = foldJournal([{ t: 'resume', at: now }], s) && foldJournal([...journal, { t: 'resume', at: now }])
        if (s.phase === 'running' && journal.at(-1)?.t === 'pause') journal.push({ t: 'resume', at: now })
      }

      // Crash at every point: a fresh process folds the prefix text, every started step is an orphan, and nothing is double-started.
      for (let cut = 1; cut <= journal.length; cut += 3) {
        const text = journal.slice(0, cut).map(encodeLine).join('')
        const resumed = foldJournal(parseJournal(text).events)

        expect(resumed.steps.map(step => step.id)).toEqual(foldJournal(journal.slice(0, cut)).steps.map(step => step.id))

        const orphans = new Set(resumed.steps.filter(step => step.status === 'started').map(step => step.id))

        for (const orphan of resumed.steps.filter(step => step.status === 'started')) {
          const d = tick(resumed, facts({ nowMs: now + 5 * H, task: task(orphan.task), orphans, effects: { [orphan.id]: 'absent' } }))

          // Re-verified by effect: found lost, never restarted in the same pass.
          expect(d.act).toBeNull()
        }
      }
    }
  })

  it('a replayed journal line changes nothing (idempotent fold)', () => {
    const events: JournalEvent[] = [started(), { t: 'step.started', at: T0 + 1, id: 's-1', task: 't1', cls: 'edit', attempt: 1, deadline: T0 + 99, tier: 'mid' }]

    expect(foldJournal([...events, events[1] as JournalEvent]).steps.length).toBe(1)
  })

  it('a compacted snapshot folds back to the same live state', () => {
    const r = rng(7)
    let s = running()
    let now = T0

    for (let i = 0; i < 80; i++) {
      now += 120_000

      const d = tick(s, randomFacts(r, now, s, 1e9, i))

      s = foldJournal(d.events, s)
      if (s.phase === 'paused') s = foldJournal([{ t: 'resume', at: now }], s)
    }

    const back = foldJournal(snapshotEvents(s))

    expect(back.phase).toBe(s.phase)
    expect(back.steps.filter(step => step.status === 'started').map(step => step.id)).toEqual(s.steps.filter(step => step.status === 'started').map(step => step.id))
    expect(back.parked.filter(p => p.answer === undefined).length).toBe(s.parked.filter(p => p.answer === undefined).length)
  })
})

describe('band and summary', () => {
  it('draws day, spend and parked from what was read, and n/a where it was not', () => {
    const s = foldJournal([started(), { t: 'parked', at: T0 + 1, id: 'p-1', task: 't', question: 'q' }, { t: 'parked', at: T0 + 2, id: 'p-2', task: 'u', question: 'q' }])

    expect(bandText(s, T0 + 2 * 86_400_000 + 5, 12, ENV)).toBe('autopilot day 3 · $12/$40 · 2 parked')
    expect(bandText(s, T0, null, ENV)).toBe('autopilot day 1 · $n/a/$40 · 2 parked')
    expect(bandText(s, T0, 0, null)).toBe('autopilot day 1 · $0/$n/a · 2 parked')
    expect(bandText(emptyLoop(), T0, 5, ENV)).toBe('')
    expect(bandText(foldJournal([started(), { t: 'pause', at: T0, reason: 'x' }]), T0, 1, ENV)).toContain('paused')
    expect(summarize(s, T0).parked).toBe(2)
  })
})
