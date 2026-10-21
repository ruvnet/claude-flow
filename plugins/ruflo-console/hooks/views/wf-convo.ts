/**
 * The Conversation board (ADR-465): talk to Claude, its agents, the ruflo hive, federation, Codex and any OpenAI-compatible endpoint from one
 * place, in one thread per target. A board slot of the Workflows page (views/wf-slots.ts), folded closed by default so the page stays short;
 * importing this module registers it (the merge owner adds `import './wf-convo'` to views/wf-register.ts and calls
 * `wireWfConvo(state, host, <the convoTargets option>)` from hooks/wf-wire.ts). `conversationRows(env)` is also exported so the Swarm page
 * can draw it where it lives. Each target shows what leaves the machine, its cost class and how a reply arrives BEFORE anything is sent; every
 * send goes through the confirm card with the exact payload. Nothing here sends on its own, and every cell is masked text.
 */
import type { RenderElement } from 'claude-code'

import { cleanText } from '../data/wf-clean'
import { compareOf, lastAnswer, MAX_MSGS, POLL_MAX, POLL_MS, statsOf, type Msg } from '../data/wf-convo'
import { fanOutOf } from '../data/wf-convo'
import { parseMentions, type Target } from '../data/wf-targets'
import type { Host } from '../host'
import type { State } from '../state'
import { hostOf, liveOf, relaySpec, saveTranscript, sendSpec, stopWatch, targetsFor, watchSpec, wireConvo } from '../wf-convo-live'
import { button, clip, col, kv, row, text, THEME, type Ctx } from './common'
import { fold } from './wf-fold'
import { registerSlot, type SlotEnv } from './wf-slots'

/** The wiring (`optionText` is the `convoTargets` option: endpoint:, bbs: and x: entries; keys are named, never held). */
export const wireWfConvo = (state: State, host: Host, optionText?: string): void => wireConvo(state, host, optionText)

const STATE_COLOR: Partial<Record<Msg['state'], string>> = { reply: THEME.ok, received: THEME.ok, queued: THEME.warn, sent: THEME.warn, error: THEME.bad, refused: THEME.bad }
const SHOWN = 10
const LINES = 6

const clock = (atMs: number): string => new Date(atMs).toISOString().slice(11, 19)

/** The answer's first lines, wrapped to the width; the rest is counted, never silently dropped. */
function wrap(value: string, width: number, max: number): string[] {
  const out: string[] = []

  for (const raw of value.split('\n')) {
    for (let at = 0; at < Math.max(raw.length, 1); at += width) out.push(raw.slice(at, at + width))
  }

  return out.length <= max ? out : [...out.slice(0, max), `… ${out.length - max} more lines (the transcript keeps them)`]
}

function targetRows(ctx: Ctx, targets: readonly Target[], pickedId: string | null, onPick: (id: string) => void): RenderElement[] {
  const rows: RenderElement[] = []

  for (const target of targets) {
    const isPicked = target.id === pickedId

    rows.push(row(ctx, [button(ctx, `wf-convo-pick-${target.id}`, `${isPicked ? '●' : '○'} @${target.id}`, () => onPick(target.id)), text(ctx, ` ${cleanText(target.label)} · ${target.transport} · leaves: ${target.leaves} · ${target.cost}`, { dimColor: true })], `wf-convo-t-${target.id}`))

    if (isPicked) {
      rows.push(text(ctx, `     sends: ${target.leavesText}`, { dimColor: true }))
      rows.push(text(ctx, `     cost: ${target.costText}`, { dimColor: true }))
      rows.push(text(ctx, `     reply: ${target.arrivalText}`, { dimColor: true }))
    }
  }

  return rows
}

