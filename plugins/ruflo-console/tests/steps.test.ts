/**
 * The "Start here" card on a page with an order: in an empty project it leads the Swarm page with the first step marked next, the
 * step's button asks before it runs anything (the confirm opens right under the step), and a project that already has everything
 * the disk can check is not asked for again: its steps show done and the next one is marked.
 */
import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

const keys = (tree: Parameters<typeof elementsOf>[0]) => elementsOf(tree, 'Button').map(keyOf)

describe('start here', () => {
  test('an empty project: the Swarm page leads with its steps, the first is next, and its button asks before it runs', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, {})

    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('swarm'))

    const pane = await $.ui.mount({ ...paneAt(120), plugin: PLUGIN })
    const first = await pane.drawn()
    const text = textOf(first)

    expect(text).toMatch(/START HERE: GET A SWARM GOING/i)
    expect(text).toContain('▶ 1. Initialise ruflo in this project')
    expect(text).toContain('0 of 5 done')
    expect(text).toContain('○ 2. Start a swarm')
    expect(keys(first)).toEqual(expect.arrayContaining(['step-swarm-0', 'step-swarm-1', 'step-swarm-5']))

    await pane.press({ key: 'step-swarm-0' })
    expect(textOf(await pane.drawn())).toContain('Confirm: initialise ruflo in this project')
    expect(world.runs.filter(argv => argv.includes('init'))).toEqual([])
    await pane.press({ key: 'cancel' })
    expect(world.runs.filter(argv => argv.includes('init'))).toEqual([])
    await pane.unmount()
  })

  test('a project with ruflo and a swarm shows those steps done, and the next one marked', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('swarm'))

    const pane = await $.ui.mount({ ...paneAt(120), plugin: PLUGIN })

    const text = textOf(await pane.drawn())

    expect(text).toContain('✔ 1. Initialise ruflo in this project')
    expect(text).toContain('✔ 2. Start a swarm')
    expect(text).toMatch(/▶ [3-5]\. Spawn a/)
    expect(text).toMatch(/[2-4] of 5 done/)
    await pane.unmount()
  })
})
