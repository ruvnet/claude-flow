/**
 * The Chat page (PR-C, C4): the live conversation drawn for a person, and only for a person. Opening it shows the last messages (user
 * and assistant framed), a tool-only answer reads "… used <tools>", a cut message shows the cut mark, Enter in the field sends once,
 * the streamed answer is a live "Claude is writing…" block that redraws at most a few times a second, and nothing a transcript said
 * reaches a text answer (console_state, "Ask Claude about this view") or the screen when the session preview setting is off.
 * (Kit tests cannot load under vitest here, so the view is drawn through a recording kit and the console's own text renderer.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { askPrompt, VIEW_ASK } from '../hooks/ask-claude'
import { appendPartial, chatOf, CUT_MARK, draftOf, keepChat, MAX_TEXT, redrawChat, setDraft } from '../hooks/chat'
import { openLoaders } from '../hooks/view-open'
import type { Host } from '../hooks/host'
import { groupOf, NAV_GROUPS } from '../hooks/nav-state'
import { paletteEntries } from '../hooks/palette'
import { newState, rowsOf, viewOf, VIEWS, type State } from '../hooks/state'
import { BAND_LINKS } from '../hooks/views/bar'
import { chatView } from '../hooks/views/chat'
import { setLook, type Actions } from '../hooks/views/common'
import { GROUPS } from '../hooks/views/menu'
import { linesOf, viewText } from '../hooks/views/pane'

type Node = { type: string; props: Record<string, unknown> }

/** A kit that records instead of drawing, with the text field a terminal surface has. */
const kit = (): never => {
  const element = (type: string) => (props: Record<string, unknown>) => ({ type, props }) as never

  return { Box: element('Box'), Text: element('Text'), Button: element('Button'), Input: element('Input') } as never
}

function setup(messages: { role: 'user' | 'assistant'; text: string; tools?: string[] }[] = []) {
  const state = newState({})
  const sent: string[] = []
  const act = new Proxy({ chat: { send: (text: string) => void sent.push(text), draft: (text: string) => setDraft(state, text) } } as unknown as Actions, { get: (target, key) => (key in target ? (target as never)[key] : () => undefined) })

  state.view = 'chat'
  chatOf(state).msgs = messages.map(msg => ({ role: msg.role, text: msg.text, tools: msg.tools ?? [] }))

  const drawn = (columns = 100): { lines: string[]; tree: Node } => {
    const tree = chatView({ kit: kit(), state, nowMs: 5_000, columns, pictures: new Map(), act }) as unknown as Node
    const lines: string[] = []

    linesOf(tree, lines)

    return { lines, tree }
  }
  const asText = (): string => viewText({ state, nowMs: 5_000, columns: 100, act }, 'chat')

  return { state, sent, act, drawn, asText }
}

const find = (node: unknown, pick: (node: Node) => boolean): Node | null => {
  if (node === null || typeof node !== 'object') return null
  if (Array.isArray(node)) return node.map(child => find(child, pick)).find(found => found !== null) ?? null

  const here = node as Node

  if (pick(here)) return here

  const children = here.props?.children

  return find(children, pick)
}

beforeEach(() => setLook('plain'))

describe('opening Chat shows the last messages', () => {
  it('frames the person and Claude, newest at the bottom', () => {
    const { drawn } = setup([
      { role: 'user', text: 'how do I rebase?' },
      { role: 'assistant', text: 'Use git rebase -i HEAD~3.' },
    ])
    const out = drawn().lines.join('\n')

    expect(out).toContain('you')
    expect(out).toContain('how do I rebase?')
    expect(out).toContain('claude')
    expect(out).toContain('Use git rebase -i HEAD~3.')
    expect(out.indexOf('how do I rebase?')).toBeLessThan(out.indexOf('Use git rebase'))
  })

  it('says so when there is nothing yet', () => {
    expect(setup().drawn().lines.join('\n')).toMatch(/nothing yet|no messages/i)
  })

  it('a tool-only answer reads "… used <tools>" instead of an empty block', () => {
    const out = setup([{ role: 'assistant', text: '', tools: ['Read', 'Edit'] }]).drawn().lines.join('\n')

    expect(out).toContain('… used Read, Edit')
  })

  it('an answer with text and tools shows both', () => {
    const out = setup([{ role: 'assistant', text: 'Done.', tools: ['Bash'] }]).drawn().lines.join('\n')

    expect(out).toContain('Done.')
    expect(out).toContain('used Bash')
  })

  it('a message the store cut shows the cut mark', () => {
    const [cut] = keepChat([{ role: 'assistant', text: 'x'.repeat(MAX_TEXT + 500), tools: [] }])
    const out = setup([{ role: 'assistant', text: (cut as { text: string }).text }]).drawn().lines.join('\n')

    expect(out).toContain(CUT_MARK)
  })

  it('a very long message is cut for the screen too, and drawing it stays fast', () => {
    const { drawn } = setup([...Array.from({ length: 199 }, () => ({ role: 'user' as const, text: 'y'.repeat(900) })), { role: 'assistant', text: `${'word '.repeat(4_000)}` }])
    const started = Date.now()
    const { lines } = drawn(80)

    expect(Date.now() - started).toBeLessThan(2_000)
    expect(lines.length).toBeLessThan(2_000)
    expect(lines.join('\n')).toContain(CUT_MARK)
  })
})

