/**
 * A recording Events/Timeline page rig (ADR-474): a state with a log and lanes in it, the real actions over a stub host, and a Ctx
 * whose kit records elements, so a test can press a button by key and the layout meter (wf-layout-rig) can measure every row.
 */
import { activityOf, append } from '../../hooks/activity-live'
import type { ConsoleEvent } from '../../hooks/data/events'
import { loadRows } from '../../hooks/data/timeline-model'
import { eventsActions } from '../../hooks/events-ui'
import type { Host } from '../../hooks/host'
import { newState } from '../../hooks/state'
import { timelineActions } from '../../hooks/timeline-ui'
import { watchActions } from '../../hooks/watch'
import type { Actions, Ctx } from '../../hooks/views/common'
import { kit } from './wf-drill-world'

export const T = Math.floor(Date.now() / 60_000) * 60_000
export const WIDTHS = [56, 60, 72, 80, 100, 125] as const

const KINDS: ConsoleEvent['kind'][] = ['swarm', 'claims', 'workflows', 'autopilot', 'anatole', 'tools', 'learning']
const LINES = ['agent coder-12 spawned (coder) with a rather long descriptive name that goes on and on', 'run wf_alpha_build finished: 3 of 3 agents done', 'step s7 failed: tests red in packages/very/long/path/to/some/module/file.spec.ts', 'Anatole blocked Bash: rule r-exfil (high)', 'ISSUE-1234 progress 40%', '+2 patterns learned']

export function rig(columns: number, opts: { events?: number; open?: string; lanes?: boolean } = {}) {
  const state = newState({})

  state.cwd = '/work/proj'
  state.loadedAtMs = T - 3_600_000
  state.snapshot = null

  const act = activityOf(state)
  const log: ConsoleEvent[] = Array.from({ length: opts.events ?? 120 }, (_, i) => ({ atMs: T - (opts.events ?? 120) * 20_000 + i * 20_000, kind: KINDS[i % KINDS.length] as ConsoleEvent['kind'], text: `${LINES[i % LINES.length]} #${Math.floor(i / 7)}`, ...(i % 5 === 0 && { agentId: 'coder-12' }), ...(i % 3 === 0 && { src: 'autopilot' }) }))

  append(act, log)
  act.loaded.isLoaded = true
  act.prefs.searches = Array.from({ length: 8 }, (_, i) => ({ name: `saved search number ${i}`, q: `kind:swarm level:bad s${i}` }))
  act.prefs.rules = [{ name: 'bad swarm things', q: 'level:bad' }]
  act.prefs.pins = [{ atMs: T - 5000, kind: 'swarm', text: 'a pinned event with a long text '.repeat(6), level: 'warn' }]

  if (opts.lanes !== false) {
    const rows = ['alpha-agent-with-a-long-name', 'beta', 'gamma', 'delta', 'epsilon'].flatMap((label, i) => [{ k: 'span' as const, lane: `ruflo:${i}`, group: 'ruflo' as const, label, fromMs: T - 14 * 60_000 + i * 30_000, toMs: T - 6 * 60_000 + i * 30_000, busy: i % 2 === 0 }, { k: 'span' as const, lane: `workflow:wf_a/${i}`, group: 'workflow' as const, label: `wf_alpha_build/agent-${i}`, fromMs: T - 12 * 60_000, toMs: T - 3 * 60_000, busy: true }])

    loadRows(act.lanes, [...rows, { k: 'tick', lane: 'claude:main', group: 'claude', label: 'claude (main)', min: Math.floor(T / 60_000) - 4, n: 7, tools: { Bash: 5, Read: 2 } }])
  }

  const asked: unknown[] = []
  const said: string[] = []
  const host = { fs: { stat: async () => undefined, read: async () => '', list: async () => [] }, run: async () => ({ exitCode: 0, stdout: '', stderr: '' }), fillPrompt: async (text: string) => (said.push(text), true), invalidate: () => undefined } as unknown as Host
  const views: string[] = []
  const actions = {
    events: eventsActions(state, host, () => undefined, spec => void asked.push(spec), question => void said.push(question)),
    timeline: timelineActions(state, host, () => undefined, id => void views.push(id), spec => void asked.push(spec), question => void said.push(question)),
    watch: watchActions(state, () => undefined, question => void said.push(question)),
    filter: () => void said.push('filter cycled'),
    view: (id: string) => void views.push(id),
  } as unknown as Actions
  const ctx: Ctx = { kit, state, nowMs: T, columns, pictures: new Map(), act: actions }

  return { state, act, ctx, asked, said, views, actions }
}
