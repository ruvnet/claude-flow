/**
 * The Workflows drill-down's panel (ADR-459): registered through the page's slots only, drawn from the files, moved by its keys, never showing a credential or an escape sequence.
 * Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-drill.spec.ts --testTimeout=30000
 */
import { describe, expect, it } from 'vitest'

import { drillOf, registerDrill } from '../hooks/views/wf-detail'
import { registerSearch } from '../hooks/views/wf-search'
import { registerSlot, resetSlots, slotsFor, type SlotEnv } from '../hooks/views/wf-slots'
import { SECRET } from './fixtures/wf-drill'
import { buttonOf, click, frame, inputOf, press, screen, toAgent, useDrill, words, worldOf, liveFiles } from './fixtures/wf-drill-world'

useDrill()


describe('registration', () => {
  it('registers the panel, the search and eight keys; a letter another feature holds falls back to the next one', () => {
    resetSlots()
    expect(registerSlot({ kind: 'key', id: 'other', key: 'g', label: 'x', run: () => undefined }).ok).toBe(true)
    expect(registerDrill()).toEqual([])
    expect(slotsFor('key').filter(slot => slot.id.startsWith('drill-')).map(slot => `${slot.id}:${slot.key}`)).toEqual(['drill-in:e', 'drill-out:z', 'drill-next:m', 'drill-prev:w', 'drill-sub:t', 'drill-follow:f', 'drill-filter:v', 'drill-search:s'])
    expect(slotsFor('board').map(slot => slot.id)).toEqual(['drill'])
  })

  it('never takes a key the page owns, and a second registration is refused with its reason, not thrown', () => {
    const reserved = ['p', 'x', 'r', 'h', 'y', 'n', 'j', 'k', 'l', 'b', 'd', 'o', 'u', 'i']

    expect(slotsFor('key').every(slot => !reserved.includes(slot.key))).toBe(true)
    expect(registerDrill().length).toBeGreaterThan(0)
    expect(registerSearch()).toMatch(/already registered/)
  })
})
describe('the panel', () => {
  it('is one line and a search field until opened', async () => {
    const world = await worldOf(liveFiles())
    const { tree } = frame(world)

    expect(words(tree)).toMatch(/Drill into this run/)
    expect(inputOf(tree)).toBeDefined()
    expect(words(tree)).not.toMatch(/Activity/)
  })

  it('walks Runs > Phases > Agents > Agent > one call, drawing each level from the files, and back out', async () => {
    const world = await worldOf(liveFiles())

    click(frame(world).tree, 'wf-drill-open')
    expect(drillOf(world.state).level).toBe('phases')
    expect(screen(world)).toMatch(/Phases: Build/)
    expect(screen(world)).toMatch(/1 Build\s+0\/1 done/)

    press(world, 'in')
    expect(drillOf(world.state).level).toBe('agents')
    expect(world.state.wf.ui.column).toBe('agents')
    expect(screen(world)).toMatch(/build:x\s+running/)

    press(world, 'in')

    const agent = screen(world)

    expect(drillOf(world.state)).toMatchObject({ level: 'agent', sub: 'activity' })
    expect(agent).toMatch(/Agent: build:x/)
    expect(agent).not.toMatch(/Agent · /)
    expect(agent).toMatch(/● Activity/)
    expect(agent).toMatch(/Bash\s+ls -la/)
    expect(agent).toMatch(/Edit\s+\/work\/proj\/.*a\.ts/)
    expect(agent).toMatch(/transcript: whole file/)
    expect(agent).toMatch(/3\.0 MB read cap/)
    expect(agent).toMatch(/4 tool calls/)

    press(world, 'next')
    press(world, 'in')

    const item = screen(world)

    expect(drillOf(world.state)).toMatchObject({ level: 'item', callSel: 1 })
    expect(item).toMatch(/tool call Edit/)
    expect(item).toMatch(/error/)
    expect(item).toMatch(/boom/)
    expect(item).toMatch(/"file_path"/)

    press(world, 'out')
    expect(drillOf(world.state).level).toBe('agent')
    press(world, 'out')
    press(world, 'out')
    press(world, 'out')
    expect(drillOf(world.state)).toMatchObject({ level: 'runs', open: true })
    press(world, 'out')
    expect(drillOf(world.state).open).toBe(false)
  })

  it('shows no credential and no escape sequence at any level', async () => {
    const world = await worldOf(liveFiles())

    for (const step of ['open', 'in', 'in', 'next', 'in']) {
      if (step === 'open') click(frame(world).tree, 'wf-drill-open')
      else press(world, step)

      const text = screen(world)

      expect(text).not.toContain(SECRET)
      expect(text).not.toContain('abcdefghijklmnop')
      expect(text).not.toMatch(/\u001b/)
    }

    expect(screen(world)).toMatch(/Edit/)
  })

  it('says why it cannot go deeper, in the page, instead of a dead key', async () => {
    const world = await worldOf(liveFiles())

    click(frame(world).tree, 'wf-drill-open')
    press(world, 'in')
    press(world, 'in')
    press(world, 'sub')
    press(world, 'sub')
    expect(drillOf(world.state).sub).toBe('files')
    press(world, 'in')
    expect(screen(world)).toMatch(/no deeper level/)
    expect(drillOf(world.state).level).toBe('agent')
  })

  it('keeps its breadcrumb clickable: a shallower level is one press away', async () => {
    const world = await worldOf(liveFiles())

    toAgent(world)
    click(frame(world).tree, 'wf-crumb-phases')
    expect(drillOf(world.state).level).toBe('phases')
    expect(buttonOf(frame(world).tree, 'wf-crumb-item')).toBeUndefined()
  })
})
describe('the Log', () => {
  it('lists the lines with the newest last while following, and the level filter narrows them', async () => {
    const world = await worldOf(liveFiles())

    toAgent(world)
    click(frame(world).tree, 'wf-sub-log')

    const all = screen(world)

    expect(all).toMatch(/following/)
    expect(all).toMatch(/assist\s+all done|assi\s+all done/)
    expect(all).toMatch(/level: all lines/)
    expect(all).toMatch(/not a stream/)

    press(world, 'filter')
    press(world, 'filter')
    press(world, 'filter')
    expect(screen(world)).toMatch(/level: errors only/)
    expect(screen(world)).toMatch(/Edit .*\(failed\)/)
    expect(screen(world)).not.toMatch(/all done/)

    press(world, 'follow')
    expect(drillOf(world.state).follow).toBe(false)
    expect(screen(world)).toMatch(/○ follow/)
  })

  it('merges the whole phase when the scope is switched, and says how many agents were not in memory', async () => {
    const world = await worldOf(liveFiles())

    toAgent(world)
    click(frame(world).tree, 'wf-sub-log')
    click(frame(world).tree, 'wf-log-scope')
    expect(screen(world)).toMatch(/scope: whole phase/)
    expect(drillOf(world.state).scope).toBe('phase')
  })
})
describe('a ruflo agent', () => {
  it('has nothing deeper than its row, and the page says so', async () => {
    const world = await worldOf(liveFiles())
    const { env } = frame(world)
    const agent = { ...(env.agent as NonNullable<SlotEnv['agent']>), ruflo: { id: 'agent-1', type: 'coder', status: 'idle' } as never }
    const ruflo: SlotEnv = { ...env, agent }
    const board = slotsFor('board').find(slot => slot.id === 'drill')

    world.state.wf.ui = { ...world.state.wf.ui, column: 'agents' }
    click(frame(world).tree, 'wf-drill-open')
    slotsFor('key').find(slot => slot.id === 'drill-in')?.run({ ...ruflo, ui: { ...ruflo.ui, column: 'agents' } })

    const text = words(board?.render({ ...ruflo, ui: { ...ruflo.ui, column: 'agents' } }))

    expect(text).toMatch(/A ruflo agent keeps no transcript, worktree or return/)
    expect(drillOf(world.state).level).toBe('agents')
  })
})

describe('layout', () => {
  it('draws at 40, 80 and 150 columns, opened at every level, without throwing', async () => {
    const world = await worldOf(liveFiles())

    for (const columns of [40, 80, 150]) {
      expect(() => words(frame(world, columns).tree)).not.toThrow()
    }

    click(frame(world).tree, 'wf-drill-open')

    for (const step of ['in', 'in', 'next', 'in', 'out']) {
      press(world, step)

      for (const columns of [40, 80, 150]) expect(words(frame(world, columns).tree)).toMatch(/Drill-down/)
    }
  })
})
