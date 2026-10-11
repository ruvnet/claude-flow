/**
 * The skills view's second half under vitest: the argv for use / preview / update-all / restore / sync and ▸ add to
 * chosen agents, reading `add --list` and `use`, the install-count sort, the SKILL.md check, the stack a project's
 * manifests show, which agent files name a skill, and each action on a fake Host (reads at once, changes asked first,
 * the palette's headless entries). Nothing here runs the real CLI or reads the real disk.
 */
import { describe, expect, it } from 'vitest'

import type { ReaderFs } from '../hooks/data/files'
import { checkLines, checkSkillMd, inferStack, SKILL_MD_MAX, skillRefs } from '../hooks/data/skill-md'
import { addArgv, agentsOf, installsOf, listRepoArgv, parseRepoList, restoreArgv, sortedFound, syncArgv, updateAllArgv, USE_MAX, useArgv, usePromptOf } from '../hooks/data/skills'
import type { Host } from '../hooks/host'
import { createRunner } from '../hooks/runner'
import { addSpec } from '../hooks/skills'
import { authorPrompt, isSafeDir, moreSkillActions, scanProject, skillPaletteEntries, skillsAnswer } from '../hooks/skills-lab'
import { newState } from '../hooks/state'
import { FIND_OUT, LIST_OUT, USE_OUT } from './fixtures/skills'

const GOOD = ['---', 'name: my-skill', 'description: Does one thing well. Use when asked to do it.', '---', '', '# My skill', 'Steps.'].join('\n')

describe('argv for the new actions', () => {
  it('add names only known agents, after the scope and before -y; use, --list, update-all, restore and sync are fixed', () => {
    expect(addArgv('o/r@s', 'project', ['codex', 'claude-code'])).toEqual(['npx', '-y', 'skills', 'add', 'o/r@s', '--agent', 'claude-code', 'codex', '-y'])
    expect(addArgv('o/r@s', 'global', ['cursor', '-y', '*', 'evil;rm'])).toEqual(['npx', '-y', 'skills', 'add', 'o/r@s', '-g', '--agent', 'cursor', '-y'])
    expect(addArgv('o/r@s', 'global', [])).toEqual(['npx', '-y', 'skills', 'add', 'o/r@s', '-g', '-y'])
    expect(agentsOf(['codex', 'codex', 'nope'])).toEqual(['codex'])
    expect(useArgv('o/r@s')).toEqual(['npx', '-y', 'skills', 'use', 'o/r@s'])
    expect(listRepoArgv('o/r@s')).toEqual(['npx', '-y', 'skills', 'add', 'o/r@s', '--list'])
    expect(listRepoArgv('o/r@s')).not.toContain('--json')
    expect(updateAllArgv('project')).toEqual(['npx', '-y', 'skills', 'update', '-p', '-y'])
    expect(updateAllArgv('global')).toEqual(['npx', '-y', 'skills', 'update', '-g', '-y'])
    expect(restoreArgv()).toEqual(['npx', '-y', 'skills', 'experimental_install'])
    expect(syncArgv()).toEqual(['npx', '-y', 'skills', 'experimental_sync', '-y'])
    expect(syncArgv(['claude-code'])).toEqual(['npx', '-y', 'skills', 'experimental_sync', '--agent', 'claude-code', '-y'])
  })
})

