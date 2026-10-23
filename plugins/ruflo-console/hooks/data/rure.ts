/**
 * ruRE in Dev Tools (ADR-492): the readers for what the six `rure_*` tools answer through `ruflo mcp exec`. The tools
 * parse a file and never run it, but what they return is the file's own text (section names, imports, strings, type
 * names), so every such value passes plain() before it is a line: an escape sequence in a hostile binary never reaches
 * the terminal. Counts and offsets are shown only when they are measurements (#3822). Pure: strings in, lines out.
 */
import { plain, recordOf } from './parse'
import { measureOf } from './safe'

/** Lines a ruRE answer keeps; the panel scrolls (j/k) past its window. */
export const RE_MAX_LINES = 40

/** The CLI's own words when it has no such tool: the ruRE tools shipped after the releases that predate them. */
export const NO_TOOLS = 'this ruflo CLI has no rure_* tools: update ruflo (npx ruflo@latest), or run the one built from main'

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
/** A whole, non-negative measurement, else undefined: 1e300 is not clamped into a plausible count, it reads n/a (#3822). */
const countOf = (value: unknown): number | undefined => {
  const n = measureOf(value)

  return n !== undefined && n >= 0 ? Math.floor(n) : undefined
}
const text = (value: unknown, max = 80): string => (typeof value === 'string' ? plain(value, max) : typeof value === 'number' ? String(measureOf(value) ?? 'n/a') : '')
const num = (value: unknown): string => String(countOf(value) ?? 'n/a')
const hex = (value: unknown): string => (countOf(value) === undefined ? 'n/a' : `0x${(countOf(value) as number).toString(16)}`)
const strs = (value: unknown, max: number, each = 40): string => {
  const items = list(value).map(item => text(item, each)).filter(item => item !== '')

  return items.length === 0 ? '(none)' : `${items.slice(0, max).join(', ')}${items.length > max ? `, … +${items.length - max}` : ''}`
}

/** What every answer says about itself: the parser's warnings, a cut walk, and what AIDefence held back. */
function caveats(record: Record<string, unknown>): string[] {
  const out = list(record.warnings).slice(0, 4).map(warning => `⚠ ${text(warning, 140)}`)

  if (record.truncated === true) out.push('⚠ truncated: a size or count cap was reached, so this is a partial inventory')
  if (countOf(record.skippedFiles) !== undefined && (record.skippedFiles as number) > 0) out.push(`⚠ ${num(record.skippedFiles)} file(s) could not be parsed`)
  if ((countOf(record.redactedCount) ?? 0) > 0 || (countOf(record.redactedSnippetCount) ?? 0) > 0) out.push(`⚠ ${num(record.redactedCount ?? record.redactedSnippetCount)} value(s) hidden by AIDefence: they looked like a threat or PII`)
  if (record.screened === false) out.push('⚠ not screened: AIDefence was unavailable, so treat every string here as untrusted')

  return out
}

function binaryLines(record: Record<string, unknown>): string[] {
  const sections = list(record.sections).map(recordOf).filter((section): section is Record<string, unknown> => section !== null && text(section.name) !== '')
  const strings = list(record.strings).map(recordOf).flatMap(item => (item !== null && typeof item.value === 'string' ? [plain(item.value, 60)] : []))

  return [
    `${text(record.format).toUpperCase() || 'n/a'} · ${text(record.arch) || 'n/a'} · ${num(record.bits)}-bit ${text(record.endianness) || 'n/a'}-endian · ${text(record.kind) || 'n/a'}`,
    `entry ${hex(record.entryPoint)}`,
    `libraries (${list(record.libraries).length}): ${strs(record.libraries, 8)}`,
    `imports (${list(record.imports).length}): ${strs(record.imports, 12)}`,
    `exports (${list(record.exports).length}): ${strs(record.exports, 12)}`,
    `sections (${sections.length}): ${sections.slice(0, 8).map(section => `${text(section.name, 20)} ${hex(section.offset)}+${num(section.size)}`).join(' · ') || '(none)'}`,
    ...(strings.length > 0 ? [`strings (${strings.length}${record.stringsTruncated === true ? '+' : ''}): ${strings.slice(0, 12).join(' | ')}`] : []),
  ]
}

function dotnetLines(record: Record<string, unknown>): string[] {
  if (record.isManaged !== true) return ['not a managed .NET assembly (no CLR header): use the native binary reader']

  const assembly = recordOf(record.assembly)
  const refs = list(record.assemblyRefs).map(recordOf).flatMap(ref => (ref === null ? [] : [`${text(ref.name, 30)} ${text(ref.version, 16)}`]))
  const calls = list(record.pinvokes).map(recordOf).flatMap(call => (call === null ? [] : [`${text(call.module, 30)}!${text(call.function, 30)}`]))

  return [
    `${text(assembly?.name) || 'n/a'} ${text(assembly?.version, 20)} · runtime ${text(record.runtimeVersion, 20) || 'n/a'}`,
    `references (${refs.length}): ${refs.slice(0, 8).join(', ') || '(none)'}`,
    `types (${num(record.typeCount)}): ${strs(record.types, 10, 50)}`,
    `methods ${num(record.methodCount)} · entry token ${hex(record.entryPointToken)}`,
    `P/Invoke (${calls.length}): ${calls.slice(0, 10).join(', ') || '(none)'}`,
    `user strings (${list(record.userStrings).length}): ${strs(record.userStrings, 8, 50)}`,
  ]
}

