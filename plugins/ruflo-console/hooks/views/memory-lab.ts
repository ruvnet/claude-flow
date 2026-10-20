import type { RenderElement } from 'claude-code'

import { MEM_GROUPS, MEM_LAB, memSpecOf, textOfFields, type MemCost, type MemEntry, type MemField } from '../memory-lab'
import { ago, button, clip, confirmHere, type Ctx, row, rule, section, tagChip, text, THEME } from './common'
import { healthRows } from './memory-health'
import { frameResult } from './status-card'

/** Result lines in view at once; j/k scroll the rest. */
export const MEM_ROWS = 16

/** Each cost as a four-cell tag: $0 reads, writes, deletes, and what may reach the network. */
const TAG: Record<MemCost, { text: string; color: () => string }> = {
  read: { text: ' $0 ', color: () => THEME.ok },
  writes: { text: ' wr ', color: () => THEME.info },
  deletes: { text: 'del ', color: () => THEME.bad },
  net: { text: 'net ', color: () => THEME.warn },
}

/** A text field bound to one of the lab's fields; on a surface without fields, a line saying how to type it instead. */
function field(ctx: Ctx, name: MemField, label: string, placeholder: string, submitLabel: string, onSubmit: (value: string) => void): RenderElement {
  if (ctx.kit.Input === undefined) return text(ctx, ` ${label}: this surface has no text field; use /ruflo run <entry id> <text>`, { dimColor: true })

  return ctx.kit.Input({
    key: `mem-${name}`,
    label,
    placeholder,
    value: ctx.state.memoryLab[name],
    submitLabel,
    onInput: value => ctx.act.memory.draft(name, value),
    // The field's text is the input even when no keystroke reached onInput (a paste, a headless submit).
    onSubmit: value => {
      ctx.act.memory.draft(name, value)
      onSubmit(value)
    },
  })
}

/** The search box and its scope: the memory store alone, or one search over Claude memories, AgentDB and patterns. */
function searchRows(ctx: Ctx): RenderElement[] {
  const lab = ctx.state.memoryLab
  const isUnified = lab.scope === 'unified'

  return [
    rule(ctx, 'Search', isUnified ? 'memory_search_unified · Claude + AgentDB + patterns' : `memory search · semantic${lab.filter !== null ? ` · in ${lab.filter}` : ''}`),
    field(ctx, 'query', 'search', 'what to find, in words: jwt refresh, the login bug …', 'search', value => ctx.act.memory.search(value)),
    row(ctx, [
      text(ctx, ` scope: ${isUnified ? 'everything (unified)' : 'the memory store'} `, { color: THEME.info }),
      button(ctx, 'mem-scope', isUnified ? 'memory store only' : 'search everything', ctx.act.memory.scope),
    ]),
  ]
}

/** The entry fields: namespace, key and value, and the three things to do with them. */
function entryRows(ctx: Ctx): RenderElement[] {
  return [
    rule(ctx, 'Entry', 'store asks first · delete asks and cannot be undone'),
    field(ctx, 'namespace', 'namespace', 'default', 'set', value => ctx.act.memory.draft('namespace', value)),
    field(ctx, 'key', 'key', 'a key: api/auth, notes.alpha …', 'retrieve', () => ctx.act.memory.run('mem-retrieve')),
    field(ctx, 'value', 'value', 'what to store under the key', 'store', () => ctx.act.memory.run('mem-store')),
    row(ctx, [
      button(ctx, 'mem-do-store', '▸ store', () => ctx.act.memory.run('mem-store'), { primary: true }),
      button(ctx, 'mem-do-retrieve', '▸ retrieve', () => ctx.act.memory.run('mem-retrieve')),
      button(ctx, 'mem-do-delete', '▸ delete', () => ctx.act.memory.run('mem-delete')),
    ]),
  ]
}

/** One lab row, dotted to its purpose: the cost tag, the name, what it does, and its button. */
function entryRow(ctx: Ctx, entry: MemEntry, lead: number): RenderElement {
  const tag = TAG[entry.cost]
  const isReady = memSpecOf(entry, textOfFields(entry, ctx.state.memoryLab), ctx.state) !== null

  return row(
    ctx,
    [
      tagChip(ctx, tag.text, tag.color()),
      ctx.kit.Text({ bold: true, color: entry.cost === 'deletes' ? THEME.bad : THEME.head, children: ` ${entry.name} `.padEnd(lead, '.') }),
      ctx.kit.Text({ color: THEME.info, dimColor: !isReady, wrap: 'truncate-end', children: clip(` ${entry.about}`, Math.max(4, ctx.columns - lead - 16)) }),
      ctx.kit.Button({ key: `mem-lab-${entry.id}`, label: ' ▸ run', plain: true, dimColor: true, onPress: () => ctx.act.memory.run(entry.id) }),
    ],
    `mem-row-${entry.id}`,
  )
}

