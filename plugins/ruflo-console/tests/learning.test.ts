/**
 * The Learning page: a pulse that moves, a folded Settings & configuration section whose switches ask first, and the folded
 * self-learning actions (pretrain, consolidate, the pattern store) whose confirm and answer open under the button pressed.
 */
import type { TestBody } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { inputKeys, command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

const keys = (tree: Parameters<typeof elementsOf>[0]) => elementsOf(tree, 'Button').map(keyOf)

type Body = Parameters<TestBody>

async function opened($: Body[0], on: Body[1]) {
  const world = worldOf(on, RUFLO_FILES)
  const clock = mock.clock(on)

  await $.session.start(SESSION)
  await $.command.run(command('learning'))

  const pane = await $.ui.mount({ ...paneAt(150), surface: 'terminal' as const, plugin: PLUGIN })

  await pane.drawn()

  return { world, clock, pane }
}

describe('learning page', () => {
  test('the pulse is there, and it moves: over a couple of seconds the pipeline marker visits more than one stage', { options: { boot: false } }, async ($, on) => {
    const { pane } = await opened($, on)
    const first = textOf(await pane.drawn())

    expect(first).toContain('LEARNING PULSE')
    expect(first).toMatch(/[●○] RETRIEVE/)

    // The pulse reads the clock the pane draws with. A press redraws the page; sample it across real time.
    const seen = new Set<string>()
    const mark = (text: string) => /● ([A-Z]+)/.exec(text)?.[1]

    for (let i = 0; i < 6 && seen.size < 2; i++) {
      await new Promise(resolve => setTimeout(resolve, 400))
      await pane.press({ key: 'sec-learn-config' })

      const at = mark(textOf(await pane.drawn()))

      if (at !== undefined) seen.add(at)
    }

    expect(seen.size).toBeGreaterThan(1)
    await pane.unmount()
  })

  test('Settings & configuration is folded; opened, a switch asks first with its key, and nothing runs until yes', { options: { boot: false } }, async ($, on) => {
    const { world, pane } = await opened($, on)
    const folded = await pane.drawn()

    expect(textOf(folded)).toContain('SETTINGS & CONFIGURATION')
    expect(keys(folded)).toContain('sec-learn-config')
    expect(keys(folded)).not.toContain('learn-cfg-off-neural.enabled')
    await pane.press({ key: 'sec-learn-config' })
    expect(keys(await pane.drawn())).toEqual(expect.arrayContaining(['learn-cfg-on-neural.enabled', 'learn-cfg-off-neural.enabled', 'learn-cfg-on-hooks.enabled']))
    await pane.press({ key: 'learn-cfg-off-neural.enabled' })

    const asked = await pane.drawn()

    expect(textOf(asked)).toContain('neural.enabled')
    expect(textOf(asked)).toContain('CONFIRM NEEDED')
    expect(world.runs.filter(argv => argv.includes('config') && argv.includes('set'))).toEqual([])
    await pane.unmount()
  })

  test('Self-learning actions is folded; opened, pretrain asks first with the confirm right under it; the pattern fields are there', { options: { boot: false } }, async ($, on) => {
    const { world, pane } = await opened($, on)

    expect(keys(await pane.drawn())).not.toContain('run-nn-pretrain-shallow')
    await pane.press({ key: 'sec-learn-actions' })

    const open = await pane.drawn()
    const order = keys(open)

    expect(order).toEqual(expect.arrayContaining(['run-nn-pretrain-shallow', 'run-nn-pretrain-medium', 'run-nn-pretrain-deep', 'run-nn-consolidate']))
    expect(inputKeys(open)).toEqual(expect.arrayContaining(['in-nn-pattern-search', 'in-nn-pattern-store']))
    await pane.press({ key: 'run-nn-pretrain-medium' })

    const asked = await pane.drawn()
    const after = keys(asked)

    expect(textOf(asked)).toContain('CONFIRM NEEDED')
    expect(textOf(asked)).toContain('pretrain from the repository (medium)')
    // The confirm follows the strip of three pretrain buttons, before the next row's button.
    expect(after.indexOf('confirm')).toBe(after.indexOf('run-nn-pretrain-deep') + 1)
    expect(world.runs.filter(argv => argv.includes('hooks_pretrain'))).toEqual([])
    await pane.unmount()
  })
})
