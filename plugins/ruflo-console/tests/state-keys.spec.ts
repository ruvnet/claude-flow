import { describe, expect, it } from 'vitest'

import { storeKeyOf, termStoreKeyOf } from '../hooks/state'

describe('workspace store keys', () => {
  it('a Windows folder gives one key whatever its drive-letter case, separator style or trailing separator', () => {
    const spellings = ['c:\\users\\mariu\\', 'C:\\Users\\mariu', 'C:/Users/mariu/', 'c:/USERS/Mariu//']

    for (const key of [storeKeyOf, termStoreKeyOf]) expect(new Set(spellings.map(key)).size, key.name).toBe(1)
    expect(storeKeyOf('C:\\Users\\mariu')).toBe('ruflo-console/ui:c:/users/mariu')
    expect(termStoreKeyOf('c:\\users\\mariu\\')).toBe('ruflo-console/term:c:/users/mariu')
  })

  it('a share path is folded the same way, and two different folders keep two keys', () => {
    expect(storeKeyOf('\\\\SRV\\Share\\a\\')).toBe(storeKeyOf('\\\\srv\\share\\a'))
    expect(storeKeyOf('C:\\a')).not.toBe(storeKeyOf('D:\\a'))
    expect(storeKeyOf('C:\\a')).not.toBe(storeKeyOf('C:\\ab'))
  })

  it('a POSIX folder keeps today\'s exact key (case and trailing slash are significant there)', () => {
    expect(storeKeyOf('/work')).toBe('ruflo-console/ui:/work')
    expect(storeKeyOf('/Work/Proj/')).toBe('ruflo-console/ui:/Work/Proj/')
    expect(termStoreKeyOf('/work')).toBe('ruflo-console/term:/work')
    expect(termStoreKeyOf('/Work/Proj/')).toBe('ruflo-console/term:/Work/Proj/')
  })
})
