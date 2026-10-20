/**
 * Mission task <-> agent links, and the run events that announce what changed (ADR-460). Links come only from data the records carry
 * (a ruflo task's tags and assignment, a label's leading tag); anything else is "unlinked" with the reason. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-links.spec.ts --testTimeout=30000
 */
import { describe, expect, it } from 'vitest'

import type { MissionRecord } from '../hooks/mission-types'
import { applyMissionEvents, eventsBetween } from '../hooks/data/wf-events'
import { agentLinkLine, isOpen, labelTag, linkAgents, readLabelTag, refsOf, taskLinkLine, type MissionTaskRef } from '../hooks/data/wf-links'
import type { AgentRecord, TaskRecord } from '../hooks/data/parse'
import { STALE_MS, type AgentState, type RunState, type WfAgent, type WfRun } from '../hooks/data/workflows'

const flowAgent = (id: string, label: string, state: AgentState = 'running'): WfAgent => ({ id, label, phase: 'Build', state, hasWorktree: false })
const rufloAgent = (id: string): WfAgent => ({ id, label: id, phase: 'coder', state: 'running', hasWorktree: false, ruflo: { id, type: 'coder', status: 'busy' } as AgentRecord })

function run(id: string, agents: WfAgent[], over: Partial<WfRun> = {}): WfRun {
  return { id, name: `wf ${id}`, kind: 'workflow', state: 'running', phases: [{ title: 'Build', agents, done: 0, total: agents.length, running: 0, failed: 0 }], running: 0, done: 0, failed: 0, idle: 0, total: agents.length, totalTokens: null, isTokensPartial: false, hasRecord: false, ...over }
}

const task = (id: string, assignedTo: string[], tags: string[] | undefined, status = 'in_progress', over: Partial<TaskRecord> = {}): TaskRecord => ({ id, type: 'feature', description: `desc of ${id}`, status, assignedTo, ...(tags !== undefined && { tags }), ...over })
const REFS: MissionTaskRef[] = [{ missionId: 'm1', taskId: 'implement', title: 'Implement it', rufloTaskId: 'task-9' }, { missionId: 'm1', taskId: 'review', title: 'Review it' }]

