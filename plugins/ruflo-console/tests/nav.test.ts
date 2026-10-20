/**
 * The compact nav on a real page: the groups and only the open group's pages, a group chip that shows another group's pages, a
 * search that lists matches (or says none matched), and the pages of the other groups still reached by their hotkey buttons.
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

  const pane = await $.ui.mount({ ...paneAt(120), surface: 'terminal' as const, plugin: PLUGIN })

  await pane.drawn()

  return pane
}

describe('the compact nav', () => {
  test('shows the five groups and the open group pages only; a chip shows another group; every page is still a button', { options: { boot: false } }, async ($, on) => {
    const pane = await opened($, on, 'swarm')
    const first = await pane.drawn()

    expect(keys(first)).toEqual(expect.arrayContaining(['nav-group-MIND', 'nav-group-SAFETY', 'nav-group-NETWORK', 'nav-group-TOOLS', 'tab-menu']))
    // The open group's pages are in the card; another group's pages are there too but hidden, so their hotkeys still work.
    expect(textOf(first)).toContain('[SWARM ▾]')
    // A bar sits between the menu and each group, and between pages on a row: the groups read as separate, not run together.
    expect(keys(first)).toEqual(expect.arrayContaining(['nav-bar-0', 'nav-bar-1']))
    expect(textOf(first)).toContain('│')
    expect(keys(first)).toEqual(expect.arrayContaining(['tab-missions', 'tab-hive', 'tab-learning', 'tab-memory']))

    await pane.press({ key: 'nav-group-MIND' })

    const mind = await pane.drawn()

    expect(textOf(mind)).toContain('[MIND ▾]')
    expect(textOf(mind)).toContain('Learning Lab')
    expect(textOf(mind)).not.toContain('Approvals')
    await pane.press({ key: 'tab-learning' })
    expect(textOf(await pane.drawn())).toContain('[7: ')
    await pane.unmount()
  })

  test('the search lists the pages it finds, says when none match, and clears', { options: { boot: false } }, async ($, on) => {
    const pane = await opened($, on, 'overview')

    await pane.input({ key: 'nav-find', text: 'lab', kind: 'submit' })

    const found = await pane.drawn()

    expect(textOf(found)).toMatch(/\d+ found for “lab”/)
    expect(keys(found)).toContain('nav-find-clear')
    expect(keys(found)).toEqual(expect.arrayContaining(['tab-memory', 'tab-vector']))
    await pane.input({ key: 'nav-find', text: 'zzzz-no-such-page', kind: 'submit' })
    expect(textOf(await pane.drawn())).toContain('no page matches “zzzz-no-such-page”')
    await pane.press({ key: 'nav-find-clear' })
    expect(keys(await pane.drawn())).not.toContain('nav-find-clear')
    await pane.unmount()
  })
})
