/**
 * The Timeline and Events pages in the pane (ADR-474): the Timeline's window chips redraw the title, and the Events page's kind and level
 * chips, search field, pause button and empty-state wording are there and answer.
 */
import type { TestBody } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { inputKeys, command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

type Body = Parameters<TestBody>

const keys = (tree: Parameters<typeof elementsOf>[0]) => elementsOf(tree, 'Button').map(keyOf)

async function opened($: Body[0], on: Body[1], view: string) {
  worldOf(on, RUFLO_FILES)
  mock.clock(on)
  await $.session.start(SESSION)
  await $.command.run(command(view))

  const pane = await $.ui.mount({ ...paneAt(150), surface: 'terminal' as const, plugin: PLUGIN })

  await pane.drawn()

  return pane
}

describe('timeline and events pages', () => {
  test('timeline: the window chips change the window named in the title', { options: { boot: false } }, async ($, on) => {
    const pane = await opened($, on, 'timeline')
    const first = await pane.drawn()

    expect(keys(first)).toEqual(expect.arrayContaining(['tl-win-5m', 'tl-win-15m', 'tl-win-1h', 'tl-win-6h', 'tl-win-24h', 'tl-win-session', 'tl-zin', 'tl-zout', 'tl-now', 'tl-sort']))
    expect(textOf(first)).toContain('15 min')
    await pane.press({ key: 'tl-win-1h' })
    expect(textOf(await pane.drawn())).toContain('1 h')
    await pane.press({ key: 'tl-win-5m' })
    expect(textOf(await pane.drawn())).toContain('5 min')
    await pane.press({ key: 'tl-zout' })
    expect(textOf(await pane.drawn())).toContain('15 min')
    await pane.unmount()
  })

  test('events: kind chips, a search field and a pause button; searching for nothing says no event matches; pause then resume flips the button', { options: { boot: false } }, async ($, on) => {
    const pane = await opened($, on, 'events')
    const first = await pane.drawn()

    expect(keys(first)).toEqual(expect.arrayContaining(['ev-kind-all', 'ev-level-all', 'ev-win-all', 'ev-pause', 'ev-clear', 'ev-export-md', 'ev-forget']))
    expect(inputKeys(first)).toContain('ev-query')
    expect(textOf(first)).toContain('live')
    await pane.press({ key: 'ev-pause' })
    expect(textOf(await pane.drawn())).toContain('paused')
    expect(keys(await pane.drawn())).toContain('ev-pause')
    await pane.press({ key: 'ev-pause' })
    expect(textOf(await pane.drawn())).toContain('live')
    await pane.input({ key: 'ev-query', text: 'zzz-not-an-event', kind: 'submit' })

    const none = await pane.drawn()

    expect(textOf(none)).toMatch(/no event matches|Nothing has changed/)
    await pane.press({ key: 'ev-clear' })
    expect(textOf(await pane.drawn())).toContain('filters cleared')
    await pane.unmount()
  })
})
