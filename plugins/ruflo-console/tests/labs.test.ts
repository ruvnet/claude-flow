import { describe, expect, mock, test } from 'claude-code/testing'

import { MEM_OUT } from './fixtures/memory'
import { RUFLO_FILES } from './fixtures/ruflo-run'
import { drawn, memoryWorld } from './fixtures/views'
import { inputKeys, cliAnswer, command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

describe('labs and starts', () => {
  test('cost: a preset asks first, names the exact change, and sends one fixed argv with JSON stdin on yes', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await drawn($, 'cost')

    const pane = await $.ui.mount({ ...paneAt(110), surface: 'terminal' as const, plugin: PLUGIN })
    const setters = () => world.runs.filter(argv => argv.includes('--values-stdin'))

    await pane.press({ key: 'cost-budget-5' })
    const ask = textOf(await pane.drawn())

    expect(ask).toContain('Confirm: set ruflo-mods@ruflo costBudgetUsd to $5?')
    expect(ask).toContain('runs: claude plugin configure ruflo-mods@ruflo --values-stdin · stdin {"costBudgetUsd":"5"}')
    expect(ask).toContain('restart/reload may be needed')
    expect(setters()).toHaveLength(0)
    await pane.press({ key: 'confirm' })
    expect(setters()).toEqual([['claude', 'plugin', 'configure', 'ruflo-mods@ruflo', '--values-stdin']])
    expect(world.inputs).toEqual(['{"costBudgetUsd":"5"}'])
    await pane.press({ key: 'cost-budget-25' })
    await pane.press({ key: 'cancel' })
    expect(setters()).toHaveLength(1)
    await pane.input({ key: 'cost-budget', text: '12.5', kind: 'change' })
    await pane.press({ key: 'cost-budget-apply' })
    expect(textOf(await pane.drawn())).toContain('costBudgetUsd to $12.5?')
    await pane.input({ key: 'cost-budget', text: '--help', kind: 'submit' })
    expect(textOf(await pane.drawn())).toContain('budget must be a number from 0.01 to 10000 USD')
    expect((await $.command.run(command('yes'))).text).toBe('Nothing is waiting for a confirm.')
    expect(setters()).toHaveLength(1)
    await pane.unmount()
  })

  test('cost: unsupported configuration says where to set it and no preset or custom entry runs a setter', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)

    world.respond = argv => argv.includes('configure') ? { exitCode: 1, stdout: '', stderr: 'unknown command configure' } : cliAnswer(argv)
    mock.clock(on)
    await $.session.start(SESSION)
    const cost = await drawn($, 'cost')

    expect(cost.text).toContain('set costBudgetUsd in /config → ruflo-mods')
    const pane = await $.ui.mount({ ...paneAt(110), surface: 'terminal' as const, plugin: PLUGIN })

    await pane.press({ key: 'cost-budget-1' })
    expect(textOf(await pane.drawn())).not.toContain('Confirm:')
    await pane.input({ key: 'cost-budget', text: '5', kind: 'submit' })
    expect((await $.command.run(command('yes'))).text).toBe('Nothing is waiting for a confirm.')
    expect(world.runs.some(argv => argv.includes('--values-stdin'))).toBe(false)
    await pane.unmount()
  })

  test('cost: its probes stay on Cost and model inspection is an immediate offline read', { options: { boot: false, cli: 'npx' } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)

    mock.clock(on)
    await $.session.start(SESSION)
    await drawn($, 'overview')
    expect(world.runs.some(argv => argv.includes('model-stats') || argv.includes('configure'))).toBe(false)
    const costStart = world.runs.length

    await drawn($, 'cost')
    const pane = await $.ui.mount({ ...paneAt(110), surface: 'terminal' as const, plugin: PLUGIN })
    const before = world.runs.filter(argv => argv.includes('model-stats')).length

    await pane.press({ key: 'cost-model-stats' })
    expect(textOf(await pane.drawn())).not.toContain('Confirm:')
    const reads = world.runs.filter(argv => argv.includes('model-stats'))

    expect(reads).toHaveLength(before + 1)
    expect(reads.every(argv => argv[1] === '--offline')).toBe(true)
    expect(world.runs.slice(costStart).filter(argv => argv[0] === 'npx').every(argv => argv[1] === '--offline')).toBe(true)
    await pane.unmount()
  })

  test('memory lab: gauge, namespace bars, recency, browse, search, entry fields and every group; nothing runs unasked', { options: { boot: false } }, async ($, on) => {
    const world = memoryWorld(on)

    mock.clock(on)
    await $.session.start(SESSION)

    const { text, tree } = await drawn($, 'memory')

    for (const section of ['AGENTDB', 'NAMESPACES', 'RECENCY', 'BROWSE', 'SEARCH', 'ENTRY']) expect(text).toContain(`▓▒░ ${section} ░▒▓`)
    // The lab groups fold away, and nothing is drawn for a result until an action is raised.
    for (const section of ['LAB · MEMORY', 'LAB · AGENTDB', 'LAB · EMBEDDINGS', 'LAB · MAINTAIN']) expect(text).toContain(`▓▒░ ▾ ${section} ░▒▓`)
    expect(text).not.toContain('▓▒░ RESULT ░▒▓')
    expect(text).toContain('1/2 of the newest listed carry a vector')
    expect(text).toContain('2 more rows in .swarm/agentdb-memory.db')
    expect(text).toMatch(/ ◆ beta \.+/)
    expect(text).toMatch(/del \n DELETE \.+/)
    expect(inputKeys(tree)).toEqual(['mem-query', 'mem-namespace', 'mem-key', 'mem-value', 'mem-text'])
    expect(elementsOf(tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['mem-ns-0', 'mem-open-0', 'mem-del-0', 'mem-lab-mem-stats', 'mem-lab-mem-cleanup', 'mem-lab-mem-rabitq-build']))
    // Opening it runs only its two local probes.
    expect(world.runs.filter(argv => /memory (retrieve|search|store|delete|export)|mcp exec -t (memory_|agentdb_|embeddings_)/.test(argv.join(' ')))).toEqual([])
  })

  test('memory lab: a confirm and a result open under the area that was clicked, not at the top or in one far block', { options: { boot: false } }, async ($, on) => {
    const world = memoryWorld(on)

    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('memory'))

    const pane = await $.ui.mount({ ...paneAt(110), surface: 'terminal' as const, plugin: PLUGIN })
    const at = (text: string, needle: string) => text.indexOf(needle)

    await pane.drawn()

    // Browse: ▸ view answers right under the browse list, before Search.
    await pane.press({ key: 'mem-open-0' })

    const viewed = textOf(await pane.drawn())

    expect(at(viewed, '▓▒░ RESULT ░▒▓')).toBeGreaterThan(at(viewed, '▓▒░ BROWSE ░▒▓'))
    expect(at(viewed, '▓▒░ RESULT ░▒▓')).toBeLessThan(at(viewed, '▓▒░ SEARCH ░▒▓'))

    // Browse: ▸ delete asks right there too, and the page's top holds no confirm.
    await pane.press({ key: 'mem-del-0' })

    const asked = textOf(await pane.drawn())

    expect(at(asked, 'Confirm:')).toBeGreaterThan(at(asked, '▓▒░ BROWSE ░▒▓'))
    expect(at(asked, 'Confirm:')).toBeLessThan(at(asked, '▓▒░ SEARCH ░▒▓'))
    await pane.press({ key: 'cancel' })

    // A lab row answers inside its own group: the Memory group, before the AgentDB group.
    await pane.press({ key: 'mem-lab-mem-stats' })

    const stats = textOf(await pane.drawn())

    expect(at(stats, '▓▒░ RESULT ░▒▓')).toBeGreaterThan(at(stats, '▓▒░ ▾ LAB · MEMORY ░▒▓'))
    expect(at(stats, '▓▒░ RESULT ░▒▓')).toBeLessThan(at(stats, '▓▒░ ▾ LAB · AGENTDB ░▒▓'))
    expect(stats.split('▓▒░ RESULT ░▒▓').length - 1).toBe(1)

    // A write from the entry fields asks under the entry fields, before the lab groups.
    await pane.input({ key: 'mem-namespace', text: 'notes', kind: 'change' })
    await pane.input({ key: 'mem-key', text: 'alpha', kind: 'change' })
    await pane.input({ key: 'mem-value', text: 'a value', kind: 'change' })
    await pane.press({ key: 'mem-do-store' })

    const stored = textOf(await pane.drawn())

    expect(at(stored, 'Confirm:')).toBeGreaterThan(at(stored, '▓▒░ ENTRY ░▒▓'))
    expect(at(stored, 'Confirm:')).toBeLessThan(at(stored, '▓▒░ ▾ LAB · MEMORY ░▒▓'))
    expect(world.runs.filter(argv => argv.includes('store'))).toEqual([])
    await pane.unmount()
  })

  test('memory lab: view reads at once with one fixed argv; delete and store ask with their argv, then run it on yes', { options: { boot: false } }, async ($, on) => {
    const world = memoryWorld(on)
    const ran = (word: string) => world.runs.filter(argv => argv[5] === word).map(argv => argv.slice(4).join(' '))

    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('memory'))

    const pane = await $.ui.mount({ ...paneAt(110), surface: 'terminal' as const, plugin: PLUGIN })

    await pane.drawn()
    await pane.press({ key: 'mem-open-0' })

    const opened = textOf(await pane.drawn())

    expect(opened).not.toContain('Confirm:')
    expect(opened).toContain('auth/beta · 25 chars · read 1× · has a vector')
    expect(opened).toContain('jwt refresh tokens rotate')
    expect(ran('retrieve')).toEqual(['memory retrieve --key beta --namespace auth --format json'])

    await pane.press({ key: 'mem-del-0' })

    const asked = textOf(await pane.drawn())

    expect(asked).toContain('runs: ruflo memory delete --key beta --namespace auth --force')
    expect(asked).toContain('DELETES FOR GOOD')
    expect(ran('delete')).toEqual([])
    await pane.press({ key: 'confirm' })
    await pane.drawn()
    expect(ran('delete')).toEqual(['memory delete --key beta --namespace auth --force'])

    await pane.input({ key: 'mem-namespace', text: 'notes', kind: 'change' })
    await pane.input({ key: 'mem-key', text: 'alpha', kind: 'change' })
    await pane.input({ key: 'mem-value', text: 'the quick brown fox', kind: 'submit' })
    expect(textOf(await pane.drawn())).toContain('runs: ruflo memory store --key alpha --value the quick brown fox --namespace notes')
    expect(ran('store')).toEqual([])
    await pane.press({ key: 'confirm' })
    await pane.drawn()
    expect(ran('store')).toEqual(['memory store --key alpha --value the quick brown fox --namespace notes'])
    await pane.unmount()
  })

  test('memory lab: search runs at once from its field and headless, a bad key never reaches the CLI', { options: { boot: false } }, async ($, on) => {
    const world = memoryWorld(on)

    mock.clock(on)
    await $.session.start(SESSION)

    const answer = (await $.command.run(command('run mem-search token rotation'))).text ?? ''

    expect(answer).toContain('0.684  auth/beta  jwt refresh tokens rotate')
    expect((await $.command.run(command('run mem-delete auth --force'))).text).not.toMatch(/^Asked/)
    expect((await $.command.run(command('run mem-cleanup'))).text).toBe('Asked: memory cleanup. Confirm with /ruflo yes (or y in the pane), cancel with /ruflo no.')
    await $.command.run(command('no'))
    await $.command.run(command('memory'))

    const pane = await $.ui.mount({ ...paneAt(110), surface: 'terminal' as const, plugin: PLUGIN })

    await pane.drawn()
    await pane.press({ key: 'mem-scope' })
    await pane.input({ key: 'mem-query', text: 'token rotation', kind: 'submit' })
    expect(textOf(await pane.drawn())).toContain('0.684  auth/beta [agentdb]  jwt refresh tokens rotate')
    expect(world.runs.map(argv => argv.slice(4).join(' ')).filter(line => /search|delete|cleanup/.test(line))).toEqual([
      'memory search --query token rotation --limit 10 --format json',
      'mcp exec -t memory_search_unified -p {"query":"token rotation","limit":10}',
    ])
    await pane.unmount()
  })

  test('empty sections offer the button that starts them, not a command to copy; a start asks first and runs one fixed argv', { options: { boot: false } }, async ($, on) => {
    const { ".claude-flow/hive-mind/state.json": _hive, ...withoutHive } = RUFLO_FILES
    const world = worldOf(on, withoutHive)

    mock.clock(on)
    await $.session.start(SESSION)

    // A project with no hive-mind: the view says so and offers to start one.
    await $.command.run(command('hive'))

    const pane = await $.ui.mount({ ...paneAt(110), surface: 'terminal' as const, plugin: PLUGIN })
    const hive = await pane.drawn()

    expect(textOf(hive)).toContain('Start a hive with a queen')
    expect(textOf(hive)).not.toContain('npx ruflo')
    expect(elementsOf(hive, 'Button').map(keyOf)).toContain('start-hive')

    await pane.press({ key: 'start-hive' })
    expect(textOf(await pane.drawn())).toContain('Confirm: start a hive-mind: a queen with raft consensus?')
    expect(world.runs.some(argv => argv.includes('hive-mind') && argv.includes('init'))).toBe(false)

    await pane.press({ key: 'confirm' })

    const ran = world.runs.filter(argv => argv.includes('hive-mind') && argv.includes('init'))

    expect(ran.map(argv => argv.slice(4))).toEqual([['hive-mind', 'init', '--consensus', 'raft']])
    await pane.unmount()
  })

  test('starts that take a sentence refuse a leading dash and an empty one; nothing runs', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)

    mock.clock(on)
    await $.session.start(SESSION)

    for (const text of ['', '--force']) {
      expect((await $.command.run(command(`run start-task ${text}`))).text ?? '').not.toMatch(/^Asked: /)
    }

    expect(world.runs.some(argv => argv.includes('task') && argv.includes('create'))).toBe(false)
  })

})
