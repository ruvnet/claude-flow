/**
 * The ADRs page (ADR-480): the Architecture Decision Records of the project the console is running in. A health strip from the lint, a
 * searchable list, a detail with both directions of every link, the confirm-gated ways to propose a record and change a status, and the
 * mission section: attach records so Claude and the swarm are told what was decided, and compare changed files with the paths they name.
 * What it shows is washed when parsed (hooks/data/adr.ts); this view only lays it out. The scope check is a comparison of PATHS and the
 * suggestion a comparison of WORDS: the page says so, because nothing here proves a change follows a decision.
 */
import type { RenderElement } from 'claude-code'

import { adrOf, docOf, transitionsOf } from '../adr'
import { attachedOf, suggestFor } from '../adr-mission'
import { countsOf, filterDocs, graphOf, STATUSES, type AdrDoc, type AdrStatus } from '../data/adr'
import { activeMission, mcOf, progressOf } from '../mission-control'
import { button, col, kv, row, rule, section, text, THEME, type Ctx } from './common'

const PAGE = 14
const FINDINGS_SHOWN = 8
const COLOR: Record<AdrStatus, string> = { proposed: THEME.warn, accepted: THEME.ok, superseded: THEME.info, deprecated: THEME.info, rejected: THEME.bad, unknown: THEME.warn }

/** A sentence that wraps instead of being cut at the edge: the limits and the reasons must be readable whole. */
const para = (ctx: Ctx, children: string, props: { color?: string; bold?: boolean; dimColor?: boolean } = {}): RenderElement => ctx.kit.Text({ wrap: 'wrap', ...props, children })

const label = (doc: AdrDoc): string => (doc.number === null ? doc.file : String(doc.number).padStart(4, '0'))

function listRow(ctx: Ctx, doc: AdrDoc, isPicked: boolean): RenderElement {
  const press = () => ctx.act.adrs.select(isPicked ? null : doc.file)
  const status = doc.status === 'unknown' ? 'no status' : doc.status

  return row(
    ctx,
    [
      ctx.kit.Button({ key: `adr-row-${doc.file}`, label: ` ${isPicked ? '▸' : ' '} ${label(doc)} `, plain: true, ...(isPicked && { variant: 'primary' as const }), onPress: press }),
      ctx.kit.Text({ color: COLOR[doc.status], children: `${status.padEnd(11)}` }),
      ctx.kit.Button({ key: `adr-title-${doc.file}`, label: `${doc.title}${doc.date === null ? '' : `  · ${doc.date}`}`.slice(0, Math.max(10, ctx.columns - 26)), plain: true, dimColor: !isPicked, onPress: press }),
    ],
    `adr-line-${doc.file}`,
  )
}

function links(ctx: Ctx, title: string, docs: readonly AdrDoc[], key: string): RenderElement[] {
  if (docs.length === 0) return []

  return [
    row(ctx, [text(ctx, ` ${title.padEnd(15)}`, { dimColor: true }), ...docs.slice(0, 6).map(doc => ctx.kit.Button({ key: `adr-link-${key}-${doc.file}`, label: ` ${label(doc)} `, plain: true, onPress: () => ctx.act.adrs.select(doc.file) }))], `adr-links-${key}`),
  ]
}

