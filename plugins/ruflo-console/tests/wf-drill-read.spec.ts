/**
 * What the drill-down reads, and refuses to read or run (ADR-459): Files and Result on demand through a bound host, a finished run's transcripts, the tail of a large one, path checks, and the printed caps.
 * Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-drill-read.spec.ts --testTimeout=30000
 */
import { describe, expect, it } from 'vitest'

import { diffArgv, isProjectDir, isRunFile, parseNumstat } from '../hooks/data/wf-drill-io'
import { bindWorkflowDrill } from '../hooks/wf-drill'
import { drillOf } from '../hooks/views/wf-detail'
import { back, line, sample, SECRET, use } from './fixtures/wf-drill'
import { journal, meta, record, result, started, T0 } from './fixtures/workflows'
import { buttonOf, click, CONFIG, flush, frame, liveFiles, press, RUN, ROOT, screen, SESSION, toAgent, useDrill, words, worldOf, WT } from './fixtures/wf-drill-world'

useDrill()


describe('Files and Result', () => {
  it('lists the files the tool inputs name even with no worktree reading, with the diff stat honestly n/a', async () => {
    const world = await worldOf(liveFiles())

    toAgent(world)
    click(frame(world).tree, 'wf-sub-files')

    const text = screen(world)

    expect(text).toMatch(/a\.ts/)
    expect(text).toMatch(/edit×1/)
    expect(text).toMatch(/diff stat: n\/a \(host not bound\)/)
  })

  it('reads the worktree diff stat through one fixed argv when bound, and joins it to the named files', async () => {
    const world = await worldOf(liveFiles(), {}, async () => ({ exitCode: 0, stdout: '3\t1\ta.ts\n-\t-\timg.png\nnot a numstat line\n' }))

    bindWorkflowDrill(world.state, world.host as never)
    toAgent(world)
    click(frame(world).tree, 'wf-sub-files')
    await flush()

    expect(world.spied.runs).toEqual([diffArgv(WT)])
    expect(world.spied.runs[0]).toEqual(['git', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', WT, 'diff', '--numstat', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', 'HEAD', '--'])

    const text = screen(world)

    expect(text).toMatch(/2 changed files vs HEAD/)
    expect(text).toMatch(/\+3/)
    expect(text).toMatch(/-1/)
    expect(text).toMatch(/also changed in the worktree.*img\.png/)
  })

  it('shows a path with a long hash segment unmasked and joins it to the diff stat line of the same path', async () => {
    const hash = 'a'.repeat(40)
    const path = `${WT}/node_modules/.pnpm/pkg@1.2.3_${hash}/index.ts`
    const text = [line('assistant', 1, [use('t1', 'Edit', { file_path: path, old_string: 'a', new_string: 'b' })]), line('user', 2, [back('t1', 'ok')])].join('\n')
    const world = await worldOf(liveFiles({ [`${RUN}/agent-a1.jsonl`]: text }), {}, async () => ({ exitCode: 0, stdout: `5\t2\tnode_modules/.pnpm/pkg@1.2.3_${hash}/index.ts\n` }))

    bindWorkflowDrill(world.state, world.host as never)
    toAgent(world)
    click(frame(world).tree, 'wf-sub-files')
    await flush()

    const shown = words(frame(world, 160).tree)

    expect(shown).toContain(hash)
    expect(shown).not.toMatch(/‹masked›/)
    expect(shown).toMatch(/\+5/)
    expect(shown).toMatch(/-2/)
    expect(shown).not.toMatch(/also changed in the worktree/)
  })

  it('does not run git for a worktree outside the project, and says so', async () => {
    const world = await worldOf(liveFiles({ [`${RUN}/agent-a1.meta.json`]: meta('build:x', 'Build', { spawnedWithWorktree: true, worktreePath: '/etc' }) }))

    bindWorkflowDrill(world.state, world.host as never)
    toAgent(world)
    click(frame(world).tree, 'wf-sub-files')
    await flush()
    click(frame(world).tree, 'wf-diff-load')
    await flush()

    expect(world.spied.runs).toEqual([])
    expect(screen(world)).toMatch(/not inside this project's folder/)
  })

  it('reads the agent\'s structured return from the journal on demand, washed, and says where there is none', async () => {
    const world = await worldOf(liveFiles({ [`${RUN}/journal.jsonl`]: journal(started('a1', 'build:x', 'Build'), started('a2', 'review:x', 'Review'), result('a1', { verdict: 'pass', note: SECRET })) }))

    bindWorkflowDrill(world.state, world.host as never)
    world.state.wf.ui = { ...world.state.wf.ui, phase: 0 }
    toAgent(world)
    press(world, 'sub')
    press(world, 'sub')
    press(world, 'sub')
    expect(drillOf(world.state).sub).toBe('result')
    await flush()

    const text = screen(world)

    expect(text).toMatch(/"verdict": "pass"/)
    expect(text).not.toContain(SECRET)
    expect(text).toMatch(/characters/)
  })

  it('without the host binding, says reading the journal needs it instead of a dead button', async () => {
    const world = await worldOf(liveFiles())

    toAgent(world)
    press(world, 'sub')
    press(world, 'sub')
    press(world, 'sub')

    const tree = frame(world).tree

    expect(buttonOf(tree, 'wf-result-load')).toBeUndefined()
    expect(words(tree)).toMatch(/needs the drill bound to the host/)
  })
})
describe('a finished run', () => {
  const finished = (): Record<string, string> => liveFiles({ [`${ROOT}/${SESSION}/workflows/wf_live.json`]: record({ workflowProgress: [{ type: 'workflow_agent', label: 'build:x', phaseTitle: 'Build', agentId: 'a1', state: 'done', startedAt: T0, tokens: 1000, durationMs: 9000 }, { type: 'workflow_agent', label: 'review:x', phaseTitle: 'Review', agentId: 'a2', state: 'done', startedAt: T0, tokens: 500, durationMs: 4000 }] }) })

  it('has no transcript in memory (the page reads figures from the record): says why, and offers no button it cannot honour', async () => {
    const world = await worldOf(finished())

    toAgent(world)

    const tree = frame(world).tree
    const text = words(tree)

    expect(text).toMatch(/This agent's transcript is not in memory/)
    expect(text).toMatch(/a finished run's figures come from its record/)
    expect(buttonOf(tree, 'wf-drill-load')).toBeUndefined()
  })

  it('reads it on demand once the host is bound, and draws the calls', async () => {
    const world = await worldOf(finished())

    bindWorkflowDrill(world.state, world.host as never)
    toAgent(world)
    await flush()

    expect(screen(world)).toMatch(/Bash\s+ls -la/)
  })

  it('reads only the tail of a transcript over the read cap, and says the earlier calls are not there', async () => {
    const path = `${RUN}/agent-a1.jsonl`
    const world = await worldOf(finished(), { size: { [path]: 4_000_000 }, tail: `{"cut half line\n${sample(WT)}` })

    bindWorkflowDrill(world.state, world.host as never)
    toAgent(world)
    await flush()

    const text = screen(world)

    expect(text).toMatch(/the last 400 KB of a file over the 3\.0 MB read cap/)
    expect(text).toMatch(/earlier calls are not here/)
    expect(text).toMatch(/Bash\s+ls -la/)
  })

  it('refuses a path outside Claude Code\'s projects folder, without reading it', async () => {
    const world = await worldOf(finished())
    const fs = world.host.fs as unknown as { reads: string[] }

    bindWorkflowDrill(world.state, world.host as never)

    const agent = world.state.wf.read?.runs[0]?.phases[0]?.agents[0]

    if (agent === undefined) throw new Error('no agent')

    const { loadTranscript } = await import('../hooks/data/wf-drill-io')

    for (const bad of ['/etc/passwd', `${CONFIG}/projects/../../etc/agent-a1.jsonl`, `${CONFIG}/projects/x/agent-a1.jsonl\0`, `${CONFIG}/projects/p/notes.txt`]) {
      fs.reads.length = 0
      await loadTranscript({ ...agent, transcriptPath: bad })
      expect(fs.reads).toEqual([])
    }
  })
})

describe('what the drill refuses to read or run', () => {
  it('knows a run file from a stray path, and a project folder from another', () => {
    expect(isRunFile(`${CONFIG}/projects/p/s/agent-a1.jsonl`, CONFIG)).toBe(true)
    expect(isRunFile(`${CONFIG}/projects/../x`, CONFIG)).toBe(false)
    expect(isRunFile(`${CONFIG}/other/x`, CONFIG)).toBe(false)
    expect(isRunFile(`${CONFIG}/projects/x`, null)).toBe(false)
    expect(isProjectDir('/work/proj/.claude/worktrees/a', '/work/proj')).toBe(true)
    expect(isProjectDir('/work/proj', '/work/proj')).toBe(true)
    expect(isProjectDir('/work/projother', '/work/proj')).toBe(false)
    expect(isProjectDir('/work/proj/../etc', '/work/proj')).toBe(false)
    expect(isProjectDir('relative', '/work/proj')).toBe(false)
  })

  it('reads numstat lines and ignores anything else', () => {
    const out = parseNumstat('12\t3\tsrc/a.ts\n-\t-\tlogo.png\nwarning: nope\n')

    expect([...out.files]).toEqual([['src/a.ts', { add: 12, del: 3 }], ['logo.png', { add: null, del: null }]])
  })
})

describe('caps are printed', () => {
  it('says how many of how many characters an over-long output shows', async () => {
    const big = 'ab '.repeat(2400)
    const text = [line('assistant', 1, [use('t1', 'Bash', { command: 'cat big' })]), line('user', 2, [back('t1', big)])].join('\n')
    const world = await worldOf(liveFiles({ [`${RUN}/agent-a1.jsonl`]: text }))

    toAgent(world)
    press(world, 'in')

    expect(screen(world)).toMatch(/first 6,000 of 7,200 characters \(cap 6,000\)/)
  })
})

