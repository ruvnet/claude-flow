/**
 * Every action the console can issue, checked against the real ruflo CLI: the subcommand exists and every `--flag` in
 * the argv is one that subcommand documents (its `--help`), and every `mcp exec -t <tool>` names a real MCP tool. An
 * invented flag or tool fails here, not in a person's pane. It runs the CLI, so it is opt-in:
 *   RUFLO_CONFORMANCE=1 npx vitest run plugins/ruflo-console/tests/conformance.spec.ts
 * Entries are collected from the palette (every spec and text entry), the one-click starts and the MetaHarness lab,
 * over a project with a hive-mind, so the entries that need a selection exist.
 */
import { spawnSync } from 'node:child_process'
import { VERBS } from '../hooks/plugin-catalog'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type { ActionSpec } from '../hooks/actions'
import type { ReadCache } from '../hooks/data/files'
import { readSnapshot } from '../hooks/data/snapshot'
import { LAB, labSpec } from '../hooks/mh-lab'
import { paletteEntries } from '../hooks/palette'
import { START_IDS, startSpec } from '../hooks/starts'
import { newState } from '../hooks/state'
import { HIVE_FILES } from './fixtures/hive'

const CLI = ['npx', '--offline', '-y', '@claude-flow/cli@latest']
const SRC = new URL('../../../v3/@claude-flow/cli/src/', import.meta.url).pathname
const TOOLS_DIR = `${SRC}mcp-tools/`
const PLUGIN_SCRIPTS = new URL('../../ruflo-metaharness/scripts/', import.meta.url).pathname

const memoryFs = (files: Record<string, string>) => ({
  read: async (path: string) => files[path] ?? Promise.reject(new Error('ENOENT')),
  stat: async (path: string) => (files[path] !== undefined ? { mtimeMs: 1, size: (files[path] as string).length } : Promise.reject(new Error('ENOENT'))),
  list: async () => Promise.reject(new Error('ENOENT')),
})

/** Every spec the console can build for a project that has a swarm, claims, a task and a hive with workers. */
async function allSpecs(): Promise<{ id: string; spec: ActionSpec }[]> {
  const files = Object.fromEntries(Object.entries(HIVE_FILES).map(([path, text]) => [`/work/${path}`, text]))
  const state = newState({})

  state.snapshot = await readSnapshot(memoryFs(files), new Map() as ReadCache, '/work', '/home/dev', {}, 0)

  const out: { id: string; spec: ActionSpec }[] = []
  const nowMs = 1_790_000_000_000

  for (const entry of paletteEntries(state, nowMs)) {
    if (entry.run.kind === 'spec' && entry.run.spec !== null) out.push({ id: entry.id, spec: entry.run.spec })
    if (entry.run.kind === 'text') {
      const spec = entry.run.make(`${entry.run.keyword === 'propose' ? 'design: ' : ''}sample text`)

      if (spec !== null) out.push({ id: `${entry.id} <text>`, spec })
    }
  }

  for (const id of START_IDS) {
    const spec = startSpec(id, nowMs)

    if (spec !== null) out.push({ id: `start:${id}`, spec })
  }

  for (const id of ['task', 'mission'] as const) {
    const spec = startSpec(id, nowMs, 'sample text')

    if (spec !== null) out.push({ id: `start:${id}`, spec })
  }

  for (const entry of LAB) {
    const spec = labSpec(entry, state)

    if (spec !== null) out.push({ id: `lab:${entry.id}`, spec })
  }

  return out
}

const helpCache = new Map<string, string>()

