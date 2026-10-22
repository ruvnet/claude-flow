/**
 * The updater's scope rule and its quiet re-check: it updates every install that applies to the session (the user copy and this
 * project's), reads each back before calling it installed, and a session left open re-asks without opening a dialog.
 */
import { describe, expect, it } from 'vitest'

import { applyUpdate, checkForUpdate } from '../hooks/update-flow'
import { CHECK_EVERY_MS, CHECKED_KEY, installedEntries, LABEL, NOTIFIED_KEY, RECHECK_EVERY_MS } from '../hooks/updates'
import { INSTALLED_KEY, NOW, PLUGIN_ID, session } from './fixtures/update-session'

describe('every install that applies to the session', () => {
  const at = (scope: string, version: string, projectPath?: string) => ({ id: PLUGIN_ID, version, scope, enabled: true, ...(projectPath !== undefined && { projectPath }) })
  const list = (...entries: object[]) => JSON.stringify(entries)

  it('lists the user install and this project\'s, not another project\'s, and a folder inside the project counts as the project', () => {
    const json = list(at('user', '0.26.1'), at('project', '0.26.1', '/work/app'), at('project', '0.6.0', '/work/other'), at('local', '0.7.0', '/work/app-two'))

    expect(installedEntries(json, '/work/app')).toEqual([{ version: '0.26.1', scope: 'user' }, { version: '0.26.1', scope: 'project' }])
    expect(installedEntries(json, '/work/app/packages/ui').map(entry => entry.scope)).toEqual(['user', 'project'])
    expect(installedEntries(json, '/work/app-two').map(entry => `${entry.scope}@${entry.version}`)).toEqual(['user@0.26.1', 'local@0.7.0'])
    expect(installedEntries(json, '/elsewhere').map(entry => entry.scope)).toEqual(['user'])
  })

  it('falls back to the single entry the old rule would pick, rather than refusing, when only other projects have it', () => {
    expect(installedEntries(list(at('project', '0.6.0', '/work/other')), '/work/app')).toEqual([{ version: '0.6.0', scope: 'project' }])
    for (const bad of ['', 'not json', '{}', '[]']) expect(installedEntries(bad, '/work/app')).toEqual([])
  })

  it('updates the project copy that loads here, not just the user copy, and reads both back', async () => {
    const s = session({ listed: [list(at('user', '0.27.0'), at('project', '0.26.0', '/work/app')), list(at('user', '0.27.0'), at('project', '0.27.0', '/work/app'))] })
    const result = await applyUpdate(s.deps, '0.27.0')

    expect(s.log.ran.filter(argv => argv[2] === 'update' && argv[1] === 'plugin' && argv[3] === PLUGIN_ID)).toEqual([['claude', 'plugin', 'update', PLUGIN_ID, '--scope', 'project']])
    expect(result.outcome).toBe('installed')
  })

  it('updates every scope that is behind, once each', async () => {
    const s = session({ listed: [list(at('user', '0.26.0'), at('project', '0.26.0', '/work/app')), list(at('user', '0.27.0'), at('project', '0.27.0', '/work/app'))] })
    const result = await applyUpdate(s.deps, '0.27.0')

    expect(s.log.ran.filter(argv => argv[3] === PLUGIN_ID).map(argv => argv[5])).toEqual(['user', 'project'])
    expect(result.outcome).toBe('installed')
  })

  it('does not call it installed while the copy that loads here is still behind', async () => {
    const stuck = list(at('user', '0.27.0'), at('project', '0.26.0', '/work/app'))
    const s = session({ listed: [stuck, stuck] })
    const result = await applyUpdate(s.deps, '0.27.0')

    expect(result.outcome).toBe('unverified')
    expect(result.detail).toContain('project 0.26.0')
    expect(s.store.get(INSTALLED_KEY)).toBeUndefined()
  })

  it('names the scope whose update failed', async () => {
    const s = session({ listed: [list(at('user', '0.26.0'))], updateExit: 1, updateOut: 'boom' })
    const result = await applyUpdate(s.deps, '0.27.0')

    expect(result.outcome).toBe('failed')
    expect(result.detail).toContain('user scope')
  })

  it('leaves an install that is already current alone and says to restart', async () => {
    const s = session({ listed: [list(at('user', '0.27.0'))] })
    const result = await applyUpdate(s.deps, '0.27.0')

    expect(s.log.ran.some(argv => argv[3] === PLUGIN_ID)).toBe(false)
    expect(result.outcome).toBe('installed')
  })
})

describe('the quiet re-check of a session left open', () => {
  it('re-asks more often than it touches the network, which the daily gate still limits', () => {
    expect(RECHECK_EVERY_MS).toBeLessThan(CHECK_EVERY_MS)
  })

  it('opens no dialog, toasts once, leaves the daily gate open, and still offers the version in Settings', async () => {
    const s = session({ choice: LABEL.now })
    const first = await checkForUpdate(s.deps, { quiet: true })

    expect(s.log.asked).toEqual([])
    expect(first).toMatchObject({ outcome: 'declined', remote: '0.27.0' })
    expect(s.log.toasts).toHaveLength(1)
    expect(s.store.get(CHECKED_KEY)).toBeUndefined()
    expect(s.store.get(NOTIFIED_KEY)).toBe('0.27.0')
    expect(s.log.ran).toEqual([])

    await checkForUpdate(s.deps, { quiet: true })
    expect(s.log.toasts).toHaveLength(1)
  })

  it('does not stop an install the person chose to be automatic', async () => {
    const s = session({ mode: 'auto' })
    const result = await checkForUpdate(s.deps, { quiet: true })

    expect(result.outcome).toBe('installed')
    expect(s.log.asked).toEqual([])
  })

  it('still marks the day as checked when nothing newer exists, and never installs while checks are off', async () => {
    const current = session({ published: '0.26.0' })

    expect((await checkForUpdate(current.deps, { quiet: true })).outcome).toBe('current')
    expect(current.store.get(CHECKED_KEY)).toBe(NOW)
    expect((await checkForUpdate(session({ mode: 'off' }).deps, { quiet: true })).outcome).toBe('skipped')
  })
})
