import type { RenderElement } from 'claude-code'

import { PRESETS } from '../loops'
import { mcOf } from '../mission-control'
import { outcomeCard } from './status-card'
import { button, clip, row, section, text, THEME, type Ctx } from './common'

/** The outcomes a loop launch reports (loops.ts `say`): the Security page shows the last one right under the sentries, so a click is never silent. */
const LAUNCH_LABELS: ReadonlySet<string> = new Set(['loop command sent', 'waiting in your prompt box', 'could not fill the prompt box', 'Claude did not take it', 'loop not started', 'AIDefence blocked the task'])

/** When a sentry runs, in words: on change (an event watch), or every interval. */
const whenOf = (interval: string): string => (interval === 'self-paced' ? 'on change' : `every ${interval}`)

/**
 * Security sentries: the loop manager's security presets, one row each. A `watch` sentry finds and reports and edits nothing; the
 * `fix` sentry also fixes the top real finding, in a new worktree branch, and never pushes. Start picks the preset and calls the
 * loop launcher, which shows the exact /loop text and asks first (each tick is a billed Claude turn). The loops run in the main
 * Claude session, so what a sentry finds arrives in the conversation where it can be acted on.
 */
export function sentryRows(ctx: Ctx): RenderElement[] {
  const m = ctx.act.loops
  const sentries = PRESETS.filter(preset => preset.sentry !== undefined)
  const lead = Math.max(16, Math.min(26, ctx.columns - 52))
  const rows: RenderElement[] = sentries.map(preset =>
    row(
      ctx,
      [
        ctx.kit.Text({ bold: true, color: preset.sentry === 'fix' ? THEME.warn : THEME.ok, children: preset.sentry === 'fix' ? ' fix   ' : ' watch ' }),
        ctx.kit.Text({ bold: true, color: THEME.head, children: ` ${preset.title.replace('Sentry: ', '')} `.padEnd(lead, '.') }),
        ctx.kit.Text({ color: THEME.info, wrap: 'truncate-end', children: clip(` ${whenOf(preset.interval)} · ${preset.about}`, Math.max(8, ctx.columns - lead - 26)) }),
        ctx.kit.Button({
          key: `sentry-start-${preset.id}`,
          label: ' ▶ start ',
          variant: 'primary',
          onPress: () => {
            m.pick(preset.id)
            m.launch()
          },
        }),
      ],
      `sentry-${preset.id}`,
    ),
  )

  rows.push(
    row(
      ctx,
      [
        button(ctx, 'sentry-manage', '☰ list / stop my sentries', () => m.manage()),
        text(ctx, ' asks Claude to list the scheduled loops and stop the ones you name', { dimColor: true }),
      ],
      'sentry-manage-row',
    ),
  )
  const last = mcOf(ctx.state).last

  if (last !== null && LAUNCH_LABELS.has(last.label)) {
    rows.push(outcomeCard(ctx, 'sentry-outcome', last))
  }
  rows.push(text(ctx, ' watch: reads and reports, edits nothing · fix: edits only in a new branch and never pushes · each tick is a billed turn; it asks first', { dimColor: true }))

  return section(ctx, 'sec-sentries', 'Sentries', `${sentries.filter(entry => entry.sentry === 'watch').length} watch · ${sentries.filter(entry => entry.sentry === 'fix').length} find and fix · real time, or on a schedule`, rows, true)
}
