/**
 * The Optimizer in the Overview page: findings with a scope that limits the fixes offered, and a fix whose confirm opens right under
 * the finding that raised it, before anything runs.
 */
import type { TestBody } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

type Body = Parameters<TestBody>

const keys = (tree: Parameters<typeof elementsOf>[0]) => elementsOf(tree, 'Button').map(keyOf)

async function opened($: Body[0], on: Body[1]) {
  const world = worldOf(on, RUFLO_FILES)

  mock.clock(on)
  await $.session.start(SESSION)
  await $.command.run(command('overview'))

  const pane = await $.ui.mount({ ...paneAt(150), surface: 'terminal' as const, plugin: PLUGIN })

  await pane.drawn()

  return { world, pane }
}

describe('optimizer', () => {
  test('the Overview opens with an Optimizer: findings, the scope chips, and only the safe fixes at first', { options: { boot: false } }, async ($, on) => {
    const { pane } = await opened($, on)
    const tree = await pane.drawn()
    const order = keys(tree)

    expect(textOf(tree)).toContain('OPTIMIZER')
    expect(textOf(tree)).toMatch(/\d+ findings?/)
    expect(order).toEqual(expect.arrayContaining(['opt-scope-safe', 'opt-scope-balanced', 'opt-scope-deep', 'opt-ask-performance-unprofiled']))
    expect(order).not.toContain('opt-fix-performance-unprofiled-perf-optimize')
    await pane.press({ key: 'opt-scope-balanced' })
    expect(keys(await pane.drawn())).toContain('opt-fix-performance-unprofiled-perf-optimize')
    await pane.unmount()
  })

  test('a fix asks first, and its confirm sits right under the finding that raised it; nothing runs until yes', { options: { boot: false } }, async ($, on) => {
    const { world, pane } = await opened($, on)

    await pane.press({ key: 'opt-scope-balanced' })
    await pane.press({ key: 'opt-fix-performance-unprofiled-perf-optimize' })

    const asked = await pane.drawn()
    const order = keys(asked)

    expect(textOf(asked)).toContain('CONFIRM NEEDED')
    expect(order.indexOf('confirm')).toBe(order.indexOf('opt-ask-performance-unprofiled') + 1)
    expect(world.runs.filter(argv => argv.includes('optimize') || argv.includes('performance_optimize'))).toEqual([])
    await pane.unmount()
  })
})
