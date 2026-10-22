/**
 * What the drill-down draws from one agent down (ADR-459): the four sub-tabs (Activity, Log, Files, Result) and one call or message in
 * full. Drawing only: every number comes from the parsed transcript, the journal's result or the worktree probe, and where a source has
 * not been read the page says which and offers the button that reads it (or says the host binding that would is not attached).
 * The caps in force are printed beside what they cut: the transcript read cap, the characters kept per field, the rows on screen.
 */
import type { RenderElement } from 'claude-code'

import { durationOf, fmtSpan, FIELD_CAP, ENTRY_CAP, type CallEntry, type Capped, type Entry, type Parsed } from '../data/wf-activity'
import { diffOf, isBound, loadDiff, loadResult, loadTranscript, noteOf, resultOf, textOf } from '../data/wf-drill-io'
import { clockOf, tailWindow, type LogLine } from '../data/wf-log'
import { SUBS, SUB_NAME, type Drill, type Sub } from '../data/wf-trail'
import { TAIL_BYTES, TRANSCRIPT_CAP } from '../data/workflows-read'
import { fmtTokens, type WfAgent, type WfRun } from '../data/workflows'
import { button, clip, row, text, THEME, type Ctx } from './common'
import { buttonWidth, flow } from './wf-layout'
import type { LevelFilter } from '../data/wf-log'

export type Model = { drill: Drill; parsed: Parsed | null; lines: LogLine[]; /** Phase scope: agents of the phase whose transcript is not in memory. */ unread: number }

/** What the body can ask the panel to do. */
export type Ops = { sub: (sub: Sub) => void; follow: () => void; filter: () => void; scope: () => void; scroll: (by: number) => void }

