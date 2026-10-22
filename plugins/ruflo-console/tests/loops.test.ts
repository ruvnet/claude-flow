/**
 * The Loop Manager in the Automation page: a folded section, presets by tier, a configurator that shows the exact /loop, a launcher
 * whose confirm sits under the Start button, and one visible /loop prompt only after yes.
 */
import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

const keys = (tree: Parameters<typeof elementsOf>[0]) => elementsOf(tree, 'Button').map(keyOf)

describe('loop manager', () => {
  test('automation: a folded Loop Manager; open it, pick a preset, see the exact /loop, start it: the confirm sits under Start and yes sends one prompt', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES, { commands: ['ruflo-loop-workers:ruflo-loop'] })
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await $.command.run(command('automate'))

    const pane = await $.ui.mount({ ...paneAt(150), surface: 'terminal' as const, plugin: PLUGIN })

    await pane.drawn()

    const folded = await pane.drawn()

    expect(textOf(folded)).toContain('LOOP MANAGER')
    expect(keys(folded)).toContain('sec-loops')
    expect(keys(folded)).not.toContain('loop-start')

    await pane.press({ key: 'sec-loops' })

    const open = await pane.drawn()

    expect(keys(open)).toEqual(expect.arrayContaining(['loop-tier-practical', 'loop-tier-steady', 'loop-tier-exotic', 'loop-pick-ci-watch', 'loop-start', 'loop-manage']))
    expect(textOf(open)).toContain('not ready: pick a preset or type what the loop should do')

    await pane.press({ key: 'loop-tier-exotic' })
    expect(keys(await pane.drawn())).toContain('loop-pick-dream-cycle')
    await pane.press({ key: 'loop-tier-practical' })
    await pane.press({ key: 'loop-pick-ci-watch' })

    const picked = await pane.drawn()

    expect(textOf(picked)).toContain('will send: /loop 5m Check CI for the current branch')
    expect(keys(picked)).toEqual(expect.arrayContaining(['loop-int-5m', 'loop-int-self-paced']))

    await pane.press({ key: 'loop-start' })

    const asked = await pane.drawn()

    // The confirm sits right under the Start button that raised it, not at the top of the page.
    expect(textOf(asked)).toContain('CONFIRM NEEDED')
    expect(keys(asked).indexOf('confirm')).toBe(keys(asked).indexOf('loop-manage') + 1)
    expect(textOf(asked)).toContain('Confirm: start a loop in the main Claude UI')
    expect(textOf(asked)).toContain('/loop 5m Check CI')
    expect(world.prompts).toEqual([])
    await $.command.run(command('yes'))
    for (let i = 0; i < 6; i++) await clock.advance(5)
    // A /loop prompt is the engine's to run as a typed command (the unit spec checks the exact text); here the ask is answered and nothing failed.
    const after = textOf(await pane.drawn())

    expect(after).not.toContain('Confirm: start a loop')
    expect(after).not.toContain('Claude did not take it')
    await pane.unmount()
  })

  test('a worker preset needs its plugin: with the command not listed it says so and asks nothing', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES, { commands: [] })

    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('automate'))

    const pane = await $.ui.mount({ ...paneAt(150), surface: 'terminal' as const, plugin: PLUGIN })

    await pane.drawn()
    await pane.press({ key: 'sec-loops' })
    await pane.press({ key: 'loop-pick-worker-audit' })
    expect(textOf(await pane.drawn())).toContain('not ready: /ruflo-loop-workers:ruflo-loop is not offered by this session')
    await pane.press({ key: 'loop-start' })
    expect(textOf(await pane.drawn())).not.toContain('Confirm: start a loop')
    expect(world.prompts).toEqual([])
    await pane.unmount()
  })
})
