/**
 * The drill-down of the Workflows page (ADR-459), plugged in through the page's slots (views/wf-slots.ts) and nothing else:
 *
 *   Runs > Phases > Agents > one Agent (Activity | Log | Files | Result) > one tool call or message in full
 *
 * A board slot draws the panel (breadcrumb, then the level you are on) and key slots move through it. The page's own `Enter`, `Esc`,
 * `h` and `/` are not available to a slot (a hotkey is one free letter or digit, `h` is Help's, Enter and Esc are the page's), so the
 * keys are buttons with letters, and `drillKey` is exported for the merge owner who wants Enter/Esc routed here too.
 *
 * The drill's own position lives in a module record keyed by the console's `State` object, not in `WfUi` (which is closed): a key
 * handler stores the new position and asks the page to redraw with `setUi({})`. The first three levels are the page's cursor, so a key
 * there sends the page the `h` `l` `j` `k` `[` `]` it already understands.
 */
import type { RenderElement } from 'claude-code'

import { isBound, loadDiff, loadResult, loadTranscript, noteOf, parsedOf, reloadTails, resultOf, textOf } from '../data/wf-drill-io'
import { filterLines, logLines, mergeLines, nextFilter, type LogLine } from '../data/wf-log'
import { crumbs, deeper, jump, LEVEL_NAME, move, nextSub, newDrill, shallower, sync, toLevel, type Drill, type DrillLevel, type Here, type PageKey, type Step, type Sub, type Target } from '../data/wf-trail'
import { fmtElapsed, fmtTokens } from '../data/workflows'
import { clip, col, text, THEME } from './common'
import { crumbRow, flow } from './wf-layout'
import { agentBody, itemBody, type Model, type Ops } from './wf-drill-body'
import { registerSlot, type SlotEnv } from './wf-slots'
import type { State } from '../state'

const drills = new WeakMap<object, Drill>()
const said = new WeakMap<object, string>()
let boundState: State | null = null

/** The merge owner's binding hands the drill the `State` the follow tick should look at. */
export const watchState = (state: State | null): void => void (boundState = state)

export const drillOf = (state: object): Drill => drills.get(state) ?? newDrill()
const keyOf = (env: SlotEnv): string => `${env.run?.id ?? ''}/${env.agent?.id ?? ''}`

/** The drill as this frame sees it: the stored position, started over where the cursor moved to another agent, and what the log and calls hold. */
export function modelOf(env: SlotEnv): Model {
  const state = env.ctx.state
  const drill = sync(drillOf(state), keyOf(env))
  const agent = env.agent
  const parsed = agent !== null && agent.ruflo === undefined ? parsedOf(state.cache, agent) : null
  let lines: LogLine[] = []
  let unread = 0

  if (drill.open && drill.sub === 'log' && agent !== null && agent.ruflo === undefined && (drill.level === 'agent' || drill.level === 'item')) {
    if (drill.scope === 'agent') lines = parsed === null ? [] : logLines(parsed, agent)
    else {
      const lists = (env.phase?.agents ?? []).filter(other => other.ruflo === undefined).flatMap(other => {
        const p = parsedOf(state.cache, other)

        if (p === null) {
          unread += 1

          return []
        }

        // A merged log of a whole phase keeps each agent's newest lines: sixty agents' full logs would be the cost of every frame.
        return [logLines(p, other).slice(-400)]
      })

      lines = mergeLines(lists)
    }
  }

  return { drill, parsed, lines: filterLines(lines, drill.filter), unread }
}

const hereOf = (env: SlotEnv, m: Model): Here => ({ column: env.ui.column, phaseAgents: env.phase?.agents.length ?? 0, hasAgent: env.agent !== null, isRuflo: env.agent?.ruflo !== undefined, calls: m.parsed?.calls.length ?? 0, lines: m.lines.length })