const mb = (bytes: number): string => (bytes < 100_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`)
const cap = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`
const ROWS = 10
const ITEM_ROWS = 20
const CALL_MARK = { ok: '✔', error: '✖', pending: '…' } as const
const CALL_COLOR = { ok: THEME.ok, error: THEME.bad, pending: THEME.warn } as const
const FILTER_WORD: Record<LevelFilter, string> = { all: 'all lines', text: 'messages', tool: 'tool calls', error: 'errors only' }

/** A line the page says in place of a source it has not got: why, and the button that gets it (or why there is none). */
function unread(ctx: Ctx, what: string, path: string | undefined, load: () => void): RenderElement[] {
  const note = path === undefined ? undefined : noteOf(path)
  const why = note?.phase === 'failed' ? ` (${note.why ?? 'the read failed'})` : note?.phase === 'loading' ? ' (reading…)' : ''

  return [
    text(ctx, `${what} is not in memory${why}.`, { color: THEME.warn }),
    ...(isBound()
      ? flow(ctx, [{ key: 'wf-drill-load', label: note?.phase === 'loading' ? 'reading…' : `Read it (up to ${cap(TRANSCRIPT_CAP)}; the last ${Math.round(TAIL_BYTES / 1000)} KB of a larger file)`, onPress: load }], 'wf-drill-load-row')
      : [text(ctx, 'The page reads a live run\'s transcripts as it refreshes; a finished run\'s figures come from its record, so they are not read. Reading them on demand needs the drill bound to the host (ADR-459).', { dimColor: true })]),
  ]
}

/** The tab row of one agent: Activity, Log, Files, Result on a row of their own, wrapping rather than overrunning a narrow pane. */
function subTabs(ctx: Ctx, drill: Drill, ops: Ops): RenderElement[] {
  return flow(ctx, SUBS.map(sub => ({ key: `wf-sub-${sub}`, label: `${drill.sub === sub ? '●' : '○'} ${SUB_NAME[sub]}`, onPress: () => ops.sub(sub) })), 'wf-subs', 'view ')
}

const sourceLine = (ctx: Ctx, agent: WfAgent, parsed: Parsed, cache: Ctx['state']['cache']): RenderElement => {
  const read = textOf(cache, agent)
  const bytes = read === null ? 0 : read.text.length
  const how = parsed.isTail ? `the last ${Math.round(TAIL_BYTES / 1000)} KB of a file over the ${cap(TRANSCRIPT_CAP)} read cap (earlier calls are not here)` : `whole file, ${mb(bytes)} of the ${cap(TRANSCRIPT_CAP)} read cap`

  return text(ctx, `transcript: ${how} · ${parsed.entries.length} entries${parsed.dropped > 0 ? ` (newest ${ENTRY_CAP} of ${parsed.entries.length + parsed.dropped})` : ''} · ${parsed.calls.length} tool calls`, { dimColor: true })
}

function activity(ctx: Ctx, m: Model, agent: WfAgent): RenderElement[] {
  const parsed = m.parsed

  if (parsed === null) return []
  if (parsed.calls.length === 0) return [text(ctx, 'No tool call in the part of the transcript read.', { dimColor: true })]

  const sel = Math.max(0, Math.min(parsed.calls.length - 1, m.drill.callSel))
  const from = Math.max(0, Math.min(parsed.calls.length - ROWS, sel - ROWS + 1))
  const first = parsed.calls[0] as CallEntry
  const origin = first.atMs
  const rows: RenderElement[] = parsed.calls.slice(from, from + ROWS).map(call => {
    const here = call.callIndex === sel
    const at = origin === undefined || call.atMs === undefined ? '     ' : `+${fmtSpan(call.atMs - origin)}`.padEnd(7)

    return row(ctx, [
      ctx.kit.Text({ ...(here && { bold: true }), children: `${here ? '▸' : ' '}#${String(call.callIndex + 1).padEnd(3)}` }),
      ctx.kit.Text({ color: CALL_COLOR[call.status], children: `${CALL_MARK[call.status]} ` }),
      ctx.kit.Text({ ...(here && { bold: true }), wrap: 'truncate-end', children: clip(`${call.tool.padEnd(10)} ${call.summary}`, Math.max(12, ctx.columns - 26)) }),
      ctx.kit.Text({ dimColor: true, children: ` ${at}${fmtSpan(durationOf(call)).padStart(6)}` }),
    ])
  })

  return [...rows, text(ctx, `${from > 0 ? `${from} earlier · ` : ''}${Math.max(0, parsed.calls.length - from - ROWS)} later · call ${sel + 1} of ${parsed.calls.length} · ${agent.toolCalls !== undefined && agent.toolCalls !== parsed.calls.length ? `the run says ${agent.toolCalls} in all · ` : ''}open it for the full input and output`, { dimColor: true })]
}

function log(ctx: Ctx, m: Model, ops: Ops, isPhase: boolean): RenderElement[] {
  const window = tailWindow(m.lines, { sel: m.drill.logSel, follow: m.drill.follow })
  const head = flow(ctx, [
    { key: 'wf-log-follow', label: m.drill.follow ? '● following' : '○ follow', onPress: ops.follow },
    { key: 'wf-log-filter', label: `level: ${FILTER_WORD[m.drill.filter]}`, onPress: ops.filter },
    { key: 'wf-log-scope', label: isPhase ? 'scope: whole phase' : 'scope: this agent', onPress: ops.scope },
  ], 'wf-log-head')

  if (window.total === 0) return [...head, text(ctx, m.drill.filter === 'all' ? 'No line in the part of the transcript read.' : `No ${FILTER_WORD[m.drill.filter]} among the lines read: change the level.`, { dimColor: true })]

  const rows = window.rows.map((line, i) => {
    const here = i === window.at

    return row(ctx, [
      ctx.kit.Text({ ...(here && { bold: true }), children: `${here ? '▸' : ' '}${clockOf(line.atMs)} ` }),
      ctx.kit.Text({ color: line.level === 'error' ? THEME.bad : line.level === 'tool' ? THEME.info : line.level === 'assistant' ? THEME.ok : undefined, dimColor: line.level === 'thinking' || line.level === 'user', children: `${line.level.slice(0, 4).padEnd(5)}` }),
      ...(isPhase ? [ctx.kit.Text({ dimColor: true, children: `${clip(line.agent, 14).padEnd(15)}` })] : []),
      ctx.kit.Text({ ...(here && { bold: true }), wrap: 'truncate-end', children: clip(line.text, Math.max(12, ctx.columns - (isPhase ? 38 : 22))) }),
    ])
  })

  return [
    ...head,
    ...rows,
    text(ctx, `${window.above} above · ${window.below} below · line ${window.from + window.at + 1} of ${window.total}${m.unread > 0 ? ` · ${m.unread} agents of the phase not in memory` : ''}`, { dimColor: true }),
    text(ctx, 'follow pins the newest line and is re-drawn on this page\'s refresh; it is not a stream', { dimColor: true }),
  ]
}

function files(ctx: Ctx, m: Model, agent: WfAgent): RenderElement[] {
  const parsed = m.parsed
  const diff = diffOf(agent)
  const wt = agent.worktreePath
  const note = wt === undefined ? undefined : noteOf(wt)
  const rel = (path: string): string => (wt !== undefined && path.startsWith(`${wt}/`) ? path.slice(wt.length + 1) : path)
  const rows: RenderElement[] = []

  if (wt === undefined) rows.push(text(ctx, agent.hasWorktree ? 'The agent ran in a worktree whose path its metadata does not name: no diff stat.' : 'This agent has no worktree, so there is no diff stat: the list below is only the files its tool inputs name.', { dimColor: true }))
  else if (diff !== undefined) rows.push(text(ctx, `worktree ${clip(wt, Math.max(20, ctx.columns - 40))} · ${diff.files.size + diff.extra} changed files vs HEAD (tracked files only; \`git diff --numstat\`)`, { dimColor: true }))
  else if (!isBound()) rows.push(text(ctx, `worktree ${clip(wt, Math.max(20, ctx.columns - 10))}`, { dimColor: true }), text(ctx, 'diff stat: n/a (host not bound)', { dimColor: true }))
  else {
    // The path takes what the button leaves, then one space, then the button: the two never touch.
    const label = note?.phase === 'loading' ? 'reading…' : 'Read diff stat'

    rows.push(row(ctx, [text(ctx, `worktree ${clip(wt, Math.max(12, ctx.columns - buttonWidth(label) - 11))} `, { dimColor: true }), button(ctx, 'wf-diff-load', label, () => void loadDiff(agent))], 'wf-diff-row'))
  }

  if (note?.phase === 'failed' || note?.phase === 'none') rows.push(text(ctx, `diff stat not read: ${note.why ?? 'failed'}`, { color: THEME.warn }))

  const touched = parsed?.files ?? []
  const named = new Set(touched.map(file => rel(file.path)))

  for (const file of touched.slice(0, 14)) {
    const stat = diff?.files.get(rel(file.path))
    const ops = `${file.edit > 0 ? `edit×${file.edit} ` : ''}${file.write > 0 ? `write×${file.write} ` : ''}${file.read > 0 ? `read×${file.read}` : ''}`.trim()

    rows.push(row(ctx, [
      ctx.kit.Text({ dimColor: file.edit + file.write === 0, wrap: 'truncate-end', children: ` ${clip(file.path, Math.max(14, ctx.columns - 38))} ` }),
      ctx.kit.Text({ dimColor: true, children: ops.padEnd(18) }),
      ...(stat === undefined ? [] : [ctx.kit.Text({ color: THEME.ok, children: stat.add === null ? ' bin' : ` +${stat.add}` }), ctx.kit.Text({ color: THEME.bad, children: stat.del === null ? '' : ` -${stat.del}` })]),
    ]))
  }

  if (touched.length === 0) rows.push(text(ctx, 'No tool input names a file in the part of the transcript read.', { dimColor: true }))
  if (touched.length > 14) rows.push(text(ctx, `+${touched.length - 14} more files named`, { dimColor: true }))

  if (diff !== undefined) {
    const others = [...diff.files].filter(([path]) => !named.has(path))

    if (others.length > 0) rows.push(text(ctx, `also changed in the worktree, not named by a tool input (e.g. by a shell command): ${others.slice(0, 5).map(([path, s]) => `${clip(path, 40)} +${s.add ?? '·'} -${s.del ?? '·'}`).join(', ')}${others.length > 5 ? ` +${others.length - 5} more` : ''}`, { dimColor: true }))
  }

  return rows
}

function result(ctx: Ctx, run: WfRun, agent: WfAgent): RenderElement[] {
  const held = resultOf(run, agent)
  const note = noteOf(`${run.id}/${agent.id}`)

  if (held === undefined) {
    return [
      ...(agent.resultPreview !== undefined ? [text(ctx, `preview: ${agent.resultPreview}`, { dimColor: true })] : []),
      ...unread(ctx, 'The agent\'s return', `${run.id}/${agent.id}`, () => void loadResult(run, agent)).slice(0, 1),
      ...(isBound() ? flow(ctx, [{ key: 'wf-result-load', label: note?.phase === 'loading' ? 'reading…' : 'Read the journal (up to 1.0 MB)', onPress: () => void loadResult(run, agent) }], 'wf-result-load-row') : [text(ctx, 'Reading the journal needs the drill bound to the host (ADR-459).', { dimColor: true })]),
    ]
  }

  if (held === 'none') return [text(ctx, agent.state === 'done' ? 'The journal holds no result for this agent.' : `No result yet: the agent is ${agent.state}.`, { dimColor: true })]

  return blockRows(ctx, 'result', held, 0, ITEM_ROWS).rows
}

/** A washed block as screen rows: `max` lines from line `from`, hard-wrapped to the width; and how many lines the block has. */
export function blockRows(ctx: Ctx, title: string, block: Capped, from: number, max: number): { rows: RenderElement[]; total: number } {
  const width = Math.max(20, ctx.columns - 4)
  const lines = block.text.split('\n').flatMap(line => (line.length <= width ? [line] : (line.match(new RegExp(`.{1,${width}}`, 'g')) ?? [line])))
  const shown = lines.slice(from, from + max)
  const rows: RenderElement[] = [text(ctx, `${title} · ${block.isCut ? `first ${block.text.length.toLocaleString('en-US')} of ${block.total.toLocaleString('en-US')} characters (cap ${FIELD_CAP.toLocaleString('en-US')})` : `${block.total.toLocaleString('en-US')} characters`} · lines ${Math.min(from + 1, lines.length)}–${from + shown.length} of ${lines.length}`, { bold: true })]

  for (const line of shown) rows.push(ctx.kit.Text({ wrap: 'truncate-end', children: `  ${line}` }))

  return { rows, total: lines.length }
}

/** The sub-tab rows of one agent. */
export function agentBody(ctx: Ctx, run: WfRun, agent: WfAgent, m: Model, ops: Ops): RenderElement[] {
  const rows: RenderElement[] = [...subTabs(ctx, m.drill, ops)]
  const tokens = agent.tokens === undefined ? '' : ` · ${fmtTokens(agent.tokens, agent.isTokensPartial)} tok`

  rows.push(text(ctx, `${agent.label} · ${agent.state}${tokens}${agent.model === undefined ? '' : ` · ${agent.model}`}`, { dimColor: true }))

  if (agent.ruflo !== undefined) return [...rows, text(ctx, 'A ruflo agent keeps no transcript, worktree or return: its row on the board is everything the store records.', { dimColor: true })]

  if (m.drill.sub === 'files' || m.drill.sub === 'result') {
    if (m.parsed !== null) rows.push(sourceLine(ctx, agent, m.parsed, ctx.state.cache))

    return [...rows, ...(m.drill.sub === 'files' ? files(ctx, m, agent) : result(ctx, run, agent))]
  }

  if (m.parsed === null && !(m.drill.sub === 'log' && m.drill.scope === 'phase' && m.lines.length > 0)) return [...rows, ...unread(ctx, 'This agent\'s transcript', agent.transcriptPath, () => void loadTranscript(agent))]

  if (m.parsed !== null) rows.push(sourceLine(ctx, agent, m.parsed, ctx.state.cache))

  return [...rows, ...(m.drill.sub === 'activity' ? activity(ctx, m, agent) : log(ctx, m, ops, m.drill.scope === 'phase'))]
}

const KIND = (entry: Entry): string => (entry.kind === 'call' ? `tool call ${entry.tool}` : `${entry.role} message`)

/** One call or message in full: its input and output (calls), or its text, washed and capped, scrolled by the person. */
export function itemBody(ctx: Ctx, agent: WfAgent, m: Model, ops: Ops): RenderElement[] {
  const parsed = m.parsed
  const line = m.drill.sub === 'log' ? m.lines[Math.max(0, Math.min(m.lines.length - 1, m.drill.logSel))] : undefined

  if (line !== undefined && line.agentId !== agent.id) return [text(ctx, `That line is from agent ${line.agent}: go back to Agents and open that agent to see it in full.`, { dimColor: true })]

  const entry: Entry | undefined = parsed === null ? undefined : line !== undefined ? parsed.entries[line.entry] : m.drill.sub === 'log' ? undefined : parsed.calls[Math.max(0, Math.min(parsed.calls.length - 1, m.drill.callSel))]

  if (entry === undefined) return [text(ctx, 'Nothing is selected: go back and pick a call or a line.', { dimColor: true })]

  const rows: RenderElement[] = [text(ctx, `${KIND(entry)} · #${entry.index + 1} of ${parsed?.entries.length ?? 0} · ${clockOf(entry.atMs)}${entry.kind === 'call' ? ` · ${entry.status} · ${fmtSpan(durationOf(entry))}` : ''}`, { bold: true })]
  const blocks: [string, Capped][] = entry.kind === 'call' ? [['input', entry.input], ...(entry.output === null ? [] : ([['output', entry.output]] as [string, Capped][]))] : [['text', entry.body]]
  let from = m.drill.scroll
  let budget = ITEM_ROWS
  let total = 0

  for (const [title, block] of blocks) {
    const drawn = blockRows(ctx, title, block, Math.max(0, from), budget)

    total += drawn.total
    rows.push(...drawn.rows)
    from -= drawn.total
    budget = Math.max(2, budget - (drawn.rows.length - 1))
  }

  if (entry.kind === 'call' && entry.output === null) rows.push(text(ctx, entry.status === 'pending' ? 'No result for this call in the part of the transcript read (it may still be running, or lie before the tail).' : 'No output.', { dimColor: true }))

  rows.push(row(ctx, [button(ctx, 'wf-item-up', '▴ up', () => ops.scroll(-ITEM_ROWS / 2)), button(ctx, 'wf-item-down', '▾ down', () => ops.scroll(ITEM_ROWS / 2)), text(ctx, ` ${total} lines in all`, { dimColor: true })], 'wf-item-scroll'))

  return rows
}
