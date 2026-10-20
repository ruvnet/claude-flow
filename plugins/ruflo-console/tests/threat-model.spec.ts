/**
 * ADR-450, the mod system's threat model: the attempts that were run against the console, kept as regressions.
 *   npx vitest run plugins/ruflo-console/tests/threat-model.spec.ts
 * Every case here failed (or measured a gap) before the matching fix; the ones that held are kept so they keep holding.
 */
import { describe, expect, it } from 'vitest'

import type { ReaderFs } from '../hooks/data/files'
import { parseAgentdbMod } from '../hooks/data/agentdb-mod'
import { parseModStatus, readMods } from '../hooks/data/mods'
import { plain } from '../hooks/data/parse'
import { roomFeed } from '../hooks/data/room'
import { allows, classOf, type ActionClass } from '../hooks/model-tools'
import { paletteEntries } from '../hooks/palette'
import { newState } from '../hooks/state'

const make = (label: string, note?: string, args: string[] = []) => ({ label, args, expect: '', ...(note !== undefined && { note }) })
const RANK: Record<ActionClass, number> = { read: 0, write: 1, network: 2, install: 3, spend: 3, delete: 3 }

describe('T1 classOf: words that name what an action does', () => {
  const corpus: [ActionClass, string, string?][] = [
    ['delete', 'erase the memory namespace'], ['delete', 'unlink the lock files'], ['delete', 'truncate the log'], ['delete', 'revoke the claim'],
    ['delete', 'discard the session'], ['delete', 'flush the store'], ['delete', 'evict entries'], ['delete', 'unregister the agent'], ['delete', 'nuke the swarm'],
    ['delete', 'abort the run'], ['delete', 'deleting old sessions'], ['delete', 'removal of the key'], ['delete', 'deletes the file'], ['delete', 'rm -rf the cache'],
    ['delete', 'run the command in a ruflo terminal', 'RUNS A SHELL COMMAND in this project, as you'], ['delete', 'evolve', 'runs your tests in a sandbox'],
    ['network', 'send a message to the peer'], ['network', 'curl the endpoint'], ['network', 'sync with the relay'], ['network', 'broadcast to the hive'],
    ['network', 'edge status', 'reaches the edge-net genesis node'], ['network', 'open https://example.test'], ['network', 'invite a peer'], ['network', 'post to slack'],
    ['spend', 'workers dispatch', 'MAY COST MONEY: the worker may call models'], ['spend', 'list sessions', 'calls the Anthropic API with your key'],
    ['spend', 'ask openrouter'], ['spend', 'judge', 'uses a real model judge'],
  ]

  it('puts every case at or above the class it needs (measured: 52 of 60 earlier probes were under-classified)', () => {
    const under = corpus.filter(([want, label, note]) => RANK[classOf(make(label, note))] < RANK[want])

    expect(under).toEqual([])
  })

  it('a note that says what an action does NOT do still does not count', () => {
    expect(classOf(make('create the mission', 'spends nothing; no model turn; not billed'))).toBe('write')
    expect(classOf(make('save', 'does not delete anything'))).toBe('delete') // fails safe: the negation is not trusted for delete words
  })

  it('typed text cannot cancel a note: a payload ending in "not" or "no" in front of the note\'s "model turn"', () => {
    for (const text of ['do the thing but not', 'please, without', 'refactor, no', 'x spends no']) {
      expect(classOf(make('run', 'A model turn', ['mission', text])), text).toBe('spend')
    }
  })

  it('typed text cannot shred a note either: a one-letter payload leaves every fixed entry in its class', () => {
    const term = classOf(paletteSpec('dt-term-exec'))

    expect(term).toBe('delete')
    for (const text of ['e', 'a', 'sh', 'ell', 'bill']) {
      expect(classOf({ ...paletteSpec('dt-term-exec'), args: [...paletteSpec('dt-term-exec').args, text] }), text).toBe('delete')
      expect(classOf(make('hand task', 'Starts a Claude Code turn (billed)', ['x', text])), text).toBe('spend')
    }
  })

  it('typed text can only add words: "delete" in a payload over-classifies, which fails safe', () => {
    expect(classOf(make('store note', undefined, ['--value', 'delete everything']))).toBe('delete')
  })

  it('on the real palette: nothing that says it reaches out, costs money or runs a shell is a plain write', () => {
    const state = newState({})
    const bad: string[] = []
    const seen = new Set<string>()

    for (const entry of paletteEntries(state, Date.now())) {
      const spec = entry.run.kind === 'spec' ? entry.run.spec : entry.run.kind === 'text' ? entry.run.make('probe text') : null

      if (spec === null || spec === undefined || spec.isReadOnly === true) continue

      const kind = classOf(spec)
      const note = `${spec.note ?? ''}`.toLowerCase()

      seen.add(entry.id)
      if (/\bcosts? money|may cost|billed cloud|shell command/.test(note) && !allows('full', kind)) bad.push(`${entry.id}:${kind}`)
      if (/shell command/.test(note) && kind !== 'delete') bad.push(`${entry.id}:shell:${kind}`)
      if (/\breaches\b/.test(note) && kind === 'write') bad.push(`${entry.id}:reaches:${kind}`)
      if (/may cost money|may call models|costs money/.test(note) && kind !== 'spend') bad.push(`${entry.id}:money:${kind}`)
    }

    expect(seen.has('dt-term-exec')).toBe(true)
    expect(classOf(paletteSpec('dt-term-exec'))).toBe('delete')
    expect(bad).toEqual([])
  })
})

