/**
 * The AI page of the standalone terminal (ADR-489 phase 3, decision D): ask Codex (read-only, the pinned release) or OpenRouter
 * (https, an allow-listed host) from the terminal. It reuses the console's own parts, not a second harness: `harness.send` runs
 * Codex and streams its events into the same scrollback the console draws, and `sendTo` (the conversation bridge, ADR-465) builds
 * and sends the OpenRouter request and reads back the cost the provider itself billed.
 *
 * Nothing is sent without a card: Enter shows exactly what would leave this machine, and only a `y` while that card is on screen
 * runs it (#3983: the answer is bound to the card the person was shown, and a card that was never drawn, was replaced, or has
 * expired answers nothing). A reply's cost is the provider's own figure, never one worked out here; the spend cap stops the next
 * send once the reported total reaches it. Codex reports no dollars, so its turns are counted and its cost reads n/a.
 */
import { argvOf, send as sendToCodex, whyNotRun } from '../hooks/harness'
import { parseConfig, targetsOf, type Config, type Endpoint, endpointsOf } from '../hooks/data/wf-targets'
import { payloadOf, sendTo, type SendDeps } from '../hooks/data/wf-send'
import type { Host } from '../hooks/host'
import type { State, TermLine } from '../hooks/state'
import { allowedHostsOf, PINNED_CODEX } from './ai-guard'
import { cleanText } from '../hooks/data/wf-clean'
import { clean } from './ansi'

export type AiTarget = 'codex' | 'openrouter'
export type AiCard = { id: number; target: AiTarget; text: string; shows: string; note: string; atMs: number }
export type AiMode = 'type' | 'nav'
export type AiOptions = {
  /** `endpoint:<name>=<base-url>|<KEY_ENV>|<model>;...` exactly as the console's convoTargets option. */
  convoTargets?: string
  /** The OpenRouter model for this session (a plain model name); default is the console's `openrouter/auto`. */
  model?: string
  /** Stop sending once the provider-reported spend reaches this many USD (default 0.5). */
  maxSpendUsd?: number
  allowWrite?: boolean
}

export type Ai = {
  readonly mode: AiMode
  readonly draft: string
  readonly target: AiTarget
  readonly card: AiCard | null
  readonly spentUsd: number
  readonly capUsd: number
  readonly notice: string | null
  readonly config: Config
  /** The hosts the host may send to and the key variables it may read: what the Node host is built with. */
  readonly allowedHosts: string[]
  readonly keyEnvs: string[]
  /** One keypress on the AI page. `consumed` false means the shell may treat it as a page key (quit, a page number, tab). */
  press: (chunk: string) => { consumed: boolean }
  /** The shell opened this page: typing is on again (a person who left with Esc comes back to a field that takes keys). */
  enter: () => void
  /** Called by the shell after a frame that showed the card was written: only then may `y` answer it. */
  drawn: () => void
  stop: () => void
  isBusy: () => boolean
}

export const CARD_TTL_MS = 60_000
/** Dollars as the provider reported them: a cheap turn costs a few millionths, so under a cent the figure keeps six places and is never rounded to $0. */
export const usd = (value: number): string => `$${value >= 0.01 ? value.toFixed(4) : value.toFixed(6)}`
const DRAFT_MAX = 4_000
const ESC = '\u001b'
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,80}$/

const lineAdd = (state: State, kind: TermLine['kind'], text: string, from: TermLine['from']): void => {
  state.terminal.lines.push({ kind, text: cleanText(clean(text)).slice(0, 2_000), ...(from !== undefined && { from }) })
  if (state.terminal.lines.length > 600) state.terminal.lines.splice(0, state.terminal.lines.length - 600)
}

/** The config the page sends with: the console's convoTargets, with this session's model put on the OpenRouter entry. */
export function aiConfigOf(options: AiOptions): { config: Config; errors: string[] } {
  const model = options.model !== undefined && MODEL.test(options.model) ? options.model : undefined
  const base = parseConfig(options.convoTargets ?? '')
  const config = model === undefined ? base : parseConfig(`endpoint:openrouter=https://openrouter.ai/api/v1|OPENROUTER_API_KEY|${model};${options.convoTargets ?? ''}`)

  return { config, errors: [...config.errors, ...(options.model !== undefined && model === undefined ? ['the model name is not a plain name: openrouter/auto is used'] : [])] }
}

