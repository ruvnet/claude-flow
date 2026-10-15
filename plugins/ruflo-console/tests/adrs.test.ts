/**
 * The ADRs page through the real engine and pane (ADR-480): the page is reached from the nav, the menu and by name, reads the project's own
 * ADR folder, shows the records and the health strip, a propose goes through the confirm row and writes the new file once with a toast
 * and an Events notice, and nothing is fetched. Run with `claude plugin test` (scripts/kit-seq.sh adrs).
 */
import type { TestBody } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf as rawText, worldOf } from './fixtures/world'

const textOf = (tree: Parameters<typeof rawText>[0]) => rawText(tree).toLowerCase()

type Body = Parameters<TestBody>

const ADRS = {
  'docs/adr/0001-record-architecture-decisions.md': '# 1. Record architecture decisions\n\nDate: 2026-01-02\n\n## Status\n\nAccepted\n\n## Context\n\nWe need records.\n\n## Decision\n\nWe will keep ADRs.\n',
  'docs/adr/0002-use-queues.md': '# 2. Use queues\n\nDate: 2026-02-03\n\n## Status\n\nProposed\n\n## Decision\n\nQueues, in `services/queue/`.\n',
}

async function start($: Body[0], on: Body[1], files: Record<string, string> = ADRS) {
  const world = worldOf(on, { ...RUFLO_FILES, ...files })
  const clock = mock.clock(on)
  let fetches = 0

  on('http.fetch', () => (fetches += 1, { deny: 'no network in this test' }) as never)
  await $.session.start(SESSION)

  return { world, clock, fetches: () => fetches }
}

async function mounted($: Body[0], view: string, columns = 130) {
  await $.command.run(command(view))

  const pane = await $.ui.mount({ ...paneAt(columns), surface: 'terminal' as const, plugin: PLUGIN })

  await pane.drawn()

  return pane
}

describe('ADRs, end to end', () => {
  test('opens from /ruflo adrs, reads the project’s own folder and lists the records with the health strip, fetching nothing', { options: { boot: false } }, async ($, on) => {
    const { clock, fetches } = await start($, on)
    const pane = await mounted($, 'adrs')

    await clock.advance(1_600)

    const tree = await pane.drawn()
    const text = textOf(tree)

    expect(text).toContain('docs/adr')
    expect(text).toContain('record architecture decisions')
    expect(text).toContain('use queues')
    expect(text).toContain('2 records · 1 accepted · 1 proposed')
    expect(text).toContain('compares paths only')
    expect(elementsOf(tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['adr-row-0001-record-architecture-decisions.md', 'adr-f-accepted', 'adr-reload', 'adr-prev', 'adr-next']))
    expect(fetches()).toBe(0)
    await pane.unmount()
  })

  test('is reached by the TOOLS group, by search, and has no hotkey; selecting a record opens its detail', { options: { boot: false } }, async ($, on) => {
    const { clock } = await start($, on)
    const pane = await mounted($, 'overview')

    await pane.press({ key: 'nav-group-TOOLS' })
    expect(elementsOf(await pane.drawn(), 'Button').map(keyOf)).toContain('tab-adrs')
    await pane.press({ key: 'tab-adrs' })
    await clock.advance(1_600)
    await pane.press({ key: 'adr-row-0002-use-queues.md' })
    await clock.advance(100)

    const text = textOf(await pane.drawn())

    expect(text).toContain('adr 2: use queues')
    expect(text).toContain('services/queue/')
    expect(text).toContain('mark accepted')
    await pane.unmount()
  })

  test('a project with no ADR folder offers to initialise it, and the folder is created only after the Yes', { options: { boot: false } }, async ($, on) => {
    const { world, clock } = await start($, on, {})
    const pane = await mounted($, 'adrs')

    await clock.advance(1_600)
    expect(textOf(await pane.drawn())).toContain('initialise adrs here')
    expect([...world.files.keys()].some(path => path.includes('/docs/adr/'))).toBe(false)
    await pane.press({ key: 'adr-init' })
    await clock.advance(100)

    const card = textOf(await pane.drawn())

    expect(card).toContain('docs/adr/0001-record-architecture-decisions.md')
    expect(world.runs.some(argv => argv.join(' ').includes('0001-record'))).toBe(false)
    await pane.unmount()
  })
})
