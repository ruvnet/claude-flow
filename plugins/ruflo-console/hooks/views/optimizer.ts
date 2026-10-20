import type { RenderElement } from 'claude-code'

import { diagnose, offered, optimizerOf, metricNow, SCOPES, type Finding } from '../optimizer'
import { slot } from './attention'
import { clip, row, section, text, THEME, type Ctx } from './common'
import { frameResult } from './status-card'

const GLYPH = { bad: '✖', warn: '⚠', info: 'ℹ' } as const
const COLOR = { bad: () => THEME.bad, warn: () => THEME.warn, info: () => THEME.info } as const

const chip = (ctx: Ctx, key: string, label: string, isOn: boolean, onPress: () => void): RenderElement =>
  ctx.kit.Button({ key, label: ` ${isOn ? '●' : '○'} ${label} `, plain: true, ...(isOn && { variant: 'primary' as const }), onPress })

/** One finding: its level and title with the metric, why, the fixes this scope offers (each one button), and before → now after a fix. */
function findingRows(ctx: Ctx, finding: Finding): RenderElement[] {
  const cfg = optimizerOf(ctx.state)
  const fixes = offered(finding, cfg.scope)
  const before = cfg.before.get(finding.id)
  const now = before === undefined ? null : metricNow(ctx.state, finding.id, ctx.nowMs, ctx.state.loadedAtMs)

  return [
    row(ctx, [ctx.kit.Text({ bold: true, color: COLOR[finding.level](), children: ` ${GLYPH[finding.level]} ${clip(finding.title, Math.max(20, ctx.columns - 34))} ` }), ctx.kit.Text({ dimColor: true, children: `· ${finding.area} · ${finding.metric}` })], `opt-head-${finding.id}`),
    text(ctx, `   ${clip(finding.why, Math.max(20, ctx.columns - 6))}`, { dimColor: true }),
    // The standalone terminal has no buttons, so a row of fixes (or "no button for this one") would say something false there.
    ...(ctx.state.isStandalone ? [] : [row(
      ctx,
      [
        ...fixes.map(item => ctx.kit.Button({ key: `opt-fix-${finding.id}-${item.id}`, label: ` ▸ ${item.label} `, plain: true, onPress: () => ctx.act.optimizer.fix(finding.id, item.id) })),
        ...(fixes.length === 0 ? [ctx.kit.Text({ dimColor: true, children: finding.fixes.length === 0 ? '   no button for this one: read how to fix it above' : '   a wider scope offers fixes for this' })] : []),
        ctx.kit.Button({ key: `opt-ask-${finding.id}`, label: ' ✦ ask Claude ', plain: true, dimColor: true, onPress: () => ctx.act.optimizer.ask(finding.id) }),
      ],
      `opt-fixes-${finding.id}`,
    )]),
    ...(before === undefined ? [] : [text(ctx, `   after ${cfg.ran.get(finding.id) ?? 'a fix'}: ${before}  →  now ${now ?? 'resolved (no longer a finding)'}  (refresh r re-reads)`, { color: now === null ? THEME.ok : THEME.info })]),
  ]
}

/** The answer of the last fix that ran from here: its result lines, drawn where the pressed button is (or here, when it is not on screen). */
function resultRows(ctx: Ctx): RenderElement[] {
  const cfg = optimizerOf(ctx.state)
  const fixIds = new Set(diagnose(ctx.state, ctx.nowMs, ctx.state.loadedAtMs).flatMap(finding => finding.fixes.map(item => item.id)))
  const result = ctx.state.lab.result !== null && (fixIds.has(ctx.state.lab.result.id) || [...cfg.ran.values()].includes(ctx.state.lab.result.id)) ? ctx.state.lab.result : null

  if (result === null) return []

  const rows: RenderElement[] = [text(ctx, ` ${result.ok ? '✓' : '✗'} ${result.label}`, { bold: true, color: result.ok ? THEME.ok : THEME.bad })]

  if (result.note !== undefined) rows.push(text(ctx, ` ${result.note}`, { color: THEME.warn }))
  for (const line of result.lines.slice(0, 14)) rows.push(text(ctx, `   ${line}`, line.startsWith('⚠') ? { color: THEME.warn } : {}))
  if (result.lines.length > 14) rows.push(text(ctx, `   … ${result.lines.length - 14} more lines: open the section that owns this command`, { dimColor: true }))

  return slot(ctx, [frameResult(ctx, rows, result.ok ? 'ok' : 'bad')])
}

/**
 * The Optimizer, a section of the Overview: the problems and thin spots found from what the console read, a fix button for each (it
 * asks first), a scope that limits which fixes are offered, and the metric before and after. Its answers open under the button pressed.
 */
export function optimizerRows(ctx: Ctx): RenderElement[] {
  const cfg = optimizerOf(ctx.state)
  const findings = diagnose(ctx.state, ctx.nowMs, ctx.state.loadedAtMs)
  const attention = findings.filter(finding => finding.level !== 'info').length

  return section(
    ctx,
    'optimizer',
    'Optimizer',
    `${findings.length} finding${findings.length === 1 ? '' : 's'}${attention > 0 ? ` · ${attention} need attention` : ''} · fixes ask first`,
    [
      row(ctx, [text(ctx, ' scope '), ...SCOPES.map(scope => chip(ctx, `opt-scope-${scope.id}`, `${scope.title} · ${scope.about}`, cfg.scope === scope.id, () => ctx.act.optimizer.scope(scope.id)))], 'opt-scopes'),
      ...(findings.length === 0 ? [text(ctx, ' nothing found: the project is still being read', { dimColor: true })] : findings.flatMap(finding => findingRows(ctx, finding))),
      ...resultRows(ctx),
    ],
    true,
  )
}

/** This section's result block alone: the pane asks for it to place under the fix button that was pressed. */
export const optimizerResult = (ctx: Ctx): RenderElement[] => resultRows(ctx)
