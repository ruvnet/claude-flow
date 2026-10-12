import { describe, expect, mock, test } from 'claude-code/testing'

import { CATALOG_HOME } from './fixtures/plugin-catalog'
import { RUFLO_FILES } from './fixtures/ruflo-run'
import { command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

import type { TestBody } from 'claude-code/testing'

type Body = Parameters<TestBody>
async function opened($: Body[0], on: Body[1]) {
  const world = worldOf(on, RUFLO_FILES, { home: CATALOG_HOME })

  mock.clock(on)
  await $.session.start(SESSION)
  await $.command.run(command('market'))

  const pane = await $.ui.mount({ ...paneAt(150), surface: 'terminal' as const, plugin: PLUGIN })

  await pane.drawn()
  await pane.drawn()

  return { world, pane }
}

describe('plugin catalog', () => {
  test('opening reads the clone from disk: every plugin with its counts and state, nothing run, a climbing source skipped', { options: { boot: false } }, async ($, on) => {
    const { world, pane } = await opened($, on)
    const tree = await pane.drawn()
    const text = textOf(tree)

    expect(text).toContain('3 plugins · 2 installed')
    expect(text).toContain('3 skills · 2 agents · 1 commands · 1 MCP · 2 mods')
    expect(text).toContain('■ ruflo-core')
    expect(text).toContain('· ruflo-mods')
    expect(text).toContain('S2 A2 C1 MCP')
    expect(text).not.toContain('ruflo-bad')
    expect(elementsOf(tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['cat-name-ruflo-core', 'cat-about-ruflo-core', 'cat-install-ruflo-mods', 'cat-mode-mods', 'cat-reload']))
    expect(world.runs.filter(argv => argv[0] === 'claude')).toEqual([])
    await pane.unmount()
  })

  test('modes and the filter narrow the list; the filter matches a skill name', { options: { boot: false } }, async ($, on) => {
    const { pane } = await opened($, on)

    await pane.press({ key: 'cat-mode-mods' })
    expect(textOf(await pane.drawn())).toContain('2 shown')
    expect(textOf(await pane.drawn())).not.toContain('ruflo-core ....')
    await pane.press({ key: 'cat-mode-all' })
    await pane.input({ key: 'cat-filter', text: 'doctor', kind: 'submit' })

    const text = textOf(await pane.drawn())

    expect(text).toContain('1 shown')
    expect(text).toContain('ruflo-core')
    await pane.unmount()
  })

  test('pressing a row opens its contents; ▸ view reads the skill file; ▸ use only types it into the terminal draft', { options: { boot: false } }, async ($, on) => {
    const { world, pane } = await opened($, on)

    await pane.press({ key: 'cat-name-ruflo-core' })
    await pane.drawn()

    let text = textOf(await pane.drawn())

    expect(text).toContain('Skills')
    expect(text).toContain('ruflo-doctor')
    expect(text).toContain('Diagnose a ruflo install')
    expect(text).toContain('reviewer')
    expect(text).toContain('ruflo-init')

    await pane.press({ key: 'cat-skill-ruflo-core-ruflo-doctor' })
    await pane.drawn()
    text = textOf(await pane.drawn())
    expect(text).toContain('Step one: do the thing.')

    await pane.press({ key: 'cat-use-ruflo-core-ruflo-doctor' })
    text = textOf(await pane.drawn())
    expect(text).toContain('TERMINAL')
    const field = elementsOf(await pane.drawn(), 'Input').find(input => keyOf(input) === 'term-input') as { props?: { value?: string } } | undefined

    expect(field?.props?.value).toContain('/ruflo-core:ruflo-doctor')
    expect(world.runs.some(argv => argv[0] === 'claude' || argv[0] === 'codex')).toBe(false)
    await pane.unmount()
  })

  test('install asks first with the exact argv and runs it once on yes; enable and disable follow the state', { options: { boot: false } }, async ($, on) => {
    const { world, pane } = await opened($, on)
    const claudeRuns = () => world.runs.filter(argv => argv[0] === 'claude')

    await pane.press({ key: 'cat-install-ruflo-mods' })

    const asked = textOf(await pane.drawn())

    expect(asked).toContain('Confirm: install plugin ruflo-mods')
    expect(asked).toContain('claude plugin install ruflo-mods@ruflo --scope user')
    expect(asked).toContain('clones the plugin from the ruflo marketplace')
    expect(claudeRuns()).toEqual([])
    expect((await $.command.run(command('yes'))).text).toBeDefined()
    expect(claudeRuns()).toEqual([['claude', 'plugin', 'install', 'ruflo-mods@ruflo', '--scope', 'user']])

    // The enabled one offers disable, the installed-but-disabled one offers enable.
    expect(elementsOf(await pane.drawn(), 'Button').map(keyOf)).toEqual(expect.arrayContaining(['cat-disable-ruflo-core', 'cat-enable-ruflo-swarm']))
    await pane.unmount()
  })

  test('a name outside the catalog is refused headless; a listed one asks with its argv', { options: { boot: false } }, async ($, on) => {
    const { world, pane } = await opened($, on)

    expect((await $.command.run(command('run catalog-install ruflo-nope'))).text).toMatch(/not in the ruflo catalog|nothing to do/)
    expect(world.runs.filter(argv => argv[0] === 'claude')).toEqual([])
    expect((await $.command.run(command('run catalog-update ruflo-core'))).text).toContain('Asked: update plugin ruflo-core')
    expect(world.runs.filter(argv => argv[0] === 'claude')).toEqual([])
    await pane.unmount()
  })
})
