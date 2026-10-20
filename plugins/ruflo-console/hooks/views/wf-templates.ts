/**
 * Workflow templates on the Workflows page (ADR-463): a board section to pick a template (review, migrate, research,
 * build-tune-review), set its parameters, see the dry-run estimate (agents and phases), and launch it. Launching is the console's
 * existing path for a prompt (a visible turn, or the prompt box mid-turn) behind the confirm card, which shows the prompt. Registered
 * through the slot seams (views/wf-slots.ts): `import './wf-templates'` in views/wf-register.ts, and `wireWfTemplates(state, host)`
 * once where the other actions are wired.
 */
import type { RenderElement } from 'claude-code'

import type { ActionSpec } from '../actions'
import { plain } from '../data/parse'
import { cleanText } from '../data/wf-clean'
import { estimate, hasMasked, missingOf, promptOf, templateById, TEMPLATES, valuesOf, AGENTS_MAX, TEXT_MAX, type Param, type Template } from '../data/wf-templates'
import type { Host } from '../host'
import type { State } from '../state'
import { button, clip, row, text, THEME, type Ctx } from './common'
import { flow } from './wf-layout'
import { registerSlot, type SlotEnv } from './wf-slots'

type Draft = { selected: string; raw: Record<string, Record<string, string | number>> }

const drafts = new WeakMap<State, Draft>()
const hosts = new WeakMap<State, Host>()

const draftOf = (state: State): Draft => drafts.get(state) ?? drafts.set(state, { selected: TEMPLATES[0]?.id ?? '', raw: {} }).get(state)!

/** The host the launch needs; set once with the other actions. */
export const wireWfTemplates = (state: State, host: Host): void => void hosts.set(state, host)

const templateOf = (state: State): Template => templateById(draftOf(state).selected) ?? (TEMPLATES[0] as Template)
const rawOf = (state: State, template: Template): Record<string, string | number> => draftOf(state).raw[template.id] ?? {}

const setValue = (state: State, host: Host | undefined, template: Template, id: string, value: string | number): void => {
  const draft = draftOf(state)

  draft.raw[template.id] = { ...(draft.raw[template.id] ?? {}), [id]: value }
  host?.invalidate()
}

/** The next template after the selected one (the key slot's work). */
export function cycleTemplate(state: State): void {
  const draft = draftOf(state)
  const at = TEMPLATES.findIndex(template => template.id === draft.selected)

  draft.selected = (TEMPLATES[(at + 1) % TEMPLATES.length] as Template).id
  hosts.get(state)?.invalidate()
}

function paramRow(ctx: Ctx, template: Template, param: Param, current: string | number): RenderElement[] {
  const { state } = ctx
  const host = hosts.get(state)
  const key = `wft-${template.id}-${param.id}`

  if (param.kind === 'int') {
    const n = Number(current)

    return [row(ctx, [text(ctx, ` ${param.label.padEnd(14)}`, { dimColor: true }), button(ctx, `${key}-less`, ' − ', () => setValue(state, host, template, param.id, Math.max(param.min, n - 1))), text(ctx, ` ${n} `, { bold: true }), button(ctx, `${key}-more`, ' + ', () => setValue(state, host, template, param.id, Math.min(param.max, n + 1))), text(ctx, ` (${param.min} to ${param.max})`, { dimColor: true })], key)]
  }

  if (param.kind === 'choice') return flow(ctx, param.choices.map(choice => ({ key: `${key}-${choice}`, label: `${choice === current ? '●' : '○'} ${choice}`, onPress: () => setValue(state, host, template, param.id, choice) })), key, ` ${param.label.padEnd(14)}`)

  return [ctx.kit.Input === undefined
    ? text(ctx, ` ${param.label}: this surface has no text field, so the default is used: ${param.fallback === '' ? 'none (required)' : param.fallback}`, { dimColor: true })
    : ctx.kit.Input({ key, label: param.label, value: String(current), placeholder: `${param.hint}${param.fallback === '' ? ' (required)' : ''}`, onInput: value => setValue(state, host, template, param.id, value), submitLabel: 'set', onSubmit: value => setValue(state, host, template, param.id, value) })]
}

