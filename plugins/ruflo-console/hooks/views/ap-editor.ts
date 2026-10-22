/**
 * The envelope's list editor (ADR-470 §2.1): folders, repositories, network hosts, secret variable NAMES and verify commands, each a list
 * of rows with a remove button and one field to add an entry, on the draft the panel's other buttons also change. Every edit is checked
 * by the same validator the sealed file is opened with (data/ap-edit.ts); a refused edit changes nothing and says why. Below the lists:
 * the draft as a diff against the approved envelope, and the verify commands in full, which is also what the Start card will list. This
 * edits a proposal in memory: nothing is granted until the confirmed Start.
 */
import type { RenderElement } from 'claude-code'

import { hostOf } from '../ap-live'
import { addEntry, diffRows, LIST_KEYS, removeEntry, type ListKey } from '../data/ap-edit'
import { validateEnvelope, type Envelope } from '../data/ap-envelope'
import { cleanText } from '../data/wf-clean'
import type { DraftState } from './ap-draft'
import { button, clip, row, text, THEME, type Ctx } from './common'

const LABEL: Record<ListKey, { name: string; hint: string }> = {
  paths: { name: 'folders', hint: 'an absolute folder, e.g. /home/me/project' },
  repos: { name: 'repos', hint: 'owner/name, e.g. ruvnet/ruflo' },
  network: { name: 'network hosts', hint: 'a lowercase hostname, no port: api.github.com' },
  secretEnv: { name: 'secret env names', hint: 'a variable NAME (never a value): GH_TOKEN' },
  verify: { name: 'verify commands', hint: 'program and arguments split on spaces: node --test' },
}

/** Adds an entry to the draft when the validator accepts the result; the reason it did not is kept on the draft. */
export function applyAdd(d: DraftState, key: ListKey, raw: string): boolean {
  const done = addEntry(d.value, key, raw)

  d.refused = done.ok ? null : `${LABEL[key].name}: ${cleanText(done.why).replace(/^(paths|repos|network|secretEnv|verify): /, '').slice(0, 160)}`
  if (done.ok) {
    d.value = done.value
    d.fromFile = null
  }

  return done.ok
}

export function applyRemove(d: DraftState, key: ListKey, index: number): boolean {
  const done = removeEntry(d.value, key, index)

  d.refused = done.ok ? null : `${LABEL[key].name}: ${cleanText(done.why).replace(/^(paths|repos|network|secretEnv|verify): /, '').slice(0, 160)}`
  if (done.ok) {
    d.value = done.value
    d.fromFile = null
  }

  return done.ok
}

const show = (key: ListKey, item: unknown): string => (key === 'verify' && Array.isArray(item) ? (item as string[]).join(' ') : String(item))

/** The list rows, the refusal, the diff against the approved envelope and the verify commands in full. */
export function editorLists(ctx: Ctx, d: DraftState, approved: Envelope | null): RenderElement[] {
  const host = hostOf(ctx.state)
  const rows: RenderElement[] = [text(ctx, ' lists (every edit is checked by the validator the sealed envelope is opened with; a refused edit changes nothing)', { dimColor: true })]

  for (const key of LIST_KEYS) {
    const items = Array.isArray(d.value[key]) ? (d.value[key] as unknown[]) : []

    rows.push(text(ctx, ` ${LABEL[key].name}${items.length === 0 ? ': none' : ''}`, { dimColor: true }))

    for (const [i, item] of items.entries()) {
      rows.push(row(ctx, [
        button(ctx, `ap-rm-${key}-${i}`, ' remove ', () => {
          applyRemove(d, key, i)
          host?.invalidate()
        }),
        text(ctx, ` ${clip(cleanText(show(key, item)), Math.max(20, ctx.columns - 20))}`),
      ], `ap-row-${key}-${i}`))
    }

    rows.push(ctx.kit.Input === undefined
      ? text(ctx, `   (no text field on this surface: edit ${key} in the draft file)`, { dimColor: true })
      : ctx.kit.Input({
        key: `ap-add-${key}`,
        label: `add to ${LABEL[key].name}`,
        placeholder: LABEL[key].hint,
        submitLabel: 'add',
        onSubmit: value => {
          applyAdd(d, key, value)
          host?.invalidate()
        },
      }))
  }

  if (d.refused !== null) rows.push(text(ctx, ` refused: ${d.refused}`, { color: THEME.bad }))

  rows.push(text(ctx, ' against the approved envelope:', { dimColor: true }))
  for (const line of diffRows(approved, d.value)) rows.push(text(ctx, `   ${cleanText(line)}`, { color: line.startsWith('+') ? THEME.warn : undefined, dimColor: !line.startsWith('+') }))

  const checked = validateEnvelope(d.value)

  rows.push(text(ctx, checked.ok && checked.envelope.verify.length > 0 ? ` Start will run, after each step, through this console: ${checked.envelope.verify.map(argv => cleanText(argv.join(' '))).join(' ; ')}` : ' no verify command: steps will be recorded as unverified', { dimColor: true }))

  return rows
}
