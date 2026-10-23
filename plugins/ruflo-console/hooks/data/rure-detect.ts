/**
 * ruRE DETECT (ADR-496): which of the readers a sample wants, from what the host says about it (a folder or a file) and its extension.
 * Not from its bytes: the host's `read` hands back text, so a Mach-O magic or an .asar header does not survive it, and a large binary
 * is refused outright. Where this is not enough the answer is the broad one (a native binary reader, which names its format), and a
 * .dll or .exe says it may be a .NET assembly (the native reader's imports do not reliably show it; ADR-496 section 3). DETECT never picks UNPACK .ASAR, the one reader that writes: it names that row, which
 * asks first. Leaf: the host's `stat` is passed in; nothing here runs a command.
 */
import type { ReaderFs } from './files'

export type Detected = { id: string; tool: string; params: Record<string, unknown>; why: string } | { refuse: string }

const EVM = new Set(['hex', 'evm', 'bytecode'])
const SOURCE = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'map', 'json', 'html'])
const NET = new Set(['dll', 'exe', 'winmd'])
const CUDA = new Set(['cubin', 'fatbin', 'ptx'])

const isDir = (kind: string | undefined): boolean => kind === 'dir' || kind === 'directory'
const extOf = (sample: string): string => {
  const name = sample.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')

  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export async function detectReader(fs: Pick<ReaderFs, 'stat'>, sample: string): Promise<Detected> {
  const stat = await fs.stat(sample).catch(() => undefined)
  const ext = extOf(sample)

  if (isDir(stat?.kind)) return { id: 'dt-re-js', tool: 'rure_analyze_js_app', params: { path: sample }, why: 'a folder: read as JavaScript / Electron source' }
  if (ext === 'asar') return { refuse: `${sample} is an .asar: run UNPACK .ASAR (it writes the files to a new temp folder, so it asks first), copy that folder into the project, then run APP MAP on it` }
  if (SOURCE.has(ext)) return { refuse: `${sample} is one source file: APP MAP reads a folder, so name the folder it is in` }
  if (CUDA.has(ext)) return { id: 'dt-re-cuda', tool: 'rure_analyze_cuda', params: { path: sample }, why: `a .${ext} file: read as CUDA GPU code` }
  if (EVM.has(ext)) return { id: 'dt-re-evm', tool: 'rure_analyze_evm', params: { path: sample }, why: `a .${ext} file: read as EVM bytecode` }

  const why = NET.has(ext) ? `a .${ext} file: read as a native binary; it may be a .NET assembly, so run .NET ASSEMBLY too (it reads the metadata, and says plainly when the file is native)` : 'read as a native binary (ELF, PE or Mach-O: it names the format)'

  return { id: 'dt-re-bin', tool: 'rure_analyze_binary', params: { path: sample, includeStrings: true }, why }
}
