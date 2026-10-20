/**
 * ADR-470: the envelope list editor, and what the live run found (hotkeys, the permission probe, restart, stop).
 * Pure and in-memory (the ap-rig disk and fake host). Run with
 *   npx vitest run plugins/ruflo-console/tests/ap-complete.spec.ts --testTimeout=30000
 */

import { describe, expect, it } from 'vitest'
import { apTick, storeOf, wireAutopilot } from '../hooks/ap-live'
import { addEntry, diffRows, entryOf, removeEntry } from '../hooks/data/ap-edit'
import { hashOf, narrowed, validateEnvelope, widened, type Envelope } from '../hooks/data/ap-envelope'
import { VIEWS } from '../hooks/state'
import { slotsFor } from '../hooks/views/wf-slots'
import { draftOf, defaultDraft, spanText } from '../hooks/views/ap-draft'
import { preflightAll, preflightInput } from '../hooks/data/ap-guard'
import { applyAdd, applyRemove, editorLists } from '../hooks/views/ap-editor'
import { boardRows } from '../hooks/views/ap-panel'
import '../hooks/views/wf-register'
import { CWD, ENV, J, T0, buttons, ctxOf, envOf, flat, journal, rig, started, stateWith, task, words } from './fixtures/ap-rig'

const base = (): Record<string, unknown> => defaultDraft(CWD)