/** The spec a palette entry builds for `probe text`. */
function paletteSpec(id: string) {
  const entry = paletteEntries(newState({}), Date.now()).find(candidate => candidate.id === id)

  if (entry === undefined) throw new Error(`no entry ${id}`)

  const spec = entry.run.kind === 'spec' ? entry.run.spec : entry.run.kind === 'text' ? entry.run.make('git status') : null

  if (spec === null || spec === undefined) throw new Error(`no spec for ${id}`)

  return spec
}

describe('T4 console_run text and console_set values reach a command', () => {
  it('lands in exactly one argv element for every text entry: no shell, no splitting into flags', () => {
    const state = newState({})
    const payloads = ['--evil-flag value', '$(touch pwn) `id` ; reboot | cat &', '", "x": "y', '-p {"a":1}', 'a\nb\0c']
    let cases = 0

    for (const entry of paletteEntries(state, Date.now())) {
      if (entry.run.kind !== 'text') continue

      for (const payload of payloads) {
        const spec = entry.run.make(payload)

        if (spec === null || spec === undefined) continue

        cases += 1
        const args = [...(spec.argv ?? []), ...spec.args]

        expect(args.some(arg => arg === '--evil-flag' || arg === '$(touch'), `${entry.id} split ${payload}`).toBe(false)
        expect(args.filter(arg => arg.includes('reboot')).length <= 2, `${entry.id} copied ${payload} more than twice`).toBe(true)
      }
    }

    expect(cases).toBeGreaterThan(50)
  })
})

