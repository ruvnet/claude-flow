/**
 * What the console's model tools may never do on their own (ADR-450 T8, T12): auto-confirm a network, spend or delete action, pass text that
 * looks like a secret, or let an environment variable raise Claude's control above what the person saved.
 */
import { describe, expect, it } from 'vitest'

import { DEV } from '../hooks/devtools'
import { allows, callTool, classOf, lowerOnly, parseControlEnv } from '../hooks/model-tools'
import { setup } from './fixtures/control-setup'

describe('what auto-confirm may never answer (ADR-450 T8)', () => {
  const ENTRIES = { read: 'mission-open', write: 'mission-create', network: 'x-publish', install: 'plugin-install', spend: 'hand-task', delete: 'mission-cancel' } as const
  const levels = ['read', 'write', 'manage', 'full'] as const

  for (const kind of ['read', 'write', 'network', 'install', 'spend', 'delete'] as const) {
    for (const confirm of ['ask', 'auto'] as const) {
      for (const level of levels) {
        const refused = !allows(level, kind)
        const waits = !refused && kind !== 'read' && (confirm === 'ask' || kind !== 'write')

        it(`${kind} at ${level}:${confirm} is ${refused ? 'refused' : waits ? 'left waiting for the person' : 'run'}`, async () => {
          const { deps, calls, state } = setup(level, confirm)
          const answer = await callTool('console_run', { id: ENTRIES[kind] }, deps)

          if (refused) expect(answer).toMatch(/^Refused: .*needs/)
          else if (waits) expect(answer).toMatch(/^Waiting for the person to confirm/)
          else expect(answer).toMatch(/^Done/)

          expect(calls.confirm).toBe(!refused && !waits && kind !== 'read' ? 1 : 0)
          expect(state.pending !== null).toBe(waits)
        })
      }
    }
  }

  it('never confirms a network, spend or delete action in auto, however many times Claude asks', async () => {
    const { deps, calls } = setup('full', 'auto')

    for (const id of ['x-publish', 'plugin-install', 'hand-task', 'mission-cancel']) {
      expect(await callTool('console_run', { id }, deps), id).toMatch(/^Waiting for the person to confirm/)
      deps.state.pending = null
    }
    expect(calls.confirm).toBe(0)
  })
})

describe('an entry\'s own cost is the floor of its class (ADR-450 T8)', () => {
  it('never reads a network, spend or delete Dev Tools entry as a plain write, whatever its words say', () => {
    const entry = DEV.find(e => e.id === 'dt-prov-test')
    expect(entry?.cost).toBe('network')
    const pending = { label: 'test every configured provider', args: ['providers', 'test', '--all'], expect: 'its result', note: 'asks each one for its models' }

    expect(classOf(pending)).toBe('write')
    expect(classOf({ ...pending, declared: 'network' })).toBe('network')
    expect(classOf({ ...pending, declared: 'write' })).toBe('write')
  })

  it('a declared class never lowers one the words already show', () => {
    expect(classOf({ label: 'delete the thing', args: [], expect: '', declared: 'write' })).toBe('delete')
  })
})

describe('text Claude passes is screened for secrets before it reaches an entry (ADR-450 T8)', () => {
  const TOKEN = `ghp_${'a1B2c3D4e5'.repeat(4)}`
  const SECRETS = [TOKEN, 'AKIAABCDEFGHIJKLMNOP', '-----BEGIN OPENSSH PRIVATE KEY-----', 'password=hunter2hunter2hunter2', `sk-ant-${'x'.repeat(30)}`, `xoxb-${'1'.repeat(12)}`]

  for (const secret of SECRETS) {
    it(`refuses a run whose text holds ${secret.slice(0, 8)}… and runs nothing, never echoing it`, async () => {
      const { deps, calls, state } = setup('manage', 'auto')
      const answer = await callTool('console_run', { id: 'mission-create', text: `post this: ${secret}` }, deps)

      expect(answer).toBe('Refused: that text looks like a secret. It was not used and is not shown. Do not pass keys, tokens or passwords to the console.')
      expect(answer).not.toContain(secret)
      expect(calls.runs).toEqual([])
      expect(JSON.stringify(state.control.log)).not.toContain(secret)
    })

    it(`refuses a set whose value holds ${secret.slice(0, 8)}… and fills nothing`, async () => {
      const { deps, calls } = setup('write', 'auto')
      const answer = await callTool('console_set', { field: 'goal', value: `use ${secret}` }, deps)

      expect(answer).toMatch(/^Refused: that text looks like a secret/)
      expect(answer).not.toContain(secret)
      expect(calls.goal).toEqual([])
    })
  }

  it('hides a secret behind zero-width characters no better', async () => {
    const { deps, calls } = setup('write', 'auto')

    expect(await callTool('console_run', { id: 'mission-create', text: `gh\u200bp_${'a1B2c3D4e5'.repeat(4)}` }, deps)).toMatch(/^Refused: that text looks like a secret/)
    expect(calls.runs).toEqual([])
  })

  it('still runs and sets clean text', async () => {
    const { deps, calls } = setup('write', 'auto')

    expect(await callTool('console_set', { field: 'goal', value: 'add a dark mode toggle' }, deps)).toMatch(/^Set goal/)
    expect(await callTool('console_run', { id: 'mission-create', text: 'a normal note about tokens in general' }, deps)).toMatch(/^Done/)
    expect(calls.goal).toEqual(['add a dark mode toggle'])
    expect(calls.runs).toEqual(['mission-create'])
  })
})

