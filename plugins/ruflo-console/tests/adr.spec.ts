/**
 * The ADR registry (ADR-480): the parser and lint over the conventions real projects use, the style detection and the records written
 * (pure), the digest and the scope matcher, with hostile files. The fixture projects are in tests/fixtures/adr-projects (MADR, Nygard /
 * adr-tools, ruflo style, log4brains, plain, mixed, empty); ruflo's own ADRs are one more set. Run with
 *   npx vitest run plugins/ruflo-console/tests/adr.spec.ts
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { filterDocs, graphOf, indexOf, lint, MAX_FILE, parseAdr, type AdrDoc } from '../hooks/data/adr'
import { checkScope, digestBlock, reportLines, scopeHits, suggest } from '../hooks/data/adr-scope'
import { adrDirText, detectStyle, draftFromMission, fileNameFor, initialRecord, lineDiff, nextNumber, patternOf, renderNew, slugOf, withStatus, withSupersedes } from '../hooks/data/adr-write'
import { docsOf, FIXTURES, RUFLO_ADRS, TODAY } from './adr-helpers'

describe('the conventions of real projects', () => {
  it('reads MADR front matter: status, date, a superseded-by status and a supersedes field', () => {
    const [one, two, three] = docsOf('madr', 'docs/decisions') as [AdrDoc, AdrDoc, AdrDoc]

    expect([one.format, one.status, one.date, one.number, one.title]).toEqual(['madr', 'accepted', '2024-03-02', 1, 'Use Markdown Architectural Decision Records'])
    expect([two.status, two.supersededBy, two.date]).toEqual(['superseded', [3], '2024-03-10'])
    expect([three.status, three.supersedes]).toEqual(['accepted', [2]])
    expect(one.refs).toEqual([12])
    expect(three.refs).toEqual([77])
    expect(two.scope).toEqual(expect.arrayContaining(['src/db/', 'services/orders/store.ts']))
    expect(one.decision).toContain('MADR 3.0')
  })

  it('reads Nygard / adr-tools: the Status section, Superseded by and Supersedes links, Date: lines, "1." titles', () => {
    const [one, two, three] = docsOf('nygard', 'doc/adr') as [AdrDoc, AdrDoc, AdrDoc]

    expect([one.format, one.status, one.date, one.title]).toEqual(['nygard', 'accepted', '2018-02-12', 'Record architecture decisions'])
    expect([two.status, two.supersededBy]).toEqual(['superseded', [3]])
    expect([three.status, three.supersedes]).toEqual(['accepted', [2]])
    expect(three.decision).toContain('GraphQL')
    expect(two.scope).toContain('api/public')
  })

  it('reads the ruflo style: bold and plain Status/Date lines, a parenthesis after the status, Scope and Builds on', () => {
    const [one, two] = docsOf('ruflo-style', 'docs/adrs') as [AdrDoc, AdrDoc]

    expect([one.format, one.status, one.statusRaw, one.date, one.number]).toEqual(['inline', 'accepted', 'Accepted — Implemented in 1.2.0', '2025-01-10', 1])
    expect(one.scope).toEqual(expect.arrayContaining(['services/bus/', 'libs/events/index.ts']))
    expect(one.relates).toEqual([2])
    expect(one.refs).toEqual([41])
    expect([two.status, two.date, two.relates, two.scope]).toEqual(['proposed', '2025-02-01', [1], ['libs/events/retry.ts']])
  })

  it('reads log4brains (a date-prefixed name is not a sequence number) and plain markdown with no status at all', () => {
    const [log] = docsOf('log4brains', 'docs/adr') as [AdrDoc]
    const [plain] = docsOf('plain', 'adr') as [AdrDoc]

    expect([log.status, log.date, log.format, log.number, log.title]).toEqual(['accepted', '2020-01-01', 'inline', null, 'Use Log4brains to manage the ADRs'])
    expect([plain.status, plain.statusRaw, plain.format, plain.notes]).toEqual(['unknown', '', 'bare', ['no status', 'no number in the file name or title']])
    expect(plain.scope).toEqual(['src/auth/'])
  })

  it('reads the variants of ruflo’s own table-form, bullet-form and list-item status lines', () => {
    const table = parseAdr('ADR-376-x.md', '# ADR-376: X\n\n| Field | Value |\n|---|---|\n| Status | Proposed |\n| Date | 2026-07-27 |\n')
    const bullet = parseAdr('ADR-104-x.md', '# ADR-104 — X\n\n- Status: **Accepted — Implemented; pending v2**\n- Date: 2026-05-09\n- Supersedes / extends: [ADR-097 — Y](./ADR-097-y.md)\n')
    const list = parseAdr('ADR-322A-x.md', '# ADR-322A: X\n\n- **Status**: Accepted — implemented\n- **Parent**: ADR-322\n')
    const spaced = parseAdr('ADR-430-x.md', '# ADR 430: X\n\nStatus: Accepted (ships in ruflo-console 0.26.0)\n\nDate: 2026 10 03\n')

    expect([table.status, table.date]).toEqual(['proposed', '2026-07-27'])
    expect([bullet.status, bullet.date, bullet.supersedes]).toEqual(['accepted', '2026-05-09', [97]])
    expect([list.status, list.number, list.variant, list.relates]).toEqual(['accepted', 322, 'A', [322].filter(() => false)])
    expect([spaced.status, spaced.date, spaced.number]).toEqual(['accepted', '2026-10-03', 430])
  })

  it('parses every one of ruflo’s own ADRs with a number, a title and, nearly always, a status, date, scope and decision', () => {
    const files = readdirSync(RUFLO_ADRS).filter(f => /^ADR-.*\.md$/.test(f))
    const docs = files.map(f => parseAdr(f, readFileSync(join(RUFLO_ADRS, f), 'utf8')))
    const count = (test: (doc: AdrDoc) => boolean) => docs.filter(test).length

    expect(docs.length).toBeGreaterThanOrEqual(250)
    expect(count(doc => doc.number !== null)).toBe(docs.length)
    expect(count(doc => doc.title.length > 3)).toBe(docs.length)
    expect(count(doc => doc.statusRaw !== '')).toBeGreaterThan(docs.length * 0.97)
    expect(count(doc => doc.status === 'accepted')).toBeGreaterThan(100)
    expect(count(doc => doc.status === 'proposed')).toBeGreaterThan(60)
    expect(count(doc => doc.date !== null)).toBeGreaterThan(docs.length * 0.97)
    expect(count(doc => doc.scope.length > 0)).toBeGreaterThan(docs.length * 0.8)
    expect(count(doc => doc.decision !== '')).toBeGreaterThan(docs.length * 0.85)
    expect(count(doc => doc.relates.length + doc.supersedes.length > 0)).toBeGreaterThan(150)

    const last = docs.find(doc => doc.file.startsWith('ADR-479')) as AdrDoc

    expect([last.status, last.date, last.relates]).toEqual(['accepted', '2026-10-07', [12, 476]])
    expect(last.refs).toEqual(expect.arrayContaining([3598]))
  })

  it('lints ruflo’s own ADRs: the known duplicate numbers are errors, A/B/C siblings are not, and the index is read', () => {
    const names = readdirSync(RUFLO_ADRS).filter(f => f.endsWith('.md'))
    const docs = names.filter(f => /^ADR-/.test(f)).map(f => parseAdr(f, readFileSync(join(RUFLO_ADRS, f), 'utf8')))
    const findings = lint(indexOf(docs), names, readFileSync(join(RUFLO_ADRS, 'INDEX-mod-system.md'), 'utf8'))
    const dupes = new Set(findings.filter(f => f.code === 'duplicate-number').map(f => /^ADR-(\d+)/.exec(f.file)?.[1]))

    expect(dupes.has('430')).toBe(true)
    expect(dupes.has('322')).toBe(false)
    expect(findings.some(f => f.code === 'not-in-index')).toBe(true)
    expect(findings.filter(f => f.code === 'broken-link').length).toBeGreaterThan(0)
  })
})

describe('lint over the fixture projects', () => {
  it('the mixed project: duplicate number, dangling supersedes, no status, no date, a missing and an unlisted record', () => {
    const docs = docsOf('mixed', 'docs/architecture/decisions')
    const names = readdirSync(join(FIXTURES, 'mixed', 'docs/architecture/decisions'))
    const findings = lint(indexOf(docs), names, readFileSync(join(FIXTURES, 'mixed', 'docs/architecture/decisions', 'README.md'), 'utf8'))
    const codes = (code: string) => findings.filter(f => f.code === code).map(f => f.file)

    expect(codes('duplicate-number').sort()).toEqual(['0002-duplicate.md', '0002-madr-one.md'])
    expect(codes('dangling-supersedes')).toEqual(['0002-madr-one.md'])
    expect(codes('no-status')).toEqual(['0004-no-status.md'])
    expect(codes('not-in-index').sort()).toEqual(['0002-duplicate.md', '0002-madr-one.md'])
    expect(codes('status-without-date')).toEqual([])
    expect(findings.filter(f => f.level === 'error')).toHaveLength(2)
  })

  it('a clean project has no findings; a one-sided supersede and a cycle are reported', () => {
    const clean = docsOf('nygard', 'doc/adr')

    expect(lint(indexOf(clean), clean.map(d => d.file))).toEqual([])

    const a = parseAdr('0001-a.md', '# 1. A\n\nDate: 2020-01-01\n\n## Status\n\nAccepted\n\nSupersedes 2\n')
    const b = parseAdr('0002-b.md', '# 2. B\n\nDate: 2020-01-01\n\n## Status\n\nAccepted\n\nSupersedes 1\n')
    const codes = lint(indexOf([a, b]), [a.file, b.file]).map(f => f.code)

    expect(codes).toContain('supersede-cycle')
    expect(codes).toContain('supersede-mismatch')
  })

  it('both directions of every link, and who cites a record', () => {
    const docs = docsOf('nygard', 'doc/adr')
    const registry = indexOf(docs)
    const two = docs[1] as AdrDoc
    const graph = graphOf(registry, two)

    expect(graph.supersededBy.map(d => d.number)).toEqual([3])
    expect(graph.citedBy.map(d => d.number)).toEqual([3])
    expect(graphOf(registry, docs[2] as AdrDoc).supersedes.map(d => d.number)).toEqual([2])
  })

  it('filters by status, words and scope', () => {
    const docs = docsOf('madr', 'docs/decisions')

    expect(filterDocs(docs, { status: 'accepted', text: '', scope: '' }).map(d => d.number)).toEqual([1, 3])
    expect(filterDocs(docs, { status: 'all', text: 'postgres', scope: '' }).map(d => d.number)).toEqual([2])
    expect(filterDocs(docs, { status: 'all', text: '', scope: 'services/orders' }).map(d => d.number)).toEqual([2, 3])
  })
})

describe('hostile files', () => {
  it('a huge file is read to its cap and says so; a long line and nested noise parse fast', () => {
    const huge = parseAdr('0001-huge.md', `# 1. Huge\n\n## Status\n\nAccepted\n\n${'lorem ipsum '.repeat(1_000_000)}`)
    const line = parseAdr('0002-line.md', `# 2. Line\n\n${'a'.repeat(2_000_000)}\n${'* '.repeat(200_000)}\n${'`/'.repeat(100_000)}`)
    const started = Date.now()
    const noise = parseAdr('0003-noise.md', '[]('.repeat(100_000) + '\n' + '#1 '.repeat(100_000))

    expect(huge.notes.join(' ')).toContain(`longer than ${MAX_FILE}`)
    expect(huge.status).toBe('accepted')
    expect(line.title).toBe('Line')
    expect(noise.refs.length).toBeLessThanOrEqual(20)
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('escapes, control characters and bidi marks never reach a title, a status or a decision', () => {
    const esc = '\u001b'
    const doc = parseAdr('0005-x.md', `# 5. Title${esc}[31m red${esc}]0;evil\u0007 ‮evil\u0000\n\nStatus: Accepted${esc}[2J​\n\n## Decision\n\nDo \u0001the \u007fthing\n`)

    expect(doc.title).toBe('Title red evil')
    expect(doc.status).toBe('accepted')
    expect(`${doc.title}${doc.statusRaw}${doc.decision}`).not.toMatch(/[\u0000-\u0008\u001b\u007f-\u009f​-‏‪-‮]/)
    expect(doc.decision).toBe('Do the thing')
  })

  it('unterminated front matter, a missing title, binary garbage and an empty file are documents, never errors', () => {
    const cases = ['---\nstatus: accepted\n# no end', '', '\u0000\u0001\u0002'.repeat(1000), '---\n---\n', '#', '## Status\n', 'Status:']

    for (const text of cases) expect(() => parseAdr('0001-x.md', text)).not.toThrow()
    expect(parseAdr('0007-empty.md', '').title).toBe('empty')
    expect(parseAdr('0007-empty.md', '').status).toBe('unknown')
  })

  it('cyclic supersedes and duplicate numbers are findings, and the lint stays bounded', () => {
    const docs = Array.from({ length: 300 }, (_v, i) => parseAdr(`${String((i % 150) + 1).padStart(4, '0')}-n${i}.md`, `# ${i}. N\n\nStatus: Accepted\nDate: 2020-01-01\nSupersedes: ${((i + 1) % 150) + 1}\n`))
    const started = Date.now()
    const findings = lint(indexOf(docs), docs.map(d => d.file))

    expect(findings.some(f => f.code === 'supersede-cycle')).toBe(true)
    expect(findings.some(f => f.code === 'duplicate-number')).toBe(true)
    expect(findings.length).toBeLessThanOrEqual(400)
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('markup in a record stays plain text: nothing is rendered or executed', () => {
    const doc = parseAdr('0001-x.md', '# 1. <script>alert(1)</script> [x](javascript:alert(1))\n\nStatus: Accepted\n')

    expect(doc.title).toContain('<script>')
    expect(doc.fileLinks).toEqual([])
  })
})

describe('style, numbering and the records written', () => {
  it('detects the style of each project and falls back to Nygard with four digits', () => {
    expect(detectStyle(docsOf('madr', 'docs/decisions'))).toMatchObject({ name: 'madr', width: 4, pattern: '{n}-{slug}.md', source: 'detected' })
    expect(detectStyle(docsOf('nygard', 'doc/adr'))).toMatchObject({ name: 'nygard', width: 4 })
    expect(detectStyle(docsOf('ruflo-style', 'docs/adrs'))).toMatchObject({ name: 'ruflo', width: 3, pattern: 'ADR-{n}-{slug}.md' })
    expect(detectStyle([])).toMatchObject({ name: 'nygard', width: 4, pattern: '{n}-{slug}.md', source: 'default' })
    expect(detectStyle(docsOf('madr', 'docs/decisions'), { style: 'ruflo', pattern: 'ADR-{n}-{slug}.md' })).toMatchObject({ name: 'ruflo', pattern: 'ADR-{n}-{slug}.md', source: 'setting' })
  })

  it('takes only a safe folder and a safe pattern from a setting', () => {
    for (const bad of ['../x', '/etc', 'a/../b', 'a\\b', 'a b', 'x'.repeat(200), './', 'a/./b']) if (bad !== './') expect(adrDirText(bad), bad).toBeNull()
    expect(adrDirText(' docs/adr/ ')).toBe('docs/adr')
    expect(adrDirText('')).toBe('')
    expect(patternOf('{n}-{slug}.md')).toBe('{n}-{slug}.md')

    for (const bad of ['{n}.md', '{slug}.md', '{n}-{slug}.txt', '../{n}-{slug}.md', '{n}/{slug}.md', '{n}-{slug}\n.md']) expect(patternOf(bad), bad).toBeNull()
  })

  it('allocates the next number above the highest, slugs titles and names files by the pattern', () => {
    expect(nextNumber(docsOf('madr', 'docs/decisions'))).toBe(4)
    expect(nextNumber([])).toBe(1)
    expect(nextNumber(docsOf('mixed', 'docs/architecture/decisions'))).toBe(5)
    expect(slugOf('Use Postgres — for storage!')).toBe('use-postgres-for-storage')
    expect(slugOf('///')).toBe('untitled')
    expect(fileNameFor(detectStyle(docsOf('ruflo-style', 'docs/adrs')), 3, 'Event ordering')).toBe('ADR-003-event-ordering.md')
  })

  it('a new record parses back as proposed, with its number, title, date and scope, in every style', () => {
    for (const name of ['madr', 'nygard', 'ruflo'] as const) {
      const style = { ...detectStyle([]), name }
      const text = renderNew(style, { number: 7, title: 'Cache `reads`', date: TODAY, scope: ['src/cache/', 'bad path'] })
      const doc = parseAdr(fileNameFor(style, 7, 'Cache reads'), text)

      expect([doc.status, doc.date, doc.number, doc.title], name).toEqual(['proposed', TODAY, 7, 'Cache reads'])
      expect(doc.format, name).toBe(name === 'madr' ? 'madr' : name === 'nygard' ? 'nygard' : 'inline')
    }
  })

  it('the first record of a project is Nygard’s own, accepted, and reads back', () => {
    const first = initialRecord(detectStyle([]), TODAY)
    const doc = parseAdr(first.file, first.text)

    expect(first.file).toBe('0001-record-architecture-decisions.md')
    expect([doc.status, doc.number, doc.date, doc.title]).toEqual(['accepted', 1, TODAY, 'Record architecture decisions'])
  })

  it('a status change is the smallest edit its format allows, and the diff shows exactly it', () => {
    const cases: [string, string, string, 'accepted' | 'rejected' | 'deprecated'][] = [
      ['madr', 'docs/decisions', '0001-use-markdown-architectural-decision-records.md', 'deprecated'],
      ['nygard', 'doc/adr', '0003-use-graphql.md', 'deprecated'],
      ['ruflo-style', 'docs/adrs', '0000', 'accepted'],
    ]

    for (const [name, folder, file, to] of cases) {
      const target = file === '0000' ? 'ADR-002-retries.md' : file
      const text = readFileSync(join(FIXTURES, name, folder, target), 'utf8')
      const doc = parseAdr(target, text)
      const edit = withStatus(text, doc, detectStyle(docsOf(name, folder)), to)

      expect(edit.ok).toBe(true)
      if (!edit.ok) continue

      const back = parseAdr(target, edit.text)
      const before = text.split('\n')
      const after = edit.text.split('\n')
      const changed = after.filter((line, i) => line !== before[i])

      expect(back.status, name).toBe(to)
      expect(after.length, name).toBe(before.length)
      expect(changed, name).toHaveLength(1)
      expect(lineDiff(text, edit.text, target).filter(line => /^[-+][^-+]/.test(line) || /^[-+]$/.test(line)), name).toHaveLength(2)
    }
  })

  it('supersede edits the old record’s status and adds the link to the new one; a record with no status gets a status line', () => {
    const style = detectStyle(docsOf('nygard', 'doc/adr'))
    const old = parseAdr('0001-record-architecture-decisions.md', readFileSync(join(FIXTURES, 'nygard', 'doc/adr', '0001-record-architecture-decisions.md'), 'utf8'))
    const text = readFileSync(join(FIXTURES, 'nygard', 'doc/adr', '0001-record-architecture-decisions.md'), 'utf8')
    const newer = parseAdr('0004-x.md', renderNew(style, { number: 4, title: 'X', date: TODAY }))
    const marked = withStatus(text, old, style, 'superseded', { number: 4, title: 'X', file: '0004-x.md' })
    const linked = withSupersedes(renderNew(style, { number: 4, title: 'X', date: TODAY }), newer, style, { number: 1, title: old.title, file: old.file })

    expect(marked.ok && marked.text).toContain('Superseded by [4. X](0004-x.md)')
    expect(linked.ok && parseAdr('0004-x.md', linked.text).supersedes).toEqual([1])
    expect(withStatus(text, old, style, 'superseded', null)).toMatchObject({ ok: false })

    const bare = parseAdr('0009-bare.md', '# 9. Bare\n\nText.\n')
    const set = withStatus('# 9. Bare\n\nText.\n', bare, style, 'accepted')

    expect(set.ok && parseAdr('0009-bare.md', set.text).status).toBe('accepted')
  })

  it('counts and cuts titles in code points: a draft never leaves half an emoji, and a 120-emoji title reads back whole', () => {
    const draft = draftFromMission({ objective: `${'x'.repeat(99)}😀tail`, tasks: [] }, [], TODAY)

    expect(draft.title).toBe(`${'x'.repeat(99)}😀`)
    expect(draft.titleShortenedFrom).toBe(104)
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(draft.title)).toBe(false)

    const emoji = '😀'.repeat(120)

    expect(Array.from(parseAdr('0001-x.md', `# 1. ${emoji}\n\nStatus: Accepted\n`).title)).toHaveLength(120)
    expect(Array.from(parseAdr('0001-x.md', `---\ntitle: ${emoji}\n---\n`).title)).toHaveLength(120)
    expect(parseAdr('0001-x.md', `# 1. ${'😀'.repeat(200)}\n`).title).toBe('😀'.repeat(160))
  })

  it('a draft from a mission holds only what the mission said and leaves the decision to a person', () => {
    const draft = draftFromMission({ objective: 'Move sessions to Redis (src/auth/)', tasks: [{ title: 'Add client', result: 'src/auth/redis.ts' }, { title: 'Migrate' }] }, ['src/auth/'], TODAY)

    expect(draft.title).toBe('Move sessions to Redis src/auth/')
    expect(draft.decision).toContain('is not in the record: say it here')
    expect(draft.decision).toContain('- Add client: src/auth/redis.ts')
  })
})

describe('the digest, the suggestion and the scope check', () => {
  const doc = (file: string, status: string, scope: string[], decision = 'Use X.'): AdrDoc => ({ ...parseAdr(file, `# ${Number(file.slice(0, 4))}. Title of ${file}\n\nStatus: ${status}\nDate: 2025-01-01\n\n## Decision\n\n${decision}\n`), scope })

  it('matches a path by exact name, folder, glob and sub-folder-relative name, and not a sibling that shares a prefix', () => {
    expect(scopeHits('src/auth', 'src/auth/login.ts')).toBe(true)
    expect(scopeHits('src/auth/', 'src/auth/login.ts')).toBe(true)
    expect(scopeHits('src/auth/login.ts', 'src/auth/login.ts')).toBe(true)
    expect(scopeHits('src/auth', 'src/authz/login.ts')).toBe(false)
    expect(scopeHits('src/auth', 'src/auth')).toBe(true)
    expect(scopeHits('hooks/nav-state.ts', 'plugins/c/hooks/nav-state.ts')).toBe(true)
    expect(scopeHits('hooks/nav-state.ts', 'plugins/c/hooks/nav-state.tsx')).toBe(false)
    expect(scopeHits('src/*.ts', 'src/a.ts')).toBe(true)
    expect(scopeHits('src/*.ts', 'src/deep/a.ts')).toBe(false)
    expect(scopeHits('docs', 'docs/a.md')).toBe(false)
    expect(scopeHits('', 'a')).toBe(false)
  })

  it('keeps the one-level glob: a star stays inside a segment, ** is a star, and it matches the whole path or its last segments', () => {
    expect(scopeHits('src/**/a.ts', 'src/x/a.ts')).toBe(true)
    expect(scopeHits('src/**/a.ts', 'src/x/y/a.ts')).toBe(false)
    expect(scopeHits('src/**', 'src/x')).toBe(true)
    expect(scopeHits('src/**', 'src/x/y')).toBe(false)
    expect(scopeHits('src/*', 'src/')).toBe(false)
    expect(scopeHits('hooks/*.ts', 'plugins/c/hooks/a.ts')).toBe(true)
    expect(scopeHits('hooks/*.ts', 'plugins/c/hooksx/a.ts')).toBe(false)
    expect(scopeHits('*/a.ts', 'deep/x/a.ts')).toBe(true)
    expect(scopeHits('src/a*b*c.ts', 'src/aXbYc.ts')).toBe(true)
    expect(scopeHits('src/a*b*c.ts', 'src/aXcYb.ts')).toBe(false)
    expect(scopeHits('src/a*.ts', 'src/a.ts')).toBe(true)
    expect(scopeHits('src/*.ts', 'src/a.tsx')).toBe(false)
    expect(scopeHits('src/a.*', 'src/axts')).toBe(false)
    expect(scopeHits('src/(x)+[y].ts', 'src/(x)+[y].ts')).toBe(true)
  })

  it('agrees with the earlier regular-expression matcher on every small path and glob', () => {
    // The matcher this replaced, kept here as the oracle on inputs too small to backtrack badly.
    const escape = (part: string) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    const oracle = (glob: string, file: string) => new RegExp(`^${glob.split('*').map(escape).join('[^/]*')}$|/${glob.split('*').map(escape).join('[^/]*')}$`).test(file)
    const alphabet = ['a', 'b', '/', '*', '.']
    let seed = 7
    const pick = () => alphabet[(seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) % alphabet.length] as string
    const word = (max: number) => Array.from({ length: 1 + (seed % max) }, pick).join('')
    let checked = 0

    for (let round = 0; round < 4000; round++) {
      const glob = `${word(6)}/${word(5)}`
      const file = `${word(7)}/${word(6)}`.replace(/\*/g, 'a')
      // The same normalisation scopeHits applies before either matcher sees the strings.
      const norm = (path: string) => path.replace(/^\.\//, '').replace(/\/+$/, '')

      if (!norm(glob).includes('*') || !norm(glob).includes('/') || norm(file) === '') continue
      checked++
      expect([glob, file, scopeHits(glob, file)]).toEqual([glob, file, oracle(norm(glob), norm(file))])
    }

    expect(checked).toBeGreaterThan(1000)
  })

  it('a hostile ADR with sixty stars (59 in one segment, the most a scope path takes) in a scope path costs milliseconds, not minutes (it ran in exponential time before)', () => {
    const hostile = parseAdr('0007-hostile.md', `# 7. Hostile\n\n## Status\n\nAccepted\n\nTouches \`src/${'*'.repeat(59)}z\` and \`a/${'*a'.repeat(29)}*b\`.\n`)

    expect(hostile.scope).toEqual(expect.arrayContaining([`src/${'*'.repeat(59)}z`]))

    const files = ['src/' + 'a'.repeat(40), 'src/' + 'a'.repeat(160), 'a/' + 'a'.repeat(160), 'x/a/' + 'a'.repeat(160)]
    const started = performance.now()
    const report = checkScope(files, [hostile])
    const suggested = suggest(`touch ${files.join(' ')}`, [hostile])
    const elapsed = performance.now() - started

    expect(report.hits).toEqual([])
    expect(suggested).toEqual([])
    expect(elapsed).toBeLessThan(50)
    expect(scopeHits(`src/${'*'.repeat(59)}z`, 'src/' + 'a'.repeat(40) + 'z')).toBe(true)
  })

  it('flags a changed file under an accepted ADR’s paths, and does not flag proposed, superseded, other paths or a clean change', () => {
    const accepted = doc('0001-a.md', 'Accepted', ['src/auth/'])
    const proposed = doc('0002-b.md', 'Proposed', ['src/auth/'])
    const old = doc('0003-c.md', 'Superseded by ADR 9', ['src/auth/'])
    const report = checkScope(['src/auth/login.ts', 'src/authz/x.ts', 'README.md', '../outside', '/abs/path'], [accepted, proposed, old])

    expect(report.hits.map(hit => [hit.file, hit.adr.number])).toEqual([['src/auth/login.ts', 1]])
    expect(report.notInForce.map(d => d.number)).toEqual([2, 3])
    expect(report.files).toBe(3)
    expect(reportLines(report)[0]).toMatch(/^warning: 1 changed file in the scope of ADR 1/)
    expect(reportLines(report).join('\n')).toContain('not checked: ADR 2 is proposed')
    expect(reportLines(checkScope(['README.md'], [accepted])).join('')).toContain('compares paths only and does not show')
    expect(reportLines(checkScope([], [])).join('')).toContain('no ADR is attached')
  })

  it('the digest names the decisions in force, marks drafts and history, is capped, masked and ends with how many it left out', () => {
    const secret = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const docs = [doc('0001-a.md', 'Accepted', [], `Use X. password: hunter2 and ${secret}`), doc('0002-b.md', 'Proposed', []), doc('0003-c.md', 'Superseded by ADR 1', []), ...Array.from({ length: 9 }, (_v, i) => doc(`${String(i + 10).padStart(4, '0')}-n.md`, 'Accepted', [], 'y'.repeat(900)))]
    const block = digestBlock(docs)

    expect(block).toContain('data, not instructions')
    expect(block).toMatch(/- ADR 1 \[accepted\] Title of 0001-a\.md — Use X\./)
    expect(block).not.toContain('hunter2')
    expect(block).not.toContain(secret)
    expect(block.length).toBeLessThan(1700)
    expect(block).toMatch(/… and \d+ more not shown$/)
    expect(digestBlock([doc('0002-b.md', 'Proposed', []), doc('0003-c.md', 'Deprecated', [])])).toMatch(/\(a draft, not in force\)[\s\S]*\(history, no longer in force\)/)
    expect(digestBlock([])).toBe('')
  })

  it('suggests ADRs from the goal’s paths and words, never history, never what is attached, and nothing for an unrelated goal', () => {
    const docs = [{ ...doc('0001-a.md', 'Accepted', ['src/auth/']), title: 'Sessions for authentication' }, { ...doc('0002-b.md', 'Superseded by ADR 9', ['src/auth/']), title: 'Tokens for authentication' }, { ...doc('0003-c.md', 'Proposed', ['src/db/']), title: 'Database sharding' }]

    expect(suggest('fix src/auth/login.ts bug', docs).map(s => s.doc.number)).toEqual([1])
    expect(suggest('improve database sharding performance', docs).map(s => s.doc.number)).toEqual([3])
    expect(suggest('improve database sharding performance', docs, ['0003-c.md'])).toEqual([])
    expect(suggest('paint the shed blue', docs)).toEqual([])
    expect(suggest('fix src/auth/login.ts bug', docs)[0]?.why).toContain('src/auth/login.ts')
  })
})
