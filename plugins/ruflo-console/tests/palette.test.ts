import { describe, expect, mock, test } from 'claude-code/testing'

import { HIVE_FILES, WORKERS } from './fixtures/hive'
import { RUFLO_FILES } from './fixtures/ruflo-run'
import { FIND_OUT } from './fixtures/skills'
import { cliAnswer, command, elementsOf, inputKeys, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

const runsOf = (runs: readonly string[][], word: string) => runs.filter(argv => argv.includes(word))

describe('palette and /ruflo', () => {
  test('cost headless: direct custom and preset entries check support, ask, and only configure on yes', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)

    mock.clock(on)
    await $.session.start({ ...SESSION, isInteractive: false })
    const ask = (await $.command.run(command('run cost-budget 12.5'))).text ?? ''

    expect(ask).toContain('Asked: set ruflo-mods@ruflo costBudgetUsd to $12.5')
    expect(ask).toContain('stdin {"costBudgetUsd":"12.5"}')
    expect(ask).toContain('restart/reload may be needed')
    expect(world.runs.some(argv => argv.includes('--values-stdin'))).toBe(false)
    expect((await $.command.run(command('yes'))).text).toContain('restart/reload may be needed')
    expect(world.runs.filter(argv => argv.includes('--values-stdin'))).toHaveLength(1)
    expect((await $.command.run(command('run cost-budget-10'))).text).toContain('Asked: set ruflo-mods@ruflo costBudgetUsd to $10')
    await $.command.run(command('no'))
    expect(world.runs.filter(argv => argv.includes('--values-stdin'))).toHaveLength(1)
    expect((await $.command.run(command('run cost-budget 0'))).text).toContain('budget must be a number from 0.01 to 10000 USD')
  })

  test('p opens the palette; typing filters; a change asks first and runs one fixed argv on yes', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command())

    const pane = await $.ui.mount({ ...paneAt(110), surface: 'terminal' as const, plugin: PLUGIN })

    await pane.press({ key: 'palette' })
    expect(inputKeys(await pane.drawn())).toEqual(['palette-input'])

    await pane.input({ key: 'palette-input', text: 'spawn cod', kind: 'change' })

    const filtered = await pane.drawn()

    expect(elementsOf(filtered, 'Button').map(keyOf).filter(key => key.startsWith('pal-') && !key.startsWith('pal-kw-'))[0]).toBe('pal-spawn-coder')

    await pane.press({ key: 'pal-spawn-coder' })
    expect(textOf(await pane.drawn())).toMatch(/Confirm: spawn a coder agent named coder-\d+\?/)
    expect(runsOf(world.runs, 'spawn')).toHaveLength(0)

    await pane.press({ key: 'confirm' })

    const spawn = runsOf(world.runs, 'spawn')[0] ?? []

    expect(spawn.slice(4, 8)).toEqual(['agent', 'spawn', '--type', 'coder'])
    expect(spawn[8]).toBe('--name')
    await pane.unmount()
  })

  test('a read runs at once and shows its output: route <words> asks the router', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    world.respond = argv => (argv.includes('route') ? { exitCode: 0, stdout: '{\n "primaryAgent": {"type": "tester", "confidence": 0.8}\n}', stderr: '' } : { exitCode: 0, stdout: '{}', stderr: '' })
    await $.session.start(SESSION)

    const answer = await $.command.run(command('run route write the login tests'))

    expect(answer.text).toBe('route "write the login tests"')
    expect(runsOf(world.runs, 'route')[0]?.slice(4)).toEqual(['hooks', 'route', '--task', 'write the login tests', '--format', 'json'])

    const text = textOf(await $.ui.render(paneAt(110)))

    expect(text).toContain('"type": "tester"')
  })

  test('/ruflo run and /ruflo yes act without focus; a flag-shaped text is refused', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    expect((await $.command.run(command('run worker-audit'))).text).toBe('Asked: dispatch the audit worker. Confirm with /ruflo yes (or y in the pane), cancel with /ruflo no.')
    expect((await $.command.run(command('yes'))).text).toMatch(/^✓ dispatch the audit worker/)
    expect(runsOf(world.runs, 'dispatch')[0]?.slice(4)).toEqual(['hooks', 'worker', 'dispatch', '--trigger', 'audit'])

    await $.command.run(command('run store --dangerous'))
    expect((await $.command.run(command('yes'))).text).toBe('Nothing is waiting for a confirm.')
    expect(runsOf(world.runs, 'store')).toHaveLength(0)
    expect((await $.command.run(command('run nope'))).text).toMatch(/^No palette entry "nope"/)
  })

  test('approvals: a hive vote is cast as a registered worker after a confirm, since only such a vote counts', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, { ...RUFLO_FILES, ...HIVE_FILES })
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('approvals'))

    const pane = await $.ui.mount({ ...paneAt(110), plugin: PLUGIN })

    await pane.press({ key: 'approve-0' })
    await pane.press({ key: 'confirm' })

    const argv = runsOf(world.runs, 'consensus')[0]?.slice(4) ?? []

    expect(argv.slice(0, 4)).toEqual(['hive-mind', 'consensus', '--action', 'vote'])
    expect(WORKERS).toContain(argv[argv.indexOf('--voter-id') + 1])
    await pane.unmount()
  })

  test('approvals: with no registered worker to vote as, nothing runs and it says why (the CLI would drop the vote silently)', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    expect((await $.command.run(command('run vote-yes-proposal-1790903321981-23aov7'))).text).not.toMatch(/^Asked: /)
    expect(runsOf(world.runs, 'consensus')).toHaveLength(0)
  })

  test('lab: an inspect entry runs at once with one fixed argv, and its lines fill the result panel', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('metaharness'))

    const pane = await $.ui.mount({ ...paneAt(110), plugin: PLUGIN })

    await pane.press({ key: 'lab-mh-mcp-scan' })

    const text = textOf(await pane.drawn())

    expect(text).not.toContain('Confirm:')
    expect(text).toContain('by severity: critical 0 · high 0 · medium 0 · low 1 · info 0')
    expect(text).toContain('[low] 12 unpinned dependency range(s)')
    expect(world.runs.filter(argv => argv.includes('mcp-scan')).map(argv => argv.slice(4))).toEqual([['metaharness', 'mcp-scan', '--format', 'json']])
    await pane.unmount()
  })

  test('lab: a spending entry asks first with its cost on the confirm row, and runs nothing on no', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('metaharness'))

    const pane = await $.ui.mount({ ...paneAt(110), plugin: PLUGIN })

    expect(elementsOf(await pane.drawn(), 'Button').map(keyOf)).not.toContain('lab-mh-redblue-real')
    await pane.press({ key: 'sec-mh-evolve' })
    await pane.press({ key: 'lab-mh-redblue-real' })

    const text = textOf(await pane.drawn())

    expect(text).toContain('Confirm: redblue run with a real model judge (spends, capped at $3)?')
    expect(text).toContain('runs: ruflo metaharness redblue run --tests 10 --max-cost-usd 3 --format json')
    expect(text).toContain('COSTS MONEY: a real model judges each attack')
    await pane.press({ key: 'cancel' })
    expect(world.runs.some(argv => argv.includes('redblue'))).toBe(false)
    await pane.unmount()
  })

  test('lab: promote is never run, not even with every lab button pressed and every ask confirmed', { options: { boot: false }, timeoutMs: 30_000 }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('metaharness'))

    const pane = await $.ui.mount({ ...paneAt(110), plugin: PLUGIN })
    await pane.press({ key: 'sec-mh-record' })
    await pane.press({ key: 'sec-mh-evolve' })
    const keys = elementsOf(await pane.drawn(), 'Button').map(keyOf).filter(key => key.startsWith('lab-mh-'))

    expect(keys.length).toBeGreaterThan(20)

    for (const key of keys) {
      await $.command.run(command('metaharness'))
      await pane.press({ key })
      if (textOf(await pane.drawn()).includes('Confirm:')) await pane.press({ key: 'confirm' })
    }

    expect(world.runs.some(argv => argv.includes('promote'))).toBe(false)
    expect(world.runs.some(argv => argv.includes('flywheel') && argv.includes('--confirm'))).toBe(false)
    expect((await $.command.run(command('run mh-promote'))).text).toMatch(/^No palette entry "mh-promote"/)
    await pane.unmount()
  })

  test('lab headless: /ruflo run mh-mcp-scan answers with what the scan printed', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start({ ...SESSION, isInteractive: false })

    const answer = (await $.command.run(command('run mh-mcp-scan'))).text ?? ''

    expect(answer).toMatch(/^✓ mcp-scan: static MCP findings by severity · exit 0\n/)
    expect(answer).toContain('  [low] 12 unpinned dependency range(s)')
    // An entry that cannot run headless says why: the typed ones name the command to type.
    expect((await $.command.run(command('run mh-learn-run'))).text).toBe('nothing to do: type it in the terminal (i): ruflo metaharness learn --run --format json --host claude-code --model haiku --slice <path>')
  })

  test('skills headless: /ruflo run skills-find answers with what skills.sh found; skills-update asks first', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)

    world.respond = argv => (argv[2] !== 'skills' ? cliAnswer(argv) : { exitCode: 0, stdout: argv[3] === 'find' ? FIND_OUT : argv[3] === 'ls' ? '[]' : 'done\n', stderr: '' })
    mock.clock(on)
    await $.session.start({ ...SESSION, isInteractive: false })

    const found = (await $.command.run(command('run skills-find react'))).text ?? ''

    expect(found).toMatch(/^skills find "react": 4 found\n {2}mattpocock\/skills@tdd · 1M installs/)
    expect(runsOf(world.runs, 'find')).toEqual([['npx', '-y', 'skills', 'find', 'react']])
    expect((await $.command.run(command('run skills-update'))).text).toContain('Asked: update every project skill. Confirm with /ruflo yes (or y in the pane), cancel with /ruflo no.')
    expect(runsOf(world.runs, 'update')).toEqual([])
    // A skills change runs its own command and reports into the skills view, so the confirm answers before it ends.
    expect((await $.command.run(command('yes'))).text).toBe('Ran.')
    await $.command.run(command('status'))
    expect(runsOf(world.runs, 'update')).toEqual([['npx', '-y', 'skills', 'update', '-p', '-y']])
  })

  test('/ruflo help, an unknown word, and the hints when ruflo-mods or ruflo-swarm are not loaded', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    expect((await $.command.run(command('help'))).text).toContain('/ruflo swarm pane|status|topology|claims|consensus')
    expect((await $.command.run(command('frobnicate'))).text).toMatch(/^Unknown: "frobnicate"/)
    expect((await $.command.run(command('mods'))).text).toMatch(/^ruflo-mods is not loaded in this session/)
    expect((await $.command.run(command('swarm status'))).text).toMatch(/^ruflo-swarm is not loaded in this session/)
  })

  test('the engine saying no hook answered /ruflo mods is not an answer: the hint shows', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    on('command.run', () => ({ text: 'ruflo-console registered /ruflo but no command.run hook answered it: add on("command.run", ...)' }))
    await $.session.start(SESSION)

    expect((await $.command.run(command('mods'))).text).toMatch(/^ruflo-mods is not loaded in this session/)
  })

  test('/ruflo mods and /ruflo swarm <sub> are answered by the plugin beneath that owns them', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    on('command.run', ($, e) => ({ text: `beneath answered: ${e.args}` }))
    await $.session.start(SESSION)

    expect((await $.command.run(command('mods'))).text).toBe('beneath answered: mods')
    expect((await $.command.run(command('swarm topology'))).text).toBe('beneath answered: swarm topology')
    expect((await $.command.run(command('swarm'))).text).toBe('ruflo console: Swarm')
  })

  test('panel auto opens the cockpit at session start without taking the keys; panel command does not', { options: { panel: 'auto', boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    const clock = mock.clock(on)
    await $.session.start(SESSION)
    await clock.advance(100)

    expect(world.openArgs).toHaveLength(1)
    expect(world.openArgs[0]).toMatchObject({ id: 'ruflo-console' })
    expect(world.openArgs[0]?.focus).toBeUndefined()
  })

  test('panel command never opens unasked', { options: { panel: 'command', boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    const clock = mock.clock(on)
    await $.session.start(SESSION)
    await clock.advance(500)

    expect(world.opened).toHaveLength(0)
  })

  test('/ruflo dump <view> answers the view as plain text, without the pane, with its probes run', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const claims = (await $.command.run(command('dump claims'))).text ?? ''
    const memory = (await $.command.run(command('dump memory'))).text ?? ''

    expect(claims).toContain('1 active · 1 stealable · 0 handoff')
    expect(claims).toMatch(/console-demo-1\s+coder agent-1790903032181-97m25s/)
    expect(memory).toContain('1 · 0 with vectors')
    expect(world.runs.some(argv => argv.join(' ').includes('memory stats'))).toBe(true)
    expect(world.opened).toHaveLength(0)
  })

  test('panel auto stays shut outside a ruflo project', { options: { panel: 'auto', boot: false } }, async ($, on) => {
    const world = worldOf(on, { 'README.md': 'not ruflo' })
    const clock = mock.clock(on)
    await $.session.start(SESSION)
    await clock.advance(500)

    expect(world.openArgs).toHaveLength(0)
  })

  test('/ruflo-console stays registered and is the same command as /ruflo; mods and swarm words still pass beneath', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    on('command.run', ($, e) => ({ text: `beneath: ${e.command} ${e.args}` }))
    await $.session.start(SESSION)

    expect([...world.commands].sort()).toEqual(['ruflo', 'ruflo-console'])
    expect((await $.command.run({ ...command('help'), command: 'ruflo-console' })).text).toBe((await $.command.run(command('help'))).text)
    expect((await $.command.run({ ...command('mods'), command: 'ruflo-console' })).text).toBe('beneath: ruflo-console mods')
  })

  test('without a pane (claude -p), /ruflo <view> answers the view as text and opens nothing', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start({ ...SESSION, isInteractive: false })

    const text = (await $.command.run(command('claims'))).text ?? ''

    expect(text).toContain('1 active · 1 stealable · 0 handoff')
    expect((await $.command.run(command('overview'))).text).toContain('v3.50.0 (npx-offline)')
    expect(world.openArgs).toHaveLength(0)
  })

  test('/ruflo commands browses the catalog, and falls back to the mod commands when it is not readable', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const text = (await $.command.run(command('commands swarm'))).text ?? ''

    expect(text).toContain('the command catalog is not readable here, so this is the built-in list')
    expect(text).toContain('/ruflo-swarm-pane')
    expect(text).not.toContain('/ruflo-mods ')
  })
})