/** `ruflo <words…> --help` as text (ANSI stripped), cached; empty when the command does not exist. */
function helpOf(words: readonly string[]): string {
  const key = words.join(' ')

  if (!helpCache.has(key)) {
    const run = spawnSync(CLI[0] as string, [...CLI.slice(1), ...words, '--help'], { encoding: 'utf8', timeout: 90_000 })

    helpCache.set(key, `${run.stdout ?? ''}${run.stderr ?? ''}`.replace(/\u001b\[[0-9;]*m/g, ''))
  }

  return helpCache.get(key) as string
}

/** `<ruvector CLI> <words…> --help` as text, cached: the Vector Lab's entries run the ruvector CLI, not ruflo's. */
function rvHelpOf(prefix: readonly string[], words: readonly string[]): string {
  const key = `rv ${prefix.join(' ')} ${words.join(' ')}`

  if (!helpCache.has(key)) {
    const run = spawnSync(prefix[0] as string, [...prefix.slice(1), ...words, '--help'], { encoding: 'utf8', timeout: 90_000 })

    helpCache.set(key, `${run.stdout ?? ''}${run.stderr ?? ''}`.replace(/\u001b\[[0-9;]*m/g, ''))
  }

  return helpCache.get(key) as string
}

/** The command path of an argv: its leading words up to the first flag, at most three. */
function pathOf(args: readonly string[]): string[] {
  const words: string[] = []

  for (const word of args) {
    if (word.startsWith('-') || words.length === 3) break
    words.push(word)
  }

  return words
}

/**
 * Whether a command's source declares `--flag`: in the parser's global options or in the command's own file. Help text
 * is no authority here: a nested subcommand prints its parent's help, and global flags (--format) are not listed in it.
 */
function declares(command: string, flag: string): boolean {
  const name = flag.slice(2)
  // `metaharness` hands its flags to the plugin's scripts (redblue.mjs, bench…), which declare them.
  const scripts = command === 'metaharness' ? readdirSync(PLUGIN_SCRIPTS).map(file => `${PLUGIN_SCRIPTS}${file}`) : []
  const sources = [`${SRC}parser.ts`, `${SRC}commands/${command}.ts`, ...scripts].flatMap(file => {
    try {
      return [readFileSync(file, 'utf8')]
    } catch {
      return []
    }
  })

  return sources.some(text => text.includes(`'${name}'`) || text.includes(`--${name}`))
}

/** Every MCP tool name the CLI registers, read from its source. */
function toolNames(): Set<string> {
  const names = new Set<string>()

  for (const file of readdirSync(TOOLS_DIR).filter(name => name.endsWith('.ts'))) {
    for (const match of readFileSync(`${TOOLS_DIR}${file}`, 'utf8').matchAll(/name:\s*'([a-z0-9_-]+)'/g)) names.add(match[1] as string)
  }

  return names
}

describe.skipIf(process.env.RUFLO_CONFORMANCE !== '1')('console actions vs the real CLI', () => {
  it('every subcommand exists and every long flag in every argv is documented by it', async () => {
    const tools = toolNames()
    const problems: string[] = []

    for (const { id, spec } of await allSpecs()) {
      const args = spec.args as readonly string[]

      // Another CLI than ruflo's: the ruvector ones are checked against its help; `claude plugin configure` (Cost) is fixed, not a flag set to verify here.
      if (spec.argv !== undefined && !spec.argv.some(word => word.startsWith('ruvector'))) continue

      if (spec.argv !== undefined) {
        const at = spec.argv.findIndex(word => word.startsWith('ruvector'))
        const rest = spec.argv.slice(at + 1)
        const path = pathOf(rest)
        const help = rvHelpOf(spec.argv.slice(0, at + 1), path)

        if (!/Usage:/i.test(help)) problems.push(`${id}: no such ruvector command "${path.join(' ')}"`)

        for (const flag of rest.filter(word => /^--[a-z]/.test(word))) if (!help.includes(flag)) problems.push(`${id}: ruvector "${path.join(' ')}" declares no ${flag}`)

        continue
      }

      if (args[0] === 'mcp' && args[1] === 'exec') {
        const tool = args[args.indexOf('-t') + 1] ?? ''

        if (!tools.has(tool)) problems.push(`${id}: no MCP tool "${tool}"`)

        continue
      }

      const path = pathOf(args)
      const help = helpOf(path)

      if (/unknown command|not found|Unknown/i.test(help.slice(0, 300)) && !/Usage|USAGE|Options/i.test(help)) {
        problems.push(`${id}: no such command "${path.join(' ')}"`)

        continue
      }

      for (const flag of args.filter(word => /^--[a-z]/.test(word))) {
        if (!help.includes(flag) && !declares(path[0] ?? '', flag)) problems.push(`${id}: "${path.join(' ')}" declares no ${flag} (not in its help or its source)`)
      }
    }

    expect(problems).toEqual([])
  }, 900_000)
  it('every claude plugin verb the Plugin Catalog runs exists and takes --scope', () => {
    for (const verb of VERBS) {
      const run = spawnSync('claude', ['plugin', verb, '--help'], { encoding: 'utf8', timeout: 60_000 })
      const help = `${run.stdout ?? ''}${run.stderr ?? ''}`

      expect(help, `claude plugin ${verb}`).toMatch(/Usage: claude plugin/)
      expect(help, `claude plugin ${verb}`).toContain('--scope')
    }
  }, 300_000)
})
