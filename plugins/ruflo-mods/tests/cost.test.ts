import { describe, expect, test, tier } from 'claude-code/testing'

import { consumer, run } from './fixtures/consumer'
import { START, world } from './fixtures/world'

tier('user')

const measure = (usd: number) => ({ context: { window: 200_000 }, rateLimits: [], cost: { usd }, changed: ['cost' as const] })

describe('cost', () => {
  test('the budget ladder says each rung once on the way up; HARD_STOP halts new agents', { plugins: [consumer], options: { costBudgetUsd: 2, costHardStop: true } }, async ($, on) => {
    world(on)
    const toasts: string[] = []
    on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('agent.spawn', () => ({ model: 'sonnet' }))
    on('command.run', () => ({ text: 'core' }))
    await $.session.start(START)

    const spawn = () =>
      $.agent.spawn({ prompt: 'p', description: 'd', subagentType: 'coder' } as Parameters<typeof $.agent.spawn>[0])
    expect(await spawn()).toEqual({ model: 'sonnet' })
    for (const usd of [0.5, 1.1, 1.2, 1.6, 1.85, 2.4]) await $.session.measure(measure(usd))

    expect(toasts.map(t => t.split(':')[0])).toEqual(['› ruflo budget INFO', '⚠ ruflo budget WARNING', '✗ ruflo budget CRITICAL', '✗ ruflo budget HARD_STOP'])
    expect((await spawn()).deny).toMatch(/halted \(costHardStop\)/)
    expect(JSON.parse((await $.command.run(run('consumer-snapshot'))).text ?? 'null').budget).toEqual({ level: 'HARD_STOP', usd: 2.4, limit: 2 })
  })

  test('/clear starts a new session: the ladder is told again and the hard stop lifts', { options: { costBudgetUsd: 2, costHardStop: true } }, async ($, on) => {
    world(on)
    const toasts: string[] = []
    on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('agent.spawn', () => ({ model: 'sonnet' }))
    on('session.end', () => ({ sessionId: 's' }) as never)
    const spawn = () =>
      $.agent.spawn({ prompt: 'p', description: 'd', subagentType: 'coder' } as Parameters<typeof $.agent.spawn>[0])
    await $.session.start(START)
    await $.session.measure(measure(2.4))
    expect((await spawn()).deny).toMatch(/costHardStop/)

    // /clear: session.end with reason clear and no session.start (engine contract); the next
    // session's cost is counted from zero (measured live on 2.1.289).
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } } as never)
    expect(await spawn()).toEqual({ model: 'sonnet' })
    await $.session.measure(measure(1.1))
    expect(toasts.map(t => t.split(':')[0])).toEqual(['✗ ruflo budget HARD_STOP', '› ruflo budget INFO'])
  })

  test('only /clear restarts the ladder: another session end keeps the hard stop', { options: { costBudgetUsd: 2, costHardStop: true } }, async ($, on) => {
    world(on)
    on('session.measure', ($, e) => ({ changed: e.changed }))
    on('agent.spawn', () => ({ model: 'sonnet' }))
    on('session.end', () => ({ sessionId: 's' }) as never)
    const spawn = () =>
      $.agent.spawn({ prompt: 'p', description: 'd', subagentType: 'coder' } as Parameters<typeof $.agent.spawn>[0])
    await $.session.start(START)
    await $.session.measure(measure(2.4))
    await $.session.end({ reason: 'other', sessionId: 's', resume: { id: 's' } } as never)
    expect((await spawn()).deny).toMatch(/costHardStop/)
  })

  test('a rung announced once stays quiet when cost falls and rises again', { options: { costBudgetUsd: 2 } }, async ($, on) => {
    world(on)
    const toasts: string[] = []
    on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    await $.session.start(START)
    for (const usd of [1.1, 0.2, 1.2, 1.6, 1.0, 1.7, 1.9]) await $.session.measure(measure(usd))
    expect(toasts.map(t => t.split(':')[0])).toEqual(['› ruflo budget INFO', '⚠ ruflo budget WARNING', '✗ ruflo budget CRITICAL'])
  })
})
