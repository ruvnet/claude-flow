/**
 * Project Anatole in the Workflows board (ADR-463): alerts keep their session, are matched to runs and agents only as far as the files
 * allow (and say how), and everything the mod reported is masked and labelled unauthenticated. Pure and fast. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-anatole.spec.ts --testTimeout=30000
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { NO_ANATOLE, type AnatoleFacts } from '../hooks/data/anatole'
import type { ReaderFs } from '../hooks/data/files'
import { LEVEL_WORDS, matchAlert, parseSessionAlerts, protectorFor, readSessionAlerts, sessionOf, type SessionAlert } from '../hooks/data/wf-anatole'
import type { AgentState, WfAgent, WfRun } from '../hooks/data/workflows'
import { newWfUi } from '../hooks/data/workflows-nav'
import type { Host } from '../hooks/host'
import { newState, type State } from '../hooks/state'
import type { Ctx, Kit } from '../hooks/views/common'
import { registerSlot, resetSlots, slotsFor, type SlotEnv } from '../hooks/views/wf-slots'
import { alertsFor, boardRows, modeFor, refreshAlerts, registerAnatoleSlots, resetAnatole, tabRows, wireWfAnatole } from '../hooks/views/wf-anatole'

const T0 = Date.parse('2026-10-06T01:00:00.000Z')
const SESSION = 'sess-aaaa1111'
const OTHER = 'sess-bbbb2222'
const NOW = T0 + 600_000

type El = { kind: string; props: Record<string, unknown> }

const kit = { Box: (props: Record<string, unknown>): El => ({ kind: 'Box', props }), Text: (props: Record<string, unknown>): El => ({ kind: 'Text', props }), Button: (props: Record<string, unknown>): El => ({ kind: 'Button', props }) } as unknown as Kit

const flat = (node: unknown, out: El[] = []): El[] => {
  if (Array.isArray(node)) node.forEach(child => flat(child, out))
  else if (typeof node === 'object' && node !== null) {
    out.push(node as El)
    flat((node as El).props?.children, out)
  }

  return out
}

const words = (tree: unknown): string => flat(tree).filter(el => el.kind === 'Text' && typeof el.props.children === 'string').map(el => el.props.children as string).join('\n')

const agent = (id: string, startS: number, endS: number | null, state: AgentState = 'done'): WfAgent => ({ id, label: `build:${id}`, phase: 'Build', state, hasWorktree: false, startedMs: T0 + startS * 1000, ...(endS !== null && { elapsedMs: (endS - startS) * 1000 }) })

const runOf = (agents: WfAgent[], over: Partial<WfRun> = {}): WfRun => ({ id: 'wf_one', name: 'big-run', kind: 'workflow', state: 'completed', phases: [{ title: 'Build', agents, done: agents.length, total: agents.length, running: 0, failed: 0 }], running: 0, done: agents.length, failed: 0, idle: 0, total: agents.length, totalTokens: null, isTokensPartial: false, startedMs: T0, durationMs: 300_000, dir: `/c/projects/p/${SESSION}/subagents/workflows/wf_one`, hasRecord: true, ...over })

const line = (over: Record<string, unknown> = {}): string => JSON.stringify({ id: 'al-1', at: T0 + 30_000, rule: 'PR-006', owasp: ['LLM06'], severity: 'high', action: 'blocked', tool: 'Bash', summary: 'rm -r on a path outside the project', fp: 'abcdef012345', state: 'open', session: SESSION, ...over })

const alerts = (...lines: string[]): SessionAlert[] => parseSessionAlerts(lines.join('\n')).alerts

describe('reading the log with its sessions', () => {
  it('keeps the session and an agent id the mod might name, and only when they look like ids', () => {
    const [good, hostile, none, named] = alerts(line(), line({ id: 'al-2', session: '../../etc/passwd' }), line({ id: 'al-3', session: undefined }), line({ id: 'al-4', agentId: 'agent-77aa88bb' }))

    expect(good).toMatchObject({ session: SESSION, agentId: null })
    expect(hostile?.session).toBeNull()
    expect(none?.session).toBeNull()
    expect(named?.agentId).toBe('agent-77aa88bb')
  })

  it('counts a line that fails the console\'s own validation as unusable, and reads only the last 200 lines', () => {
    const parsed = parseSessionAlerts([line(), 'not json', line({ rule: 'bad' }), line({ severity: 'nope' })].join('\n'))

    expect(parsed.alerts).toHaveLength(1)
    expect(parsed.bad).toBe(3)

    const many = Array.from({ length: 230 }, (_, i) => line({ id: `al-${i}` })).join('\n')

    expect(parseSessionAlerts(many).alerts).toHaveLength(200)
    expect(parseSessionAlerts(many).alerts[0]?.id).toBe('al-30')
    expect(parseSessionAlerts(null)).toEqual({ alerts: [], bad: 0 })
  })

  const fsOf = (files: Record<string, { text: string; kind?: string; size?: number; isLink?: boolean }>): ReaderFs => ({
    read: async path => files[path]?.text ?? Promise.reject(new Error('ENOENT')),
    stat: async path => (files[path] === undefined ? Promise.reject(new Error('ENOENT')) : { mtimeMs: 1, size: files[path].size ?? files[path].text.length, kind: files[path].kind ?? 'file', isLink: files[path].isLink === true }),
    list: async () => [],
  })

  it('reads the bounded log; a missing one is empty, a link, a directory or an oversize one is refused with the reason', async () => {
    const path = '/w/.claude-flow/protector-mod/alerts.jsonl'

    expect(await readSessionAlerts(fsOf({ [path]: { text: line() } }), new Map(), '/w')).toMatchObject({ alerts: [{ session: SESSION }], refused: null })
    expect(await readSessionAlerts(fsOf({}), new Map(), '/w')).toEqual({ alerts: [], bad: 0, refused: null })
    expect((await readSessionAlerts(fsOf({ [path]: { text: line(), isLink: true } }), new Map(), '/w')).refused).toBe('not-regular')
    expect((await readSessionAlerts(fsOf({ [path]: { text: line(), kind: 'dir' } }), new Map(), '/w')).refused).toBe('not-regular')
    expect((await readSessionAlerts(fsOf({ [path]: { text: line(), size: 600 * 1024 } }), new Map(), '/w')).refused).toBe('too-large')
  })
})

describe('which session a run belongs to', () => {
  it('is the directory above subagents/ in the run directory; none for a swarm or a path that does not say', () => {
    expect(sessionOf(runOf([]))).toBe(SESSION)
    expect(sessionOf({ dir: undefined })).toBeNull()
    expect(sessionOf({ dir: '/c/subagents/workflows/x' })).toBeNull()
    expect(sessionOf({ dir: '/c/..%2f/subagents/w' })).toBeNull()
  })
})

describe('matching an alert to a run and an agent, as far as the files allow', () => {
  const two = runOf([agent('aaaaaaaa1', 0, 100), agent('bbbbbbbb2', 50, 200)])
  const one = runOf([agent('aaaaaaaa1', 0, 100), agent('bbbbbbbb2', 150, 250)])
  const at = (seconds: number, over: Record<string, unknown> = {}) => alerts(line({ at: T0 + seconds * 1000, ...over }))[0] as SessionAlert

  it('names the agent only when the mod did, or when exactly one agent was running then', () => {
    expect(matchAlert(at(30), [one], NOW)).toEqual({ level: 'window', runId: 'wf_one', agentId: 'aaaaaaaa1' })
    expect(matchAlert(at(200), [one], NOW)).toEqual({ level: 'window', runId: 'wf_one', agentId: 'bbbbbbbb2' })
    expect(matchAlert(at(30, { agentId: 'bbbbbbbb2' }), [one], NOW)).toEqual({ level: 'agent', runId: 'wf_one', agentId: 'bbbbbbbb2' })
  })

  it('says only "during this run" when two agents were running, or none was', () => {
    expect(matchAlert(at(75), [two], NOW)).toEqual({ level: 'run', runId: 'wf_one', agentId: null })
    expect(matchAlert(at(125), [one], NOW)).toEqual({ level: 'run', runId: 'wf_one', agentId: null })
  })

  it('does not attribute an alert with no session, another session, no time, or a time outside the run', () => {
    expect(matchAlert(at(30, { session: undefined }), [one], NOW).level).toBe('none')
    expect(matchAlert(at(30, { session: OTHER }), [one], NOW).level).toBe('none')
    expect(matchAlert(at(30, { at: undefined }), [one], NOW).level).toBe('none')
    expect(matchAlert(at(-1), [one], NOW).level).toBe('none')
    expect(matchAlert(at(301), [one], NOW).level).toBe('none')
    expect(matchAlert(at(300), [one], NOW).level).toBe('run')
  })

  it('does not attribute to a run whose start is unknown, a swarm, or an agent named that is not in the run', () => {
    expect(matchAlert(at(30), [runOf(one.phases[0]!.agents, { startedMs: undefined })], NOW).level).toBe('none')
    expect(matchAlert(at(30), [runOf(one.phases[0]!.agents, { kind: 'ruflo-swarm' })], NOW).level).toBe('none')
    expect(matchAlert(at(30, { agentId: 'zzzzzzzz9' }), [one], NOW).level).toBe('window')
  })

  it('treats a running agent as active until now, and a running run as lasting until now', () => {
    const live = runOf([agent('aaaaaaaa1', 0, null, 'running')], { durationMs: undefined, running: 1, state: 'running' })

    expect(matchAlert(at(500), [live], NOW)).toEqual({ level: 'window', runId: 'wf_one', agentId: 'aaaaaaaa1' })
    expect(matchAlert(at(700), [live], NOW).level).toBe('none')
  })

  it('has words for every level', () => expect(Object.keys(LEVEL_WORDS).sort()).toEqual(['agent', 'none', 'run', 'window']))
})

describe('the per-agent record of one run', () => {
  const run = runOf([agent('aaaaaaaa1', 0, 100), agent('bbbbbbbb2', 150, 250), agent('cccccccc3', 400, 450)])
  const modeOf = (rule: string) => (rule === 'PR-006' ? ('block' as const) : null)

  it('tallies blocked and notified per agent with the rules that fired and their mode, and keeps the unplaced separate', () => {
    const list = alerts(
      line({ id: 'a1' }),
      line({ id: 'a2', action: 'notified', rule: 'PR-004', at: T0 + 40_000 }),
      line({ id: 'a3', at: T0 + 200_000, state: 'acked' }),
      line({ id: 'a4', at: T0 + 125_000 }),
      line({ id: 'a5', session: OTHER }),
      line({ id: 'a6', session: undefined }),
    )
    const found = protectorFor(run, list, [run], modeOf, NOW)
    const first = found.byAgent.get('aaaaaaaa1')

    expect(first).toMatchObject({ blocked: 1, notified: 1, open: 2, level: 'window' })
    expect(first?.rules).toEqual([{ id: 'PR-006', count: 1, mode: 'block' }, { id: 'PR-004', count: 1, mode: null }])
    expect(found.byAgent.get('bbbbbbbb2')).toMatchObject({ blocked: 1, open: 0 })
    expect(found.byAgent.has('cccccccc3')).toBe(false)
    expect(found.unnamed).toMatchObject({ blocked: 1, notified: 0 })
    expect(found.notAttributed).toBe(2)
    expect(found.total).toBe(6)
    expect(found.session).toBe(SESSION)
  })

  it('upgrades an agent to "named by the mod" when any of its alerts named it', () => {
    const found = protectorFor(run, alerts(line({ id: 'a1' }), line({ id: 'a2', agentId: 'aaaaaaaa1' })), [run], modeOf, NOW)

    expect(found.byAgent.get('aaaaaaaa1')?.level).toBe('agent')
  })

  it('gives each run only its own alerts when two runs share a session', () => {
    const later = runOf([agent('dddddddd4', 0, 50)], { id: 'wf_two', startedMs: T0 + 1_000_000, durationMs: 100_000, dir: `/c/projects/p/${SESSION}/subagents/workflows/wf_two` })
    const list = alerts(line({ id: 'a1' }), line({ id: 'a2', at: T0 + 1_020_000 }))

    expect(protectorFor(run, list, [run, later], modeOf, NOW).byAgent.size).toBe(1)
    expect(protectorFor(later, list, [run, later], modeOf, NOW).unnamed.alerts.map(a => a.id)).toEqual(['a2'])
  })
})

describe('the board and the tab', () => {
  let state: State
  const run = runOf([agent('aaaaaaaa1', 0, 100), agent('bbbbbbbb2', 150, 250)])
  const facts = (over: Partial<AnatoleFacts> = {}): AnatoleFacts => ({ ...NO_ANATOLE, present: true, status: { mode: 'enforce', modVersion: '1.0.0', calls: 120, blocked: 4, updatedMs: NOW - 60_000, summary: '', open: { critical: 0, high: 2, medium: 0, low: 0, total: 2 }, baseline: null, degraded: false }, ...over })
  const host = (log: string | null): Host => ({ fs: { read: async () => log ?? Promise.reject(new Error('x')), stat: async () => (log === null ? Promise.reject(new Error('ENOENT')) : { mtimeMs: 1, size: log.length, kind: 'file' }), list: async () => [] }, invalidate: () => undefined }) as unknown as Host
  const envOf = (over: Partial<SlotEnv> = {}): SlotEnv => ({ ctx: { kit, state, nowMs: NOW, columns: 140, pictures: new Map(), act: {} as never } as Ctx, runs: [run], run, phase: run.phases[0] ?? null, agent: run.phases[0]?.agents[0] ?? null, ui: newWfUi(), nowMs: NOW, ...over })

  beforeEach(() => {
    state = newState({})
    state.cwd = '/w'
  })
  afterEach(() => resetAnatole(state))

  it('says it is not installed when the plugin wrote nothing, and not wired before the console wires it', () => {
    expect(words(boardRows(envOf()))).toMatch(/not installed or has written nothing.*claude plugin install ruflo-protector@ruflo/)
    state.snapshot = { anatole: facts() } as never
    expect(words(boardRows(envOf()))).toMatch(/not wired/)
  })

  it('shows the mod\'s mode and totals with the unauthenticated label, then the agents with alerts and how each was matched', async () => {
    state.snapshot = { anatole: facts({ overrides: { 'PR-006': { mode: 'notify', demoted: false } } }) } as never
    wireWfAnatole(state, host([line({ id: 'a1' }), line({ id: 'a2', action: 'notified', at: T0 + 40_000 }), line({ id: 'a3', session: OTHER })].join('\n')))
    await refreshAlerts(state, host([line({ id: 'a1' }), line({ id: 'a2', action: 'notified', at: T0 + 40_000 }), line({ id: 'a3', session: OTHER })].join('\n')), NOW)

    const text = words(boardRows(envOf()))

    expect(text).toContain('mode enforce · 120 calls · 4 blocked in all · open 0 critical 2 high')
    expect(text).toContain('reported by the mod, unauthenticated')
    expect(text).toMatch(/big-run: session sess-aaaa11/)
    expect(text).toMatch(/build:aaaaaaaa1\s+1 blocked\s+1 notified · PR-006×2 \(notify\).*the only agent running then/)
    expect(text).toContain('1 agent with no alert matched to them either')
    expect(text).toContain('1 alert not attributed to any run read here')
  })

  it('says plainly when the log is empty or refused, and for a swarm run or no run', async () => {
    state.snapshot = { anatole: facts() } as never
    wireWfAnatole(state, host(null))
    await refreshAlerts(state, host(''), NOW)
    expect(words(boardRows(envOf()))).toContain('the protector has logged no alert')
    expect(words(boardRows(envOf({ run: null })))).toContain('no run under the cursor')
    expect(words(boardRows(envOf({ run: { ...run, kind: 'ruflo-swarm' } })))).toContain('no Claude Code session to match alerts to: not attributed')
    ;(alertsFor(state) as { refused: string | null }).refused = 'too-large'
    expect(words(boardRows(envOf()))).toContain('the alert log was not read: too-large')
  })

  it('masks credential-shaped text and strips control characters in the tab\'s alert rows', async () => {
    state.snapshot = { anatole: facts() } as never

    const log = line({ id: 'a1', summary: 'curl with token=abcdef123456 \u001b[31mred', tool: 'Bash\u001b[0m' })

    wireWfAnatole(state, host(log))
    await refreshAlerts(state, host(log), NOW)

    const rows = words(tabRows(envOf()))

    expect(rows).toContain('✖ blocked')
    expect(rows).toContain('PR-006')
    expect(rows).toContain('‹masked›')
    expect(rows).not.toContain('abcdef123456')
    expect(rows).not.toContain('\u001b')
    expect(rows).toContain('the only agent running then')
    expect(rows).toContain('unauthenticated')
  })

  it('the tab says no alert is matched, and why, when none is; and a swarm agent has no session', async () => {
    state.snapshot = { anatole: facts() } as never
    wireWfAnatole(state, host(line({ session: OTHER })))
    await refreshAlerts(state, host(line({ session: OTHER })), NOW)
    expect(words(tabRows(envOf()))).toMatch(/no protector alert is matched to build:aaaaaaaa1: the mod's alerts do not name an agent/)
    expect(words(tabRows(envOf({ agent: null })))).toContain('no agent under the cursor')
    expect(words(tabRows(envOf({ run: { ...run, kind: 'ruflo-swarm' } })))).toContain('not attributed')
  })

  it('reads a rule\'s mode from the person\'s override, else the shipped default', () => {
    state.snapshot = { anatole: facts({ overrides: { 'PR-006': { mode: 'off', demoted: false } } }) } as never
    expect(modeFor(state)('PR-006')).toBe('off')
    expect(modeFor(state)('PR-001')).toBe('block')
    expect(modeFor(state)('PR-999')).toBeNull()
  })
})

describe('the slots', () => {
  beforeEach(() => resetSlots())
  afterEach(() => resetSlots())

  it('register a board, a tab beside detail for workflow agents, and a read on the page\'s refresh', () => {
    registerAnatoleSlots()
    registerAnatoleSlots()
    expect(slotsFor('board').map(s => s.id)).toEqual(['anatole'])
    expect(slotsFor('tab').map(s => s.id)).toEqual(['anatole'])
    expect(slotsFor('notice').map(s => s.id)).toEqual(['anatole-read'])
    expect(registerSlot({ kind: 'tab', id: 'detail', label: 'x', render: () => [] })).toMatchObject({ ok: false })

    const tab = slotsFor('tab')[0]
    const env = { run: { kind: 'workflow' }, agent: {} } as unknown as SlotEnv

    expect(tab?.when?.(env)).toBe(true)
    expect(tab?.when?.({ run: { kind: 'ruflo-swarm' }, agent: {} } as unknown as SlotEnv)).toBe(false)
    expect(tab?.when?.({ run: { kind: 'workflow' }, agent: null } as unknown as SlotEnv)).toBe(false)
  })

  it('the page refresh reads the log through the wired host only, and never throws without one', async () => {
    const state = newState({})
    let reads = 0
    const host = { fs: { stat: async () => (reads += 1, { mtimeMs: 1, size: 2, kind: 'file' }), read: async () => '{}', list: async () => [] }, invalidate: () => undefined } as unknown as Host

    state.cwd = '/w'
    registerAnatoleSlots()
    expect(slotsFor('notice')[0]?.between(null, [], NOW)).toEqual([])
    await new Promise(done => setTimeout(done, 5))
    expect(reads).toBe(0)
    wireWfAnatole(state, host)
    slotsFor('notice')[0]?.between(null, [], NOW)
    await new Promise(done => setTimeout(done, 5))
    expect(reads).toBe(1)
    resetAnatole(state)
  })
})
