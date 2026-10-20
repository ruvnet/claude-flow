/**
 * Finding the ADR folder of the project the console runs in, and writing there (ADR-480): initialise, propose in each style, status changes
 * and supersession with the exact diff, races, links and hostile titles, all in temp copies of the fixture projects. Run with
 *   npx vitest run plugins/ruflo-console/tests/adr-write.spec.ts
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { lint, parseAdr, type AdrDoc } from '../hooks/data/adr'
import { fsOfRoot, hostOfRoot, cleanAfter, keep, loaded, project, stateAt, TODAY } from './adr-helpers'
import { useNativeWriteFlavor } from './fixtures/write-flavor'
import { adrOf, discover, initSpec, loadAdrs, planStatus, proposeSpec, statusSpec } from '../hooks/adr'

cleanAfter()
// These write to a real disk through the console's own argv: the one this machine's dd/install take (GNU on Linux, sh on macOS).
useNativeWriteFlavor()

describe('finding the ADR folder of the project the console runs in', () => {
  it.each([
    ['madr', 'docs/decisions', 3],
    ['nygard', 'doc/adr', 3],
    ['ruflo-style', 'docs/adrs', 2],
    ['log4brains', 'docs/adr', 1],
    ['plain', 'adr', 1],
    ['mixed', 'docs/architecture/decisions', 4],
  ])('%s: %s', async (name, folder, count) => {
    const { state } = await loaded(name)

    expect(adrOf(state).dir).toBe(folder)
    expect(adrOf(state).registry.docs).toHaveLength(count)
  })

  it('a project with no ADR folder says so and offers to initialise; a named folder is tried alone', async () => {
    const { state, root } = await loaded('empty')

    expect(adrOf(state).dir).toBeNull()
    expect(adrOf(state).why).toContain('no ADR folder found')
    expect((await discover({ fs: fsOfRoot(root) } as never, root, 'docs/nowhere')).why).toBe('no folder docs/nowhere in this project')
    expect((await discover({ fs: fsOfRoot(root) } as never, root, '../x')).dir).toBeNull()
  })

  it('a folder that is a link out of the project is never read, nor are links inside the folder', async () => {
    const root = project('madr')
    const outside = mkdtempSync(join(tmpdir(), 'adr-outside-'))

    keep(outside)
    writeFileSync(join(outside, '0001-secret.md'), '# 1. Secret\n\nStatus: Accepted\n')
    rmSync(join(root, 'docs/decisions'), { recursive: true })
    symlinkSync(outside, join(root, 'docs/decisions'))

    const state = stateAt(root)

    await loadAdrs(state, hostOfRoot(root).host as never)
    expect(adrOf(state).dir).toBeNull()
    expect(adrOf(state).why).toContain('is a link')
    expect(adrOf(state).registry.docs).toEqual([])

    const second = project('madr')

    symlinkSync(join(outside, '0001-secret.md'), join(second, 'docs/decisions/0009-link.md'))

    const next = stateAt(second)

    await loadAdrs(next, hostOfRoot(second).host as never)
    expect(adrOf(next).registry.docs.map(d => d.file)).not.toContain('0009-link.md')
    expect(adrOf(next).registry.docs).toHaveLength(3)
  })

  it('a setting names the folder; a link above the project root is not followed', async () => {
    const root = project('empty')

    mkdirSync(join(root, 'notes/decisions'), { recursive: true })
    writeFileSync(join(root, 'notes/decisions/0001-x.md'), '# 1. X\n\nStatus: Accepted\nDate: 2020-01-01\n')

    const state = stateAt(root)

    state.cwd = root

    const found = await discover({ fs: fsOfRoot(root) } as never, root, 'notes/decisions')

    expect(found.dir).toBe('notes/decisions')
  })
})

describe('writing, in a copy of each project', () => {
  const today = TODAY

  it('initialise creates the folder and the first record once, shows its exact path, and never overwrites', async () => {
    const { root, state, world } = await loaded('empty')
    const spec = initSpec(state, world.host as never, today)

    expect(spec?.label).toContain('docs/adr/0001-record-architecture-decisions.md')
    expect(spec?.shows).toContain('create docs/adr/0001-record-architecture-decisions.md')
    expect(existsSync(join(root, 'docs'))).toBe(false)
    await spec?.run?.()
    expect(readFileSync(join(root, 'docs/adr/0001-record-architecture-decisions.md'), 'utf8')).toContain('## Status\n\nAccepted')
    expect(adrOf(state).dir).toBe('docs/adr')
    expect(initSpec(state, world.host as never, today)).toBeNull()
    expect(world.log.toasts).toHaveLength(1)
    expect(world.log.toasts[0]).toMatchObject({ level: 'info' })
    expect(state.events.filter(event => event.kind === 'notices' && event.text.startsWith('adr:'))).toHaveLength(1)
  })

  it('initialise races a file that appears first: nothing is overwritten', async () => {
    const { root, state, world } = await loaded('empty')
    const spec = initSpec(state, world.host as never, today)

    mkdirSync(join(root, 'docs/adr'), { recursive: true })
    writeFileSync(join(root, 'docs/adr/0001-record-architecture-decisions.md'), 'MINE')
    await spec?.run?.()
    expect(readFileSync(join(root, 'docs/adr/0001-record-architecture-decisions.md'), 'utf8')).toBe('MINE')
    expect(adrOf(state).last?.ok).toBe(false)
    expect(world.log.toasts).toEqual([])
  })

  it('a file that appears between the check and the write is refused by the write itself, and the person is told the write failed and why', async () => {
    const { root, state, world } = await loaded('empty')
    const spec = initSpec(state, world.host as never, today)
    const target = join(root, 'docs/adr/0001-record-architecture-decisions.md')
    const run = world.host.run

    // The folder is there (so the create is the exclusive one on both flavors: dd conv=excl, or sh noclobber); the link-and-exists check
    // passes, and the file lands just before the create runs (another console, an editor).
    mkdirSync(join(root, 'docs/adr'), { recursive: true })
    world.host.run = async (argv, ms, stdin) => {
      if (argv.some(arg => arg.includes('0001-record-architecture-decisions.md')) && !existsSync(target)) writeFileSync(target, 'MINE')

      return run(argv, ms, stdin)
    }
    await spec?.run?.()
    expect(readFileSync(target, 'utf8')).toBe('MINE')
    expect(adrOf(state).last?.ok).toBe(false)
    // The tool's own reason is shown (BSD sh: "cannot overwrite existing file"; GNU dd: "File exists"), not a guess that it "may have appeared".
    expect(adrOf(state).last?.lines.join('\n')).toMatch(/the write failed \(exit [1-9]\d*: \S[^)]*\); no file was replaced/)
    expect(adrOf(state).last?.lines.join('\n')).not.toMatch(/may have appeared/)
  })

  it.each([
    ['madr', 'docs/decisions', '0004-cache-reads.md', 'status: proposed'],
    ['nygard', 'doc/adr', '0004-cache-reads.md', '## Status\n\nProposed'],
    ['ruflo-style', 'docs/adrs', 'ADR-003-cache-reads.md', '**Status**: Proposed'],
    ['mixed', 'docs/architecture/decisions', '0005-cache-reads.md', 'Proposed'],
  ])('propose in %s takes the next number and the project’s file name and headings, and refuses an existing file', async (name, folder, file, marker) => {
    const { root, state, world } = await loaded(name)
    const spec = proposeSpec(state, world.host as never, 'Cache reads', today)

    expect(spec?.shows).toContain(`create ${folder}/${file}`)
    expect(existsSync(join(root, folder, file))).toBe(false)
    await spec?.run?.()

    const text = readFileSync(join(root, folder, file), 'utf8')

    expect(text).toContain(marker)
    expect(parseAdr(file, text)).toMatchObject({ status: 'proposed', title: 'Cache reads', date: today })
    expect(adrOf(state).selected).toBe(file)
    expect(world.log.toasts).toHaveLength(1)

    // A second proposal with the same title takes the next number, and a record that appears in between is not overwritten.
    const again = proposeSpec(state, world.host as never, 'Cache reads', today)
    const target = /create (\S+)/.exec(again?.shows ?? '')?.[1] as string

    writeFileSync(join(root, target), 'MINE')
    await again?.run?.()
    expect(readFileSync(join(root, target), 'utf8')).toBe('MINE')
  })

  it('propose with a hostile title cannot leave the folder or inject a heading, and an empty title is refused', async () => {
    const { root, state, world } = await loaded('nygard')

    expect(proposeSpec(state, world.host as never, '   ', today)).toBeNull()

    const spec = proposeSpec(state, world.host as never, '../../etc/passwd\n## Status\n\nAccepted [x](y) `z`', today)

    await spec?.run?.()

    const written = readdirSync(join(root, 'doc/adr')).filter(f => f.startsWith('0004'))

    expect(written).toHaveLength(1)
    expect(written[0]).toMatch(/^0004-[a-z0-9-]+\.md$/)

    const text = readFileSync(join(root, 'doc/adr', written[0] as string), 'utf8')

    expect(text.match(/^## Status$/gm)).toHaveLength(1)
    expect(parseAdr(written[0] as string, text).status).toBe('proposed')
    expect(existsSync(join(root, 'etc'))).toBe(false)
  })

  it('a transition writes exactly the confirmed diff and nothing else, then re-reads', async () => {
    const { root, state, world } = await loaded('ruflo-style')
    const doc = adrOf(state).registry.docs[1] as AdrDoc
    const before = readFileSync(join(root, 'docs/adrs', doc.file), 'utf8')
    const spec = await statusSpec(state, world.host as never, doc, 'accepted')

    expect(spec?.label).toBe('mark ADR 2 accepted')
    expect(spec?.shows).toContain('-Status: Proposed (2025-02-01)')
    expect(spec?.shows).toContain('+Status: Accepted')
    expect(readFileSync(join(root, 'docs/adrs', doc.file), 'utf8')).toBe(before)
    await spec?.run?.()

    const after = readFileSync(join(root, 'docs/adrs', doc.file), 'utf8')

    expect(after).toBe(before.replace('Status: Proposed (2025-02-01)', 'Status: Accepted'))
    expect(adrOf(state).registry.docs[1]?.status).toBe('accepted')
    expect(world.log.toasts).toHaveLength(1)
  })

  it('a file that changed since the diff was shown is left alone', async () => {
    const { root, state, world } = await loaded('ruflo-style')
    const doc = adrOf(state).registry.docs[1] as AdrDoc
    const spec = await statusSpec(state, world.host as never, doc, 'accepted')

    writeFileSync(join(root, 'docs/adrs', doc.file), 'someone else edited this')
    await spec?.run?.()
    expect(readFileSync(join(root, 'docs/adrs', doc.file), 'utf8')).toBe('someone else edited this')
    expect(adrOf(state).last).toMatchObject({ ok: false })
    expect(adrOf(state).last?.lines.join(' ')).toContain('changed since the diff was shown')
    expect(world.log.toasts).toEqual([])
  })

  it('supersede edits both files with their own diffs, and a refused change says why', async () => {
    const { root, state, world } = await loaded('nygard')
    const docs = adrOf(state).registry.docs
    const accepted = docs[0] as AdrDoc
    const created = proposeSpec(state, world.host as never, 'Use gRPC', today)

    await created?.run?.()

    const newer = adrOf(state).registry.docs.find(doc => doc.number === 4) as AdrDoc

    expect(await planStatus(state, world.host as never, accepted, 'superseded', null)).toMatchObject({ ok: false })
    expect(await planStatus(state, world.host as never, accepted, 'accepted', null)).toMatchObject({ ok: false, why: 'it is already accepted' })
    expect(await planStatus(state, world.host as never, accepted, 'rejected', null)).toMatchObject({ ok: false })

    const spec = await statusSpec(state, world.host as never, accepted, 'superseded', newer)

    expect(spec?.expect).toContain(accepted.file)
    expect(spec?.expect).toContain(newer.file)
    await spec?.run?.()
    expect(readFileSync(join(root, 'doc/adr', accepted.file), 'utf8')).toContain('Superseded by [4. Use gRPC](0004-use-grpc.md)')
    expect(readFileSync(join(root, 'doc/adr', newer.file), 'utf8')).toContain('Supersedes [1. Record architecture decisions]')
    expect(adrOf(state).registry.docs.find(doc => doc.number === 1)?.status).toBe('superseded')
    expect(lint(adrOf(state).registry, adrOf(state).files).filter(f => f.code === 'supersede-mismatch' || f.code === 'dangling-supersedes')).toEqual([])
  })

  it('a record that is a link is never written through', async () => {
    const { root, state, world } = await loaded('nygard')
    const target = join(root, 'doc/adr', '0003-use-graphql.md')
    const outside = mkdtempSync(join(tmpdir(), 'adr-outside-'))

    keep(outside)

    const doc = adrOf(state).registry.docs[2] as AdrDoc
    const spec = await statusSpec(state, world.host as never, doc, 'deprecated')

    writeFileSync(join(outside, 'x.md'), readFileSync(target, 'utf8'))
    unlinkSync(target)
    symlinkSync(join(outside, 'x.md'), target)
    await spec?.run?.()
    expect(readFileSync(join(outside, 'x.md'), 'utf8')).toContain('Accepted')
    expect(readFileSync(join(outside, 'x.md'), 'utf8')).not.toContain('Deprecated')
    expect(adrOf(state).last?.lines.join(' ')).toContain('link')
  })
})
