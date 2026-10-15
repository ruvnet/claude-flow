/**
 * A mutation check on the advisor checkpoints (ADR-483): each mutant is a one-line change to the failure counting, the tick plan, the consult
 * command or the loop prompt, written to a temporary copy beside the original and imported; the test passes only if a fixed battery sees the
 * change. Run with
 *   npx vitest run plugins/ruflo-console/tests/mission-advisor-mutation.spec.ts
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import type { MissionRecord } from '../hooks/mission-types'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOOKS = join(HERE, '..', 'hooks')

type Mod = Record<string, (...args: never[]) => unknown>

const base = (): MissionRecord => ({
  id: `msn_${'d'.repeat(24)}`,
  objective: 'o',
  profile: 'feature',
  rigor: 'standard',
  tasks: [{ id: 't1', title: 'A', phase: 'S', agent: 'a', requirement: 'r', dependsOn: [] }, { id: 't2', title: 'B', phase: 'S', agent: 'a', requirement: 'r', dependsOn: [] }],
  acceptance: [],
  events: [],
  paused: false,
  cancelled: false,
  auto: false,
  createdAtMs: 1,
})

let seq = 0
const ev = (m: MissionRecord, e: Record<string, unknown>) => void m.events.push({ seq: ++seq, atMs: 1, ...e } as never)
const gate = (m: MissionRecord, status: string, g = 'g1', taskId = 't1') => ev(m, { type: 'evidence.gate', taskId, status, evidenceRef: `gate:${g}:1`, note: 'n' })

/** What the modules say about a fixed battery: any behaviour change the battery sees changes this string. */
function signature(adv: Mod, loop: Mod): string {
  const out: unknown[] = []
  const scenario = (steps: (m: MissionRecord) => void): MissionRecord => {
    seq = 0

    const m = base()

    steps(m)

    return m
  }
  const esc = (m: MissionRecord) => {
    const e = (adv.escalationOf as unknown as (m: MissionRecord) => { state: string; count: number; ref: string })(m)

    return [e.state, e.count, e.ref]
  }
  const LOOP = { missionId: base().id, interval: '5m', startedAtMs: 0, expiresAtMs: 10 ** 12, ticks: 3, lastTickMs: 0, status: 'armed' }
  const plan = (m: MissionRecord, extra: Record<string, unknown>) => (loop.tickPlan as unknown as (i: unknown) => unknown)({ mission: m, loop: LOOP, prefs: {}, gatesConfigured: false, spendUsd: null, capUsd: null, nowMs: 3_600_000, taskStatus: new Map([['t1', 'ready'], ['t2', 'waiting']]), ...extra })
  const done = new Map([['t1', 'done'], ['t2', 'done']])

  const one = scenario(m => gate(m, 'failed'))
  const two = scenario(m => (gate(m, 'failed'), gate(m, 'failed')))
  const three = scenario(m => (gate(m, 'failed'), gate(m, 'failed'), gate(m, 'failed')))
  const passed = scenario(m => (gate(m, 'failed'), gate(m, 'passed'), gate(m, 'failed')))
  const mixed = scenario(m => (gate(m, 'failed', 'g1'), gate(m, 'failed', 'g2'), gate(m, 'failed', 'g1', 't2')))
  const offered = scenario(m => (gate(m, 'failed'), gate(m, 'failed'), ev(m, { type: 'advisor.offered', evidenceRef: esc(m)[2] })))
  const early = scenario(m => (gate(m, 'failed'), ev(m, { type: 'advisor.offered', evidenceRef: `stuck:${m.id}:t1:gg1` }), gate(m, 'failed')))
  const resumed = scenario(m => (gate(m, 'failed'), gate(m, 'failed'), gate(m, 'failed'), ev(m, { type: 'advisor.resumed' }), gate(m, 'failed')))
  const noise = scenario(m => (gate(m, 'failed', 'g9'), ev(m, { type: 'advisor.answered', taskId: 't1', status: 'failed' }), ev(m, { type: 'advisor.answered', taskId: 't1', status: 'failed' })))

  for (const m of [one, two, three, passed, mixed, offered, early, resumed, noise]) out.push(esc(m))
  for (const m of [one, two, three, offered, resumed]) out.push([plan(m, { advisor: true }), plan(m, {})])
  out.push(plan(two, { advisor: true, taskStatus: new Map([['t1', 'running']]) }))
  out.push(plan(base(), { advisor: true, taskStatus: done }), plan(base(), { taskStatus: done }), plan(scenario(m => ev(m, { type: 'advisor.offered', evidenceRef: `done:${m.id}` })), { advisor: true, taskStatus: done }))
  out.push(plan({ ...base(), cancelled: true }, { advisor: true, taskStatus: done }))
  out.push((adv.doneDue as unknown as (m: MissionRecord, s: unknown) => boolean)({ ...base(), cancelled: true }, done))
  out.push((adv.advisorSummary as unknown as (m: MissionRecord) => unknown)(scenario(m => (ev(m, { type: 'advisor.answered', model: 'opus', costUsd: 0.5 }), ev(m, { type: 'advisor.answered', model: 'x', costUsd: -2 })))))
  out.push((adv.consultArgv as unknown as (a: unknown) => unknown)({ advisorModel: 'default', budgetUsd: 1 }), (adv.consultArgv as unknown as (a: unknown) => unknown)({ advisorModel: 'opus', budgetUsd: 2 }))
  out.push((adv.advisorPrompt as unknown as (k: string, i: unknown) => string)('stuck', { mission: two, statuses: new Map(), gates: [], adrBlock: '', escalation: (adv.escalationOf as unknown as (m: MissionRecord) => unknown)(two) }))
  out.push((loop.loopPrompt as unknown as (m: MissionRecord, p: unknown) => string)(base(), { loopInterval: '5m' }), (loop.loopPrompt as unknown as (m: MissionRecord, p: unknown) => string)(base(), { subagentSummaries: true }))

  return JSON.stringify(out)
}

