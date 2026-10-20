import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_RUN } from './fixtures/ruflo-run'
import { command, PANE, PLUGIN, SESSION } from './fixtures/inputs'
import { buttonKeysOf, exitOk, textOf, worldOf, type World } from './fixtures/world'

const PREFIX = ['npx', '--offline', '-y', '@claude-flow/cli@latest']
const CODER = 'agent-1790888815793-6ju96w'
const TESTER = 'agent-1790888816288-z5xsn6'
const LOGIN_TASK = 'task-1790888817265-vatniv'
const CLAIMS = '.claude-flow/claims/claims.json'

/** What `hooks route --format json` printed in the real run: two log lines, then the JSON. */
const ROUTE_STDOUT = (agent: string, confidence: number) =>
  `[INFO] Routing task: x\nTransformers.js loaded\n${JSON.stringify({ task: 'Build login form', matched: true, matchedPattern: 'testing-task', primaryAgent: { type: agent, confidence }, alternativeAgents: [{ type: 'reviewer', confidence: 0.64 }], routing: { method: 'semantic-native' } }, null, 2)}`

const press = async ($: { ui: { render: (e: typeof PANE) => Promise<unknown>; press: (t: { plugin: string; key: string }) => Promise<unknown> } }, key: string) => {
  await $.ui.render(PANE)
  await $.ui.press({ plugin: PLUGIN, key })
}

/** The claims file with `issueId` held by `agentId`, as claims_steal leaves it. */
function claimedBy(world: World, agentId: string, agentType: string): string {
  const store = JSON.parse(world.files.get(CLAIMS) ?? '{}') as { claims: Record<string, { claimant: unknown }> }
  const claim = store.claims[LOGIN_TASK]

  if (claim !== undefined) {
    claim.claimant = { type: 'agent', agentId, agentType }
  }

  return JSON.stringify(store)
}

