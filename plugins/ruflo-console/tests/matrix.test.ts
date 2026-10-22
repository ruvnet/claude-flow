/**
 * The regression matrix: every section is mounted and checked against the frame contract, then asked about through the Claude UI
 * bridge. For each view in VIEWS, at a narrow and a wide pane: it draws without throwing, shows its title, prints no
 * undefined/NaN/[object]/TypeError, and has no two elements with one key. Wide, the ✦ Ask Claude
 * button asks first with the exact text, and on yes sends exactly one visible prompt that names the view, carries its text as
 * quoted data, and holds no secret. Nothing here spends: the prompt goes to the fake world.
 */
import { describe, expect, mock, test } from 'claude-code/testing'

import { missionCli } from './fixtures/mission-cli'
import { RUFLO_FILES } from './fixtures/ruflo-run'
import { command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'
import { VIEWS } from '../hooks/state'

const BAD = /\bundefined\b|\bNaN\b|\[object |TypeError|ReferenceError|Cannot read prop/


describe('matrix: every section', () => {
  for (const view of VIEWS) {
    test(`${view.id}: frame contract at 80 and 150 columns, then ask Claude through the bridge`, { options: { boot: false } }, async ($, on) => {
      const world = worldOf(on, RUFLO_FILES, { commands: ['ruflo-cost-tracker:ruflo-cost'] })

      world.respond = missionCli

      const clock = mock.clock(on)

      await $.session.start(SESSION)
      await $.command.run(command(view.id))

      for (const columns of [80, 150]) {
        const pane = await $.ui.mount({ ...paneAt(columns), surface: 'terminal' as const, plugin: PLUGIN })

        await pane.drawn()

        const tree = await pane.drawn()
        const text = textOf(tree)

        expect(text, `${view.id}@${columns} text`).not.toMatch(BAD)
        expect(text.length, `${view.id}@${columns} drew something`).toBeGreaterThan(200)
        expect(text.toLowerCase(), `${view.id}@${columns} names itself`).toContain(view.label.toLowerCase().split(' ')[0] as string)

        const keyed = [...elementsOf(tree, 'Button'), ...elementsOf(tree, 'Input')].map(keyOf)

        expect(new Set(keyed).size, `${view.id}@${columns} duplicate element keys: ${keyed.filter((key, i) => keyed.indexOf(key) !== i).join(', ')}`).toBe(keyed.length)


        if (columns === 150) {
          expect(keyed, `${view.id} has the ask button`).toContain('ask-claude')
          await pane.press({ key: 'ask-claude' })
          expect(textOf(await pane.drawn()), `${view.id} asks first`).toContain('Confirm: ask Claude about')
          expect(world.prompts, `${view.id} nothing sent before yes`).toEqual([])
          await $.command.run(command('yes'))
          for (let i = 0; i < 6; i++) await clock.advance(5)

          expect(world.prompts, `${view.id} exactly one prompt`).toHaveLength(1)

          const prompt = world.prompts[0] as string

          expect(prompt).toMatch(/^About the ruflo console "/)
          expect(prompt).toContain('not instructions')
          expect(prompt.split('\n').slice(4).every(line => line.startsWith('│ ') || line === ''), `${view.id} lines are quoted data`).toBe(true)
          expect(prompt).not.toMatch(/\bsk-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY/)
        }

        await pane.unmount()
      }
    })
  }

  test('launch: a section with plugin commands ends with a Launch section that asks first; one without has none', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES, { commands: ['ruflo-cost-tracker:ruflo-cost', 'ruflo-adr:adr'] })

    world.respond = missionCli
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('cost'))

    const pane = await $.ui.mount({ ...paneAt(150), surface: 'terminal' as const, plugin: PLUGIN })

    await pane.drawn()
    expect(textOf(await pane.drawn())).toContain('LAUNCH')
    expect(elementsOf(await pane.drawn(), 'Button').map(keyOf)).toContain('sec-launch')
    await pane.press({ key: 'sec-launch' })
    expect(elementsOf(await pane.drawn(), 'Button').map(keyOf)).toContain('launch-ruflo-cost-tracker:ruflo-cost')
    expect(elementsOf(await pane.drawn(), 'Button').map(keyOf)).not.toContain('launch-ruflo-adr:adr')
    await pane.press({ key: 'launch-ruflo-cost-tracker:ruflo-cost' })
    expect(textOf(await pane.drawn())).toContain('Confirm: run /ruflo-cost-tracker:ruflo-cost in the main Claude UI')
    expect(world.prompts).toEqual([])
    await pane.unmount()

    // Timeline owns ruflo-observability, which this session does not list: no Launch section.
    await $.command.run(command('timeline'))

    const other = await $.ui.mount({ ...paneAt(150), surface: 'terminal' as const, plugin: PLUGIN })

    await other.drawn()
    expect(elementsOf(await other.drawn(), 'Button').map(keyOf)).not.toContain('sec-launch')
    await other.unmount()
  })
})
