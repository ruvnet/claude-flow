import { describe, expect, it } from 'vitest'
import { discover } from '../hooks/adr'
import { resolveTarget } from '../hooks/data/event-export'
import { resolveExportPath } from '../hooks/data/wf-file'
import type { ReaderFs } from '../hooks/data/files'

// #4356: on Windows `state.cwd` is a drive path (`C:\Users\...`), not `/...`. Each of these
// three sites hardcoded `base.startsWith('/')` (or `root.startsWith('/')`) as its "do we know
// the project folder" guard, so all three fail closed on Windows regardless of settings —
// matching the already-fixed #4175 bug in register.ts (see abs-path.spec.ts).

const WIN_CWD = 'C:\\Users\\dev\\project'

function fsWithDir(dirPath: string): Pick<ReaderFs, 'stat' | 'list' | 'read'> {
  return {
    stat: async (path: string) => (path === dirPath ? { kind: 'dir' } : undefined),
    list: async () => [],
    read: async () => '',
  }
}

describe('adr.ts discover() finds a Windows project folder (#4356)', () => {
  it('reads the configured ADR folder when cwd is a Windows drive path', async () => {
    const dir = `${WIN_CWD}/docs`
    const result = await discover({ fs: fsWithDir(dir) }, WIN_CWD, 'docs')

    expect(result).toEqual({ dir: 'docs', why: '' })
  })

  it('still reports "no project folder is known" for a genuinely empty cwd', async () => {
    const result = await discover({ fs: fsWithDir('/anything') }, '', 'docs')

    expect(result.dir).toBeNull()
    expect(result.why).toBe('no project folder is known')
  })
})

describe('event-export.ts resolveTarget() on a Windows drive path (#4356)', () => {
  it('resolves a bare file name under the exports folder, preserving the drive prefix', () => {
    const result = resolveTarget('summary.md', WIN_CWD, ['md'])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.path.startsWith('C:')).toBe(true)
      expect(result.path).not.toMatch(/^\/C:/)
      expect(result.path.endsWith('/summary.md')).toBe(true)
    }
  })

  it('refuses a target outside the Windows project root', () => {
    const result = resolveTarget('../../escape.md', WIN_CWD, ['md'])

    expect(result.ok).toBe(false)
  })
})

describe('wf-file.ts resolveExportPath() on a Windows drive path (#4356)', () => {
  it('resolves a relative transcript name under the project, preserving the drive prefix', () => {
    const result = resolveExportPath('.claude-flow/console/exports/transcript.md', { cwd: WIN_CWD })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.path.startsWith('C:')).toBe(true)
      expect(result.path).not.toMatch(/^\/C:/)
      expect(result.path.endsWith('/transcript.md')).toBe(true)
    }
  })

  it('refuses a pre-joined absolute Windows path as input, same as the backslash rule always did', () => {
    const result = resolveExportPath(`${WIN_CWD}/.claude-flow/console/exports/transcript.md`, { cwd: WIN_CWD })

    expect(result.ok).toBe(false)
  })
})

describe('wf-convo-live.ts calls resolveExportPath with a relative name, not a pre-joined cwd (#4356)', () => {
  it('saveTranscript no longer prefixes state.cwd onto the resolveExportPath input', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../hooks/wf-convo-live.ts', import.meta.url), 'utf8')

    expect(source).toContain('resolveExportPath(`${EXPORT_DIR}/${transcriptName(target.id, Date.now())}`, roots)')
    expect(source).not.toMatch(/resolveExportPath\(`\$\{state\.cwd/)
  })
})