describe('reading what the CLI prints', () => {
  it('add --list: each skill and its description, colour and the │ gutter gone; group titles kept', () => {
    expect(parseRepoList(LIST_OUT)).toEqual([{ name: 'vercel-react-best-practices', description: 'React and Next.js performance optimization guidelines from Vercel Engineering.' }])

    const grouped = ['◇  Available Skills', 'Web Design', '│    web-design', '│      Layouts.', '', 'General', '│    tdd', '│      Tests first.', '└  done'].join('\n')

    expect(parseRepoList(grouped)).toEqual([
      { name: 'web-design', description: 'Layouts.', group: 'Web Design' },
      { name: 'tdd', description: 'Tests first.', group: 'General' },
    ])
    expect(parseRepoList('No valid skills found.')).toEqual([])
  })

  it('use: the prompt as printed, capped where the terminal caps it, and says when it was cut', () => {
    expect(usePromptOf(USE_OUT).prompt.startsWith("You are being given a Skill")).toBe(true)
    expect(usePromptOf(USE_OUT).isCut).toBe(false)
    expect(usePromptOf('x'.repeat(USE_MAX + 5))).toEqual({ prompt: 'x'.repeat(USE_MAX), isCut: true })
    expect(usePromptOf('\u001b[31m\n').prompt).toBe('')
  })

  it('install counts sort most first, results without one last; relevance keeps the order found', () => {
    expect([installsOf('1M'), installsOf('764.8K'), installsOf('42'), installsOf(undefined), installsOf('lots')]).toEqual([1_000_000, 764_800, 42, -1, -1])

    const found = [{ id: 'a/b@none' }, { id: 'a/b@k', installs: '900K' }, { id: 'a/b@m', installs: '1.2M' }]

    expect(sortedFound(found, 'installs').map(skill => skill.id)).toEqual(['a/b@m', 'a/b@k', 'a/b@none'])
    expect(sortedFound(found, 'relevance')).toEqual(found)
  })
})

describe('the SKILL.md check', () => {
  it('passes a well-formed file and names it', () => {
    const check = checkSkillMd(GOOD, 'my-skill')

    expect(check).toMatchObject({ ok: true, name: 'my-skill', problems: [], warnings: [] })
    expect(checkLines(check)[0]).toBe('✓ valid: my-skill')
  })

  it('refuses a file without frontmatter, an unclosed one, a missing or malformed name, a missing description, an oversize file', () => {
    expect(checkSkillMd('# just text').problems).toEqual(['no frontmatter: the file must start with a --- line'])
    expect(checkSkillMd('---\nname: a\n').problems).toEqual(['the frontmatter is never closed with a --- line'])
    expect(checkSkillMd('---\ndescription: x\n---\nbody').problems).toEqual(['name: missing'])
    expect(checkSkillMd('---\nname: My_Skill\ndescription: x\n---\nbody').problems).toEqual(['name: lowercase letters, digits and single hyphens only'])
    expect(checkSkillMd(`---\nname: ${'a'.repeat(65)}\ndescription: x\n---\nb`).problems[0]).toMatch(/at most 64/)
    expect(checkSkillMd('---\nname: a\n---\nbody').problems).toEqual(['description: missing (the CLI skips a skill without one)'])
    expect(checkSkillMd(`---\nname: a\ndescription: ${'d'.repeat(1025)}\n---\nb`).problems[0]).toMatch(/at most 1024/)
    expect(checkSkillMd('x'.repeat(SKILL_MD_MAX + 1)).ok).toBe(false)
  })

  it('reads quoted and block descriptions; warns (without failing) on a folder mismatch, an empty body or a long file', () => {
    expect(checkSkillMd('---\nname: "a-b"\ndescription: >\n  Folded\n  text.\n---\nbody').description).toBe('Folded text.')
    expect(checkSkillMd("---\nname: 'a'\ndescription: 'quoted'\n---\nbody")).toMatchObject({ ok: true, name: 'a', description: 'quoted' })

    const warned = checkSkillMd('---\nname: a\ndescription: x\n---\n', 'b')

    expect(warned.ok).toBe(true)
    expect(warned.warnings).toEqual(['name "a" differs from its folder "b"', 'no instructions after the frontmatter'])
    expect(checkSkillMd(`${GOOD}\n${'line\n'.repeat(600)}`).warnings[0]).toMatch(/lines: keep SKILL.md under 500/)
  })
})

