import type { TestBody } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { autoAnswer, FAKE_SECRET, WF_ID } from './fixtures/automate'
import { EVOLVE_FILES, EVOLVE_OUT, R4 } from './fixtures/evolve'
import { HIVE_FILES, RAFT_ID, WORKERS } from './fixtures/hive'
import { MEM_OUT } from './fixtures/memory'
import { MISSION_OBSERVATION } from './fixtures/missions'
import { HIVE_TOKEN, RUFLO_FILES } from './fixtures/ruflo-run'
import { FIND_OUT, LIST_OUT, LS_GLOBAL, USE_OUT } from './fixtures/skills'
import { VEC_OUT } from './fixtures/vector'
import { cliAnswer, command, elementsOf, fakeRuflo, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

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

describe('self-evolution', () => {
  test('self-evolution: every section from the flywheel files; opening runs nothing; a read runs at once; the gate asks first', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, { ...RUFLO_FILES, ...EVOLVE_FILES })
    const evolveRuns = () => world.runs.filter(argv => /flywheel|policy|verify/.test(argv.join(' ')) && !argv.includes('mcp'))

    world.respond = argv => {
      const line = argv.join(' ')

      if (line.endsWith('metaharness flywheel status')) return { exitCode: 0, stdout: EVOLVE_OUT.statusEmpty, stderr: '[WARN] Skipped helper auto-refresh' }
      if (line.includes('policy evaluate')) return { exitCode: 0, stdout: EVOLVE_OUT.gate, stderr: '' }

      return cliAnswer(argv)
    }
    mock.clock(on)
    await $.session.start(SESSION)

    // Headless, before the view was ever opened, the dump waits for the same file read.
    expect((await $.command.run(command('dump evolve'))).text).toContain('dddddddd champion')

    const { text, tree, rasters } = await drawn($, 'evolve')
    const buttons = elementsOf(tree, 'Button').map(keyOf)

    expect(rasters).toEqual(['title', 'evolve-loop'])
    for (const section of ['LOOP', 'LEDGER & RECEIPTS', 'LINEAGE', 'POLICIES', 'WITNESS', 'WHAT RUNS WHERE', 'PROMOTE']) expect(text).toContain(`▓▒░ ${section} ░▒▓`)
    expect(text).toContain('dddddddd champion')
    expect(text).toContain('✗ 33333333 \nrejected \n UNSIGNED · evaluated · cccccccc → eeeeeeee')
    expect(text).toContain('✗ eeeeeeee \nrejected · evaluated · receipt 33333333')
    expect(text).toContain('armed: previous 5555aaaa')
    expect(text).toContain('signed · 117 fixes · release/3.51.1 @ 77a77a4527d… ')
    expect(text).toContain('https://github.com/ruvnet/autogenous')
    expect(text).toContain('ruflo metaharness flywheel promote <receipt-id> --public-key <approved-ed25519.pem> --confirm')
    expect(buttons).toEqual(expect.arrayContaining(['evolve-evolve-ledger', 'evolve-evolve-gate', 'evolve-evolve-witness-linux', 'evolve-ask-autogenous', 'evolve-ask-rgi', 'evolve-lab']))
    expect(buttons.some(key => /promote/.test(key))).toBe(false)
    // Opening the view read the files only: no flywheel, policy or verify run.
    expect(evolveRuns()).toEqual([])

    expect((await $.command.run(command('run evolve-ledger'))).text).toBe('✓ verify the flywheel ledger (metaharness flywheel status) · exit 0\n  ledger VALID · 0 commits · head genesis\n  champion n/a · serving epoch 0 · 0 receipts registered')
    expect(evolveRuns().map(argv => argv.join(' '))).toEqual(['npx --offline -y @claude-flow/cli@latest metaharness flywheel status'])

    const gate = JSON.stringify({ identity: { id: 'ruflo-console', type: 'plugin' }, action: { type: 'metaharness.candidate.promote', resource: R4, environment: 'production', destructive: true } })

    expect((await $.command.run(command('run evolve-gate'))).text).toMatch(/^Asked: ask the policy gate about a promotion/)

    const pane = await $.ui.mount({ ...paneAt(110), plugin: PLUGIN })
    const asked = textOf(await pane.drawn())

    await pane.unmount()
    expect(asked).toContain(`runs: ruflo policy evaluate ${gate}`)
    expect(asked).toContain('appends one decision receipt to .claude-flow/policy/state.json; promotes nothing')
    expect(evolveRuns()).toHaveLength(1)

    expect((await $.command.run(command('yes'))).text).toContain('outcome allowed · enforced allowed · mode legacy')
    expect(evolveRuns().map(argv => argv.slice(4))).toEqual([['metaharness', 'flywheel', 'status'], ['policy', 'evaluate', gate]])
  })
})
