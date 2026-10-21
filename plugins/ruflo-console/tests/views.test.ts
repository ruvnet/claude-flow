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

describe('views', () => {

  test('overview: every subsystem from disk, the CLI or the engine, health alerts, the activity raster', { options: { boot: false } }, async ($, on) => {
    fakeRuflo().register(on, {})
    worldOf(on, RUFLO_FILES, { home: HOME_FILES })
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters } = await drawn($, 'overview')

    expect(rasters).toEqual(['title', 'activity'])
    expect(text).toContain('v3.50.0 (npx-offline)')
    expect(text).toContain('running per daemon-state.json')
    expect(text).toContain('1 ruflo server connected (plugin_ruflo-core_ruflo) · 2 tools callable now')
    expect(text).toContain('manifest v3.32.24')
    expect(text).toContain('seated · policy observe · routed 4')
    expect(text).toContain('swarm-1790903031804-y9rnjr · hierarchical · running · 2 agents')
    expect(text).toContain('marketplace clone stale: no ruflo-mods — /plugin marketplace update ruflo')
    expect(text).toContain('budget WARNING: $3.90 of $5.00')
  })

  test('swarm: the topology graph, selectable agents, the hive with its proposal, no hive token', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters, tree } = await drawn($, 'swarm')

    expect(rasters).toEqual(['title', 'topology'])
    expect(text).toContain('hierarchical · specialized · running · 2 agents · max 6 · updated ')
    // One label per agent (no repeated type), then status; a short id instead of the full one.
    expect(text).toMatch(/▸● \ncoder\s+idle\s+tasks/)
    expect(text).toMatch(/· #[a-z0-9]{4,6}/)
    expect(text).toContain('design (raft) pending · for 0 · against 0')
    expect(text).not.toContain(HIVE_TOKEN)
    expect(elementsOf(tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['agent-next', 'agent-prev', 'drill', 'palette', 'actions', 'open-hive']))
    // Every view has a hotkey, the Hive-Mind tab included (b).
    const tabProps = (key: string) => (elementsOf(tree, 'Button').find(button => keyOf(button) === key) as { props?: Record<string, unknown> } | undefined)?.props

    expect(tabProps('tab-claims')?.hotkey).toBe('4')
    expect(tabProps('tab-hive')).toBeDefined()
    expect(tabProps('tab-hive')?.hotkey).toBe('b')
  })

  test('hive: the honeycomb, quorum and fault tolerance, proposals, workers, decisions, broadcasts, no token', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, HIVE_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters, tree } = await drawn($, 'hive')

    // The comb, a chamber per open proposal, and the strip (shield, terms, pheromones); nothing asked, nothing run.
    expect(rasters).toEqual(['title', 'hive', 'hive-chambers', 'hive-strip'])
    expect(text).toContain('3 in the comb · 1 byzantine')
    expect(text).toMatch(/voting chambers/i)
    expect(world.runs.filter(argv => argv.includes('hive-mind') || argv.some(arg => arg.startsWith('hive-mind_')))).toEqual([])
    expect(text).toContain('queen-1790903321632 · term 2')
    expect(text).toContain('raft · proposals vote raft')
    expect(text).toContain('tolerates 1 faulty of 3 (raft f < n/2)')
    expect(text).toContain('2 of 3 votes to pass (majority)')
    expect(text).toContain('3 · 1 busy · 1 idle · 0 down · 1 in no agent store')
    expect(text).toContain('▸◇ design (raft T2 · timed out) pending · for 1 · against 0')
    expect(text).toContain('need 2 of 3')
    expect(text).toContain(`a vote is cast as the next worker that has not voted: ${WORKERS[1]}`)
    expect(text).toContain('budget → rejected · for 1 · against 2 · bft · 1 byzantine')
    expect(text).toContain('[high] system: freeze the main branch')
    expect(text).toContain('propose: n/a — raft term 2 already has design')
    expect(text).not.toContain(HIVE_TOKEN)
    expect(inputKeys(tree)).toEqual(['hive-propose', 'hive-broadcast'])
    expect(elementsOf(tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['hive-vote-yes', 'hive-vote-no', 'hive-spawn-worker']))
  })

  test('hive: with no hive, an empty comb with its egg holds the start buttons, and nothing runs unasked', { options: { boot: false } }, async ($, on) => {
    const files = Object.fromEntries(Object.entries(HIVE_FILES).filter(([path]) => !path.startsWith('.claude-flow/hive-mind/')))
    const world = worldOf(on, files)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters, tree } = await drawn($, 'hive')

    expect(rasters).toEqual(['title', 'hive-egg', 'hive-egg-base'])
    expect(text).toContain('the comb is empty · the egg is where the queen will sit')
    expect(elementsOf(tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['start-hive', 'start-hive-workers']))

    const pane = await $.ui.mount({ ...paneAt(110), plugin: PLUGIN })

    await pane.press({ key: 'start-hive' })
    await pane.unmount()
    expect(world.runs.filter(argv => argv.includes('hive-mind'))).toEqual([])
  })

  test('hive: a vote asks before it runs, then runs one fixed argv as the next worker on yes', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, HIVE_FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('hive'))

    const pane = await $.ui.mount({ ...paneAt(110), plugin: PLUGIN })
    const votes = () => world.runs.filter(argv => argv.includes('consensus'))

    await pane.press({ key: 'hive-vote-yes' })
    expect(textOf(await pane.drawn())).toContain(`Confirm: vote for design (${RAFT_ID}) as worker ${WORKERS[1]}?`)
    expect(votes()).toHaveLength(0)

    await pane.press({ key: 'confirm' })
    expect(votes()).toHaveLength(1)
    expect(votes()[0]?.slice(4)).toEqual(['hive-mind', 'consensus', '--action', 'vote', '--proposal-id', RAFT_ID, '--vote', 'yes', '--voter-id', WORKERS[1], '--format', 'json'])
    await pane.unmount()
  })

  test('claims: the flow diagram with lanes and rings, the board, and the act row', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters, tree } = await drawn($, 'claims')

    expect(rasters).toEqual(['title', 'flow'])
    expect(text).toContain('1 active · 1 stealable · 0 handoff')
    expect(text).toContain('no claims tool sets a TTL today')
    expect(text).toMatch(/console-demo-2.*stealable/)
    expect(elementsOf(tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['claim', 'release', 'handoff', 'steal', 'agent-next', 'task-next']))
  })

  test('federation: the map, local identity and channels; the relay is never asked while the option is off', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters } = await drawn($, 'federation')

    expect(rasters).toEqual(['title', 'fedmap'])
    expect(text).toContain('agentbbs agentbbs-not-found')
    expect(text).toContain('Off: the roster is on the public relay')
    expect(world.runs.some(argv => argv.join(' ').includes('x_federation_roster'))).toBe(false)
  })

  test('plugins: the health matrix, and a clone without ruflo-mods reads STALE with the fix named', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES, { home: HOME_FILES })
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters } = await drawn($, 'plugins')

    expect(rasters).toEqual(['title', 'health'])
    expect(text).toContain('STALE: the clone does not list ruflo-mods')
    expect(text).toContain('2 ruflo · 1 enabled · 2 total')
  })

  test('learning: last route, outcome rate with its N, the curve, the four-stage pipeline, pattern growth', { options: { boot: false } }, async ($, on) => {
    fakeRuflo().register(on, {})
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    // The pipeline section is open by default since ADR-455 (its stages are a picture of their own); the old test clicked it open.
    const { text, rasters } = await drawn($, 'learning', 110)

    expect(rasters).toEqual(['title', 'route', 'curve', 'pipeline-stages', 'patterns'])
    expect(text).toContain('tester 60% · keyword match')
    expect(text).toMatch(/\d+\/9 succeeded \(\d+% success rate, N=9\)/)
    expect(text).toContain('consolidate: EWC consolidations')
  })

  test('metaharness: the radar, the audit trend, the flywheel ledger and the active policy', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const folded = await drawn($, 'metaharness')
    expect(folded.rasters).toEqual(['title', 'radar'])
    const { text, rasters } = await drawn($, 'metaharness', 110, ['mh-trend'])

    expect(rasters).toEqual(['title', 'radar', 'trend'])
    expect(text).toContain('$0.024')
    expect(text).toContain('valid · 0 commits · 0 receipts')
  })

  test('metaharness lab: every verb by purpose with its cost tag and button; promote is a command, never a button', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)

    mock.clock(on)
    await $.session.start(SESSION)

    const { text, tree } = await drawn($, 'metaharness', 110, ['mh-record', 'mh-evolve', 'mh-promote'])
    const buttons = elementsOf(tree, 'Button').map(keyOf)

    expect(text).toMatch(/LAB · INSPECT/i)
    expect(text).toMatch(/LAB · EVOLVE & TEST/i)
    expect(text).toMatch(/ \$\$ \n REDBLUE JUDGED \.+/)
    expect(text).toContain('ruflo metaharness flywheel promote <receipt-id> --public-key <approved-ed25519.pem> --confirm')
    expect(text).toContain('nothing run yet')
    expect(buttons).toEqual(expect.arrayContaining(['lab-mh-genome', 'lab-mh-mcp-scan', 'lab-mh-audit', 'lab-mh-redblue-real', 'lab-mh-learn-run', 'lab-mh-flywheel-run']))
    expect(buttons.some(key => key.startsWith('lab-') && /promote/.test(key))).toBe(false)
    // Drawing the lab runs nothing but the view's own probes.
    expect(world.runs.some(argv => /genome|mcp-scan|redblue|evolve|learn/.test(argv.join(' ')))).toBe(false)
  })

  test('memory and cost: entries, a namespace sample; spend, the gauge, the ladder and the burn', { options: { boot: false } }, async ($, on) => {
    fakeRuflo().register(on, {})
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const memory = await drawn($, 'memory')

    expect(memory.text).toContain('1 · 0 with vectors')
    expect(memory.text).toMatch(/console\s+█+ 1/)

    const cost = await drawn($, 'cost')

    expect(cost.rasters).toEqual(['title', 'gauge', 'burn'])
    expect(cost.text).toContain('$0.421')
    expect(cost.text).toContain('WARNING · $3.90 of $5.00 (78%)')
    expect(cost.text).toContain('WHERE IT GOES')
    expect(cost.text).toContain('AI terminal')
    expect(cost.text).toContain('8 decisions')
    expect(cost.text).toContain('5 routes · spend n/a · tokens n/a')
    expect(cost.text).toContain('$1.100 · ruflo-mods budget')
    expect(cost.text).toContain('50% · $2.50')
    expect(elementsOf(cost.tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['cost-budget-1', 'cost-budget-5', 'cost-budget-10', 'cost-budget-25', 'cost-budget-apply', 'cost-model-stats']))
    expect(inputKeys(cost.tree)).toEqual(['cost-budget'])
  })

  test('timeline, approvals and events draw from what was seen; the drill-down opens an agent', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    const clock = mock.clock(on)
    await $.session.start(SESSION)

    // The lanes come from a status read taken on the 1.5 s activity tick (ADR-474): with the agents read, the lane picture is drawn.
    await $.command.run(command('status'))
    await clock.advance(2000)
    await clock.advance(2000)
    expect((await drawn($, 'timeline')).rasters).toEqual(['title', 'tl-picture'])

    const approvals = await drawn($, 'approvals')

    expect(approvals.text).toContain('[proposal] hive-mind proposal: design (raft)')
    expect(approvals.text).toContain('[stealable] claim console-demo-2 offered for stealing')

    const store = JSON.parse(RUFLO_FILES['.claude-flow/agents/store.json'] ?? '{}') as { agents: Record<string, Record<string, unknown>> }

    ;(Object.values(store.agents)[1] as Record<string, unknown>).status = 'busy'
    world.put('.claude-flow/agents/store.json', JSON.stringify(store))
    await $.command.run(command('status'))
    expect((await drawn($, 'events')).text).toContain('agent tester: idle → busy')

    await $.command.run(command('agent tester'))

    const agent = await drawn($, 'agent agent-1790903032591-x41b0y')

    expect(agent.text).toContain('tester · tester')
    expect(agent.text).toContain('console-demo-2 stealable')
    expect(world.runs.some(argv => argv.join(' ').includes('agent logs --id agent-1790903032591-x41b0y --tail 20'))).toBe(true)
  })

  test('x.ruv.io: the federation menu with its commands, and no registry or roster asked with the network off', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)

    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters } = await drawn($, 'xruv')

    expect(rasters).toEqual(['title'])
    expect(text).toContain(' JOIN ....')
    expect(text).toContain('WORK CLAIMS')
    expect(text).toContain('Turn on federationNetwork in /config')
    expect(world.runs.some(argv => /x_federation_(registry|roster)/.test(argv.join(' ')))).toBe(false)
  })

  test('terminal: the harness picker, what the pick runs, and the text field; nothing runs unasked', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)

    mock.clock(on)
    await $.session.start(SESSION)

    const { text, tree } = await drawn($, 'terminal')

    expect(text).toContain('[l: CLAUDE]')
    expect(text).toContain('claude -p in plan mode, a per-turn budget cap (Settings), one session per project')
    expect(text).toContain('claude: new session')
    expect(inputKeys(tree)).toEqual(['term-input'])
    expect(world.runs.some(argv => argv[0] === 'codex' || argv[0] === 'claude')).toBe(false)
  })

  test('main menu: bare /ruflo lands on it in the BBS look; its prompt takes a key or a name', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command())

    const pane = await $.ui.mount({ ...paneAt(110), surface: 'terminal' as const, plugin: PLUGIN })
    const menu = await pane.drawn()

    expect(elementsOf(menu, 'Raster').map(keyOf)).toEqual(['header', 'palette'])
    expect(textOf(menu)).toContain('▓▒░ SWARM ░▒▓')
    expect(textOf(menu)).toContain('── start here')
    expect(textOf(menu)).toContain('Swarm Topology')
    expect(textOf(menu)).toContain('ANSI-BBS')
    expect(inputKeys(menu)).toEqual(['menu-goal', 'menu-prompt'])

    await pane.input({ key: 'menu-prompt', text: 'w', kind: 'submit' })
    expect(textOf(await pane.drawn()).toLowerCase()).toContain('x.ruv.io')
    expect(world.stored.get('ruflo-console/ui:/work')).toMatchObject({ view: 'xruv' })

    await pane.press({ key: 'tab-menu' })
    await pane.input({ key: 'menu-prompt', text: 'nope', kind: 'submit' })
    expect(textOf(await pane.drawn())).toContain('no area "nope"')
    await pane.unmount()
  })

  test('automate: worker cards and the kanban from disk, nothing run on open; a read runs at once, a spend asks first, secrets masked', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    const mine = () => world.runs.map(argv => argv.slice(4)).filter(argv => /workflow_|session_|config_|task_|neural|autopilot|hooks (route|explain|worker)|daemon/.test(argv.join(' ')))

    world.respond = argv => autoAnswer(argv) ?? cliAnswer(argv)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters } = await drawn($, 'automate')

    expect(rasters).toEqual(['title'])
    expect(text).toContain('● MAP')
    expect(text).toContain('137 runs · 0 failed')
    expect(text).toContain('◐ OPTIMIZE')
    expect(text).toContain('○ ULTRALEARN')
    expect(text).toContain('PENDING (1)')
    expect(text).toContain('Build the console overview')
    expect(text).toMatch(/WORKFLOWS[\s\S]*AUTOPILOT[\s\S]*SESSIONS[\s\S]*CONFIG/)
    expect(mine()).toEqual([])

    const pane = await $.ui.mount({ ...paneAt(110), plugin: PLUGIN })

    await pane.press({ key: 'run-auto-wf-list' })
    expect(mine()).toEqual([['mcp', 'exec', '-t', 'workflow_list', '-p', '{"limit":20}']])
    expect(textOf(await pane.drawn())).toContain('ship the console')

    await pane.press({ key: `run-auto-wf-run-${WF_ID}` })
    const asked = textOf(await pane.drawn())

    expect(asked).toContain(`Confirm: run workflow ${WF_ID} (its task steps call a model)?`)
    expect(asked).toContain(`runs: ruflo mcp exec -t workflow_execute -p ${JSON.stringify({ workflowId: WF_ID })}`)
    expect(asked).toContain('COSTS MONEY')
    expect(mine()).toHaveLength(1)
    await pane.press({ key: 'confirm' })
    expect(mine()[1]).toEqual(['mcp', 'exec', '-t', 'workflow_execute', '-p', JSON.stringify({ workflowId: WF_ID })])

    await pane.press({ key: 'run-auto-cfg-list' })
    const config = textOf(await pane.drawn())

    expect(config).toContain('providers.anthropic.apiKey')
    expect(config).toContain('•••••• (hidden)')
    expect(config).not.toContain(FAKE_SECRET)
    await pane.unmount()
  })

  test('learning lab: what was learned from disk; training asks first, runs one argv and draws the loss; route runs at once', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    const mine = () => world.runs.map(argv => argv.slice(4).join(' ')).filter(line => /^(neural|hooks (route|explain)|mcp exec -t (neural|hooks_intelligence))/.test(line))

    world.respond = argv => autoAnswer(argv) ?? cliAnswer(argv)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters } = await drawn($, 'neural')

    expect(rasters).toEqual(['title'])
    expect(text).toMatch(/trajectories\s+30\.8k/)
    expect(text).toMatch(/TRAINING[\s\S]*ROUTER/)
    expect(mine()).toEqual([])

    const pane = await $.ui.mount({ ...paneAt(110), surface: 'terminal' as const, plugin: PLUGIN })

    await pane.press({ key: 'sec-nn-train' })
    await pane.press({ key: 'run-nn-train-coordination-20' })
    const asked = textOf(await pane.drawn())

    expect(asked).toContain('Confirm: train coordination patterns for 20 epochs?')
    expect(asked).toContain('runs: ruflo neural train --pattern coordination --epochs 20')
    expect(mine()).toEqual([])
    await pane.press({ key: 'confirm' })
    expect(mine()).toEqual(['neural train --pattern coordination --epochs 20'])

    const trained = textOf(await pane.drawn())

    expect(trained).toContain('Final Loss: 4.289e-3')
    expect(trained).toMatch(/loss ▄ +last 4\.289e-3/)

    await pane.input({ key: 'in-nn-route', text: 'fix the login bug', kind: 'submit' })
    expect(mine()[1]).toBe('hooks route --task fix the login bug --format json')
    expect(textOf(await pane.drawn())).toContain('→ tester · 49%')
    await pane.unmount()
  })
})
