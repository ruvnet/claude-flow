import type { RenderElement } from 'claude-code'

import { DEV, DEV_GROUPS, withTmux, type DevGroup } from '../devtools'
import { RVM_LINES } from '../sandbox'
import { col, type Ctx, section, text } from './common'
import { entryRow, fieldRows, resultRight, devtoolsResult } from './devtools'

/** One section's rows: the entries of a group as Dev Tools draws them, n/a with the reason while tmux is known missing. */
function rows(ctx: Ctx, group: DevGroup, lead: number): RenderElement[] {
  return DEV.filter(entry => entry.group === group).map(entry => entryRow(ctx, withTmux(entry, ctx.state.devtools.tmux), lead))
}

const right = (group: DevGroup): string => DEV_GROUPS.find(entry => entry.id === group)?.right ?? ''

/**
 * Isolated places to try things, in three sections: tmux sessions (real, throwaway shells the console names `ruflo-sb-*`), RVF
 * copy-on-write branches (the Dev Tools agenticow rows, the same entries and fields) and RVM (information only). Drawing it runs
 * nothing; the tmux probe ran when the page opened. The result of the last run shows below, as on Dev Tools.
 */
export function sandboxView(ctx: Ctx): RenderElement {
  const { state } = ctx
  const lead = Math.max(16, Math.min(24, ctx.columns - 44))
  const hasRun = state.lab.running?.id.startsWith('dt-') === true || state.lab.result?.id.startsWith('dt-') === true || state.pending !== null
  const tmuxNote = state.devtools.tmux === 'missing' ? ' tmux is not installed on this machine: its rows are n/a' : ' a tmux session is a separate shell that runs as you: a place to work apart, not a security boundary'

  return col(
    ctx,
    [
      text(ctx, ' isolated places to try things: tmux sessions · RVF copy-on-write branches · RVM. $0 reads run at once; the rest ask first', { dimColor: true }),
      ...section(ctx, 'sb-tmux', 'tmux sandboxes', `${DEV.filter(entry => entry.group === 'tmux').length} · ${right('tmux')}`, [text(ctx, tmuxNote, { dimColor: true }), ...fieldRows(ctx, 'tmux'), ...rows(ctx, 'tmux', lead)], true),
      ...section(ctx, 'sb-rvf', 'RVF sandboxes · copy-on-write branches', `${DEV.filter(entry => entry.group === 'cow').length} · an .rvf file · writes ask`, [text(ctx, ' branch it, try things on the branch, then ROLLBACK to throw them away or PROMOTE to keep them (the same rows as Dev Tools)', { dimColor: true }), ...fieldRows(ctx, 'cow'), ...rows(ctx, 'cow', lead)], true),
      ...section(ctx, 'sb-rvm', 'RVM · resource and effect boundary', right('rvm'), [...RVM_LINES.map(line => text(ctx, line, { dimColor: true })), ...rows(ctx, 'rvm', lead)], true),
      ...section(ctx, 'dt-result', 'Result', resultRight(ctx), devtoolsResult(ctx), hasRun),
      text(ctx, ' every row is a palette id too: /ruflo run dt-sb-new demo, /ruflo run dt-sb-capture demo', { dimColor: true }),
    ],
    'sandbox',
  )
}
