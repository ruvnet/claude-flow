import { describe, expect, it } from 'vitest'
import type { SessionMessage } from 'claude-code'

import { appendPartial, chatOf, chatStep, CUT_MARK, endChatTurn, KEEP_MSGS, MAX_TEXT, refreshChat, startChatTurn } from '../hooks/chat'
import { toChatMsgs, type ChatMsg } from '../hooks/chat-msg'
import type { Host } from '../hooks/host'
import { newState } from '../hooks/state'

const STEP_RESULT = { stop: 'end_turn', marker: 'from-beneath' }
const CHUNKS = [
  { kind: 'engine', ref: 1 },
  { kind: 'text', index: 0, text: 'Hello', ref: 2 },
  { kind: 'thinking', index: 1, text: 'hmm', ref: 3 },
  { kind: 'text', index: 0, text: ', world', ref: 4 },
  { kind: 'tool', index: 2, tool: 'Read', ref: 5 },
  { kind: 'input', index: 2, json: '{"file_path":"a"}', ref: 6 },
  { kind: 'stop', ref: 7 },
]

/** A fake `next`: an async generator over CHUNKS returning STEP_RESULT, with the `result` promise HookStream carries. */
function fakeNext() {
  const calls: unknown[] = []
  const next = (e: unknown) => {
    calls.push(e)
    let settle: (value: unknown) => void = () => undefined
    const result = new Promise(resolve => (settle = resolve))
    const gen = (async function* () {
      for (const chunk of CHUNKS) yield chunk
      settle(STEP_RESULT)

      return STEP_RESULT
    })()

    return Object.assign(gen, { result })
  }

  return { next, calls }
}

async function drive(observe: (text: string) => void, e: Record<string, unknown>) {
  const { next, calls } = fakeNext()
  const step = chatStep as unknown as (...args: unknown[]) => AsyncGenerator<unknown, unknown>
  const gen = step(e, next, observe)
  const out: unknown[] = []

  for (;;) {
    const step = await gen.next()
    if (step.done) return { out, result: step.value, calls }
    out.push(step.value)
  }
}

const MAIN = { turnId: 't1', index: 0, model: 'm', messageCount: 3 }

function fakeHost(rows: () => ChatMsg[] | Promise<ChatMsg[]>): Host {
  return { session: { messages: async () => rows(), id: async () => 's' } } as unknown as Host
}

describe('turn.step: the stream passes through untouched', () => {
  it('yields every chunk unchanged and in order, and returns what beneath returned', async () => {
    const state = newState(undefined)
    const { out, result, calls } = await drive(text => appendPartial(state, text), MAIN)

    expect(out).toEqual(CHUNKS)
    out.forEach((chunk, i) => expect(chunk).toBe(CHUNKS[i]))
    expect(result).toBe(STEP_RESULT)
    expect(calls).toEqual([MAIN])
  })

  it('grows partial from main-session text chunks only', async () => {
    const state = newState(undefined)

    await drive(text => appendPartial(state, text), MAIN)
    expect(chatOf(state).partial).toBe('Hello, world')

    const sub = await drive(text => appendPartial(state, text), { ...MAIN, agentId: 'agent-7' })
    expect(chatOf(state).partial).toBe('Hello, world')
    expect(sub.out).toEqual(CHUNKS)
    expect(sub.result).toBe(STEP_RESULT)
  })

  it('a throwing store update does not alter the stream', async () => {
    const { out, result } = await drive(() => {
      throw new Error('store broke')
    }, MAIN)

    expect(out).toEqual(CHUNKS)
    expect(result).toBe(STEP_RESULT)
  })
})