describe('the field', () => {
  it('is a focused Send field keyed chat-send, and Enter calls the send action once with the typed text', () => {
    const { drawn, sent } = setup()
    const input = find(drawn().tree, node => node.type === 'Input')

    expect(input?.props.key).toBe('chat-send')
    expect(input?.props.autoFocus).toBe(true)
    expect(input?.props.submitLabel).toBe('Send')
    ;(input?.props.onSubmit as (value: string) => void)('hello Claude')
    expect(sent).toEqual(['hello Claude'])
  })

  it('shows the pending state and the error, never the message', () => {
    const { state, drawn } = setup()

    chatOf(state).pending = 'sending'
    expect(drawn().lines.join('\n')).toContain('sending…')
    chatOf(state).pending = 'queued'
    expect(drawn().lines.join('\n')).toContain('queued — sends when Claude is free')
    chatOf(state).pending = 'idle'
    chatOf(state).sendError = 'not sent: Claude did not take the message'
    expect(drawn().lines.join('\n')).toContain('not sent: Claude did not take the message')
  })

  it('a refusal shows with messages on screen and without, beside a read error', () => {
    const { state, drawn } = setup([{ role: 'user', text: 'hi' }])

    chatOf(state).sendError = 'not sent: AIDefence flagged the message as unsafe'
    chatOf(state).error = 'could not read the conversation'

    const out = drawn().lines.join('\n')

    expect(out).toContain('not sent: AIDefence flagged the message as unsafe')
    expect(out).toContain('could not read the conversation')
    expect(setup().drawn().lines.join('\n')).not.toContain('not sent')
  })

  it('is controlled by the draft: it shows the draft, and typing updates it (final review 4)', () => {
    const { state, drawn } = setup()

    setDraft(state, 'half a thought')

    const input = find(drawn().tree, node => node.type === 'Input')

    expect(input?.props.value).toBe('half a thought')
    ;(input?.props.onInput as (value: string) => void)('half a thought, finished')
    expect(draftOf(state)).toBe('half a thought, finished')
    expect(find(drawn().tree, node => node.type === 'Input')?.props.value).toBe('half a thought, finished')
  })

  it('shows the fixed "already sending" note', () => {
    const { state, drawn } = setup()

    chatOf(state).pending = 'sending'
    chatOf(state).notice = 'already sending — wait for it'
    expect(drawn().lines.join('\n')).toContain('already sending — wait for it')
  })
})

describe('what the page draws is cleaned (final review 3)', () => {
  const ESC = '\u001b[31mRED\u001b[0m'
  const BIDI = 'left‮right'
  const INVITE = 'join with v2.eyAiY29kZSI6ICJ4In0.AbCdEf123456'

  it('a message drops escape sequences and bidi overrides, and masks an x.ruv.io invite code', () => {
    const { drawn } = setup([
      { role: 'user', text: `${ESC} ${BIDI}` },
      { role: 'assistant', text: `here: ${INVITE}` },
    ])
    const out = drawn().lines.join('\n')

    expect(out).toContain('RED')
    expect(out).not.toContain('\u001b')
    expect(out).not.toContain('‮')
    expect(out).not.toContain('eyAiY29kZSI6ICJ4In0')
  })

  it('the streaming answer is cleaned the same way', () => {
    const { state, drawn } = setup()

    appendPartial(state, `${ESC}\n${BIDI}\n${INVITE}`)

    const out = drawn().lines.join('\n')

    expect(out).toContain('Claude is writing…')
    expect(out).not.toContain('\u001b')
    expect(out).not.toContain('‮')
    expect(out).not.toContain('eyAiY29kZSI6ICJ4In0')
  })
})

