/**
 * Search across the drill-down's levels as the person uses it (ADR-459): one field, hits by level, a click or Enter goes to the exact place, and what was not in memory is counted, not guessed.
 * Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-drill-search.spec.ts --testTimeout=30000
 */
import { describe, expect, it } from 'vitest'

import { bindWorkflowDrill } from '../hooks/wf-drill'
import { drillOf } from '../hooks/views/wf-detail'
import { record } from './fixtures/workflows'
import { buttonOf, click, flush, frame, inputOf, liveFiles, press, ROOT, screen, SESSION, useDrill, words, worldOf } from './fixtures/wf-drill-world'

useDrill()


describe('search', () => {
  it('lists hits by level and a click goes to the exact call', async () => {
    const world = await worldOf(liveFiles())

    ;(inputOf(frame(world).tree)?.props.onInput as (v: string) => void)('ls -la')

    const tree = frame(world).tree

    expect(words(tree)).toMatch(/Tool calls \(1\)/)
    expect(words(tree)).toMatch(/looked through 2 agents' transcripts/)

    click(tree, 'wf-hit-tool-0')
    expect(world.state.wf.ui).toMatchObject({ run: 0, phase: 0, agent: 0, isInspecting: false })
    expect(drillOf(world.state)).toMatchObject({ open: true, level: 'agent', sub: 'activity', callSel: 0 })
    expect(screen(world)).toMatch(/call 1 of 4/)
  })

  it('goes to the exact line of transcript text, in the Log, on another agent', async () => {
    const world = await worldOf(liveFiles())

    ;(inputOf(frame(world).tree)?.props.onInput as (v: string) => void)('review the parser')
    click(frame(world).tree, 'wf-hit-text-0')
    expect(world.state.wf.ui).toMatchObject({ phase: 1, agent: 0 })
    expect(drillOf(world.state)).toMatchObject({ level: 'agent', sub: 'log', logSel: 0 })
    expect(screen(world)).toMatch(/▸01:30:00\s*\nuser\s*\nreview the parser/)
  })

  it('jumps to the first hit with a place when Enter is pressed in the field', async () => {
    const world = await worldOf(liveFiles())

    ;(inputOf(frame(world).tree)?.props.onSubmit as (v: string) => void)('boom')
    expect(drillOf(world.state)).toMatchObject({ level: 'agent', sub: 'log', logSel: 3 })
  })

  it('says it needs two characters, and says when nothing matches', async () => {
    const world = await worldOf(liveFiles())
    const type = (v: string): void => void (inputOf(frame(world).tree)?.props.onInput as (v: string) => void)(v)

    type('x')
    expect(screen(world)).toMatch(/at least 2 characters/)
    type('zzzzqqq')
    expect(screen(world)).toMatch(/No match for "zzzzqqq"/)
  })

  it('counts transcripts not in memory instead of guessing, and offers to read them only when bound', async () => {
    const world = await worldOf(liveFiles({ [`${ROOT}/${SESSION}/workflows/wf_live.json`]: record({ workflowProgress: [{ type: 'workflow_agent', label: 'build:x', phaseTitle: 'Build', agentId: 'a1', state: 'done', durationMs: 1 }] }) }))
    const type = (v: string): void => void (inputOf(frame(world).tree)?.props.onInput as (v: string) => void)(v)

    type('Bash')
    expect(screen(world)).toMatch(/2 agents' transcripts are not in memory, so they were not searched/)
    expect(buttonOf(frame(world).tree, 'wf-search-load')).toBeUndefined()

    bindWorkflowDrill(world.state, world.host as never)
    expect(buttonOf(frame(world).tree, 'wf-search-load')).toBeDefined()
    click(frame(world).tree, 'wf-search-load')
    await flush()
    await flush()
    expect(screen(world)).toMatch(/Tool calls \(1\)/)
  })

  it('lists mission tasks when the project has them, and sends the click to the Missions page', async () => {
    const world = await worldOf(liveFiles())

    world.state.snapshot = { missions: { missions: [{ objective: 'ship it', plan: { tasks: [{ id: 'T1', title: 'verify the ls output', status: 'running', dependsOn: [] }] } }] } } as never
    ;(inputOf(frame(world).tree)?.props.onInput as (v: string) => void)('verify the ls')
    expect(screen(world)).toMatch(/Mission tasks \(1\)/)
    click(frame(world).tree, 'wf-hit-mission-0')
    expect(world.spied.views).toEqual(['missions'])
  })

  it('the search key puts the keys in the field', async () => {
    const world = await worldOf(liveFiles())

    press(world, 'search')
    expect(world.spied.focused).toEqual(['wf-search'])
  })
})