describe('T3 text that reaches the screen', () => {
  const hostile = [
    '\u001b[31mred\u001b[0m', '\u001b]8;;https://evil.test\u0007click\u001b]8;;\u0007', '\u001b]8;;https://evil.test\u001b\\click\u001b]8;;\u001b\\', '\u009d0;title\u0007x',
    'a‮evil‬', 'a⁦b⁩', 'zero​width‍⁠﻿', 'soft­hyphen', 'tag\u{e0041}\u{e0042}chars', 'vs︀︁', 'a\u0000b\u0007c\u001bd', '\u009b31mx', 'line sep ',
  ]
  // eslint-disable-next-line no-control-regex
  const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤⁦-⁩﻿]|[\u{e0000}-\u{e0fff}]/u

  it('plain() leaves no escape, control, bidi, hidden or tag character, and no OSC payload', () => {
    for (const text of hostile) {
      const out = plain(text, 200)

      expect(FORBIDDEN.test(out), JSON.stringify(text)).toBe(false)
      expect(out, JSON.stringify(text)).not.toMatch(/\]8;;|0;title|\[31m|\[0m/)
    }

    expect(plain('a'.repeat(100_000), 40).length).toBe(40)
    expect(plain('\u001b]8;;'.repeat(50_000), 40).length).toBeLessThanOrEqual(40)
  })

  it('plain() on a megabyte of hostile text finishes quickly (no catastrophic pattern)', () => {
    const started = Date.now()

    plain(hostile.join('').repeat(40_000), 200)
    plain('\u001b]' + 'x'.repeat(1_000_000), 200)
    plain('\u001b[' + ';'.repeat(1_000_000), 200)
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('the Room feed draws events, Claude calls and what was said through it', () => {
    const [text] = hostile
    const feed = roomFeed({
      events: [{ atMs: 1, kind: 'claims', text: `${hostile[1]} ${'x'.repeat(5_000)}` }],
      log: [{ atMs: 2, tool: 'console_run', summary: hostile[0] ?? '', outcome: 'ok', detail: hostile[4] ?? '' }],
      said: [{ atMs: 3, id: 'room-say-task' as never, text: text ?? '', label: hostile[2] ?? null }],
      pending: null,
      outcome: null,
      source: 'all',
      query: '',
      untilMs: null,
    })

    expect(feed.length).toBeGreaterThanOrEqual(3)

    for (const item of feed) {
      expect(FORBIDDEN.test(`${item.who}${item.text}`), item.id).toBe(false)
      expect(item.text.length).toBeLessThanOrEqual(240)
    }
  })

  it('what the agentdb mod wrote (a snippet, a source, a tool) is cleaned when it is read', () => {
    const file = JSON.stringify({ version: 1, recall: true, guard: true, source: `${hostile[1]}src`, lastTool: hostile[0], recent: [{ source: hostile[4], score: 1e999, snippet: `${hostile[1]} ${hostile[3]} ${hostile[8]}` }] })
    const mod = parseAgentdbMod(file)

    expect(mod).not.toBeNull()

    const shown = JSON.stringify([mod?.source, mod?.tool, ...(mod?.recent ?? []).flatMap(item => [item.source, item.snippet])])

    expect(FORBIDDEN.test(JSON.parse(shown).join(''))).toBe(false)
    expect(shown).not.toMatch(/\]8;;|0;title|\[31m/)
    expect(mod?.recent[0]?.score).toBeNull()
  })
})

describe('T2 a hostile .claude-flow/*-mod/status.json', () => {
  const polluted = [
    '{"version":1,"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},"calls":3}',
    '{"__proto__":{"version":1},"calls":3}',
    '{"version":1,"calls":1e999,"blocked":-5,"updatedMs":"9","startedMs":[1],"guard":"yes"}',
    '{"version":"1","calls":3}', '{"version":1.0000001,"calls":3}', '[]', '1', 'null', '"x"', '{"version":1,"calls":{"__proto__":1}}',
    `{"version":1,"calls":${'9'.repeat(400)},"blocked":${'9'.repeat(400)}}`,
    '{"a":'.repeat(3_000) + '1' + '}'.repeat(3_000),
    '[' .repeat(3_000) + ']'.repeat(3_000),
    '{"version":1,"name":"\u001b]8;;https://evil.test\u0007x","calls":2}',
  ]

  it('never throws, never pollutes Object.prototype, and only a version-1 object yields a row of plain numbers', () => {
    for (const text of polluted) {
      const row = parseModStatus('evil-mod', text)

      expect(({} as Record<string, unknown>).polluted, text.slice(0, 40)).toBeUndefined()
      expect((Object.prototype as Record<string, unknown>).version).toBeUndefined()

      if (row !== null) {
        expect(row.name).toBe('evil')
        for (const value of [row.calls, row.updatedMs, row.startedMs]) expect(value === null || (Number.isFinite(value) && value >= 0)).toBe(true)
        expect(Number.isFinite(row.blocked) && row.blocked >= 0).toBe(true)
      }
    }
  })

  it('the folder scan refuses odd names, caps files and bytes, and one bad file hides no other', async () => {
    const files: Record<string, string> = {
      'good-mod': '{"version":1,"calls":4,"blocked":1,"guard":true,"updatedMs":5}',
      'big-mod': `{"version":1,"pad":"${'x'.repeat(9_000)}"}`,
      'bad-mod': '{not json',
    }
    const names = [...Object.keys(files), '../escape-mod', 'UPPER-mod', 'a b-mod', '-lead-mod', `${'long'.repeat(20)}-mod`, 'plain-dir', '__proto__-mod']
    const reads: string[] = []
    const fs: ReaderFs = {
      list: async () => names.map(name => ({ name, kind: 'directory' })),
      stat: async path => {
        const text = files[path.split('/').at(-2) ?? '']

        if (text === undefined) throw new Error('ENOENT')

        return { mtimeMs: 1, size: text.length }
      },
      read: async path => {
        reads.push(path)

        return files[path.split('/').at(-2) ?? ''] ?? ''
      },
    }
    const facts = await readMods(fs, new Map(), '/proj')

    expect(facts.rows.map(row => row.name)).toEqual(['good'])
    expect(facts.refused).toBe(2)
    expect(reads.every(path => /^\/proj\/\.claude-flow\/(good|big|bad)-mod\/status\.json$/.test(path)), reads.join()).toBe(true)
  })
})
