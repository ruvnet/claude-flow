import type { RenderElement } from 'claude-code'

import { LAB, LAB_GROUPS, labSpec, PROMOTE_COMMAND, type LabCost, type LabEntry } from '../mh-lab'
import { slot } from './attention'
import { sendResultRow } from './secure'
import { ago, button, clip, type Ctx, row, rule, section, tagChip, text, THEME } from './common'
import { frameResult } from './status-card'

/** Result lines in view at once; j/k scroll the rest. */
export const LAB_ROWS = 14

/** Each cost as a four-cell tag: $0 reads, writes, local compute, and what may spend. */
const TAG: Record<LabCost, { text: string; color: () => string }> = {
  read: { text: ' $0 ', color: () => THEME.ok },
  writes: { text: ' wr ', color: () => THEME.info },
  local: { text: 'cpu ', color: () => THEME.warn },
  spends: { text: ' $$ ', color: () => THEME.bad },
}

/** One menu row, dotted to its purpose like the x.ruv.io board: the tag, the name, what it does, and its button. */
function entryRow(ctx: Ctx, entry: LabEntry, lead: number): RenderElement {
  const tag = TAG[entry.cost]
  const isTyped = entry.types !== undefined
  const isBlocked = !isTyped && labSpec(entry, ctx.state) === null
  const typed = entry.types

  return row(
    ctx,
    [
      tagChip(ctx, tag.text, tag.color()),
      ctx.kit.Text({ bold: true, color: entry.cost === 'spends' ? THEME.warn : THEME.head, children: ` ${entry.name} `.padEnd(lead, '.') }),
      ctx.kit.Text({ color: THEME.info, dimColor: isBlocked, wrap: 'truncate-end', children: clip(` ${entry.about}`, Math.max(4, ctx.columns - lead - 18)) }),
      // A verb that needs a path types its command into the terminal, which asks before it runs.
      ctx.kit.Button({ key: `lab-${entry.id}`, label: isTyped ? ' ▸ type' : ' ▸ run', plain: true, dimColor: true, onPress: typed !== undefined ? () => ctx.act.term.load('ruflo', typed) : () => void ctx.act.run(entry.id) }),
    ],
    `lab-row-${entry.id}`,
  )
}

/** The last run: what it was, how it exited, what it cost, and a window of its lines. */
function resultRows(ctx: Ctx): RenderElement[] {
  const { state, nowMs } = ctx
  // Other labs (the Memory Lab's mem- runs) share the runner's lab slot: only MetaHarness runs show here.
  const result = state.lab.result?.id.startsWith('mh-') === true ? state.lab.result : null
  const running = state.lab.running?.id.startsWith('mh-') === true ? state.lab.running : null
  const right = running !== null ? `running ${Math.round((nowMs - running.startedAtMs) / 1000)}s` : result === null ? 'nothing run yet' : `${result.ok ? '✓' : '✗'} exit ${result.exitCode ?? 'n/a'} · ${ago(result.atMs, nowMs)}`
  const rows: RenderElement[] = [rule(ctx, 'Result', right)]

  if (running !== null) {
    // Data, not decoration: the block blinks only while the CLI is still working.
    rows.push(text(ctx, ` ▸ ${running.label} … ${Math.floor(nowMs / 500) % 2 === 0 ? '█' : ' '}`, { color: THEME.warn }))
  }

  if (result === null) {
    if (running === null) rows.push(text(ctx, ' ▸ run an entry: a $0 read shows here at once; the rest show here after you confirm (y)', { dimColor: true }))

    return [frameResult(ctx, rows, running !== null ? 'run' : 'idle')]
  }

  rows.push(text(ctx, ` ${result.label}`, { bold: true, color: result.ok ? THEME.ok : THEME.bad }))
  if (result.note !== undefined) rows.push(text(ctx, ` ${result.note}`, { color: /money|models/i.test(result.note) ? THEME.bad : THEME.warn }))

  const top = Math.max(0, Math.min(state.select.item, result.lines.length - LAB_ROWS))

  for (const line of result.lines.slice(top, top + LAB_ROWS)) rows.push(text(ctx, `   ${line}`))

  if (result.lines.length > LAB_ROWS) {
    rows.push(
      row(ctx, [
        text(ctx, ` lines ${top + 1}-${Math.min(result.lines.length, top + LAB_ROWS)} of ${result.lines.length} `, { dimColor: true }),
        button(ctx, 'lab-up', 'up', () => ctx.act.select(-1), { hotkey: 'k' }),
        button(ctx, 'lab-down', 'down', () => ctx.act.select(1), { hotkey: 'j' }),
      ]),
    )
  }

  rows.push(sendResultRow(ctx, 'lab-send'))

  return slot(ctx, [frameResult(ctx, rows, result.ok ? 'ok' : 'bad')])
}

/**
 * The MetaHarness lab, under the readiness, flywheel and trend sections: every verb by purpose, the last run's
 * output, and promotion shown as a command the person runs, never a button.
 */
export function labRows(ctx: Ctx): RenderElement[] {
  const lead = Math.max(14, Math.min(19, ctx.columns - 40))
  const rows: RenderElement[] = []

  // Each group folds: the read-only inspect verbs open, the groups that write or spend fold away, each header naming its cost.
  for (const group of LAB_GROUPS) {
    const entries = LAB.filter(candidate => candidate.group === group.id)

    rows.push(...section(ctx, `mh-${group.id}`, group.title, `${entries.length} · ${group.right}`, entries.map(entry => entryRow(ctx, entry, lead)), group.id === 'inspect'))
  }

  rows.push(text(ctx, ' $0 read, runs at once · wr writes · cpu minutes of local work · $$ may spend: each of these asks, its cost on the confirm row', { dimColor: true }))
  rows.push(...resultRows(ctx))
  rows.push(
    ...section(
      ctx,
      'mh-promote',
      'Promote',
      'a policy act · never from this pane',
      [
        text(ctx, ' Promotion needs a receipt id, an approved Ed25519 public key and --confirm, and passes the policy gate:', { color: THEME.info }),
        text(ctx, `   ${PROMOTE_COMMAND}`, { bold: true, color: THEME.warn }),
        text(ctx, ' Review the receipt (▸ RECEIPTS), then run it yourself in a terminal. The console proposes and evaluates; it never promotes.', { dimColor: true }),
      ],
      false,
    ),
  )

  return rows
}

/** This lab's result block alone: the pane asks for it to place under the row that was clicked. */
export const labResult = (ctx: Ctx): RenderElement[] => resultRows(ctx)