describe('the project scan', () => {
  it('reads the stack from each manifest as searches from a fixed table, never a dependency’s own name', () => {
    const pkg = JSON.stringify({ dependencies: { react: '^19', next: '15', 'evil; rm -rf': '1' }, devDependencies: { typescript: '5', vitest: '3' } })

    expect(inferStack({ packageJson: pkg })).toEqual({ stack: ['TypeScript'], chips: ['nextjs', 'react', 'vitest', 'typescript'] })
    expect(inferStack({ cargoToml: '[dependencies]\ntokio = { version = "1" }\nserde = "1"\n# axum = "0.7"\n' })).toEqual({ stack: ['Rust'], chips: ['rust', 'tokio'] })
    expect(inferStack({ pyproject: '[project]\ndependencies = ["FastAPI>=0.110", "pytest"]\n' })).toEqual({ stack: ['Python'], chips: ['python', 'fastapi', 'pytest'] })
    expect(inferStack({ goMod: 'module x\nrequire github.com/gin-gonic/gin v1.9.1\n' })).toEqual({ stack: ['Go'], chips: ['golang', 'gin'] })
    expect(inferStack({ packageJson: 'not json' })).toEqual({ stack: ['JavaScript'], chips: [] })
    expect(inferStack({})).toEqual({ stack: [], chips: [] })
  })

  it('caps the searches at eight', () => {
    const deps = Object.fromEntries(['next', 'react', 'vue', 'svelte', 'express', 'tailwindcss', 'prisma', 'vitest', 'jest', 'electron'].map(name => [name, '1']))

    expect(inferStack({ packageJson: JSON.stringify({ dependencies: deps }) }).chips).toHaveLength(8)
  })

  it('names the agent files that mention a skill, by whole word; a two-letter name matches nothing', () => {
    const docs = [
      { path: '/w/.claude/agents/core/coder.md', text: 'Use the tdd skill, then sparc-methodology.' },
      { path: '/w/.claude/agents/tester.md', text: 'TDD always. Not tdd-ish.' },
      { path: '/w/.claude/agents/go.md', text: 'go go go' },
    ]

    expect(skillRefs([{ name: 'tdd', where: '.claude/skills' }, { name: 'go', where: '.agents/skills' }, { name: 'sparc', where: '.claude/skills' }], docs)).toEqual([
      { name: 'tdd', where: '.claude/skills', refs: ['agents/core/coder.md', 'agents/tester.md'] },
      { name: 'go', where: '.agents/skills', refs: [] },
      { name: 'sparc', where: '.claude/skills', refs: [] },
    ])
  })
})

/** A ReaderFs over a map of absolute paths; folders are the prefixes of the files. */
function memFs(files: Record<string, string>): ReaderFs {
  return {
    read: async path => {
      if (!(path in files)) throw new Error('ENOENT')

      return files[path] as string
    },
    stat: async path => {
      if (!(path in files)) throw new Error('ENOENT')

      return { size: (files[path] as string).length, mtimeMs: 1 }
    },
    list: async dir => {
      const names = new Map<string, 'file' | 'dir'>()

      for (const path of Object.keys(files)) {
        if (!path.startsWith(`${dir}/`)) continue

        const rest = path.slice(dir.length + 1).split('/')

        names.set(rest[0] as string, rest.length > 1 ? 'dir' : 'file')
      }

      if (names.size === 0) throw new Error('ENOENT')

      return [...names].map(([name, kind]) => ({ name, kind, size: 10 }))
    },
  }
}

function fake(answer: (argv: readonly string[]) => { exitCode: number; stdout: string; stderr: string }, files: Record<string, string> = {}) {
  const runs: string[][] = []
  const host = {
    fs: memFs(files),
    run: async (argv: readonly string[]) => {
      runs.push([...argv])

      return { ...answer(argv), isStdoutTruncated: false, isStderrTruncated: false }
    },
    invalidate: () => undefined,
  } as unknown as Host
  const state = newState({})

  state.cwd = '/w'

  const runner = createRunner(state, host, { freshRead: async () => undefined, setView: () => undefined, drill: () => undefined, command: () => undefined })
  const loaded: string[] = []
  const act = moreSkillActions(state, host, runner, text => void loaded.push(text))

  return { host, state, runner, runs, act, loaded }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 5))
const until = async (done: () => boolean) => {
  for (let i = 0; i < 40 && !done(); i++) await settle()
}

