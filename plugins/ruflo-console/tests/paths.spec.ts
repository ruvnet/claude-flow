import { describe, expect, it } from 'vitest'

import { isProtectedPath, validateEnvelope } from '../hooks/data/ap-envelope'
import { below, hasParentSegment, isAbsolutePath, joinPath, normalizePath, samePath, trimTrailing } from '../hooks/data/paths'

describe('paths', () => {
  it('absolute forms', () => {
    for (const p of ['/work', 'C:\\Users\\x', 'c:/Users/x', '\\\\srv\\share\\x']) expect(isAbsolutePath(p)).toBe(true)
    for (const p of ['work', '.\\x', 'C:x', '']) expect(isAbsolutePath(p)).toBe(false)
  })
  it('join keeps style', () => {
    expect(joinPath('C:\\Users\\x', '.claude-flow', 'console')).toBe('C:\\Users\\x\\.claude-flow\\console')
    expect(joinPath('/work', '.claude-flow')).toBe('/work/.claude-flow')
  })
  it('join does not double a trailing separator', () => {
    expect(joinPath('C:\\Users\\x\\', 'a')).toBe('C:\\Users\\x\\a')
    expect(joinPath('c:/Users/x/', 'a/b')).toBe('c:/Users/x/a/b')
    expect(joinPath('/work/', 'a')).toBe('/work/a')
  })
  it('same path', () => {
    expect(samePath('c:\\users\\mariu\\', 'C:\\Users\\mariu')).toBe(true)
    expect(samePath('C:/Users/mariu', 'c:\\users\\MARIU')).toBe(true)
    expect(samePath('/a/B', '/a/b')).toBe(false)
  })
  it('parent segments, either separator on a Windows path', () => {
    expect(hasParentSegment('C:\\a\\..\\b')).toBe(true)
    expect(hasParentSegment('c:/a/../b')).toBe(true)
    expect(hasParentSegment('C:\\a\\b..c')).toBe(false)
    expect(hasParentSegment('/a/../b')).toBe(true)
    expect(hasParentSegment('/a\\..\\b')).toBe(false) // a POSIX name may hold a backslash
  })
  it('normalises in the style it was written', () => {
    expect(normalizePath('/a//./b/')).toBe('/a/b')
    expect(normalizePath('C:\\a\\.\\b')).toBe('C:\\a\\b')
    expect(normalizePath('c:/a//b')).toBe('c:/a/b')
    expect(normalizePath('C:\\x\\proj/out/./f.md')).toBe('C:\\x\\proj/out/f.md')
    expect(normalizePath('\\\\srv\\share\\a')).toBe('\\\\srv\\share\\a')
  })
  it('protected folders are matched ignoring case on a Windows path, exactly on a POSIX one', () => {
    for (const p of ['C:/proj/.Claude-Flow/Console/x', 'C:/proj/.CLAUDE-FLOW/protector-mod/y', 'c:/proj/.claude-flow/console/x', 'C:/proj/.Claude-Flow']) expect(isProtectedPath(p), p).toBe(true)
    expect(isProtectedPath('C:/proj/src/x')).toBe(false)
    // POSIX is case-sensitive and stays so (pinned from base behaviour).
    expect(isProtectedPath('/proj/.Claude-Flow/Console/x')).toBe(false)
    expect(isProtectedPath('/proj/.claude-flow/console/x')).toBe(true)
  })
  it('an envelope refuses a differently-cased protected drive path and accepts an ordinary one', () => {
    const base = { name: 'a', toolClasses: ['read'], repos: [], network: [], secretEnv: [], spend: { hourUsd: 1, dayUsd: 1, totalUsd: 1 }, concurrency: 1, maxDurationMs: 3_600_000, verify: [], acceptWithoutAnatole: false }
    const withPath = (p: string) => validateEnvelope({ ...base, paths: [p] })

    expect(withPath('C:/proj/.Claude-Flow/Console/x').ok).toBe(false)
    expect(withPath('C:/proj/.CLAUDE-FLOW/protector-mod/y').ok).toBe(false)
    expect(withPath('C:/proj/src/x').ok).toBe(true)
  })
  it('below and trimTrailing', () => {
    expect(below('/work', '/work/a/b')).toEqual(['a', 'b'])
    expect(below('/work', '/workshop/a')).toBeNull()
    expect(below('/work', '/work')).toBeNull()
    expect(below('C:\\Work\\', 'c:/work/a/b')).toEqual(['a', 'b'])
    expect(below('C:\\Work', 'D:\\work\\a')).toBeNull()
    expect(trimTrailing('C:\\a\\\\')).toBe('C:\\a')
    expect(trimTrailing('/a//')).toBe('/a')
  })
  it('Windows containment: a sibling that shares a prefix is not inside, another drive is not inside, either separator and any case is', () => {
    expect(below('C:\\proj', 'C:\\project\\x')).toBeNull()
    expect(below('C:\\proj', 'C:\\proj\\x')).toEqual(['x'])
    expect(below('C:\\proj', 'c:/PROJ/x')).toEqual(['x'])
    expect(below('C:\\proj', 'D:\\proj\\x')).toBeNull()
    expect(below('\\\\srv\\share\\a', '\\\\srv\\share\\a\\b')).toEqual(['b'])
    expect(below('\\\\srv\\share\\a', '\\\\srv\\share\\ab')).toBeNull()
  })
  it('Windows parent segments are seen with either separator, in a drive path and in a share path', () => {
    expect(hasParentSegment('C:/a\\..\\b')).toBe(true)
    expect(hasParentSegment('\\\\srv\\share\\..\\x')).toBe(true)
    expect(hasParentSegment('C:\\a\\b..c\\d')).toBe(false)
  })
  it('samePath rule: if either side is a Windows path, both compare ignoring case, separator style and trailing separators (a UNC share equals its // form)', () => {
    expect(samePath('\\\\srv\\share\\x', '//srv/share/x')).toBe(true)
    expect(samePath('\\\\srv\\share\\x', '\\\\SRV\\share\\x\\')).toBe(true)
    expect(samePath('\\\\srv\\share\\x', '\\\\srv\\share\\y')).toBe(false)
  })
})