describe('the chat store', () => {
  it('partial clears when the main turn completes, after the messages are re-read', async () => {
    const state = newState(undefined)
    state.view = 'chat'
    state.pane.isOpen = true
    startChatTurn(state)
    appendPartial(state, 'streaming…')

    await endChatTurn(fakeHost(() => [{ role: 'assistant', text: 'streaming… done', tools: [] }]), state)

    expect(chatOf(state).partial).toBe('')
    expect(chatOf(state).msgs).toEqual([{ role: 'assistant', text: 'streaming… done', tools: [] }])
  })

  it('a refresh that lands after the next turn began leaves that turn’s partial alone', async () => {
    const state = newState(undefined)
    state.view = 'chat'
    state.pane.isOpen = true
    let release: (rows: ChatMsg[]) => void = () => undefined
    startChatTurn(state)
    const ending = endChatTurn(fakeHost(() => new Promise<ChatMsg[]>(resolve => (release = resolve))), state)

    startChatTurn(state)
    appendPartial(state, 'second turn')
    release([])
    await ending

    expect(chatOf(state).partial).toBe('second turn')
  })

  it('cuts a 25 KB message at 20,000 chars with the cut mark', async () => {
    const state = newState(undefined)
    await refreshChat(fakeHost(() => [{ role: 'assistant', text: 'x'.repeat(25_000), tools: [] }]), state)

    const text = chatOf(state).msgs[0]?.text ?? ''
    expect(text).toBe(`${'x'.repeat(MAX_TEXT)}${CUT_MARK}`)
  })

  it('caps the streaming answer at 20,000 chars too', () => {
    const state = newState(undefined)
    for (let i = 0; i < 30; i++) appendPartial(state, 'y'.repeat(1000))

    expect(chatOf(state).partial).toBe(`${'y'.repeat(MAX_TEXT)}${CUT_MARK}`)
  })

  it('stores a tool-only assistant message with its tools and empty text (the view renders "… used <tools>")', async () => {
    const state = newState(undefined)
    await refreshChat(fakeHost(() => [{ role: 'assistant', text: '', tools: ['Read', 'Grep'] }]), state)

    expect(chatOf(state).msgs).toEqual([{ role: 'assistant', text: '', tools: ['Read', 'Grep'] }])
  })

  it('keeps the newest 200 of 4,096 messages', async () => {
    const state = newState(undefined)
    const rows: ChatMsg[] = Array.from({ length: 4096 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', text: `m${i}`, tools: [] }))
    await refreshChat(fakeHost(() => rows), state)

    const msgs = chatOf(state).msgs
    expect(msgs).toHaveLength(KEEP_MSGS)
    expect(msgs[0]?.text).toBe('m3896')
    expect(msgs[KEEP_MSGS - 1]?.text).toBe('m4095')
  })

  it('a failed read keeps the last messages, says so without the reason, and never throws', async () => {
    const state = newState(undefined)
    await refreshChat(fakeHost(() => [{ role: 'user', text: 'hi', tools: [] }]), state)
    await refreshChat(fakeHost(() => Promise.reject(new Error('SECRET transcript line'))), state)

    expect(chatOf(state).msgs).toEqual([{ role: 'user', text: 'hi', tools: [] }])
    expect(chatOf(state).error).toBe('could not read the conversation')
    expect(chatOf(state).pending).toBe('idle')
  })

  it('lives beside the state, never in it (snapshots, exports and console_state never see transcript text)', async () => {
    const state = newState(undefined)
    await refreshChat(fakeHost(() => [{ role: 'user', text: 'PRIVATE-TRANSCRIPT', tools: [] }]), state)
    appendPartial(state, 'PRIVATE-PARTIAL')

    const json = JSON.stringify(state, (_key, value: unknown) => (value instanceof Map || value instanceof Set ? [...value] : value))
    expect(json).not.toContain('PRIVATE-TRANSCRIPT')
    expect(json).not.toContain('PRIVATE-PARTIAL')
  })
})

describe('toChatMsgs', () => {
  it('a row without toolUses maps to no tools instead of throwing', () => {
    const rows = [{ role: 'user', text: 'hi' }] as unknown as SessionMessage[]

    expect(toChatMsgs(rows)).toEqual([{ role: 'user', text: 'hi', tools: [] }])
  })
})

describe('turn.step: steps, early close and errors (final review 7b, 7d)', () => {
  const step = chatStep as unknown as (...args: unknown[]) => AsyncGenerator<unknown, unknown>

  /** A `next` whose generator yields `chunks`, then throws `fail` if given, and records whether its finally ran. */
  function upstream(chunks: unknown[], fail?: Error) {
    const seen = { finally: false }
    const next = () => {
      const gen = (async function* () {
        try {
          for (const chunk of chunks) yield chunk
          if (fail !== undefined) throw fail

          return STEP_RESULT
        } finally {
          seen.finally = true
        }
      })()

      return Object.assign(gen, { result: Promise.resolve(STEP_RESULT) })
    }

    return { next, seen }
  }

  it('a later step of the same turn starts on a new line in the streaming answer', async () => {
    const texts: string[] = []
    const first = step(MAIN, upstream([{ kind: 'text', index: 0, text: 'Let me look.' }]).next, (text: string) => texts.push(text))

    for await (const _ of first) void _

    const second = step({ ...MAIN, index: 1 }, upstream([{ kind: 'tool', index: 0, tool: 'Read' }, { kind: 'text', index: 1, text: 'Found it.' }, { kind: 'text', index: 1, text: ' Done.' }]).next, (text: string) => texts.push(text))

    for await (const _ of second) void _
    expect(texts.join('')).toBe('Let me look.\nFound it. Done.')
  })

  it('a step with no text adds no line break', async () => {
    const texts: string[] = []
    const gen = step({ ...MAIN, index: 2 }, upstream([{ kind: 'tool', index: 0, tool: 'Read' }]).next, (text: string) => texts.push(text))

    for await (const _ of gen) void _
    expect(texts).toEqual([])
  })

  it('a consumer that closes early (gen.return()) reaches the upstream generator’s finally', async () => {
    const { next, seen } = upstream(CHUNKS)
    const gen = step(MAIN, next, () => undefined)

    await gen.next()
    await gen.return(undefined)
    expect(seen.finally).toBe(true)
  })

  it('a subagent step closed early reaches the upstream finally too', async () => {
    const { next, seen } = upstream(CHUNKS)
    const gen = step({ ...MAIN, agentId: 'a1' }, next, () => undefined)

    await gen.next()
    await gen.return(undefined)
    expect(seen.finally).toBe(true)
  })

  it('an upstream throw propagates through chatStep unchanged', async () => {
    const boom = new Error('provider failed')
    const gen = step(MAIN, upstream([{ kind: 'text', index: 0, text: 'Hel' }], boom).next, () => undefined)

    await expect(
      (async () => {
        for await (const _ of gen) void _
      })(),
    ).rejects.toBe(boom)
  })
})

describe('Session preview off holds nothing (final review 6)', () => {
  it('appendPartial keeps no streamed text while the preview setting is off', () => {
    const state = newState({ sessionPreview: false } as never)

    expect(state.options.sessionPreview).toBe(false)
    appendPartial(state, 'PRIVATE-STREAM')
    expect(chatOf(state).partial).toBe('')
  })

  it('and keeps it again once the preview is on', () => {
    const state = newState(undefined)

    appendPartial(state, 'visible')
    expect(chatOf(state).partial).toBe('visible')
  })
})