export function openAi(state: State, host: Host, options: AiOptions = {}): Ai {
  const { config, errors } = aiConfigOf(options)
  const endpoints: Endpoint[] = endpointsOf(config)
  const openrouter = endpoints.find(endpoint => endpoint.name === 'openrouter') as Endpoint
  const targets = targetsOf({ agents: [], peers: [], config, hasHive: false, hasCodex: true })
  const http = targets.find(target => target.id === 'openrouter')
  const capUsd = options.maxSpendUsd !== undefined && Number.isFinite(options.maxSpendUsd) && options.maxSpendUsd >= 0 ? options.maxSpendUsd : 0.5
  const deps = (): SendDeps => ({ run: host.run, httpSend: host.httpSend, submitPrompt: host.submitPrompt, cli: [], helper: '', trustedPeers: new Set(), cwd: state.cwd, hive: null, config } as unknown as SendDeps)
  let mode: AiMode = 'type'
  let draft = ''
  let target: AiTarget = 'codex'
  let card: AiCard | null = null
  let shown: number | null = null
  let counter = 0
  let spentUsd = 0
  let notice: string | null = errors[0] ?? null
  let isSending = false

  const note = (text: string | null) => void (notice = text)
  const busy = () => isSending || state.terminal.runs.size > 0

  /** What leaves this machine, said before it goes (the card), or why this cannot be sent. */
  function cardFor(text: string): { ok: true; card: AiCard } | { ok: false; why: string } {
    const id = (counter += 1)

    if (target === 'codex') {
      state.terminal.harness = 'codex'

      const why = whyNotRun(state, text)

      if (why !== null) return { ok: false, why }

      const argv = argvOf(state, 'codex', text.trim()) ?? []

      return { ok: true, card: { id, target, text: text.trim(), shows: `${argv.join(' ')}  (prompt on stdin: ${JSON.stringify(text.trim())})`, note: `Read-only sandbox, the pinned Codex ${PINNED_CODEX} (never current or PATH). The prompt goes to OpenAI through the codex CLI. Codex does not report dollars: its turns are counted, its cost reads n/a.`, atMs: Date.now() } }
    }

    if (http === undefined) return { ok: false, why: 'no openrouter target' }
    if (spentUsd >= capUsd) return { ok: false, why: `the spend cap is reached (reported ${usd(spentUsd)} of ${usd(capUsd)}): restart with a higher --max-spend-usd` }

    const made = payloadOf(http, text, deps())

    return made.ok ? { ok: true, card: { id, target, text: made.body, shows: made.payload.shows, note: made.payload.note, atMs: Date.now() } } : { ok: false, why: made.why }
  }

  async function run(chosen: AiCard): Promise<void> {
    if (chosen.target === 'codex') {
      state.terminal.harness = 'codex'
      sendToCodex(state, host, chosen.text)

      return
    }

    isSending = true
    lineAdd(state, 'in', chosen.text, 'ruflo')
    lineAdd(state, 'head', 'openrouter', 'ruflo')

    const started = Date.now()

    try {
      const result = await sendTo(deps(), http as NonNullable<typeof http>, chosen.text)

      for (const line of result.text.split('\n')) lineAdd(state, result.ok ? 'out' : 'err', line, 'ruflo')

      if (result.costUsd !== undefined) {
        spentUsd += result.costUsd
        state.terminal.costUsd += result.costUsd
        state.terminal.costReports += 1
      }

      const secs = Math.round((Date.now() - started) / 1000)
      const tokens = (result.tokensIn ?? 0) + (result.tokensOut ?? 0)

      lineAdd(state, 'end', result.ok ? `✓ ${secs} s${result.costUsd !== undefined ? ` · ${usd(result.costUsd)}` : ' · cost not reported'}${tokens > 0 ? ` · ${tokens.toLocaleString('en-US')} tokens` : ''}${result.model !== undefined ? ` · ${clean(result.model)}` : ''}` : '✗ not sent or failed', 'ruflo')
    } finally {
      isSending = false
      host.invalidate()
    }
  }

  function confirm(): void {
    const chosen = card

    if (chosen === null) return

    // Only the card that was drawn, still current and not stale: a card made and answered before a frame showed it answers nothing.
    if (shown !== chosen.id) return note('that question was not on screen yet: look at it, then answer')
    if (Date.now() - chosen.atMs > CARD_TTL_MS) {
      card = null

      return note(`that question expired after ${CARD_TTL_MS / 1000} s with no answer, so it did not run: ask again`)
    }
    if (busy()) return note('an answer is still coming: wait, or stop it (Ctrl-S)')

    card = null
    shown = null
    note(null)
    void run(chosen)
  }

  function submit(): void {
    if (draft.trim() === '') return note('type something first')
    if (busy()) return note('an answer is still coming: wait, or stop it (Ctrl-S)')

    const made = cardFor(draft)

    if (!made.ok) {
      // A message that looks like a credential is dropped, not kept in the field: it is neither shown again nor held.
      if (cleanText(draft) !== draft) draft = ''

      return note(made.why)
    }

    card = made.card
    shown = null
    draft = ''
    note(null)
  }

  const scroll = (by: number) => void (state.terminal.scroll = Math.max(0, state.terminal.scroll + by))

  return {
    get mode() {
      return mode
    },
    get draft() {
      return draft
    },
    get target() {
      return target
    },
    get card() {
      return card
    },
    get spentUsd() {
      return spentUsd
    },
    capUsd,
    get notice() {
      return notice
    },
    config,
    allowedHosts: allowedHostsOf(endpoints.map(endpoint => endpoint.baseUrl)),
    keyEnvs: [...new Set(endpoints.map(endpoint => endpoint.keyEnv).filter(name => name !== 'NONE'))],
    enter: () => void (mode = 'type'),
    drawn: () => void (shown = card === null ? null : card.id),
    isBusy: busy,
    stop,
    press: chunk => {
      // A question is on screen: only a lone y (or Enter) answers it, a lone n (or Esc) drops it. Pasted text is never an answer.
      if (card !== null) {
        if (chunk === 'y' || chunk === 'Y' || chunk === '\r') confirm()
        else if (chunk === 'n' || chunk === 'N' || chunk === ESC) (card = null), (shown = null), note('cancelled: nothing was sent')
        else if (chunk === '\u0003' || chunk === '\u0004') return { consumed: false }

        return { consumed: true }
      }

      if (mode === 'nav') {
        if (chunk === 'i' || chunk === '\r') {
          mode = 'type'

          return { consumed: true }
        }

        return { consumed: false }
      }

      if (chunk === '\u0003' || chunk === '\u0004') return { consumed: false }
      if (chunk === ESC) return void (mode = 'nav'), { consumed: true }
      if (chunk === '\r') return submit(), { consumed: true }
      if (chunk === '\u007f' || chunk === '\b') return void (draft = [...draft].slice(0, -1).join('')), { consumed: true }
      if (chunk === '\u0015') return void (draft = ''), { consumed: true }
      if (chunk === '\u0014') return void ((target = target === 'codex' ? 'openrouter' : 'codex'), note(null)), { consumed: true }
      if (chunk === '\u0013') return stop(), { consumed: true }
      if (chunk === `${ESC}[5~`) return scroll(10), { consumed: true }
      if (chunk === `${ESC}[6~`) return scroll(-10), { consumed: true }
      if (chunk.startsWith(ESC)) return { consumed: true }

      // Typed or pasted text: printable characters only, never a newline (a paste with one does not submit), capped.
      const text = chunk.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')

      if (text !== '') draft = (draft + text).slice(0, DRAFT_MAX)

      return { consumed: true }
    },
  }

  function stop(): void {
    for (const running of state.terminal.runs.values()) running.stop()
    note(state.terminal.runs.size > 0 ? 'stopping…' : 'nothing is running')
  }
}
