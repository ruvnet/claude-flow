/**
 * The ruRE page (ADR-494) under vitest: the catalog against the real tool schemas, what the `sample` field refuses, the readers
 * against what the real CLI printed (tests/fixtures/rure/*.txt are captured `ruflo mcp exec` runs, not hand-written JSON), a hostile
 * answer, the page itself, its palette ids and Enter routing, and its guide. Run with
 *   npx vitest run plugins/ruflo-console/tests/rure-page.spec.ts
 * The same entries against the real built CLI: tests/rure-e2e.spec.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { devLines, emptyFields, fieldValue, type DevFields } from '../hooks/data/devtools'
import { NO_TOOLS, RE_MAX_LINES } from '../hooks/data/rure'
import { DEV, DEV_GROUPS, devPalette, devSpec, devWhy, devtoolsActions } from '../hooks/devtools'
import { VIEW_TOPIC } from '../hooks/help-docs'
import { topicById } from '../hooks/help-topics'
import type { Host } from '../hooks/host'
import { groupOf, NAV_GROUPS } from '../hooks/nav-state'
import { RURE, RURE_GROUPS } from '../hooks/rure'
import { newState, VIEWS } from '../hooks/state'
import { devtoolsView } from '../hooks/views/devtools'
import type { Ctx } from '../hooks/views/common'
import { GROUPS } from '../hooks/views/menu'
import { rureView } from '../hooks/views/rure'

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', 'rure', `${name}.txt`), 'utf8')
const fields = (over: Partial<DevFields>): DevFields => ({ ...emptyFields(), ...over })
const entry = (id: string) => DEV.find(candidate => candidate.id === id)!
const params = (id: string, over: Partial<DevFields>): Record<string, unknown> | null => {
  const argv = devSpec(entry(id), fields(over))?.args

  return argv === undefined ? null : (JSON.parse(argv[5] ?? 'null') as Record<string, unknown>)
}
const linesOf = (id: string, name: string): string => devLines(id, fixture(name), '').join('\n')

/** What `ruflo mcp exec` prints around an answer, for a hand-made one. */
const wrapped = (inner: unknown, isError = false) => `[INFO] Executing tool: x\n[OK] Tool executed in 6ms\nResult:\n${JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(inner) }], ...(isError && { isError: true }) }, null, 2)}\n`

