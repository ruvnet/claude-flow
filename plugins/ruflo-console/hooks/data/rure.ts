/**
 * ruRE in Dev Tools (ADR-494): the readers for what the six `rure_*` tools answer through `ruflo mcp exec`. The tools
 * parse a file and never run it, but what they return is the file's own text (section names, imports, strings, type
 * names), so every such value passes plain() before it is a line: an escape sequence in a hostile binary never reaches
 * the terminal. Counts and offsets are shown only when they are measurements (#3822). Pure: strings in, lines out.
 */
import { plain, recordOf } from './parse'
import { measureOf } from './safe'

/** Lines a ruRE answer keeps in all, whatever the file holds; the panel scrolls (j/k) past its window. */
export const RE_MAX_LINES = 120

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

/** Items one list shows, and the width of a wrapped line. */
const LIST_MAX = 60
const WRAP = 96

/**
 * A titled list: `title (total): a, b` on one line when it fits (what every short list always was), else `title (total):` and the items
 * wrapped on lines of their own, in order, at most LIST_MAX of them and `… +N` for the rest. `items` are already clean text.
 */
function block(title: string, total: number | string, items: readonly string[]): string[] {
  const shown = items.filter(item => item !== '')

  if (shown.length === 0) return [`${title} (${total}): (none)`]

  const cut = shown.slice(0, LIST_MAX)
  const tail = shown.length > LIST_MAX ? `, … +${shown.length - LIST_MAX}` : ''
  const whole = `${title} (${total}): ${cut.join(', ')}${tail}`

  if (whole.length <= WRAP + 12) return [whole]

  const rows: string[] = []
  let row = ''

  for (const item of cut) {
    if (row !== '' && row.length + item.length + 2 > WRAP) {
      rows.push(`  ${row},`)
      row = item
    } else row = row === '' ? item : `${row}, ${item}`
  }

  return [`${title} (${total}):`, ...rows, `  ${row}${tail}`]
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

  const holdsCuda = sections.some(section => /^\.?nv_fatb/.test(text(section.name, 24)) || text(section.name, 24) === '__nv_fatbin')

  return [
    `${text(record.format).toUpperCase() || 'n/a'} · ${text(record.arch) || 'n/a'} · ${num(record.bits)}-bit ${text(record.endianness) || 'n/a'}-endian · ${text(record.kind) || 'n/a'}`,
    ...(holdsCuda ? ['holds CUDA code (a .nv_fatbin section): run CUDA for its kernels, architectures and PTX'] : []),
    `entry ${hex(record.entryPoint)}`,
    ...block('libraries', list(record.libraries).length, list(record.libraries).map(item => text(item, 40))),
    ...block('imports', list(record.imports).length, list(record.imports).map(item => text(item, 40))),
    ...block('exports', list(record.exports).length, list(record.exports).map(item => text(item, 40))),
    ...block('sections', sections.length, sections.map(section => `${text(section.name, 20)} ${hex(section.offset)}+${num(section.size)}`)),
    ...(strings.length > 0 ? block('strings', `${strings.length}${record.stringsTruncated === true ? '+' : ''}`, strings) : []),
  ]
}

function dotnetLines(record: Record<string, unknown>): string[] {
  if (record.isManaged !== true) return ['not a managed .NET assembly (no CLR header): use the native binary reader']

  const assembly = recordOf(record.assembly)
  const refs = list(record.assemblyRefs).map(recordOf).flatMap(ref => (ref === null ? [] : [`${text(ref.name, 30)} ${text(ref.version, 16)}`]))
  const calls = list(record.pinvokes).map(recordOf).flatMap(call => (call === null ? [] : [`${text(call.module, 30)}!${text(call.function, 30)}`]))

  return [
    `${text(assembly?.name) || 'n/a'} ${text(assembly?.version, 20)} · runtime ${text(record.runtimeVersion, 20) || 'n/a'}`,
    ...block('references', refs.length, refs),
    ...block('types', num(record.typeCount), list(record.types).map(item => text(item, 50))),
    `methods ${num(record.methodCount)} · entry token ${hex(record.entryPointToken)}`,
    ...block('P/Invoke', calls.length, calls),
    ...block('user strings', list(record.userStrings).length, list(record.userStrings).map(item => text(item, 50))),
  ]
}

