import type { RenderElement } from 'claude-code'

import type { DevField } from '../data/devtools'
import { DEV, DEV_GROUPS, devSpec, type DevCost, type DevEntry, type DevGroup } from '../devtools'
import { slot } from './attention'
import { ago, button, clip, col, type Ctx, row, section, tagChip, text, THEME } from './common'
import { frameResult } from './status-card'
import { SANDBOX_GROUPS } from '../sandbox'
import { spinAt } from '../spinner'
import { sendResultRow } from './secure'

/** Result lines in view at once; j/k scroll the rest. */
const RESULT_ROWS = 14

/** Each cost as a four-cell tag, as the MetaHarness lab tags its rows. */
const TAG: Record<DevCost, { text: string; color: () => string }> = {
  read: { text: ' $0 ', color: () => THEME.ok },
  local: { text: 'cpu ', color: () => THEME.info },
  writes: { text: ' wr ', color: () => THEME.info },
  network: { text: 'net ', color: () => THEME.warn },
  spends: { text: ' $$ ', color: () => THEME.bad },
  deletes: { text: 'del ', color: () => THEME.bad },
}

/** The fields each section shows above its rows: one field may serve several sections, and says so. */
const FIELDS: Partial<Record<DevGroup, readonly { field: DevField; label: string; placeholder: string; submit?: string }[]>> = {
  brain: [{ field: 'task', label: 'ask', placeholder: 'what should I do? e.g. review my pull request, add OAuth login …', submit: 'ask' }],
  analyze: [{ field: 'ref', label: 'ref', placeholder: 'HEAD · HEAD~3 · main..HEAD · a sha', submit: 'diff' }],
  cow: [
    { field: 'path', label: 'path', placeholder: 'an .rvf memory file under the project (also file risk, appliance)', submit: 'status' },
    { field: 'label', label: 'label', placeholder: 'a checkpoint or branch label (also a DAA workflow / target agent)' },
  ],
  wasm: [{ field: 'query', label: 'search', placeholder: 'words to search the WASM gallery or the plugin registry' }],
  browser: [
    { field: 'url', label: 'url', placeholder: 'https://… to open in the ruflo-console session', submit: 'open' },
    { field: 'target', label: 'target', placeholder: '@e1: an element ref from SNAPSHOT', submit: 'click' },
  ],
  terminal: [
    { field: 'cmd', label: 'command', placeholder: 'one command line: Enter shows it, then asks before it runs', submit: 'run' },
    { field: 'id', label: 'id', placeholder: 'a session / agent id (terminal, DAA, managed agents)' },
  ],
  plugins: [{ field: 'query', label: 'search', placeholder: 'words to search the plugin registry (IPFS: asks first)', submit: 'search' }],
  tmux: [
    { field: 'session', label: 'name', placeholder: 'a sandbox name: letters, digits _ - (the console adds ruflo-sb-)', submit: 'capture' },
    { field: 'send', label: 'type', placeholder: 'one command line to type into that session: Enter shows it, then asks before it runs', submit: 'send' },
  ],
  daa: [{ field: 'note', label: 'note', placeholder: 'feedback or knowledge to send (also a managed-agent prompt)' }],
}

/** One dotted-leader row: the cost tag, the name, what it does, and its ▸ button; an n/a row says why instead. */
export function entryRow(ctx: Ctx, entry: DevEntry, lead: number): RenderElement {
  const tag = TAG[entry.cost]
  const isNa = entry.na !== undefined
  const isBlocked = !isNa && devSpec(entry, ctx.state.devtools.fields) === null

  return row(
    ctx,
    [
      isNa ? ctx.kit.Text({ bold: true, color: THEME.info, dimColor: true, children: ` ${'n/a '}` }) : tagChip(ctx, tag.text, tag.color()),
      ctx.kit.Text({ bold: true, color: entry.cost === 'spends' || entry.cost === 'deletes' ? THEME.warn : THEME.head, dimColor: isNa, children: clip(` ${entry.name} `, lead).padEnd(lead, '.') }),
      ctx.kit.Text({ color: THEME.info, dimColor: isNa || isBlocked, wrap: 'truncate-end', children: clip(` ${entry.about}`, Math.max(4, ctx.columns - lead - 16)) }),
      // A blocked row keeps its button: pressing it says which field to fill. The button is primary, the one action on the row.
      ...(isNa ? [] : [ctx.kit.Button({ key: `dt-${entry.id.slice(3)}`, label: ' ▶ run ', variant: 'primary' as const, onPress: () => void ctx.act.run(entry.id) })]),
      ...(isBlocked ? [ctx.kit.Text({ bold: true, color: THEME.warn, children: ' needs input above ↑' })] : []),
    ],
    `dt-row-${entry.id}`,
  )
}

export function fieldRows(ctx: Ctx, group: DevGroup): RenderElement[] {
  const fields = FIELDS[group] ?? []

  const Input = ctx.kit.Input

  if (fields.length === 0) return []
  if (Input === undefined) return [text(ctx, ` this surface has no text field: /ruflo run <id> <text> fills one (${fields.map(entry => entry.field).join(', ')})`, { dimColor: true })]

  return fields.map(({ field, label, placeholder, submit }) =>
    Input({
      key: `dt-field-${group}-${field}`,
      label,
      placeholder,
      value: ctx.state.devtools.fields[field],
      submitLabel: submit ?? 'keep',
      onInput: value => ctx.act.devtools.draft(field, value),
      onSubmit: value => ctx.act.devtools.submit(field, value),
    }),
  )
}