describe('the ruRE catalog', () => {
  it('has the seven tools and DETECT, each with a unique dt-re- id, in a ruRE group, and the groups have rows', () => {
    expect(RURE.map(item => item.id)).toEqual(['dt-re-auto', 'dt-re-asar', 'dt-re-js', 'dt-re-find', 'dt-re-bin', 'dt-re-net', 'dt-re-cuda', 'dt-re-evm'])
    expect(RURE.every(item => DEV.includes(item))).toBe(true)
    expect(RURE_GROUPS.every(group => DEV_GROUPS.some(known => known.id === group.id) && RURE.some(item => item.group === group.id))).toBe(true)
  })

  it('reads at once, except unpacking an .asar, which writes and says so', () => {
    for (const item of RURE) {
      const spec = devSpec(item, fields({ sample: 'app/x', query: 'license' }))

      expect(spec?.isReadOnly === true, item.id).toBe(item.id !== 'dt-re-asar')
    }

    const asar = devSpec(entry('dt-re-asar'), fields({ sample: 'app/app.asar' }))

    expect(asar?.declared).toBe('write')
    expect(asar?.note).toMatch(/outside the project/)
  })

  it('calls the right tool with the sample, and find also with the feature', () => {
    expect(params('dt-re-asar', { sample: 'a/app.asar' })).toEqual({ path: 'a/app.asar' })
    expect(params('dt-re-js', { sample: 'src' })).toEqual({ path: 'src' })
    expect(params('dt-re-find', { sample: 'src', query: 'license check' })).toEqual({ path: 'src', query: 'license check' })
    expect(params('dt-re-bin', { sample: 'bin/tool' })).toEqual({ path: 'bin/tool', includeStrings: true })
    expect(params('dt-re-net', { sample: 'lib/a.dll' })).toEqual({ path: 'lib/a.dll' })
    expect(params('dt-re-evm', { sample: 'c/token.bin' })).toEqual({ path: 'c/token.bin' })
    expect(params('dt-re-cuda', { sample: 'gpu/app' })).toEqual({ path: 'gpu/app' })
    expect(devSpec(entry('dt-re-bin'), fields({ sample: 'bin/tool' }))?.args.slice(0, 4)).toEqual(['mcp', 'exec', '-t', 'rure_analyze_binary'])
  })

  it('the sample is a path inside the project: nothing outside it, no flag, no escape', () => {
    for (const bad of ['/etc/passwd', '../secret', 'a/../../b', '-rf', '--help', 'a//b', '~/x', 'C:\\Windows\\x', 'a\nb', 'a b', '', 'x'.repeat(200)]) {
      expect(fieldValue('sample', bad), JSON.stringify(bad)).toBeNull()
      expect(devSpec(entry('dt-re-bin'), fields({ sample: bad })), JSON.stringify(bad)).toBeNull()
    }

    expect(fieldValue('sample', 'app/resources/app.asar')).toBe('app/resources/app.asar')
    expect(fieldValue('sample', '.cache/tool.exe')).toBe('.cache/tool.exe')
  })

  it('an empty sample blocks the row and names the field; find also needs the feature', () => {
    expect(devSpec(entry('dt-re-bin'), emptyFields())).toBeNull()
    expect(devWhy(entry('dt-re-bin'), emptyFields())).toMatch(/^sample field is empty: type it in the field above, then ▶ run: a file or folder under the project/)
    expect(devSpec(entry('dt-re-find'), fields({ sample: 'src' }))).toBeNull()
    expect(devWhy(entry('dt-re-find'), fields({ sample: 'src' }))).toMatch(/^query field/)
  })
})

