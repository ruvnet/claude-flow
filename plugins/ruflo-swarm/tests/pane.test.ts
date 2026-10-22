import type { RenderElement } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { HIVE_TOKEN, RUFLO_RUN } from './fixtures/ruflo-run'
import { command, PANE, paneAt, PLUGIN, SESSION, spawn } from './fixtures/inputs'
import { buttonKeysOf, elementsOf, textOf, worldOf } from './fixtures/world'

const tileOf = (tree: RenderElement, label: string) =>
  elementsOf(tree, 'Text').find(node => textOf(node).includes(label) && (node as { props?: { inverse?: boolean } }).props?.inverse !== undefined) as
    | { props: { inverse?: boolean; color?: string } }
    | undefined

describe('pane', () => {
  test('draws the swarm: tiles by state, the leader, the board, consensus, topology, router and usage', async ($, on) => {
    worldOf(on, RUFLO_RUN)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('ruflo-swarm-pane'))

    const tree = await $.ui.render(PANE)
    const text = textOf(tree)

    expect(text).toContain('swarm …4-u3ktj4 · hierarchical · running')
    expect(text).toContain('★ queen')
    for (const role of ['coder', 'tester', 'reviewer', 'claude (main)']) {
      expect(text).toContain(role)
    }
    expect(text).toContain('pending 1 · claimed 1 · done 0')
    expect(text).toContain('Build login form → coder')
    expect(text).toContain('Write login tests → unassigned')
    expect(text).toContain('design (raft) for 0 · against 0')
    expect(text).toContain('├─ coder')
    expect(text).toContain('router: no pick seen yet')
    expect(text).toContain('cost $0.421 · context 68k/200k (34%)')
    expect(text).not.toContain(HIVE_TOKEN)
    expect(buttonKeysOf(tree)).toEqual(expect.arrayContaining(['hide', 'prev', 'next', 'logs', 'task-prev', 'task-next', 'offer', 'reroute', 'vote-yes', 'vote-no']))
  })

  test('a figure the engine does not give is n/a, never zero', async ($, on) => {
    worldOf(on, RUFLO_RUN, { context: { window: 200_000 }, rateLimits: [] })
    mock.clock(on)
    await $.session.start(SESSION)

    expect(textOf(await $.ui.render(PANE))).toContain('cost n/a · context n/a/200k')
  })

  test('a tile lights blue while its agent reads and yellow while it writes, then fades', async ($, on) => {
    worldOf(on, RUFLO_RUN)
    mock.clock(on)
    on('tool.call', () => ({ result: 'ok', text: 'ok' }))
    on('agent.spawn', () => ({ model: 'haiku', agentId: 'agent-cc-1' }))
    await $.session.start(SESSION)
    await $.command.run(command('ruflo-swarm-pane'))

    await $.agent.spawn(spawn('ruflo-swarm:coordinator', 'write the tests', 'tester-cc'))
    await $.tool.call({ tool: 'Read', file_path: '/work/src/a.ts', agentId: 'agent-cc-1' } as never)

    const reading = tileOf(await $.ui.render(PANE), 'tester-cc')

    expect(reading?.props.inverse).toBe(true)
    expect(reading?.props.color).toBe('suggestion')

    await $.tool.call({ tool: 'Edit', file_path: '/work/src/a.ts', old_string: 'a', new_string: 'b', agentId: 'agent-cc-1' } as never)
    expect(tileOf(await $.ui.render(PANE), 'tester-cc')?.props.color).toBe('warning')
  })

  test('Claude Code subagents join as members by their type, and a finished one reads as done', async ($, on) => {
    worldOf(on, RUFLO_RUN)
    mock.clock(on)
    on('agent.spawn', () => ({ model: 'haiku', agentId: 'agent-cc-2' }))
    await $.session.start(SESSION)

    await $.agent.spawn(spawn('ruflo-core:reviewer', 'review it'))
    expect(textOf(await $.ui.render(PANE))).toContain('reviewer')

    await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 't9', reason: 'answer', agentId: 'agent-cc-2' } as never)

    const status = (await $.command.run(command('ruflo-swarm-status'))).text ?? ''

    expect(status).toContain('· reviewer (claude) completed')
  })

  test('narrower than 44 columns the pane is a list, and the terminal accepts it at every width', async ($, on) => {
    worldOf(on, RUFLO_RUN)
    mock.clock(on)
    on('ui.render', () => ({ type: 'Text', children: [''] }))
    await $.session.start(SESSION)
    await $.command.run(command('ruflo-swarm-pane'))

    const narrow = await $.ui.render(paneAt(30, 30))

    expect(textOf(narrow)).toContain('tasks 1 pending · 1 claimed')
    expect(buttonKeysOf(narrow)).not.toContain('offer')

    for (const [columns, rows] of [[24, 12], [30, 30], [48, 40], [73, 44], [120, 8], [160, 60]] as const) {
      const mounted = await $.ui.mount({ ...paneAt(columns, rows), plugin: PLUGIN })

      expect(mounted.surface).toBe('terminal')
      await mounted.unmount()
    }
  })

  test('a short body sheds the lower sections first and keeps the tiles and selection', async ($, on) => {
    worldOf(on, RUFLO_RUN)
    mock.clock(on)
    await $.session.start(SESSION)

    const text = textOf(await $.ui.render(paneAt(73, 8)))

    expect(text).toContain('coder')
    expect(text).not.toContain('Topology')
  })

  test('draws in theme colours only, never ANSI names that fade on a light background', async ($, on) => {
    worldOf(on, RUFLO_RUN)
    mock.clock(on)
    await $.session.start(SESSION)

    const colors = new Set(elementsOf(await $.ui.render(PANE), 'Text').flatMap(node => {
      const color = (node as { props?: { color?: string } }).props?.color

      return color === undefined ? [] : [color]
    }))

    for (const color of colors) {
      expect(['suggestion', 'success', 'error', 'warning', 'claude']).toContain(color)
    }
  })
})
