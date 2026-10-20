import type { RenderElement } from 'claude-code'

import { targetOf, type VectorField } from '../data/vector'
import { VEC, VEC_SECTIONS, vecSpec, type VecCost, type VecEntry, type VecSection } from '../vector'
import { slot } from './attention'
import { ago, button, clip, type Ctx, row, rule, tagChip, text, THEME } from './common'
import { frameResult } from './status-card'

/** Result lines in view at once; j/k scroll the rest. */
export const VEC_ROWS = 12

/** Each cost as a four-cell tag: $0 reads, local writes, network asks, publishing, spending and deleting. */
const TAG: Record<VecCost, { text: string; color: () => string }> = {
  read: { text: ' $0 ', color: () => THEME.ok },
  writes: { text: ' wr ', color: () => THEME.info },
  net: { text: 'net ', color: () => THEME.warn },
  publish: { text: 'pub ', color: () => THEME.bad },
  spends: { text: ' $$ ', color: () => THEME.bad },
  deletes: { text: 'del ', color: () => THEME.bad },
}

/** Each section's fields: key, label, placeholder, and the entry Enter runs. */
const FIELDS: Partial<Record<VecSection, readonly { field: VectorField; label: string; placeholder: string; submit: string }[]>> = {
  brain: [{ field: 'brain', label: 'brain', placeholder: 'a query · a memory id · a domain · source target · title :: content', submit: 'vec-brain-search' }],
  rvf: [
    { field: 'rvfPath', label: 'store', placeholder: 'path/to/store.rvf (inside this project)', submit: 'vec-rvf-status' },
    { field: 'rvfArg', label: 'with', placeholder: 'query: 0.1,0.2,… · ingest: vectors.json · derive: child.rvf · create: 384', submit: 'vec-rvf-query' },
  ],
  sql: [{ field: 'sql', label: 'query', placeholder: 'SELECT … · MATCH (n) RETURN n · SELECT ?s WHERE { ?s ?p ?o }', submit: 'vec-sql' }],
  decompile: [{ field: 'target', label: 'target', placeholder: './dist/index.js (a file here) · lodash@4.17.21 (an npm package)', submit: 'vec-decompile' }],
  workers: [{ field: 'worker', label: 'ask', placeholder: 'what a background worker should analyse', submit: 'vec-workers-dispatch' }],
  hooks: [{ field: 'task', label: 'task', placeholder: 'a task to route · words to recall · a note to remember', submit: 'vec-hooks-route' }],
}

const RVLITE: Record<string, 'sql' | 'cypher' | 'sparql'> = { 'vec-sql': 'sql', 'vec-cypher': 'cypher', 'vec-sparql': 'sparql' }

/** The text an entry takes: its field's, and for RVF the store followed by the second field. */
function textFor(ctx: Ctx, entry: VecEntry): string {
  const fields = ctx.state.vector

  if (entry.field === undefined) return ''

  return entry.field === 'rvfPath' ? `${fields.rvfPath.trim()} ${fields.rvfArg.trim()}`.trim() : fields[entry.field]
}

/** Enter in a field: the section's first entry, with decompile picking file or package as ruvector reads the target. */
function submit(ctx: Ctx, id: string, field: VectorField, value: string): void {
  ctx.act.vector.draft(field, value)

  if (id in RVLITE) ctx.act.vector.ask(RVLITE[id] as 'sql', value)
  else if (id === 'vec-decompile') ctx.act.vector.run(targetOf(value)?.kind === 'npm' ? 'vec-decompile-pkg' : 'vec-decompile-file', value)
  else ctx.act.vector.run(id, field === 'rvfArg' ? `${ctx.state.vector.rvfPath.trim()} ${value.trim()}` : field === 'rvfPath' ? `${value.trim()} ${ctx.state.vector.rvfArg.trim()}`.trim() : value)
}

/** One entry, dotted to its purpose like the MetaHarness lab: the tag, the name, what it does, and its button. */
function entryRow(ctx: Ctx, entry: VecEntry, lead: number): RenderElement {
  const tag = TAG[entry.cost]
  const kind = RVLITE[entry.id]
  const isNa = entry.na !== undefined && kind === undefined
  const isBlocked = !isNa && kind === undefined && entry.field === undefined && vecSpec(entry, ctx.state) === null
  const action = kind !== undefined ? ' ▸ ask' : isNa ? ' n/a' : entry.cost === 'read' ? ' ▸ run' : ' ▸ asks'

  return row(
    ctx,
    [
      isNa ? ctx.kit.Text({ bold: true, color: THEME.info, dimColor: true, children: ` ${' -- '}` }) : tagChip(ctx, tag.text, tag.color()),
      ctx.kit.Text({ bold: true, color: entry.cost === 'deletes' || entry.cost === 'publish' || entry.cost === 'spends' ? THEME.warn : THEME.head, dimColor: isNa, children: ` ${entry.name} `.padEnd(lead, '.') }),
      ctx.kit.Text({ color: THEME.info, dimColor: isNa || isBlocked, wrap: 'truncate-end', children: clip(` ${isNa ? (entry.na ?? '') : entry.about}`, Math.max(4, ctx.columns - lead - 16)) }),
      isNa
        ? ctx.kit.Text({ dimColor: true, children: action })
        : ctx.kit.Button({ key: entry.id, label: action, plain: true, dimColor: true, onPress: kind !== undefined ? () => ctx.act.vector.ask(kind, ctx.state.vector.sql) : () => ctx.act.vector.run(entry.id, textFor(ctx, entry)) }),
    ],
    `vec-row-${entry.id}`,
  )
}