describe('the readers, against what the real CLI printed', () => {
  it('a native binary: format, entry, libraries, imports, exports, sections and strings', () => {
    const elf = linesOf('dt-re-bin', 'binary-elf')

    expect(elf).toContain('ELF · x86-64 · 64-bit little-endian · shared-or-pie')
    expect(elf).toContain('entry 0x1040')
    expect(elf).toContain('libraries (1): libc.so.6')
    expect(elf).toContain('imports (1): puts')
    expect(elf).toContain('exports (1): exported_fn')
    expect(elf).toContain('.shstrtab 0x40+36')
    expect(elf).toContain('strings (6)')
    expect(linesOf('dt-re-bin', 'binary-pe')).toContain('imports (1): KERNEL32.dll!ExitProcess')
    expect(linesOf('dt-re-bin', 'binary-macho')).toContain('MACHO · aarch64')
    expect(linesOf('dt-re-bin', 'binary-macho')).toContain('/usr/lib/libSystem.B.dylib')
  })

  it('a .NET assembly: identity, references, types, P/Invoke and string literals, with a redacted one said', () => {
    const net = linesOf('dt-re-net', 'dotnet')

    expect(net).toContain('Demo 1.2.3.4 · runtime v4.0.30319')
    expect(net).toContain('references (1): System.Runtime 6.0.0.0')
    expect(net).toContain('types (2): <Module>, Foo.Bar')
    expect(net).toContain('P/Invoke (1): libnative!do_thing')
    expect(net).toContain('hello-dotnet')
    expect(net).toMatch(/1 value\(s\) hidden by AIDefence/)
  })

  it('EVM: selectors with names, hazards with offsets, events, a proxy and the compiler', () => {
    const evm = linesOf('dt-re-evm', 'evm')

    expect(evm).toContain('202 bytes · 79 instructions · 2 JUMPDEST')
    expect(evm).toContain('0xa9059cbb transfer(address,uint256) @6')
    expect(evm).toContain('0x12345678 (unknown) @17')
    expect(evm).toMatch(/hazards: .*SELFDESTRUCT ×1 @55/)
    expect(evm).toContain('Transfer(address,address,uint256)')
    expect(evm).toContain('compiler: solc 0.8.20')
    // plain() already marks a clipped value with one ellipsis: never two.
    expect(evm).not.toContain('……')
    expect(evm).toContain('Ownable: caller is not the owner')
    expect(linesOf('dt-re-evm', 'evm-proxy')).toContain('EIP-1167 minimal proxy → 0xbebebebebebebebebebebebebebebebebebebebe')
    expect(linesOf('dt-re-evm', 'evm-proxy')).toContain('selectors (0)')
  })

  it('a JS app and a feature search: the boundaries, the imports and where the match is', () => {
    const app = linesOf('dt-re-js', 'js-app')

    expect(app).toContain('Electron app · 1 files scanned · 1 modules')
    expect(app).toContain('Electron boundaries: ipcMain ×2 · require-electron ×1')
    expect(app).toContain('imports (2): electron, fs')

    const found = linesOf('dt-re-find', 'find')

    expect(found).toContain('1 match · 1 files scanned')
    expect(found).toContain('app/src/main.js:1-5 · score 2')
    expect(found).toContain("const { ipcMain, BrowserWindow } = require('electron');")
  })

  it('an unpacked .asar says where, and that the folder is outside the project', () => {
    const asar = linesOf('dt-re-asar', 'asar')

    expect(asar).toContain('extracted 2 files (257 bytes)')
    expect(asar).toContain('/tmp/ruflo-rure-asar-IeyRSI/unpacked')
    expect(asar).toMatch(/outside the project/)
  })

  it('a failed tool is one ✗ line with its reason; a CLI without the tools says to update', () => {
    expect(linesOf('dt-re-asar', 'asar-error')).toMatch(/^✗ asar extraction failed: ENOENT/)
    expect(devLines('dt-re-bin', '[INFO] Executing tool: rure_analyze_binary\n[ERROR] Tool not found: rure_analyze_binary\n', '')).toEqual([`✗ ${NO_TOOLS}`])
    expect(devLines('dt-re-bin', '', '[ERROR] Tool not found: rure_analyze_binary')).toEqual([`✗ ${NO_TOOLS}`])
  })

  it('shows a cut walk and a missing screen as warnings first', () => {
    const lines = devLines('dt-re-bin', wrapped({ success: true, format: 'elf', arch: 'x86-64', bits: 64, endianness: 'little', kind: 'executable', entryPoint: 1, sections: [], libraries: [], imports: [], exports: [], warnings: ['section table out of range'], truncated: true, redactedCount: 0, screened: false }))

    expect(lines[0]).toBe('⚠ section table out of range')
    expect(lines.join('\n')).toMatch(/truncated: a size or count cap was reached/)
    expect(lines.join('\n')).toMatch(/not screened: AIDefence was unavailable/)
  })
})

