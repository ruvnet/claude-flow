import { describe, expect, it } from 'vitest'
import type { EngineInterface } from 'claude-code'

import { hostOf } from '../hooks/register'

const SECRET = 'TOP-SECRET-RESULT-BODY'
const rows = [
  { role: 'user', text: 'read the file', toolUses: [], toolResults: [{ tool_use_id: 't1', text: SECRET, isError: false, result: { body: SECRET } }], handle: 'h1' },
  {
    role: 'assistant',
    text: 'done',
    toolUses: [
      { tool_use_id: 't1', tool: 'Read', input: { file_path: '/etc/secret-path' }, text: SECRET, result: { body: SECRET } },
      { tool_use_id: 't2', tool: 'mcp__ruflo__memory_store', input: { value: 'in-flight-input' } },
    ],
  },
  { role: 'assistant', text: '', toolUses: [] },
]

function fakeEngine() {
  const calls: unknown[][] = []
  const $ = {
    plugin: { root: '/plugin' },
    session: {
      messages: async (...args: unknown[]) => {
        calls.push(args)
        return rows
      },
      id: async () => 'session-42',
    },
  } as unknown as EngineInterface

  return { host: hostOf($, '/cwd', { prefs: () => ({}) as never, record: () => undefined }), calls }
}

describe('Host.session: the live conversation', () => {
  it('maps role, text and tool names; a row with nothing to draw is dropped', async () => {
    const { host } = fakeEngine()

    expect(await host.session.messages()).toEqual([
      { role: 'user', text: 'read the file', tools: [] },
      { role: 'assistant', text: 'done', tools: ['Read', 'mcp__ruflo__memory_store'] },
    ])
  })

  it('never carries tool results, tool inputs or the engine handle', async () => {
    const { host } = fakeEngine()
    const mapped = await host.session.messages()
    const json = JSON.stringify(mapped)

    expect(json).not.toContain(SECRET)
    expect(json).not.toContain('secret-path')
    expect(json).not.toContain('in-flight-input')
    expect(json).not.toContain('h1')
    for (const msg of mapped) expect(Object.keys(msg).sort()).toEqual(['role', 'text', 'tools'])
  })

  it('reads the main conversation only (no agentId) and passes the session id through', async () => {
    const { host, calls } = fakeEngine()

    await host.session.messages()
    expect(calls).toEqual([[]])
    expect(await host.session.id()).toBe('session-42')
  })
})

/** A realistic tool loop as the engine hands it back: every tool result rides a user row with no text of its own. */
const LOOP = [
  { role: 'user', text: 'fix the failing test', toolUses: [] },
  { role: 'assistant', text: 'Let me look.', toolUses: [{ tool_use_id: 'a', tool: 'Read', input: { file_path: 'x.ts' } }] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'RESULT-BODY-1', isError: false }] },
  { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'b', tool: 'Edit', input: {} }] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'b', text: 'RESULT-BODY-2', isError: false }] },
  { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'c', tool: 'Bash', input: {} }] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'c', text: 'RESULT-BODY-3', isError: false }] },
  { role: 'assistant', text: '', toolUses: [] },
  { role: 'assistant', text: 'Fixed: the test passes now.', toolUses: [] },
]

describe('Host.session: a tool loop (final review 2)', () => {
  it('drops the text-less tool-result rows and the empty assistant rows, keeping tool-only answers', async () => {
    const $ = { plugin: { root: '/plugin' }, session: { messages: async () => LOOP, id: async () => 's' } } as unknown as EngineInterface
    const host = hostOf($, '/cwd', { prefs: () => ({}) as never, record: () => undefined })

    expect(await host.session.messages()).toEqual([
      { role: 'user', text: 'fix the failing test', tools: [] },
      { role: 'assistant', text: 'Let me look.', tools: ['Read'] },
      { role: 'assistant', text: '', tools: ['Edit'] },
      { role: 'assistant', text: '', tools: ['Bash'] },
      { role: 'assistant', text: 'Fixed: the test passes now.', tools: [] },
    ])
  })
})

describe('Host.submitPrompt: a hook declined the prompt (final review 7a)', () => {
  function engine(answer: unknown) {
    const $ = {
      plugin: { root: '/plugin' },
      clock: { after: (_ms: number, fn: () => void) => (fn(), { cancel: () => undefined }) },
      prompt: { submit: async () => answer },
    } as unknown as EngineInterface

    return hostOf($, '/cwd', { prefs: () => ({}) as never, record: () => undefined })
  }

  it('resolves { isDropped: true } for a { drop } answer, and never carries the reason', async () => {
    const result = await engine({ drop: 'blocked: SECRET-REASON' }).submitPrompt('hi', { asUser: true })

    expect(result).toEqual({ isDropped: true })
    expect(JSON.stringify(result)).not.toContain('SECRET-REASON')
  })

  it('resolves nothing extra when the prompt entered', async () => {
    expect(await engine({ text: 'hi' }).submitPrompt('hi')).toBeUndefined()
  })
})