function detail(ctx: Ctx, doc: AdrDoc): RenderElement[] {
  const adr = adrOf(ctx.state)
  const graph = graphOf(adr.registry, doc)
  const mission = activeMission(ctx.state)
  const isAttached = mission !== null && attachedOf(mission).includes(doc.file)
  const missionsCiting = [...mcOf(ctx.state).missions.values()].filter(each => attachedOf(each).includes(doc.file))
  const rows: RenderElement[] = [rule(ctx, `ADR ${doc.number ?? '?'}: ${doc.title}`.slice(0, Math.max(10, ctx.columns - 20)), doc.status === 'unknown' ? 'no status' : doc.status)]

  rows.push(kv(ctx, 'file', `${adr.dir ?? ''}/${doc.file}`), kv(ctx, 'status', doc.statusRaw === '' ? 'none written' : doc.statusRaw, COLOR[doc.status]), kv(ctx, 'date', doc.date ?? 'n/a'), kv(ctx, 'format', doc.format === 'madr' ? 'MADR (front matter)' : doc.format === 'nygard' ? 'Nygard / adr-tools (Status section)' : doc.format === 'inline' ? 'Status line' : 'no status written'))
  if (doc.scope.length > 0) rows.push(kv(ctx, 'scope (paths)', doc.scope.slice(0, 5).join(', ')))
  rows.push(...links(ctx, 'supersedes', graph.supersedes, 'sup'), ...links(ctx, 'superseded by', graph.supersededBy, 'by'), ...links(ctx, 'related', graph.relates, 'rel'), ...links(ctx, 'cited by ADRs', graph.citedBy, 'cit'))
  if (doc.refs.length > 0) rows.push(kv(ctx, 'issues / PRs', doc.refs.slice(0, 8).map(n => `#${n}`).join(' ')))
  rows.push(kv(ctx, 'cited by missions', missionsCiting.length === 0 ? 'none attached' : missionsCiting.map(each => each.id.slice(0, 12)).join(', ')))

  for (const [name, body] of [['Context', doc.context], ['Decision', doc.decision], ['Consequences', doc.consequences]] as const) if (body !== '') rows.push(para(ctx, ` ${name}: ${body}`, name === 'Decision' ? { color: THEME.info } : { dimColor: true }))
  for (const note of doc.notes.slice(0, 3)) rows.push(text(ctx, ` note: ${note}`, { color: THEME.warn }))

  const buttons: RenderElement[] = transitionsOf(doc).filter(to => to !== 'superseded').map(to => button(ctx, `adr-to-${to}`, `mark ${to}`, () => ctx.act.adrs.status(doc.file, to)))

  if (mission !== null) buttons.push(button(ctx, 'adr-attach', isAttached ? '− detach from mission' : '＋ attach to mission', () => ctx.act.adrs.attach(doc.file, !isAttached)))
  rows.push(row(ctx, buttons, 'adr-detail-actions'))

  if (transitionsOf(doc).includes('superseded') && ctx.kit.Input !== undefined) rows.push(ctx.kit.Input({ key: `adr-super-${doc.file}`, label: '  ▸ superseded by', placeholder: 'the number of the record that replaces this one: Enter shows the change', submitLabel: 'supersede', onSubmit: value => ctx.act.adrs.supersede(doc.file, value) }))

  return rows
}

function health(ctx: Ctx): RenderElement[] {
  const adr = adrOf(ctx.state)
  const counts = countsOf(adr.registry, adr.findings)
  const line = `${counts.total} records · ${counts.byStatus.accepted} accepted · ${counts.byStatus.proposed} proposed · ${counts.byStatus.superseded} superseded · ${counts.byStatus.deprecated} deprecated · ${counts.byStatus.rejected} rejected${counts.byStatus.unknown > 0 ? ` · ${counts.byStatus.unknown} no status` : ''}`

  return [
    text(ctx, ` ${line}`, { dimColor: true }),
    para(ctx, ` health: ${counts.errors} error${counts.errors === 1 ? '' : 's'} · ${counts.warns} warning${counts.warns === 1 ? '' : 's'} (duplicate numbers, dangling or one-sided supersedes, no status or date, missing from the folder’s index, broken links)`, { color: counts.errors > 0 ? THEME.bad : counts.warns > 0 ? THEME.warn : THEME.ok }),
    ...section(ctx, 'findings', 'Lint', `${adr.findings.length} finding${adr.findings.length === 1 ? '' : 's'}`, adr.findings.slice(0, FINDINGS_SHOWN).map(finding => text(ctx, ` ${finding.level === 'error' ? '✗' : finding.level === 'warn' ? '!' : '·'} ${finding.file === '' ? '' : `${finding.file}: `}${finding.text}`, finding.level === 'error' ? { color: THEME.bad } : finding.level === 'warn' ? { color: THEME.warn } : { dimColor: true })), false),
  ]
}

