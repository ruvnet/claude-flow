/**
 * The ruRE page's catalog (ADR-494): static reverse engineering of a file in the project, through the six `rure_*` tools of
 * ruflo-rure (ADR-0001..0005 of that plugin). Every tool parses and never executes the target, so five are local $0 reads that
 * run at once; unpacking an .asar writes files to a temp folder, so it asks first. The file is named only by the `sample` field,
 * which holds a path inside the project: nothing outside it can be reached from here (the tools themselves accept any readable
 * path, so that limit is this page's, kept in data/devtools.ts). These entries join `DEV`, so the confirm row, the palette ids
 * (`/ruflo run dt-re-bin app/bin/tool`) and the self-check treat them like every other Dev Tools row. Pure.
 */
import { devLines, need, tool } from './data/devtools'
import { detectReader } from './data/rure-detect'
import { sampleLinkCheck } from './data/rure-guard'
import { foldersLinkCheck, isAliased, resolveAlias, type Folders } from './data/rure-folders'
import type { Host } from './host'
import type { ActionSpec } from './actions'
import type { DevEntry } from './devtools'

/** The ruRE groups: drawn on the ruRE page, not on Dev Tools. */
export const RURE_GROUPS = [
  { id: 'rure-auto', title: 'Any file or folder', right: 'DETECT picks the reader · parse only' },
  { id: 'rure-app', title: 'JavaScript and Electron apps', right: 'an .asar or a folder of source · parse only' },
  { id: 'rure-native', title: 'Native binaries, .NET and EVM', right: 'ELF · PE · Mach-O · .NET · CUDA · EVM bytecode · parse only' },
] as const

export const RURE: readonly DevEntry[] = [
  { id: 'dt-re-auto', group: 'rure-auto', name: 'DETECT', about: 'name any file or folder: a folder is read as JS source, hex as EVM, the rest as a native binary', label: 'ruRE: detect the reader and read the sample', cost: 'read', input: 'sample', args: f => need(f, ['sample'], v => tool('rure_analyze_binary', { path: v.sample, includeStrings: true })), note: 'picks the reader from the folder or extension (ADR-496); an .asar is never unpacked from here, that row asks first' },
  { id: 'dt-re-asar', group: 'rure-app', name: 'UNPACK .ASAR', about: 'extract an Electron app.asar (size and file caps) to a temp folder', label: 'ruRE: unpack the .asar', cost: 'writes', input: 'sample', args: f => need(f, ['sample'], v => tool('rure_extract_asar', { path: v.sample })), note: 'writes the unpacked files to a new temp folder outside the project (it is not cleaned up); nothing in the archive is run' },
  { id: 'dt-re-js', group: 'rure-app', name: 'APP MAP', about: 'imports, Electron boundaries (ipc, preload, webview) per module', label: 'ruRE: map a JS/Electron source folder', cost: 'read', input: 'sample', args: f => need(f, ['sample'], v => tool('rure_analyze_js_app', { path: v.sample })) },
  { id: 'dt-re-find', group: 'rure-app', name: 'FIND FEATURE', about: 'where a feature lives: the sample folder, and the words in the feature field', label: 'ruRE: find a feature in a JS source folder', cost: 'read', input: 'query', args: f => need(f, ['sample', 'query'], v => tool('rure_find_feature', { path: v.sample, query: v.query })) },
  { id: 'dt-re-bin', group: 'rure-native', name: 'NATIVE BINARY', about: 'ELF, PE or Mach-O: sections, libraries, imports, exports, strings', label: 'ruRE: inspect a native binary', cost: 'read', input: 'sample', args: f => need(f, ['sample'], v => tool('rure_analyze_binary', { path: v.sample, includeStrings: true })) },
  { id: 'dt-re-net', group: 'rure-native', name: '.NET ASSEMBLY', about: 'metadata only: references, types, P/Invoke, string literals', label: 'ruRE: inspect a .NET assembly', cost: 'read', input: 'sample', args: f => need(f, ['sample'], v => tool('rure_analyze_dotnet', { path: v.sample })) },
  { id: 'dt-re-cuda', group: 'rure-native', name: 'CUDA', about: 'GPU code in a CUDA program, .cubin, .fatbin or .ptx: architectures, kernels, registers, memory, PTX', label: 'ruRE: inspect CUDA code', cost: 'read', input: 'sample', args: f => need(f, ['sample'], v => tool('rure_analyze_cuda', { path: v.sample })) },
  { id: 'dt-re-evm', group: 'rure-native', name: 'EVM BYTECODE', about: 'a file of hex or raw bytecode: selectors, risky opcodes, proxies', label: 'ruRE: inventory EVM bytecode', cost: 'read', input: 'sample', args: f => need(f, ['sample'], v => tool('rure_analyze_evm', { path: v.sample })) },
]

/**
 * What runs before a ruRE row (ADR-495, ADR-496): the sample must not be, or sit behind, a link; and DETECT then picks the reader from
 * what the host says about the sample, so the row runs that reader's call with that reader's lines, or says why it cannot choose.
 */
export const rurePreflight = (entry: DevEntry, sample: string, built: readonly string[] | null): NonNullable<ActionSpec['preflight']> => async (host, options) => {
  if (isAliased(sample)) return aliasedPreflight(entry, sample, built, host, options.rureFolders)

  const linked = await sampleLinkCheck(host.fs, sample)

  if (linked !== null) return linked
  if (entry.id !== 'dt-re-auto') return null

  const pick = await detectReader(host.fs, sample)

  if ('refuse' in pick) return pick.refuse

  return { args: tool(pick.tool, pick.params), label: `ruRE: detect → ${RURE.find(row => row.id === pick.id)?.name ?? pick.id}`, lab: pick.id, note: pick.why, lines: (out, err) => devLines(pick.id, out, err) }
}

/**
 * A sample in an allowed outside folder (ADR-499): `@name/sub/file` becomes the folder's absolute path, after the links on the way are checked.
 * The row's own argv carries the `@name` text (so nothing absolute was ever built from a field); the resolved path replaces it in the one JSON
 * argument every ruRE call has. DETECT picks its reader from what the host says about the resolved path.
 */
async function aliasedPreflight(entry: DevEntry, sample: string, built: readonly string[] | null, host: Pick<Host, 'fs'>, folders: Folders): ReturnType<NonNullable<ActionSpec['preflight']>> {
  const at = resolveAlias(sample, folders)

  if ('refuse' in at) return at.refuse

  const linked = await foldersLinkCheck(host.fs, at.root, at.rel)

  if (linked !== null) return linked
  if (entry.id === 'dt-re-auto') {
    const pick = await detectReader(host.fs, at.path)

    if ('refuse' in pick) return pick.refuse

    return { args: tool(pick.tool, pick.params), label: `ruRE: detect → ${RURE.find(row => row.id === pick.id)?.name ?? pick.id}`, lab: pick.id, note: `${pick.why} (in @${at.alias})`, lines: (out, err) => devLines(pick.id, out, err) }
  }

  const slot = built === null ? -1 : built.indexOf('-p')
  const params: unknown = slot < 0 ? null : JSON.parse(built![slot + 1] ?? 'null')

  if (built === null || typeof params !== 'object' || params === null || (params as { path?: unknown }).path !== sample) return `${entry.name}: could not place ${sample}`

  return { args: built.map((part, index) => (index === slot + 1 ? JSON.stringify({ ...params, path: at.path }) : part)), note: `${entry.note ?? ''}${entry.note === undefined ? '' : '; '}reads ${at.path} (@${at.alias})` }
}
