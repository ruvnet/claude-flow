import type { RenderElement } from 'claude-code'

import { ALERT_SEVERITIES, ANATOLE_STALE_MS, MODES, RULE_MODES, type AnatoleAlert, type AnatoleFacts, type AnatoleMode, type RuleMode } from '../data/anatole'
import { ANATOLE_RULES, INSTALL_LINE, UNAUTH, type RuleMeta } from '../anatole'
import { ago, button, clip, type Ctx, row, section, text, THEME } from './common'

const SEV_COLOR = { critical: () => THEME.bad, high: () => THEME.bad, medium: () => THEME.warn, low: () => THEME.info }

/** What each mode does, in one sentence: shown under the chooser so the choice is never a guess. */
const MODE_NOTE: Record<string, string> = {
  off: 'Anatole does nothing: it records nothing and raises nothing.',
  learn: 'Learning only (the default): it records the baseline of what is normal here and says nothing.',
  notify: 'Raises alerts and never blocks anything. Run replay first to see what it would say.',
  enforce: 'Rules set to block deny the tool call, and the reason names the rule and how to allow it. Switching to enforce asks first.',
}

/** A sub-heading inside the card: the title, a rule, and what it summarises at the right, so the block reads on its own. */
function subhead(ctx: Ctx, title: string, right = ''): RenderElement {
  const head = ` ${title} `
  const tail = right === '' ? '' : ` ${right} `
  const fill = Math.max(2, ctx.columns - 12 - head.length - tail.length)

  return row(ctx, [ctx.kit.Text({ bold: true, color: THEME.head, children: head }), ctx.kit.Text({ dimColor: true, children: '─'.repeat(fill) }), ...(tail === '' ? [] : [ctx.kit.Text({ dimColor: true, children: tail })])])
}

/** An explanation under a block: dim, wrapped (never clipped), indented one column. */
const note = (ctx: Ctx, words: string): RenderElement => ctx.kit.Text({ dimColor: true, wrap: 'wrap', children: ` ${words}` })

/** What the page knows of one rule: its mode now, whether the person changed it, and its record in the alert tail. */
export type RuleRow = { meta: RuleMeta; mode: RuleMode; changed: boolean; demoted: boolean; hits: number; ackedShare: number | null }

/** The 13 shipped rules merged with rules.json's overrides and counted over the last alerts read (the status file carries no per-rule counts). */
export function ruleRows(facts: AnatoleFacts): RuleRow[] {
  return ANATOLE_RULES.map(meta => {
    const mine = facts.alerts.filter(alert => alert.rule === meta.id)
    const over = facts.overrides[meta.id]
    const mode = over?.mode ?? meta.fallback

    return { meta, mode, changed: over !== undefined && over.mode !== meta.fallback, demoted: over?.demoted === true, hits: mine.length, ackedShare: mine.length === 0 ? null : Math.round((mine.filter(alert => alert.state === 'acked').length / mine.length) * 100) }
  })
}

/** The open alerts by severity as one labelled line for the Findings meter, or null when the plugin has not reported. */
export function anatoleMeterLine(facts: AnatoleFacts | undefined): string | null {
  const open = facts?.status?.open

  return open === undefined ? null : `Project Anatole open alerts: ${ALERT_SEVERITIES.map(level => `${open[level]} ${level}`).join(' · ')} (${UNAUTH})`
}

const chipRow = <T extends string>(ctx: Ctx, label: string, keyOf: string, options: readonly T[], current: T | null, press: (value: T) => void): RenderElement =>
  row(ctx, [text(ctx, ` ${label} `, { bold: true, color: THEME.head }), ...options.map(option => ctx.kit.Button({ key: `${keyOf}-${option}`, label: ` ${option} `, ...(option === current ? { variant: 'primary' as const } : { plain: true, dimColor: true }), onPress: () => press(option) }))], `${keyOf}-row`)