function missionRows(ctx: Ctx): RenderElement[] {
  const adr = adrOf(ctx.state)
  const mission = activeMission(ctx.state)

  if (mission === null) return [para(ctx, ' No active mission. In Missions, create one: its ADRs are attached here, and Claude and the swarm are told the accepted decisions. The check of changed files compares paths only and does not prove a change follows a decision.', { dimColor: true })]

  const attached = attachedOf(mission).map(file => docOf(ctx.state, file) ?? null)
  const suggestions = suggestFor(ctx.state, mission, mission.objective)
  const rows: RenderElement[] = [text(ctx, ` mission ${mission.id.slice(0, 12)}: ${mission.objective.slice(0, Math.max(10, ctx.columns - 24))}`, { bold: true })]

  if (attached.length === 0) rows.push(text(ctx, ' no ADR attached yet', { dimColor: true }))
  for (const [index, doc] of attached.entries()) {
    const file = attachedOf(mission)[index] as string

    rows.push(row(ctx, [text(ctx, doc === null ? `  ${file} (no longer in the folder)` : `  ADR ${doc.number ?? doc.file} [${doc.status}] ${doc.title}`.slice(0, Math.max(10, ctx.columns - 14)), doc === null ? { dimColor: true } : { color: doc.status === 'accepted' ? THEME.ok : THEME.warn }), button(ctx, `adr-detach-${file}`, '−', () => ctx.act.adrs.attach(file, false))], `adr-att-${file}`))
  }

  if (suggestions.length > 0) {
    rows.push(text(ctx, ' suggested from the mission goal (words only; you decide):', { dimColor: true }))
    for (const suggestion of suggestions) rows.push(row(ctx, [button(ctx, `adr-sug-${suggestion.doc.file}`, `＋ ADR ${suggestion.doc.number ?? suggestion.doc.file}`, () => ctx.act.adrs.attach(suggestion.doc.file, true)), text(ctx, ` ${suggestion.doc.title.slice(0, 40)} · ${suggestion.why}`.slice(0, Math.max(10, ctx.columns - 22)), { dimColor: true })], `adr-sugrow-${suggestion.doc.file}`))
  }

  const progress = progressOf(mission, ctx.state.snapshot?.tasks ?? [])

  if (progress.total > 0 && progress.done >= progress.total) rows.push(text(ctx, ' this mission is finished: if it decided something worth keeping, draft an ADR below (a person writes the decision)', { color: THEME.ok }))
  rows.push(row(ctx, [button(ctx, 'adr-scope', '▸ check changed files against the attached ADRs', () => ctx.act.adrs.scope()), button(ctx, 'adr-draft', '▸ draft an ADR from this mission', () => ctx.act.adrs.draft())], 'adr-mission-actions'))
  if (adr.scope !== null) rows.push(...adr.scope.hits.slice(0, 6).map(hit => text(ctx, `  ! ${hit.file} is in the scope of ADR ${hit.adr.number ?? hit.adr.file} (${hit.entry})`, { color: THEME.warn })))

  rows.push(para(ctx, ' This compares file PATHS with the paths an ADR names, and the suggestion compares WORDS. A warning is a reason to read the ADR; silence is not a clearance, and nothing here proves a change follows or breaks a decision. It is a warning in the mission record, never a block.', { dimColor: true }))

  return rows
}