describe('the streaming answer', () => {
  it('is a live "Claude is writing…" block under the last message', () => {
    const { state, drawn } = setup([{ role: 'user', text: 'tell me a story' }])

    appendPartial(state, 'Once upon a')
    appendPartial(state, ' time')

    const out = drawn().lines.join('\n')

    expect(out).toContain('Claude is writing…')
    expect(out).toContain('Once upon a time')
    expect(out.indexOf('tell me a story')).toBeLessThan(out.indexOf('Once upon a time'))
  })

  it('draws only the tail of a very long partial', () => {
    const { state, drawn } = setup()

    appendPartial(state, `${'a'.repeat(8_000)}THE-END`)

    const out = drawn().lines.join('\n')

    expect(out).toContain('THE-END')
    expect(out.length).toBeLessThan(6_000)
  })
})

describe('what a text answer, and Ask Claude, may see', () => {
  it('console_state text for chat has counts and no message text', () => {
    const { state, asText } = setup([
      { role: 'user', text: 'my password is hunter2-TOPSECRET' },
      { role: 'assistant', text: 'ok TOPSECRET noted', tools: ['Read'] },
    ])

    appendPartial(state, 'streaming TOPSECRET')

    const out = asText()

    expect(out).toContain('Chat: 2 messages, a reply is streaming')
    expect(out).not.toContain('TOPSECRET')
    expect(out).not.toContain('hunter2')
    expect(out).not.toContain('Read')
  })

  it('counts one message in the singular and a quiet chat without the streaming note', () => {
    expect(setup([{ role: 'user', text: 'hi' }]).asText()).toContain('Chat: 1 message')
    expect(setup([{ role: 'user', text: 'hi' }]).asText()).not.toContain('streaming')
  })

  it('"Ask Claude about this view" never quotes the chat', () => {
    const { state, act } = setup([{ role: 'user', text: 'secret plan TOPSECRET' }])
    const prompt = askPrompt(state, act, 'chat', '')

    expect(prompt).toContain('this view is not shared')
    expect(prompt).not.toContain('TOPSECRET')
    expect(prompt).toContain(`Question: ${VIEW_ASK.chat.default}`)
  })

  it('with the session preview setting off, no message text is drawn, only how to turn it on', () => {
    const { state, drawn, asText } = setup([{ role: 'user', text: 'private TOPSECRET' }, { role: 'assistant', text: 'reply TOPSECRET', tools: ['Read'] }])

    state.options.sessionPreview = false
    appendPartial(state, 'partial TOPSECRET')

    const out = drawn().lines.join('\n')

    expect(out).toContain('Chat is hidden: Settings → Session preview')
    expect(out).not.toContain('TOPSECRET')
    expect(find(drawn().tree, node => node.type === 'Input')).toBeNull()
    expect(asText()).not.toContain('TOPSECRET')
  })
})

describe('redraws while the answer streams', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const hostOf = () => {
    let invalidations = 0
    const host = { invalidate: () => void (invalidations += 1), after: (ms: number, fn: () => void) => ({ cancel: clearTimeout.bind(null, setTimeout(fn, ms)) }) } as unknown as Host

    return { host, invalidations: () => invalidations }
  }

  it('50 chunks in 100 ms redraw at most twice', () => {
    const { host, invalidations } = hostOf()
    const state = newState({})

    state.view = 'chat'
    state.pane.isOpen = true
    for (let i = 0; i < 50; i++) {
      appendPartial(state, 'chunk ')
      redrawChat(host, state)
      vi.advanceTimersByTime(2)
    }
    vi.advanceTimersByTime(1_000)
    expect(invalidations()).toBeGreaterThanOrEqual(1)
    expect(invalidations()).toBeLessThanOrEqual(2)
  })

  it('a later burst redraws again (the throttle does not stick)', () => {
    const { host, invalidations } = hostOf()
    const state = newState({})

    state.view = 'chat'
    state.pane.isOpen = true
    redrawChat(host, state)
    vi.advanceTimersByTime(1_000)
    redrawChat(host, state)
    vi.advanceTimersByTime(1_000)
    expect(invalidations()).toBe(2)
  })

  it('does nothing while another page is shown or the pane is closed', () => {
    const { host, invalidations } = hostOf()
    const state = newState({})

    state.pane.isOpen = true
    state.view = 'overview'
    redrawChat(host, state)
    state.view = 'chat'
    state.pane.isOpen = false
    redrawChat(host, state)
    vi.advanceTimersByTime(1_000)
    expect(invalidations()).toBe(0)
  })

  it('a host that refuses the redraw changes nothing', () => {
    const state = newState({})
    const host = { invalidate: () => { throw new Error('gone') }, after: (ms: number, fn: () => void) => ({ cancel: clearTimeout.bind(null, setTimeout(fn, ms)) }) } as unknown as Host

    state.view = 'chat'
    state.pane.isOpen = true
    redrawChat(host, state)
    expect(() => vi.advanceTimersByTime(1_000)).not.toThrow()
  })
})

