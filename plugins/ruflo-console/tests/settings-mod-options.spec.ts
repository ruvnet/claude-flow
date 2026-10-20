/**
 * The ruflo-mods switches (toolHints, agentTrim, agentTrimKeep, deliveryScreen) in Settings: shown at the simple level with an honest one-line
 * note, changed only through the same confirm-gated option write as every other plugin option, and in the install class for Claude's console tools.
 */
import { describe, expect, it } from 'vitest'

import { allows, ALWAYS_ASK, classOf } from '../hooks/model-tools'
import { OPTION_NOTES, parseConfig, setOption, settingsOf, shownKeys } from '../hooks/settings'
import { newState } from '../hooks/state'
import { MODS_CONFIG } from './fixtures/settings'

const KEYS = ['toolHints', 'agentTrim', 'agentTrimKeep', 'deliveryScreen']

function loaded() {
  const state = newState({})
  const config = parseConfig('ruflo-mods', MODS_CONFIG)

  if (config === null) throw new Error('fixture does not parse')
  settingsOf(state).configs.set('ruflo-mods', config)

  return { state, config }
}

describe('ruflo-mods switches in Settings', () => {
  it('lists all four at the simple level and keeps the secret hidden', () => {
    const { config } = loaded()

    expect(shownKeys(config, 'simple')).toEqual(expect.arrayContaining(KEYS))
    expect(shownKeys(config, 'advanced')).toEqual(expect.arrayContaining(KEYS))
    expect(config.schema.relayApiToken?.isSecret).toBe(true)
    expect(shownKeys(config, 'simple')).not.toContain('relayApiToken')
  })

  it('has an honest note for each, with the measured and unmeasured claims stated', () => {
    const notes = OPTION_NOTES['ruflo-mods'] ?? {}

    expect(Object.keys(notes).sort()).toEqual([...KEYS].sort())
    expect(notes.agentTrim).toContain('about 4,000 fewer prompt tokens measured')
    expect(notes.agentTrim).toContain('refused when spawned')
    expect(notes.deliveryScreen).toContain('default off')
    expect(notes.deliveryScreen).toContain('small test set, real-world rate unknown')
    for (const note of Object.values(notes)) expect(note.length).toBeLessThan(110)
  })

  it('changes one through the same confirm-gated plugin write as any other option', () => {
    const { state } = loaded()
    const spec = setOption(state, 'ruflo-mods', 'agentTrim', 'true', () => undefined)

    expect(spec?.argv).toEqual(['claude', 'plugin', 'configure', 'ruflo-mods@ruflo', '--values-stdin'])
    expect(spec?.stdin).toBe('{"agentTrim":"true"}')
    expect(setOption(state, 'ruflo-mods', 'agentTrim', 'maybe', () => undefined)).toBeNull()
    expect(setOption(state, 'ruflo-mods', 'relayApiToken', 'x', () => undefined)).toBeNull()
  })

  it('is in the same class as every other option write: install, full level only, and always asks', () => {
    const { state } = loaded()

    for (const key of ['agentTrim', 'deliveryScreen', 'toolHints']) {
      const spec = setOption(state, 'ruflo-mods', key, 'true', () => undefined)

      expect(spec, key).not.toBeNull()
      expect(classOf(spec as NonNullable<typeof spec>), key).toBe('install')
    }

    expect(allows('manage', 'install')).toBe(false)
    expect(allows('write', 'install')).toBe(false)
    expect(allows('full', 'install')).toBe(true)
    expect(ALWAYS_ASK).toContain('install')
  })
})