export function adrsView(ctx: Ctx): RenderElement {
  const adr = adrOf(ctx.state)
  const rows: RenderElement[] = [rule(ctx, 'ADRs', adr.dir === null ? 'your project’s decisions' : `${adr.dir} · ${adr.style.name} · ${adr.style.pattern}${adr.style.source === 'detected' ? ' (detected)' : adr.style.source === 'setting' ? ' (your setting)' : ''}`)]

  if (!adr.isLoaded) {
    rows.push(text(ctx, adr.isLoading ? ' reading your project’s ADR folder…' : ' not read yet', { dimColor: true }), button(ctx, 'adr-load', '▸ read the ADR folder', () => ctx.act.adrs.reload()))

    return col(ctx, rows, 'adrs')
  }

  if (adr.dir === null) {
    rows.push(text(ctx, ` ${adr.why}`, { color: THEME.warn }), para(ctx, ' Your project has no ADR folder the console can read. “Initialise ADRs here” asks first, then creates docs/adr (or the folder named in Settings → ADR folder) and a first record, 0001-record-architecture-decisions.md. Nothing is overwritten.', { dimColor: true }), row(ctx, [button(ctx, 'adr-init', '▸ initialise ADRs here', () => ctx.act.adrs.init(), { primary: true }), button(ctx, 'adr-reload', '↻ look again', () => ctx.act.adrs.reload()), button(ctx, 'adr-settings', '→ Settings (folder, style)', () => ctx.act.view('settings'))], 'adr-empty-actions'))
    if (adr.last !== null) rows.push(text(ctx, ` ${adr.last.label}: ${adr.last.lines.join(' · ')}`, { color: adr.last.ok ? THEME.ok : THEME.bad }))

    return col(ctx, rows, 'adrs')
  }

  if (adr.why !== '') rows.push(text(ctx, ` ${adr.why}`, { color: THEME.warn }))
  rows.push(...health(ctx))

  const list = filterDocs(adr.registry.docs, adr.filter)
  const total = Math.max(1, Math.ceil(list.length / PAGE))
  const page = Math.min(adr.page, total - 1)
  const setPage = (to: number) => ctx.act.adrs.page(Math.max(0, Math.min(total - 1, to)))

  rows.push(row(ctx, [text(ctx, ' status ', { dimColor: true }), ...(['all', ...STATUSES] as const).map(status => ctx.kit.Button({ key: `adr-f-${status}`, label: ` ${adr.filter.status === status ? '●' : '○'} ${status}`, plain: true, ...(adr.filter.status === status && { variant: 'primary' as const }), onPress: () => ctx.act.adrs.filter({ status }) })), button(ctx, 'adr-reload', '↻', () => ctx.act.adrs.reload())], 'adr-filters'))

  const Input = ctx.kit.Input

  if (Input === undefined) rows.push(text(ctx, ' filter and propose: from the palette (p): adr-propose <title>; this surface has no text fields', { dimColor: true }))
  else {
    rows.push(Input({ key: 'adr-filter', label: '  ▸ filter', placeholder: 'a word from a title, a file name or a path: Enter filters', submitLabel: 'filter', onSubmit: value => ctx.act.adrs.filter({ text: value }) }))
    rows.push(Input({ key: 'adr-scope-filter', label: '  ▸ in scope', placeholder: 'a path fragment an ADR names, e.g. src/auth: Enter filters', submitLabel: 'filter', onSubmit: value => ctx.act.adrs.filter({ scope: value }) }))
    rows.push(Input({ key: 'adr-propose', label: '  ▸ propose', placeholder: 'a title: Enter shows the new file and asks before writing it', submitLabel: 'propose', onSubmit: value => ctx.act.adrs.propose(value) }))
  }

  if (adr.last !== null) rows.push(text(ctx, ` ${adr.last.label}: ${adr.last.ok ? '✓' : '✗'}`, { bold: true, color: adr.last.ok ? THEME.ok : THEME.bad }), ...adr.last.lines.slice(0, 12).map(line => text(ctx, `   ${line}`, { dimColor: true })))

  const picked = adr.selected === null ? undefined : docOf(ctx.state, adr.selected)

  if (picked !== undefined) rows.push(...detail(ctx, picked))

  rows.push(rule(ctx, 'Records', `${list.length} shown · page ${page + 1} of ${total}${adr.filter.text !== '' || adr.filter.scope !== '' ? ' · filtered' : ''}`))
  for (const doc of list.slice(page * PAGE, page * PAGE + PAGE)) rows.push(listRow(ctx, doc, doc.file === adr.selected))
  if (list.length === 0) rows.push(text(ctx, ' nothing matches this filter', { dimColor: true }))
  rows.push(row(ctx, [button(ctx, 'adr-prev', '◂ prev', () => setPage(page - 1), { hotkey: 'k' }), button(ctx, 'adr-next', 'next ▸', () => setPage(page + 1), { hotkey: 'j' })], 'adr-pages'))
  rows.push(...section(ctx, 'mission', 'Missions, loops and swarms', 'attached ADRs reach Claude and the swarm', missionRows(ctx), true))

  return col(ctx, rows, 'adrs')
}