describe('the envelope list editor: every edit goes through the loader\'s own validator', () => {
  it('accepts a valid entry in each list and the result is still a valid envelope', () => {
    let d = base()

    for (const [key, raw] of [['paths', `${CWD}/src`], ['repos', 'ruvnet/ruflo'], ['network', 'API.GitHub.com'], ['secretEnv', 'GH_TOKEN'], ['verify', 'node --test']] as const) {
      const done = addEntry(d, key, raw)

      expect(done.ok, `${key}: ${done.ok ? '' : done.why}`).toBe(true)
      if (done.ok) d = done.value
    }

    const checked = validateEnvelope(d)

    expect(checked.ok).toBe(true)
    expect(checked.ok && checked.envelope.network).toEqual(['api.github.com'])
    expect(checked.ok && checked.envelope.verify).toEqual([['node', '--test']])
  })

  it('refuses what the sealed file would refuse, with the validator\'s own reason, and changes nothing', () => {
    const d = base()
    const before = JSON.stringify(d)
    const bad: [Parameters<typeof addEntry>[1], string, string][] = [
      ['verify', 'bash -c ls', 'shell'],
      ['verify', 'curl http://x', 'network tool'],
      ['verify', 'npm publish', 'never'],
      ['verify', 'node a;b', 'metacharacter'],
      ['paths', '/', 'absolute folder'],
      ['paths', 'relative/dir', 'absolute folder'],
      ['paths', `${CWD}/../etc`, 'absolute folder'],
      ['paths', '/w/.claude-flow/console/autopilot', 'own folder'],
      ['repos', 'not-a-repo', 'owner/name'],
      ['network', 'https://x.com', 'hostname'],
      ['network', '*.evil.com', 'hostname'],
      ['secretEnv', 'lowercase', 'variable name'],
      ['secretEnv', 'GH_TOKEN=abc', 'variable name'],
    ]

    for (const [key, raw, because] of bad) {
      const done = addEntry(d, key, raw)

      expect(done.ok, `${key} ${raw}`).toBe(false)
      expect(!done.ok && done.why.toLowerCase(), `${key} ${raw}`).toContain(because)
    }

    expect(JSON.stringify(d)).toBe(before)
  })

  it('reads a verify command as a program and its arguments, with no quoting to misread', () => {
    expect(entryOf('verify', '  node   --test  tests/a.js ')).toEqual({ value: ['node', '--test', 'tests/a.js'] })
    expect('why' in entryOf('verify', 'node -e "x y"')).toBe(true)
    expect('why' in entryOf('verify', '   ')).toBe(true)
    expect('why' in entryOf('paths', 'x'.repeat(301))).toBe(true)
  })

  it('refuses a duplicate, caps the verify list at six, and never removes the last folder', () => {
    let d = base()

    expect(addEntry(d, 'paths', CWD).ok).toBe(false)

    for (let i = 0; i < 6; i++) {
      const done = addEntry(d, 'verify', `node --test t${i}.js`)

      expect(done.ok).toBe(true)
      if (done.ok) d = done.value
    }

    expect(addEntry(d, 'verify', 'node --test t7.js').ok).toBe(false)

    const last = removeEntry(d, 'paths', 0)

    expect(last.ok).toBe(false)
    expect(!last.ok && last.why).toContain('at least one')
    expect(removeEntry(d, 'verify', 99).ok).toBe(false)
    expect(removeEntry(d, 'verify', 0).ok).toBe(true)
  })

  it('shows the draft as a diff against the approved envelope, and the widening is what Start will warn about', () => {
    const approved = ENV
    const draft = { ...JSON.parse(JSON.stringify(ENV)) } as Record<string, unknown>
    const grown = addEntry(draft, 'network', 'api.github.com')
    const shrunk = removeEntry(JSON.parse(JSON.stringify(ENV)) as Record<string, unknown>, 'verify', 0)

    expect(diffRows(approved, draft)).toEqual(['same as the approved envelope'])
    expect(grown.ok && diffRows(approved, grown.value)).toEqual(['+ network: adds api.github.com'])
    expect(shrunk.ok && diffRows(approved, shrunk.value)).toEqual(['- verify commands: removes true'])
    expect(diffRows(null, draft)[0]).toContain('first approval')
    expect(diffRows(approved, { ...draft, spend: {} })[0]).toContain('not valid')

    const a = ENV
    const b: Envelope = { ...ENV, network: ['x.com'], concurrency: 4 }

    expect(widened(a, b)).toEqual(expect.arrayContaining(['network: adds x.com', 'concurrency: 1 to 4']))
    expect(narrowed(b, a)).toEqual(expect.arrayContaining(['network: removes x.com', 'concurrency: 4 to 1']))
    expect(narrowed(a, a)).toEqual([])
  })

  it('draws a row and a remove button per entry, an add field per list, and the refusal; the panel puts it on the board', () => {
    const state = stateWith([])

    wireAutopilot(state, rig().host)

    const d = draftOf(state)

    expect(applyAdd(d, 'verify', 'node --test')).toBe(true)
    expect(applyAdd(d, 'verify', 'sh -c x')).toBe(false)
    expect(d.refused).toContain('verify commands')
    expect(applyAdd(d, 'repos', 'ruvnet/ruflo')).toBe(true)
    expect(d.refused).toBeNull()

    const ctx = { ...ctxOf(state, T0), kit: { ...ctxOf(state, T0).kit, Input: (props: Record<string, unknown>) => ({ kind: 'Input', props }) } }
    const tree = editorLists(ctx as never, d, null)
    const inputs = flat(tree).filter(el => el.kind === 'Input').map(el => el.props.key)

    expect(inputs).toEqual(['ap-add-paths', 'ap-add-repos', 'ap-add-network', 'ap-add-secretEnv', 'ap-add-verify'])
    expect(buttons(tree)).toEqual(expect.arrayContaining(['remove', 'remove'].map(label => ` ${label} `)))
    expect(words(tree)).toContain('Start will run, after each step, through this console: node --test')
    expect(words(tree)).toContain('first approval')
    expect(words(boardRows(envOf(state, T0)))).toContain('lists (every edit is checked')

    expect(applyRemove(d, 'verify', 0)).toBe(true)
    expect(words(editorLists(ctx as never, d, null))).toContain('no verify command')
  })

  it('the draft Start offers is the edited one: its card lists the new verify argv and what it widens', async () => {
    const { startSpec } = await import('../hooks/views/ap-panel')
    const r = rig()
    const state = stateWith([])

    started(r)
    wireAutopilot(state, r.host)
    await (await import('../hooks/ap-live')).refreshAutopilot(state, r.host, T0)
    draftOf(state).value = JSON.parse(JSON.stringify(ENV)) as Record<string, unknown>
    applyAdd(draftOf(state), 'network', 'api.github.com')
    applyAdd(draftOf(state), 'verify', 'node --test tests/a.test.js')

    const spec = startSpec(envOf(state, T0))

    expect(spec?.shows).toContain('node --test tests/a.test.js')
    expect(spec?.shows).toContain('network api.github.com')
    expect(spec?.shows).toContain('WIDENS: network: adds api.github.com')
    expect(hashOf(validateEnvelope(draftOf(state).value).ok ? (validateEnvelope(draftOf(state).value) as { ok: true; envelope: Envelope }).envelope : ENV)).not.toBe(hashOf(ENV))
  })
})

