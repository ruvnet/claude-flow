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

describe('dev tools', () => {
  test('devtools: every section with its fields and rows; drawing it runs nothing', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, tree } = await drawn($, 'devtools', 110, ['dt-github', 'dt-ruvllm', 'dt-managed', 'dt-maint', 'dt-result'])

    for (const title of ['CAPABILITY BRAIN', 'ANALYZE · GIT DIFF', 'GITHUB & DELIVERY', 'AGENTICOW', 'WASM AGENTS', 'BROWSER', 'TERMINAL SESSIONS', 'PROVIDERS', 'PLUGIN REGISTRY', 'RUVLLM', 'DAA', 'MANAGED AGENTS', 'MAINTENANCE']) expect(text.toUpperCase()).toContain(title)
    expect(text).toMatch(/net \n PULL REQUESTS \.+/)
    expect(text).toContain(' n/a ')
    expect(text).toContain('nothing run yet')
    expect(inputKeys(tree)).toEqual(expect.arrayContaining(['dt-field-brain-task', 'dt-field-analyze-ref', 'dt-field-browser-url', 'dt-field-terminal-cmd']))
    expect(elementsOf(tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['dt-diff-stats', 'dt-gh-prs', 'dt-term-exec', 'dt-cleanup-force']))
    expect(world.runs.some(argv => /analyze_|github_|browser_|terminal_|guidance_|agenticow_|wasm_|managed_|daa_|ruvllm_|transfer_|providers|cleanup|update|migrate|appliance/.test(argv.join(' ')))).toBe(false)
  })

  test('devtools: a diff read runs at once with one fixed argv; a GitHub read asks first, runs nothing on no and one argv on yes', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    const STATS = 'Result:\n{\n  "ref": "HEAD",\n  "totalFiles": 3,\n  "totalAdditions": 12\n}\n'
    world.respond = argv => (argv.includes('analyze_diff-stats') ? { exitCode: 0, stdout: STATS, stderr: '' } : cliAnswer(argv))
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('devtools'))

    const pane = await $.ui.mount({ ...paneAt(110), plugin: PLUGIN })
    const runsOf = (word: string) => world.runs.filter(argv => argv.join(' ').includes(word)).map(argv => argv.slice(4))

    await pane.press({ key: 'dt-diff-stats' })
    let text = textOf(await pane.drawn())
    expect(text).not.toContain('Confirm:')
    expect(text).toContain('totalFiles: 3')
    expect(runsOf('analyze_diff-stats')).toEqual([['mcp', 'exec', '-t', 'analyze_diff-stats', '-p', '{"ref":"HEAD"}']])

    await pane.press({ key: 'sec-dt-github' })
    await pane.press({ key: 'dt-gh-prs' })
    text = textOf(await pane.drawn())
    expect(text).toContain('Confirm: list pull requests?')
    expect(text).toContain('runs: ruflo mcp exec -t github_pr_manage -p {"action":"list"}')
    expect(text).toContain('gh CLI in this repo: it reads GitHub over the network')
    await pane.press({ key: 'cancel' })
    expect(runsOf('github_')).toHaveLength(0)

    await pane.press({ key: 'dt-gh-prs' })
    await pane.press({ key: 'confirm' })
    expect(runsOf('github_')).toEqual([['mcp', 'exec', '-t', 'github_pr_manage', '-p', '{"action":"list"}']])
    await pane.unmount()
  })

  test('devtools headless: a terminal command asks with the command shown, runs once on yes; a wrapped tool error reads ✗', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    const FAILED = 'Result:\n' + JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ error: 'Error: Failed to initialize @ruvector/rvagent-wasm' }) }], isError: true })
    world.respond = argv => (argv.includes('wasm_gallery_list') ? { exitCode: 0, stdout: FAILED, stderr: '' } : cliAnswer(argv))
    mock.clock(on)
    await $.session.start({ ...SESSION, isInteractive: false })

    expect((await $.command.run(command('run dt-term-exec git status'))).text).toBe('Asked: run the command in a ruflo terminal. Confirm with /ruflo yes (or y in the pane), cancel with /ruflo no.')
    expect(world.runs.some(argv => argv.includes('terminal_execute'))).toBe(false)
    await $.command.run(command('yes'))
    expect(world.runs.filter(argv => argv.includes('terminal_execute')).map(argv => argv.slice(4))).toEqual([['mcp', 'exec', '-t', 'terminal_execute', '-p', '{"command":"git status"}']])

    expect((await $.command.run(command('run dt-wasm-gallery'))).text).toBe('✗ WASM gallery: the templates · exit 0\n  ✗ Error: Failed to initialize @ruvector/rvagent-wasm')
    expect((await $.command.run(command('run dt-br-open javascript:alert(1)'))).text).toMatch(/^nothing to do: url field: an http\(s\) URL/)
    expect(world.runs.some(argv => argv.includes('browser_open'))).toBe(false)
  })
})