describe('a hostile file', () => {
  it('its section names, imports, strings and type names never put an escape or control character in a line', () => {
    const evil = '\u001b[31mRED\u001b[0m\u001b]52;c;aGk=\u0007\u202eTXT\u0000end'
    const answers: [string, unknown][] = [
      ['dt-re-bin', { success: true, format: evil, arch: evil, bits: 64, endianness: evil, kind: evil, entryPoint: 4096, sections: [{ name: evil, offset: 0, size: 1 }], libraries: [evil], imports: [evil], exports: [evil], strings: [{ value: evil, offset: 1 }], warnings: [evil], truncated: false, redactedCount: 0, screened: true }],
      ['dt-re-net', { success: true, isManaged: true, runtimeVersion: evil, assembly: { name: evil, version: evil }, assemblyRefs: [{ name: evil, version: evil }], typeCount: 1, types: [evil], methodCount: 1, pinvokes: [{ module: evil, function: evil }], userStrings: [evil], entryPointToken: 1, warnings: [evil], truncated: false, redactedCount: 0, screened: true }],
      ['dt-re-evm', { success: true, byteLength: 1, instructionCount: 1, jumpdestCount: 0, invalidOpcodeCount: 0, selectors: [{ selector: evil, name: evil, offset: 1 }], hazards: { [evil]: { count: 1, offsets: [1] } }, addresses: [evil], eventTopics: [{ topic: evil, name: evil, offset: 1 }], minimalProxy: { implementation: evil }, metadata: { solc: evil, ipfs: evil }, strings: [evil], warnings: [evil], truncated: false, redactedCount: 0, screened: true }],
      ['dt-re-js', { success: true, filesScanned: 1, isElectron: true, modules: [{ file: evil, imports: [{ source: evil }], exports: [], electronBoundaries: [{ kind: evil }] }], truncated: false, screened: true }],
      ['dt-re-find', { success: true, matches: [{ file: evil, lineRange: { start: 1, end: 2 }, snippet: evil, score: evil, redacted: false }], filesScanned: 1, truncated: false, screened: true }],
      ['dt-re-asar', { success: true, truncated: false, unpackedPath: evil, fileCount: 1, totalBytes: 1 }],
      ['dt-re-bin', { success: false, error: evil }],
    ]

    for (const [id, answer] of answers) {
      const lines = devLines(id, wrapped(answer))

      expect(lines.length, id).toBeGreaterThan(0)
      // eslint-disable-next-line no-control-regex
      for (const line of lines) expect(line, `${id}: ${JSON.stringify(line)}`).not.toMatch(/[\u0000-\u001f\u007f\u202a-\u202e]/)
    }
  })

  it('a huge answer is cut to the panel, and a number that is not a measurement reads n/a', () => {
    const many = Array.from({ length: 5000 }, (_, i) => `sym${i}`)
    const lines = devLines('dt-re-bin', wrapped({ success: true, format: 'elf', arch: 'x', bits: 1e300, endianness: 'little', kind: 'k', entryPoint: 1e300, sections: [], libraries: many, imports: many, exports: many, warnings: many, truncated: false, redactedCount: 0, screened: true }))

    expect(lines.length).toBeLessThanOrEqual(RE_MAX_LINES)
    expect(lines.join('\n')).toContain('n/a-bit')
    expect(lines.join('\n')).toContain('entry n/a')
    expect(lines.every(line => line.length < 400)).toBe(true)
  })
})

type El = { props: Record<string, unknown> }
const kit = { Box: (props: Record<string, unknown>): El => ({ props }), Text: (props: Record<string, unknown>): El => ({ props }), Button: (props: Record<string, unknown>): El => ({ props }), Input: (props: Record<string, unknown>): El => ({ props }) }
const flat = (el: unknown): El[] => {
  const node = el as El

  if (typeof node !== 'object' || node === null) return []

  const kids = node.props.children

  return [node, ...(Array.isArray(kids) ? kids.flatMap(flat) : typeof kids === 'object' ? flat(kids) : [])]
}
const words = (nodes: El[]): string => nodes.map(node => String(node.props.children ?? node.props.label ?? node.props.title ?? '')).join('\n')
const ctxOf = (state: ReturnType<typeof newState>, columns = 110) => ({ kit, state, nowMs: Date.now(), columns, pictures: new Map(), act: new Proxy({}, { get: () => () => undefined }) as never, cards: true }) as unknown as Ctx

