/**
 * The console's mirror of the live Claude conversation (PR-C): the settled turns as ChatMsg, plus the text of the answer still streaming.
 *
 * Kept in a side table keyed by the State (the sessions.ts pattern), so nothing a transcript said can reach the snapshot, an export,
 * persistence or console_state text. Nothing here writes a file or sends text to a model.
 *
 * The store keeps data only: a tool-only assistant message stays `{ text: '', tools: [...] }`, and the view decides how to show it
 * ("… used <tools>").
 */
import type { HookStream, TurnStepChunk, TurnStepInput, TurnStepResult } from 'claude-code'
import type { ChatMsg } from './chat-msg'
import { checkLimit, LONG_TEXT_MAX } from './full-text'
import type { Host } from './host'
import { mcOf } from './mission-control'
import { blocksGuidance, screenText } from './mission-options'
import { hasSecret } from './screen'
import type { State } from './state'

/** How many settled messages the store keeps (the newest). */
export const KEEP_MSGS = 200
/** The longest text one message, or the streaming answer, keeps before it is cut. */
export const MAX_TEXT = 20_000
export const CUT_MARK = '… cut'

type StepEvent = Readonly<TurnStepInput>
type StepNext = (e: StepEvent) => HookStream<TurnStepChunk, TurnStepResult>

/**
 * `error` is the last READ's failure (a good read clears it); `sendError` is the last SEND's refusal, kept until the next send starts so a
 * read that lands right after a refusal cannot wipe it; `notice` is a fixed note for an Enter pressed while a send is still pending.
 */
export type Chat = { msgs: ChatMsg[]; partial: string; pending: 'idle' | 'sending' | 'queued'; error?: string; sendError?: string; notice?: string }

const chats = new WeakMap<State, Chat>()
/**
 * What the person has typed in the Chat field, beside the store (never in the snapshot, the Chat object or console_state): the field is
 * drawn from it, an accepted send empties it, and a refused one leaves it for the person to edit.
 */
const drafts = new WeakMap<State, string>()

export const draftOf = (state: State): string => drafts.get(state) ?? ''

export function setDraft(state: State, text: string): void {
  drafts.set(state, typeof text === 'string' ? text : '')
}
/** Which main-session turn the store is on: a refresh that lands after the next turn began leaves that turn's partial alone. */
const turns = new WeakMap<State, number>()

export function chatOf(state: State): Chat {
  let found = chats.get(state)

  if (found === undefined) {
    found = { msgs: [], partial: '', pending: 'idle' }
    chats.set(state, found)
  }

  return found
}

export function cutText(text: unknown): string {
  const plain = typeof text === 'string' ? text : ''

  return plain.length > MAX_TEXT ? `${plain.slice(0, MAX_TEXT)}${CUT_MARK}` : plain
}

/** The newest KEEP_MSGS messages, each text cut at MAX_TEXT. Only the kept tail is touched, so a 4,096-row transcript costs 200 rows. */
export function keepChat(msgs: readonly ChatMsg[]): ChatMsg[] {
  return msgs.slice(-KEEP_MSGS).map(msg => ({ role: msg.role, text: cutText(msg.text), tools: Array.isArray(msg.tools) ? [...msg.tools] : [] }))
}

/** Re-reads the main conversation into the store. Never throws: a failed read keeps the last messages and says so in `error` (a send's refusal, `sendError`, is not the read's to clear). */
export async function refreshChat(host: Host, state: State): Promise<void> {
  const chat = chatOf(state)

  try {
    chat.msgs = keepChat(await host.session.messages())
    delete chat.error
  } catch {
    // The reason is not shown: an engine error could quote the transcript.
    chat.error = 'could not read the conversation'
  }
}

/** The shortest gap between two redraws of the Chat page while an answer streams in (or a re-read lands). */
export const REDRAW_MS = 200

/**
 * The one gate for everything the console does on the conversation's behalf: the preview setting is on, the console is open, and Chat is the
 * page shown. Outside it nothing reads the transcript and nothing redraws for it (opening Chat reads it once, in view-open.ts).
 */
export const chatLive = (state: State): boolean => state.options.sessionPreview && state.view === 'chat' && state.pane.isOpen

const redrawing = new WeakMap<State, { cancel: () => void }>()

