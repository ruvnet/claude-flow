import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_RUN } from './fixtures/ruflo-run'
import { command, paneAt, SESSION } from './fixtures/inputs'
import { textOf, worldOf } from './fixtures/world'

/** A swarm of `agents` ruflo agents and as many tasks, in the shapes ruflo 3.49.0 writes. */
function swarmOf(agents: number): Record<string, string> {
  const ids = Array.from({ length: agents }, (_, i) => `agent-17908888${String(i).padStart(5, '0')}-x${i}`)
  const types = ['coder', 'tester', 'reviewer', 'architect', 'researcher']

  return {
    ...RUFLO_RUN,
    '.claude-flow/agents/store.json': JSON.stringify({
      agents: Object.fromEntries(ids.map((id, i) => [id, { agentId: id, agentType: types[i % types.length], status: i % 3 === 0 ? 'busy' : 'idle', health: 1, taskCount: 0 }])),
      version: '3.0.0',
    }),
    '.claude-flow/tasks/store.json': JSON.stringify({
      tasks: Object.fromEntries(ids.map((id, i) => [`task-${i}`, { taskId: `task-${i}`, type: 'implementation', description: `task number ${i}`, priority: 'normal', status: i % 4 === 0 ? 'completed' : 'pending', assignedTo: [id], tags: [] }])),
      version: '3.0.0',
    }),
  }
}

/** The kit's environment prints with `console`; the declarations name no DOM, so it is declared here. */
declare const console: { log: (...values: unknown[]) => void }

const quantile = (sorted: readonly number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0

/**
 * What a render and a re-read of the disk cost with 8, 32 and 100 agents, through the engine's own `$`: the numbers
 * print, and a bound fails the test if a change makes a render slow enough to be felt (the engine gives a dispatch 10 s).
 */
describe('views', () => {
  for (const agents of [8, 32, 100]) {
    test(`render and refresh with ${agents} agents`, { timeoutMs: 30_000 }, async ($, on) => {
      worldOf(on, swarmOf(agents))
      mock.clock(on)
      await $.session.start(SESSION)

      const renders: number[] = []
      const narrow: number[] = []
      const refreshes: number[] = []

      for (let i = 0; i < 60; i += 1) {
        let started = performance.now()

        await $.ui.render(paneAt(120, 60))
        renders.push(performance.now() - started)

        started = performance.now()
        await $.ui.render(paneAt(30, 30))
        narrow.push(performance.now() - started)

        // The status command re-reads every file (mtime-cached) before it answers: one refresh.
        started = performance.now()
        await $.command.run(command('ruflo-swarm-status'))
        refreshes.push(performance.now() - started)
      }

      const report = (name: string, samples: number[]) => {
        const sorted = [...samples].sort((a, b) => a - b)

        return `${name} median ${quantile(sorted, 0.5).toFixed(2)} ms p95 ${quantile(sorted, 0.95).toFixed(2)} ms`
      }

      console.log(`[bench] ${agents} agents: ${report('render', renders)} · ${report('narrow', narrow)} · ${report('refresh', refreshes)}`)

      const tree = await $.ui.render(paneAt(120, 60))

      expect(textOf(tree)).toMatch(agents > 36 ? /\+\d+ more agents/ : /coder/)
      expect(quantile([...renders].sort((a, b) => a - b), 0.95)).toBeLessThan(250)
    })
  }
})
