/**
 * Issue #3899: at 80 columns (tmux, cmux) the Approvals pane and a mission's objective were cut at the edge with "…", so part of the text a
 * person has to read was gone. Prose now wraps on word breaks (views/common.ts paragraph); a word longer than the row is cut into row-sized
 * pieces; nothing is clipped. The page still has its title and body at every width down to 40 columns.
 */
import { describe, expect, it } from 'vitest'

import { parseMissions } from '../hooks/data/missions'
import { mcOf } from '../hooks/mission-control'
import { newState } from '../hooks/state'
import { viewText } from '../hooks/views/pane'

const act = (() => {
  const proxy: unknown = new Proxy(() => undefined, { get: (_t, key) => (key === 'then' ? undefined : proxy), apply: () => undefined })

  return proxy
})() as never

describe('the Approvals pane at narrow widths (#3899)', () => {
  for (const columns of [80, 60, 44, 40]) {
    it(`${columns} columns: the title and the whole empty-state sentence, nothing cut`, () => {
      const state = newState({})

      state.view = 'approvals'
      const screen = viewText({ state, nowMs: Date.now(), columns, act }, 'approvals')
      const lines = screen.split('\n')

      expect(lines[0]).toMatch(/^Approvals /)
      expect(lines.length).toBeGreaterThan(2)
      expect(screen).not.toContain('…')
      expect(screen.replace(/\s+/g, ' ')).toContain('No hive-mind proposals, stealable claims, refused mods, permission denies or budget alerts waiting.')
      expect(screen.replace(/\s+/g, ' ')).toContain('each action asks y/n before it runs; a permission deny is shown, never loosened from here')
      expect(Math.max(...lines.map(line => line.length))).toBeLessThanOrEqual(columns)
    })
  }

  it('a refused mod and a permission deny keep all of their text on 80 columns', () => {
    const state = newState({})
    const provenance = 'github.com/example-org/a-rather-long-mod-name@0123456789abcdef0123456789abcdef01234567'

    state.view = 'approvals'
    state.mods = [{ name: 'long-mod', isLoaded: false, provenance, reason: 'its signature is not from a trusted publisher' }] as never
    state.denied = [{ atMs: 1, tool: 'mcp__ruflo__terminal_execute', reason: 'the policy forbids running shell commands from a model turn' }] as never
    const screen = viewText({ state, nowMs: Date.now(), columns: 80, act }, 'approvals')
    const flat = screen.replace(/\s+/g, ' ')

    expect(screen).not.toContain('…')
    expect(Math.max(...screen.split('\n').map(line => line.length))).toBeLessThanOrEqual(80)
    expect(flat).toContain('its signature is not from a trusted publisher — to allow it, add')
    expect(flat).toContain('(/config ruflo-mods)')
    expect(screen.replace(/\s/g, '')).toContain(provenance)
    expect(flat).toContain('the policy forbids running shell commands from a model turn — a deny is never loosened from here; change the policy if it is wrong')
  })

  it('a mission objective longer than the row wraps instead of being cut', () => {
    const objective = 'Add a dark mode toggle to the settings page, persist the choice per user, and cover it with a component test and an end-to-end test'
    const state = newState({})

    state.view = 'missions'
    state.snapshot = { plugins: { installed: [] }, missions: parseMissions(JSON.stringify({ schemaVersion: 1, contract: 'ruflo.mission-observation/1', observedAt: '2026-10-02T03:29:44.705Z', missions: [{ missionId: 'msn_wrap', objective, state: 'running', revision: 1, plan: { revision: 1, taskCount: 0, tasks: [] }, evidence: { count: 0, verified: 0 } }] })) } as never
    mcOf(state).tab = 'record'
    const screen = viewText({ state, nowMs: Date.now(), columns: 80, act }, 'missions')

    expect(screen.replace(/\s+/g, ' ')).toContain(objective)
  })
})