/**
 * Asks for a redraw of the Chat page, at most once per REDRAW_MS however many chunks arrive: the first call arms one timer and the rest
 * ride on it. It does nothing unless the console is open on the Chat page (a streamed answer costs every other page no redraw), and a
 * host that refuses the redraw changes nothing. O(1) per call.
 */
export function redrawChat(host: Host, state: State): void {
  if (!chatLive(state) || redrawing.has(state)) return

  try {
    redrawing.set(
      state,
      host.after(REDRAW_MS, () => {
        redrawing.delete(state)
        if (!chatLive(state)) return

        try {
          host.invalidate()
        } catch {
          // A refused redraw leaves the page as it was until the next one.
        }
      }),
    )
  } catch {
    // No timer: the next chunk or re-read asks again.
  }
}

/** A main-session turn begins: the streaming answer starts empty, and the new message is read if Chat is live. */
export function onChatTurnStart(host: Host, state: State): void {
  startChatTurn(state)
  if (chatLive(state)) void refreshChatAndDraw(host, state).catch(() => undefined)
}

/** A streamed piece of the main answer: always kept in the store, and a (throttled) redraw is asked for only while Chat is live. */
export function onChatChunk(host: Host, state: State, text: string): void {
  appendPartial(state, text)
  redrawChat(host, state)
}

/** Re-reads the conversation, then redraws the Chat page if it is the one shown. Never throws. */
export async function refreshChatAndDraw(host: Host, state: State): Promise<void> {
  await refreshChat(host, state)
  redrawChat(host, state)
}

/**
 * Appends a streamed piece of the main answer, up to MAX_TEXT (then marks the cut once). O(piece), never O(answer). With the Session
 * preview setting off nothing is held: the console reads nothing of the conversation then, the streamed answer included.
 */
export function appendPartial(state: State, text: string): void {
  if (!state.options.sessionPreview) return
  const chat = chatOf(state)

  if (chat.partial.length > MAX_TEXT) return
  const room = MAX_TEXT - chat.partial.length

  chat.partial += text.length > room ? `${text.slice(0, room)}${CUT_MARK}` : text
}

/** A main-session turn begins: the streaming answer starts empty. */
export function startChatTurn(state: State): void {
  turns.set(state, (turns.get(state) ?? 0) + 1)
  chatOf(state).partial = ''
}

/** A main-session turn ended: the settled messages are re-read, then the streaming answer is cleared (unless a newer turn began). */
export async function endChatTurn(host: Host, state: State): Promise<void> {
  const turn = turns.get(state) ?? 0

  if (chatLive(state)) await refreshChat(host, state)
  if ((turns.get(state) ?? 0) === turn) chatOf(state).partial = ''
}

/**
 * The body of the `turn.step` hook (register.ts: `return yield* chatStep(e, next, observe)`): every chunk from beneath is yielded
 * unchanged and in order, and beneath's result is returned. A main-session text chunk is also handed to `observe`; a subagent's step is
 * passed straight through, and an `observe` that throws changes nothing. Per chunk it does one kind check and one call.
 *
 * A later step of the same turn (`e.index > 0`: the answer after a tool call) starts on a new line: before its first text chunk `observe`
 * gets a '\n', so "Let me look." and "Found it." do not run together. A step with no text adds nothing.
 *
 * Closing early (the consumer's `return()`) reaches beneath's own `finally` through the `for await`, and a throw from beneath propagates.
 */
export async function* chatStep(e: StepEvent, next: StepNext, observe: (text: string) => void): AsyncGenerator<TurnStepChunk, TurnStepResult> {
  if (e.agentId !== undefined) return yield* next(e)
  const stream = next(e)
  let needsBreak = e.index > 0

  for await (const chunk of stream) {
    if (chunk.kind === 'text') {
      try {
        if (needsBreak) {
          needsBreak = false
          observe('\n')
        }
        observe(chunk.text)
      } catch {
        // The console's mirror is a bystander: a failed update never alters the response.
      }
    }
    yield chunk
  }

  return await stream.result
}

/** What the person sees when a send did not go. Fixed text: a refusal or an engine error could quote the message, so neither is shown. */
const NOT_SENT = {
  unsafe: 'not sent: AIDefence flagged the message as unsafe',
  pii: 'not sent: AIDefence found personal or secret data in the message',
  long: 'not sent: the message is too long to be screened whole; shorten it',
  rejected: 'not sent: Claude did not take the message',
  dropped: 'not sent: a hook declined it',
} as const