export function boardRows(env: SlotEnv): RenderElement[] {
  const { ctx } = env
  const template = templateOf(ctx.state)
  const raw = rawOf(ctx.state, template)
  const values = valuesOf(template, raw)
  const plan = estimate(template, values)
  const missing = missingOf(template, values)

  return [
    ...flow(ctx, TEMPLATES.map(entry => ({ key: `wft-pick-${entry.id}`, label: `${entry.id === template.id ? '●' : '○'} ${entry.title}`, onPress: () => (draftOf(ctx.state).selected = entry.id, hosts.get(ctx.state)?.invalidate()) })), 'wft-pick', ' template '),
    ctx.kit.Text({ dimColor: true, wrap: 'wrap', children: ` ${template.summary}` }),
    ...template.params.flatMap(param => paramRow(ctx, template, param, raw[param.id] ?? param.fallback)),
    text(ctx, ` dry run: ${plan.agents} agents in ${plan.phases} phases (${plan.rows.map(entry => `${clip(entry.title, 14)} ${entry.agents}`).join(' · ')}), at most ${plan.widest} at once`, { bold: true, ...(plan.isOverCap ? { color: THEME.bad } : {}) }),
    text(ctx, ' counts only: tokens, time and cost are not estimated, nothing has measured them for this template', { dimColor: true }),
    ...(plan.isOverCap ? [text(ctx, ` over the ${AGENTS_MAX}-agent ceiling: lower a count before launching`, { color: THEME.bad })] : []),
    ...(missing.length > 0 ? [text(ctx, ` needs: ${missing.join(', ')}`, { color: THEME.warn })] : []),
    ...(hasMasked(template, raw) ? [text(ctx, ' something in the text looked like a credential: it is masked in what is sent', { color: THEME.warn })] : []),
    text(ctx, ' launch (the action row) sends this as a visible prompt after you confirm; the workflow then appears in the board above', { dimColor: true }),
  ]
}

/** The confirm card's spec: the prompt in full as what runs, the agent count as what it will cost in kind. Null when a required value is missing or the plan is over the ceiling. */
export function launchSpec(env: SlotEnv): ActionSpec | null {
  const { state } = env.ctx
  const host = hosts.get(state)
  const template = templateOf(state)
  const values = valuesOf(template, rawOf(state, template))
  const plan = estimate(template, values)

  if (host === undefined || plan.isOverCap || missingOf(template, values).length > 0) return null

  const prompt = promptOf(template, values)

  return {
    label: `launch workflow template ${template.title} (${plan.agents} agents, ${plan.phases} phases)`,
    scope: 'workflows',
    args: [],
    declared: 'spend',
    shows: `to Claude Code as a visible prompt: “${plain(prompt, 2400)}”`,
    expect: 'the prompt in the transcript, then a workflow run on this page',
    note: `Starts a Claude Code turn (billed as any turn is), and then up to ${plan.agents} agents it spawns, which spend money: the cost is not estimated. Mid-turn it is only prepared in the prompt box.`,
    run: async () => {
      try {
        if (state.turnActive) await host.fillPrompt(prompt)
        else await host.submitPrompt(prompt)
      } catch (error) {
        state.outcome = { label: 'launch workflow template', ok: false, verified: 'n/a', detail: cleanText(plain(error instanceof Error ? error.message : String(error), 140)) || 'refused', atMs: Date.now() }
        host.invalidate()
      }
    },
  }
}

/** Registers this module's slots; the import below does it once, and a test that emptied the registry calls it again (a repeat is refused harmlessly). */
export function registerTemplateSlots(): void {
  registerSlot({ kind: 'board', id: 'templates', title: 'Workflow templates (dry run, then a confirmed launch)', order: 50, render: boardRows })
  registerSlot({ kind: 'key', id: 'wf-template-next', key: 't', label: 'next template', run: env => cycleTemplate(env.ctx.state) })
  registerSlot({ kind: 'action', id: 'wf-template-launch', label: 'launch template', hotkey: 'g', why: 'nothing to launch: a required value is empty, the plan is over the agent ceiling, or the console is not wired for launching', spec: launchSpec })
}

registerTemplateSlots()

/** For tests: forgets the draft and the host. */
export const resetTemplates = (state: State): void => {
  drafts.delete(state)
  hosts.delete(state)
}
