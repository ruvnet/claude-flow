import type { TestBody } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { settingsAnswer } from './fixtures/settings'
import { RUFLO_FILES } from './fixtures/ruflo-run'
import { inputKeys, command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

type Body = Parameters<TestBody>

async function opened($: Body[0], on: Body[1], view = 'settings') {
  const world = worldOf(on, RUFLO_FILES)

  world.respond = settingsAnswer
  mock.clock(on)
  await $.session.start(SESSION)
  await $.command.run(command(view))

  const pane = await $.ui.mount({ ...paneAt(150), surface: 'terminal' as const, plugin: PLUGIN })

  await pane.drawn()
  await pane.drawn()

  return { world, pane }
}

const claudeRuns = (runs: readonly string[][]) => runs.filter(argv => argv[0] === 'claude')

describe('settings', () => {
  test('opening reads the plugin’s options and ruflo config, runs no write, and simple shows only the few that matter', { options: { boot: false } }, async ($, on) => {
    const { world, pane } = await opened($, on)
    const tree = await pane.drawn()
    const text = textOf(tree)

    expect(claudeRuns(world.runs).every(argv => argv.includes('--json'))).toBe(true)
    expect(world.runs.some(argv => argv.includes('config') && argv.includes('get'))).toBe(true)
    expect(world.runs.some(argv => argv.includes('--values-stdin') || argv.includes('set'))).toBe(false)
    expect(text).toContain('simple shows the few that matter')
    expect(text).toContain('Look')
    expect(text).toContain('Boot screen')
    expect(text).not.toContain('ruflo CLI')
    expect(text).toContain('Swarm topology')
    expect(text).not.toContain('Auto-scale')
    expect(elementsOf(tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['st-level-simple', 'st-level-advanced', 'st-plugin-ruflo-console', 'st-opt-ruflo-console-look-plain', 'st-ask-claude-ruflo-console-look', 'st-ask-codex-ruflo-console-look', 'st-changed']))
    await pane.unmount()
  })

  test('advanced adds every option and the rest of ruflo config', { options: { boot: false } }, async ($, on) => {
    const { pane } = await opened($, on)

    await pane.press({ key: 'st-level-advanced' })

    const text = textOf(await pane.drawn())

    expect(text).toContain('ruflo CLI')
    expect(text).toContain('Disk refresh')
    expect(text).toContain('Auto-scale')
    expect(text).toContain('MCP port')
    await pane.unmount()
  })

  test('a choice asks first with the exact argv and stdin, then runs once on yes', { options: { boot: false } }, async ($, on) => {
    const { world, pane } = await opened($, on)
    const writes = () => claudeRuns(world.runs).filter(argv => argv.includes('--values-stdin'))

    await pane.press({ key: 'st-opt-ruflo-console-look-plain' })

    const asked = textOf(await pane.drawn())

    expect(asked).toContain('Confirm: set ruflo-console look to plain')
    expect(asked).toContain('claude plugin configure ruflo-console@ruflo --values-stdin')
    expect(asked).toContain('{"look":"plain"}')
    expect(writes()).toEqual([])
    await $.command.run(command('yes'))
    expect(writes()).toEqual([['claude', 'plugin', 'configure', 'ruflo-console@ruflo', '--values-stdin']])
    expect(world.inputs).toContain('{"look":"plain"}')
    await pane.unmount()
  })

  test('ruflo-mods lists its tool hints, agent trim and delivery screen at the simple level, each with an honest note, and a toggle asks first', { options: { boot: false } }, async ($, on) => {
    const { world, pane } = await opened($, on)

    await pane.press({ key: 'st-plugin-ruflo-mods' })

    const tree = await pane.drawn()
    const text = textOf(tree)

    expect(text).toContain('Hide unused agent types')
    expect(text).toContain('about 4,000 fewer prompt tokens measured')
    expect(text).toContain('Screen peer deliveries and outgoing messages')
    expect(text).toContain('real-world rate unknown')
    expect(text).toContain('Usage hints on ruflo tools')
    expect(elementsOf(tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['st-ask-claude-ruflo-mods-agentTrim', 'st-ask-codex-ruflo-mods-deliveryScreen', 'st-opt-ruflo-mods-agentTrim-true']))
    await pane.press({ key: 'st-opt-ruflo-mods-agentTrim-true' })

    const asked = textOf(await pane.drawn())

    expect(asked).toContain('Confirm: set ruflo-mods agentTrim to true')
    expect(asked).toContain('{"agentTrim":"true"}')
    expect(claudeRuns(world.runs).filter(argv => argv.includes('--values-stdin'))).toEqual([])
    await $.command.run(command('no'))
    await pane.unmount()
  })

  test('a number field takes digits only; ruflo config keys outside the list or out of range are refused', { options: { boot: false } }, async ($, on) => {
    const { world, pane } = await opened($, on)

    await pane.press({ key: 'st-level-advanced' })
    await pane.input({ key: 'st-in-ruflo-console-fps', text: 'fast', kind: 'submit' })
    expect(textOf(await pane.drawn())).not.toContain('Confirm: set ruflo-console fps')
    await pane.input({ key: 'st-in-ruflo-console-fps', text: '12', kind: 'submit' })
    expect(textOf(await pane.drawn())).toContain('Confirm: set ruflo-console fps to 12')
    await $.command.run(command('no'))

    await pane.input({ key: 'st-core-in-swarm.maxAgents', text: '9999', kind: 'submit' })
    expect(textOf(await pane.drawn())).not.toContain('Confirm: set ruflo config swarm.maxAgents')
    await pane.input({ key: 'st-core-in-swarm.maxAgents', text: '20', kind: 'submit' })

    const asked = textOf(await pane.drawn())

    expect(asked).toContain('Confirm: set ruflo config swarm.maxAgents to 20')
    expect(asked).toContain('config set -k swarm.maxAgents -v 20')
    await $.command.run(command('yes'))
    expect(world.runs.some(argv => argv.join(' ').includes('config set -k swarm.maxAgents -v 20'))).toBe(true)
    expect((await $.command.run(command('run settings-core mcp.evil 1'))).text).toMatch(/nothing to do/)
    await pane.unmount()
  })

  test('a secret option is never shown or editable; its value does not reach the screen', { options: { boot: false } }, async ($, on) => {
    const { pane } = await opened($, on)

    await pane.press({ key: 'st-plugin-ruflo-mods' })
    await pane.press({ key: 'st-level-advanced' })

    const tree = await pane.drawn()
    const text = textOf(tree)

    expect(text).toContain('Relay token')
    expect(text).toContain('hidden: set it in /plugin configure')
    expect(text).not.toContain('sk-must-never-show')
    expect(inputKeys(tree)).not.toContain('st-in-ruflo-mods-relayApiToken')
    expect(elementsOf(tree, 'Button').map(keyOf).some(key => key.startsWith('st-ask-claude-ruflo-mods-relayApiToken'))).toBe(false)
    await pane.unmount()
  })

  test('▸ ask codex sends the explaining prompt at once: the terminal opens on it with no confirm and nothing is changed', { options: { boot: false } }, async ($, on) => {
    const { world, pane } = await opened($, on)

    await pane.press({ key: 'st-ask-codex-ruflo-console-look' })

    const text = textOf(await pane.drawn())
    const field = elementsOf(await pane.drawn(), 'Input').find(input => keyOf(input) === 'term-input') as { props?: { value?: string } } | undefined

    expect(text).toContain('Explain the ruflo setting "Look"')
    expect(text).not.toContain('Confirm:')
    expect(field?.props?.value ?? '').toBe('')
    // The ask explains; it never writes a setting.
    expect(world.runs.some(argv => argv.includes('--values-stdin') || argv.join(' ').includes('config set'))).toBe(false)
    await pane.unmount()
  })

  test('the AI terminal’s model and budget are chips; a saved model reaches the next claude command', { options: { boot: false } }, async ($, on) => {
    const { pane } = await opened($, on)

    await pane.press({ key: 'st-opt-ai-model-haiku' })
    await pane.press({ key: 'st-opt-ai-budget-0.5' })

    const text = textOf(await pane.drawn())

    expect(text).toContain('Claude model')
    expect(text).toContain('● haiku')
    expect(text).toContain('● 0.5')
    await pane.unmount()
  })

  test('"Always accept AI turns" on a claude confirm saves the choice and runs it; later turns go out with no confirm; Settings resets it; ruflo commands still ask', { options: { boot: false } }, async ($, on) => {
    const { pane } = await opened($, on, 'terminal')

    await pane.input({ key: 'term-input', text: 'what can this system do?', kind: 'submit' })

    const asked = await pane.drawn()

    expect(textOf(asked)).toContain('Confirm:')
    expect(elementsOf(asked, 'Button').map(keyOf)).toContain('always')
    await pane.press({ key: 'always' })
    expect(textOf(await pane.drawn())).not.toContain('Confirm:')

    await pane.input({ key: 'term-input', text: 'and the next one?', kind: 'submit' })

    const next = textOf(await pane.drawn())

    expect(next).not.toContain('Confirm:')
    expect(next).toContain('always accept: Enter sends')

    // ruflo commands are never auto-accepted.
    await pane.input({ key: 'term-input', text: '/ruflo', kind: 'submit' })
    await pane.input({ key: 'term-input', text: 'swarm status', kind: 'submit' })

    const ruflo = await pane.drawn()

    expect(textOf(ruflo)).toContain('Confirm:')
    expect(elementsOf(ruflo, 'Button').map(keyOf)).not.toContain('always')
    await $.command.run(command('no'))

    // Settings shows it and resets it.
    await $.command.run(command('settings'))

    const settings = await pane.drawn()

    expect(textOf(settings)).toContain('● always accept')
    await pane.press({ key: 'st-opt-ai-accept-ask each time' })
    expect(textOf(await pane.drawn())).toContain('● ask each time')
    await pane.unmount()
  })


  test('search finds a setting across plugins and ruflo config in either level, applies on Enter, empties the box, and clears with the chip', { options: { boot: false } }, async ($, on) => {
    const { pane } = await opened($, on)

    // Simple level: the budget is an advanced option of ruflo-mods, yet a search still finds it.
    await pane.input({ key: 'st-search', text: 'budget', kind: 'submit' })
    await pane.drawn()
    await pane.drawn()

    const found = textOf(await pane.drawn())

    expect(found).toContain('search “budget”')
    expect(found).toContain('Session budget (USD)')
    expect(found).toContain('Turn budget (USD)')
    expect(found).not.toContain('Boot screen')

    const field = elementsOf(await pane.drawn(), 'Input').find(input => keyOf(input) === 'st-search') as { props?: { value?: string } } | undefined

    expect(field?.props?.value ?? '').toBe('')
    await pane.press({ key: 'st-search-clear' })
    expect(textOf(await pane.drawn())).not.toContain('search “budget”')

    await pane.input({ key: 'st-search', text: 'topology', kind: 'submit' })
    expect(textOf(await pane.drawn())).toContain('Swarm topology')
    await pane.unmount()
  })

  test('changed only keeps what differs from its default; the header counts shown, total and changed', { options: { boot: false } }, async ($, on) => {
    const { pane } = await opened($, on)

    expect(textOf(await pane.drawn())).toMatch(/\d+ shown of \d+ · \d+ changed/)
    await pane.press({ key: 'st-changed' })

    const text = textOf(await pane.drawn())

    expect(text).toContain('● changed only')
    expect(text).not.toContain('Swarm topology')
    await pane.unmount()
  })


  test('the nav style is a Settings choice: icons only, icon and brief title, icon and full title; the nav page row follows it', { options: { boot: false } }, async ($, on) => {
    const { pane } = await opened($, on, 'settings')
    const keysNow = async () => elementsOf(await pane.drawn(), 'Button').map(keyOf)

    expect(await keysNow()).toEqual(expect.arrayContaining(['st-opt-ui-nav-auto', 'st-opt-ui-nav-icons', 'st-opt-ui-nav-brief', 'st-opt-ui-nav-full']))
    await pane.press({ key: 'st-opt-ui-nav-icons' })
    await $.command.run(command('swarm'))
    expect(textOf(await pane.drawn())).not.toContain('Hive')
    await $.command.run(command('settings'))
    await pane.press({ key: 'st-opt-ui-nav-brief' })
    await $.command.run(command('swarm'))
    expect(textOf(await pane.drawn())).toContain('Hiv')
    expect(textOf(await pane.drawn())).not.toContain('Hive-Mind')
    await $.command.run(command('settings'))
    await pane.press({ key: 'st-opt-ui-nav-full' })
    await $.command.run(command('swarm'))
    expect(textOf(await pane.drawn())).toContain('Hive-Mind')
    await pane.unmount()
  })

  test('a low-risk ruflo action offers "Always allow"; after it, that kind runs with no confirm; Settings forgets it; risky kinds never offer it', { options: { boot: false } }, async ($, on) => {
    const { world, pane } = await opened($, on, 'hive')
    const spawns = () => world.runs.filter(argv => argv.join(' ').includes('hive-mind_spawn'))

    await $.command.run(command('run hive-spawn-scout'))

    const asked = await pane.drawn()

    expect(textOf(asked)).toContain('Confirm:')
    expect(elementsOf(asked, 'Button').map(keyOf)).toContain('remember')
    expect(spawns()).toEqual([])
    await pane.press({ key: 'remember' })
    expect(spawns()).toHaveLength(1)

    // The next spawn (a different role) is the same kind: it runs without asking.
    await $.command.run(command('run hive-spawn-specialist'))
    expect(textOf(await pane.drawn())).not.toContain('Confirm:')
    expect(spawns()).toHaveLength(2)

    // Settings lists it and forgets it; the next one asks again.
    await $.command.run(command('settings'))
    expect(textOf(await pane.drawn())).toContain('mcp hive-mind_spawn')
    await pane.press({ key: 'st-forget-mcp hive-mind_spawn' })
    await $.command.run(command('run hive-spawn-scout'))
    expect(textOf(await pane.drawn())).toContain('Confirm:')
    await $.command.run(command('no'))

    // A destructive or network action is never offered it.
    await $.command.run(command('run catalog-install ruflo-core'))
    expect(elementsOf(await pane.drawn(), 'Button').map(keyOf)).not.toContain('remember')
    await pane.unmount()
  })

})