/** Loads what the level now in front needs and is not in memory, when the host is bound. Nothing here runs from a draw. */
function ensureLoaded(env: SlotEnv, drill: Drill): void {
  const agent = env.agent
  const run = env.run

  if (!isBound() || !drill.open || (drill.level !== 'agent' && drill.level !== 'item') || agent === null || run === null || agent.ruflo !== undefined) return

  const state = env.ctx.state

  if (textOf(state.cache, agent) === null && agent.transcriptPath !== undefined && noteOf(agent.transcriptPath) === undefined) void loadTranscript(agent)
  if (drill.sub === 'result' && resultOf(run, agent) === undefined && noteOf(`${run.id}/${agent.id}`) === undefined) void loadResult(run, agent)
  if (drill.sub === 'files' && agent.worktreePath !== undefined && noteOf(agent.worktreePath) === undefined) void loadDiff(agent)
}

/** Stores a step, tells the page's cursor what it must (`h l j k [ ]`), and redraws. */
function commit(env: SlotEnv, step: Step, keys: readonly PageKey[] = step.ui === undefined ? [] : [step.ui]): void {
  const state = env.ctx.state
  const wf = env.ctx.act.workflows

  drills.set(state, step.drill)
  if (step.said === undefined) said.delete(state)
  else said.set(state, step.said)

  if (keys.length === 0) wf.setUi({})
  else for (const key of keys) wf.key(key)

  ensureLoaded(env, step.drill)
}

type Verb = 'in' | 'out' | 'next' | 'prev' | 'sub' | 'follow' | 'filter' | 'scope' | 'search'

/** What the keys do, by name; the registered hotkeys, the buttons and `drillKey` all come here. */
export function drillKey(env: SlotEnv, verb: Verb): void {
  const m = modelOf(env)
  const here = hereOf(env, m)
  const d = m.drill

  switch (verb) {
    case 'in':
      return commit(env, deeper(d, here))
    case 'out':
      return commit(env, shallower(d))
    case 'next':
    case 'prev': {
      const step = move(d, verb === 'next' ? 1 : -1, here)
      // The page moves a phase or an agent by its column: say which column first.
      const keys: PageKey[] = step.ui === undefined ? [] : d.level === 'phases' ? ['h', step.ui] : d.level === 'agents' ? ['l', step.ui] : [step.ui]

      return commit(env, step, keys)
    }
    case 'sub':
      return commit(env, { drill: nextSub(d) })
    case 'follow':
      return commit(env, { drill: { ...d, follow: !d.follow } })
    case 'filter':
      return commit(env, { drill: { ...d, filter: nextFilter(d.filter), logSel: 0 } })
    case 'scope':
      return commit(env, { drill: { ...d, scope: d.scope === 'agent' ? 'phase' : 'agent', logSel: 0 } })
    case 'search':
      commit(env, { drill: { ...d, isSearching: true } })
      env.ctx.act.focus('wf-search')
  }
}

/** Goes to a search hit: the page's cursor, then the drill's place. */
export function jumpTo(env: SlotEnv, target: Target): void {
  const wf = env.ctx.act.workflows
  const next = jump(drillOf(env.ctx.state), target, '')
  const run = env.runs[target.run]
  const agent = run?.phases[target.phase]?.agents[target.agent]

  drills.set(env.ctx.state, { ...next.drill, at: run === undefined ? '' : `${run.id}/${agent?.id ?? ''}` })
  said.delete(env.ctx.state)
  wf.setUi(next.ui)
  wf.tab('detail')
  ensureLoaded({ ...env, run: run ?? null, phase: run?.phases[target.phase] ?? null, agent: agent ?? null }, next.drill)
}

/** Keeps the search text the person typed (the field's own value), and redraws. */
export function setQuery(env: SlotEnv, query: string): void {
  drills.set(env.ctx.state, { ...sync(drillOf(env.ctx.state), keyOf(env)), query: query.slice(0, 80) })
  env.ctx.act.workflows.setUi({})
}

const opsOf = (env: SlotEnv, m: Model): Ops => ({
  sub: (sub: Sub) => commit(env, { drill: { ...m.drill, sub, scroll: 0, level: m.drill.level === 'item' ? 'agent' : m.drill.level } }),
  follow: () => drillKey(env, 'follow'),
  filter: () => drillKey(env, 'filter'),
  scope: () => drillKey(env, 'scope'),
  scroll: by => commit(env, { drill: { ...m.drill, scroll: Math.max(0, m.drill.scroll + by) } }),
})