function threadRows(ctx: Ctx, target: Target, convoOf: ReturnType<typeof liveOf>): RenderElement[] {
  const thread = convoOf.convo.threads.get(target.id)

  if (thread === undefined || thread.msgs.length === 0) return [text(ctx, `No messages with @${target.id} yet.`, { dimColor: true })]

  const stats = statsOf(thread)
  const rows: RenderElement[] = [text(ctx, `${stats.sent} sent · ${stats.answered} answered · ${stats.failed} failed · tokens ${stats.tokensIn === 0 && stats.tokensOut === 0 ? (stats.tokensTotal === 0 ? 'n/a' : `${stats.tokensTotal} total`) : `${stats.tokensIn} in / ${stats.tokensOut} out${stats.tokensTotal === 0 ? '' : ` + ${stats.tokensTotal} total`}`} · cost ${stats.usd === null ? 'n/a (no billed figure reported)' : `$${stats.usd.toFixed(4)} billed`}${thread.dropped > 0 ? ` · ${thread.dropped} oldest dropped at the ${MAX_MSGS}-message cap` : ''}`, { dimColor: true })]

  for (const msg of thread.msgs.slice(-SHOWN)) {
    const color = msg.who === 'you' ? THEME.info : STATE_COLOR[msg.state]

    rows.push(text(ctx, `${clock(msg.atMs)} ${msg.who === 'you' ? 'you' : `@${target.id}`}${msg.who === 'you' ? '' : ` [${msg.state}]`}`, { bold: true, ...(color === undefined ? {} : { color }) }))

    for (const line of wrap(msg.text, Math.max(20, ctx.columns - 6), LINES)) rows.push(text(ctx, `  ${line}`))
  }

  if (thread.msgs.length > SHOWN) rows.push(text(ctx, `${thread.msgs.length - SHOWN} earlier messages are in the transcript, not drawn`, { dimColor: true }))

  return rows
}

/** The answers of several targets next to each other (stacked where the page is narrow). */
function compareRows(ctx: Ctx, targets: readonly Target[], convoOf: ReturnType<typeof liveOf>): RenderElement[] {
  const cells = compareOf(convoOf.convo, targets)
  const side = ctx.columns >= 100 && cells.length > 1
  const width = side ? Math.max(24, Math.floor((ctx.columns - 2) / cells.length) - 2) : Math.max(24, ctx.columns - 4)
  const blocks = cells.map(cell => ctx.kit.Box({ flexDirection: 'column', ...(side && { width }), key: `wf-cmp-${cell.target}`, children: [text(ctx, clip(`@${cell.target} [${cell.state}]`, width), { bold: true }), text(ctx, clip(`${cell.tokens} · ${cell.usd}`, width), { dimColor: true }), ...wrap(cleanText(cell.text), width, LINES).map(line => text(ctx, clip(line, width)))] }))

  return [text(ctx, 'Answers side by side', { bold: true }), side ? row(ctx, blocks, 'wf-compare') : col(ctx, blocks, 'wf-compare')]
}

