import { describe, expect, mock, test } from 'claude-code/testing'

import { EVENTS_MAX, parseEvents, parseHosts, remoteHostOf } from '../hooks/reader/ruos'
import { RUFLO_RUN } from './fixtures/ruflo-run'
import { command, PANE, SESSION } from './fixtures/inputs'
import { textOf, worldOf } from './fixtures/world'

const CODER = 'agent-1790888815793-6ju96w'
const TESTER = 'agent-1790888816288-z5xsn6'

/** The real run, with the coder and tester placed on ruOS desktops as the ruflo-ruos contract writes them. */
function remoteRun(extra: Record<string, string> = {}): Record<string, string> {
  const store = JSON.parse(RUFLO_RUN['.claude-flow/agents/store.json'] ?? '{}') as { agents: Record<string, { config: Record<string, unknown> }> }
  const coder = store.agents[CODER]
  const tester = store.agents[TESTER]

  if (coder !== undefined && tester !== undefined) {
    coder.config.host = { kind: 'ruos', desktopId: 'm-7f3a', desktopName: 'ruos-desktop-1', transport: 'fleet-mcp', runId: 'run-1' }
    tester.config.host = { kind: 'ruos', desktopId: 'm-9c21', desktopName: 'ruos-desktop-2', transport: 'ssh', runId: 'run-2' }
  }

  return {
    ...RUFLO_RUN,
    '.claude-flow/agents/store.json': JSON.stringify(store),
    '.claude-flow/ruos/hosts.json': JSON.stringify({
      updatedAt: '2026-10-01T22:00:00.000Z',
      hosts: [
        { desktopId: 'm-7f3a', name: 'ruos-desktop-1', state: 'running', heartbeatAt: new Date(Date.now() - 12_000).toISOString(), agents: [CODER] },
        { desktopId: 'm-9c21', name: 'ruos-desktop-2', state: 'running', agents: [TESTER] },
      ],
    }),
    '.claude-flow/ruos/events.jsonl': [
      { ts: 1, type: 'run.started', runId: 'run-1', agentId: CODER, desktopId: 'm-7f3a' },
      { ts: 2, type: 'run.output', runId: 'run-1', agentId: CODER, desktopId: 'm-7f3a', bytes: 812 },
      { ts: 3, type: 'run.started', runId: 'run-2', agentId: TESTER, desktopId: 'm-9c21' },
      { ts: 4, type: 'run.failed', runId: 'run-2', agentId: TESTER, desktopId: 'm-9c21', exitCode: 2, error: 'SECRET-OUTPUT-LINE' },
    ].map(event => JSON.stringify(event)).join('\n'),
    ...extra,
  }
}

describe('ruos', () => {
  test('agents on ruOS desktops carry the desktop name, take their state from the newest run event, and the hosts are listed', async ($, on) => {
    worldOf(on, remoteRun())
    mock.clock(on)
    await $.session.start(SESSION)

    const text = textOf(await $.ui.render(PANE))
    const status = (await $.command.run(command('ruflo-swarm-status'))).text ?? ''

    expect(text).toContain('coder @ruos-desktop-1')
    expect(text).toContain('tester @ruos-desktop-2')
    expect(text).toContain('ruOS hosts')
    expect(text).toMatch(/ruos-desktop-1 · running · heartbeat 1[0-9]s ago · 1 agent/)
    expect(text).toContain('ruos-desktop-2 · running · no heartbeat · 1 agent')
    expect(status).toContain('coder @ruos-desktop-1 (ruflo) running')
    expect(status).toContain('tester @ruos-desktop-2 (ruflo) failed (exit 2)')
    expect(`${text}${status}`, 'free text from the event log is never read').not.toContain('SECRET-OUTPUT-LINE')
  })

  test('agents that name a desktop with no host snapshot on disk say so; no remote agents and no file draws no section', async ($, on) => {
    const files = remoteRun()

    delete files['.claude-flow/ruos/hosts.json']
    worldOf(on, files)
    mock.clock(on)
    await $.session.start(SESSION)

    expect(textOf(await $.ui.render(PANE))).toContain('ruOS hosts: not on disk (2 agents name one)')
  })

  test('without ruflo-ruos the pane has no ruOS section at all', async ($, on) => {
    worldOf(on, RUFLO_RUN)
    mock.clock(on)
    await $.session.start(SESSION)

    expect(textOf(await $.ui.render(PANE))).not.toContain('ruOS')
  })

  test('an event log past the size cap is not read, and the pane says why', async ($, on) => {
    worldOf(on, remoteRun({ '.claude-flow/ruos/events.jsonl': ' '.repeat(EVENTS_MAX + 1) }))
    mock.clock(on)
    await $.session.start(SESSION)

    expect(textOf(await $.ui.render(PANE))).toContain('ruOS event log is 2 MB: not read')
  })

  test('hostile host and event text: bad ids are dropped, names cleaned, unknown types ignored, output never ends a run', () => {
    expect(remoteHostOf({ host: { kind: 'ruos', desktopId: '$(rm -rf /)', desktopName: 'x' } })).toBeNull()
    expect(remoteHostOf({ host: { kind: 'other', desktopId: 'm-1' } })).toBeNull()
    expect(remoteHostOf({ host: { kind: 'ruos', desktopId: 'm-1', desktopName: '\u001b[2Jevil\u0007', transport: 'telnet' } })).toEqual({ desktopId: 'm-1', desktopName: '[2Jevil', transport: 'unknown' })
    expect(parseHosts('{"hosts":[{"desktopId":"bad id"},{"desktopId":"m-2","name":"ok","state":"x","heartbeatAt":"not a date"}]}')).toEqual([{ desktopId: 'm-2', name: 'ok', state: 'x', agents: [] }])
    expect(parseHosts('[]')).toBeNull()

    const events = parseEvents(
      [
        '{"ts":5,"type":"run.completed","runId":"run-1"}',
        '{"ts":6,"type":"run.output","runId":"run-1","bytes":10}',
        '{"ts":7,"type":"run.exploded","runId":"run-1"}',
        'not json',
        '{"ts":"2026-10-01T22:00:00Z","type":"desktop.state","desktopId":"m-1"}',
      ].join('\n'),
    )

    expect(events.map(event => event.type)).toEqual(['run.completed', 'desktop.state'])
    expect(parseEvents(`${'{"ts":1,"type":"run.started","runId":"r"}\n'.repeat(5_000)}`)).toHaveLength(1)
  })
})
