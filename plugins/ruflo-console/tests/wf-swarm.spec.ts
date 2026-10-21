/**
 * ruflo's runs on the Workflows page (data/wf-swarm.ts): ids a person may have saved stay stable, and a duplicated store id is one agent.
 *   npx vitest run plugins/ruflo-console/tests/wf-swarm.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { decodeSaved, pinsIn, restoreDrill } from '../hooks/data/wf-saved'
import { swarmRun } from '../hooks/data/wf-swarm'
import { allRuns, newWfUi } from '../hooks/data/workflows-nav'

const NOW = 1_791_551_000_000
const agents = [
  { id: 'agent-1-aaaaaa', type: 'coder', status: 'busy', createdAtMs: NOW - 20_000 },
  { id: 'agent-2-bbbbbb', type: 'coder', status: 'idle' },
  { id: 'agent-3-cccccc', type: 'tester', status: 'stopped' },
]
const swarm = { id: 'swarm-1', topology: 'hierarchical', status: 'running', agentIds: [] as string[] }

describe('ruflo runs on the Workflows page', () => {
  it('a drill and a pin saved on origin/main (run id "ruflo-swarm", before swarms were split from the store) still resolve', () => {
    // As origin/main wrote .claude-flow/console/wf-views.json for the no-swarm roster: id 'ruflo-swarm', name 'ruflo swarm'.
    const file = JSON.stringify({ version: 1, savedAtMs: 1, drill: { runId: 'ruflo-swarm', runName: 'ruflo swarm', phase: 'tester', agent: 'agent-3-cccccc', column: 'agents', isInspecting: true, tab: 'detail' }, filters: {}, search: '', pins: [{ runId: 'ruflo-swarm', name: 'ruflo swarm', pinnedAtMs: 1 }] })
    const { saved } = decodeSaved(file)

    for (const swarmNow of [null, { ...swarm, agentIds: ['agent-1-aaaaaa'] }]) {
      const runs = allRuns([], swarmNow, agents, NOW)
      const restored = restoreDrill(saved.drill, runs, newWfUi())
      const at = runs[restored?.ui.run ?? -1]

      expect(restored?.found, String(swarmNow)).toBe('exact')
      expect(at?.id).toBe('ruflo-swarm')
      expect(at?.phases[restored?.ui.phase ?? -1]?.title).toBe('tester')
      expect(pinsIn(saved, runs)[0]?.run?.id).toBe('ruflo-swarm')
    }
  })

  it('a duplicated store id is one agent in the roster, and the swarm run keeps "listed" apart from what was found', () => {
    const doubled = [...agents, { ...(agents[1] as (typeof agents)[number]) }]
    const run = swarmRun({ ...swarm, agentIds: ['agent-2-bbbbbb', 'agent-2-bbbbbb', 'agent-gone'], updatedAt: new Date(NOW - 60_000).toISOString() } as never, doubled, NOW)

    expect(run).toMatchObject({ total: 1, listed: 2 })
    expect(swarmRun(null, doubled, NOW)?.total).toBe(3)
  })
})
