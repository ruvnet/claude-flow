import { describe, expect, mock, test } from 'claude-code/testing'

import { HIVE_TOKEN, RUFLO_RUN } from './fixtures/ruflo-run'
import { command, HINT, MAIN_SCREEN_HINT, PANE, PLUGIN, SESSION } from './fixtures/inputs'
import { buttonKeysOf, textOf, worldOf } from './fixtures/world'

describe('register', () => {
  test('the start registers the five commands and opens nothing by itself', async ($, on) => {
    const world = worldOf(on, RUFLO_RUN)

    mock.clock(on)
    await $.session.start(SESSION)

    expect(world.commands.sort()).toEqual(['ruflo-swarm-claims', 'ruflo-swarm-consensus', 'ruflo-swarm-pane', 'ruflo-swarm-status', 'ruflo-swarm-topology'])
    expect(world.opened).toEqual([])
  })

  test('with panel auto and a swarm on disk the pane opens once the fullscreen hint draws; on the main screen it waits', { options: { panel: 'auto' } }, async ($, on) => {
    const world = worldOf(on, RUFLO_RUN)
    const clock = mock.clock(on)

    on('ui.render', () => ({ type: 'Text', children: [''] }))
    await $.session.start(SESSION)
    await $.ui.render(MAIN_SCREEN_HINT)
    await clock.advance(200)
    expect(world.opened, 'not fullscreen: nothing opens unasked').toEqual([])

    await $.ui.render(HINT)
    await clock.advance(200)
    await $.ui.render(HINT)
    await clock.advance(200)
    expect(world.opened).toEqual([PLUGIN])
  })

  test('by default (panel command) nothing opens unasked, swarm or not: ruflo-console owns auto-start', async ($, on) => {
    const world = worldOf(on, RUFLO_RUN)
    const clock = mock.clock(on)

    on('ui.render', () => ({ type: 'Text', children: [''] }))
    await $.session.start(SESSION)
    await $.ui.render(HINT)
    await clock.advance(200)
    expect(world.opened).toEqual([])
  })

  test('with panel off the explicit pane subcommand refuses and opens nothing; close still works', { options: { panel: 'off' } }, async ($, on) => {
    const world = worldOf(on, RUFLO_RUN)

    mock.clock(on)
    await $.session.start(SESSION)

    const refused = await $.command.run(command('ruflo-swarm-pane'))

    expect(refused.text).toContain('swarm pane is off')
    expect(world.opened).toEqual([])
    expect((await $.command.run({ ...command('ruflo-swarm-pane'), args: 'close' })).text).toBe('Swarm pane hidden')
  })

  test('/ruflo swarm <sub> answers as the kept alias names do; other /ruflo words pass on', async ($, on) => {
    worldOf(on, RUFLO_RUN)
    mock.clock(on)
    on('command.run', ($, e) => ({ text: `beneath: ${e.args}` }))
    await $.session.start(SESSION)

    const ruflo = (args: string) => $.command.run({ ...command('ruflo'), args })

    for (const sub of ['status', 'topology', 'claims', 'consensus'] as const) {
      expect((await ruflo(`swarm ${sub}`)).text).toBe((await $.command.run(command(`ruflo-swarm-${sub}`))).text)
    }

    expect((await $.command.run({ ...command('ruflo-console'), args: 'swarm topology' })).text).toBe((await $.command.run(command('ruflo-swarm-topology'))).text)
    expect((await ruflo('swarm pane')).text).toBe('Swarm pane shown')
    expect((await ruflo('swarm')).text).toBe('beneath: swarm')
    expect((await ruflo('mods')).text).toBe('beneath: mods')
  })

  test('with no swarm on disk nothing opens, and the pane says how to start one', { options: { panel: 'auto' } }, async ($, on) => {
    const world = worldOf(on, { 'README.md': 'x' })
    const clock = mock.clock(on)

    on('ui.render', () => ({ type: 'Text', children: [''] }))
    await $.session.start(SESSION)
    await $.ui.render(HINT)
    await clock.advance(200)
    expect(world.opened).toEqual([])

    const tree = await $.ui.render(PANE)

    expect(textOf(tree)).toContain('No ruflo swarm on disk in this folder.')
    expect(textOf(tree)).toContain('/ruflo-swarm:swarm init')
    expect(buttonKeysOf(tree)).toEqual(['hide', 'fill'])

    await $.ui.press({ plugin: PLUGIN, key: 'fill' })
    expect(world.fills).toEqual(['/ruflo-swarm:swarm init'])
  })

  test('/ruflo-swarm-pane toggles the pane and says which', async ($, on) => {
    const world = worldOf(on, RUFLO_RUN)

    mock.clock(on)
    await $.session.start(SESSION)

    expect(await $.command.run(command('ruflo-swarm-pane'))).toEqual({ text: 'Swarm pane shown' })
    expect(await $.command.run(command('ruflo-swarm-pane'))).toEqual({ text: 'Swarm pane hidden' })
    expect(world.opened).toEqual([PLUGIN])
    expect(world.closed).toEqual([PLUGIN])
  })

  test('the markdown /ruflo-swarm:watch still runs, and the mod opens the pane beside it', async ($, on) => {
    const world = worldOf(on, RUFLO_RUN)
    const ran: string[] = []

    mock.clock(on)
    on('command.run', ($, e) => {
      ran.push(e.command)

      return { text: 'markdown command ran' }
    })
    await $.session.start(SESSION)

    expect(await $.command.run(command('ruflo-swarm:watch'))).toEqual({ text: 'markdown command ran' })
    expect(ran).toEqual(['ruflo-swarm:watch'])
    expect(world.opened).toEqual([PLUGIN])
  })

  test('the status, topology, claims and consensus commands report what is on disk, never the hive token', async ($, on) => {
    worldOf(on, RUFLO_RUN)
    mock.clock(on)
    await $.session.start(SESSION)

    const status = (await $.command.run(command('ruflo-swarm-status'))).text ?? ''
    const json = (await $.command.run(command('ruflo-swarm-status', 'json'))).text ?? ''
    const topology = (await $.command.run(command('ruflo-swarm-topology'))).text ?? ''
    const claims = (await $.command.run(command('ruflo-swarm-claims'))).text ?? ''
    const consensus = (await $.command.run(command('ruflo-swarm-consensus'))).text ?? ''

    expect(status).toContain('swarm …4-u3ktj4 · hierarchical · running')
    expect(status).toContain('· coder (ruflo) busy')
    expect(status).toContain('tasks: 1 pending, 1 claimed, 0 done')
    expect(status).toContain('router: no pick seen yet')
    expect(status).toContain('cost $0.421 · context 68k/200k (34%)')
    expect(topology).toContain('hierarchical (strategy specialized, max 8 agents, hive consensus byzantine)')
    expect(topology).toContain('★ queen')
    expect(topology).toContain('├─ coder')
    expect(claims).toContain('task-1790888817265-vatniv: active by agent coder agent-1790888815793-6ju96w')
    expect(consensus).toContain('open proposal-1790888860262-55jkcl design (raft): for 0, against 0')

    for (const text of [status, json, topology, claims, consensus]) {
      expect(text).not.toContain(HIVE_TOKEN)
    }
  })

  test('what the pane keeps across reloads is kept per folder: a router pick from another project never shows here', async ($, on) => {
    const world = worldOf(on, RUFLO_RUN)

    mock.clock(on)
    world.stored.set('ruflo-swarm/ui:/elsewhere', { selected: null, selectedTask: null, isClosedByPerson: false, route: { task: 't', agent: 'coder', confidence: 0.9, matched: true, alternatives: [], atMs: 1 } })
    await $.session.start(SESSION)

    expect(textOf(await $.ui.render(PANE))).toContain('router: no pick seen yet')
  })
})
