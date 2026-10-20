/**
 * The self-check: every area the boot log names has its page and its commands checked, the real registries pass, and a broken
 * entry fails (a pass that cannot fail would prove nothing). Run with
 *   npx vitest run plugins/ruflo-console/tests/self-check.spec.ts
 */
import { afterEach, describe, expect, it } from 'vitest'

import { setBootChecks } from '../hooks/boot-checks'
import { alertsOf } from '../hooks/data/alerts'
import { BOOT_MODULES } from '../hooks/gfx/boot'
import { AREA_VIEW, REGISTRIES, selfCheck, selfCheckResults, type Registries } from '../hooks/self-check'
import { newState, VIEWS } from '../hooks/state'

const failing = (results: ReturnType<typeof selfCheck>) => results.filter(result => !result.ok)
const area = (results: ReturnType<typeof selfCheck>, name: string) => results.find(result => result.area === name)

describe('self-check: the real console', () => {
  it('passes for every area, and says nothing is wrong', () => {
    expect(failing(selfCheck()).map(result => `${result.area}: ${result.problems.join('; ')}`)).toEqual([])
  })

  it('checks every area the boot log names, in boot order, and names a page for each, so no [ OK ] goes unchecked', () => {
    expect(selfCheck().map(result => result.area)).toEqual(BOOT_MODULES.map(entry => entry.name))
    expect(Object.keys(AREA_VIEW).sort()).toEqual(BOOT_MODULES.map(entry => entry.name).sort())
    for (const view of Object.values(AREA_VIEW)) expect(VIEWS.some(entry => entry.id === view)).toBe(true)
  })

  it('looks at the commands of the four areas that own a registry, not only their pages', () => {
    const results = selfCheck()

    expect(area(results, 'Security')?.checked).toBeGreaterThan(10)
    expect(area(results, 'Performance')?.checked).toBe(REGISTRIES.perf.length + 1)
    expect(area(results, 'Dev Tools')?.checked).toBe(REGISTRIES.dev.length + 1)
    expect(area(results, 'MetaHarness')?.checked).toBe(REGISTRIES.lab.length + 1)
    expect(area(results, 'Missions')?.checked).toBe(1)
  })

  it('is computed once for the boot log', () => {
    expect(selfCheckResults()).toBe(selfCheckResults())
  })
})

describe('self-check: seen in every look, not only on the boot screen', () => {
  afterEach(() => setBootChecks(undefined))

  it('a failed area is an Overview alert, even before any project is read, so the plain look and a boot-off BBS look see it', () => {
    const state = newState({})

    expect(state.snapshot).toBeNull()

    setBootChecks([{ area: 'Missions', ok: true, problems: [] }, { area: 'Security', ok: false, problems: ['aid-check: an empty field must be refused'] }])

    const alert = alertsOf(state, 0, 0).find(entry => entry.id === 'self-check')

    expect(alert?.level).toBe('bad')
    expect(alert?.text).toContain('Security failed')
    expect(alert?.text).toContain('aid-check: an empty field must be refused')
    expect(alert?.text).not.toContain('Missions')
  })

  it('is no alert when every area passed, or when nothing has run the check', () => {
    const state = newState({})

    setBootChecks(selfCheck().map(result => ({ area: result.area, ok: result.ok, problems: result.problems })))
    expect(alertsOf(state, 0, 0).some(entry => entry.id === 'self-check')).toBe(false)
    setBootChecks(undefined)
    expect(alertsOf(state, 0, 0).some(entry => entry.id === 'self-check')).toBe(false)
  })
})

