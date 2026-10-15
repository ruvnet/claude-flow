import type { RenderElement } from 'claude-code'

import { GROUP_BLURB, HELP_GROUPS, searchDocs, type Go, type HelpStep, type HelpTopic } from '../help-docs'
import { TOPICS, topicById } from '../help-topics'
import { START_LABEL } from '../starts'
import { VIEWS } from '../state'
import { button, clip, col, row, rule, section, text, THEME, wrap, type Ctx } from './common'

/** The words on a step's button: its own label, else what its target is. */
export function goLabel(step: HelpStep): string {
  if (step.label !== undefined) return `▸ ${step.label}`

  const go = step.go as Go

  if ('view' in go) return `▸ open ${VIEWS.find(view => view.id === go.view)?.label ?? go.view}`
  if ('start' in go) return `▸ ${START_LABEL[go.start]}`

  return '▸ run it'
}

/** A guide's steps: numbered lines that wrap, each with its button on the line below. */
function stepRows(ctx: Ctx, topic: HelpTopic, limit = topic.steps.length): RenderElement[] {
  const width = Math.max(30, ctx.columns - 8)

  return topic.steps.slice(0, limit).flatMap((step, i) => {
    const lines = wrap(step.text, width)
    const body = lines.map((line, n) => text(ctx, `${n === 0 ? ` ${String(i + 1).padStart(2)}. ` : '     '}${line}`, { color: THEME.head }))

    return step.go === undefined
      ? body
      : [...body, row(ctx, [text(ctx, '     '), button(ctx, `help-go-${topic.id}-${i}`, goLabel(step), () => ctx.act.ruhelp.go(step.go as Go))], `help-step-${topic.id}-${i}`)]
  })
}

/** One guide, whole: what it is for, the steps with their buttons, tips, and the guides to read next. */
function guideRows(ctx: Ctx, topic: HelpTopic): RenderElement[] {
  const width = Math.max(30, ctx.columns - 8)
  const related = (topic.related ?? []).map(topicById).filter((entry): entry is HelpTopic => entry !== null)

  return [
    rule(ctx, topic.title, topic.group),
    ...wrap(topic.summary, width).map(line => text(ctx, ` ${line}`, { bold: true })),
    ...stepRows(ctx, topic),
    ...(topic.tips ?? []).flatMap(tip => wrap(tip, width).map((line, n) => text(ctx, `${n === 0 ? ' tip ' : '     '}${line}`, { color: THEME.info, dimColor: true }))),
    ...(related.length === 0 ? [] : [row(ctx, [text(ctx, ' next ', { dimColor: true }), ...related.map(entry => button(ctx, `help-rel-${entry.id}`, entry.title, () => ctx.act.ruhelp.open(entry.id)))], 'help-related')]),
  ]
}

/** ruHelp's answer to a typed question: the best guide with its first steps, the other guides that matched, and the way to ask Claude. */
function answerRows(ctx: Ctx, query: string): RenderElement[] {
  const hits = searchDocs(TOPICS, query, 4)
  const best = hits[0]?.topic
  const ask = row(ctx, [text(ctx, ' '), button(ctx, 'help-ask-claude', '✦ ask Claude with these docs (starts a turn, asks first)', () => ctx.act.ruhelp.ask())], 'help-ask')

  if (best === undefined) {
    return [rule(ctx, 'ruHelp', 'no guide matches'), text(ctx, ' I could not find a guide for that. Try fewer or different words, or ask Claude.', { color: THEME.warn }), ask]
  }

  const width = Math.max(30, ctx.columns - 8)

  return [
    rule(ctx, 'ruHelp', `${hits.length} guide${hits.length === 1 ? '' : 's'} · best match first`),
    text(ctx, ` ${best.title}`, { bold: true, color: THEME.ok }),
    ...wrap(best.summary, width).map(line => text(ctx, ` ${line}`)),
    ...stepRows(ctx, best, 3),
    row(ctx, [text(ctx, ' '), button(ctx, `help-open-${best.id}`, best.steps.length > 3 ? `▸ the full guide (${best.steps.length} steps)` : '▸ open the guide', () => ctx.act.ruhelp.open(best.id), { primary: true })], 'help-best'),
    ...(hits.length > 1 ? [text(ctx, ' also', { dimColor: true }), ...hits.slice(1).map(hit => row(ctx, [text(ctx, '  '), button(ctx, `help-hit-${hit.topic.id}`, `${hit.topic.title} `.padEnd(32, '.'), () => ctx.act.ruhelp.open(hit.topic.id)), text(ctx, ` ${clip(hit.topic.summary, Math.max(10, ctx.columns - 44))}`, { dimColor: true })], `help-hit-row-${hit.topic.id}`))] : []),
    ask,
  ]
}

