import type { RenderElement } from 'claude-code'

import { AGENT_TARGETS, agentsOf } from '../data/skills'
import { ago, button, clip, row, rule, text, THEME, type Ctx } from './common'

/** Preview lines in view at once. */
export const PREVIEW_ROWS = 14

const plainButton = (ctx: Ctx, key: string, label: string, onPress: () => void, isOn = false): RenderElement => ctx.kit.Button({ key, label, plain: true, dimColor: !isOn, onPress })

/** Where ▸ add installs: the scope (one of two, clearly marked) and the agents named to `--agent`. */
export function targetRows(ctx: Ctx): RenderElement[] {
  const skills = ctx.state.skills
  const agents = agentsOf(skills.agents)
  const rows: RenderElement[] = [rule(ctx, 'Install to', `▸ add → ${skills.scope} · ${agents.length > 0 ? agents.join(' ') : 'the CLI’s default agents'}`)]

  rows.push(
    row(ctx, [
      text(ctx, ' scope  ', { dimColor: true }),
      plainButton(ctx, 'sk-scope-project', skills.scope === 'project' ? ' (●) project: this repo ' : ' ( ) project: this repo ', () => ctx.act.skills.scope('project'), skills.scope === 'project'),
      plainButton(ctx, 'sk-scope-global', skills.scope === 'global' ? ' (●) global: every project ' : ' ( ) global: every project ', () => ctx.act.skills.scope('global'), skills.scope === 'global'),
    ]),
  )
  rows.push(
    row(ctx, [
      text(ctx, ' agents ', { dimColor: true }),
      ...AGENT_TARGETS.map(agent => {
        const isOn = skills.agents.includes(agent.id)

        return plainButton(ctx, `sk-agent-${agent.id}`, ` [${isOn ? 'x' : ' '}] ${agent.label}`, () => ctx.act.skills.toggleAgent(agent.id), isOn)
      }),
    ]),
  )
  rows.push(text(ctx, ' none ticked: the CLI picks the agents it detects · update all and sync use the same choice', { dimColor: true }))

  return rows
}

/** The preview panel: an installed SKILL.md with its check, or a result's repository list. */
export function previewRows(ctx: Ctx): RenderElement[] {
  const { state, nowMs } = ctx
  const { preview, previewing, using } = state.skills
  const rows: RenderElement[] = []

  if (preview === null && previewing === null && using === null) return rows

  rows.push(rule(ctx, 'Preview', previewing !== null ? `reading ${clip(previewing, 40)}…` : preview === null ? '' : `${preview.kind === 'installed' ? 'local read' : 'add --list · nothing installed'} · ${ago(preview.atMs, nowMs)}`))

  if (using !== null) rows.push(text(ctx, ` ▸ fetching ${using} for the AI terminal (npx -y skills use)…`, { color: THEME.warn }))
  if (preview === null) return rows

  rows.push(
    row(ctx, [
      text(ctx, ` ${clip(preview.title, Math.max(10, ctx.columns - 12))} `, { bold: true, color: preview.ok ? THEME.ok : THEME.warn }),
      plainButton(ctx, 'sk-preview-close', ' ▸ close', () => ctx.act.skills.closePreview()),
    ]),
  )

  for (const line of preview.lines.slice(0, PREVIEW_ROWS)) {
    rows.push(text(ctx, `   ${line}`, line.startsWith('✗') ? { color: THEME.bad } : line.startsWith('!') ? { color: THEME.warn } : line.startsWith('✓') || line.startsWith('▸') ? { color: THEME.ok } : {}))
  }

  if (preview.lines.length > PREVIEW_ROWS) rows.push(text(ctx, `   … ${preview.lines.length - PREVIEW_ROWS} more lines`, { dimColor: true }))

  return rows
}

