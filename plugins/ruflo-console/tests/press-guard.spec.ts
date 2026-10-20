/**
 * A press that outlives its drawing (ADR-469): the engine finds no handler under the handle and the `ui.press` hook answers it quietly;
 * every other failure still propagates, and the page's own handlers never throw into the engine. Run with
 *   npx vitest run plugins/ruflo-console/tests/press-guard.spec.ts --testTimeout=30000
 */
import { describe, expect, it } from 'vitest'

import { tolerantPress } from '../hooks/press-guard'
import { buttonWidth, flow, safe } from '../hooks/views/wf-layout'
import { kit } from './fixtures/wf-drill-world'
import type { Ctx } from '../hooks/views/common'
import { newState } from '../hooks/state'

describe('tolerantPress', () => {
  it('passes the answer through', async () => {
    await expect(tolerantPress(() => ({ element: 'a' }), { element: 'fallback' })).resolves.toEqual({ element: 'a' })
    await expect(tolerantPress(async () => ({ element: 'b' }), { element: 'fallback' })).resolves.toEqual({ element: 'b' })
  })

  it('answers a stale handle with the fallback, sync or async, and no throw', async () => {
    const stale = (): never => {
      throw new Error('ui.press: no handler is held under handle 41')
    }

    await expect(tolerantPress(stale, { element: 'wf-next' })).resolves.toEqual({ element: 'wf-next' })
    await expect(tolerantPress(async () => stale(), { element: 'wf-next' })).resolves.toEqual({ element: 'wf-next' })
    await expect(tolerantPress(() => Promise.reject('no handler is held under handle 3'), { element: 'x' })).resolves.toEqual({ element: 'x' })
  })

  it('lets any other failure through', async () => {
    await expect(tolerantPress(() => { throw new Error('disk full') }, { element: 'x' })).rejects.toThrow('disk full')
    await expect(tolerantPress(() => Promise.reject(new Error('boom')), { element: 'x' })).rejects.toThrow('boom')
  })
})

describe('a page handler never throws into the engine', () => {
  const ctx = { kit, state: newState({}), nowMs: 0, columns: 40, pictures: new Map(), act: {} } as unknown as Ctx

  it('safe swallows a throwing closure, and a flowed button is safe', () => {
    expect(() => safe(() => { throw new Error('stale') })()).not.toThrow()

    const rows = flow(ctx, [{ key: 'k', label: 'go', onPress: () => { throw new Error('orphaned') } }], 'r')
    const button = (rows[0] as unknown as { props: { children: { props: { onPress: () => void } }[] } }).props.children[0]

    expect(() => button?.props.onPress()).not.toThrow()
    expect(buttonWidth('go')).toBe(6)
  })
})