describe('where Chat sits', () => {
  it('is a page with no hotkey, a label, and an inline height like its neighbours', () => {
    const view = VIEWS.find(entry => entry.id === 'chat')

    expect(view?.label).toBe('Chat with Claude')
    expect(view?.key).toBe('')
    expect(rowsOf('chat')).toBeGreaterThan(20)
    expect(viewOf('chat')).toBe('chat')
  })

  it('is in the SWARM group of the nav and the "start here" section of the menu', () => {
    expect(groupOf('chat')).toBe('SWARM')
    expect(NAV_GROUPS.filter(group => group.rows.some(row => row.includes('chat')))).toHaveLength(1)

    const swarm = GROUPS.find(group => group.title === 'SWARM')
    const section = swarm?.sections.find(entry => entry.name === 'start here')

    expect(section?.items.map(item => item.go)).toContain('chat')
  })

  it('is in the palette as view-chat, and a link in the band', () => {
    const state = newState({})

    expect(paletteEntries(state, 0).some(entry => entry.id === 'view-chat')).toBe(true)
    expect(BAND_LINKS.some(link => link.go === 'chat')).toBe(true)
  })
})

describe('opening the page reads the conversation once', () => {
  const hostWith = (reads: { n: number }) => ({ session: { messages: async () => (reads.n += 1, [{ role: 'user', text: 'hi', tools: [] }]), id: async () => 's' }, listCommands: async () => [] as string[], invalidate: () => undefined, after: () => ({ cancel: () => undefined }) }) as unknown as Host

  it('reads the messages when Chat opens', async () => {
    const state = newState({})
    const reads = { n: 0 }

    openLoaders(state, hostWith(reads), 'chat')
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(reads.n).toBe(1)
    expect(chatOf(state).msgs).toHaveLength(1)
  })

  it('reads nothing while the preview setting is off, or when another page opens', async () => {
    const state = newState({})
    const reads = { n: 0 }

    state.options.sessionPreview = false
    openLoaders(state, hostWith(reads), 'chat')
    state.options.sessionPreview = true
    openLoaders(state, hostWith(reads), 'overview')
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(reads.n).toBe(0)
  })
})

describe('state shape', () => {
  it('draws without a State chat entry yet (a fresh state)', () => {
    const state: State = newState({})

    state.view = 'chat'
    expect(() => viewText({ state, nowMs: 0, columns: 80, act: {} as Actions }, 'chat')).not.toThrow()
  })
})

describe('a tool loop draws no empty frames (final review 2)', () => {
  it('only the person’s words get a "you" frame, and tool-only answers read "… used"', async () => {
    const { toChatMsgs } = await import('../hooks/chat-msg')
    const rows = [
      { role: 'user', text: 'fix it', toolUses: [] },
      { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: {} }] },
      { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'BODY', isError: false }] },
      { role: 'assistant', text: 'done', toolUses: [] },
    ]
    const { state, drawn } = setup()

    chatOf(state).msgs = keepChat(toChatMsgs(rows as never))

    // The conversation is everything above the field's own rule ("… as you").
    const out = drawn().lines.join('\n').split('Say something')[0] ?? ''

    expect(out.match(/you/g)).toHaveLength(1)
    expect(out).toContain('… used Read')
    expect(out).not.toContain('BODY')
  })
})
