/**
 * The ruRE page's catalog (ADR-492): static reverse engineering of a file in the project, through the six `rure_*` tools of
 * ruflo-rure (ADR-0001..0005 of that plugin). Every tool parses and never executes the target, so five are local $0 reads that
 * run at once; unpacking an .asar writes files to a temp folder, so it asks first. The file is named only by the `sample` field,
 * which holds a path inside the project: nothing outside it can be reached from here (the tools themselves accept any readable
 * path, so that limit is this page's, kept in data/devtools.ts). These entries join `DEV`, so the confirm row, the palette ids
 * (`/ruflo run dt-re-bin app/bin/tool`) and the self-check treat them like every other Dev Tools row. Pure.
 */
import { need, tool } from './data/devtools'
import type { DevEntry } from './devtools'

/** The ruRE groups: drawn on the ruRE page, not on Dev Tools. */
export const RURE_GROUPS = [
  { id: 'rure-app', title: 'JavaScript and Electron apps', right: 'an .asar or a folder of source · parse only' },
  { id: 'rure-native', title: 'Native binaries, .NET and EVM', right: 'ELF · PE · Mach-O · .NET · EVM bytecode · parse only' },
] as const

export const RURE: readonly DevEntry[] = [
  { id: 'dt-re-asar', group: 'rure-app', name: 'UNPACK .ASAR', about: 'extract an Electron app.asar (size and file caps) to a temp folder', label: 'ruRE: unpack the .asar', cost: 'writes', input: 'sample', args: f => need(f, ['sample'], v => tool('rure_extract_asar', { path: v.sample })), note: 'writes the unpacked files to a new temp folder outside the project (it is not cleaned up); nothing in the archive is run' },
  { id: 'dt-re-js', group: 'rure-app', name: 'APP MAP', about: 'imports, Electron boundaries (ipc, preload, webview) per module', label: 'ruRE: map a JS/Electron source folder', cost: 'read', input: 'sample', args: f => need(f, ['sample'], v => tool('rure_analyze_js_app', { path: v.sample })) },
  { id: 'dt-re-find', group: 'rure-app', name: 'FIND FEATURE', about: 'where a feature lives: the sample folder, and the words in the feature field', label: 'ruRE: find a feature in a JS source folder', cost: 'read', input: 'query', args: f => need(f, ['sample', 'query'], v => tool('rure_find_feature', { path: v.sample, query: v.query })) },
  { id: 'dt-re-bin', group: 'rure-native', name: 'NATIVE BINARY', about: 'ELF, PE or Mach-O: sections, libraries, imports, exports, strings', label: 'ruRE: inspect a native binary', cost: 'read', input: 'sample', args: f => need(f, ['sample'], v => tool('rure_analyze_binary', { path: v.sample, includeStrings: true })) },
  { id: 'dt-re-net', group: 'rure-native', name: '.NET ASSEMBLY', about: 'metadata only: references, types, P/Invoke, string literals', label: 'ruRE: inspect a .NET assembly', cost: 'read', input: 'sample', args: f => need(f, ['sample'], v => tool('rure_analyze_dotnet', { path: v.sample })) },
  { id: 'dt-re-evm', group: 'rure-native', name: 'EVM BYTECODE', about: 'a file of hex or raw bytecode: selectors, risky opcodes, proxies', label: 'ruRE: inventory EVM bytecode', cost: 'read', input: 'sample', args: f => need(f, ['sample'], v => tool('rure_analyze_evm', { path: v.sample })) },
]