function evmLines(record: Record<string, unknown>): string[] {
  const selectors = list(record.selectors).map(recordOf).flatMap(item => (item === null ? [] : [`${text(item.selector, 12)} ${text(item.name, 50) || '(unknown)'} @${num(item.offset)}`]))
  const hazards = Object.entries(recordOf(record.hazards) ?? {}).flatMap(([name, value]) => {
    const item = recordOf(value)

    return item === null ? [] : [`${plain(name, 16)} ×${num(item.count)} @${list(item.offsets).slice(0, 3).map(offset => num(offset)).join(',')}`]
  })
  const topics = list(record.eventTopics).map(recordOf).flatMap(item => (item === null ? [] : [text(item.name, 50) || text(item.topic, 14)]))
  const proxy = recordOf(record.minimalProxy)
  const meta = recordOf(record.metadata)

  return [
    `${num(record.byteLength)} bytes · ${num(record.instructionCount)} instructions · ${num(record.jumpdestCount)} JUMPDEST · ${num(record.invalidOpcodeCount)} invalid`,
    ...(selectors.length === 0 ? ['selectors (0): (none found: unusual dispatcher or no ABI)'] : block('selectors', selectors.length, selectors)),
    `hazards: ${hazards.join(' · ') || 'none of the tracked opcodes (an inventory, not a finding)'}`,
    ...block('addresses', list(record.addresses).length, list(record.addresses).map(item => text(item, 44))),
    ...block('events', topics.length, topics),
    ...(proxy !== null ? [`EIP-1167 minimal proxy → ${text(proxy.implementation, 44)}`] : []),
    ...(meta !== null ? [`compiler: solc ${text(meta.solc, 16) || 'n/a'}${typeof meta.ipfs === 'string' ? ` · ipfs ${plain(meta.ipfs, 12)}` : ''}`] : []),
    ...(list(record.strings).length > 0 ? block('strings', list(record.strings).length, list(record.strings).map(item => text(item, 60))) : []),
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
    ...block('imports', sources.size, [...sources]),
    ...modules.slice(0, 20).map(module => `  ${text(module.file, 60)} · ${list(module.imports).length} imports · ${list(module.electronBoundaries).length} boundaries`),
  ]
}

function findLines(record: Record<string, unknown>): string[] {
  const matches = list(record.matches).map(recordOf).filter((match): match is Record<string, unknown> => match !== null)
  const head = `${matches.length} match${matches.length === 1 ? '' : 'es'} · ${num(record.filesScanned)} files scanned`

  return [
    head,
    ...matches.slice(0, 20).flatMap(match => {
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

/** Kernel and entry lines kept; the rest is counted. */
const CUDA_ENTRY_LINES = 30;
const CUDA_KERNEL_LINES = 60;

/** The CUDA tool's answer (ADR-0006, ADR-497): what the fatbin holds, then each kernel with what it costs, then the PTX. Every value is the file's own text or a measurement. */
function cudaLines(record: Record<string, unknown>): string[] {
  const rows = (value: unknown): Record<string, unknown>[] => list(value).map(recordOf).filter((row): row is Record<string, unknown> => row !== null)
  const summary = recordOf(record.summary)
  const entries = rows(record.entries)
  const kernels = rows(record.kernels)
  const modules = rows(record.ptx)
  const section = recordOf(record.hostSection)
  const archs = (value: unknown): string => strs(value, 8, 12)
  const known = (value: unknown, unit = ''): string => (countOf(value) === undefined ? 'n/a' : `${countOf(value)}${unit}`)

  const entryLines = entries.slice(0, CUDA_ENTRY_LINES).map(entry => `  #${num(entry.index)} ${text(entry.kind, 8) || '?'} ${text(entry.arch, 10) || 'sm_?'} · ${text(entry.compressed, 8) || '?'} · ${entry.read === true ? known(entry.size, ' B') : `unread: ${text(entry.note, 100) || 'no reason given'}`}`)
  const kernelLines = kernels.slice(0, CUDA_KERNEL_LINES).map(kernel => {
    const name = text(kernel.identifier, 40) || text(kernel.name, 60)
    const shared = (countOf(kernel.sharedBytes) ?? 0) > 0 ? ` · shared ${known(kernel.sharedBytes, ' B')}` : ''
    const estimate = countOf(kernel.instructionEstimate) === undefined ? '' : ` (~${known(kernel.instructionEstimate)} instr)`

    return `  ${name}${kernel.isEntry === true ? '' : ' [device fn]'} · ${text(kernel.arch, 10) || 'sm_?'} · ${known(kernel.registers)} reg · ${known(kernel.codeBytes, ' B')} code${estimate} · const ${known(kernel.constantBytes, ' B')}${shared}`
  })

  return [
    `CUDA · ${text(record.source) || 'n/a'} · cubins ${archs(record.cubinArchs)} · PTX ${archs(record.ptxArchs)} · ${known(summary?.kernels)} kernels · ${known(summary?.deviceFunctions)} device functions`,
    ...(section !== null ? [`fatbin in ${text(section.name, 20)} at ${hex(section.offset)} (${known(section.size, ' B')})`] : []),
    `${known(record.containers)} container(s), ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}:`,
    ...entryLines,
    ...(entries.length > CUDA_ENTRY_LINES ? [`  … +${entries.length - CUDA_ENTRY_LINES} more entries`] : []),
    `kernels (${kernels.length}):`,
    ...(kernelLines.length === 0 ? ['  (none read)'] : kernelLines),
    ...(kernels.length > CUDA_KERNEL_LINES ? [`  … +${kernels.length - CUDA_KERNEL_LINES} more`] : []),
    ...modules.slice(0, 4).map(module => `PTX ${text(module.version, 12) || 'n/a'} · ${text(module.target, 20) || 'n/a'} · ${known(module.addressSize)}-bit · kernels: ${strs(rows(module.entries).map(entry => entry.name), 6, 40)}`),
    ...block('host signals', list(record.hostSignals).length, list(record.hostSignals).map(item => text(item, 40))),
  ]
}

const READERS: Record<string, (record: Record<string, unknown>) => string[]> = {
  'dt-re-asar': asarLines,
  'dt-re-js': jsLines,
  'dt-re-find': findLines,
  'dt-re-bin': binaryLines,
  'dt-re-auto': binaryLines,
  'dt-re-cuda': cudaLines,
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
