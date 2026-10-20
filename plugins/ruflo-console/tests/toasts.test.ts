import type { TestBody } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { settingsAnswer } from './fixtures/settings'
import { command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

type Body = Parameters<TestBody>

/** The console with Settings open; `clock` moves the Events pass along. */
async function opened($: Body[0], on: Body[1]) {
  const world = worldOf(on, RUFLO_FILES)

  world.respond = settingsAnswer

  const clock = mock.clock(on)

  await $.session.start(SESSION)
  await $.command.run(command('settings'))

  const pane = await $.ui.mount({ ...paneAt(150), surface: 'terminal' as const, plugin: PLUGIN })

  await pane.drawn()
  await pane.drawn()

  return { world, pane, clock }
}

/** Something that makes the console toast: stopping the autopilot says so, at a warning level. */
const stopAutopilot = ($: Body[0]) => $.command.run(command('autopilot stop'))
const savedMode = (world: { stored: Map<string, unknown> }) => JSON.parse(String(world.stored.get('toasts') ?? '{}')) as { mode?: string; muted?: string[] }

describe('toasts (ADR-477), end to end through the console', () => {
  test('Settings has a Toasts row with all, important and off, and a mute chip per source', { options: { boot: false } }, async ($, on) => {
    const { pane } = await opened($, on)
    const tree = await pane.drawn()
    const keys = elementsOf(tree, 'Button').map(keyOf)

    expect(textOf(tree)).toContain('Toasts')
    expect(keys).toEqual(expect.arrayContaining(['st-opt-ui-toasts-all', 'st-opt-ui-toasts-important', 'st-opt-ui-toasts-off', 'st-toast-mute-console', 'st-toast-mute-swarm', 'st-toast-mute-protector', 'st-toast-mute-mods']))
    await pane.unmount()
  })

  test('by default a toast draws with its level prefix; a repeat of it inside a minute does not', { options: { boot: false } }, async ($, on) => {
    const { world, pane } = await opened($, on)

    await stopAutopilot($)
    await stopAutopilot($)
    expect(world.toasts).toEqual(['⚠ autopilot stopped: stopped by command'])
    await pane.unmount()
  })

  test('important keeps this warning; off draws nothing; the choice is saved and mirrored to the file the other plugins read', { options: { boot: false } }, async ($, on) => {
    const { world, pane } = await opened($, on)

    await pane.press({ key: 'st-opt-ui-toasts-important' })
    expect(savedMode(world)).toEqual({ v: 1, mode: 'important', muted: [] })
    expect(world.inputs.some(text => text.includes('"mode":"important"'))).toBe(true)
    expect(world.runs.some(argv => argv.join(' ').includes('.claude-flow/console/toast-prefs.json'))).toBe(true)
    await stopAutopilot($)
    expect(world.toasts).toEqual(['⚠ autopilot stopped: stopped by command'])

    await pane.press({ key: 'st-opt-ui-toasts-off' })
    expect(savedMode(world).mode).toBe('off')
    await $.command.run(command('autopilot stop'))
    await pane.unmount()
  })

  test('off draws nothing, and the toast is still on the Events page, flagged off', { options: { boot: false } }, async ($, on) => {
    const { world, pane, clock } = await opened($, on)

    await pane.press({ key: 'st-opt-ui-toasts-off' })
    await stopAutopilot($)
    expect(world.toasts).toEqual([])
    await clock.advance(1_600)
    await clock.advance(1_600)

    await $.command.run(command('events'))
    await pane.drawn()

    const page = textOf(await pane.drawn())

    expect(page).toContain('toast console')
    expect(page).toContain('[off]')
    await pane.unmount()
  })

  test('muting the console silences it, an error as well as a warning, and unmuting brings it back', { options: { boot: false } }, async ($, on) => {
    const { world, pane } = await opened($, on)

    await pane.press({ key: 'st-toast-mute-console' })
    expect(savedMode(world).muted).toEqual(['console'])
    await stopAutopilot($)
    expect(world.toasts).toEqual([])
    await pane.press({ key: 'st-toast-mute-console' })
    expect(savedMode(world).muted).toEqual([])
    await $.command.run(command('autopilot stop'))
    await pane.unmount()
  })
})
