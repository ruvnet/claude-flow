import type { RenderElement } from 'claude-code'

import { sortedFound, type FoundSkill, type InstalledSkill } from '../data/skills'
import { ago, clip, col, row, rule, text, THEME, type Ctx } from './common'
import { authorRows, maintainRows, previewRows, projectRows, targetRows } from './skills-more'

const SHOWN = 10

/** One dotted-leader row, as the x.ruv.io board lists its menu: the name, what it is, then its ▸ actions. */
function leader(ctx: Ctx, key: string, name: string, about: string, actions: readonly { key: string; label: string; onPress: () => void }[], color = THEME.head): RenderElement {
  const lead = Math.max(18, Math.min(34, ctx.columns - 56))

  return row(
    ctx,
    [
      ctx.kit.Text({ bold: true, color, children: clip(` ${name} `, lead).padEnd(lead, '.') }),
      ctx.kit.Text({ color: THEME.info, wrap: 'truncate-end', children: clip(` ${about}`, Math.max(4, ctx.columns - lead - actions.length * 11)) }),
      ...actions.map(action => ctx.kit.Button({ key: action.key, label: ` ▸ ${action.label}`, plain: true, dimColor: true, onPress: action.onPress })),
    ],
    `${key}-row`,
  )
}

function installedRows(ctx: Ctx): RenderElement[] {
  const { state, nowMs } = ctx
  const skills = state.skills
  const installed = skills.installed ?? []
  const count = (scope: InstalledSkill['scope']) => installed.filter(skill => skill.scope === scope).length
  const right = skills.isListing ? 'listing…' : skills.installed === null ? 'not listed yet' : `${count('project')} project · ${count('global')} global · ${ago(skills.listedAtMs, nowMs)}`
  const rows: RenderElement[] = [rule(ctx, 'Installed', right)]

  for (const [scope, error] of Object.entries(skills.listErrors)) rows.push(text(ctx, ` ${scope} list unreadable: ${error}`, { color: THEME.warn }))

  if (skills.installed === null) {
    rows.push(text(ctx, skills.isListing ? ' asking npx -y skills ls --json (project) and ls -g --json (global)… the first run downloads the CLI' : ' not listed yet: r lists them (npx -y skills ls --json)', { dimColor: true }))
  } else if (installed.length === 0 && Object.keys(skills.listErrors).length === 0) {
    rows.push(text(ctx, ' no skills in this project or globally: search below and ▸ add one', { dimColor: true }))
  }

  installed.slice(0, SHOWN).forEach((skill, i) => {
    rows.push(
      leader(ctx, `sk-in-${i}`, skill.name, `${skill.scope === 'global' ? 'global ' : 'project'} · ${skill.agents.length > 0 ? skill.agents.join(', ') : 'no agent links'}`, [
        { key: `sk-update-${i}`, label: 'update', onPress: () => ctx.act.skills.update(skill) },
        { key: `sk-remove-${i}`, label: 'remove', onPress: () => ctx.act.skills.remove(skill) },
        { key: `sk-edit-${i}`, label: 'edit', onPress: () => ctx.act.skills.edit(skill) },
        { key: `sk-view-${i}`, label: 'view', onPress: () => ctx.act.skills.previewInstalled(skill) },
      ], skill.scope === 'global' ? THEME.ok : THEME.head),
    )
    rows.push(text(ctx, `   ${skill.path}${skill.source !== undefined ? ` · from ${skill.source}` : ''}`, { dimColor: true }))
  })

  if (installed.length > SHOWN) rows.push(text(ctx, ` +${installed.length - SHOWN} more: npx skills ls shows them all`, { dimColor: true }))

  return rows
}

