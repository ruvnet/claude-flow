/**
 * The one gate for the chat mirror (PR-C, C4 fix round 1): the conversation is read, redrawn and focused only while the preview setting is
 * on, the console is open and Chat is the page shown. Outside it a turn costs no `messages()` call, no redraw and no focus; the streamed
 * answer is still kept in the store and still cleared at the turn's end.
 */
import { describe, expect, it } from 'vitest'

import { chatLive, chatOf, endChatTurn, onChatChunk, onChatTurnStart } from '../hooks/chat'
import { createController } from '../hooks/controller'
import type { Host } from '../hooks/host'
import { newState, type State } from '../hooks/state'

function setup(mode: 'live' | 'preview-off' | 'closed' | 'other-page') {
  const state = newState({})
  const counts = { messages: 0, invalidates: 0, focuses: 0 }
  const timers: (() => void)[] = []
  const host = {
    session: { messages: async () => (counts.messages += 1, [{ role: 'user' as const, text: 'hi', tools: [] }]), id: async () => 's' },
    invalidate: () => void (counts.invalidates += 1),
    after: (_ms: number, fn: () => void) => (timers.push(fn), { cancel: () => undefined }),
  } as unknown as Host

  state.view = mode === 'other-page' ? 'overview' : 'chat'
  state.pane.isOpen = mode !== 'closed'
  state.options.sessionPreview = mode !== 'preview-off'

  return { state, host, counts, fire: () => timers.splice(0).forEach(fn => fn()) }
}

const turn = async (host: Host, state: State, fire: () => void) => {
  onChatTurnStart(host, state)
  for (let i = 0; i < 10; i++) onChatChunk(host, state, 'chunk ')
  // With the preview off the streamed answer is not held at all (final review 6); otherwise it is kept for when Chat is shown.
  expect(chatOf(state).partial).toBe(state.options.sessionPreview ? 'chunk '.repeat(10) : '')
  fire()
  await endChatTurn(host, state)
  fire()
  await new Promise(resolve => setTimeout(resolve, 5))
}

describe('the chat gate', () => {
  for (const mode of ['preview-off', 'closed', 'other-page'] as const) {
    it(`${mode}: a whole turn makes no messages() call and no redraw, and the partial still clears`, async () => {
      const { state, host, counts, fire } = setup(mode)

      expect(chatLive(state)).toBe(false)
      await turn(host, state, fire)
      expect(counts.messages).toBe(0)
      expect(counts.invalidates).toBe(0)
      expect(chatOf(state).partial).toBe('')
    })
  }

  it('live: the turn start and end read the conversation, the chunks redraw, and the partial clears', async () => {
    const { state, host, counts, fire } = setup('live')

    expect(chatLive(state)).toBe(true)
    await turn(host, state, fire)
    expect(counts.messages).toBe(2)
    expect(counts.invalidates).toBeGreaterThanOrEqual(1)
    expect(chatOf(state).msgs).toHaveLength(1)
    expect(chatOf(state).partial).toBe('')
  })

  it('opening Chat focuses its field only while the preview is on', () => {
    for (const preview of [false, true]) {
      const state = newState({})
      let focuses = 0
      const host = new Proxy({}, {
        get: (_t, key) => {
          if (key === 'focus') return () => (focuses += 1, Promise.resolve())
          if (key === 'after' || key === 'every') return () => ({ cancel: () => undefined })
          if (key === 'pluginRoot') return '/plugin'
          if (key === 'fs') return { read: async () => Promise.reject(new Error('x')), stat: async () => Promise.reject(new Error('x')), list: async () => Promise.reject(new Error('x')) }
          if (key === 'session') return { messages: async () => [], id: async () => 's' }

          return () => Promise.resolve(undefined)
        },
      }) as unknown as Host
      const control = createController(state, host)

      state.options.sessionPreview = preview
      state.pane.isOpen = true
      state.pane.isFocused = true
      state.view = 'overview'
      control.setView('chat')
      expect(focuses > 0).toBe(preview)
    }
  })
})
