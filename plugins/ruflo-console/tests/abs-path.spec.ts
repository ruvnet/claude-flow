import { describe, expect, it } from 'vitest'
import { isAbsolutePath, rootedPath } from '../hooks/data/abs-path'

// #4175: on Windows the working directory is `C:\dev\app`, so `under(cwd, ...)` returns `C:\dev\app/.claude-flow/...`.
// The host wrapper used to treat only a leading `/` as absolute and prefixed the cwd a second time.
describe('absolute paths, POSIX and Windows (#4175)', () => {
  it('knows a rooted path on both families', () => {
    for (const path of ['/home/a/b', 'C:\\dev\\app', 'C:/dev/app', 'c:\\x', 'Z:/', '\\\\server\\share\\x', 'C:\\dev\\app/.claude-flow/console/events.jsonl']) {
      expect(isAbsolutePath(path), path).toBe(true)
    }
  })

  it('treats a relative path, a bare drive and a drive-relative path as relative', () => {
    for (const path of ['.claude-flow/config.yaml', 'a/b', '', 'C:', 'C:foo', '..\\x', 'dev/C:/x']) {
      expect(isAbsolutePath(path), path).toBe(false)
    }
  })

  it('never prefixes the working directory twice (the doubled path of the issue)', () => {
    const cwd = 'C:\\dev\\app'
    const built = `${cwd}/.claude-flow/console/events.jsonl`

    expect(rootedPath(cwd, built)).toBe(built)
    expect(rootedPath(cwd, built)).not.toContain('app\\C:')
    expect(rootedPath('C:/dev/app', 'C:/dev/app/x')).toBe('C:/dev/app/x')
    expect(rootedPath('/home/a', '/home/a/x')).toBe('/home/a/x')
    expect(rootedPath('\\\\srv\\share\\app', '\\\\srv\\share\\app/x')).toBe('\\\\srv\\share\\app/x')
  })

  it('still roots a relative path, and trims trailing separators of either kind', () => {
    expect(rootedPath('/home/a/', '.claude-flow/x')).toBe('/home/a/.claude-flow/x')
    expect(rootedPath('C:\\dev\\app\\', '.claude-flow/x')).toBe('C:\\dev\\app/.claude-flow/x')
    expect(rootedPath('C:\\dev\\app', 'a/b')).toBe('C:\\dev\\app/a/b')
  })
})

describe('the host wrapper uses it (#4175)', () => {
  it('register.ts roots host paths through rootedPath, not an inline leading-slash test', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../hooks/register.ts', import.meta.url), 'utf8')

    expect(source).toContain("import { rootedPath } from './data/abs-path'")
    expect(source).toContain('rootedPath(cwd, path)')
    expect(source).not.toMatch(/path\.startsWith\('\/'\) \? path/)
  })
})
