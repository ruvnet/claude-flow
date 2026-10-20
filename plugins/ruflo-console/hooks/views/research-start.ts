import type { RenderElement } from 'claude-code'

import { mcOf, missionWired, researchOf, setResearch } from '../mission-control'
import { RESEARCH_DEPTHS } from '../mission-options'
import { button, row, rule, text, type Ctx } from './common'

const CAPS = ['1', '2', '5', '10'] as const

/**
 * Deep research from Mission Control (ADR-439): a question, a depth and a spend cap. Enter, or the button, screens the question
 * and asks first; the console only prepares /ruflo-goals:deep-research and never fetches anything itself.
 */
export function researchStartRows(ctx: Ctx): RenderElement[] {
  const { state } = ctx
  const draft = researchOf(state)
  const redraw = () => ctx.act.mission.tab(mcOf(state).tab)
  const start = () => void missionWired(state)?.research()
  const pick = (key: string, label: string, isOn: boolean, onPress: () => void) => ctx.kit.Button({ key, label: ` ${isOn ? '●' : '○'} ${label} `, plain: true, ...(isOn && { variant: 'primary' as const }), onPress })
  const rows = [rule(ctx, 'Deep research', 'asks first · capped')]

  if (ctx.kit.Input !== undefined) {
    rows.push(ctx.kit.Input({ key: 'research-question', label: 'question', value: draft.question, placeholder: 'what should it find out?', submitLabel: 'ask', onInput: value => { setResearch(state, { question: value }); if (value.length > 40 || /\n|\\n/.test(value) || draft.question.length > 40) redraw() }, onSubmit: value => { setResearch(state, { question: value }); start() } }))
  }

  rows.push(row(ctx, [text(ctx, ' depth ', { dimColor: true }), ...RESEARCH_DEPTHS.map(depth => pick(`research-depth-${depth}`, depth, draft.depth === depth, () => { setResearch(state, { depth }); redraw() }))], 'research-depth'))
  rows.push(row(ctx, [text(ctx, ' cap $  ', { dimColor: true }), ...CAPS.map(cap => pick(`research-cap-${cap}`, cap, draft.cap === cap, () => { setResearch(state, { cap }); redraw() })), button(ctx, 'research-start', 'Start research…', start)], 'research-cap'))
  rows.push(text(ctx, ' Bills a Claude turn; web content is untrusted.', { dimColor: true }))

  return rows
}