/**
 * The breadcrumb: each level so far as a button that goes back to it, the level you are on in bold. It folds its middle crumbs before it
 * wraps (`Runs › … › Agent: x`), keeps the last crumb whole, and leaves the sub-tab (Activity, Log, Files, Result) to the tab row below it.
 */
function breadcrumb(env: SlotEnv, m: Model): RenderElement {
  const { ctx } = env
  const names: Record<DrillLevel, string> = {
    runs: `: ${clip(env.run?.name ?? '—', 16)}`,
    phases: `: ${clip(env.phase?.title ?? '—', 16)}`,
    agents: '',
    agent: `: ${clip(env.agent?.label ?? '—', 20)}`,
    item: m.drill.sub === 'log' ? `: line ${m.drill.follow ? m.lines.length : m.drill.logSel + 1}` : `: call ${m.drill.callSel + 1}`,
  }

  return crumbRow(ctx, crumbs(m.drill).map(crumb => ({ key: `wf-crumb-${crumb.level}`, label: `${LEVEL_NAME[crumb.level]}${names[crumb.level]}`, isHere: crumb.isHere, onPress: () => commit(env, toLevel(m.drill, crumb.level)) })), 'wf-crumbs', { here: label => ctx.kit.Text({ bold: true, color: THEME.head, wrap: 'truncate-end', children: label }) })
}

function list(env: SlotEnv, m: Model): RenderElement[] {
  const { ctx } = env
  const rows: RenderElement[] = []
  const win = <T,>(items: readonly T[], at: number): { from: number; shown: readonly T[] } => {
    const from = Math.max(0, Math.min(items.length - 8, at - 7))

    return { from, shown: items.slice(from, from + 8) }
  }

  if (m.drill.level === 'runs') {
    const w = win(env.runs, env.ui.run)

    for (const [i, run] of w.shown.entries()) rows.push(text(ctx, `${w.from + i === env.ui.run ? '▸' : ' '} ${clip(run.name, 30)}  ${run.state} · ${run.total} agents · ${run.kind === 'workflow' ? (run.totalTokens === null ? 'tokens n/a' : `${fmtTokens(run.totalTokens, run.isTokensPartial)} tok`) : 'ruflo swarm'}`, w.from + i === env.ui.run ? { bold: true } : {}))
    if (env.runs.length > 8) rows.push(text(ctx, `${env.runs.length} runs: m w move`, { dimColor: true }))
  } else if (m.drill.level === 'phases' && env.run !== null) {
    const w = win(env.run.phases, env.ui.phase)

    for (const [i, phase] of w.shown.entries()) rows.push(text(ctx, `${w.from + i === env.ui.phase ? '▸' : ' '} ${clip(`${w.from + i + 1} ${phase.title}`, 30)}  ${phase.done}/${phase.total} done${phase.running > 0 ? ` · ${phase.running} running` : ''}${phase.failed > 0 ? ` · ${phase.failed} failed` : ''}`, w.from + i === env.ui.phase ? { bold: true } : {}))
  } else if (m.drill.level === 'agents' && env.phase !== null) {
    const w = win(env.phase.agents, env.ui.agent)

    for (const [i, agent] of w.shown.entries()) rows.push(text(ctx, `${w.from + i === env.ui.agent ? '▸' : ' '} ${clip(agent.label, 30)}  ${agent.state} · ${agent.toolCalls === undefined ? 'calls n/a' : `${agent.toolCalls} calls`} · ${fmtElapsed(agent.elapsedMs)}`, w.from + i === env.ui.agent ? { bold: true } : {}))
    if (env.phase.agents.length === 0) rows.push(text(ctx, 'No agent has started in this phase yet.', { dimColor: true }))
  }

  return rows
}

const HOT: Partial<Record<Verb, string>> = {}

const hint = (verb: Verb, what: string): string => `${HOT[verb] ?? '·'} ${what}`