describe('links', () => {
  it('a task stored under an older CLI spelling is finished, not open', () => {
    expect(['complete', 'Done ', 'canceled', 'completed', 'failed', 'cancelled'].map(isOpen)).toEqual([false, false, false, false, false, false])
    expect([undefined, 'pending', 'running', 'in-progress', 'in_progress'].map(isOpen)).toEqual([true, true, true, true, true])
  })


  it('links a ruflo agent through the ruflo task assigned to it, by the mission:/task: tags', () => {
    const index = linkAgents(REFS, [run('swarm', [rufloAgent('agent-1')], { kind: 'ruflo-swarm' })], [task('task-7', ['agent-1'], ['mission:m1', 'task:review', 'phase:X'])])

    expect(index.links).toHaveLength(1)
    expect(index.links[0]).toMatchObject({ missionId: 'm1', taskId: 'review', title: 'Review it', via: 'ruflo-task', taskStatus: 'in_progress', isKnown: true })
    expect(agentLinkLine(index, 'swarm', 'agent-1')).toBe('m1 / review: Review it (in_progress)')
    expect(taskLinkLine(index, REFS[1] as MissionTaskRef)).toBe('agent-1 (ruflo task)')
  })

  it('links by the ledger\'s rufloTaskId when the task has no tags, and shows open tasks before finished ones', () => {
    const tasks = [task('task-9', ['agent-1'], undefined, 'completed'), task('task-7', ['agent-1'], ['mission:m1', 'task:review'], 'in_progress')]
    const index = linkAgents(REFS, [run('swarm', [rufloAgent('agent-1')], { kind: 'ruflo-swarm' })], tasks)

    expect(index.links.map(link => `${link.taskId}:${link.taskStatus}`)).toEqual(['review:in_progress', 'implement:completed'])
    expect(agentLinkLine(index, 'swarm', 'agent-1')).toMatch(/\+1 more$/)
  })

  it('says a mission task the console does not hold is not in its ledger, rather than dropping it', () => {
    const index = linkAgents([], [run('swarm', [rufloAgent('agent-1')], { kind: 'ruflo-swarm' })], [task('task-7', ['agent-1'], ['mission:other', 'task:t1'])])

    expect(index.links[0]).toMatchObject({ missionId: 'other', taskId: 't1', isKnown: false, title: 'desc of task-7' })
    expect(agentLinkLine(index, 'swarm', 'agent-1')).toMatch(/not in this console's mission ledger/)
  })

  it('links a workflow agent by the tag its label starts with', () => {
    const tag = labelTag('m1', 'implement') as string
    const index = linkAgents(REFS, [run('r1', [flowAgent('a1', `${tag} Implement it`)])], [])

    expect(index.links[0]).toMatchObject({ missionId: 'm1', taskId: 'implement', via: 'label-tag', title: 'Implement it', isKnown: true })
  })

  it('leaves an agent unlinked, with the reason, when nothing the data carries names a task: no fuzzy match on a similar word', () => {
    const index = linkAgents(REFS, [run('r1', [flowAgent('a1', 'implement it please'), flowAgent('a2', 'task:implement'), flowAgent('a3', '[mission:m1 task] broken')]), run('swarm', [rufloAgent('agent-2')], { kind: 'ruflo-swarm' })], [task('task-7', ['agent-1'], ['mission:m1', 'task:review'])])

    expect(index.links).toEqual([])
    expect(index.unlinked.map(entry => entry.agentId)).toEqual(['a1', 'a2', 'a3', 'agent-2'])
    expect(index.unlinked.find(entry => entry.agentId === 'a3')?.why).toMatch(/not \[mission:<id> task:<id>\]/)
    expect(index.unlinked.find(entry => entry.agentId === 'a1')?.why).toMatch(/no \[mission:<id> task:<id>\] tag/)
    expect(index.unlinked.find(entry => entry.agentId === 'agent-2')?.why).toMatch(/no ruflo task/)
    expect(agentLinkLine(index, 'r1', 'a1')).toMatch(/^unlinked: /)
  })

  it('a task nobody names reads unlinked, and the same ids on a run switch do not collide', () => {
    const index = linkAgents(REFS, [run('r1', [flowAgent('a1', `${labelTag('m1', 'implement')} x`)]), run('r2', [flowAgent('a1', 'plain')])], [])

    expect(taskLinkLine(index, REFS[1] as MissionTaskRef)).toMatch(/^unlinked/)
    expect(agentLinkLine(index, 'r1', 'a1')).toMatch(/^m1 \/ implement/)
    expect(agentLinkLine(index, 'r2', 'a1')).toMatch(/^unlinked/)
  })

  it('reads a tag back only when its ids survive; an id with a space cannot be tagged', () => {
    expect(labelTag('m 1', 't')).toBeNull()
    expect(readLabelTag('[mission:m1 task:t1] title')).toEqual({ missionId: 'm1', taskId: 't1', rest: 'title' })
    expect(readLabelTag('plain')).toBeNull()
    expect(readLabelTag('[mission:m1 task:]')).toEqual({ malformed: true })
  })

  it('merges the ledger and the observation, the ledger\'s entry winning', () => {
    const ledger = [{ id: 'm1', tasks: [{ id: 't1', title: 'from ledger', rufloTaskId: 'task-1' }] }] as unknown as MissionRecord[]
    const observed = [{ id: 'm1', plan: { tasks: [{ id: 't1', title: 'from observation' }, { id: 't2', title: 'only observed' }] } }] as never

    const refs = refsOf(ledger, observed)

    expect(refs.map(ref => `${ref.taskId}:${ref.title}`)).toEqual(['t1:from ledger', 't2:only observed'])
  })
})

describe('run events', () => {
  const tag = labelTag('m1', 'implement') as string
  const before = (state: AgentState) => [run('wf_run1234567', [flowAgent('agent-aaaaaaaa', `${tag} Implement it`, state), flowAgent('agent-bbbbbbbb', 'plain', state)])]

  it('announces nothing on the first read', () => {
    expect(eventsBetween(null, before('failed'))).toEqual({ notices: [], mission: [] })
  })

  it('announces an agent that newly failed, once, and nothing when it stays failed', () => {
    const changes = eventsBetween(before('running'), before('failed'))

    expect(changes.notices.map(notice => notice.level)).toEqual(['bad', 'bad'])
    expect(changes.notices[0]?.text).toMatch(/failed: Implement it \(mission m1, task implement\)/)
    expect(changes.notices[1]?.text).toMatch(/failed: plain in wf wf_run1234567/)
    expect(changes.mission).toHaveLength(1)
    expect(eventsBetween(before('failed'), before('failed'))).toEqual({ notices: [], mission: [] })
  })

  it('announces a stuck agent with the stale window, and a run newly stalled, but not one already stalled', () => {
    const stuck = eventsBetween(before('running'), before('stale'))

    expect(stuck.notices[0]).toMatchObject({ level: 'warn' })
    expect(stuck.notices[0]?.text).toContain(`${STALE_MS / 60_000} min quiet`)

    const stalled = (state: RunState) => [run('wf_run1234567', [], { state })]

    expect(eventsBetween(stalled('running'), stalled('stalled')).notices[0]?.text).toMatch(/looks stuck: nothing written for 15 min/)
    expect(eventsBetween(stalled('stalled'), stalled('stalled')).notices).toEqual([])
    expect(eventsBetween(null, stalled('stalled')).notices).toEqual([])
  })

  it('announces a finished agent only when a mission tagged it (the page already announces a run)', () => {
    const changes = eventsBetween(before('running'), before('done'))

    expect(changes.notices).toHaveLength(1)
    expect(changes.notices[0]).toMatchObject({ level: 'ok' })
    expect(changes.mission[0]).toMatchObject({ missionId: 'm1', taskId: 'implement', kind: 'agent-done' })
  })

  it('keys are short enough to survive the page\'s 40-character cut, and differ per agent and kind', () => {
    const keys = [...eventsBetween(before('running'), before('failed')).notices, ...eventsBetween(before('running'), before('stale')).notices].map(notice => notice.key)

    expect(keys.every(key => key.length <= 40)).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('washes a credential and a control character out of what it announces', () => {
    const dirty = [run('wf_run1234567', [flowAgent('a1', 'sk-ABCDEFGHIJKLMNOPQRSTUVWX12345 \u001b[31mred')], { name: 'n\u0007ame' })]
    const text = eventsBetween([run('wf_run1234567', [flowAgent('a1', 'x', 'running')], { name: 'n' })], [{ ...dirty[0], phases: [{ ...(dirty[0] as WfRun).phases[0], agents: [flowAgent('a1', 'sk-ABCDEFGHIJKLMNOPQRSTUVWX12345 \u001b[31mred', 'failed')] }] } as WfRun]).notices[0]?.text ?? ''

    expect(text).toContain('‹masked›')
    expect(text).not.toContain('sk-ABCDEF')
    expect(text).not.toContain('\u001b')
  })
})

describe('applyMissionEvents', () => {
  const ledger = (): Map<string, MissionRecord> => new Map([['m1', { id: 'm1', tasks: [{ id: 'implement' }], events: [] } as unknown as MissionRecord]])
  const event = { missionId: 'm1', taskId: 'implement', kind: 'agent-failed' as const, note: 'workflow agent failed: x', key: 'a-1-f' }

  it('records an event once, for a mission and task the ledger holds', () => {
    const missions = ledger()

    expect(applyMissionEvents(missions, [event, event], 1000)).toBe(1)
    expect(applyMissionEvents(missions, [event], 2000)).toBe(0)
    expect(missions.get('m1')?.events).toEqual([{ seq: 1, atMs: 1000, type: 'workflow', taskId: 'implement', status: 'agent-failed', evidenceRef: 'a-1-f', note: 'workflow agent failed: x' }])
  })

  it('ignores an unknown mission or task, and masks a credential in the note', () => {
    const missions = ledger()

    expect(applyMissionEvents(missions, [{ ...event, missionId: 'nope' }, { ...event, taskId: 'nope', key: 'k2' }], 1)).toBe(0)
    applyMissionEvents(missions, [{ ...event, key: 'k3', note: 'token=abcdefghijklmnop' }], 1)
    expect(missions.get('m1')?.events[0]?.note).toContain('‹masked›')
  })
})
