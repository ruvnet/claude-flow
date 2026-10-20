import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { cliAnswer, command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

/** Every area, by the name `/ruflo <name>` takes. */
const VIEWS = ['overview', 'swarm', 'hive', 'claims', 'federation', 'plugins', 'learning', 'metaharness', 'memory', 'cost', 'timeline', 'approvals', 'events', 'room', 'missions', 'xruv', 'skills', 'secure', 'perf', 'automate', 'neural', 'vector', 'evolve', 'devtools', 'sandbox', 'market', 'settings']

/** Buttons that only move the cursor inside a list that has nothing to move over in the fixture world. */
const SCROLL = /^(prev|next|up|down|older|newer|page|older-|newer-|refresh|close|task-next|approve-1|net-|ev-kind-all|room-src-all|tl-range-|sk-scope-project|evolve-reread|xr-(name|about)-|cat-load|cat-reload|st-name-|st-reload|st-level-|nav-style-|mc-tab-|mc-profile-|mc-rigor-|sec-)/i

describe('every button does something', () => {
  for (const view of VIEWS) {
    test(`${view}: pressing each button changes the screen, asks, or runs one thing`, { options: { boot: false }, timeoutMs: 30_000 }, async ($, on) => {
      const world = worldOf(on, RUFLO_FILES)

      world.respond = argv => cliAnswer(argv)
      const clock = mock.clock(on)
      await $.session.start(SESSION)
      await $.command.run(command(view))

      const pane = await $.ui.mount({ ...paneAt(140), surface: 'terminal' as const, plugin: PLUGIN })
      const keys = [...new Set(elementsOf(await pane.drawn(), 'Button').map(keyOf))].filter(key => !key.startsWith('tab-') && key !== '')
      const dead: string[] = []

      for (const key of keys) {
        await $.command.run(command('no'))
        await $.command.run(command(view))

        const before = textOf(await pane.drawn())
        const runs = world.runs.length
        const stats = world.stats.length

        try {
          await pane.press({ key })
        } catch (error) {
          // A button an earlier press removed (a reload that empties the list) is gone, not dead.
          if (!/no Button/.test(String(error))) dead.push(`${key} (press threw)`)

          continue
        }

        // Refresh can leave cached data and the text unchanged, but must ask the filesystem again. Let its async read start,
        // without issuing /ruflo status (which would itself refresh and hide a broken button).
        if (key === 'pane-icon-refresh' || key === 'refresh') for (let i = 0; i < 6; i++) await clock.advance(0)
        const after = textOf(await pane.drawn())

        if (after === before && world.runs.length === runs && world.stats.length === stats && !SCROLL.test(key)) dead.push(key)
      }

      await pane.unmount()
      expect(dead).toEqual([])
    })
  }

  test('the refresh icon reads changed disk data on a view with no CLI probes, without a status command', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await $.command.run(command('swarm'))

    const pane = await $.ui.mount({ ...paneAt(140), plugin: PLUGIN })

    expect(textOf(await pane.drawn())).not.toContain('refreshed-coder')
    const store = JSON.parse(RUFLO_FILES['.claude-flow/agents/store.json'] as string) as { agents: Record<string, { name: string }> }
    ;(Object.values(store.agents)[0] as { name: string }).name = 'refreshed-coder'
    world.put('.claude-flow/agents/store.json', JSON.stringify(store))
    const before = world.reads.length
    const runsBefore = world.runs.length
    await pane.press({ key: 'pane-icon-refresh' })

    let refreshed = ''
    for (let i = 0; i < 10 && !refreshed.includes('refreshed-coder'); i++) {
      await clock.advance(5)
      refreshed = textOf(await pane.drawn())
    }

    expect(world.reads.slice(before)).toContain('/work/.claude-flow/agents/store.json')
    expect(refreshed).toContain('refreshed-coder')
    expect(world.runs).toHaveLength(runsBefore)
    await pane.unmount()
  })
})
