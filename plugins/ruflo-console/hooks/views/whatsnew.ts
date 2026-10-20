/**
 * What's new (ADR-478): what changed in the ruflo plugins installed here, newest first, from each plugin's own bundled CHANGELOG.md.
 * Breaking changes are pinned at the top until dismissed; a divider marks where the person last looked; nothing is fetched (a newer
 * published ruflo-console is named from the daily update check's own result, with the place to read its notes as plain text).
 * Every line shown was washed when the file was parsed (hooks/data/changelog.ts); this view only lays it out.
 */
import type { RenderElement } from 'claude-code'

import { compareVersions, entriesAfter, MARK, type ChangeEntry, type ChangeKind } from '../data/changelog'
import { tidy } from '../toast-policy'
import { CONSOLE_VERSION } from '../version'
import { CONSOLE_NAME, NOTES_URL, pinnedOf, RELEASES_URL, versionIn, type Log } from '../whatsnew'
import { button, col, row, rule, section, text, THEME, type Ctx } from './common'

const MAX_NEW = 40
const MAX_EARLIER = 24
const PER_ENTRY = 6

type Shown = { name: string; entry: ChangeEntry }

const colorOf = (kind: ChangeKind): { color?: string; bold?: boolean; dimColor?: boolean } => (kind === 'breaking' ? { color: THEME.bad, bold: true } : kind === 'feat' ? { color: THEME.ok } : kind === 'fix' ? { color: THEME.info } : { dimColor: true })

const newest = (a: Shown, b: Shown): number => (a.entry.date === b.entry.date ? compareVersions(b.entry.version, a.entry.version) || a.name.localeCompare(b.name) : a.entry.date < b.entry.date ? 1 : -1)

/** One entry: its heading, then its changes (a few, the rest counted). */
function entryRows(ctx: Ctx, name: string, entry: ChangeEntry): RenderElement[] {
  const shown = entry.changes.slice(0, PER_ENTRY)
  const rest = entry.changes.length - shown.length + entry.more

  return [
    text(ctx, ` ${name} ${entry.version} · ${entry.date}`, { bold: true, color: THEME.head }),
    ...shown.map(change => text(ctx, `   ${MARK[change.kind].padEnd(10)} ${change.text}`, colorOf(change.kind))),
    ...(rest > 0 ? [text(ctx, `   … ${rest} more in the full notes`, { dimColor: true })] : []),
  ]
}

const okLogs = (logs: readonly Log[]): (Log & { result: { ok: true; entries: ChangeEntry[]; truncated: boolean } })[] => logs.filter((log): log is Log & { result: { ok: true; entries: ChangeEntry[]; truncated: boolean } } => log.result.ok)

/** The entries the person has not looked at: those past the version last seen (a plugin first seen shows its newest entry only). */
function freshOf(log: ReturnType<typeof okLogs>[number], before: Record<string, string> | null): ChangeEntry[] {
  if (before === null) return []

  const seen = versionIn(before, log.name)

  return seen === undefined ? log.result.entries.slice(0, 1) : entriesAfter(log.result.entries, seen)
}

const reasonOf = (log: Log): string => (log.result.ok ? '' : log.result.reason === 'garbled' || log.result.reason === 'empty' ? 'its CHANGELOG.md is not in the expected format' : log.result.reason === 'too-large' ? 'its CHANGELOG.md is too large to read' : log.result.reason === 'unreadable' ? 'its CHANGELOG.md could not be read' : 'no CHANGELOG.md bundled')

