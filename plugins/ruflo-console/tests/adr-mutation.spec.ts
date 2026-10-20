/**
 * A mutation check on the pure ADR modules (ADR-480): each mutant is a one-line change to the parser, the lint, the scope matcher or the
 * writer, written to a temporary copy beside the original and imported; the test passes only if a fixed battery sees the change. Run with
 *   npx vitest run plugins/ruflo-console/tests/adr-mutation.spec.ts
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { MAX_FILE } from '../hooks/data/adr'
import type { AdrDoc } from '../hooks/data/adr'
import type { filterDocs } from '../hooks/data/adr-lint'
import type { checkScope, digestBlock, scopeHits, suggest } from '../hooks/data/adr-scope'
import type { detectStyle, nextNumber, slugOf, withStatus } from '../hooks/data/adr-write'
import type { indexOf, lint, parseAdr } from '../hooks/data/adr'
import { FIXTURES, RUFLO_ADRS } from './adr-helpers'

const HERE = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------------------------------------------- mutation check

type Mod = Record<string, (...args: never[]) => unknown>

/** What the pure modules say about a fixed battery: any change in a module's behaviour that the battery sees changes this string. */
function signature(adr: Mod, scope: Mod, write: Mod, lintMod: Mod): string {
  const parse = adr.parseAdr as unknown as (f: string, t: string) => AdrDoc
  const index = adr.indexOf as unknown as typeof indexOf
  const lintFn = lintMod.lint as unknown as typeof lint
  const out: unknown[] = []
  const real = readdirSync(RUFLO_ADRS).filter(f => /^ADR-.*\.md$/.test(f)).slice(0, 120).map(f => parse(f, readFileSync(join(RUFLO_ADRS, f), 'utf8')))
  const fixtures: AdrDoc[] = []

  for (const [name, folder] of [['madr', 'docs/decisions'], ['nygard', 'doc/adr'], ['ruflo-style', 'docs/adrs'], ['mixed', 'docs/architecture/decisions'], ['plain', 'adr'], ['log4brains', 'docs/adr']]) {
    for (const f of readdirSync(join(FIXTURES, name as string, folder as string)).filter(file => file.endsWith('.md') && !/^readme/i.test(file))) fixtures.push(parse(f, readFileSync(join(FIXTURES, name as string, folder as string, f), 'utf8')))
  }

  out.push(real.map(d => [d.number, d.variant, d.status, d.date, d.scope.length, d.supersedes, d.supersededBy, d.relates, d.refs, d.decision.length, d.format]))
  out.push(fixtures.map(d => [d.status, d.date, d.format, d.supersedes, d.supersededBy, d.refs, d.scope, d.title]))
  out.push(lintFn(index([...real, ...fixtures]), real.map(d => d.file), 'ADR-001 ADR-002').map(f => `${f.code}:${f.file}`))
  out.push(lintFn(index(fixtures.filter(d => d.file.startsWith('00'))), [], null).map(f => `${f.code}:${f.file}`))
  out.push(parse('0001-x.md', `# 1. X\n\nStatus: Accepted\n\u001b[31m${'z'.repeat(MAX_FILE + 50)}`).notes)
  out.push(parse('0001-x.md', '---\nstatus: accepted\ndate: 2024-12-31\n---\n\n# X\n').date)
  out.push(parse('0001-x.md', '# X\n\nStatus: Accepted\u001b[2K bold\nDate: 2024-02-09\n').statusRaw)
  out.push(parse('0001-x.md', '# X\n\n## Status\n\nSuperseded by [2. Y](0002-y.md)\n'))
  out.push(parse('0001-x.md', `# X\n\n${'filler '.repeat(40_000)}\n\nStatus: Accepted\n`).status)
  out.push(parse('ADR-376-x.md', '# ADR-376: X\n\n| Field | Value |\n|---|---|\n| Status | Proposed |\n').status)
  out.push(lintFn(index([parse('0001-a.md', '# 1. A\n\nStatus: Accepted\nDate: 2020-01-01\nSupersedes: 2\n'), parse('0002-b.md', '# 2. B\n\nStatus: Accepted\nDate: 2020-01-01\nSupersedes: 1\n')]), []).map(f => `${f.level}:${f.code}`))

  const hits = scope.checkScope as unknown as typeof checkScope
  const hit = scope.scopeHits as unknown as typeof scopeHits
  const block = scope.digestBlock as unknown as typeof digestBlock
  const sug = scope.suggest as unknown as typeof suggest
  const accepted = parse('0001-a.md', '# 1. Auth sessions\n\nStatus: Accepted\nDate: 2025-01-01\n\n## Decision\n\nUse sessions.\n')
  const proposed = parse('0002-b.md', '# 2. Auth tokens\n\nStatus: Proposed\nDate: 2025-01-01\n')

  accepted.scope = ['src/auth']
  proposed.scope = ['src/auth']
  out.push([hit('src/auth', 'src/auth/a.ts'), hit('src/auth', 'src/authz/a.ts'), hit('a/b.ts', 'x/a/b.ts'), hit('src/*.ts', 'src/deep/a.ts'), hit('docs', 'docs/x.md'), hit('src/a*b.ts', 'src/aXbYb.ts')])
  out.push(hits(['src/auth/a.ts', 'src/other.ts'], [accepted, proposed]).hits.map(h => h.file))
  out.push(block([accepted, proposed, ...Array.from({ length: 10 }, (_v, i) => ({ ...accepted, file: `00${i + 10}-z.md`, number: i + 10, decision: 'lorem ipsum '.repeat(40) }))]).length)
  const history = { ...accepted, file: '0003-c.md', number: 3, status: 'superseded' as const }

  out.push(sug('auth sessions src/auth/x.ts', [accepted, proposed, history]).map(s => s.doc.number))

  const style = (write.detectStyle as unknown as typeof detectStyle)(fixtures.filter(d => d.file.startsWith('ADR-')))

  out.push([style, (write.nextNumber as unknown as typeof nextNumber)(fixtures), (write.slugOf as unknown as typeof slugOf)('Use Postgres — for Storage!')])

  const nygard = parse('0003-use-graphql.md', readFileSync(join(FIXTURES, 'nygard', 'doc/adr', '0003-use-graphql.md'), 'utf8'))
  const edited = (write.withStatus as unknown as typeof withStatus)(readFileSync(join(FIXTURES, 'nygard', 'doc/adr', '0003-use-graphql.md'), 'utf8'), nygard, { name: 'nygard', width: 4, pattern: '{n}-{slug}.md', source: 'default' }, 'deprecated')

  out.push(edited)

  return JSON.stringify(out)
}