function statusRows(ctx: Ctx, facts: AnatoleFacts): RenderElement[] {
  const status = facts.status
  const rows: RenderElement[] = []

  if (status === null) {
    rows.push(text(ctx, ` no readable status.json yet${facts.refused.includes('status.json') ? ' (refused: too large, not a regular file, or an unknown shape)' : ': start a session with the plugin loaded'}`, { color: THEME.warn }))

    return rows
  }

  const base = status.baseline
  const width = Math.max(8, Math.min(24, ctx.columns - 60))
  const filled = base === null ? 0 : Math.round((base.maturity / 100) * width)
  const stale = status.updatedMs !== null && ctx.nowMs - status.updatedMs > ANATOLE_STALE_MS

  rows.push(
    row(ctx, [
      text(ctx, ` mode ${status.mode ?? 'unknown'}${facts.modeOverride !== null && facts.modeOverride !== status.mode ? ` (rules.json asks for ${facts.modeOverride})` : ''}`, { bold: true, color: status.mode === 'enforce' ? THEME.warn : THEME.ok }),
      text(ctx, ` · baseline ${base === null ? 'n/a' : `${base.state} ${base.maturity}% `}`, { color: THEME.info }),
      ...(base === null ? [] : [text(ctx, `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`, { color: base.state === 'mature' ? THEME.ok : THEME.warn })]),
      text(ctx, base === null ? '' : ` ${base.events} events · ${base.sessions} sessions`, { dimColor: true }),
    ], 'anatole-status-a'),
  )
  rows.push(
    row(ctx, [
      text(ctx, ` open ${status.open.total}:`, { bold: status.open.total > 0, color: status.open.total > 0 ? THEME.warn : THEME.ok }),
      ...ALERT_SEVERITIES.map(level => text(ctx, ` ${status.open[level]} ${level}`, status.open[level] > 0 ? { color: SEV_COLOR[level]() } : { dimColor: true })),
      text(ctx, ` · blocked ${status.blocked} · calls ${status.calls}`, { dimColor: true }),
      ...(status.degraded !== false ? [text(ctx, ` · degraded: ${status.degraded}`, { bold: true, color: THEME.bad })] : []),
    ], 'anatole-status-b'),
  )
  rows.push(text(ctx, ` ${UNAUTH} · written ${ago(status.updatedMs, ctx.nowMs)}${stale ? ' (an earlier session)' : ''}`, { dimColor: true }))

  return rows
}

function ruleList(ctx: Ctx, facts: AnatoleFacts): RenderElement[] {
  const rows = ruleRows(facts)
  const lead = Math.max(12, Math.min(30, ctx.columns - 70))
  const count = (mode: RuleMode): number => rows.filter(item => item.mode === mode).length

  return [
    subhead(ctx, 'Rules', `${rows.length} · ${count('block')} block · ${count('notify')} notify · ${count('off')} off`),
    row(ctx, [text(ctx, ' ID      ', { dimColor: true }), text(ctx, 'SEVERITY '.padEnd(9), { dimColor: true }), text(ctx, 'RULE'.padEnd(lead), { dimColor: true }), text(ctx, ' OWASP'.padEnd(20), { dimColor: true }), text(ctx, ' MODE · RECORD', { dimColor: true })], 'anatole-rules-head'),
    ...rows.map(item =>
      row(ctx, [
        text(ctx, ` ${item.meta.id} `, { bold: true, color: THEME.head }),
        text(ctx, `${item.meta.severity.padEnd(8)} `, { color: SEV_COLOR[item.meta.severity]() }),
        ctx.kit.Text({ color: THEME.info, wrap: 'truncate-end', children: clip(`${item.meta.title}`, lead).padEnd(lead) }),
        text(ctx, ` ${item.meta.owasp.join(',')}`.padEnd(20), { dimColor: true }),
        ...RULE_MODES.map(mode => ctx.kit.Button({ key: `anatole-rule-${item.meta.id}-${mode}`, label: ` ${mode} `, ...(mode === item.mode ? { variant: 'primary' as const } : { plain: true, dimColor: true }), onPress: () => void ctx.act.run('anatole-rule', `${item.meta.id} ${mode}`) })),
        text(ctx, ` ${item.hits} hits${item.ackedShare === null ? '' : ` · ${item.ackedShare}% acked`}${item.demoted ? ' · auto-demoted to notify' : item.changed ? ' · changed from default' : ''}`, item.demoted || item.changed ? { color: THEME.warn } : { dimColor: true }),
      ], `anatole-rule-${item.meta.id}`),
    ),
    note(ctx, 'Hits and acked share count the last 200 alerts the mod logged. A rule set to block takes effect only in mode enforce.'),
  ]
}

