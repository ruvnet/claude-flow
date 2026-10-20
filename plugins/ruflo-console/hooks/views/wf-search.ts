/**
 * The search box of the Workflows drill-down (ADR-459), a board slot under the drill panel. One field searches every level at once:
 * run names, phase titles, agent labels, tool calls, transcript text and, where the project has them, mission tasks. Hits are listed
 * by level, and a hit (a click, or Enter in the field for the first) jumps to the exact place: the run, phase and agent under the
 * cursor, then the sub-tab and the call or line. It looks only through what is in memory and says how much that was, what was left
 * unread, and the cap; a button reads the run's transcripts when the host is bound.
 */
import type { RenderElement } from 'claude-code'

import { MAX_QUERY, flatHits, HIT_NAME, HIT_ORDER, MAX_SHOWN, MIN_QUERY, SCAN_CHARS, search, type Hit, type MissionTaskRef, type SearchResult } from '../data/wf-search'
import { isBound, LOAD_BUDGET, loadRun, parsedOf, textOf } from '../data/wf-drill-io'
import { button, clip, col, text, THEME } from './common'
import { drillOf, jumpTo, setQuery } from './wf-detail'
import { flow } from './wf-layout'
import { registerSlot, type SlotEnv } from './wf-slots'

const memo = new WeakMap<object, { query: string; runs: number; tasks: number; texts: (string | null)[]; tails: boolean[]; result: SearchResult }>()

const tasksOf = (env: SlotEnv): MissionTaskRef[] =>
  (env.ctx.state.snapshot?.missions?.missions ?? []).flatMap(mission => mission.plan.tasks.map(task => ({ mission: mission.objective, id: task.id, title: task.title, status: task.status }))).slice(0, 400)

/**
 * The search for this frame, kept while the query, the runs and the transcript TEXT in memory are the same (a frame is drawn far more often than any of
 * them changes). The text is compared by identity, agent by agent: the read cache hands back the very same string while a file is unchanged, so
 * this is one pointer test each and nothing is parsed to find out that nothing changed. Parsing happens inside `search`, lazily, only as far as its scan cap goes.
 */
export function resultOf(env: SlotEnv, query: string): SearchResult {
  // A query too short to search looks at nothing, so nothing is read or summed for it: the box is drawn on every frame, and most frames have no query.
  if (query.trim().slice(0, MAX_QUERY).length < MIN_QUERY) return search({ runs: [], parsed: () => null }, query)

  const cache = env.ctx.state.cache
  const agents = env.runs.flatMap(run => run.phases.flatMap(phase => phase.agents))
  const held = agents.map(agent => (agent.ruflo === undefined ? textOf(cache, agent) : null))
  const texts = held.map(entry => entry?.text ?? null)
  const tails = held.map(entry => entry?.isTail === true)
  const tasks = tasksOf(env)
  const last = memo.get(env.ctx.state)

  if (last !== undefined && last.query === query && last.runs === env.runs.length && last.tasks === tasks.length && last.texts.length === texts.length && texts.every((text, i) => text === last.texts[i] && tails[i] === last.tails[i])) return last.result

  const index = new Map(agents.map((agent, i) => [agent, i] as const))
  const result = search({ runs: env.runs, parsed: agent => (agent.ruflo === undefined ? parsedOf(cache, agent) : null), isHeld: agent => texts[index.get(agent) ?? -1] != null, tasks }, query)

  memo.set(env.ctx.state, { query, runs: env.runs.length, tasks: tasks.length, texts, tails, result })

  return result
}

const mark = (hit: Hit): string => (hit.target === undefined ? '↗' : '▸')

function hitButton(env: SlotEnv, hit: Hit, i: number): RenderElement {
  const { ctx } = env

  return button(ctx, `wf-hit-${hit.level}-${i}`, `${mark(hit)} ${clip(hit.title, Math.max(14, Math.floor(ctx.columns / 2) - 4))}  ${clip(hit.detail, Math.max(10, Math.floor(ctx.columns / 2) - 8))}`, () => (hit.target === undefined ? ctx.act.view('missions') : jumpTo(env, hit.target)))
}

/** The board slot's rows. */
export function searchPanel(env: SlotEnv): RenderElement[] {
  const { ctx } = env
  const drill = drillOf(ctx.state)
  const Input = ctx.kit.Input

  if (Input === undefined) return [text(ctx, 'Search needs a text field, which this surface does not have.', { dimColor: true })]

  const result = resultOf(env, drill.query)
  const first = flatHits(result).find(hit => hit.target !== undefined)
  const rows: RenderElement[] = [
    Input({ key: 'wf-search', label: 'search', value: drill.query, placeholder: `${MIN_QUERY}+ characters: a run, label, tool call, transcript text or mission task`, submitLabel: 'go', onInput: (value: string) => setQuery(env, value), onSubmit: (value: string) => {
      setQuery(env, value)

      const hit = flatHits(resultOf(env, value.trim().slice(0, MAX_QUERY))).find(entry => entry.target !== undefined)

      if (hit?.target !== undefined) jumpTo(env, hit.target)
    } }),
  ]

  if (!result.isSearched) return [...rows, text(ctx, drill.query.trim() === '' ? 'Type to search every level at once; Enter jumps to the first hit.' : `Type at least ${MIN_QUERY} characters.`, { dimColor: true })]

  const total = HIT_ORDER.reduce((sum, level) => sum + result.counts[level], 0)

  rows.push(text(ctx, total === 0 ? `No match for "${clip(result.query, 40)}".` : `${total} matches · Enter in the field goes to ${first === undefined ? 'none with a place' : 'the first'}`, total === 0 ? { color: THEME.warn } : { dimColor: true }))

  for (const level of HIT_ORDER) {
    const hits = result.groups[level]

    if (hits.length === 0) continue

    rows.push(text(ctx, `${HIT_NAME[level]} (${result.counts[level]}${result.counts[level] > MAX_SHOWN ? `, first ${MAX_SHOWN} shown` : ''})`, { bold: true }))
    for (const [i, hit] of hits.entries()) rows.push(hitButton(env, hit, i))
  }

  rows.push(text(ctx, `looked through ${result.scanned} agents' transcripts (${result.chars.toLocaleString('en-US')} characters of ${SCAN_CHARS.toLocaleString('en-US')} cap)${result.isCapped ? ' · the cap stopped the scan' : ''}`, { dimColor: true }))

  if (result.unread > 0) rows.push(text(ctx, `${result.unread} agents' transcripts are not in memory, so they were not searched`, { color: THEME.warn }))

  if (result.unread > 0 && env.run !== null) {
    const run = env.run

    rows.push(...(isBound() ? flow(ctx, [{ key: 'wf-search-load', label: `Read this run's transcripts (up to ${(LOAD_BUDGET / 1_000_000).toFixed(0)} MB in all)`, onPress: () => void loadRun(run).then(() => ctx.act.workflows.setUi({})) }], 'wf-search-load-row') : [text(ctx, 'Reading them on demand needs the drill bound to the host (ADR-459).', { dimColor: true })]))
  }

  return [col(ctx, rows, 'wf-search-panel')]
}

/** Registers the search slot; returns why it was refused, or null. */
export function registerSearch(): string | null {
  const done = registerSlot({ kind: 'board', id: 'drill-search', title: 'Search', order: 11, render: searchPanel })

  return done.ok ? null : done.why
}
