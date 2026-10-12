import { afterEach, describe, expect, it } from 'vitest'
import { optionsOf } from '../hooks/state'
import { isOrbital, setLook, THEME } from '../hooks/views/common'
import { withCards } from '../hooks/views/card'
import { HEADS, mark } from '../hooks/views/marks'
import { parseConfig, setOption, settingsOf } from '../hooks/settings'
import { newState } from '../hooks/state'
import { CONSOLE_CONFIG } from './fixtures/settings'

afterEach(() => setLook('plain'))
describe('orbital theme', () => {
  it('uses square red cards and restores the original theme on switch', () => {
    setLook('orbital')
    expect(isOrbital()).toBe(true)
    expect(THEME.head).toBe('#f06449')
    const kit = { Box: (props: object) => ({ props }), Text: (props: object) => ({ props }) } as never
    const head = mark(HEADS, { props: { children: 'metrics' } })
    const tree = withCards(kit).Box({ flexDirection: 'column', children: [head] } as never) as unknown as { props: { children: { props: object }[] } }
    expect(tree.props.children[0]?.props).toMatchObject({ borderStyle: 'single', borderColor: '#f06449' })
    setLook('bbs')
    expect(isOrbital()).toBe(false)
    expect(THEME.head).toBe('#ff2a6d')
    expect(optionsOf(undefined).look).toBe('bbs')
  })
  it('accepts the option through the existing settings path', () => {
    const state = newState({})
    const config = parseConfig('ruflo-console', CONSOLE_CONFIG)
    expect(config).not.toBeNull()
    settingsOf(state).configs.set('ruflo-console', config!)
    expect(setOption(state, 'ruflo-console', 'look', 'orbital', () => undefined)?.stdin).toBe('{"look":"orbital"}')
    expect(setOption(state, 'ruflo-console', 'look', 'unknown', () => undefined)).toBeNull()
  })
})