/** Searches matching this project's stack, and the skills its ruflo agents name: on ▸ scan only (local reads). */
export function projectRows(ctx: Ctx): RenderElement[] {
  const { state, nowMs } = ctx
  const { scan, isScanning } = state.skills
  const rows: RenderElement[] = [rule(ctx, 'For this project', isScanning ? 'scanning…' : scan === null ? 'not scanned · local reads only' : `scanned ${ago(scan.atMs, nowMs)}`)]

  rows.push(
    row(ctx, [
      plainButton(ctx, 'sk-scan', ' ▸ scan', () => ctx.act.skills.scan()),
      text(ctx, ' package.json, Cargo.toml, pyproject.toml, go.mod, .claude/skills, .agents/skills and .claude/agents: read here, nothing sent', { dimColor: true }),
    ]),
  )

  if (scan === null) return rows

  rows.push(
    row(ctx, [
      text(ctx, ` stack ${scan.stack.length > 0 ? scan.stack.join(', ') : 'n/a (no manifest at the root)'} `, { color: THEME.info }),
      ...scan.chips.map((chip, i) => plainButton(ctx, `sk-chip-${i}`, ` ▸ find ${chip}`, () => ctx.act.skills.chip(chip))),
    ]),
  )

  if (scan.local.length === 0) rows.push(text(ctx, ` no skills under .claude/skills or .agents/skills · ${scan.agentFiles} agent files read`, { dimColor: true }))
  else rows.push(text(ctx, ` skills your ruflo agents use · ${scan.local.length} local · ${scan.agentFiles} agent files read`, { bold: true }))

  for (const skill of scan.local.slice(0, 8)) {
    rows.push(text(ctx, `   ${skill.name} (${skill.where}) ← ${skill.refs.length > 0 ? skill.refs.join(', ') : 'no agent names it'}`, skill.refs.length > 0 ? { color: THEME.ok } : { dimColor: true }))
  }

  if (scan.local.length > 8) rows.push(text(ctx, `   +${scan.local.length - 8} more`, { dimColor: true }))
  for (const note of scan.notes) rows.push(text(ctx, ` ${note}`, { color: THEME.warn }))

  return rows
}

/** After ▸ create: claude writes it, the console checks its frontmatter. */
export function authorRows(ctx: Ctx): RenderElement[] {
  const { state, nowMs } = ctx
  const { check, authored } = state.skills
  const rows: RenderElement[] = [
    row(ctx, [
      text(ctx, ` ${authored !== null ? `${authored}/SKILL.md` : 'the named skill'} `, { dimColor: true }),
      plainButton(ctx, 'sk-author', ' ▸ write with claude', () => ctx.act.skills.author()),
      plainButton(ctx, 'sk-validate', ' ▸ validate', () => ctx.act.skills.validate()),
    ]),
  ]

  if (check !== null) {
    rows.push(text(ctx, ` ${check.name}/SKILL.md · checked ${ago(check.atMs, nowMs)}`, { dimColor: true }))
    for (const line of check.lines.slice(0, 6)) rows.push(text(ctx, `   ${line}`, line.startsWith('✓') ? { color: THEME.ok } : line.startsWith('✗') ? { color: THEME.bad } : line.startsWith('!') ? { color: THEME.warn } : {}))
  }

  return rows
}

/** Changes to many skills at once, each asked first with its argv and what it costs. */
export function maintainRows(ctx: Ctx): RenderElement[] {
  const skills = ctx.state.skills

  return [
    rule(ctx, 'Maintain', 'each asks first · network and writes named on the confirm row'),
    row(ctx, [
      button(ctx, 'sk-update-all', `update all (${skills.scope})`, () => ctx.act.skills.updateAll()),
      button(ctx, 'sk-restore', 'restore from skills-lock.json', () => ctx.act.skills.restore()),
      button(ctx, 'sk-sync', 'sync from node_modules', () => ctx.act.skills.sync()),
    ]),
    text(ctx, ' restore and sync are the CLI’s experimental_install and experimental_sync', { dimColor: true }),
  ]
}