/** The whole board body; exported so another page can draw the Conversation too. */
export function conversationRows(env: SlotEnv): RenderElement[] {
  const { ctx } = env
  const { state } = ctx
  const live = liveOf(state)

  if (hostOf(state) === null) return [text(ctx, 'The console is not wired to a host here: nothing can be sent.', { dimColor: true })]

  const targets = targetsFor(state, env.runs)
  const redraw = (): void => ctx.act.workflows.setUi({})
  const picked = targets.find(target => target.id === live.convo.picked) ?? targets[0] ?? null
  const asked = parseMentions(live.draft, targets)
  const fan = fanOutOf(asked.targets, asked.unknown)
  const recipients = fan.targets.length > 0 ? fan.targets : picked === null ? [] : [picked]
  const body = fan.targets.length > 0 ? asked.body : live.draft.trim()
  const rows: RenderElement[] = [...targetRows(ctx, targets, picked?.id ?? null, id => { live.convo.picked = id; redraw() })]

  if (live.config.errors.length > 0) rows.push(text(ctx, `convoTargets option: ${live.config.errors[0] ?? ''}${live.config.errors.length > 1 ? ` (+${live.config.errors.length - 1} more)` : ''}`, { color: THEME.warn }))

  rows.push(ctx.kit.Input === undefined ? text(ctx, 'this surface has no text field: the composer needs one', { dimColor: true }) : ctx.kit.Input({ key: 'wf-convo-text', label: 'message', placeholder: '@claude @openrouter what do you think? (@all = agents, hive, rooms)', submitLabel: 'set', onSubmit: value => { live.draft = value; redraw() } }))
  rows.push(text(ctx, live.draft === '' ? 'message: none typed yet' : `message: ${cleanText(live.draft)}`, { color: live.draft === '' ? undefined : THEME.info }))
  if (fan.why !== '') rows.push(text(ctx, fan.why, { color: THEME.warn }))

  const verb = recipients.length === 0 ? 'no one to send to' : recipients.length === 1 ? `Send to @${recipients[0]?.id ?? ''}` : `Ask ${recipients.length} targets at once`
  const buttons: RenderElement[] = [button(ctx, 'wf-convo-send', verb, () => { const made = sendSpec(state, recipients, body); ctx.act.workflows.ask(made.spec, made.why) })]

  if (picked !== null && lastAnswer(live.convo, picked.id) !== null) buttons.push(button(ctx, 'wf-convo-relay', `Relay @${picked.id}'s answer to the @mentioned`, () => { const made = relaySpec(state, picked, fan.targets, body); ctx.act.workflows.ask(made.spec, made.why) }))
  if (picked !== null && (picked.transport === 'bbs' || picked.transport === 'x-channel')) {
    const thread = live.convo.threads.get(picked.id)

    buttons.push(thread?.isWatching === true ? button(ctx, 'wf-convo-unwatch', `Stop watching @${picked.id}`, () => stopWatch(state, picked.id)) : button(ctx, 'wf-convo-watch', `Watch @${picked.id} for replies`, () => { const made = watchSpec(state, picked); ctx.act.workflows.ask(made.spec, made.why) }))
  }

  if (picked !== null) buttons.push(button(ctx, 'wf-convo-save', 'Save transcript', () => void saveTranscript(state, picked, (spec, why) => ctx.act.workflows.ask(spec, why))))
  rows.push(row(ctx, buttons, 'wf-convo-actions'))

  if (picked !== null) {
    const watching = live.convo.threads.get(picked.id)?.isWatching === true

    rows.push(kv(ctx, 'reply polling', watching ? `on: a read every ${POLL_MS / 1000}s, ${live.convo.threads.get(picked.id)?.polls ?? 0} of ${POLL_MAX} done` : picked.arrival === 'polled' ? `off (a read every ${POLL_MS / 1000}s, at most ${POLL_MAX}, when you start it)` : `not used: ${picked.arrivalText}`))
    rows.push(...threadRows(ctx, picked, live))
  }

  const withAnswers = targets.filter(target => lastAnswer(live.convo, target.id) !== null)
  const compared = fan.targets.length > 1 ? fan.targets : withAnswers.length > 1 ? withAnswers.slice(0, 6) : []

  if (compared.length > 1) rows.push(...compareRows(ctx, compared, live))

  return [col(ctx, rows, 'wf-convo')]
}

function board(env: SlotEnv): RenderElement[] {
  const { ctx } = env
  const live = liveOf(ctx.state)
  const threads = [...live.convo.threads.values()].filter(thread => thread.msgs.length > 0).length

  return fold(ctx, 'convo', `talk to Claude, its agents, the hive, federation, Codex and other models · ${threads} thread${threads === 1 ? '' : 's'} · every send is confirmed with its exact payload`, () => conversationRows(env))
}

/** Registers this module's slot; a repeat is refused harmlessly (the registry keeps the first). */
export function registerConvoSlots(): void {
  registerSlot({ kind: 'board', id: 'conversation', title: 'Conversation', order: 60, render: board })
}

registerConvoSlots()
