/**
 * Updates: the pure rules (versions, the manifest, what to do, the question, the installed list), then the whole flow driven with
 * fakes (no host, no network): when it checks, what it asks, what it runs, what it refuses, and that it never claims an install it
 * has not read back. Run with
 *   npx vitest run plugins/ruflo-console/tests/updates.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { applyUpdate, checkForUpdate, type UpdateDeps } from '../hooks/update-flow'
import { NOW, session } from './fixtures/update-session'
import {
  APPLYING_HOLD_MS,
  APPLYING_KEY,
  bumpKind,
  CHECK_EVERY_MS,
  CHECKED_KEY,
  decide,
  firstLine,
  INSTALLED_KEY,
  installedEntries,
  installedEntry,
  NOTIFIED_KEY,
  RECHECK_EVERY_MS,
  isBeingApplied,
  isDue,
  LABEL,
  MANUAL_COMMAND,
  parseMode,
  parseSemver,
  PLUGIN_ID,
  promptOf,
  versionFromManifest,
} from '../hooks/updates'


describe('versions', () => {
  it('reads major.minor.patch and nothing else', () => {
    expect(parseSemver('0.26.0')).toEqual([0, 26, 0])
    expect(parseSemver(' 1.2.3 ')).toEqual([1, 2, 3])
    for (const bad of ['1.2', '1.2.3-alpha.1', '1.2.3+build', 'v1.2.3', '', 'x.y.z', '1.2.3.4', '99999.0.0']) expect(parseSemver(bad), bad).toBeNull()
  })

  it('says what a newer version is, and nothing for the same, an older one, or a non-version: never a downgrade', () => {
    expect(bumpKind('0.26.0', '0.26.1')).toBe('patch')
    expect(bumpKind('0.26.0', '0.27.0')).toBe('minor')
    expect(bumpKind('0.26.5', '0.27.0')).toBe('minor')
    expect(bumpKind('0.26.0', '1.0.0')).toBe('major')
    expect(bumpKind('0.26.0', '0.26.0')).toBeNull()
    expect(bumpKind('0.26.1', '0.26.0')).toBeNull()
    expect(bumpKind('0.27.0', '0.26.9')).toBeNull()
    expect(bumpKind('1.0.0', '0.99.0')).toBeNull()
    expect(bumpKind('0.26.0', '0.27.0-rc.1')).toBeNull()
    expect(bumpKind('garbage', '0.27.0')).toBeNull()
  })
})

describe('the published manifest', () => {
  it('gives the version only when the manifest is ours and a plain version', () => {
    expect(versionFromManifest(JSON.stringify({ name: 'ruflo-console', version: '0.27.0' }))).toBe('0.27.0')
    expect(versionFromManifest(JSON.stringify({ name: 'something-else', version: '9.9.9' }))).toBeNull()
    expect(versionFromManifest(JSON.stringify({ name: 'ruflo-console', version: '0.27.0-beta' }))).toBeNull()
    expect(versionFromManifest(JSON.stringify({ name: 'ruflo-console' }))).toBeNull()
    expect(versionFromManifest('<html>404</html>')).toBeNull()
    expect(versionFromManifest('')).toBeNull()
  })
})

describe('when to check, and what to do', () => {
  it('checks when it never has, a day has passed, or the stored time is in the future', () => {
    expect(isDue(undefined, NOW)).toBe(true)
    expect(isDue('yesterday', NOW)).toBe(true)
    expect(isDue(NOW - CHECK_EVERY_MS, NOW)).toBe(true)
    expect(isDue(NOW - CHECK_EVERY_MS + 1, NOW)).toBe(false)
    expect(isDue(NOW + 5_000, NOW)).toBe(true)
  })

  it('holds off while another session is updating, for a few minutes, not for ever', () => {
    expect(isBeingApplied(NOW - 1_000, NOW)).toBe(true)
    expect(isBeingApplied(NOW - APPLYING_HOLD_MS, NOW)).toBe(false)
    expect(isBeingApplied(0, NOW)).toBe(false)
    expect(isBeingApplied(undefined, NOW)).toBe(false)
  })

  it('off does nothing; ask asks; auto installs without asking, but a major version always asks', () => {
    expect(decide('off', 'patch')).toBe('none')
    expect(decide('ask', null)).toBe('none')
    expect(decide('auto', null)).toBe('none')
    expect(decide('ask', 'patch')).toBe('ask')
    expect(decide('ask', 'major')).toBe('ask')
    expect(decide('auto', 'patch')).toBe('auto')
    expect(decide('auto', 'minor')).toBe('auto')
    expect(decide('auto', 'major')).toBe('ask')
  })

  it('keeps ask unless the stored value is exactly auto or off', () => {
    expect(parseMode('auto')).toBe('auto')
    expect(parseMode('off')).toBe('off')
    for (const other of ['ask', 'yes', undefined, null, 1, '']) expect(parseMode(other)).toBe('ask')
  })
})

describe('the question', () => {
  it('offers Update now, Always and Not now below a major version, says what Always means, and ends in a question mark', () => {
    const { question, options } = promptOf('0.26.0', '0.27.0', 'minor')

    expect(options).toEqual([LABEL.now, LABEL.always, LABEL.later])
    expect(question).toContain('0.27.0')
    expect(question).toContain('github.com/ruvnet/ruflo')
    expect(question).toContain('without asking')
    expect(question).toContain('a new major version always asks')
    expect(question).toContain('Settings')
    expect(question.trimEnd().endsWith('?')).toBe(true)
  })

  it('offers no Always for a major version, and says it is one', () => {
    const { question, options } = promptOf('0.26.0', '1.0.0', 'major')

    expect(options).toEqual([LABEL.now, LABEL.later])
    expect(question).toContain('major version')
    expect(question).not.toContain('Always auto-update')
  })
})

describe('the installed list', () => {
  const entry = (over: Record<string, unknown>) => ({ id: PLUGIN_ID, version: '0.26.0', scope: 'user', enabled: true, ...over })

  it('prefers the user-scope entry, then an enabled one, then the first; and ignores other plugins', () => {
    expect(installedEntry(JSON.stringify([entry({ scope: 'project', version: '0.1.0' }), entry({ scope: 'user', version: '0.2.0' })]))).toEqual({ version: '0.2.0', scope: 'user' })
    expect(installedEntry(JSON.stringify([entry({ scope: 'project', enabled: false, version: '0.1.0' }), entry({ scope: 'local', version: '0.3.0' })]))).toEqual({ version: '0.3.0', scope: 'local' })
    expect(installedEntry(JSON.stringify([entry({ id: 'ruflo-adr@ruflo', version: '9.9.9' })]))).toBeNull()
  })

  it('is null for output that is not the list, or an entry without a version or scope', () => {
    expect(installedEntry('')).toBeNull()
    expect(installedEntry('{"id":"x"}')).toBeNull()
    expect(installedEntry('[]')).toBeNull()
    expect(installedEntry(JSON.stringify([entry({ version: undefined })]))).toBeNull()
    expect(installedEntry(JSON.stringify([entry({ scope: undefined })]))).toBeNull()
  })
})

describe('a line of output', () => {
  it('takes the first line with escapes, control characters and bidirectional marks removed, cut to fit', () => {
    expect(firstLine('\u001b[31mfailed\u001b[0m: no network\nsecond')).toBe('failed: no network')
    expect(firstLine('\n\n  real‮ line')).toBe('real line')
    expect(firstLine('x'.repeat(300)).length).toBe(140)
    expect(firstLine('')).toBe('')
  })
})

describe('the flow: when it does not even look', () => {
  it('does nothing when updates are off, in a non-interactive run, or in a development checkout', async () => {
    for (const script of [{ mode: 'off' as const }, { interactive: false }, { isDev: true }]) {
      const s = session(script)
      const result = await checkForUpdate(s.deps)

      expect(result.outcome, JSON.stringify(script)).toBe('skipped')
      expect(s.log.fetches).toBe(0)
      expect(s.log.ran).toEqual([])
    }
  })

  it('looks at most once a day, and not while another session is updating', async () => {
    const recent = session({ store: { [CHECKED_KEY]: NOW - 1_000 } })
    const busy = session({ store: { [APPLYING_KEY]: NOW - 1_000 } })
    const stale = session({ store: { [CHECKED_KEY]: NOW - CHECK_EVERY_MS - 1 }, choice: LABEL.later })

    expect((await checkForUpdate(recent.deps)).outcome).toBe('skipped')
    expect((await checkForUpdate(busy.deps)).outcome).toBe('skipped')
    expect(recent.log.fetches + busy.log.fetches).toBe(0)
    expect((await checkForUpdate(stale.deps)).outcome).toBe('declined')
    expect(stale.log.fetches).toBe(1)
  })

  it('skips a version that is already installed and waiting for a restart, rather than asking again', async () => {
    const s = session({ store: { [INSTALLED_KEY]: '0.27.0' } })

    expect((await checkForUpdate(s.deps)).outcome).toBe('skipped')
    expect(s.log.asked).toEqual([])
  })
})

describe('the flow: what GitHub says', () => {
  it('is current when nothing newer is published, and remembers it looked', async () => {
    for (const published of ['0.26.0', '0.25.9']) {
      const s = session({ published })
      const result = await checkForUpdate(s.deps)

      expect(result.outcome, published).toBe('current')
      expect(s.log.asked).toEqual([])
      expect(s.store.get(CHECKED_KEY)).toBe(NOW)
    }
  })

  it('fails quietly, and tries again next time, when GitHub cannot be reached, hangs, or sends something that is not our manifest', async () => {
    for (const manifest of ['reject', 'hang', '{"name":"someone-else","version":"9.0.0"}', 'not json'] as const) {
      const s = session({ manifest })
      const result = await checkForUpdate(s.deps)

      expect(result.outcome, manifest).toBe('failed')
      expect(s.log.asked).toEqual([])
      expect(s.log.ran).toEqual([])
      expect(s.store.has(CHECKED_KEY), manifest).toBe(false)
    }
  })

  it('never throws, even when the store does', async () => {
    const s = session()

    s.deps.get = async () => {
      throw new Error('store is broken')
    }

    expect((await checkForUpdate(s.deps)).outcome).toBe('failed')
  })
})

describe('the flow: asking', () => {
  it('Not now, a dismissed dialog, and anything typed under Other install nothing', async () => {
    for (const choice of [LABEL.later, 'reject', 'sure, why not']) {
      const s = session({ choice })
      const result = await checkForUpdate(s.deps)

      expect(result.outcome, choice).toBe('declined')
      expect(s.log.ran, choice).toEqual([])
      expect(s.modeNow(), choice).toBe('ask')
    }
  })

  it('asks with the three choices and installs on Update now, leaving the mode as it was', async () => {
    const s = session({ choice: LABEL.now })
    const result = await checkForUpdate(s.deps)

    expect(s.log.asked[0]?.options).toEqual([LABEL.now, LABEL.always, LABEL.later])
    expect(result.outcome).toBe('installed')
    expect(s.modeNow()).toBe('ask')
    expect(s.store.get(INSTALLED_KEY)).toBe('0.27.0')
    expect(s.log.toasts.at(-1)).toContain('restart Claude Code')
  })

  it('runs the marketplace update and then the plugin update in the scope it is installed in, and reads the list before and after', async () => {
    const s = session({ choice: LABEL.now })

    await checkForUpdate(s.deps)
    expect(s.log.ran).toEqual([
      ['claude', 'plugin', 'list', '--json'],
      ['claude', 'plugin', 'marketplace', 'update', 'ruflo'],
      ['claude', 'plugin', 'update', PLUGIN_ID, '--scope', 'user'],
      ['claude', 'plugin', 'list', '--json'],
    ])
  })

  it('Always auto-update turns it on, and installs this one', async () => {
    const s = session({ choice: LABEL.always })
    const result = await checkForUpdate(s.deps)

    expect(s.modeNow()).toBe('auto')
    expect(s.log.writes).toContainEqual(['updates', 'auto'])
    expect(result.outcome).toBe('installed')
  })
})

describe('the flow: always', () => {
  it('installs a minor or patch version without asking, saying so first', async () => {
    for (const published of ['0.27.0', '0.26.1']) {
      const s = session({ mode: 'auto', published })
      const result = await checkForUpdate(s.deps)

      expect(result.outcome, published).toBe('installed')
      expect(s.log.asked, published).toEqual([])
      expect(s.log.toasts[0], published).toContain('Updating ruflo-console')
    }
  })

  it('still asks for a major version, and offers no Always there', async () => {
    const s = session({ mode: 'auto', published: '1.0.0', choice: LABEL.later })
    const result = await checkForUpdate(s.deps)

    expect(result.outcome).toBe('declined')
    expect(s.log.asked[0]?.options).toEqual([LABEL.now, LABEL.later])
    expect(s.log.ran).toEqual([])
  })

  it('"Always" cannot be picked for a major version even if the dialog returns it', async () => {
    const s = session({ mode: 'ask', published: '1.0.0', choice: LABEL.always })
    const result = await checkForUpdate(s.deps)

    expect(result.outcome).toBe('declined')
    expect(s.modeNow()).toBe('ask')
  })
})

describe('the flow: "check now"', () => {
  it('ignores the daily gate and an off setting, but still asks and still skips a development checkout', async () => {
    const off = session({ mode: 'off', store: { [CHECKED_KEY]: NOW - 1_000 }, choice: LABEL.now })
    const dev = session({ mode: 'off', isDev: true })

    expect((await checkForUpdate(off.deps, { force: true })).outcome).toBe('installed')
    expect(off.log.asked).toHaveLength(1)
    expect(off.modeNow()).toBe('off')
    expect((await checkForUpdate(dev.deps, { force: true })).outcome).toBe('skipped')
    expect(dev.log.fetches).toBe(0)
  })
})

describe('the flow: what it will not do, and what it will not claim', () => {
  it('never passes -y or --accept-command to Claude Code, in any run', async () => {
    for (const script of [{ choice: LABEL.now }, { mode: 'auto' as const }, { choice: LABEL.now, updateExit: 1, updateOut: 'shownCommand sha256 abc' }]) {
      const s = session(script)

      await checkForUpdate(s.deps)
      for (const argv of s.log.ran) {
        expect(argv).not.toContain('-y')
        expect(argv).not.toContain('--yes')
        expect(argv).not.toContain('--accept-command')
      }
    }
  })

  it("leaves Claude Code's own confirmation to the person, and says the command to run", async () => {
    const s = session({ choice: LABEL.now, updateExit: 1, updateOut: 'a marketplace-declared command must be confirmed: shownCommand sha256 abc' })
    const result = await checkForUpdate(s.deps)

    expect(result.outcome).toBe('failed')
    expect(result.detail).toContain(MANUAL_COMMAND)
    expect(s.store.has(INSTALLED_KEY)).toBe(false)
  })

  it('does not call it installed when the list afterwards still shows the old version', async () => {
    const s = session({ choice: LABEL.now, listed: [JSON.stringify([{ id: PLUGIN_ID, version: '0.26.0', scope: 'user', enabled: true }])] })
    const result = await checkForUpdate(s.deps)

    expect(result.outcome).toBe('unverified')
    expect(result.detail).toContain('0.26.0')
    expect(s.store.has(INSTALLED_KEY)).toBe(false)
    expect(s.log.toasts.at(-1)).not.toContain('installed')
  })

  it('has nothing to update when the plugin is not installed from the marketplace (a --plugin-dir session), and runs no update', async () => {
    const s = session({ choice: LABEL.now, listed: ['[]'] })
    const result = await checkForUpdate(s.deps)

    expect(result.outcome).toBe('failed')
    expect(result.detail).toContain('--plugin-dir')
    expect(s.log.ran).toEqual([['claude', 'plugin', 'list', '--json']])
  })

  it('stops, and says why, when the marketplace will not update', async () => {
    const s = session({ choice: LABEL.now, marketExit: 1 })
    const result = await checkForUpdate(s.deps)

    expect(result.outcome).toBe('failed')
    expect(result.detail).toContain('could not resolve host')
    expect(s.log.ran.some(argv => argv[2] === 'update')).toBe(false)
  })

  it('always lets the other sessions go again, whether the install worked or not', async () => {
    for (const script of [{ choice: LABEL.now }, { choice: LABEL.now, marketExit: 1 }, { choice: LABEL.now, listed: ['[]'] }]) {
      const s = session(script)

      await checkForUpdate(s.deps)
      expect(s.store.get(APPLYING_KEY), JSON.stringify(script)).toBe(0)
    }
  })

  it('applyUpdate alone reads the list before it touches anything', async () => {
    const s = session({ listed: ['not json'] })
    const result = await applyUpdate(s.deps, '0.27.0')

    expect(result.outcome).toBe('failed')
    expect(s.log.ran).toEqual([['claude', 'plugin', 'list', '--json']])
  })
})
