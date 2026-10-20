/**
 * #3920: the approvals badge counted notice rows (a refused mod, a permission deny) that have no approve or deny action,
 * so "1 to approve" stayed up with nothing to press.
 *   npx vitest run plugins/ruflo-console/tests/approvals-badge-3920.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { approvalsOf, waitingApprovalsOf } from '../hooks/data/alerts'
import { badgesOf } from '../hooks/menu-style'
import { factsOf } from '../hooks/notices'
import { newState } from '../hooks/state'
import { barParts } from '../hooks/views/bar'

describe('approvals badge counts only what a person can act on (#3920)', () => {
  const noticesOnly = () => {
    const state = newState({})

    state.denied.push({ tool: 'Bash', reason: 'rm -rf is denied', atMs: 1 })
    state.mods.push({ name: 'x', provenance: 'abc', isLoaded: false, reason: 'unsigned', atMs: 1 })

    return state
  }

  it('lists the notice rows on the page but counts none of them as waiting', () => {
    const state = noticesOnly()

    expect(approvalsOf(state).map(item => item.kind)).toEqual(['mod-trust', 'policy-deny'])
    expect(waitingApprovalsOf(state)).toEqual([])
  })

  it('shows no "to approve" on the band, no menu badge and no notice fact for notices alone', () => {
    const state = noticesOnly()

    expect(barParts(state, 0).some(part => /to approve/.test(part.text))).toBe(false)
    expect(badgesOf(state, 0).approvals).toBeUndefined()
    expect(factsOf(state, 0).approvals).toBe(0)
  })

  it('still counts a row that has an action', () => {
    const state = noticesOnly()

    state.ruflo.snapshot = { budget: { level: 'CRITICAL', usd: 9, limit: 10 } } as never
    expect(waitingApprovalsOf(state).map(item => item.kind)).toEqual(['budget'])
    expect(barParts(state, 0).find(part => /to approve/.test(part.text))?.text).toBe('1 to approve (q)')
  })
})