/** The board slot: collapsed to a hint line until opened. */
function panel(env: SlotEnv): RenderElement[] {
  const { ctx } = env
  const m = modelOf(env)
  const msg = said.get(ctx.state)

  if (!m.drill.open) {
    return [
      ...flow(ctx, [{ key: 'wf-drill-open', label: 'Drill into this run', onPress: () => drillKey(env, 'in') }], 'wf-drill-open-row'),
      text(ctx, ` ${hint('in', 'deeper')} · ${hint('search', 'search')} — runs › phases › agents › one agent (activity, log, files, result) › one call`, { dimColor: true }),
      ...(msg === undefined ? [] : [text(ctx, msg, { color: THEME.warn })]),
    ]
  }

  const ops = opsOf(env, m)
  const body: RenderElement[] =
    m.drill.level === 'agent' && env.run !== null && env.agent !== null
      ? agentBody(ctx, env.run, env.agent, m, ops)
      : m.drill.level === 'item' && env.agent !== null
        ? itemBody(ctx, env.agent, m, ops)
        : list(env, m)

  return [
    breadcrumb(env, m),
    ...flow(ctx, [
      { key: 'wf-drill-in', label: '▸ deeper', onPress: () => drillKey(env, 'in') },
      { key: 'wf-drill-out', label: m.drill.level === 'runs' ? '✕ close' : '◂ back', onPress: () => drillKey(env, 'out') },
      { key: 'wf-drill-prev', label: '▴ prev', onPress: () => drillKey(env, 'prev') },
      { key: 'wf-drill-next', label: '▾ next', onPress: () => drillKey(env, 'next') },
    ], 'wf-drill-moves'),
    ...(msg === undefined ? [] : [text(ctx, msg, { color: THEME.warn })]),
    col(ctx, body, 'wf-drill-body'),
    text(ctx, `keys: ${hint('in', 'deeper')} · ${hint('out', 'back')} · ${hint('next', 'next')} · ${hint('prev', 'prev')} · ${hint('sub', 'next tab')} · ${hint('follow', 'follow')} · ${hint('filter', 'level')} · ${hint('search', 'search')}`, { dimColor: true }),
  ]
}

/** Each key tries its letters in turn: another feature may have taken one, and a slot is refused (not thrown) for a taken key. */
const KEYS: readonly { verb: Verb; label: string; letters: string }[] = [
  { verb: 'in', label: '▸ deeper', letters: 'ge' },
  { verb: 'out', label: '◂ back', letters: 'zq' },
  { verb: 'next', label: '▾ next', letters: 'mc' },
  { verb: 'prev', label: '▴ prev', letters: 'wa' },
  { verb: 'sub', label: 'tab ▸', letters: 'tqv' },
  { verb: 'follow', label: 'follow', letters: 'fs' },
  { verb: 'filter', label: 'level', letters: 'vy' },
  { verb: 'search', label: 'search', letters: 'sk0123456789' },
]

/** Registers the panel and its keys. Returns what was refused and why (empty when all went in), for a test or the merge owner to see. */
export function registerDrill(): { verb: string; why: string }[] {
  const refused: { verb: string; why: string }[] = []

  const board = registerSlot({ kind: 'board', id: 'drill', title: 'Drill-down', order: 10, render: panel })

  if (!board.ok) refused.push({ verb: 'panel', why: board.why })

  for (const key of KEYS) {
    let last = 'no letter left'

    for (const letter of key.letters) {
      const done = registerSlot({ kind: 'key', id: `drill-${key.verb}`, key: letter, label: key.label, run: env => drillKey(env, key.verb) })

      if (done.ok) {
        HOT[key.verb] = letter
        last = ''
        break
      }

      last = done.why
      if (last.includes('already registered')) break
    }

    if (last !== '') refused.push({ verb: key.verb, why: last })
  }

  registerSlot({
    kind: 'notice',
    id: 'drill-follow',
    // A page read just finished: a followed log of a transcript too large to hold whole is read again (its tail), once per read, never otherwise.
    between: () => {
      const d = boundState === null ? null : drillOf(boundState)

      if (d !== null && d.open && d.follow && d.sub === 'log' && (d.level === 'agent' || d.level === 'item')) void reloadTails()

      return []
    },
  })

  return refused
}

export const hotkeyOf = (verb: Verb): string | undefined => HOT[verb]