describe('the environment override may only lower control (ADR-450 T12)', () => {
  const levels = ['off', 'read', 'write', 'manage', 'full'] as const
  const rank = (level: (typeof levels)[number]) => levels.indexOf(level)

  for (const saved of levels) {
    for (const forced of levels) {
      for (const savedConfirm of ['ask', 'auto'] as const) {
        for (const forcedConfirm of ['ask', 'auto'] as const) {
          it(`saved ${saved}:${savedConfirm} with env ${forced}:${forcedConfirm}`, () => {
            const got = lowerOnly({ level: saved, confirm: savedConfirm }, { level: forced, confirm: forcedConfirm })

            expect(rank(got.level)).toBeLessThanOrEqual(rank(saved))
            expect(rank(got.level)).toBeLessThanOrEqual(rank(forced))
            expect(got.level).toBe(rank(forced) < rank(saved) ? forced : saved)
            expect(got.confirm).toBe(savedConfirm === 'ask' || forcedConfirm === 'ask' ? 'ask' : 'auto')
          })
        }
      }
    }
  }

  it('leaves the saved setting alone when there is no override, and cannot turn control on from off', () => {
    expect(lowerOnly({ level: 'write', confirm: 'ask' }, null)).toEqual({ level: 'write', confirm: 'ask' })
    expect(lowerOnly({ level: 'off', confirm: 'auto' }, parseControlEnv('full:auto'))).toEqual({ level: 'off', confirm: 'auto' })
    expect(lowerOnly({ level: 'read', confirm: 'ask' }, parseControlEnv('full:auto'))).toEqual({ level: 'read', confirm: 'ask' })
  })
})


describe('session budget per action class and install as full (ADR-450 T8)', () => {
  it('classes plugin and marketplace changes as install, which needs full and always asks', async () => {
    const { classOf, allows, ALWAYS_ASK } = await import('../hooks/model-tools')
    const make = (label: string, note?: string) => ({ label, args: [] as string[], expect: '', ...(note !== undefined && { note }) })

    for (const label of ['install a plugin', 'add the ruflo marketplace to Claude Code', 'update the ruflo marketplace clone', 'claude plugin enable x']) {
      expect(classOf(make(label)), label).toBe('install')
    }
    expect(allows('manage', 'install')).toBe(false)
    expect(allows('full', 'install')).toBe(true)
    expect(ALWAYS_ASK).toContain('install')
  })

  it('asks the person for a write action once the session budget is used, even in auto', async () => {
    const { SESSION_BUDGET } = await import('../hooks/model-tools')
    const { deps, calls, state } = setup('write', 'auto')

    for (let i = 0; i < SESSION_BUDGET.write; i += 1) expect(await callTool('console_run', { id: 'mission-create' }, deps)).toMatch(/^(Done|Ran)/)
    state.control.turnCalls = 0

    const over = await callTool('console_run', { id: 'mission-create' }, deps)

    expect(over).toMatch(/^Waiting for the person to confirm.*session budget of 20 auto-confirmed write actions is used up/)
    expect(state.pending).not.toBeNull()
    expect(calls.confirm).toBe(SESSION_BUDGET.write)
  })

  it('refuses a network action once its budget is used, so the person is not asked again and again', async () => {
    const { SESSION_BUDGET } = await import('../hooks/model-tools')
    const { deps, calls, state } = setup('manage', 'auto')

    for (let i = 0; i < SESSION_BUDGET.network; i += 1) {
      expect(await callTool('console_run', { id: 'x-publish' }, deps)).toMatch(/^Waiting/)
      state.pending = null
    }

    const over = await callTool('console_run', { id: 'x-publish' }, deps)

    expect(over).toMatch(/^Refused: the session budget for network actions \(5\) is used up/)
    expect(state.pending).toBeNull()
    expect(calls.cancel).toBe(1)
    expect(state.control.used.network).toBe(SESSION_BUDGET.network)
  })

  it('counts each class on its own and not read actions', async () => {
    const { deps, state } = setup('full', 'auto')

    await callTool('console_run', { id: 'mission-open' }, deps)
    await callTool('console_run', { id: 'mission-create' }, deps)
    await callTool('console_run', { id: 'plugin-install' }, deps)
    expect(state.control.used).toEqual({ write: 1, install: 1 })
  })
})