describe('controller', () => {
  test('stealing a task asks first, then runs one fixed argv and checks the claim moved on disk', async ($, on) => {
    const world = worldOf(on, RUFLO_RUN)

    mock.clock(on)
    world.respond = argv => (argv.includes('claims_steal') ? { ...exitOk('{"success":true}'), write: { [CLAIMS]: claimedBy(world, TESTER, 'tester') } } : exitOk())
    await $.session.start(SESSION)
    await $.command.run(command('ruflo-swarm-pane'))

    // The queen is selected first; two presses reach the tester.
    await press($, 'next')
    await press($, 'next')
    await press($, 'steal')

    expect(world.runs, 'nothing runs before the second press').toEqual([])
    expect(textOf(await $.ui.render(PANE))).toContain(`steal ${LOGIN_TASK} for tester?`)

    await press($, 'confirm')

    expect(world.runs.map(run => run.argv)).toEqual([[...PREFIX, 'mcp', 'exec', '-t', 'claims_steal', '-p', JSON.stringify({ issueId: LOGIN_TASK, stealer: `agent:${TESTER}:tester` })]])
    expect(textOf(await $.ui.render(PANE))).toContain(`✓ seen on disk: steal ${LOGIN_TASK} for tester`)
  })

  test('cancel drops the prompt, and an unanswered prompt lapses after thirty seconds', async ($, on) => {
    const world = worldOf(on, RUFLO_RUN)
    const clock = mock.clock(on)

    await $.session.start(SESSION)
    await press($, 'next')
    await press($, 'stop')
    expect(textOf(await $.ui.render(PANE))).toContain(`stop agent ${CODER}?`)
    await press($, 'cancel')
    expect(buttonKeysOf(await $.ui.render(PANE))).not.toContain('confirm')

    await press($, 'stop')
    await clock.advance(31_000)
    expect(buttonKeysOf(await $.ui.render(PANE))).not.toContain('confirm')
    expect(world.runs).toEqual([])
  })

  test('a CLI that says yes while the disk shows nothing is reported as unverified, not as done', async ($, on) => {
    const world = worldOf(on, RUFLO_RUN)

    mock.clock(on)
    // As ruflo 3.49.0 did in the real run: "[OK] Vote recorded", and no vote in the hive's state.
    world.respond = () => exitOk('[OK] Vote recorded (For: undefined, Against: undefined)')
    await $.session.start(SESSION)
    await press($, 'next')
    await press($, 'vote-yes')

    expect(world.runs[0]?.argv.slice(4)).toEqual(['hive-mind', 'consensus', '-a', 'vote', '-p', 'proposal-1790888860262-55jkcl', '-v', 'yes', '--voter-id', CODER])
    expect(textOf(await $.ui.render(PANE))).toContain('exited 0 but the disk does not show it')
  })

  test('re-route asks the router for the selected task and shows its pick with the score', async ($, on) => {
    const world = worldOf(on, RUFLO_RUN)

    mock.clock(on)
    world.respond = () => exitOk(ROUTE_STDOUT('tester', 0.74))
    await $.session.start(SESSION)
    await press($, 'reroute')

    expect(world.runs[0]?.argv.slice(4)).toEqual(['hooks', 'route', '--task', 'Build login form', '--format', 'json'])
    expect(textOf(await $.ui.render(PANE))).toContain('router: tester 74% (testing-task) · alt reviewer 64%')

    world.respond = () => exitOk(ROUTE_STDOUT('architect', 0.41))
    await press($, 'reroute')
    expect(textOf(await $.ui.render(PANE)), 'the router said matched at 0.41: the pane says it is under the threshold').toContain('router: below threshold 50% (best architect 41%)')
  })

  test("a ruflo agent's logs open below the tiles; a Claude Code loop shows what the hooks saw", async ($, on) => {
    const world = worldOf(on, RUFLO_RUN)

    mock.clock(on)
    on('tool.call', () => ({ result: 'ok', text: 'ok' }))
    world.respond = () => exitOk(`Logs for ${CODER}\n5:06:55 PM [INFO]  agent created (type=coder, status=idle)`)
    await $.session.start(SESSION)
    await press($, 'next')
    await press($, 'logs')
    expect(textOf(await $.ui.render(PANE))).toContain('agent created (type=coder, status=idle)')

    await $.tool.call({ tool: 'Grep', pattern: 'login' } as never)
    await press($, 'prev')
    await press($, 'prev')
    await press($, 'logs')
    expect(textOf(await $.ui.render(PANE))).toContain('· Grep login')
  })

  test('a refused process run is a sentence in the pane, not a crash', async ($, on) => {
    const world = worldOf(on, RUFLO_RUN)

    mock.clock(on)
    world.respond = () => ({ deny: 'process.run removed by policy' })
    await $.session.start(SESSION)
    await press($, 'reroute')

    expect(textOf(await $.ui.render(PANE))).toMatch(/✗ failed: ask the router · .*process\.run remo/)
  })

  test('the actions on a task only act on ids ruflo minted: a hostile task text stays one argv element', async ($, on) => {
    const hostile = JSON.parse(RUFLO_RUN['.claude-flow/tasks/store.json'] ?? '{}') as { tasks: Record<string, { description: string }> }
    const login = hostile.tasks[LOGIN_TASK]

    if (login !== undefined) {
      login.description = 'x"; rm -rf / #\n$(curl evil)'
    }

    const world = worldOf(on, { ...RUFLO_RUN, '.claude-flow/tasks/store.json': JSON.stringify(hostile) })

    mock.clock(on)
    await $.session.start(SESSION)
    await press($, 'reroute')

    expect(world.runs[0]?.argv).toEqual([...PREFIX, 'hooks', 'route', '--task', 'x"; rm -rf / # $(curl evil)', '--format', 'json'])
  })

  test('a task text that would read as a flag is not passed at all', async ($, on) => {
    const flagged = JSON.parse(RUFLO_RUN['.claude-flow/tasks/store.json'] ?? '{}') as { tasks: Record<string, { description: string }> }
    const login = flagged.tasks[LOGIN_TASK]

    if (login !== undefined) {
      login.description = '--format=yaml --task x'
    }

    const world = worldOf(on, { ...RUFLO_RUN, '.claude-flow/tasks/store.json': JSON.stringify(flagged) })

    mock.clock(on)
    await $.session.start(SESSION)
    await press($, 'reroute')

    expect(world.runs).toEqual([])
    expect(textOf(await $.ui.render(PANE))).toContain('✗ failed: re-route · nothing to act on')
  })
})
