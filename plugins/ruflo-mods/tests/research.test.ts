import { describe, expect, test, tier } from 'claude-code/testing'

import { ROOT, START, world } from './fixtures/world'

tier('user')

const MARKER = `${ROOT}/.claude-flow/research-active.json`
const HOUR = 60 * 60 * 1000
const marker = (over: Record<string, unknown> = {}, ageMs = 1000) =>
  JSON.stringify({ question: 'How do vector indexes scale?', capUsd: 2, startedAt: new Date(Date.now() - ageMs).toISOString(), ...over })

const web = (tool = 'WebFetch') => ({ tool, input: { url: 'https://example.com' } })
const measure = (usd: number) => ({ context: { window: 200_000 }, rateLimits: [], cost: { usd }, changed: ['cost' as const] })

describe('research guard (ADR-440)', () => {
  test('the first web call of a run asks, naming the question, the cap and untrusted content; the rest of the run is left alone', async ($, on) => {
    const w = world(on, {}, { [MARKER]: marker() })
    on('tool.check', () => ({ decision: 'allow' }))
    await $.session.start(START)

    const first = await $.tool.check(web('WebSearch'))
    expect(first.decision).toBe('ask')
    expect(first.reason).toContain('How do vector indexes scale?')
    expect(first.reason).toContain('$2')
    expect(first.reason).toMatch(/untrusted/)
    expect((await $.tool.check(web('WebFetch'))).decision).toBe('allow')
    expect((await $.tool.check(web('WebSearch'))).decision).toBe('allow')

    // a new run (a marker with a different startedAt) is asked once more
    w.files.set(MARKER, marker({ question: 'A different and longer question?' }, 500))
    expect((await $.tool.check(web())).decision).toBe('ask')
    expect((await $.tool.check(web())).decision).toBe('allow')
  })

  test('every other tool is untouched, before and after the ask', async ($, on) => {
    world(on, {}, { [MARKER]: marker() })
    on('tool.check', () => ({ decision: 'allow' }))
    await $.session.start(START)

    for (const tool of ['Read', 'Edit', 'Bash', 'Task', 'mcp__x__WebFetch']) {
      expect((await $.tool.check({ tool, input: { command: 'ls', file_path: 'a.ts' } })).decision).toBe('allow')
    }
    expect((await $.tool.check(web())).decision).toBe('ask')
    expect((await $.tool.check({ tool: 'Read', input: { file_path: 'a.ts' } })).decision).toBe('allow')
  })

  test('no active run: a missing, old, future, corrupt or malformed marker does nothing', async ($, on) => {
    const w = world(on)
    on('tool.check', () => ({ decision: 'allow' }))
    await $.session.start(START)

    expect((await $.tool.check(web())).decision).toBe('allow') // absent
    const cases: Array<[string, string]> = [
      ['older than 2 hours', marker({}, 2 * HOUR + 1000)],
      ['in the future', marker({}, -HOUR)],
      ['not json', '{nope'],
      ['no question', marker({ question: '' })],
      ['bad cap', marker({ capUsd: 'two' })],
      ['bad time', marker({ startedAt: 'yesterday' })],
      ['null', 'null'],
    ]
    for (const [name, text] of cases) {
      w.files.set(MARKER, text)
      expect((await $.tool.check(web()).catch(() => ({ decision: 'THROWN' }))).decision, name).toBe('allow')
    }
  })

  test('never loosens: a deny or an ask from the chain is returned as it was', async ($, on) => {
    world(on, {}, { [MARKER]: marker() })
    on('tool.check', ($, e) =>
      e.tool === 'WebFetch'
        ? { decision: 'deny', reason: 'WebFetch(domain:evil.test)', rule: 'WebFetch(domain:evil.test)' }
        : e.tool === 'WebSearch'
          ? { decision: 'ask', reason: 'mode asks' }
          : { decision: 'allow' },
    )
    await $.session.start(START)

    expect(await $.tool.check(web('WebFetch'))).toMatchObject({ decision: 'deny', rule: 'WebFetch(domain:evil.test)' })
    expect(await $.tool.check(web('WebSearch'))).toMatchObject({ decision: 'ask', reason: 'mode asks' })
  })

  test('at the cost HARD_STOP the guard adds nothing', { options: { costBudgetUsd: 1 } }, async ($, on) => {
    world(on, {}, { [MARKER]: marker() })
    on('tool.check', () => ({ decision: 'allow' }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    await $.session.start(START)

    await $.session.measure(measure(1.5))
    expect((await $.tool.check(web())).decision).toBe('allow')
  })
})
