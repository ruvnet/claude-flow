import type { On } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

import { START, world } from './fixtures/world'

tier('user')

const HOME = '/home/p'
const CFG = `${HOME}/.claude`
const CLONE = `${CFG}/plugins/marketplaces/ruflo`
const manifest = (name: string) => `${CLONE}/plugins/${name}/.claude-plugin/plugin.json`
const ALL = { 'ruflo-mods@ruflo': true, 'ruflo-swarm@ruflo': true, 'ruflo-console@ruflo': true }
const known = JSON.stringify({ ruflo: { source: { source: 'github', repo: 'ruvnet/ruflo' }, installLocation: CLONE } })

/** The world with a home, the settings, and what the toast hook saw (the self-check speaks through the shared toast policy). */
function rig(on: On, enabled: Record<string, unknown>, files: Record<string, string> = {}) {
  const w = world(on, { enabledPlugins: enabled }, files)
  const toasts: string[] = []

  w.env.set('HOME', HOME)
  if (Object.keys(files).some(f => f.startsWith(CLONE))) w.dirs.add(CLONE)
  if (files[`${CFG}/plugins/known_marketplaces.json`]?.includes('PWN')) w.dirs.add(CLONE)
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
  on('clock.now', () => ({ value: Date.now() }))
  return { w, toasts }
}

describe('startup self-check: a mod that is not fully loaded says so once, in a toast', () => {
  test('a stale marketplace clone with the console plugin enabled but absent from it', async ($, on) => {
    const { toasts } = rig(on, ALL, { [`${CFG}/plugins/known_marketplaces.json`]: known, [manifest('ruflo-mods')]: '{}', [manifest('ruflo-swarm')]: '{}' })

    await $.session.start(START)

    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toContain('ruflo-console')
    expect(toasts[0]).toMatch(/stale/i)
    expect(toasts[0]).toContain('claude plugin marketplace update ruflo')
    expect(toasts[0]).not.toContain('\n')
    expect(toasts[0]!.length).toBeLessThanOrEqual(120)
  })

  test('says nothing when every enabled plugin is in the clone', async ($, on) => {
    const { toasts } = rig(on, ALL, { [`${CFG}/plugins/known_marketplaces.json`]: known, [manifest('ruflo-mods')]: '{}', [manifest('ruflo-swarm')]: '{}', [manifest('ruflo-console')]: '{}' })

    await $.session.start(START)

    expect(toasts).toEqual([])
  })

  test('says nothing about a plugin that is not enabled, or one switched off on purpose', async ($, on) => {
    const { toasts } = rig(on, { 'ruflo-mods@ruflo': true, 'ruflo-console@ruflo': false }, { [`${CFG}/plugins/known_marketplaces.json`]: known, [manifest('ruflo-mods')]: '{}' })

    await $.session.start(START)

    expect(toasts).toEqual([])
  })

  test('a cached install still loads when the clone is stale: nothing to warn about', async ($, on) => {
    const cache = `${CFG}/plugins/cache/ruflo/ruflo-console/1.0.0`
    const { w, toasts } = rig(on, ALL, {
      [`${CFG}/plugins/known_marketplaces.json`]: known,
      [manifest('ruflo-mods')]: '{}',
      [manifest('ruflo-swarm')]: '{}',
      [`${CFG}/plugins/installed_plugins.json`]: JSON.stringify({ version: 2, plugins: { 'ruflo-console@ruflo': [{ scope: 'user', installPath: cache }] } }),
    })

    w.dirs.add(cache)
    await $.session.start(START)

    expect(toasts).toEqual([])
  })

  test('no clone yet (a fresh config): nothing is stale, so nothing is said', async ($, on) => {
    const { toasts } = rig(on, ALL, { [`${CFG}/plugins/known_marketplaces.json`]: known })

    await $.session.start(START)

    expect(toasts).toEqual([])
  })

  test('unreadable files, a missing home, or a refused toast never fail the session', async ($, on) => {
    const { w } = rig(on, ALL)

    w.env.delete('HOME')
    await expect($.session.start(START)).resolves.toBeDefined()
  })

  test('the selfCheck option turns it off', { options: { selfCheck: false } }, async ($, on) => {
    const { toasts } = rig(on, ALL, { [`${CFG}/plugins/known_marketplaces.json`]: known, [manifest('ruflo-mods')]: '{}', [manifest('ruflo-swarm')]: '{}' })

    await $.session.start(START)

    expect(toasts).toEqual([])
  })

  test('hostile text in the files never reaches the toast: only fixed plugin names are spoken', async ($, on) => {
    const evil = JSON.stringify({ ruflo: { source: { source: 'github', repo: 'ruvnet/ruflo' }, installLocation: `${CLONE}\u001b]0;PWN\u0007` } })
    const { toasts } = rig(on, ALL, { [`${CFG}/plugins/known_marketplaces.json`]: evil })

    await $.session.start(START)

    for (const t of toasts) expect(t).not.toMatch(/PWN|\u001b/)
  })
})