/** The index: a way in for a newcomer, then every guide by group. */
function indexRows(ctx: Ctx): RenderElement[] {
  const lead = Math.max(26, Math.min(34, ctx.columns - 50))
  const rows: RenderElement[] = [
    rule(ctx, 'Start here', 'new to ruflo? read these three, in order'),
    ...['tour', 'setup', 'mission'].flatMap((id, i) => {
      const topic = topicById(id)

      return topic === null ? [] : [row(ctx, [text(ctx, ` ${i + 1}. `, { bold: true, color: THEME.ok }), button(ctx, `help-start-${id}`, `${topic.title} `.padEnd(lead, '.'), () => ctx.act.ruhelp.open(id), i === 0 ? { primary: true } : {}), text(ctx, ` ${clip(topic.summary, Math.max(10, ctx.columns - lead - 12))}`, { dimColor: true })], `help-start-row-${id}`)]
    }),
  ]

  for (const group of HELP_GROUPS) {
    const topics = TOPICS.filter(topic => topic.group === group)

    rows.push(
      ...section(
        ctx,
        `help-${group}`,
        group,
        `${topics.length} · ${GROUP_BLURB[group]}`,
        topics.map(topic => row(ctx, [text(ctx, '  '), button(ctx, `help-topic-${topic.id}`, `${topic.title} `.padEnd(lead, '.'), () => ctx.act.ruhelp.open(topic.id)), text(ctx, ` ${clip(topic.summary, Math.max(10, ctx.columns - lead - 8))}`, { dimColor: true })], `help-topic-row-${topic.id}`)),
        group === 'Start' || group === 'Work',
      ),
    )
  }

  return rows
}

/**
 * The Help page: ruHelp, the help bot, then the documentation. A question typed in the ruHelp field is answered from the built-in guides
 * at once, for nothing (the best guide and its first steps, the other guides that matched), and can be sent on to Claude with those guides
 * as data. With no question, the guide for the page you opened help from, or the index: a "start here" path for a newcomer and every guide
 * by group. Each guide is a short how-to; each step has the button that does it (open the page, run it, start it).
 */
export function helpView(ctx: Ctx): RenderElement {
  const { state } = ctx
  const query = state.help.query.trim()
  const topic = topicById(state.help.topic)
  const rows: RenderElement[] = [rule(ctx, 'Help', `ruHelp · ${TOPICS.length} guides`)]

  rows.push(
    ctx.kit.Input === undefined
      ? text(ctx, ' this surface has no text field: /ruflo help, or press ✦ Ask Claude on any page', { dimColor: true })
      : ctx.kit.Input({
          key: 'help-input',
          label: ctx.columns < 70 ? '›' : 'ruHelp ›',
          placeholder: 'ask anything: how do I start a swarm? set a budget? what is a claim?',
          value: state.help.query,
          submitLabel: 'ask',
          ...(topic === null && query === '' && { autoFocus: true as const }),
          onInput: value => ctx.act.ruhelp.query(value),
          onSubmit: value => ctx.act.ruhelp.query(value),
        }),
  )

  if (query !== '') rows.push(...answerRows(ctx, query))
  else if (topic !== null) rows.push(...guideRows(ctx, topic))
  else rows.push(...indexRows(ctx))

  const back = []

  if (topic !== null || query !== '') back.push(button(ctx, 'help-index', '◂ all guides', () => ctx.act.ruhelp.open(null)))

  back.push(button(ctx, 'help-close', 'Close help', ctx.act.help, { hotkey: 'h' }))
  rows.push(rule(ctx, 'More'))
  rows.push(text(ctx, ' the full explainer: docs/ruflo-explained.md in the ruflo repository (github.com/ruvnet/ruflo) · bugs: github.com/ruvnet/ruflo/issues', { dimColor: true }))
  rows.push(text(ctx, ' ✦ Ask Claude on any page sends that page with a question · /ruflo commands lists every command', { dimColor: true }))
  rows.push(row(ctx, back, 'help-nav'))

  return col(ctx, rows, 'help')
}

export { wrap }
