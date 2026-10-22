import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { decodeRing, encodePrefs } from '../hooks/toast-policy'
import { RUFLO_RUN } from './fixtures/ruflo-run'
import { SESSION } from './fixtures/inputs'
import { worldOf } from './fixtures/world'

declare const setTimeout: (fn: () => void, ms: number) => unknown

const RING = '.claude-flow/console/toasts/swarm.jsonl'
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 25))
const failing = (command: string, agentId = 'agent-cc-1') => ({ tool: 'Bash', command, agentId }) as never

/** The world, plus the console's folder and the two file calls the policy makes (exists, write). */
function rig(on: On, opts: { console?: boolean; prefs?: Parameters<typeof encodePrefs>[0] } = {}) {
  const world = worldOf(on, opts.prefs === undefined ? RUFLO_RUN : { ...RUFLO_RUN, '.claude-flow/console/toast-prefs.json': encodePrefs(opts.prefs) })

  mock.clock(on)
  on('fs.exists', ($, e) => ({ value: opts.console !== false && e.path.endsWith('.claude-flow/console') }))
  on('fs.write', ($, e) => (world.files.set(e.path.replace(/^\/work\//, ''), e.text), { value: undefined }))
  on('tool.call', () => ({ deny: 'boom' }))

  return { world, ring: () => decodeRing(world.files.get(RING)) }
}

describe('toasts (ADR-477): the swarm sources', () => {
  test('a loop that fails the same call three times running is called stuck, once a minute at most, and it is persisted', async ($, on) => {
    const { world, ring } = rig(on)

    await $.session.start(SESSION)
    for (let i = 0; i < 6; i++) await $.tool.call(failing('npm test'))
    await settle()
    expect(world.toasts).toEqual(['⚠ swarm: subagent …cc-1 keeps failing Bash npm test'])
    expect(ring().map(d => d.why)).toEqual(['shown', 'deduped'])
  })

  test('two different calls failing is not a stuck loop', async ($, on) => {
    const { world } = rig(on)

    await $.session.start(SESSION)
    for (const command of ['a', 'b', 'a', 'b', 'a', 'b']) await $.tool.call(failing(command))
    await settle()
    expect(world.toasts).toEqual([])
  })

  test('a subagent that ends badly is an error; an answer and an abort are not', async ($, on) => {
    const { world, ring } = rig(on)

    await $.session.start(SESSION)
    await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'agent-cc-2' } as never)
    await $.turn.complete({ answer: '', durationMs: 5, isAborted: true, turnId: 't2', reason: 'aborted', agentId: 'agent-cc-3' } as never)
    await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: 't3', reason: 'max_turns', agentId: 'agent-cc-4' } as never)
    await settle()
    expect(world.toasts).toEqual(['✗ swarm: subagent …cc-4 failed (max_turns)'])
    expect(ring()).toMatchObject([{ level: 'error', why: 'shown' }])
  })

  test('the Toasts setting: off draws nothing and records; muting swarm silences it too', async ($, on) => {
    const off = rig(on, { prefs: { mode: 'off', muted: [] } })

    await $.session.start(SESSION)
    await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: 't3', reason: 'max_turns', agentId: 'agent-cc-4' } as never)
    await settle()
    expect(off.world.toasts).toEqual([])
    expect(off.ring()).toMatchObject([{ why: 'off', shown: false }])
  })

  test('muted: an error is not drawn and is recorded as muted', async ($, on) => {
    const { world, ring } = rig(on, { prefs: { mode: 'all', muted: ['swarm'] } })

    await $.session.start(SESSION)
    await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: 't3', reason: 'max_turns', agentId: 'agent-cc-4' } as never)
    await settle()
    expect(world.toasts).toEqual([])
    expect(ring()).toMatchObject([{ why: 'muted', level: 'error' }])
  })

  test('without the console the toast draws and no file is written', async ($, on) => {
    const { world } = rig(on, { console: false })

    await $.session.start(SESSION)
    await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: 't3', reason: 'max_turns', agentId: 'agent-cc-4' } as never)
    await settle()
    expect(world.toasts).toHaveLength(1)
    expect([...world.files.keys()].some(key => key.includes('toasts/'))).toBe(false)
  })
})
