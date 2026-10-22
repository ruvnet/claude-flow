/**
 * The security sentries: loop presets the Security page offers. They must fit the loop's length limit (a longer task is cut, and the cut
 * would take the guard at its end), the watch ones must read only, the fix one must stay in its own branch and never push, and every
 * command in them must be one the registries really run, so a sentry cannot loop on a verb the CLI does not have. Run with
 *   npx vitest run plugins/ruflo-console/tests/sentries.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { INTERVALS, loopInput, MAX_TASK, PRESETS } from '../hooks/loops'
import { SECURE } from '../hooks/secure'

const sentries = PRESETS.filter(preset => preset.sentry !== undefined)
const watch = sentries.filter(preset => preset.sentry === 'watch')
const fix = sentries.filter(preset => preset.sentry === 'fix')
const commandsIn = (task: string): string[] => [...task.matchAll(/`npx ruflo ([^`]+)`/g)].map(match => match[1] as string)
const registered = new Set(SECURE.map(entry => entry.args.join(' ')))

describe('security sentries', () => {
  it('offers several that find and report, and one that also fixes', () => {
    expect(watch.length).toBeGreaterThanOrEqual(5)
    expect(fix.map(preset => preset.id)).toEqual(['sentry-fix'])
  })

  it('covers real time and several schedules, each a valid loop interval', () => {
    for (const preset of sentries) expect((INTERVALS as readonly string[]).includes(preset.interval), preset.id).toBe(true)

    expect(sentries.some(preset => preset.interval === 'self-paced')).toBe(true)
    expect(new Set(sentries.map(preset => preset.interval)).size).toBeGreaterThanOrEqual(4)
  })

  it('fits the task limit whole, so the guard is never cut, and builds a /loop with the whole task', () => {
    for (const preset of sentries) {
      expect(preset.task.length, preset.id).toBeLessThanOrEqual(MAX_TASK)

      const built = loopInput({ tier: preset.tier, preset: preset.id, interval: preset.interval, task: preset.task, stop: '' }, [])

      expect(built, preset.id).toMatchObject({ ok: true })
      expect((built as { text: string }).text, preset.id).toContain(preset.task)
    }
  })

  it('has the guard first: a watch sentry reads only and edits nothing, the fix sentry never pushes or edits the checkout', () => {
    for (const preset of watch) {
      expect(preset.task.startsWith('Read-only.'), preset.id).toBe(true)
      expect(/Edit nothing\.$|open no pull request\.$/.test(preset.task), preset.id).toBe(true)
      expect(preset.cost, preset.id).toContain('edits nothing')
    }

    const [only] = fix

    expect(only?.task.startsWith('Never push or merge, never edit this checkout.')).toBe(true)
    expect(only?.task).toContain('git worktree')
    expect(only?.task).toContain('sentry/')
    expect(only?.cost).toContain('never pushes')
    expect(only?.cost).toContain('not a sandbox')
  })

  it('names only commands the registries run, with their own flags, so a sentry cannot loop on a verb the CLI lacks', () => {
    for (const preset of sentries) {
      const commands = commandsIn(preset.task)

      expect(commands.length, preset.id).toBeGreaterThan(0)

      for (const command of commands) expect(registered.has(command) || [...registered].some(args => args === command), `${preset.id}: ${command}`).toBe(true)
    }
  })

  it('never asks to print a secret value', () => {
    const secrets = PRESETS.find(preset => preset.id === 'sentry-secrets')

    expect(secrets?.task).toContain('never print a value')
  })
})