describe('mutation check: the battery notices a change in the parser, the lint, the scope matcher and the writer', () => {
  const data = join(HERE, '..', 'hooks', 'data')
  const made: string[] = []
  const baseline = async () => signature((await import('../hooks/data/adr')) as never, (await import('../hooks/data/adr-scope')) as never, (await import('../hooks/data/adr-write')) as never, (await import('../hooks/data/adr-lint')) as never)

  afterAll(() => {
    for (const file of made) rmSync(file, { force: true })
  })

  const mutants: [string, string, string, string][] = [
    ['adr', 'a superseded status read as deprecated', "if (/\\bsuperse?ded\\b|\\breplaced\\b|\\bobsolete/.test(text)) return 'superseded'", "if (/\\bsuperse?ded\\b|\\breplaced\\b|\\bobsolete/.test(text)) return 'deprecated'"],
    ['adr', 'a one-digit month only', '(0?[1-9]|1[0-2])[-/. ](0?[1-9]|[12]\\d|3[01])', '(0?[1-9])[-/. ](0?[1-9]|[12]\\d|3[01])'],
    ['adr-lint', 'A/B/C siblings counted as duplicates', 'other.variant === doc.variant', 'true'],
    ['adr-lint', 'a supersedes with no file not reported', '!registry.byNumber.has(target)) add(\'warn\', \'dangling-supersedes\'', 'registry.byNumber.has(target)) add(\'warn\', \'dangling-supersedes\''],
    ['adr', 'a Status section read as a status line', "return { raw: first ?? '', format: 'nygard', section }", "return { raw: first ?? '', format: 'inline', section }"],
    ['adr', 'front matter never recognised', "if (!text.startsWith('---\\n')) return null", "if (!text.startsWith('--\\n')) return null"],
    ['adr', 'escapes left in the text', ".replace(ESCAPES, '')", ''],
    ['adr', 'no cap on a huge file', 'text = wash(source.length > MAX_FILE ? source.slice(0, MAX_FILE) : source)', 'text = wash(source)'],
    ['adr', 'a table status not read', "const table = /^\\s*\\|\\s*\\**status\\**\\s*\\|\\s*(.+?)\\s*\\|?\\s*$/i.exec(line)", "const table = /^\\s*\\|\\s*\\**nostatus\\**\\s*\\|\\s*(.+?)\\s*\\|?\\s*$/i.exec(line)"],
    ['adr-lint', 'a cycle not reported', "add('error', 'supersede-cycle'", "add('info', 'supersede-cycle'"],
    ['adr-scope', 'a sibling that shares a prefix counted in scope', 'f.startsWith(`${e}/`)', 'f.startsWith(e)'],
    ['adr-scope', 'a proposed ADR counted as in force', "attached.filter(doc => doc.status === 'accepted')", 'attached'],
    ['adr-scope', 'no cap on the digest', 'if (used + line.length > DIGEST_TOTAL) break', ''],
    ['adr-scope', 'a glob that crosses folders', 'return want.every((part, index) => segmentHits(part, tail[index] as string))', 'return segmentHits(glob, file)'],
    ['adr-scope', 'a star that never gives back what it took', 's = ++resume', 'return false'],
    ['adr-scope', 'history offered as a suggestion', "(doc.status !== 'accepted' && doc.status !== 'proposed') || attached.includes(doc.file)", 'attached.includes(doc.file)'],
    ['adr-write', 'the next number reuses the highest', "(high, doc) => Math.max(high, doc.number ?? 0), 0) + 1", "(high, doc) => Math.max(high, doc.number ?? 0), 0) + 0"],
    ['adr-write', 'a status inserted instead of replaced', 'lines[first] = value', "lines.splice(first, 0, value)"],
    ['adr-write', 'slugs keep their case', '    .toLowerCase()\n    .normalize', '    .normalize'],
    ['adr-write', 'the prefix is never detected', "/^adr[-_ ]/i.test(doc.file)", '/^zzz/i.test(doc.file)'],
  ]

  it('the unmutated battery is stable', async () => {
    expect(await baseline()).toBe(await baseline())
  })

  it.each(mutants.map((m, i) => [i, m[1], m] as const))('mutant %i (%s) changes what the battery sees', async (index, _label, [module, , find, replace]) => {
    const file = join(data, `${module}.ts`)
    const source = readFileSync(file, 'utf8')

    expect(source, `the mutation target must exist: ${find}`).toContain(find)

    const path = join(data, `.mut-${index}-${module}.ts`)

    writeFileSync(path, source.replace(find, replace))
    made.push(path)

    const mod = async (name: string) => (name === module ? await import(/* @vite-ignore */ path) : await import(`../hooks/data/${name}`)) as Mod

    expect(signature(await mod('adr'), await mod('adr-scope'), await mod('adr-write'), await mod('adr-lint'))).not.toBe(await baseline())
  })
})