describe('self-check: it fails on what is broken', () => {
  const broken = (change: (registries: Registries) => Registries) => selfCheck(change(REGISTRIES))

  it('a text verb that builds a command from an empty field', () => {
    const results = broken(r => ({ ...r, secureText: [{ ...r.secureText[0], id: 'aid-bad', argv: () => ['security', 'defend'] } as never, ...r.secureText.slice(1)] }))

    expect(area(results, 'Security')?.problems.join(' ')).toContain('aid-bad: an empty field must be refused')
  })

  it('a text verb that lets text starting with - through, where it could be read as a flag', () => {
    const results = broken(r => ({ ...r, secureText: [{ ...r.secureText[0], id: 'aid-flag', argv: (text: string) => ['security', text] } as never, ...r.secureText.slice(1)] }))

    expect(area(results, 'Security')?.problems.join(' ')).toContain('aid-flag: text starting with - must be refused')
  })

  it('a text verb that refuses every input, so its button could never run', () => {
    const results = broken(r => ({ ...r, secureText: [{ ...r.secureText[0], id: 'aid-never', argv: () => null } as never, ...r.secureText.slice(1)] }))

    expect(area(results, 'Security')?.problems.join(' ')).toContain('aid-never: no sample input')
  })

  it('a command with an empty part, and one with no reader', () => {
    const results = broken(r => ({ ...r, perf: [{ ...r.perf[0], id: 'perf-empty', args: ['performance', ''] } as never, { ...r.perf[1], id: 'perf-noread', read: undefined as never } as never, ...r.perf.slice(2)] }))
    const problems = area(results, 'Performance')?.problems.join(' ') ?? ''

    expect(problems).toContain('perf-empty: its command is empty or has an empty')
    expect(problems).toContain('perf-noread: nothing reads its output')
  })

  it('a Dev Tools row that no input can run, one with no input field that cannot run empty, and an n/a with no reason', () => {
    const dev = REGISTRIES.dev.find(entry => entry.args !== undefined) as (typeof REGISTRIES.dev)[number]
    const results = broken(r => ({
      ...r,
      dev: [{ ...dev, id: 'dt-never', args: () => null } as never, { ...dev, id: 'dt-silent', input: undefined, args: (fields: Record<string, string>) => (fields.task === '' ? null : ['git', 'status']) } as never, { ...dev, id: 'dt-na', na: ' ', args: undefined } as never, ...r.dev],
    }))
    const problems = area(results, 'Dev Tools')?.problems.join(' ') ?? ''

    expect(problems).toContain('dt-never: no input is accepted')
    expect(problems).toContain('dt-silent: it names no input field, yet cannot run on an empty page')
    expect(problems).toContain('dt-na: marked n/a with no reason')
  })

  it('a lab verb that cannot run and gives no reason, and one with nothing to run or type', () => {
    const lab = REGISTRIES.lab[0]
    const results = broken(r => ({ ...r, lab: [{ ...lab, id: 'mh-mute', args: () => null, why: undefined } as never, { ...lab, id: 'mh-empty', args: undefined, types: undefined } as never, ...r.lab] }))
    const problems = area(results, 'MetaHarness')?.problems.join(' ') ?? ''

    expect(problems).toContain('mh-mute: it cannot run now and says nothing about why')
    expect(problems).toContain('mh-empty: no command and no command to type')
  })

  it('two entries sharing an id (a palette keyword), which fails each registry-owning area', () => {
    const results = broken(r => ({ ...r, perf: [{ ...r.perf[0], id: r.secure[0]?.id } as never, ...r.perf.slice(1)] }))

    expect(area(results, 'Security')?.problems.join(' ')).toContain(`${REGISTRIES.secure[0]?.id}: used by two entries`)
    expect(area(results, 'Performance')?.ok).toBe(false)
    expect(area(results, 'Missions')?.ok).toBe(true)
  })

  it('a page that is missing, has no key, or has no Ask row', () => {
    const noPage = selfCheck(REGISTRIES, VIEWS.filter(view => view.id !== 'missions'))
    const noKey = selfCheck(REGISTRIES, VIEWS.map(view => (view.id === 'swarm' ? { ...view, key: '' } : view)))
    const noAsk = selfCheck(REGISTRIES, VIEWS, {})

    expect(area(noPage, 'Missions')?.problems.join(' ')).toContain('its page "missions" does not exist')
    expect(area(noKey, 'Swarm')?.problems.join(' ')).toContain('its page has no key')
    expect(failing(noAsk)).toHaveLength(BOOT_MODULES.length)
  })
})
