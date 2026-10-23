import { describe, expect, it } from 'vitest'

import { homeOf } from '../hooks/data/paths'

describe('homeOf', () => {
  it('returns HOME when set', () => {
    const get = (k: string): string | undefined => k === 'HOME' ? '/home/user' : undefined
    expect(homeOf(get)).toBe('/home/user')
  })

  it('returns USERPROFILE when HOME is empty and USERPROFILE is set', () => {
    const get = (k: string): string | undefined => k === 'USERPROFILE' ? 'C:\\Users\\mariu' : undefined
    expect(homeOf(get)).toBe('C:\\Users\\mariu')
  })

  it('joins HOMEDRIVE and HOMEPATH when neither HOME nor USERPROFILE is set', () => {
    const get = (k: string): string | undefined => {
      if (k === 'HOMEDRIVE') return 'C:'
      if (k === 'HOMEPATH') return '\\Users\\mariu'
      return undefined
    }
    expect(homeOf(get)).toBe('C:\\Users\\mariu')
  })

  it('returns null when no home environment variables are set', () => {
    const get = (k: string): string | undefined => undefined
    expect(homeOf(get)).toBeNull()
  })

  it('HOME takes precedence over USERPROFILE', () => {
    const get = (k: string): string | undefined => {
      if (k === 'HOME') return '/home/user'
      if (k === 'USERPROFILE') return 'C:\\Users\\mariu'
      return undefined
    }
    expect(homeOf(get)).toBe('/home/user')
  })

  it('USERPROFILE takes precedence over HOMEDRIVE+HOMEPATH', () => {
    const get = (k: string): string | undefined => {
      if (k === 'USERPROFILE') return 'C:\\Users\\mariu'
      if (k === 'HOMEDRIVE') return 'D:'
      if (k === 'HOMEPATH') return '\\Users\\other'
      return undefined
    }
    expect(homeOf(get)).toBe('C:\\Users\\mariu')
  })

  it('ignores empty HOMEDRIVE or HOMEPATH', () => {
    const get = (k: string): string | undefined => {
      if (k === 'HOMEDRIVE') return ''
      if (k === 'HOMEPATH') return '\\Users\\mariu'
      return undefined
    }
    expect(homeOf(get)).toBeNull()
  })

  it('ignores empty USERPROFILE', () => {
    const get = (k: string): string | undefined => {
      if (k === 'USERPROFILE') return ''
      if (k === 'HOMEDRIVE') return 'C:'
      if (k === 'HOMEPATH') return '\\Users\\mariu'
      return undefined
    }
    expect(homeOf(get)).toBe('C:\\Users\\mariu')
  })

  it('ignores empty HOME', () => {
    const get = (k: string): string | undefined => {
      if (k === 'HOME') return ''
      if (k === 'USERPROFILE') return 'C:\\Users\\mariu'
      return undefined
    }
    expect(homeOf(get)).toBe('C:\\Users\\mariu')
  })
})