function evmLines(record: Record<string, unknown>): string[] {
  const selectors = list(record.selectors).map(recordOf).flatMap(item => (item === null ? [] : [`${text(item.selector, 12)} ${text(item.name, 50) || '(unknown)'} @${num(item.offset)}`]))
  const hazards = Object.entries(recordOf(record.hazards) ?? {}).flatMap(([name, value]) => {
    const item = recordOf(value)

    return item === null ? [] : [`${plain(name, 16)} ×${num(item.count)} @${list(item.offsets).slice(0, 3).map(offset => num(offset)).join(',')}`]
  })
  const topics = list(record.eventTopics).map(recordOf).flatMap(item => (item === null ? [] : [text(item.name, 50) || `${text(item.topic, 14)}…`]))
  const proxy = recordOf(record.minimalProxy)
  const meta = recordOf(record.metadata)

  return [
    `${num(record.byteLength)} bytes · ${num(record.instructionCount)} instructions · ${num(record.jumpdestCount)} JUMPDEST · ${num(record.invalidOpcodeCount)} invalid`,
    `selectors (${selectors.length}): ${selectors.slice(0, 8).join(' · ') || '(none found: unusual dispatcher or no ABI)'}`,
    `hazards: ${hazards.join(' · ') || 'none of the tracked opcodes (an inventory, not a finding)'}`,
    `addresses (${list(record.addresses).length}): ${strs(record.addresses, 4, 44)}`,
    `events (${topics.length}): ${topics.slice(0, 6).join(', ') || '(none)'}`,
    ...(proxy !== null ? [`EIP-1167 minimal proxy → ${text(proxy.implementation, 44)}`] : []),
    ...(meta !== null ? [`compiler: solc ${text(meta.solc, 16) || 'n/a'}${typeof meta.ipfs === 'string' ? ` · ipfs ${plain(meta.ipfs, 12)}…` : ''}`] : []),
    ...(list(record.strings).length > 0 ? [`strings: ${strs(record.strings, 6, 60)}`] : []),
  ]
}

function jsLines(record: Record<string, unknown>): string[] {
  const modules = list(record.modules).map(recordOf).filter((module): module is Record<string, unknown> => module !== null)
  const kinds = new Map<string, number>()
  const sources = new Set<string>()

  for (const module of modules) {
    for (const boundary of list(module.electronBoundaries).map(recordOf)) if (boundary !== null) kinds.set(text(boundary.kind, 24), (kinds.get(text(boundary.kind, 24)) ?? 0) + 1)
    for (const item of list(module.imports).map(recordOf)) if (item !== null && sources.size < 40) sources.add(text(item.source, 40))
  }

  return [
    `${record.isElectron === true ? 'Electron app' : 'JavaScript'} · ${num(record.filesScanned)} files scanned · ${modules.length} modules`,
    `Electron boundaries: ${[...kinds].map(([kind, count]) => `${kind} ×${count}`).join(' · ') || 'none'}`,
    `imports (${sources.size}): ${[...sources].slice(0, 14).join(', ') || '(none)'}`,
    ...modules.slice(0, 6).map(module => `  ${text(module.file, 60)} · ${list(module.imports).length} imports · ${list(module.electronBoundaries).length} boundaries`),
  ]
}

function findLines(record: Record<string, unknown>): string[] {
  const matches = list(record.matches).map(recordOf).filter((match): match is Record<string, unknown> => match !== null)
  const head = `${matches.length} match${matches.length === 1 ? '' : 'es'} · ${num(record.filesScanned)} files scanned`

  return [
    head,
    ...matches.slice(0, 6).flatMap(match => {
      const range = recordOf(match.lineRange)
      const first = typeof match.snippet === 'string' ? plain(match.snippet.split('\n').find(line => line.trim() !== '') ?? '', 100) : ''

      return [`${text(match.file, 60)}:${num(range?.start)}-${num(range?.end)} · score ${text(match.score, 8)}${match.redacted === true ? ' · snippet hidden by AIDefence' : ''}`, ...(first !== '' ? [`    ${first}`] : [])]
    }),
  ]
}

function asarLines(record: Record<string, unknown>): string[] {
  const where = text(record.unpackedPath, 120)

  return [
    `extracted ${num(record.fileCount)} files (${num(record.totalBytes)} bytes)${record.truncated === true ? ' — stopped at a cap' : ''}`,
    `to ${where}`,
    'that folder is outside the project, which Dev Tools cannot read: copy it under the project (cp -r) to run JS APP or FEATURE here',
  ]
}

const READERS: Record<string, (record: Record<string, unknown>) => string[]> = {
  'dt-re-asar': asarLines,
  'dt-re-js': jsLines,
  'dt-re-find': findLines,
  'dt-re-bin': binaryLines,
  'dt-re-net': dotnetLines,
  'dt-re-evm': evmLines,
}

/**
 * What a ruRE run printed, as lines: the tool's answer read by its shape, its caveats first. `value` is the answer with
 * mcp exec's wrapper already taken off; null when the CLI printed no JSON at all. A tool-missing message is said plainly.
 */
export function rureLines(id: string, value: unknown, stdout = '', stderr = ''): string[] {
  const record = recordOf(value)

  if (record === null) return /Tool not found/i.test(`${stdout}\n${stderr}`) ? [`✗ ${NO_TOOLS}`] : []

  if (record.success === false) return [`✗ ${text(record.error, 200) || 'the tool failed'}`]

  const read = READERS[id]

  return read === undefined ? [] : [...caveats(record), ...read(record)].slice(0, RE_MAX_LINES)
}
