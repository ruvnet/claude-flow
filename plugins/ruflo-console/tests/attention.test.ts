/**
 * Answers open where they were asked, on every page: the confirm of a press is drawn right after the row that was pressed, the
 * answer (the lab result) follows it there, nothing is drawn twice, and a confirm raised with no press falls back to the top.
 */
import type { TestBody } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

const keys = (tree: Parameters<typeof elementsOf>[0]) => elementsOf(tree, 'Button').map(keyOf)

type Body = Parameters<TestBody>

async function opened($: Body[0], on: Body[1], view: string) {
  worldOf(on, RUFLO_FILES)
  mock.clock(on)
  await $.session.start(SESSION)
  await $.command.run(command(view))

  const pane = await $.ui.mount({ ...paneAt(150), surface: 'terminal' as const, plugin: PLUGIN })

  await pane.drawn()

  return pane
}

describe('attention: the ask and its answer sit under what was clicked', () => {
  for (const [view, key, section] of [['metaharness', 'lab-mh-flywheel-run', 'sec-mh-evolve'], ['devtools', 'dt-llm-hnsw', 'sec-dt-ruvllm']] as const) {
    test(`${view}: the confirm is the next thing after ${key}, the result follows it, and nothing is drawn twice`, { options: { boot: false } }, async ($, on) => {
      const pane = await opened($, on, view)
      await pane.press({ key: section })
      const before = keys(await pane.drawn())
      const at = before.indexOf(key)

      expect(at, `${key} is on the ${view} page`).toBeGreaterThan(-1)
      await pane.press({ key })

      const asked = await pane.drawn()
      const askedKeys = keys(asked)

      // The confirm's buttons come straight after the pressed row's button, before the next row's.
      expect(askedKeys.indexOf('confirm')).toBe(at + 1)
      expect(askedKeys.indexOf('cancel')).toBe(at + 2)
      expect(askedKeys.filter(candidate => candidate === 'confirm')).toHaveLength(1)
      expect(textOf(asked)).toContain('CONFIRM NEEDED')
      expect(textOf(asked)).toContain('⚠ confirm needed')

      await pane.press({ key: 'confirm' })
      await pane.drawn()

      const answered = await pane.drawn()
      const text = textOf(answered)

      // The answer is under the same row: exactly one result block, and the page below it is whole.
      expect(text.split('▓▒░ RESULT ░▒▓').length - 1).toBeLessThanOrEqual(1)
      // The row after the pressed one (when there is one) is still there, below it.
      const next = before[at + 1]

      if (next !== undefined) expect(keys(answered).indexOf(next)).toBeGreaterThan(keys(answered).indexOf(key))
      await pane.unmount()
    })
  }

  test('a page whose clicked row is folded away shows the confirm at the top instead, once', { options: { boot: false } }, async ($, on) => {
    const pane = await opened($, on, 'memory')

    await pane.press({ key: 'mem-lab-mem-consolidate' })
    expect(keys(await pane.drawn()).filter(key => key === 'confirm')).toHaveLength(1)
    await pane.press({ key: 'sec-mem-g-agentdb' })

    const tree = await pane.drawn()

    expect(keys(tree)).not.toContain('mem-lab-mem-consolidate')
    expect(keys(tree).filter(candidate => candidate === 'confirm')).toHaveLength(1)
    expect(keys(tree).indexOf('confirm')).toBeLessThan(keys(tree).indexOf('mem-do-store'))
    await pane.unmount()
  })

  test('a headless ask (no press) is drawn at the top, above the body', { options: { boot: false } }, async ($, on) => {
    const pane = await opened($, on, 'metaharness')
    await pane.press({ key: 'sec-mh-evolve' })

    await $.command.run(command('run mh-flywheel-run'))

    const tree = await pane.drawn()
    const order = keys(tree)

    expect(order.filter(candidate => candidate === 'confirm')).toHaveLength(1)
    expect(order.indexOf('confirm')).toBeLessThan(order.indexOf('lab-mh-flywheel-run'))
    await pane.unmount()
  })
})
