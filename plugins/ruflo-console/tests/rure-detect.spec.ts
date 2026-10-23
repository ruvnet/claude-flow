/**
 * ruRE DETECT (ADR-496): which of the six readers a file or folder wants, from what the host can say about it without reading its bytes
 * (a folder or a file, its extension). A binary file read through the host is text, so first-bytes sniffing is not used; the limits are
 * stated in the ADR. DETECT never picks the one reader that writes (UNPACK .ASAR): it says to run that row, which asks first.
 *   npx vitest run --dir plugins/ruflo-console/tests rure-detect
 */
import { describe, expect, it } from 'vitest'

import { detectReader } from '../hooks/data/rure-detect'

const fsOf = (entries: Record<string, { kind?: string; isLink?: boolean } | undefined>) => ({ stat: async (path: string) => entries[path] })
const dir = { kind: 'dir' }
const file = { kind: 'file' }

describe('detectReader', () => {
  it('a folder is a JS / Electron source folder', async () => {
    expect(await detectReader(fsOf({ app: dir }), 'app')).toEqual({ id: 'dt-re-js', tool: 'rure_analyze_js_app', params: { path: 'app' }, why: 'a folder: read as JavaScript / Electron source' })
    expect(await detectReader(fsOf({ app: { kind: 'directory' } }), 'app')).toMatchObject({ id: 'dt-re-js' })
  })

  it('an .asar is never read here: it says to run UNPACK .ASAR, which asks first', async () => {
    const answer = await detectReader(fsOf({ 'a/app.asar': file }), 'a/app.asar')

    expect(answer).toHaveProperty('refuse')
    expect((answer as { refuse: string }).refuse).toMatch(/UNPACK \.ASAR/)
    expect((answer as { refuse: string }).refuse).toMatch(/asks first/)
  })

  it('hex / evm / bytecode files are EVM bytecode', async () => {
    for (const name of ['c/token.hex', 'c/token.evm', 'c/token.bytecode', 'c/TOKEN.HEX']) expect(await detectReader(fsOf({ [name]: file }), name), name).toMatchObject({ id: 'dt-re-evm', tool: 'rure_analyze_evm', params: { path: name } })
  })

  it('a single source file asks for its folder', async () => {
    for (const name of ['s/main.js', 's/x.mjs', 's/y.cjs', 's/z.ts', 's/p.json']) expect(await detectReader(fsOf({ [name]: file }), name), name).toHaveProperty('refuse')
  })

  it('anything else is a native binary, with strings', async () => {
    for (const name of ['bin/tool', 'lib/libx.so', 'lib/x.dylib', 'win/x.exe', 'win/y.dll', 'win/z.winmd', 'data/blob.bin']) expect(await detectReader(fsOf({ [name]: file }), name), name).toMatchObject({ id: 'dt-re-bin', tool: 'rure_analyze_binary', params: { path: name, includeStrings: true } })
  })

  it('a .dll or .exe says it may be a .NET assembly and names the row that tells', async () => {
    expect(await detectReader(fsOf({ 'w/a.dll': file }), 'w/a.dll')).toMatchObject({ why: expect.stringMatching(/may be a \.NET assembly.*run \.NET ASSEMBLY/) })
  })

  it('a path the host cannot describe falls back to its extension, then to a native binary', async () => {
    expect(await detectReader(fsOf({}), 'x/c.hex')).toMatchObject({ id: 'dt-re-evm' })
    expect(await detectReader(fsOf({}), 'x/tool')).toMatchObject({ id: 'dt-re-bin' })
    expect(await detectReader({ stat: async () => Promise.reject(new Error('refused')) }, 'x/tool')).toMatchObject({ id: 'dt-re-bin' })
  })

  it('never chooses a write row, and passes only the sample as the path', async () => {
    for (const name of ['a/app.asar', 'a/x', 'a/c.hex', 'a/m.js']) {
      const answer = await detectReader(fsOf({ [name]: file }), name)

      if ('id' in answer) {
        expect(answer.id).not.toBe('dt-re-asar')
        expect(answer.params.path).toBe(name)
      }
    }
  })
})
