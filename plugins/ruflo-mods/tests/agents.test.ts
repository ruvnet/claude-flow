import { describe, expect, test, tier } from 'claude-code/testing'

import { isKept, readUsage, USED_WINDOW_MS } from '../hooks/agents/trim'
import { consumer, run } from './fixtures/consumer'
import { START, world } from './fixtures/world'

tier('user')

const ENGINE = { plugin: 'engine', tier: 'core' } as never
const offer = (agent: string, source = 'plugin') => ({ agent, description: 'x', source, provider: ENGINE })
const NOW = 1_000_000_000_000
const ctx = (over: Partial<Parameters<typeof isKept>[1]> = {}) => ({ keep: new Set<string>(), usage: {}, prompt: '', now: NOW, ...over })

describe('agent.offer trim (ADR-451)', () => {
  test('off by default: every type stays offered', { plugins: [consumer] }, async ($, on) => {
    world(on)
    memory(on)
    on('agent.offer', () => ({ isOffered: true }))
    on('command.run', () => ({ text: 'core' }))
    await $.session.start(START)

    expect((await $.agent.offer(offer('lab:runner'))).isOffered).toBe(true)
    expect((await $.command.run(run('ruflo-mods'))).text).toContain('agent trim:  off')
  })

  test('on: unused plugin types are hidden, pinned, built-in and named ones are kept', { options: { agentTrim: true, agentTrimKeep: 'Lab:Keeper' } }, async ($, on) => {
    world(on)
    memory(on)
    on('agent.offer', () => ({ isOffered: true }))
    on('prompt.submit', ($, e) => ({ text: e.text }))
    await $.session.start(START)
    await $.prompt.submit({ text: 'please use the Specialist agent' } as never)

    expect((await $.agent.offer(offer('lab:runner'))).isOffered).toBe(false)
    expect((await $.agent.offer(offer('coder'))).isOffered).toBe(true)
    expect((await $.agent.offer(offer('ruflo-core:reviewer'))).isOffered).toBe(true)
    expect((await $.agent.offer(offer('Explore', 'built-in'))).isOffered).toBe(true)
    expect((await $.agent.offer(offer('lab:keeper'))).isOffered).toBe(true)
    expect((await $.agent.offer(offer('Specialist'))).isOffered).toBe(true)
  })

  test('a type that was already hidden by another hook stays hidden', { options: { agentTrim: true } }, async ($, on) => {
    world(on)
    memory(on)
    on('agent.offer', () => ({ isOffered: false }))
    await $.session.start(START)
    expect((await $.agent.offer(offer('coder'))).isOffered).toBe(false)
  })

  test('a spawned type is kept afterwards (the ledger), and /ruflo-mods counts the hidden', { options: { agentTrim: true }, plugins: [consumer] }, async ($, on) => {
    world(on)
    memory(on)
    on('agent.offer', () => ({ isOffered: true }))
    on('agent.spawn', () => ({ deny: 'test: no real spawn' }))
    on('command.run', () => ({ text: 'core' }))
    await $.session.start(START)

    expect((await $.agent.offer(offer('lab:runner'))).isOffered).toBe(false)
    await $.agent.spawn({ tool_use_id: 't', prompt: 'p', description: 'd', subagentType: 'lab:runner' } as never).catch(() => undefined)
    expect((await $.agent.offer(offer('lab:runner'))).isOffered).toBe(true)
    expect((await $.command.run(run('ruflo-mods'))).text).toContain('agent trim:  1 type(s) hidden')
  })
})

describe('isKept', () => {
  test('the 30-day window is exclusive at the edge', () => {
    expect(isKept(offer('lab:a'), ctx({ usage: { 'lab:a': NOW - USED_WINDOW_MS + 1 } }))).toBe(true)
    expect(isKept(offer('lab:a'), ctx({ usage: { 'lab:a': NOW - USED_WINDOW_MS } }))).toBe(false)
  })
  test('a hostile ledger cannot keep or crash anything', () => {
    expect(readUsage(null)).toEqual({})
    expect(readUsage([1])).toEqual({})
    expect(Object.keys(readUsage({ a: 'x', b: -1, c: Infinity, d: 5 }))).toEqual(['d'])
    expect(isKept(offer('constructor'), ctx({ usage: readUsage({}) }))).toBe(false)
  })
})

/** The clock and the plugin store, answered from memory. */
function memory(on: Parameters<typeof world>[0]) {
  const store = new Map<string, unknown>()
  on('clock.now', () => ({ value: NOW }))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  return store
}
