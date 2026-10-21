import { describe, expect, test, tier } from 'claude-code/testing'

import { consumer, run } from './fixtures/consumer'
import { prompt, START, world } from './fixtures/world'

tier('user')

const segment = (id: string, text: string | null) => run('consumer-segment', JSON.stringify({ id, text }))

describe('noun', () => {
  test('$.ruflo.segment composes other mods into the one bar: sanitised, bounded, sorted, cleared by null', { plugins: [consumer] }, async ($, on) => {
    const w = world(on)
    on('prompt.submit', ($, e) => ({ text: e.text }))
    on('command.run', () => ({ text: 'core' }))
    await $.session.start(START)
    await $.prompt.submit(prompt('write tests'))

    expect((await $.command.run(segment('ruos', 'ruOS 1/2 agents\u001b[31m · Work‮Desktop'))).text).toBe('ok')
    expect((await $.command.run(segment('aaa', 'x'.repeat(200)))).text).toBe('ok')
    expect(w.statuses.at(-1)).toBe(`ruflo · tester 60% · ${'x'.repeat(47)}… · ruOS 1/2 agents · Work Desktop`)

    await $.command.run(segment('aaa', null))
    expect(w.statuses.at(-1)).toBe('ruflo · tester 60% · ruOS 1/2 agents · Work Desktop')

    expect((await $.command.run(segment('bad id!', 'x'))).text).toMatch(/^error: /)
    for (let i = 0; i < 7; i++) await $.command.run(segment(`s${i}`, 'y'))
    expect((await $.command.run(segment('one-too-many', 'z'))).text).toMatch(/at most 8/)
  })

  test('lastRoute and snapshot answer copies of what the mod measured, nothing invented', { plugins: [consumer] }, async ($, on) => {
    world(on)
    on('prompt.submit', ($, e) => ({ text: e.text }))
    on('command.run', () => ({ text: 'core' }))
    await $.session.start(START)
    expect((await $.command.run(run('consumer-last-route'))).text).toBe('null')

    await $.prompt.submit(prompt('hello'))
    expect(JSON.parse((await $.command.run(run('consumer-last-route'))).text ?? 'null')).toEqual({
      agent: 'coder',
      confidence: 0.3,
      matched: false,
      reason: 'no-match-default',
    })
    const snap = JSON.parse((await $.command.run(run('consumer-snapshot'))).text ?? 'null')
    expect(snap).toMatchObject({ owned: ['route', 'post-edit'], routed: 1, policy: 'none', tightened: 0, edits: 0, segments: [] })
    expect(snap.budget).toBeUndefined()
  })
})