/** The fixed note for an Enter pressed while a send is still pending. */
export const ALREADY_SENDING = 'already sending — wait for it'

/**
 * Types to Claude from the console: the message goes in directly, as a normal user turn (`submitPrompt`), never drafted into the prompt box.
 *
 * - The message is trimmed (that is all that is done to it); an empty one is ignored.
 * - While `pending` is not `idle` another Enter submits nothing: `pending` is set before anything is awaited, so a repeated Enter during the
 *   screen or the submit adds nothing, and says so with a fixed `notice` (ALREADY_SENDING) until the send settles. Mid-turn it reads
 *   `queued` (the engine runs a submit made during a turn as a turn of its own once the session is idle) and the submit is still made, once.
 * - It is screened by the same AIDefence screen as a typed question to Claude (`screenText`, unless the person switched the screen off): a
 *   secret-shaped or unsafe message is refused and nothing is submitted. A message over the screen's limit could not be screened whole, so it
 *   is refused too.
 * - `pending` returns to `idle` when the submit settles. That is the one signal tied to this very message, it is the same for success and
 *   failure, and it needs no hook of its own. A refusal, a rejection, or a hook's `{ drop }` leaves a fixed `sendError` (never the message,
 *   never the engine's or the hook's reason), which stays until the next send starts.
 * - The text is kept nowhere but the field's own draft (in memory, beside the store): not in the store, an event, the last outcome or an
 *   error. An accepted send empties the draft (unless the person has typed something else meanwhile); a refused one keeps it. Never throws.
 */
export async function sendChat(host: Host, state: State, text: string): Promise<void> {
  const chat = chatOf(state)
  const message = typeof text === 'string' ? text.trim() : ''

  if (message === '') return
  if (chat.pending !== 'idle') {
    chat.notice = ALREADY_SENDING
    try {
      host.invalidate()
    } catch {
      // A refused redraw changes nothing about the send.
    }

    return
  }

  const redraw = () => {
    try {
      host.invalidate()
    } catch {
      // A refused redraw changes nothing about the send.
    }
  }
  const refuse = (why: string) => {
    chat.pending = 'idle'
    chat.sendError = why
    delete chat.notice
    redraw()
  }

  chat.pending = state.turnActive ? 'queued' : 'sending'
  delete chat.sendError
  delete chat.notice
  // The field holds what is being sent (also when no keystroke reached the draft: a paste, a headless submit), so a refusal leaves it there.
  if (draftOf(state).trim() !== message) setDraft(state, text)
  redraw()

  try {
    if (!checkLimit(message, LONG_TEXT_MAX, 'the message').ok) return refuse(NOT_SENT.long)

    // Screen off, or no detector answering: the dependency-free secret check still stands between a secret and the model.
    const screen = mcOf(state).isScreenOn ? await screenText(state, host, message) : null

    if (blocksGuidance(screen)) return refuse(screen?.status === 'pii' ? NOT_SENT.pii : NOT_SENT.unsafe)
    if ((screen === null || screen.status === 'unavailable') && hasSecret(message)) return refuse(NOT_SENT.pii)

    const submitted = await host.submitPrompt(message, { asUser: true })

    if (submitted !== undefined && submitted.isDropped) return refuse(NOT_SENT.dropped)
    chat.pending = 'idle'
    delete chat.notice
    if (draftOf(state).trim() === message) setDraft(state, '')
    redraw()
  } catch {
    refuse(NOT_SENT.rejected)
  }
}

/** The turn.start side of the mirror: a new main turn starts the streaming answer empty (and reads the new message if Chat is live). A mirror that throws never changes the turn. */
export function mirrorTurnStart(host: Host | null, state: State): void {
  try {
    if (host !== null) onChatTurnStart(host, state)
    else startChatTurn(state)
  } catch {
    // The chat mirror never changes the turn.
  }
}

/** The turn.complete side: re-read the settled turns, then drop the streamed text, then redraw; never awaited, never thrown out of the turn. */
export const mirrorTurnEnd = (host: Host, state: State): void => void endChatTurn(host, state).then(() => redrawChat(host, state)).catch(() => undefined)

/** One streamed text piece of the main answer: kept always, redrawn (throttled) only while Chat is live. */
export const mirrorChunk = (host: Host | null, state: State, text: string): void => (host !== null ? onChatChunk(host, state, text) : appendPartial(state, text))