describe('live findings (ADR-470 §4)', () => {
  it('no autopilot slot takes a hotkey that is a view key: such a key opens that page instead (8 opened MetaHarness, 9 Memory, so Stop never ran)', () => {
    const viewKeys = new Set(VIEWS.map(view => view.key).filter(key => key !== ''))
    const mine = [...slotsFor('key'), ...slotsFor('action')].filter(slot => slot.id.startsWith('ap-'))

    for (const slot of mine) {
      const key = slot.kind === 'key' ? slot.key : slot.kind === 'action' ? slot.hotkey : undefined

      expect(key === undefined || !viewKeys.has(key), `${slot.id} uses view key ${key}`).toBe(true)
    }

    // The Stop button is on the board, with no key; the command still stops.
    expect(slotsFor('action').some(slot => slot.id === 'ap-start')).toBe(true)
  })

  it('before the first preflight pass the panel does not claim your settings allow every class', () => {
    const state = stateWith([])

    wireAutopilot(state, rig().host, { toolCheck: async () => ({ decision: 'allow' }) })

    const text = words(boardRows(envOf(state, T0)))

    expect(text).not.toContain('allow every class')
    expect(text).toContain('not checked yet')
  })

  it('Start is a button on the autopilot board itself: the page draws its action row only when a workflow run is selected, so a project with none could not start', () => {
    const state = stateWith([])
    const asked: { spec: { label: string } | null; why?: string }[] = []

    wireAutopilot(state, rig().host)

    const env = envOf(state, T0)

    ;(env.ctx.act as unknown as { workflows: unknown }).workflows = { ask: (spec: { label: string } | null, why?: string) => asked.push({ spec, why }) }

    const start = flat(boardRows(env)).find(el => el.kind === 'Button' && el.props.label === 'Start autopilot')

    expect(start).toBeDefined()
    ;(start?.props.onPress as () => void)()
    expect(asked[0]?.spec?.label).toContain('start autopilot "autopilot"')
  })

  it('a step in flight when the console died, whose task the store still shows in progress, is settled as lost and its task parked with a question: never waited out and retried', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'in_progress'), task('r2', 'pending'), task('r3', 'pending')])

    started(r, [{ t: 'step.started', at: T0 + 10, id: 's-midflight00001', task: 't1', cls: 'edit', attempt: 1, deadline: T0 + 30 * 60_000, tier: 'mid' }])
    wireAutopilot(state, r.host)
    storeOf(state).bootMs = T0 + 100
    storeOf(state).spend = { hourUsd: 0, dayUsd: 0, totalUsd: 0 }
    storeOf(state).spendAtMs = T0 + 1000
    await apTick(state, r.host, T0 + 1000)

    expect(journal(r).some(e => e.t === 'step.failed' && e.id === 's-midflight00001' && e.why.includes('lost on restart'))).toBe(true)

    // The task was left in progress by the dead session: it is parked with a question in the same pass, and nothing is handed over for it.
    expect(journal(r).find(e => e.t === 'parked' && e.task === 't1')).toMatchObject({ question: expect.stringContaining('may have run') })
    storeOf(state).spendAtMs = T0 + 2000
    await apTick(state, r.host, T0 + 2000)
    expect(r.prompts.join('\n')).not.toContain('Fix the parser bug')
  })

  it('a step that finishes after a Stop is verified on the next Start, not recorded failed from checks that were skipped while stopped', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'completed'), task('r2', 'pending'), task('r3', 'pending')])

    started(r, [{ t: 'step.started', at: T0 + 10, id: 's-afterstop000001', task: 't1', cls: 'edit', attempt: 1, deadline: T0 + 1e9, tier: 'mid' }, { t: 'stop', at: T0 + 20, reason: 'stopped by you' }])
    wireAutopilot(state, r.host)
    storeOf(state).bootMs = T0 - 1
    storeOf(state).spend = { hourUsd: 0, dayUsd: 0, totalUsd: 0 }
    storeOf(state).spendAtMs = T0 + 1000
    // Two passes while stopped: nothing is verified, run or remembered.
    await apTick(state, r.host, T0 + 1000)
    await apTick(state, r.host, T0 + 2000)
    expect(r.runs.some(a => a[0] === 'true')).toBe(false)
    expect(storeOf(state).verified.size).toBe(0)
    expect(journal(r).some(e => e.t === 'step.failed')).toBe(false)

    // Start again: the step is settled by running the checks, and it passes.
    const { encodeLine: line } = await import('../hooks/data/ap-journal')

    r.files.set(J, (r.files.get(J) as string) + line({ t: 'start', at: T0 + 3000, envHash: hashOf(ENV), revision: 2, anatole: 'on' }))
    storeOf(state).pin = { envHash: hashOf(ENV), starts: 2 }
    state.cache.clear()
    storeOf(state).spendAtMs = T0 + 3500
    await apTick(state, r.host, T0 + 4000)
    expect(r.runs.some(a => a[0] === 'true')).toBe(true)
    expect(journal(r).find(e => e.t === 'step.done')).toMatchObject({ id: 's-afterstop000001', verified: true })
  })

  it('an envelope of one hour reads 1 h, not 0 d', () => {
    expect(spanText(3_600_000)).toBe('1 h')
    expect(spanText(7 * 86_400_000)).toBe('7 d')
    expect(spanText(36 * 3_600_000)).toBe('2 d')
  })

  it('the permission probe is given a call the envelope allows, since the engine decides on the input (an empty probe said ask for everything and parked every task)', async () => {
    const seen: Record<string, unknown> = {}
    const answered = await preflightAll(async (tool, input) => {
      seen[tool + JSON.stringify(input)] = input

      return { decision: JSON.stringify(input) === '{}' ? 'ask' : 'allow' }
    }, { ...ENV, verify: [['node', '--test']], network: ['api.github.com'] })

    expect(answered.read).toBe('allow')
    expect(answered.edit).toBe('allow')
    expect(answered.test).toBe('allow')
    expect(answered.network).toBe('allow')
    expect(Object.values(seen)).toContainEqual({ file_path: `${CWD}/preflight-probe` })
    expect(Object.values(seen)).toContainEqual({ command: 'node --test' })
    expect(preflightInput('read', null)).toEqual({})
    // Spawn and mcp have nothing representative: they are still asked with no input, as before.
    expect(answered.spawn).toBe('ask')
  })

  it('a refused edit says why without repeating the field name', () => {
    const state = stateWith([])

    wireAutopilot(state, rig().host)
    applyAdd(draftOf(state), 'verify', 'sh -c ls')
    expect(draftOf(state).refused?.startsWith('verify commands: "sh"')).toBe(true)
  })
})