function searchRows(ctx: Ctx): RenderElement[] {
  const skills = ctx.state.skills
  const rows: RenderElement[] = [rule(ctx, 'Search', `skills.sh · npx skills find · ${skills.sort === 'installs' ? 'most installed first' : 'as found'}`)]

  if (ctx.kit.Input !== undefined) {
    rows.push(
      ctx.kit.Input({
        key: 'skills-search',
        label: 'find',
        placeholder: 'a word or two: react, testing · owner:vercel-labs deploy narrows to one GitHub owner',
        value: skills.searchDraft,
        submitLabel: 'search',
        onInput: value => ctx.act.skills.searchDraft(value),
        onSubmit: value => ctx.act.skills.search(value),
      }),
    )
  } else {
    rows.push(text(ctx, ' this surface has no text field: run npx skills find <query> instead', { dimColor: true }))
  }

  if (skills.isFinding) rows.push(text(ctx, ` asking skills.sh for "${skills.query}"…`, { dimColor: true }))
  else if (skills.findError !== null) rows.push(text(ctx, ` search failed: ${skills.findError}`, { color: THEME.warn }))
  else if (skills.found !== null && skills.found.length === 0) rows.push(text(ctx, ` no skills found for "${skills.query}"`, { dimColor: true }))
  else if (skills.found === null) rows.push(text(ctx, ' Enter searches skills.sh (it is on the network, so nothing is asked until you do)', { dimColor: true }))

  sortedFound(skills.found ?? [], skills.sort).slice(0, SHOWN).forEach((found: FoundSkill, i) => {
    rows.push(
      leader(ctx, `sk-found-${i}`, found.id, found.installs !== undefined ? `${found.installs} installs` : 'installs n/a', [
        { key: `sk-use-${i}`, label: 'use', onPress: () => ctx.act.skills.use(found) },
        { key: `sk-preview-${i}`, label: 'preview', onPress: () => ctx.act.skills.previewFound(found) },
        { key: `sk-add-${i}`, label: 'add', onPress: () => ctx.act.skills.add(found, skills.scope) },
      ]),
    )
  })

  if ((skills.found?.length ?? 0) > 0) {
    rows.push(
      row(ctx, [
        ctx.kit.Button({ key: 'sk-sort', label: skills.sort === 'installs' ? ' ▸ sort: as found' : ' ▸ sort: most installed', plain: true, dimColor: true, onPress: () => ctx.act.skills.sortBy() }),
        text(ctx, ` · ▸ use hands the skill to claude without installing · ▸ preview lists its repo · ▸ add installs to ${skills.scope} (asks first)`, { dimColor: true }),
      ]),
    )
  }

  return rows
}

function createRows(ctx: Ctx): RenderElement[] {
  const skills = ctx.state.skills
  const rows: RenderElement[] = [rule(ctx, 'Create', 'npx skills init <name> · here')]

  if (ctx.kit.Input !== undefined) {
    rows.push(
      ctx.kit.Input({
        key: 'skills-create',
        label: 'name',
        placeholder: 'my-skill: makes my-skill/SKILL.md in this project',
        value: skills.createDraft,
        submitLabel: 'create',
        onInput: value => ctx.act.skills.createDraft(value),
        onSubmit: value => ctx.act.skills.create(value),
      }),
    )
  }

  rows.push(text(ctx, ' Enter shows the command, Enter again (or y) runs it · ▸ edit opens a skill in the AI terminal with claude', { dimColor: true }))
  rows.push(...authorRows(ctx))

  return rows
}

/**
 * Agent skills through the `skills` CLI (vercel-labs, skills.sh): what is installed in this project and globally, a
 * search of skills.sh, and a field to start a new one. Every change is asked first with its exact argv; ▸ edit puts a
 * prompt in the AI terminal rather than writing anything here.
 */
export function skillsView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const skills = state.skills
  const status: RenderElement[] = []

  if (skills.busy !== null) status.push(text(ctx, ` running: ${skills.busy}…`, { bold: true, color: THEME.warn }))
  else if (skills.last !== null) {
    status.push(text(ctx, ` ${skills.last.ok ? '✓' : '✗'} ${skills.last.label}${skills.last.verified === 'yes' ? ' · listed' : skills.last.verified === 'no' ? ' · not listed' : ''}: ${skills.last.detail} (${ago(skills.last.atMs, nowMs)})`, { color: skills.last.ok ? THEME.ok : THEME.bad }))
  }

  return col(ctx, [...status, ...targetRows(ctx), ...installedRows(ctx), ...searchRows(ctx), ...previewRows(ctx), ...projectRows(ctx), ...createRows(ctx), ...maintainRows(ctx)], 'skills')
}
