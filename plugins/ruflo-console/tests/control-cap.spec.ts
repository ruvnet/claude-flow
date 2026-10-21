/**
 * RUFLO_CONSOLE_CONTROL is a session cap that only lowers (ADR-444 §7, ADR-450 T12). Opening Settings reloads the saved preferences, and saving
 * any AI preference writes them back: neither may lift the cap, and the cap may never be stored as the person's saved level (#3814).
 */
import { describe, expect, it } from 'vitest'

import { callTool, parseControlEnv } from '../hooks/model-tools'
import { AI_KEY, loadAiPrefs, saveAiPrefs, setControlCap, settingsOf } from '../hooks/settings'
import { rig } from './fixtures/real-rig'

const saved = (extra: Record<string, unknown> = {}) => ({ [AI_KEY]: { modelControl: 'full', modelConfirm: 'auto', ...extra } })

describe('the session control cap (#3814)', () => {
  it('stays in force after Claude opens Settings, and the capped read level still refuses a write', async () => {
    const { state, host, deps } = rig({ store: saved() })

    await loadAiPrefs(state, host)
    setControlCap(state, parseControlEnv('read:ask'))
    expect(settingsOf(state).ai).toMatchObject({ modelControl: 'read', modelConfirm: 'ask' })

    expect(await callTool('console_open', { view: 'settings' }, deps)).toMatch(/^Opened/)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(settingsOf(state).ai).toMatchObject({ modelControl: 'read', modelConfirm: 'ask' })
    expect(await callTool('console_run', { id: 'store', text: 'a note' }, deps)).toMatch(/^Refused/)
  })

  it('applies the cap on every load, however late the load resolves', async () => {
    const { state, host } = rig({ store: saved() })

    setControlCap(state, parseControlEnv('write:ask'))
    await loadAiPrefs(state, host)
    await loadAiPrefs(state, host)
    expect(settingsOf(state).ai).toMatchObject({ modelControl: 'write', modelConfirm: 'ask' })
  })

  it('never stores the cap as the saved level: saving another preference keeps the person\'s own', async () => {
    const { state, host, store } = rig({ store: saved() })

    await loadAiPrefs(state, host)
    setControlCap(state, parseControlEnv('read:ask'))
    saveAiPrefs(state, host, { budgetUsd: 2 })
    expect(store.get(AI_KEY)).toMatchObject({ modelControl: 'full', modelConfirm: 'auto', budgetUsd: 2 })
    expect(settingsOf(state).ai.modelControl).toBe('read')
  })

  it('a level the person picks during a capped session is saved as picked and still capped in force', async () => {
    const { state, host, store } = rig({ store: saved({ modelControl: 'read', modelConfirm: 'ask' }) })

    await loadAiPrefs(state, host)
    setControlCap(state, parseControlEnv('write:auto'))
    saveAiPrefs(state, host, { modelControl: 'manage', modelConfirm: 'auto' })
    expect(store.get(AI_KEY)).toMatchObject({ modelControl: 'manage', modelConfirm: 'auto' })
    expect(settingsOf(state).ai).toMatchObject({ modelControl: 'write', modelConfirm: 'auto' })
  })

  it('a saved "off" stays off under any cap, and a cap never raises a lower saved level', async () => {
    for (const cap of ['read:ask', 'full:auto', 'manage:auto']) {
      const off = rig({ store: saved({ modelControl: 'off' }) })

      await loadAiPrefs(off.state, off.host)
      setControlCap(off.state, parseControlEnv(cap))
      saveAiPrefs(off.state, off.host, { budgetUsd: 2 })
      expect(settingsOf(off.state).ai.modelControl).toBe('off')
      expect(off.store.get(AI_KEY)).toMatchObject({ modelControl: 'off' })
    }

    const low = rig({ store: saved({ modelControl: 'read', modelConfirm: 'ask' }) })

    await loadAiPrefs(low.state, low.host)
    setControlCap(low.state, parseControlEnv('full:auto'))
    expect(settingsOf(low.state).ai).toMatchObject({ modelControl: 'read', modelConfirm: 'ask' })
  })
})
