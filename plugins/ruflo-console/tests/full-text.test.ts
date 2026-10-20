/**
 * Text a person types is never silently shortened (ADR-481), through the real console: the mission goal and the guidance field on the Mission
 * Control page and the main menu, at three widths. Run with
 *   scripts/kit-seq.sh full-text
 */
import type { TestBody } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { missionCli } from './fixtures/mission-cli'
import { RUFLO_FILES } from './fixtures/ruflo-run'
import { command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

type Body = Parameters<TestBody>

async function opened($: Body[0], on: Body[1], view = 'missions', columns = 150) {
  const world = worldOf(on, RUFLO_FILES)

  world.respond = missionCli

  const clock = mock.clock(on)

  await $.session.start(SESSION)
  await $.command.run(command(view))

  const pane = await $.ui.mount({ ...paneAt(columns), surface: 'terminal' as const, plugin: PLUGIN })

  await pane.drawn()
  await pane.drawn()

  return { world, pane, clock }
}

const settle = async (pane: { drawn: () => Promise<unknown> }, clock: { advance: (ms: number) => Promise<unknown> }) => {
  for (let i = 0; i < 6; i++) {
    await clock.advance(5)
    await pane.drawn()
  }
}

/** Multi-word text with unicode, `n` characters long. */
const words = (n: number): string => {
  const unit = 'añadir tëst — 日本語 ✓ word'
  let out = ''

  for (let i = 0; out.length < n; i++) out += `${i === 0 ? '' : ' '}${unit}${i}`

  return out.slice(0, n).trim()
}

const squeezed = (text: string): string => text.replace(/\s+/g, '')
const valueOf = (tree: Parameters<typeof elementsOf>[0], key: string): string => ((elementsOf(tree, 'Input').find(input => keyOf(input) === key) as { props?: { value?: string } } | undefined)?.props?.value ?? '')

describe('a goal is never cut (ADR-481)', () => {
  for (const columns of [60, 100, 150]) {
    test(`a 1500-character goal is stored whole and drawn whole at ${columns} columns`, { options: { boot: false } }, async ($, on) => {
      const { pane } = await opened($, on, 'missions', columns)
      const goal = words(1500)

      await pane.input({ key: 'mc-goal', text: goal, kind: 'submit' })

      const drawn = textOf(await pane.drawn())

      // Every character is on screen, wrapped over lines (whitespace aside), and the edit button puts the whole goal back.
      expect(squeezed(drawn)).toContain(squeezed(goal))
      await pane.press({ key: 'mc-edit-goal' })
      expect(valueOf(await pane.drawn(), 'mc-goal')).toBe(goal)
      await pane.unmount()
    })
  }

  for (const look of ['plain', 'bbs'] as const) {
    test(`both looks: a 1500-character goal and a 5-line draft are drawn whole in the ${look} look at 60 columns`, { options: { boot: false, look } }, async ($, on) => {
      const { pane } = await opened($, on, 'missions', 60)
      const goal = words(1500)
      const five = ['one', 'two', 'three', 'four', 'five'].map(word => `${word} line of the goal`).join('\\n')

      await pane.input({ key: 'mc-goal', text: five, kind: 'change' })
      for (const word of ['one', 'two', 'three', 'four', 'five']) expect(textOf(await pane.drawn())).toContain(`${word} line of the goal`)
      await pane.input({ key: 'mc-goal', text: goal, kind: 'submit' })
      expect(squeezed(textOf(await pane.drawn()))).toContain(squeezed(goal))
      await pane.unmount()
    })
  }

  test('a 9,500-character goal is stored whole; the block ends in a marker that counts the hidden lines', { options: { boot: false } }, async ($, on) => {
    const { pane } = await opened($, on)
    const goal = words(9_500)

    await pane.input({ key: 'mc-goal', text: goal, kind: 'submit' })

    const drawn = textOf(await pane.drawn())
    const marker = /\(\+([\d,]+) more lines, press ✎ edit to view\/edit\)/.exec(drawn)

    expect(marker).not.toBeNull()
    expect(Number((marker?.[1] ?? '0').replace(/,/g, ''))).toBeGreaterThan(30)
    await pane.press({ key: 'mc-edit-goal' })
    expect(valueOf(await pane.drawn(), 'mc-goal')).toBe(goal)
    await pane.unmount()
  })

  test('a goal over the 10,000 the field holds is refused with the exact count (the engine refuses a longer Input value outright)', { options: { boot: false } }, async ($, on) => {
    const { pane } = await opened($, on)
    const goal = words(12_000)

    await pane.input({ key: 'mc-goal', text: goal, kind: 'submit' })

    const drawn = textOf(await pane.drawn())

    const count = goal.trim().length

    expect(squeezed(drawn)).toContain(squeezed(`the goal is ${count.toLocaleString('en-US')} characters; the limit is 10,000`))
    expect(squeezed(drawn)).toContain(squeezed(`${(count - 10_000).toLocaleString('en-US')} over`))
    expect(textOf(await pane.drawn())).not.toContain('wave 1')
    await pane.unmount()
  })

  test('the ruflo mission record takes 2,000: a longer goal plans but creating it is refused by name and count, a 1,500 goal is created whole', { options: { boot: false } }, async ($, on) => {
    const { world, pane, clock } = await opened($, on)

    await pane.input({ key: 'mc-goal', text: words(2_500), kind: 'submit' })
    await pane.press({ key: 'mc-create' })
    expect(squeezed(textOf(await pane.drawn()))).toContain(squeezed('the goal is 2,500 characters; the limit is 2,000'))
    expect(world.runs.filter(argv => argv.includes('mission_create'))).toEqual([])

    const goal = words(1_500)

    await pane.input({ key: 'mc-goal', text: goal, kind: 'submit' })
    await pane.press({ key: 'mc-create' })
    await $.command.run(command('yes'))
    await settle(pane, clock)

    const create = world.runs.find(argv => argv.includes('mission_create'))
    const sent = JSON.parse(create?.[create.indexOf('-p') + 1] ?? '{}') as { objective?: string }

    expect(sent.objective).toBe(goal)
    await pane.unmount()
  })

  test('guidance to Claude carries every character, line breaks included; over the limit it is refused and kept', { options: { boot: false } }, async ($, on) => {
    const { world, pane, clock } = await opened($, on)
    const text = `${words(700)}\\n${words(800)}`

    await pane.input({ key: 'mc-goal', text: 'add a dark mode toggle to settings', kind: 'submit' })
    await pane.press({ key: 'mc-create' })
    await $.command.run(command('yes'))
    await settle(pane, clock)
    await pane.input({ key: 'mc-guide', text, kind: 'submit' })
    await $.command.run(command('yes'))
    await settle(pane, clock)
    expect(world.prompts).toEqual([`${words(700)}\n${words(800)}`])

    const huge = words(10_001)

    await pane.input({ key: 'mc-guide', text: huge, kind: 'submit' })

    const drawn = textOf(await pane.drawn())

    expect(squeezed(drawn)).toContain(squeezed('the instruction is 10,001 characters; the limit is 10,000'))
    expect(world.prompts).toHaveLength(1)
    await pane.unmount()
  })
})

describe('the typing mirror shows every line while the field is one line', () => {
  for (const view of ['missions', 'menu']) {
    test(`${view}: a 5-line draft and a 1500-character draft are mirrored whole, with a line count`, { options: { boot: false } }, async ($, on) => {
      const { pane } = await opened($, on, view)
      const key = view === 'menu' ? 'menu-goal' : 'mc-goal'
      const five = ['one', 'two', 'three', 'four', 'five'].map(word => `${word} line of the goal`).join('\\n')

      await pane.input({ key, text: five, kind: 'change' })

      const drawn = textOf(await pane.drawn())

      for (const word of ['one', 'two', 'three', 'four', 'five']) expect(drawn).toContain(`${word} line of the goal`)
      expect(drawn).toContain('5 lines')

      const long = words(1_500)

      await pane.input({ key, text: long, kind: 'change' })
      expect(squeezed(textOf(await pane.drawn()))).toContain(squeezed(long))
      await pane.unmount()
    })
  }

  test('past 12 lines the mirror shows the last lines with a marker for the earlier ones', { options: { boot: false } }, async ($, on) => {
    const { pane } = await opened($, on)

    await pane.input({ key: 'mc-goal', text: Array.from({ length: 30 }, (_, i) => `line ${i + 1} of thirty`).join('\\n'), kind: 'change' })

    const drawn = textOf(await pane.drawn())

    expect(drawn).toContain('line 30 of thirty')
    expect(drawn).toMatch(/\d+ earlier lines above; all of it is kept and sent/)
    expect(drawn).toContain('30 lines')
    await pane.unmount()
  })
})