describe('the new skills actions', () => {
  it('▸ use runs `use <id>` at once and types its prompt into the AI terminal; nothing is asked or sent', async () => {
    const { state, runs, act, loaded } = fake(() => ({ exitCode: 0, stdout: USE_OUT, stderr: '' }))

    act.use({ id: 'vercel-labs/agent-skills@vercel-react-best-practices' })
    await until(() => loaded.length > 0)

    expect(runs).toEqual([['npx', '-y', 'skills', 'use', 'vercel-labs/agent-skills@vercel-react-best-practices']])
    expect(state.pending).toBeNull()
    expect(loaded[0]).toContain('<SKILL.md>')
    expect(state.outcome).toMatchObject({ ok: true })
    expect(state.outcome?.detail).toMatch(/Enter twice sends it to claude/)

    act.use({ id: '-g@x' })
    expect(runs).toHaveLength(1)
  })

  it('▸ preview of a result lists its repository with add --list; of an installed skill reads and checks its SKILL.md', async () => {
    const { state, runs, act } = fake(() => ({ exitCode: 0, stdout: LIST_OUT, stderr: '' }), { '/home/dev/.agents/skills/my-skill/SKILL.md': GOOD })

    act.previewFound({ id: 'vercel-labs/agent-skills@vercel-react-best-practices' })
    await until(() => state.skills.preview !== null)
    expect(runs).toEqual([['npx', '-y', 'skills', 'add', 'vercel-labs/agent-skills@vercel-react-best-practices', '--list']])
    expect(state.skills.preview?.lines[0]).toBe('▸ vercel-react-best-practices')

    act.previewInstalled({ name: 'my-skill', path: '/home/dev/.agents/skills/my-skill', scope: 'global', agents: [] })
    await until(() => state.skills.preview?.kind === 'installed')
    expect(state.skills.preview?.lines.slice(0, 2)).toEqual(['✓ valid: my-skill', 'description: Does one thing well. Use when asked to do it.'])
    expect(runs).toHaveLength(1)

    expect(isSafeDir('relative/x')).toBe(false)
    expect(isSafeDir('/a/../etc')).toBe(false)
    act.previewInstalled({ name: 'x', path: '../x', scope: 'project', agents: [] })
    expect(state.outcome?.detail).toMatch(/not an absolute path/)
  })

  it('update all, restore and sync ask first with their exact argv and cost, and run one fixed argv on yes', async () => {
    const { state, runner, runs, act } = fake(argv => ({ exitCode: 0, stdout: argv[3] === 'ls' ? '[]' : 'ok', stderr: '' }))

    act.updateAll()
    expect(state.pending).toMatchObject({ shows: 'npx -y skills update -p -y', note: expect.stringMatching(/network/) })
    expect(runs).toEqual([])
    await runner.confirm()
    await until(() => state.skills.busy === null && runs.length >= 3)
    expect(runs[0]).toEqual(['npx', '-y', 'skills', 'update', '-p', '-y'])

    act.restore()
    expect(state.pending).toMatchObject({ shows: 'npx -y skills experimental_install', note: expect.stringMatching(/experimental · network/) })
    runner.cancel()

    act.scope('global')
    act.toggleAgent('claude-code')
    act.toggleAgent('not-an-agent')
    act.sync()
    expect(state.pending?.shows).toBe('npx -y skills experimental_sync --agent claude-code -y')
    runner.cancel()
    act.updateAll()
    expect(state.pending?.shows).toBe('npx -y skills update -g -y')
    runner.cancel()
    expect(runs).toHaveLength(3)
  })

  it('▸ add installs to the chosen scope and agents', () => {
    const { state, host, act } = fake(() => ({ exitCode: 0, stdout: '', stderr: '' }))

    act.toggleAgent('codex')
    act.toggleAgent('claude-code')
    expect(state.skills.agents).toEqual(['claude-code', 'codex'])
    act.toggleAgent('codex')
    // The sort is a view of the results as found: toggling twice gives the CLI's order back.
    state.skills.found = [{ id: 'a/b@low', installs: '1K' }, { id: 'a/b@high', installs: '2M' }]
    act.sortBy()
    expect(sortedFound(state.skills.found, state.skills.sort).map(skill => skill.id)).toEqual(['a/b@high', 'a/b@low'])
    act.sortBy()
    expect(sortedFound(state.skills.found, state.skills.sort).map(skill => skill.id)).toEqual(['a/b@low', 'a/b@high'])
    expect(addSpec(state, host, { id: 'o/r@s' }, 'global')?.shows).toBe('npx -y skills add o/r@s -g --agent claude-code -y')
    expect(addSpec(state, host, { id: 'o/r@s' }, 'global')?.label).toBe('add skill o/r@s globally for claude-code')
  })

  it('▸ scan reads the manifests, the local skills and the agent files that name them; it runs nothing', async () => {
    const files = {
      '/w/package.json': JSON.stringify({ dependencies: { react: '1' } }),
      '/w/.claude/skills/tdd/SKILL.md': GOOD,
      '/w/.claude/skills/notes.txt': 'not a skill',
      '/w/.agents/skills/sparc-flow/SKILL.md': GOOD,
      '/w/.claude/agents/core/coder.md': 'Apply the tdd skill.',
      '/w/.claude/agents/readme.txt': 'tdd',
    }
    const { state, runs } = fake(() => ({ exitCode: 0, stdout: '', stderr: '' }), files)
    const fs = memFs(files)

    await scanProject(state, fs)

    expect(state.skills.scan).toMatchObject({ stack: ['JavaScript'], chips: ['react'], agentFiles: 1 })
    expect(state.skills.scan?.local).toEqual([
      { name: 'tdd', where: '.claude/skills', refs: ['agents/core/coder.md'] },
      { name: 'sparc-flow', where: '.agents/skills', refs: [] },
    ])
    expect(runs).toEqual([])
  })

  it('authoring: ▸ write loads claude with the file and its rules; ▸ validate checks it from disk', async () => {
    const { state, act, loaded } = fake(() => ({ exitCode: 0, stdout: '', stderr: '' }), { '/w/my-skill/SKILL.md': GOOD, '/w/bad/SKILL.md': '# no frontmatter' })

    act.author()
    expect(state.outcome?.detail).toMatch(/create field first/)

    state.skills.createDraft = 'my-skill'
    act.author()
    expect(loaded).toEqual([authorPrompt('/w', 'my-skill')])
    expect(loaded[0]).toMatch(/^Write the agent skill at \/w\/my-skill\/SKILL\.md/)

    act.validate()
    await until(() => state.skills.check !== null)
    expect(state.skills.check).toMatchObject({ name: 'my-skill', ok: true })

    state.skills.createDraft = 'bad'
    act.validate()
    await until(() => state.skills.check?.name === 'bad')
    expect(state.skills.check).toMatchObject({ ok: false, lines: ['✗ not valid', '✗ no frontmatter: the file must start with a --- line'] })

    state.skills.createDraft = 'missing'
    act.validate()
    await until(() => state.skills.check?.name === 'missing')
    expect(state.skills.check?.lines[0]).toMatch(/missing/)
  })

  it('the palette: skills-find runs headless and answers with what it found; update/restore/sync ask first', async () => {
    const { state, runner, runs } = fake(() => ({ exitCode: 0, stdout: FIND_OUT, stderr: '' }))
    const ids = skillPaletteEntries(state).map(entry => entry.id)

    expect(ids).toEqual(['skills-find', 'skills-update', 'skills-restore', 'skills-sync'])

    const askedAtMs = Date.now()

    expect(runner.runById('skills-find', 'react')).toBe(true)
    await runner.settled()
    expect(runs).toEqual([['npx', '-y', 'skills', 'find', 'react']])
    expect(skillsAnswer(state, 'skills-find', askedAtMs)).toMatch(/^skills find "react": 4 found\n {2}mattpocock\/skills@tdd · 1M installs/)

    expect(runner.runById('skills-update', '')).toBe(true)
    expect(state.pending?.shows).toBe('npx -y skills update -p -y')
    runner.cancel()
    expect(runner.runById('skills-find', '-rf')).toBe(true)
    expect(runs).toHaveLength(1)
  })

  it('without the view wired, the palette entries say so instead of running', () => {
    const state = newState({})
    const update = skillPaletteEntries(state).find(entry => entry.id === 'skills-update')

    expect(update?.run).toEqual({ kind: 'spec', spec: null, why: 'the console is not running in this session: open it first (console_open skills)' })
  })
})
