/**
 * "Start here" steps, pure: every step points at something that exists (a start, a run id, a page), the checks read the disk's
 * facts the way they say, and the pages with an order are the ones that have steps. Run with
 *   npx vitest run plugins/ruflo-console/tests/steps.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { MEM_LAB } from '../hooks/memory-lab'
import { LAB } from '../hooks/mh-lab'
import { START_LABEL } from '../hooks/starts'
import { VIEWS } from '../hooks/state'
import { STEPS } from '../hooks/views/steps'

const swarmSteps = STEPS.swarm?.steps ?? []
const snapshot = (over: object) => ({ isRufloProject: true, swarm: null, agents: [], tasks: [], claims: [], hive: null, hiveAgents: [], daemon: null, neural: null, sona: null, hasNostrKey: null, ...over }) as never

describe('start here steps', () => {
  it('every step points at a start, a run, a field or a page that exists', () => {
    const runs = new Set([...LAB.map(entry => entry.id), ...MEM_LAB.map(entry => entry.id)])
    const views = new Set(VIEWS.map(view => view.id))

    for (const [view, plan] of Object.entries(STEPS)) {
      expect(views.has(view as never), view).toBe(true)
      expect(plan?.steps.length, view).toBeGreaterThan(1)

      for (const step of plan?.steps ?? []) {
        const go = step.go

        if ('start' in go) expect(START_LABEL[go.start], `${view}: ${step.label}`).toBeDefined()
        else if ('run' in go) expect(runs.has(go.run), `${view}: ${go.run}`).toBe(true)
        else if ('view' in go) expect(views.has(go.view), `${view}: ${go.view}`).toBe(true)
        else if ('focus' in go) expect(go.focus, view).not.toBe('')
      }
    }
  })

  it('the swarm steps are done as the disk says: ruflo, a swarm, then each kind of agent', () => {
    const done = (s: object) => swarmSteps.map(step => step.done?.(snapshot(s)) ?? null)

    expect(done({ isRufloProject: false })).toEqual([false, false, false, false, false, null])
    expect(done({ swarm: { id: 's' } })).toEqual([true, true, false, false, false, null])
    expect(done({ swarm: { id: 's' }, agents: [{ type: 'coder' }, { type: 'tester' }] })).toEqual([true, true, true, true, false, null])
    expect(done({ swarm: { id: 's' }, agents: [{ type: 'coder' }, { type: 'tester' }, { type: 'reviewer' }] })).toEqual([true, true, true, true, true, null])
  })

  it('the hive steps read the proposals and the decisions, and the claims steps the tasks and the claims', () => {
    const hive = STEPS.hive?.steps ?? []
    const claims = STEPS.claims?.steps ?? []

    expect(hive.map(step => step.done?.(snapshot({ hive: { workers: [], pending: [{}], history: [] }, hiveAgents: [{}] })))).toEqual([true, true, true, true, false])
    expect(claims.map(step => step.done?.(snapshot({ tasks: [{}], claims: [] })))).toEqual([true, false])
  })

  it('has steps for the pages with an order, and none for a page with no order of its own', () => {
    expect(Object.keys(STEPS).sort()).toEqual(['claims', 'federation', 'hive', 'learning', 'memory', 'metaharness', 'overview', 'plugins', 'swarm'])
  })
})
