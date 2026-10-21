/**
 * The version the console shows is the plugin's manifest version, and the header adds the git revision so a session can tell which
 * build it has: the version is the same across every commit of a release. Run with
 *   npx vitest run plugins/ruflo-console/tests/version.spec.ts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { buildOf, getBuild, isOurCheckout, setBuild } from '../hooks/build'
import { bannerPicture } from '../hooks/gfx/pictures'
import { newState } from '../hooks/state'
import { CONSOLE_VERSION } from '../hooks/version'
import { picturesOf } from '../hooks/views/frames'

const header = (): string => {
  const grid = bannerPicture('demo', 100, 0)

  return Array.from({ length: grid.columns }, (_, x) => String.fromCodePoint(grid.cells[x * 3] || 32)).join('')
}

describe('console version', () => {
  it('matches the plugin manifest, so the header shows the build that is running', () => {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../.claude-plugin/plugin.json', import.meta.url) as never), 'utf8')) as { version: string }

    expect(CONSOLE_VERSION).toBe(manifest.version)
  })
})

describe('build id', () => {
  afterEach(() => setBuild(''))

  it('accepts a short revision, with -dirty for uncommitted edits, and nothing else', () => {
    expect(buildOf('2dc45ae\n')).toBe('2dc45ae')
    expect(buildOf('2dc45ae-dirty')).toBe('2dc45ae-dirty')
    expect(buildOf('')).toBe('')
    expect(buildOf('fatal: not a git repository')).toBe('')
    expect(buildOf('\u001b[31m2dc45ae')).toBe('')
    expect(buildOf('2dc45ae-dirty; rm -rf')).toBe('')
    expect(buildOf('XYZ')).toBe('')
    expect(buildOf('a'.repeat(41))).toBe('')
  })

  it('takes a folder as ours only when it is plugins/ruflo-console in its repository, so an installed copy inside another repo shows no commit', () => {
    expect(isOurCheckout('plugins/ruflo-console/\n')).toBe(true)
    expect(isOurCheckout('plugins/ruflo-console')).toBe(true)
    expect(isOurCheckout('\n')).toBe(false)
    expect(isOurCheckout('.claude/plugins/cache/ruflo/ruflo-console/0.25.0/\n')).toBe(false)
    expect(isOurCheckout('plugins/ruflo-console-evil/')).toBe(false)
  })

  it('the plain look, which has no banner, shows the version and the build on its own header too', () => {
    const plain = (): string => {
      const state = newState({ look: 'plain' } as never)

      state.view = 'menu'

      const grid = picturesOf(state, 90, 0, 5).get('header') as ReturnType<typeof bannerPicture>

      return Array.from({ length: grid.columns }, (_, x) => String.fromCodePoint(grid.cells[x * 3] || 32)).join('')
    }

    expect(plain()).toContain(`◆ ruflo v${CONSOLE_VERSION} ·`)
    expect(plain()).not.toContain('2dc45ae')

    setBuild('2dc45ae')
    expect(plain()).toContain(`◆ ruflo v${CONSOLE_VERSION} · 2dc45ae ·`)
  })

  it('shows on the header after the version when known, and not at all when not', () => {
    expect(header()).toContain(`v${CONSOLE_VERSION}`)
    expect(header()).not.toContain('·')

    setBuild('2dc45ae-dirty')
    expect(getBuild()).toBe('2dc45ae-dirty')
    expect(header()).toContain(`v${CONSOLE_VERSION} · 2dc45ae-dirty`)
  })
})
