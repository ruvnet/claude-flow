/**
 * The ruRE offer's pure parts (ADR-498): which file a tool call touched is worth offering ruRE for, and the one line that offers it.
 * Pure: strings in, strings out, no engine call. The rules mirror the console's `sample` field (relative, plain characters, no `..`) so
 * everything offered can actually be run from the console; nothing outside the project, or with an odd name, is ever named.
 */

/** Tools whose call names a file by `file_path`: the model reading or writing the file. */
export const OFFER_TOOLS: ReadonlySet<string> = new Set(['Read', 'Write', 'Edit', 'MultiEdit'])

/** What ruRE can read by extension (`.hex` and `.bin` are left out: too often firmware or plain data). `libx.so.1` counts as a `.so`. */
const RURE_FILE = /\.(?:exe|dll|so(?:\.\d{1,3}){0,3}|dylib|node|asar|cubin|fatbin|ptx|evm|bytecode)$/i
/** The console's `sample` rule: plain characters only, at most 160. */
const PLAIN = /^[A-Za-z0-9._/-]{1,160}$/

export const MAX_PENDING = 8
export const MAX_PER_TURN = 3
export const MAX_PER_SESSION = 12
/** ruRE refuses larger files (128 MiB), so offering one would be an offer that fails. */
export const MAX_BYTES = 128 * 1024 * 1024

/**
 * The project-relative path a tool call's `file_path` means, when ruRE can read that kind of file and the console would accept the path;
 * otherwise null. An absolute path counts only under `root`. Nothing with `..`, an empty segment, a leading `-` or other characters is named.
 */
export function candidate(root: string, filePath: unknown): string | null {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 400) return null

  const base = root.replace(/\/+$/, '')
  const relative = filePath.startsWith('/') ? (base !== '' && filePath.startsWith(`${base}/`) ? filePath.slice(base.length + 1) : null) : filePath.replace(/^\.\//, '')

  if (relative === null || !PLAIN.test(relative) || relative.startsWith('-') || !RURE_FILE.test(relative)) return null
  if (relative.split('/').some(part => part === '' || part === '.' || part === '..')) return null

  return relative
}

/** `a.dll`, `a.dll and b.so`, `a.dll, b.so and c.exe`. */
const names = (paths: readonly string[]): string => (paths.length === 1 ? (paths[0] as string) : `${paths.slice(0, -1).join(', ')} and ${paths[paths.length - 1]}`)

/**
 * The one line shown beneath the answer. Static words around plain, already-validated paths: nothing the file contains reaches it, and it
 * says plainly that ruRE only parses.
 */
export function offerLine(paths: readonly string[]): string {
  const them = paths.length === 1 ? 'it' : 'them'

  return `ruRE can look inside ${names(paths)} without running ${them}: in the ruflo console run /ruflo run dt-re-auto ${paths[0]}, or ask me to call rure_analyze_binary (rure_analyze_cuda for GPU code). It only parses; nothing is executed.`
}
