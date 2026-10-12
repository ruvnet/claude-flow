import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { BAND, command, elementsOf, fakeRuflo, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

const VIEWS = ['overview', 'swarm', 'claims', 'federation', 'plugins', 'learning', 'metaharness', 'memory', 'cost', 'timeline', 'approvals', 'events', 'room', 'agent'] as const

describe('behaviour', () => {
  test('with the default bbs look, a freshly opened pane plays the boot screen first, and draws nothing else under it', async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command())

    const pane = await $.ui.mount({ ...paneAt(110), plugin: PLUGIN })
    const tree = await pane.drawn()

    expect(elementsOf(tree, 'Raster').map(keyOf)).toEqual(['boot'])
    expect(textOf(tree)).not.toContain('OVERVIEW')
    await pane.unmount()
  })

  test('the selected tab always names itself, however long the name: [8: 🔬 METAHARNESS], [z: 🧰 SKILLS]', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    for (const [view, tab] of [['metaharness', '[8: 🔬 METAHARNESS]'], ['skills', '[z: 🧰 SKILLS]'], ['menu', '[0: 📟 MAIN MENU]'], ['federation', '[5: 🌐 FEDERATION]']] as const) {
      await $.command.run(command(view))

      const pane = await $.ui.mount({ ...paneAt(110), plugin: PLUGIN })

      expect(textOf(await pane.drawn())).toContain(tab)
      await pane.unmount()
    }
  })

  test('a tab hotkey switches the view and the choice is kept for this folder only', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command())

    const pane = await $.ui.mount({ ...paneAt(110), plugin: PLUGIN })

    expect(textOf(await pane.drawn())).toContain('📟 MAIN MENU')
    await pane.press({ key: 'tab-claims' })
    expect(textOf(await pane.drawn())).toContain('📌 CLAIMS')
    expect(world.stored.get('ruflo-console/ui:/work')).toEqual({ view: 'claims', isClosedByPerson: false })
    expect(world.opened.length).toBeGreaterThanOrEqual(2)
    await pane.unmount()
  })

  test('claim asks first, runs one fixed argv on yes, and reads the disk to say it took', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    const task = JSON.parse(RUFLO_FILES['.claude-flow/tasks/store.json'] ?? '{}') as { tasks: Record<string, unknown> }
    const taskId = Object.keys(task.tasks)[0] as string
    mock.clock(on)
    world.respond = argv => {
      if (argv.includes('claims_claim')) {
        const store = JSON.parse(world.files.get('/work/.claude-flow/claims/claims.json') as string) as { claims: Record<string, unknown> }
        const params = JSON.parse(argv[argv.length - 1] as string) as { issueId: string; claimant: string }
        const [, agentId, agentType] = params.claimant.split(':')

        store.claims[params.issueId] = { issueId: params.issueId, claimant: { type: 'agent', agentId, agentType }, status: 'active', claimedAt: '2026-10-02T01:20:00.000Z', progress: 0 }
        world.put('.claude-flow/claims/claims.json', JSON.stringify(store))

        return { exitCode: 0, stdout: 'Result:\n{\n  "success": true\n}', stderr: '' }
      }

      return { exitCode: 0, stdout: '{}', stderr: '' }
    }
    await $.session.start(SESSION)
    await $.command.run(command('claims'))

    const pane = await $.ui.mount({ ...paneAt(110), plugin: PLUGIN })

    await pane.press({ key: 'claim' })

    const asking = await pane.drawn()

    expect(textOf(asking)).toContain(`Confirm: claim ${taskId} for coder?`)
    expect(textOf(asking)).toContain('runs: ruflo mcp exec -t claims_claim -p')
    expect(elementsOf(asking, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['confirm', 'cancel']))
    expect(world.runs.filter(argv => argv.includes('claims_claim'))).toHaveLength(0)

    await pane.press({ key: 'confirm' })

    const runs = world.runs.filter(argv => argv.includes('claims_claim'))

    expect(runs).toHaveLength(1)
    expect(runs[0]?.slice(0, 4)).toEqual(['npx', '--offline', '-y', '@claude-flow/cli@latest'])
    expect(JSON.parse(runs[0]?.at(-1) ?? '{}')).toEqual({ issueId: taskId, claimant: 'agent:agent-1790903032181-97m25s:coder' })
    expect(textOf(await pane.drawn())).toContain(`✓ claim ${taskId} for coder · on disk: ruflo answered ok`)
    await pane.unmount()
  })

  test('cancel runs nothing, and a button with nothing to act on says why', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('claims'))

    const pane = await $.ui.mount({ ...paneAt(110), plugin: PLUGIN })

    await pane.press({ key: 'release' })
    expect(textOf(await pane.drawn())).toContain('Confirm: release console-demo-1 held by coder?')
    await pane.press({ key: 'cancel' })
    expect(textOf(await pane.drawn())).not.toContain('Confirm:')
    await pane.press({ key: 'steal' })
    expect(textOf(await pane.drawn())).toContain('nothing to do: the picked agent already holds it')
    expect(world.runs.some(argv => argv.some(arg => arg.startsWith('claims_') && arg !== 'claims_board'))).toBe(false)
    await pane.unmount()
  })

  test('every affordance refused: each view still draws, nothing throws, nothing runs', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES, { refuseAll: true })
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command())

    for (const view of VIEWS) {
      await $.command.run(command(view))

      const pane = await $.ui.mount({ ...paneAt(100), plugin: PLUGIN })
      const text = textOf(await pane.drawn())

      expect(text).toMatch(/>> \n\S+ [A-Z]+\n :: \w/)  // the BBS line under the tabs: >> icon NAME :: what it is for
      await pane.unmount()
    }

    expect(world.runs).toHaveLength(0)
  })

  test('no ruflo project: views say n/a or how to start, and the band stays out of the way', { options: { boot: false } }, async ($, on) => {
    worldOf(on, {})
    mock.clock(on)
    on('ui.render', () => ({ type: 'Text', children: ['engine'] }) as never)
    await $.session.start(SESSION)
    await $.command.run(command('overview'))
    await $.command.run(command('status'))

    const overview = textOf(await $.ui.render(paneAt(110)))

    expect(overview).toContain('n/a — no .claude-flow here')
    expect(overview).toContain('n/a — no swarm on disk')
    expect(overview).not.toMatch(/\b0 agents\b/)
    await $.command.run(command('swarm'))
    expect(textOf(await $.ui.render(paneAt(110)))).toContain('No swarm here yet: start a hierarchical one')
    expect(textOf(await $.ui.render(BAND))).toBe('engine')
  })

  test('narrow terminals get text only: no Raster, one tab line, no claims buttons', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('claims'))
    await $.command.run(command('status'))

    for (const [columns, rows] of [[24, 12], [30, 30], [43, 40], [44, 40], [120, 8], [160, 60]] as const) {
      const pane = await $.ui.mount({ ...paneAt(columns, rows), plugin: PLUGIN })
      const tree = await pane.drawn()
      const isNarrow = columns - 1 < 44

      expect(elementsOf(tree, 'Raster').length === 0).toBe(isNarrow)
      expect(elementsOf(tree, 'Button').map(keyOf).includes('claim')).toBe(!isNarrow)
      // The count is VIEWS.length, which grows with each view: hold the position and the name, not the total.
      if (isNarrow) expect(textOf(tree)).toMatch(/6\/\d+ Claims/)
      await pane.unmount()
    }
  })

  test('the frame loop blits while shown and focused, and stops when hidden or unfocused', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    const clock = mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('swarm'))
    await $.command.run(command('status'))

    const pane = await $.ui.mount({ ...paneAt(110), plugin: PLUGIN })

    for (let i = 0; i < 6; i++) await clock.advance(125)
    expect(world.blits.filter(key => key === 'topology').length).toBeGreaterThan(2)

    const panes = world.panes[0]

    if (panes !== undefined) panes.isShown = false
    await clock.advance(1_000)

    const hidden = world.blits.length

    for (let i = 0; i < 8; i++) await clock.advance(125)
    expect(world.blits.length).toBe(hidden)
    await pane.unmount()
  })

  test('unfocused, the pane draws but does not animate', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    const clock = mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('swarm'))

    const opened = world.panes[0]

    if (opened !== undefined) opened.isFocused = false

    const pane = await $.ui.mount({ ...paneAt(110, 40, false), plugin: PLUGIN })

    for (let i = 0; i < 12; i++) await clock.advance(125)
    expect(textOf(await pane.drawn())).toContain('keys off')
    expect(world.blits).toHaveLength(0)
    await pane.unmount()
  })

  test('hostile text: control and bidi characters never reach the tree, bad ids are dropped', { options: { boot: false } }, async ($, on) => {
    const agents = JSON.parse(RUFLO_FILES['.claude-flow/agents/store.json'] ?? '{}') as { agents: Record<string, Record<string, unknown>> }
    const first = Object.values(agents.agents)[0] as Record<string, unknown>

    first.name = 'c1\u001b[31m‮EVIL\u0000'
    const claims = { claims: { 'bad id!': { issueId: 'bad id!', claimant: { type: 'agent', agentId: 'x', agentType: 'coder' }, status: 'active' } } }

    worldOf(on, { ...RUFLO_FILES, '.claude-flow/agents/store.json': JSON.stringify(agents), '.claude-flow/claims/claims.json': JSON.stringify(claims) })
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('swarm'))
    await $.command.run(command('status'))

    const swarm = textOf(await $.ui.render(paneAt(110)))

    expect(swarm).toContain('c1EVIL')  // the whole colour sequence, the bidi override and the NUL are removed outright (not spaced), so no credential can hide behind an invisible split
    expect(swarm).not.toContain('[31m')
    expect(swarm).not.toMatch(/[\u0000-\u001f‪-‮](?<!\n)/)
    await $.command.run(command('claims'))
    expect(textOf(await $.ui.render(paneAt(110)))).toContain('No claims on disk')
  })

  test('the band: one line of facts, yields to a survey, and its mark pulses only during a turn', { options: { boot: false } }, async ($, on) => {
    fakeRuflo().register(on, {})
    const world = worldOf(on, RUFLO_FILES)
    const clock = mock.clock(on)
    on('ui.render', () => ({ type: 'Text', children: ['engine'] }) as never)
    await $.session.start(SESSION)
    await $.command.run(command('status'))

    // One Text per part (attention parts are coloured); the row lays them side by side, the harness joins with \n.
    const band = textOf(await $.ui.render(BAND)).replace(/\n/g, '')

    // Urgent first, then what is happening now (a fresh event), then the standing context.
    expect(band).toContain('ruflo · 3 to approve (q) · ⚠ 1 alert · router picked tester (60%) · 0s ago')
    expect(band).toContain('2 claims (1 stealable)')
    expect(band).not.toMatch(/0\/\d+ busy|\d patterns/)
    expect(band).toContain('open console')
    expect(textOf(await $.ui.render({ ...BAND, props: { ...BAND.props, hasSurvey: true } }))).toBe('engine')

    await $.ui.render({ ...BAND, props: { ...BAND.props, isWorking: true } })
    for (let i = 0; i < 4; i++) await clock.advance(125)
    expect(world.blits.filter(key => key === 'mark').length).toBeGreaterThan(1)

    await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as never)

    const stopped = world.blits.length

    for (let i = 0; i < 4; i++) await clock.advance(125)
    expect(world.blits.length).toBe(stopped)
  })

  test('the band is clickable: a part opens the console on the view it is about, with the keys', { options: { boot: false } }, async ($, on) => {
    fakeRuflo().register(on, {})
    const world = worldOf(on, RUFLO_FILES)

    mock.clock(on)
    on('ui.render', () => ({ type: 'Text', children: ['engine'] }) as never)
    await $.session.start(SESSION)
    await $.command.run(command('status'))

    const band = await $.ui.mount({ ...BAND, plugin: PLUGIN })

    // The first part is "3 to approve (q)".
    await band.press({ key: 'band-0' })
    expect(world.openArgs.at(-1)).toMatchObject({ id: 'ruflo-console', focus: true })
    expect(world.stored.get('ruflo-console/ui:/work')).toMatchObject({ view: 'approvals' })
    await band.unmount()
  })

  test('on the desktop surface, which has no Raster, every picture becomes a text line and the tree is accepted', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    for (const view of VIEWS) {
      await $.command.run(command(view))

      const pane = await $.ui.mount({ ...paneAt(110, 40, true, 'desktop'), plugin: PLUGIN })
      const tree = await pane.drawn()

      expect(pane.surface).toBe('desktop')
      expect(elementsOf(tree, 'Raster')).toHaveLength(0)
      await pane.unmount()
    }
  })

  test('an inline pane given fewer rows than it asked for goes compact: controls first, no title strip', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('claims'))

    const inline = paneAt(98, 12)
    const pane = await $.ui.mount({ ...inline, props: { ...inline.props, placement: 'inline' }, plugin: PLUGIN })
    const tree = await pane.drawn()
    const keys = elementsOf(tree, 'Button').map(keyOf)

    expect(keys.indexOf('close')).toBeLessThan(keys.indexOf('claim'))
    // The banner goes; the page's own title stays.
    expect(elementsOf(tree, 'Raster').map(keyOf)).not.toContain('header')
    expect(elementsOf(tree, 'Raster').map(keyOf)).toContain('title')
    await pane.unmount()
  })

  test('a docked pane shorter than the view still draws the banner and the title: it scrolls', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('claims'))

    const pane = await $.ui.mount({ ...paneAt(98, 12), plugin: PLUGIN })

    expect(elementsOf(await pane.drawn(), 'Raster').map(keyOf).slice(0, 1)).toEqual(['title'])
    await pane.unmount()
  })
})
