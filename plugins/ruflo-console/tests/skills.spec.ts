/**
 * The skills view's pure parts under vitest: reading `skills find` text and `skills ls --json`, the argv each action
 * runs, what the search and name fields refuse, and a change run end to end on a fake Host (asked, confirmed, run, the
 * lists read again, the outcome checked against them). Nothing here runs the real CLI.
 */
import { describe, expect, it } from 'vitest'

import { addArgv, findArgv, initArgv, listArgv, newNameOf, parseFind, parseInstalled, removeArgv, skillIdOf, skillNameOf, typedOf, updateArgv } from '../hooks/data/skills'
import type { Host } from '../hooks/host'
import { createRunner } from '../hooks/runner'
import { addSpec, editPrompt, findSkills, initSpec, listSkills, removeSpec, skillActions } from '../hooks/skills'
import { newState } from '../hooks/state'
import { FIND_OUT, LS_GLOBAL } from './fixtures/skills'

describe('reading the skills CLI', () => {
  it('find: each result line with its install count and url, colour gone; the header and blanks are passed over', () => {
    expect(parseFind(FIND_OUT)).toEqual([
      { id: 'mattpocock/skills@tdd', installs: '1M', url: 'https://skills.sh/mattpocock/skills/tdd' },
      { id: 'vercel-labs/agent-skills@vercel-react-best-practices', installs: '764.8K', url: 'https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices' },
      { id: 'open.feishu.cn@lark-event', installs: '740.2K', url: 'https://skills.sh/open.feishu.cn/lark-event' },
      { id: 'someone/repo@fresh', url: 'https://skills.sh/someone/repo/fresh' },
    ])
  })

  it('find: nothing found, an error, or an id that could be read as a flag gives no results', () => {
    expect(parseFind('\u001b[38;5;102mNo skills found for "zzz"\u001b[0m\n')).toEqual([])
    expect(parseFind('-g/x@y 3 installs\n../x@y\nowner/repo@sk;rm 1 install\n')).toEqual([])
    expect(parseFind('')).toEqual([])
  })

  it('ls --json: name, path, scope and agents; an empty list is empty, an object or text is unreadable', () => {
    expect(parseInstalled(LS_GLOBAL, 'global')).toEqual([
      { name: 'faceless-explainer', path: '/home/dev/.agents/skills/faceless-explainer', scope: 'global', agents: ['Claude Code', 'Codex'], source: 'heygen-com/hyperframes' },
      { name: 'tdd', path: '/home/dev/.agents/skills/tdd', scope: 'global', agents: [] },
    ])
    expect(parseInstalled('[]\n', 'project')).toEqual([])
    expect(parseInstalled('{"success": true}', 'project')).toBeNull()
    expect(parseInstalled('No project skills found.', 'project')).toBeNull()
    // A record without a name or a path is left out; an unknown scope takes the list's own.
    expect(parseInstalled(JSON.stringify([{ name: 'a' }, { path: '/b' }, { name: 'c', path: '/c', scope: 'elsewhere', agents: 'x' }]), 'project')).toEqual([{ name: 'c', path: '/c', scope: 'project', agents: [] }])
  })
})