describe('the page', () => {
  it('has both sections with their fields and all six rows, and says what it will and will not do', () => {
    const state = newState({})

    state.view = 'rure'

    const nodes = flat(rureView(ctxOf(state)))
    const text = words(nodes)
    const keys = nodes.map(node => String(node.props.key ?? ''))

    expect(text).toMatch(/the tools only parse it/)
    expect(text).toMatch(/unpacking an \.asar writes files, so it asks first/)
    expect(text).toMatch(/only files inside this project can be named; results are untrusted text/)
    for (const group of RURE_GROUPS) expect(text).toContain(group.title)
    expect(keys).toContain('dt-field-rure-app-sample')
    expect(keys).toContain('dt-field-rure-app-query')
    expect(keys).toContain('dt-field-rure-native-sample')
    for (const item of RURE) expect(keys, item.id).toContain(`dt-${item.id.slice(3)}`)
    expect(text).toMatch(/\/ruflo run dt-re-bin/)
  })

  it('is not drawn on the Dev Tools page, which still draws its own groups', () => {
    const state = newState({})

    state.view = 'devtools'

    const keys = flat(devtoolsView(ctxOf(state))).map(node => String(node.props.key ?? ''))

    expect(keys.some(key => key.startsWith('dt-re-') || key.includes('rure'))).toBe(false)
    expect(keys.some(key => key.startsWith('dt-diff') || key === 'dt-brain')).toBe(true)
  })

  it('is a TOOLS page with no hotkey, on the menu, with a guide that points at pages that exist', () => {
    const view = VIEWS.find(candidate => candidate.id === 'rure')

    expect(view?.key).toBe('')
    expect(groupOf('rure')).toBe('TOOLS')
    expect(NAV_GROUPS.find(group => group.title === 'TOOLS')?.rows.flat()).toContain('rure')
    expect(GROUPS.find(group => group.title === 'TOOLS')?.sections.flatMap(section => section.items).some(item => item.go === 'rure')).toBe(true)

    const topic = topicById('rure')!

    expect(VIEW_TOPIC.rure).toBe('rure')
    expect(topic.related).toContain('devtools')

    const known = new Set<string>(VIEWS.map(candidate => candidate.id))

    for (const step of topic.steps) if (step.go !== undefined && 'view' in step.go) expect(known.has(step.go.view)).toBe(true)

    expect(topic.steps.map(step => step.text).join(' ')).toMatch(/UNPACK \.ASAR asks first/)
    expect(topic.tips?.join(' ')).toMatch(/inside the project/)
  })
})

describe('headless and Enter', () => {
  it('every ruRE row is a palette id; its text fills the sample (find: the feature) before it builds the argv', () => {
    const state = newState({})
    const palette = devPalette(state).filter(item => item.id.startsWith('dt-re-'))

    expect(palette.map(item => item.id).sort()).toEqual(RURE.map(item => item.id).sort())

    const bin = palette.find(item => item.id === 'dt-re-bin')!
    const find = palette.find(item => item.id === 'dt-re-find')!

    expect(bin.run.kind).toBe('text')
    if (bin.run.kind === 'text') {
      expect(bin.run.make('bin/tool')?.args[3]).toBe('rure_analyze_binary')
      expect(state.devtools.fields.sample).toBe('bin/tool')
    }

    // The sample is kept, so find needs only the feature text.
    if (find.run.kind === 'text') {
      expect(find.run.make('license check')?.args[3]).toBe('rure_find_feature')
      expect(JSON.parse(find.run.make('license check')?.args[5] ?? '{}')).toEqual({ path: 'bin/tool', query: 'license check' })
    }

    // A path outside the project builds nothing and says the rule.
    if (bin.run.kind === 'text') {
      expect(bin.run.make('/etc/passwd')).toBeNull()
      expect(bin.run.why('/etc/passwd')).toMatch(/^sample field: a file or folder under the project/)
    }
  })

  it('Enter in a ruRE field runs that page’s row; the same query field elsewhere still runs the plugin search', () => {
    const state = newState({})
    const ran: string[] = []
    const host = { invalidate: () => undefined } as unknown as Host
    const actions = devtoolsActions(state, host, id => (ran.push(id), true), vi.fn())

    actions.submit('sample', 'src', 'rure-app')
    actions.submit('query', 'license', 'rure-app')
    actions.submit('sample', 'bin/tool', 'rure-native')
    actions.submit('query', 'neural', 'plugins')
    actions.submit('query', 'neural')
    expect(ran).toEqual(['dt-re-js', 'dt-re-find', 'dt-re-bin', 'dt-plug-search', 'dt-plug-search'])
  })

  it('Enter in the sample with a path outside the project refuses with the rule and runs nothing', () => {
    const state = newState({})
    const ran: string[] = []
    const refused: string[] = []
    const actions = devtoolsActions(state, { invalidate: () => undefined } as unknown as Host, id => (ran.push(id), true), why => refused.push(why))

    actions.submit('sample', '/etc/passwd', 'rure-native')
    expect(ran).toEqual([])
    expect(refused[0]).toMatch(/^sample field: a file or folder under the project/)
  })
})