/** The Result section's header: a running run with its seconds and spinner, the last exit, or that nothing ran yet. */
export function resultRight(ctx: Ctx): string {
  const { state, nowMs } = ctx
  const running = state.lab.running?.id.startsWith('dt-') === true ? state.lab.running : null
  const result = state.lab.result?.id.startsWith('dt-') === true ? state.lab.result : null

  return running !== null ? `${spinAt(nowMs)} running ${Math.round((nowMs - running.startedAtMs) / 1000)}s` : result === null ? 'nothing run yet' : `${result.ok ? '✓' : '✗'} exit ${result.exitCode ?? 'n/a'} · ${ago(result.atMs, nowMs)}`
}

/** The last Dev Tools run: what it was, how it exited, its note, and a window of its lines. */
function resultRows(ctx: Ctx): RenderElement[] {
  const { state, nowMs } = ctx
  const running = state.lab.running?.id.startsWith('dt-') === true ? state.lab.running : null
  const result = state.lab.result?.id.startsWith('dt-') === true ? state.lab.result : null
  const rows: RenderElement[] = []

  if (running !== null) rows.push(text(ctx, ` ${spinAt(nowMs)} ${running.label} · ${Math.round((nowMs - running.startedAtMs) / 1000)}s`, { color: THEME.warn }))

  if (result === null) {
    if (running === null) rows.push(text(ctx, ' ▸ press a row: a $0 read shows here at once; the rest ask first (y), their cost on the confirm row', { dimColor: true }))

    return [frameResult(ctx, rows, running !== null ? 'run' : 'idle')]
  }

  rows.push(text(ctx, ` ${result.label}`, { bold: true, color: result.ok ? THEME.ok : THEME.bad }))
  if (result.note !== undefined) rows.push(text(ctx, ` ${result.note}`, { color: /MONEY|DELETES|DISCARDS|SHELL/.test(result.note) ? THEME.bad : THEME.warn }))

  const top = Math.max(0, Math.min(state.select.item, result.lines.length - RESULT_ROWS))

  for (const line of result.lines.slice(top, top + RESULT_ROWS)) rows.push(text(ctx, `   ${line}`))

  if (result.lines.length > RESULT_ROWS) {
    rows.push(
      row(ctx, [
        text(ctx, ` lines ${top + 1}-${Math.min(result.lines.length, top + RESULT_ROWS)} of ${result.lines.length} `, { dimColor: true }),
        button(ctx, 'dt-up', 'up', () => ctx.act.select(-1), { hotkey: 'k' }),
        button(ctx, 'dt-down', 'down', () => ctx.act.select(1), { hotkey: 'j' }),
      ]),
    )
  }

  rows.push(sendResultRow(ctx, 'dt-send'))

  return slot(ctx, [frameResult(ctx, rows, result.ok ? 'ok' : 'bad')])
}

/**
 * ruflo's integration surface by purpose: each group a section with its fields and rows, the first open and the rest folded
 * (each header names its count and cost), and the last run's output in a section of its own, open while a run is in flight or has
 * finished. Drawing it runs nothing; every row is a press.
 */
export function devtoolsView(ctx: Ctx): RenderElement {
  const { state } = ctx
  const lead = Math.max(16, Math.min(24, ctx.columns - 44))
  // The result opens while a run is in flight, has finished, or is waiting for a confirm, so what a press did is always in view.
  const hasRun = state.lab.running?.id.startsWith('dt-') === true || state.lab.result?.id.startsWith('dt-') === true || state.pending !== null
  const rows: RenderElement[] = [text(ctx, ' $0 local read, runs at once · cpu/wr local work or a write · net the network · $$ may spend · del deletes: each of these asks first', { dimColor: true })]

  // The sandbox groups (tmux, RVM) are drawn on the Sandbox page, not here.
  DEV_GROUPS.filter(group => !SANDBOX_GROUPS.some(sandbox => sandbox.id === group.id)).forEach((group, i) => {
    const entries = DEV.filter(candidate => candidate.group === group.id)

    // The first group, and every group with a text field, opens: a field folded away could not be typed into, so its runs would refuse.
    rows.push(...section(ctx, `dt-${group.id}`, group.title, `${entries.length} · ${group.right}`, [...fieldRows(ctx, group.id), ...entries.map(entry => entryRow(ctx, entry, lead))], i === 0 || (FIELDS[group.id] ?? []).length > 0))
  })

  rows.push(...section(ctx, 'dt-result', 'Result', resultRight(ctx), resultRows(ctx), hasRun))
  rows.push(text(ctx, ' every row is a palette id too: /ruflo run dt-diff HEAD~3, /ruflo run dt-brain review my PR', { dimColor: true }))

  return col(ctx, rows, 'devtools')
}

/** This lab's result block alone: the pane asks for it to place under the row that was clicked. */
export const devtoolsResult = (ctx: Ctx): RenderElement[] => resultRows(ctx)