describe('mutation check: the battery notices a change in the failure counting, the tick plan, the consult command and the loop prompt', () => {
  const made: string[] = []
  const baseline = async () => signature((await import('../hooks/mission-advisor')) as never, (await import('../hooks/mission-loop')) as never)

  afterAll(() => {
    for (const file of made) rmSync(file, { force: true })
  })

  const mutants: [string, string, string, string][] = [
    ['mission-advisor', 'consult at three failures', 'export const CONSULT_AT = 2', 'export const CONSULT_AT = 3'],
    ['mission-advisor', 'stop at four failures', 'export const STOP_AT = 3', 'export const STOP_AT = 4'],
    ['mission-advisor', 'a pass does not clear the run', "event.status === 'passed' ||", "event.status === 'zzz' ||"],
    ['mission-advisor', 'an offer before the second failure counts', 'event.seq > afterSeq', 'event.seq >= 0'],
    ['mission-advisor', 'a resume does not reset the run', 'event.type === EVENT_RESUMED', "event.type === 'x'"],
    ['mission-advisor', 'different checks and tasks share a run', 'const id = `${event.taskId}|${key}`', 'const id = key'],
    ['mission-advisor', 'the advisor\'s own events count as failures', "if (!isGate && event.type.startsWith('advisor.')) continue", ''],
    ['mission-advisor', 'a consult is not read-only', "'--permission-mode', 'plan'", "'--permission-mode', 'default'"],
    ['mission-advisor', 'a model is always passed', "ai.advisorModel === 'default' ? []", 'false ? []'],
    ['mission-advisor', 'a negative cost is summed', ' && event.costUsd > 0', ''],
    ['mission-advisor', 'a cancelled mission is due for pre-done', '!mission.cancelled && ', ''],
    ['mission-advisor', 'the data fence is dropped', 'untrusted project data to analyse', 'project data to analyse'],
    ['mission-advisor', 'the stuck question allows a retry', 'Do not recommend another blind retry.', ''],
    ['mission-loop', 'the setting off still escalates', "input.advisor === true ? escalationOf(mission) : null", 'escalationOf(mission)'],
    ['mission-loop', 'a consult is never asked for', "escalation?.state === 'consult'", "escalation?.state === 'zzz'"],
    ['mission-loop', 'pre-done consults with the setting off', 'input.advisor === true && doneDue(mission, states)', 'doneDue(mission, states)'],
    ['mission-loop', 'the stop-the-line is ignored', "escalation?.state === 'stop'", "escalation?.state === 'zzz'"],
    ['mission-loop', 'the subagent line is always added', 'prefs.subagentSummaries === true ?', 'true ?'],
  ]

  it('the unmutated battery is stable', async () => {
    expect(await baseline()).toBe(await baseline())
  })

  it.each(mutants.map((m, i) => [i, m[1], m] as const))('mutant %i (%s) changes what the battery sees', async (index, _label, [module, , find, replace]) => {
    const file = join(HOOKS, `${module}.ts`)
    const source = readFileSync(file, 'utf8')

    expect(source, `the mutation target must exist: ${find}`).toContain(find)

    const path = join(HOOKS, `.mut-${index}-${module}.ts`)

    writeFileSync(path, source.replace(find, replace))
    made.push(path)

    const mod = async (name: string) => (name === module ? await import(/* @vite-ignore */ path) : await import(`../hooks/${name}`)) as Mod

    expect(signature(await mod('mission-advisor'), await mod('mission-loop'))).not.toBe(await baseline())
  })
})