/**
 * What the last action in this area asked and answered, drawn right under the area that raised it: its confirm, then the running
 * line or the result. Nothing is drawn for an area the last action did not come from.
 */
export function areaPanel(ctx: Ctx, area: string): RenderElement[] {
  if (ctx.state.memoryLab.origin !== area) return []

  const confirm = confirmHere(ctx, `mem:${area}`)
  const hasOutput = ctx.state.lab.result?.id.startsWith('mem-') === true || ctx.state.lab.running?.id.startsWith('mem-') === true

  // Nothing asked and nothing answered: no empty box.
  if (confirm.length === 0 && !hasOutput) return []

  const result = hasOutput ? resultRows(ctx) : []

  return [ctx.kit.Box({ key: `mem-panel-${area}`, flexDirection: 'column', borderStyle: 'round', borderColor: THEME.ok, paddingX: 1, children: [...confirm, ...result] })]
}

/** The last Memory Lab run: what it was, how it exited, its note, and a window of its lines. */
function resultRows(ctx: Ctx): RenderElement[] {
  const { state, nowMs } = ctx
  const result = state.lab.result?.id.startsWith('mem-') === true ? state.lab.result : null
  const running = state.lab.running?.id.startsWith('mem-') === true ? state.lab.running : null
  const right = running !== null ? `running ${Math.round((nowMs - running.startedAtMs) / 1000)}s` : result === null ? 'nothing run yet' : `${result.ok ? '✓' : '✗'} exit ${result.exitCode ?? 'n/a'} · ${ago(result.atMs, nowMs)}`
  const rows: RenderElement[] = [rule(ctx, 'Result', right)]

  // Data, not decoration: the block blinks only while the CLI is still working.
  if (running !== null) rows.push(text(ctx, ` ▸ ${running.label} … ${Math.floor(nowMs / 500) % 2 === 0 ? '█' : ' '}`, { color: THEME.warn }))

  if (result === null) {
    if (running === null) rows.push(text(ctx, ' ▸ open an entry above, search, or run a lab row: reads show here at once, the rest after you confirm (y)', { dimColor: true }))

    return [frameResult(ctx, rows, running !== null ? 'run' : 'idle')]
  }

  rows.push(text(ctx, ` ${result.label}`, { bold: true, color: result.ok ? THEME.ok : THEME.bad }))
  if (result.note !== undefined) rows.push(text(ctx, ` ${result.note}`, { color: /DELETES|network/i.test(result.note) ? THEME.bad : THEME.warn }))

  const top = Math.max(0, Math.min(state.select.item, result.lines.length - MEM_ROWS))

  for (const line of result.lines.slice(top, top + MEM_ROWS)) rows.push(text(ctx, `   ${line}`, line.startsWith('⚠') ? { color: THEME.warn } : {}))

  if (result.lines.length > MEM_ROWS) {
    rows.push(
      row(ctx, [
        text(ctx, ` lines ${top + 1}-${Math.min(result.lines.length, top + MEM_ROWS)} of ${result.lines.length} `, { dimColor: true }),
        button(ctx, 'mem-up', 'up', () => ctx.act.select(-1), { hotkey: 'k' }),
        button(ctx, 'mem-down', 'down', () => ctx.act.select(1), { hotkey: 'j' }),
      ]),
    )
  }

  return [frameResult(ctx, rows, result.ok ? 'ok' : 'bad')]
}

/**
 * The lab under the browse list: search, the entry fields, one text field for AgentDB and embeddings, every verb by
 * group with its cost tag, then the last run's output.
 */
export function memoryLabRows(ctx: Ctx): RenderElement[] {
  const lead = Math.max(15, Math.min(18, ctx.columns - 40))
  const rows: RenderElement[] = [...section(ctx, 'mem-g-health', 'Memory health', 'duplicates, stale, never recalled · analysis reads no values; consolidate asks first', [...healthRows(ctx), ...areaPanel(ctx, 'health')], true), ...searchRows(ctx), ...areaPanel(ctx, 'search'), ...entryRows(ctx), ...areaPanel(ctx, 'entry')]

  rows.push(rule(ctx, 'Lab text', 'the input for the rows below that take text'))
  rows.push(field(ctx, 'text', 'text', 'a query or pattern · a node id · a | b to compare · source relation target', 'keep', value => ctx.act.memory.draft('text', value)))

  // Each group is a section that folds away; the one the last action came from is open, with its answer under its rows.
  for (const group of MEM_GROUPS) {
    const body = [...MEM_LAB.filter(candidate => candidate.group === group.id).map(entry => entryRow(ctx, entry, lead)), ...areaPanel(ctx, group.id)]

    rows.push(...section(ctx, `mem-g-${group.id}`, group.title, group.right, body, true))
  }

  rows.push(text(ctx, ' $0 read, runs at once · wr writes · del deletes for good · net may fetch the model: each of these asks, its cost on the confirm row', { dimColor: true }))

  return rows
}
