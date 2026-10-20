/** Absolute on either family: `/posix`, a drive path (`C:\x` or `C:/x`) or a UNC share (`\\server\share`). A bare `C:` or `C:x` is drive-relative, so it is not. */
export const isAbsolutePath = (path: string): boolean => path.startsWith('/') || path.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(path)

/** The path under the working directory unless it already is absolute (`under()` builds `C:\dev\app/.claude-flow/...` on Windows: prefixing that again was #4175). */
export const rootedPath = (cwd: string, path: string): string => (isAbsolutePath(path) ? path : `${cwd.replace(/[\\/]+$/, '')}/${path}`)
