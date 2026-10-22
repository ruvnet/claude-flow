import type { TestBody } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { autoAnswer, FAKE_SECRET, WF_ID } from './fixtures/automate'
import { HIVE_FILES, RAFT_ID, WORKERS } from './fixtures/hive'
import { MEM_OUT } from './fixtures/memory'
import { MISSION_OBSERVATION } from './fixtures/missions'
import { HIVE_TOKEN, RUFLO_FILES } from './fixtures/ruflo-run'
import { FIND_OUT, LIST_OUT, LS_GLOBAL, USE_OUT } from './fixtures/skills'
import { VEC_OUT } from './fixtures/vector'
import { inputKeys, cliAnswer, command, elementsOf, fakeRuflo, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

const HOME_FILES = {
  '.claude/plugins/installed_plugins.json': JSON.stringify({
    version: 2,
    plugins: {
      'ruflo-core@ruflo': [{ scope: 'user', version: '0.2.6', lastUpdated: '2026-07-30T12:06:11.791Z' }],
      'ruflo-swarm@ruflo': [{ scope: 'user', version: '0.2.1' }],
    },
  }),
  '.claude/plugins/known_marketplaces.json': JSON.stringify({ ruflo: { installLocation: '/home/dev/.claude/plugins/marketplaces/ruflo', lastUpdated: '2026-09-03T18:45:31.282Z', autoUpdate: true } }),
  '.claude/plugins/marketplaces/ruflo/.claude-plugin/marketplace.json': JSON.stringify({ name: 'ruflo', plugins: [{ name: 'ruflo-core' }, { name: 'ruflo-swarm' }] }),
}

import { drawn } from './fixtures/views'

describe('vector lab', () => {
  test('vector lab: every section, its fields and tagged entries; opening it runs no ruvector command', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    const vecRuns = () => world.runs.filter(argv => argv[3] === 'ruvector@0.3.3')

    world.respond = argv => (argv[3] !== 'ruvector@0.3.3' ? cliAnswer(argv) : { exitCode: 0, stdout: '{"success": true}', stderr: '' })
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, tree } = await drawn($, 'vector')

    for (const title of ['RESULT', 'BRAIN', 'RVF CONTAINERS', 'SQL / GRAPH', 'DECOMPILE', 'WORKERS', 'EDGE', 'HOOKS INTEL', 'IDENTITY']) expect(text).toContain(`▓▒░ ${title} ░▒▓`)
    expect(text).toContain('nothing run yet')
    expect(text).toMatch(/pub \n SHARE \.+/)
    expect(text).toMatch(/del \n DELETE \.+/)
    expect(text).toContain('rvf_delete is an MCP tool of the ruvector server with no CLI verb')
    expect(inputKeys(tree)).toEqual(['vec-in-brain', 'vec-in-rvfPath', 'vec-in-rvfArg', 'vec-in-sql', 'vec-in-target', 'vec-in-worker', 'vec-in-task'])
    expect(elementsOf(tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['vec-brain-status', 'vec-brain-share', 'vec-rvf-query', 'vec-sql', 'vec-hooks-stats', 'vec-identity-generate']))
    expect(elementsOf(tree, 'Button').map(keyOf)).not.toContain('vec-rvf-delete')
    expect(vecRuns()).toHaveLength(0)
  })

  test('vector lab: a local read runs one fixed argv at once and shows its lines; the shared brain asks first', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    const vecRuns = () => world.runs.filter(argv => argv[3] === 'ruvector@0.3.3').map(argv => argv.slice(4).join(' '))

    world.respond = argv => (argv[3] !== 'ruvector@0.3.3' ? cliAnswer(argv) : argv[4] === 'hooks' && argv[5] === 'stats' ? { exitCode: 0, stdout: VEC_OUT.hooksStats, stderr: '' } : argv[4] === 'hooks' ? { exitCode: 0, stdout: VEC_OUT.route, stderr: '' } : { exitCode: 0, stdout: '{"total_memories": 12}', stderr: '' })
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('vector'))

    const pane = await $.ui.mount({ ...paneAt(110), surface: 'terminal' as const, plugin: PLUGIN })

    await pane.press({ key: 'vec-hooks-stats' })
    expect(textOf(await pane.drawn())).toContain('2 Q-learning patterns')
    expect(world.runs.filter(argv => argv[3] === 'ruvector@0.3.3')).toEqual([['npx', '--offline', '-y', 'ruvector@0.3.3', 'hooks', 'stats']])

    await pane.input({ key: 'vec-in-task', text: 'write the login tests', kind: 'submit' })
    expect(textOf(await pane.drawn())).toContain('recommended: coder')
    expect(vecRuns()).toEqual(['hooks stats', 'hooks route -- write the login tests'])

    await pane.press({ key: 'vec-brain-status' })

    const asked = textOf(await pane.drawn())

    expect(asked).toContain('runs: npx --offline -y ruvector@0.3.3 brain status')
    expect(asked).toContain('reaches pi.ruv.io')
    expect(vecRuns()).toHaveLength(2)

    await pane.press({ key: 'confirm' })
    expect(textOf(await pane.drawn())).toContain('total_memories: 12')
    expect(vecRuns()).toEqual(['hooks stats', 'hooks route -- write the login tests', 'brain status'])

    // Generate waits for a show that found no key: nothing is asked, nothing runs.
    await pane.press({ key: 'vec-identity-generate' })
    expect(textOf(await pane.drawn())).toContain('run ▸ SHOW first')
    expect(vecRuns()).toHaveLength(3)
    await pane.unmount()
  })

  test('vector lab headless: /ruflo run vec-<id> <text> answers with the lines; a network one asks and runs on yes', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    const vecRuns = () => world.runs.filter(argv => argv[3] === 'ruvector@0.3.3').map(argv => argv.slice(4).join(' '))

    world.respond = argv => (argv[3] !== 'ruvector@0.3.3' ? cliAnswer(argv) : argv[4] === 'hooks' ? { exitCode: 0, stdout: VEC_OUT.route, stderr: '' } : { exitCode: 1, stdout: '', stderr: VEC_OUT.brainMissing })
    mock.clock(on)
    await $.session.start({ ...SESSION, isInteractive: false })

    const routed = (await $.command.run(command('run vec-hooks-route Fix the login bug'))).text ?? ''

    expect(routed).toMatch(/^✓ hooks route: an agent for the task · exit 0\n/)
    expect(routed).toContain('  recommended: coder')
    expect(vecRuns()).toEqual(['hooks route -- Fix the login bug'])
    expect((await $.command.run(command('run vec-brain-search hnsw recall'))).text).toContain('Asked: brain search: the field’s words. Confirm with /ruflo yes (or y in the pane), cancel with /ruflo no.')
    expect(vecRuns()).toHaveLength(1)
    expect((await $.command.run(command('yes'))).text).toContain('Brain commands require @ruvector/pi-brain')
    expect(vecRuns()).toEqual(['hooks route -- Fix the login bug', 'brain search hnsw recall --limit 10'])
    expect((await $.command.run(command('run vec-rvf-delete'))).text).toMatch(/^nothing to do: n\/a: rvf_delete is an MCP tool/)
  })
})