function alertRows(ctx: Ctx, alerts: readonly AnatoleAlert[]): RenderElement[] {
  const all = alerts.filter(alert => alert.state === 'open')
  const open = all.slice(-10).reverse()
  const head = subhead(ctx, 'Open alerts', all.length === 0 ? 'none' : all.length > open.length ? `${open.length} of ${all.length}` : String(all.length))

  if (open.length === 0) return [head, text(ctx, ' ✓ no open alerts', { color: THEME.ok })]

  return [
    head,
    ...open.flatMap(alert => [
      row(ctx, [
        text(ctx, ` ${alert.severity.padEnd(9)}`, { bold: true, color: SEV_COLOR[alert.severity]() }),
        text(ctx, `${alert.rule} ${alert.action === 'blocked' ? 'blocked' : 'notified'} `, { bold: true }),
        text(ctx, ` ${ago(alert.atMs, ctx.nowMs)} `, { dimColor: true }),
        button(ctx, `anatole-ack-${alert.id}`, 'ack', () => void ctx.act.run('anatole-ack', alert.id)),
        ...(alert.fp === null ? [] : [button(ctx, `anatole-allow-${alert.fp}`, 'allow', () => void ctx.act.run('anatole-allow', alert.fp ?? ''))]),
      ], `anatole-alert-${alert.id}`),
      ctx.kit.Text({ dimColor: true, wrap: 'wrap', children: `   ${alert.tool}: ${alert.summary}` }),
    ]),
  ]
}

/**
 * The Project Anatole section of Security & Doctor (ADR-453 §9): status, the rule list with its mode chips, run and replay, the mode chooser
 * and the open alerts. Every change asks first (the confirm row names its Effect); reset-baseline is a delete-class action.
 */
export function anatoleSection(ctx: Ctx): RenderElement[] {
  const facts = ctx.state.snapshot?.anatole

  if (facts === undefined || !facts.present) return section(ctx, 'sec-anatole', 'Project Anatole', 'not installed', [text(ctx, ` ${INSTALL_LINE}`, { dimColor: true })], false)

  const status = facts.status
  const open = status?.open.total ?? facts.alerts.filter(alert => alert.state === 'open').length
  const right = `${status?.mode ?? 'no status'} · ${open} open${status?.degraded !== false && status !== null ? ' · degraded' : ''}`
  const mode = status?.mode ?? null
  const children: RenderElement[] = [
    subhead(ctx, 'Status', status === null ? 'not reported yet' : ''),
    ...statusRows(ctx, facts),
    ...ruleList(ctx, facts),
    subhead(ctx, 'Actions'),
    row(ctx, [button(ctx, 'anatole-run', '▶ run', () => void ctx.act.run('anatole-run'), { primary: true }), button(ctx, 'anatole-replay', '▶ replay', () => void ctx.act.run('anatole-replay'))], 'anatole-actions'),
    note(ctx, '▶ run  scans the Claude configuration (settings, hooks, helpers) for exposure. The result opens in the Result panel.'),
    note(ctx, '▶ replay  shows what the recorded events would have fired under the current rules and baseline.'),
    subhead(ctx, 'Mode', mode ?? 'unknown'),
    chipRow(ctx, 'mode', 'anatole-mode', MODES, mode, (next: AnatoleMode) => void ctx.act.run('anatole-mode', next)),
    ...(mode !== null && MODE_NOTE[mode] !== undefined ? [note(ctx, MODE_NOTE[mode] ?? '')] : []),
    row(ctx, [button(ctx, 'anatole-reset', '⌫ reset baseline', () => void ctx.act.run('anatole-reset'))], 'anatole-reset-row'),
    note(ctx, 'Reset baseline forgets everything learned and starts again. It asks first.'),
    ...alertRows(ctx, facts.alerts),
  ]

  return section(ctx, 'sec-anatole', 'Project Anatole', right, [ctx.kit.Box({ key: 'anatole-card', flexDirection: 'column', borderStyle: 'round', borderColor: THEME.info, paddingX: 1, children })], open > 0)
}
