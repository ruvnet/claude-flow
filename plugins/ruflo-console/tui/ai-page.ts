/**
 * The AI page as terminal lines (ADR-489 phase 3): a status block, the conversation (the console's own `screenOf`, so Codex's streamed
 * events look as they do in the Claude Code console), the question card when one is waiting, a notice, and the input line. Every string
 * goes through `cleanText` (credential shapes masked) and then `render`, whose Text path is the one chokepoint for escapes and secrets.
 *
 * A card is only answerable if the person can see ALL of what would be sent: on a terminal too small for that, the page says so and the
 * card stays unanswerable (`fits` false), so a `y` can never approve something that was cut off.
 */
import { cleanText } from '../hooks/data/wf-clean'
import type { State } from '../hooks/state'
import { screenOf } from '../hooks/views/terminal'
import type { Ai } from './ai'
import { CARD_TTL_MS, usd } from './ai'
import { PINNED_CODEX } from './ai-guard'
import { cells, clean, render, terminalKit, type Depth } from './ansi'
import type { AiStatus } from './session'

const kit = terminalKit()
const t = (children: string, props: Record<string, unknown> = {}) => kit.Text({ children: cleanText(clean(children)), ...props })
/** Text the page built itself from a vetted request (the card): escapes out, but not run through the credential mask, which would hide the words "Bearer ‹from $KEY›" that tell the person where the key comes from. The user's own text in it was already refused if it looked like a credential. */
const own = (children: string, props: Record<string, unknown> = {}) => kit.Text({ children: clean(children), ...props })
const boxed = (color: string, children: ReturnType<typeof t>[]) => kit.Box({ borderStyle: 'round', borderColor: color, paddingX: 1, flexDirection: 'column', children })

/** The tail of a line that fits `width` cells, with a leading ellipsis when it was cut (the end of a draft is where the cursor is). */
function tail(line: string, width: number): string {
  if (cells(line) <= width) return line

  let out = ''

  for (const ch of [...line].reverse()) {
    if (cells(out + ch) > width - 1) break
    out = ch + out
  }

  return `…${out}`
}

export type AiFrame = { lines: string[]; fits: boolean }

export function aiFrame(state: State, ai: Ai | null, status: AiStatus, columns: number, depth: Depth, rows: number): AiFrame {
  const draw = (nodes: unknown[]): string[] => render(nodes, columns, depth)
  const one = (text: string, props: Record<string, unknown> = {}): string[] => draw([t(tail(text, columns), props)])
  const head = one('💻 AI — ask Codex (read-only) or OpenRouter; every question asks first', { color: '#d78700', bold: true })

  if (ai === null) return { lines: [...head, ...one(' The AI page is off in this run (started with --no-ai).', { dimColor: true })], fits: true }

  const max = Math.max(3, rows - 2)
  const spent = `${usd(ai.spentUsd)} of ${usd(ai.capUsd)} reported`
  const turns = state.terminal.turns.codex
  const codex = `${ai.target === 'codex' ? '▸' : ' '} codex       ${status.codex}${turns > 0 ? ` · ${turns} turn${turns === 1 ? '' : 's'}, no dollars reported` : ''}`
  const router = `${ai.target === 'openrouter' ? '▸' : ' '} openrouter  ${status.openrouter} · spend ${spent}`
  // The status lines are ours (a variable's NAME, never its value), so they skip the credential mask, which reads "key: …" as a secret.
  const full = draw([boxed('#8787ff', [own(codex, { bold: ai.target === 'codex' }), own(router, { bold: ai.target === 'openrouter' })])])
  const compact = draw([own(tail(codex, columns), { bold: ai.target === 'codex' }), own(tail(router, columns), { bold: ai.target === 'openrouter' })])
  const card = ai.card
  const left = card === null ? 0 : Math.max(0, Math.ceil((CARD_TTL_MS - (Date.now() - card.atMs)) / 1000))
  const title = card === null ? '' : `Ask first, #${card.id}: this goes to ${card.target === 'codex' ? `Codex ${PINNED_CODEX}, read-only` : 'OpenRouter'}`
  const keys = `y sends it · n cancels · it expires in ${left} s`
  const cardFull = card === null ? [] : draw([boxed('#d7af00', [own(title, { bold: true, color: '#d7af00' }), own(card.shows), own(card.note, { dimColor: true }), own(keys, { bold: true })])])
  const cardCompact = card === null ? [] : draw([boxed('#d7af00', [own(title, { bold: true, color: '#d7af00' }), own(card.shows), own(keys, { bold: true })])])
  const cardMin = card === null ? [] : draw([own(title, { bold: true, color: '#d7af00' }), own(card.shows), own(keys, { bold: true })])
  const notice = ai.notice === null ? [] : one(` ${ai.notice}`, { color: '#d75f5f' })
  const input = one(`${ai.target === 'codex' ? 'codex' : 'openrouter'} › ${ai.draft}${ai.mode === 'type' && card === null ? '█' : ''}`, { bold: true })
  // The roomiest layout that fits; a card is never trimmed, only its decoration (the note, the border, the status box) goes first.
  const choices: { top: string[]; status: string[]; card: string[] }[] = [
    { top: head, status: full, card: cardFull },
    { top: head, status: full, card: cardCompact },
    { top: head, status: compact, card: cardCompact },
    { top: head, status: compact, card: cardMin },
    { top: [], status: compact, card: cardMin },
    { top: [], status: [], card: cardMin },
  ]
  const need = (choice: (typeof choices)[number]) => choice.top.length + choice.status.length + choice.card.length + notice.length + input.length
  const pick = choices.find(choice => need(choice) + (card === null ? 3 : 0) <= max)

  // Not even the question and its keys fit: say so, and the card cannot be answered (`fits` false) until the terminal is taller or wider.
  if (card !== null && pick === undefined) return { lines: [...one(' Enlarge the terminal: the whole question has to be on screen before it can be answered (n cancels).', { color: '#d75f5f' }), ...input].slice(-max), fits: false }

  const use = pick ?? { top: head, status: compact, card: [] as string[] }
  const room = Math.max(0, max - need(use))
  const conversation = screenOf(state.terminal.lines, Math.max(20, columns - 6)).flatMap(row => draw([kit.Box({ flexDirection: 'row', children: [t(row.gutter, { color: row.gutterColor }), t(row.text, row.style)] })]))
  const end = Math.max(0, conversation.length - state.terminal.scroll)
  const shown = room === 0 ? [] : conversation.slice(Math.max(0, end - room), end)
  const empty = conversation.length === 0 && room > 0 ? one(' Nothing yet. Type a question and press Enter: the card shows what would be sent before anything is.', { dimColor: true }).slice(0, room) : []
  const body = shown.length > 0 ? shown : empty

  return { lines: [...use.top, ...use.status, ...body, ...Array.from({ length: Math.max(0, room - body.length) }, () => ''), ...use.card, ...notice, ...input].slice(-max), fits: true }
}