export function whatsnewView(ctx: Ctx): RenderElement {
  const { state } = ctx
  const wn = state.whatsnew
  const ok = okLogs(wn.logs)
  const fresh: Shown[] = ok.flatMap(log => freshOf(log, wn.before).map(entry => ({ name: log.name, entry }))).sort(newest)
  const freshKeys = new Set(fresh.map(item => `${item.name}@${item.entry.version}`))
  const earlier: Shown[] = ok.flatMap(log => log.result.entries.filter(entry => !freshKeys.has(`${log.name}@${entry.version}`)).slice(0, 2).map(entry => ({ name: log.name, entry }))).sort(newest)
  const pins = pinnedOf(state)
  const missing = wn.logs.filter(log => !log.result.ok)
  const toastOn = wn.rec?.toast !== false
  const parts: RenderElement[] = [rule(ctx, 'What’s new', `${CONSOLE_NAME} ${CONSOLE_VERSION}`)]

  parts.push(
    state.updateAvailable === ''
      ? text(ctx, ` no newer ${CONSOLE_NAME} is known${state.updateNote === '' ? '' : `: ${tidy(state.updateNote, 100)}`}`, { dimColor: true })
      : col(ctx, [text(ctx, ` ⬆ ${CONSOLE_NAME} ${tidy(state.updateAvailable, 20)} is published (you run ${CONSOLE_VERSION}); Settings → Updates installs it.`, { color: THEME.warn }), text(ctx, `   Its notes are not fetched here: read them at ${RELEASES_URL}`, { dimColor: true })], 'whatsnew-update'),
    row(
      ctx,
      [
        button(ctx, 'whatsnew-check', '↻ check for an update now', () => ctx.act.checkUpdates()),
        text(ctx, ' '),
        button(ctx, 'whatsnew-toast', `${toastOn ? '☑' : '☐'} toast when something new lands`, () => ctx.act.whatsnew.toggleToast()),
      ],
      'whatsnew-actions',
    ),
  )

  if (pins.length > 0) {
    const pinRows = pins.flatMap(pin => [
      row(ctx, [text(ctx, ` ‼ ${pin.name} ${pin.version}`, { bold: true, color: THEME.bad }), text(ctx, ' '), button(ctx, `whatsnew-dismiss-${pin.name}-${pin.version}`, '✕ dismiss', () => ctx.act.whatsnew.dismiss(pin.key))], `whatsnew-pin-${pin.key}`),
      ...(pin.texts.length === 0 ? [text(ctx, '   breaking changes: see the full notes', { dimColor: true })] : pin.texts.slice(0, PER_ENTRY).map(words => text(ctx, `   ${words}`, { color: THEME.bad }))),
    ])

    parts.push(...section(ctx, 'pinned', 'Breaking changes', `${pins.length} pinned until you dismiss`, [...pinRows, ...(pins.length > 1 ? [button(ctx, 'whatsnew-dismiss-all', '✕ dismiss all', () => ctx.act.whatsnew.dismissAll())] : [])]))
  }

  if (wn.isLoading && wn.logs.length === 0) parts.push(text(ctx, ' reading the changelogs…', { dimColor: true }))
  else if (ok.length === 0) parts.push(text(ctx, ` No installed ruflo plugin ships a readable CHANGELOG.md yet (${missing.length} checked). Versions published from now on include one.`, { color: THEME.warn }))

  if (ok.length > 0) {
    parts.push(...section(ctx, 'new', 'Since you last looked', fresh.length === 0 ? 'nothing new' : `${fresh.length} update${fresh.length === 1 ? '' : 's'}`, fresh.length === 0 ? [text(ctx, ' nothing has changed since you last opened this page', { dimColor: true })] : fresh.slice(0, MAX_NEW).flatMap(item => entryRows(ctx, item.name, item.entry))))
    parts.push(text(ctx, ` ${'─'.repeat(6)} you last looked here ${'─'.repeat(6)}`, { dimColor: true }))
    parts.push(...section(ctx, 'earlier', 'Earlier', `${Math.min(earlier.length, MAX_EARLIER)} shown`, earlier.slice(0, MAX_EARLIER).flatMap(item => entryRows(ctx, item.name, item.entry)), true))
    parts.push(...section(ctx, 'notes', 'Full notes', 'files and addresses, as text', ok.slice(0, 60).flatMap(log => [text(ctx, ` ${log.name} ${log.version}${log.result.truncated ? ' (long: the page shows the newest entries)' : ''}`, { bold: true }), text(ctx, `   ${log.path === null ? 'bundled with the plugin' : `${tidy(log.path, 140)}/CHANGELOG.md`}`, { dimColor: true }), text(ctx, `   ${NOTES_URL(log.name)}`, { dimColor: true })]), false))
  }

  if (missing.length > 0) parts.push(...section(ctx, 'missing', 'Without notes', `${missing.length} plugin${missing.length === 1 ? '' : 's'}`, missing.slice(0, 30).map(log => text(ctx, ` ${log.name} ${log.version}: ${reasonOf(log)}`, { dimColor: true })), false))

  return col(ctx, parts, 'whatsnew')
}
