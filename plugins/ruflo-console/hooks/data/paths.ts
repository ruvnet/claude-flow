/**
 * Path helpers that are pure string functions: hook modules run without Node's `path`. A path is absolute when it is POSIX (`/x`),
 * drive-lettered (`C:\x`, `c:/x`) or a UNC share (`\\srv\share`); `C:x` and `.\x` are relative. A POSIX path is handled exactly as a
 * plain `/` string always was: only a drive-lettered or UNC path takes the Windows rules (either separator, case-insensitive compare).
 */

const DRIVE = /^[A-Za-z]:[\\/]/
const UNC = /^\\\\[^\\/]/

/** True for a drive-lettered or UNC path (the Windows forms). */
export const isWindowsPath = (p: string): boolean => DRIVE.test(p) || UNC.test(p)

/** True for a POSIX, drive-letter or UNC path. */
export const isAbsolutePath = (p: string): boolean => p.startsWith('/') || isWindowsPath(p)

/** `p` without trailing separators (both kinds for a Windows path, `/` only for a POSIX one). */
export const trimTrailing = (p: string): string => p.replace(isWindowsPath(p) ? /[\\/]+$/ : /\/+$/, '')

/** Joins onto `base` using the base's own separator (`\` for a Windows base that uses it), without doubling a trailing separator. */
export function joinPath(base: string, ...parts: string[]): string {
  const sep = isWindowsPath(base) && base.includes('\\') ? '\\' : '/'
  const rest = parts.map(part => (sep === '\\' ? part.replace(/\//g, '\\') : part)).filter(part => part !== '')

  return [trimTrailing(base), ...rest].join(sep)
}

/** Windows paths compare ignoring case, separator style and a trailing separator; POSIX paths compare exactly. */
export function samePath(a: string, b: string): boolean {
  if (isWindowsPath(a) || isWindowsPath(b)) {
    const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

    return norm(a) === norm(b)
  }

  return a === b
}

/** True when the path has a `..` segment (either separator for a Windows path). Callers refuse it themselves. */
export const hasParentSegment = (p: string): boolean => (isWindowsPath(p) ? p.split(/[\\/]/) : p.split('/')).includes('..')

/**
 * The path with empty and `.` segments and a trailing separator dropped. A POSIX path comes back as `/a/b`; a Windows path keeps the
 * separators it was written with (`C:\a\b`, `C:\a/b`, `\\srv\share\a`), so a base followed by `/name` stays recognisable.
 */
export function normalizePath(p: string): string {
  if (!isWindowsPath(p)) return `/${p.split('/').filter(part => part !== '' && part !== '.').join('/')}`

  const unc = UNC.test(p)
  const body = (unc ? p.slice(2) : p).replace(/([\\/])[\\/]+/g, '$1').replace(/[\\/]\.(?=[\\/]|$)/g, '').replace(/[\\/]+$/, '')

  return `${unc ? '\\\\' : ''}${body}`
}

/** The segments of `path` strictly below `root`, or null when it is not inside it. Windows paths compare ignoring case and separator style. */
export function below(root: string, path: string): string[] | null {
  if (isWindowsPath(root) || isWindowsPath(path)) {
    const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
    const p = path.replace(/\\/g, '/')

    return r !== '' && p.toLowerCase().startsWith(`${r.toLowerCase()}/`) ? p.slice(r.length + 1).split('/').filter(part => part !== '') : null
  }

  const r = root.replace(/\/+$/, '')

  return r !== '' && path.startsWith(`${r}/`) ? path.slice(r.length + 1).split('/') : null
}

/** The user's home directory: HOME (preferred), else USERPROFILE, else HOMEDRIVE+HOMEPATH, else null. Empty values are treated as unset. */
export function homeOf(get: (k: string) => string | undefined): string | null {
  const home = get('HOME')
  if (home) return home

  const userProfile = get('USERPROFILE')
  if (userProfile) return userProfile

  const drive = get('HOMEDRIVE')
  const path = get('HOMEPATH')
  if (drive && path) return drive + path

  return null
}
