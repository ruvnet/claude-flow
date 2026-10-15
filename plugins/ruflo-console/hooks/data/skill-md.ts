/**
 * Pure readers for a project's skills, run on text the console has already read (bounded): a SKILL.md's frontmatter
 * checked against what the `skills` CLI and the Agent Skills format require, the project's stack from its manifests
 * (as searches to offer, never the dependency names themselves), and which agent files name which local skill.
 * Nothing here reads a file, runs a program or reaches the network.
 */
import { plain } from './parse'
import { typedOf } from './skills'

/** A SKILL.md larger than this is refused (the format asks for a short entry file with details in other files). */
export const SKILL_MD_MAX = 100_000
/** Past this many lines the check warns: the format suggests keeping SKILL.md under 500 lines. */
export const SKILL_MD_LINES = 500
const NAME_MAX = 64
const DESCRIPTION_MAX = 1024
const SPEC_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export type SkillCheck = { ok: boolean; name?: string; description?: string; problems: string[]; warnings: string[] }

/** A frontmatter value: unquoted, or one pair of quotes taken off; a folded (`>`) or literal (`|`) block joined. */
function valueOf(lines: readonly string[], key: string): string | undefined {
  const at = lines.findIndex(line => new RegExp(`^${key}\\s*:`).test(line))

  if (at < 0) return undefined

  const first = (lines[at] ?? '').replace(new RegExp(`^${key}\\s*:\\s*`), '').trim()

  if (/^[>|][+-]?$/.test(first)) {
    const block: string[] = []

    for (const line of lines.slice(at + 1)) {
      if (!/^\s+\S/.test(line) && line.trim() !== '') break
      block.push(line.trim())
    }

    return block.join(' ').trim()
  }

  return /^(["']).*\1$/.test(first) ? first.slice(1, -1) : first
}

/**
 * Checks a SKILL.md: a `---` frontmatter block at the top, a `name` (lowercase letters, digits and single hyphens, at
 * most 64, and the folder's name when one is given) and a non-empty `description` (at most 1024), within the size cap.
 * Problems fail the check; warnings (a long body, no body) do not.
 */
export function checkSkillMd(text: string, folder?: string): SkillCheck {
  const problems: string[] = []
  const warnings: string[] = []

  if (text.length > SKILL_MD_MAX) return { ok: false, problems: [`${text.length} characters: over the ${SKILL_MD_MAX} cap`], warnings }

  const lines = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n')

  if (lines[0]?.trim() !== '---') return { ok: false, problems: ['no frontmatter: the file must start with a --- line'], warnings }

  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')

  if (end < 0) return { ok: false, problems: ['the frontmatter is never closed with a --- line'], warnings }

  const head = lines.slice(1, end)
  const name = valueOf(head, 'name')
  const description = valueOf(head, 'description')

  if (name === undefined || name === '') problems.push('name: missing')
  else if (name.length > NAME_MAX) problems.push(`name: ${name.length} characters, at most ${NAME_MAX}`)
  else if (!SPEC_NAME.test(name)) problems.push('name: lowercase letters, digits and single hyphens only')
  else if (folder !== undefined && folder.toLowerCase() !== name) warnings.push(`name "${name}" differs from its folder "${plain(folder, 64)}"`)

  if (description === undefined || description === '') problems.push('description: missing (the CLI skips a skill without one)')
  else if (description.length > DESCRIPTION_MAX) problems.push(`description: ${description.length} characters, at most ${DESCRIPTION_MAX}`)

  if (lines.slice(end + 1).every(line => line.trim() === '')) warnings.push('no instructions after the frontmatter')
  if (lines.length > SKILL_MD_LINES) warnings.push(`${lines.length} lines: keep SKILL.md under ${SKILL_MD_LINES} and move detail to other files`)

  return {
    ok: problems.length === 0,
    ...(name !== undefined && name !== '' && { name: plain(name, NAME_MAX) }),
    ...(description !== undefined && description !== '' && { description: plain(description, 300) }),
    problems,
    warnings,
  }
}

/** The check as lines for the view and the outcome. */
export const checkLines = (check: SkillCheck): string[] => [
  check.ok ? `✓ valid: ${check.name ?? ''}` : '✗ not valid',
  ...(check.description !== undefined ? [`description: ${check.description}`] : []),
  ...check.problems.map(problem => `✗ ${problem}`),
  ...check.warnings.map(warning => `! ${warning}`),
]

/** The manifests a stack is read from, as text (null when missing or unread). */
export type Manifests = { packageJson?: string | null; cargoToml?: string | null; pyproject?: string | null; goMod?: string | null }

/** A known dependency and the search it suggests: chips come from this table only, never from a dependency's own name. */
const NODE: readonly [string, string][] = [
  ['next', 'nextjs'],
  ['react', 'react'],
  ['vue', 'vue'],
  ['svelte', 'svelte'],
  ['@angular/core', 'angular'],
  ['express', 'express'],
  ['tailwindcss', 'tailwind'],
  ['prisma', 'prisma'],
  ['@prisma/client', 'prisma'],
  ['vitest', 'vitest'],
  ['jest', 'jest'],
  ['@playwright/test', 'playwright'],
  ['electron', 'electron'],
  ['typescript', 'typescript'],
]
const RUST: readonly [string, string][] = [['tokio', 'tokio'], ['axum', 'axum'], ['wasm-bindgen', 'wasm'], ['bevy', 'bevy']]
const PYTHON: readonly [string, string][] = [['django', 'django'], ['fastapi', 'fastapi'], ['flask', 'flask'], ['pytest', 'pytest'], ['pandas', 'pandas'], ['torch', 'pytorch']]
const GO: readonly [string, string][] = [['github.com/gin-gonic/gin', 'gin'], ['google.golang.org/grpc', 'grpc']]

const CHIPS_MAX = 8

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/** package.json's dependency names, or none when it is not a JSON object. */
function nodeDeps(text: string): Set<string> {
  try {
    const json = JSON.parse(text.slice(0, 500_000)) as Record<string, unknown>
    const names = ['dependencies', 'devDependencies', 'peerDependencies'].flatMap(key => {
      const deps = json?.[key]

      return deps !== null && typeof deps === 'object' && !Array.isArray(deps) ? Object.keys(deps) : []
    })

    return new Set(names)
  } catch {
    return new Set()
  }
}

/**
 * The project's stack, from the manifests at its root: each language present, and up to eight searches to offer
 * (react → `react`). A dependency counts only when named as one (a key in package.json, `name =` or `name = {` in
 * Cargo.toml, a requirement string in pyproject.toml, a `require` path in go.mod).
 */
export function inferStack(manifests: Manifests): { stack: string[]; chips: string[] } {
  const stack: string[] = []
  const chips: string[] = []
  const add = (chip: string) => {
    if (!chips.includes(chip) && chips.length < CHIPS_MAX && typedOf(chip) !== null) chips.push(chip)
  }

  if (typeof manifests.packageJson === 'string') {
    const deps = nodeDeps(manifests.packageJson)

    stack.push(deps.has('typescript') ? 'TypeScript' : 'JavaScript')
    for (const [dep, chip] of NODE) if (deps.has(dep)) add(chip)
  }

  if (typeof manifests.cargoToml === 'string') {
    const text = manifests.cargoToml.slice(0, 500_000)

    stack.push('Rust')
    add('rust')
    for (const [dep, chip] of RUST) if (new RegExp(`^\\s*${escape(dep)}\\s*=`, 'm').test(text)) add(chip)
  }

  if (typeof manifests.pyproject === 'string') {
    const text = manifests.pyproject.slice(0, 500_000).toLowerCase()

    stack.push('Python')
    add('python')
    for (const [dep, chip] of PYTHON) if (new RegExp(`["'\\s]${escape(dep)}\\s*(?:[<>=~!\\[;"']|$)`, 'm').test(text)) add(chip)
  }

  if (typeof manifests.goMod === 'string') {
    const text = manifests.goMod.slice(0, 500_000)

    stack.push('Go')
    add('golang')
    for (const [dep, chip] of GO) if (new RegExp(`^\\s*(?:require\\s+)?${escape(dep)}\\s+v`, 'm').test(text)) add(chip)
  }

  return { stack, chips }
}

/** A short path for the view: the file's name under its agents folder. */
const shortOf = (path: string): string => path.replace(/^.*?\/(agents|commands)\//, '$1/')

/**
 * Which agent files name each local skill: a whole-word, case-insensitive match of the skill's name (at least three
 * characters, so `go` or `ui` never matches everywhere), at most eight files per skill.
 */
export function skillRefs(skills: readonly { name: string; where: string }[], docs: readonly { path: string; text: string }[]): { name: string; where: string; refs: string[] }[] {
  return skills.map(skill => {
    const isMatchable = skill.name.length >= 3
    const pattern = new RegExp(`(^|[^A-Za-z0-9_-])${escape(skill.name)}($|[^A-Za-z0-9_-])`, 'i')
    const refs = isMatchable ? docs.filter(doc => pattern.test(doc.text)).map(doc => shortOf(doc.path)).slice(0, 8) : []

    return { name: skill.name, where: skill.where, refs }
  })
}