describe('argv and validation', () => {
  it('every action is a fixed npx -y skills argv, its scope named', () => {
    expect(listArgv('project')).toEqual(['npx', '-y', 'skills', 'ls', '--json'])
    expect(listArgv('global')).toEqual(['npx', '-y', 'skills', 'ls', '-g', '--json'])
    expect(addArgv('vercel-labs/skills@find-skills', 'project')).toEqual(['npx', '-y', 'skills', 'add', 'vercel-labs/skills@find-skills', '-y'])
    expect(addArgv('vercel-labs/skills@find-skills', 'global')).toEqual(['npx', '-y', 'skills', 'add', 'vercel-labs/skills@find-skills', '-g', '-y'])
    expect(removeArgv('tdd', 'global')).toEqual(['npx', '-y', 'skills', 'remove', 'tdd', '-g', '-y'])
    expect(updateArgv('tdd', 'project')).toEqual(['npx', '-y', 'skills', 'update', 'tdd', '-p', '-y'])
    expect(updateArgv('tdd', 'global')).toEqual(['npx', '-y', 'skills', 'update', 'tdd', '-g', '-y'])
    expect(initArgv('my-skill')).toEqual(['npx', '-y', 'skills', 'init', 'my-skill'])
  })

  it('search: the text is one argv element; owner:<name> becomes --owner; flags, odd characters and long text are refused', () => {
    expect(findArgv('  react hooks ')).toEqual(['npx', '-y', 'skills', 'find', 'react hooks'])
    expect(findArgv('owner:vercel-labs deploy')).toEqual(['npx', '-y', 'skills', 'find', 'deploy', '--owner', 'vercel-labs'])
    expect(findArgv('-g')).toBeNull()
    expect(findArgv('--owner x')).toBeNull()
    expect(findArgv('react; rm -rf ~')).toBeNull()
    expect(findArgv('$(whoami)')).toBeNull()
    expect(findArgv('a'.repeat(513))).toBeNull()
    expect(findArgv('owner:-x react')).toBeNull()
    expect(findArgv('owner:a owner:b react')).toBeNull()
    expect(findArgv('owner:vercel-labs')).toBeNull()
    expect(findArgv('')).toBeNull()
  })

  it('typed text keeps to [A-Za-z0-9@/._ -], no leading -, within its cap', () => {
    expect(typedOf(' a/b@c_d.e f-g ')).toBe('a/b@c_d.e f-g')
    expect(typedOf('-a')).toBeNull()
    expect(typedOf('a\u001b[31m')).toBeNull()
    expect(typedOf('a\nb')).toBeNull()
    expect(typedOf('x'.repeat(10), 9)).toBeNull()
  })

  it('a new skill name cannot leave the project: no slash, no leading dot or dash', () => {
    expect(newNameOf('my-skill')).toBe('my-skill')
    expect(newNameOf('My.Skill_2')).toBe('My.Skill_2')
    expect(newNameOf('../x')).toBeNull()
    expect(newNameOf('a/b')).toBeNull()
    expect(newNameOf('.hidden')).toBeNull()
    expect(newNameOf('-y')).toBeNull()
    expect(newNameOf('two words')).toBeNull()
    expect(newNameOf('x'.repeat(65))).toBeNull()
  })

  it('ids and names from the CLI pass only in their own shape', () => {
    expect(skillIdOf('owner/repo@skill')).toBe('owner/repo@skill')
    expect(skillIdOf('open.feishu.cn@lark-event')).toBe('open.feishu.cn@lark-event')
    expect(skillIdOf('owner/repo')).toBeNull()
    expect(skillIdOf('-g@x')).toBeNull()
    expect(skillIdOf('a@b c')).toBeNull()
    expect(skillNameOf('tdd')).toBe('tdd')
    expect(skillNameOf('-g')).toBeNull()
    expect(skillNameOf('a b')).toBeNull()
  })
})

/** A Host whose `run` answers by argv and records each call; a Runner over it with nothing else wired. */
function fake(answer: (argv: readonly string[]) => { exitCode: number; stdout: string; stderr: string }) {
  const runs: string[][] = []
  const host = {
    run: async (argv: readonly string[]) => {
      runs.push([...argv])

      return { ...answer(argv), isStdoutTruncated: false, isStderrTruncated: false }
    },
    invalidate: () => undefined,
  } as unknown as Host
  const state = newState({})
  const runner = createRunner(state, host, { freshRead: async () => undefined, setView: () => undefined, drill: () => undefined, command: () => undefined })

  return { host, state, runner, runs }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 5))