function fieldRows(ctx: Ctx, section: VecSection): RenderElement[] {
  const fields = FIELDS[section] ?? []
  const Input = ctx.kit.Input

  if (fields.length === 0) return []
  if (Input === undefined) return [text(ctx, ' this surface has no text field: /ruflo run <vec-id> <text> takes the text instead', { dimColor: true })]

  return fields.map(({ field, label, placeholder, submit: id }) =>
    Input({
      key: `vec-in-${field}`,
      label,
      placeholder,
      value: ctx.state.vector[field],
      submitLabel: 'go',
      onInput: value => ctx.act.vector.draft(field, value),
      onSubmit: value => submit(ctx, id, field, value),
    }),
  )
}

/** The last vec- run: what it was, how it exited, its note, and a window of its lines. A MetaHarness run is not shown here. */
function resultRows(ctx: Ctx): RenderElement[] {
  const { state, nowMs } = ctx
  const running = state.lab.running?.id.startsWith('vec-') === true ? state.lab.running : null
  const result = state.lab.result?.id.startsWith('vec-') === true ? state.lab.result : null
  const right = running !== null ? `running ${Math.round((nowMs - running.startedAtMs) / 1000)}s` : result === null ? 'nothing run yet' : `${result.ok ? '✓' : '✗'} exit ${result.exitCode ?? 'n/a'} · ${ago(result.atMs, nowMs)}`
  const rows: RenderElement[] = [rule(ctx, 'Result', right)]

  if (running !== null) rows.push(text(ctx, ` ▸ ${running.label} … ${Math.floor(nowMs / 500) % 2 === 0 ? '█' : ' '}`, { color: THEME.warn }))

  if (result === null) {
    if (running === null) rows.push(text(ctx, ' ▸ run shows a local read here at once; ▸ asks shows the exact command first (y runs it, n cancels)', { dimColor: true }))

    return [frameResult(ctx, rows, running !== null ? 'run' : 'idle')]
  }

  rows.push(text(ctx, ` ${result.label}`, { bold: true, color: result.ok ? THEME.ok : THEME.bad }))
  if (result.note !== undefined) rows.push(text(ctx, ` ${result.note}`, { color: THEME.warn }))

  const top = Math.max(0, Math.min(state.select.item, result.lines.length - VEC_ROWS))

  for (const line of result.lines.slice(top, top + VEC_ROWS)) rows.push(text(ctx, `   ${line}`))

  if (result.lines.length > VEC_ROWS) {
    rows.push(
      row(ctx, [
        text(ctx, ` lines ${top + 1}-${Math.min(result.lines.length, top + VEC_ROWS)} of ${result.lines.length} `, { dimColor: true }),
        button(ctx, 'vec-up', 'up', () => ctx.act.select(-1), { hotkey: 'k' }),
        button(ctx, 'vec-down', 'down', () => ctx.act.select(1), { hotkey: 'j' }),
      ]),
    )
  }

  return slot(ctx, [frameResult(ctx, rows, result.ok ? 'ok' : 'bad')])
}

/**
 * The Vector Lab: the ruvector CLI by section, each entry tagged by what it costs. The newest result sits on top so a
 * run's output is in view without scrolling; below it each section's field, then its entries.
 */
export function vectorView(ctx: Ctx): RenderElement {
  const lead = Math.max(13, Math.min(16, ctx.columns - 44))
  const rows: RenderElement[] = [
    ...resultRows(ctx),
    text(ctx, ' $0 local read, runs at once · wr writes here · net asks a remote host · pub publishes · $$ may spend · del cannot be undone: all but $0 ask first', { dimColor: true }),
  ]

  for (const section of VEC_SECTIONS) {
    rows.push(rule(ctx, section.title, section.right))
    rows.push(...fieldRows(ctx, section.id))

    for (const entry of VEC.filter(candidate => candidate.section === section.id)) rows.push(entryRow(ctx, entry, lead))
  }

  return ctx.kit.Box({ flexDirection: 'column', key: 'vector', children: rows })
}

/** This lab's result block alone: the pane asks for it to place under the row that was clicked. */
export const vectorResult = (ctx: Ctx): RenderElement[] => resultRows(ctx)