describe('the skills actions', () => {
  it('listing asks both scopes; a failing one says why and does not blank the other', async () => {
    const { host, state, runs } = fake(argv => (argv.includes('-g') ? { exitCode: 0, stdout: LS_GLOBAL, stderr: '' } : { exitCode: 1, stdout: '', stderr: 'boom\n' }))

    await listSkills(state, host)

    expect(runs).toEqual([listArgv('project'), listArgv('global')])
    expect(state.skills.installed?.map(skill => skill.name)).toEqual(['faceless-explainer', 'tdd'])
    expect(state.skills.listErrors).toEqual({ project: 'exit 1: boom' })
  })

  it('a search runs find with the typed text and lists what came back; bad text runs nothing', async () => {
    const { host, state, runs } = fake(() => ({ exitCode: 0, stdout: FIND_OUT, stderr: '' }))

    expect(findSkills(state, host, '--help')).toMatch(/not starting with -/)
    expect(runs).toEqual([])
    expect(findSkills(state, host, 'react')).toBeNull()
    await settle()
    expect(runs).toEqual([['npx', '-y', 'skills', 'find', 'react']])
    expect(state.skills.found?.length).toBe(4)
  })

  it('add is asked with its exact argv, runs only on confirm, then reads the lists to say whether it took', async () => {
    let isAdded = false
    const { host, state, runner, runs } = fake(argv => {
      if (argv[3] === 'add') isAdded = true

      return argv[3] === 'ls' ? { exitCode: 0, stdout: argv.includes('-g') ? '[]' : JSON.stringify(isAdded ? [{ name: 'tdd', path: '/work/.agents/skills/tdd', scope: 'project', agents: ['Claude Code'] }] : []), stderr: '' } : { exitCode: 0, stdout: 'Installed tdd\n', stderr: '' }
    })
    // Listed lowercase, as the CLI installs it: the check still finds it.
    const spec = addSpec(state, host, { id: 'mattpocock/skills@TDD' }, 'project')

    runner.ask(spec, '')
    expect(state.pending?.shows).toBe('npx -y skills add mattpocock/skills@TDD -y')
    expect(runs).toEqual([])

    await runner.confirm()
    for (let i = 0; i < 20 && state.skills.busy !== null; i++) await settle()
    await settle()

    expect(runs[0]).toEqual(['npx', '-y', 'skills', 'add', 'mattpocock/skills@TDD', '-y'])
    expect(runs.slice(1).map(argv => argv[3])).toEqual(['ls', 'ls'])
    expect(state.outcome).toMatchObject({ label: 'add skill mattpocock/skills@TDD to this project', ok: true, verified: 'yes' })
    expect(state.skills.last?.label).toBe(state.outcome?.label)
  })

  it('remove and create refuse what they cannot pass; create asks once, Enter again on the name confirms', async () => {
    const { host, state, runner, runs } = fake(() => ({ exitCode: 0, stdout: '[]', stderr: '' }))
    const loaded: string[] = []
    const act = skillActions(state, host, runner, text => void loaded.push(text))

    expect(removeSpec(state, host, { name: '-rf', path: '/x', scope: 'global', agents: [] })).toBeNull()
    expect(initSpec(state, host, '../escape')).toBeNull()

    act.create('../escape')
    expect(state.pending).toBeNull()
    expect(state.outcome?.detail).toMatch(/no slash/)

    act.create('my-skill')
    expect(state.pending?.shows).toBe('npx -y skills init my-skill')
    expect(runs).toEqual([])

    act.create('my-skill')
    for (let i = 0; i < 20 && (state.skills.busy !== null || runs.length === 0); i++) await settle()
    expect(runs[0]).toEqual(['npx', '-y', 'skills', 'init', 'my-skill'])

    const skill = { name: 'tdd', path: '/home/dev/.agents/skills/tdd', scope: 'global' as const, agents: [] }

    act.edit(skill)
    expect(loaded).toEqual(['Edit the skill tdd at /home/dev/.agents/skills/tdd: '])
    expect(editPrompt(skill)).toBe(loaded[0])
  })
})
