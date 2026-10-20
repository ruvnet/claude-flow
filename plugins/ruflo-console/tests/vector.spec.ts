/**
 * The Vector Lab's pure parts under vitest: what each typed value must look like, the fixed ruvector argv each entry
 * builds, what asks first and says why, the readers, and that no key material ever reaches a line. Nothing here runs
 * the ruvector CLI. Run with
 *   npx vitest run plugins/ruflo-console/tests/vector.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { dimensionOf, generatedLines, isKeyless, redact, relPathOf, RV, shareOf, targetOf, textOf, vecIdOf, vectorOf } from '../hooks/data/vector'
import { filterPalette, paletteEntries } from '../hooks/palette'
import { newState } from '../hooks/state'
import { rvlitePrompt, VEC, vecArgs, vecEntry, vecLines, vecSpec, vecWhy } from '../hooks/vector'
import { FAKE_KEY, FAKE_PSEUDONYM, VEC_OUT } from './fixtures/vector'

/** One text each typed entry accepts, tried in turn. */
const SAMPLES = ['store.rvf 0.1,0.2', 'store.rvf', 'store.rvf a/v.json', 'a.rvf b.rvf', 'mem-1', 'a b', './a.js', 'lodash', 't :: c']

const entry = (id: string) => {
  const found = vecEntry(id)

  if (found === undefined) throw new Error(`no entry ${id}`)

  return found
}

describe('typed values', () => {
  it('free text: trimmed; empty, too long, a leading -, or a control character is refused', () => {
    expect(textOf('  write the login tests ')).toBe('write the login tests')
    expect(textOf('what is HNSW? (ef=200)')).toBe('what is HNSW? (ef=200)')
    expect(textOf('')).toBeNull()
    expect(textOf('-k 9')).toBeNull()
    expect(textOf('--help')).toBeNull()
    expect(textOf('a\u0007b')).toBeNull()
    expect(textOf('x'.repeat(8000))).not.toBeNull()
    expect(textOf('x'.repeat(8001))).toBeNull()
    expect(textOf('a;b`c')).toBeNull()
  })

  it('paths stay inside the project: relative, no .., no leading / or -, the kind asked for', () => {
    expect(relPathOf('./data/store.rvf', '.rvf')).toBe('data/store.rvf')
    expect(relPathOf('store.rvf', '.rvf')).toBe('store.rvf')
    expect(relPathOf('../store.rvf', '.rvf')).toBeNull()
    expect(relPathOf('a/../../b.rvf', '.rvf')).toBeNull()
    expect(relPathOf('/etc/x.rvf', '.rvf')).toBeNull()
    expect(relPathOf('-x.rvf', '.rvf')).toBeNull()
    expect(relPathOf('store.json', '.rvf')).toBeNull()
    expect(relPathOf('a b.rvf', '.rvf')).toBeNull()
    expect(relPathOf('a//b.rvf', '.rvf')).toBeNull()
  })

  it('vectors, dimensions, ids and share text', () => {
    expect(vectorOf('[0.1, -0.5, 2e-3]')).toBe('0.1,-0.5,2e-3')
    expect(vectorOf('1,,2')).toBeNull()
    expect(vectorOf('1,x')).toBeNull()
    expect(vectorOf('')).toBeNull()
    expect(dimensionOf('')).toBe('384')
    expect(dimensionOf('3')).toBe('3')
    expect(dimensionOf('0')).toBeNull()
    expect(dimensionOf('5000')).toBeNull()
    expect(vecIdOf('mem-01HXYZ')).toBe('mem-01HXYZ')
    expect(vecIdOf('-rf')).toBeNull()
    expect(shareOf('HNSW tip :: raise ef_search for recall')).toEqual({ title: 'HNSW tip', content: 'raise ef_search for recall' })
    expect(shareOf('no separator')).toBeNull()
    expect(shareOf(' :: body')).toBeNull()
  })

  it('decompile targets: ./file is local, an npm name goes to the registry, a URL is refused', () => {
    expect(targetOf('./dist/index.js')).toEqual({ kind: 'file', arg: './dist/index.js' })
    expect(targetOf('dist/index.mjs')).toEqual({ kind: 'file', arg: './dist/index.mjs' })
    expect(targetOf('lodash@4.17.21')).toEqual({ kind: 'npm', arg: 'lodash@4.17.21' })
    expect(targetOf('@ruvector/core')).toEqual({ kind: 'npm', arg: '@ruvector/core' })
    expect(targetOf('https://unpkg.com/x')).toBeNull()
    expect(targetOf('../secret.js')).toBeNull()
    expect(targetOf('-o /tmp')).toBeNull()
    expect(targetOf('/etc/passwd.js')).toBeNull()
  })
})

describe('the catalog', () => {
  it('every id is vec- and unique; every argv is the pinned offline ruvector, with no shell and no browser', () => {
    const state = newState({})
    const ids = VEC.map(one => one.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every(id => id.startsWith('vec-'))).toBe(true)
    expect(RV).toEqual(['npx', '--offline', '-y', 'ruvector@0.3.3'])

    for (const one of VEC) {
      const spec = vecSpec(one, state, 'x')

      if (spec === null) continue
      expect(spec.argv?.slice(0, 4), one.id).toEqual([...RV])
      expect(spec.shows, one.id).toBe(spec.argv?.join(' '))
      expect(spec.argv?.some(word => /^(sh|bash|xdg-open)$/.test(word) || word === 'dashboard'), one.id).toBe(false)
      expect(spec.lab).toBe(one.id)
    }
  })

  it('only local reads run at once; everything else asks with a note; network, publish, spend and delete say so', () => {
    const state = newState({})

    for (const one of VEC.filter(candidate => candidate.na === undefined && candidate.gate === undefined)) {
      const spec = SAMPLES.map(sample => vecSpec(one, state, sample)).find(found => found !== null) ?? null

      expect(spec, one.id).not.toBeNull()
      expect(spec?.isReadOnly === true, one.id).toBe(one.cost === 'read')
      if (one.cost !== 'read') expect(spec?.note, one.id).toBeDefined()
      if (one.cost === 'net') expect(spec?.note, one.id).toMatch(/reaches/)
      if (one.cost === 'publish') expect(spec?.note, one.id).toMatch(/PUBLISHES/)
      if (one.cost === 'spends') expect(spec?.note, one.id).toMatch(/MAY COST MONEY/)
      if (one.cost === 'deletes') expect(spec?.note, one.id).toMatch(/cannot be undone/)
    }

    // Every brain verb reaches pi.ruv.io, so not one of them runs unasked.
    expect(VEC.filter(one => one.section === 'brain').every(one => one.cost !== 'read')).toBe(true)
  })

  it('builds the argv each verb takes; typed text is one element after --, never a flag', () => {
    expect(vecArgs(entry('vec-brain-search'), 'vector db')).toEqual(['brain', 'search', 'vector db', '--limit', '10'])
    expect(vecArgs(entry('vec-brain-vote-down'), 'mem-1')).toEqual(['brain', 'vote', 'mem-1', 'down'])
    expect(vecArgs(entry('vec-brain-share'), 'HNSW tip :: raise ef')).toEqual(['brain', 'share', 'HNSW tip', '--category', 'pattern', '--content', 'raise ef'])
    expect(vecArgs(entry('vec-brain-transfer'), 'rust python')).toEqual(['brain', 'transfer', 'rust', 'python'])
    expect(vecArgs(entry('vec-brain-drift'), '')).toEqual(['brain', 'drift'])
    expect(vecArgs(entry('vec-rvf-query'), 'store.rvf -0.5,0.1,0.9')).toEqual(['rvf', 'query', 'store.rvf', '--vector=-0.5,0.1,0.9', '--k', '10'])
    expect(vecArgs(entry('vec-rvf-create'), 'new.rvf')).toEqual(['rvf', 'create', 'new.rvf', '--dimension', '384', '--metric', 'cosine'])
    expect(vecArgs(entry('vec-rvf-ingest'), 'new.rvf data/v.json')).toEqual(['rvf', 'ingest', 'new.rvf', '--input', 'data/v.json'])
    expect(vecArgs(entry('vec-rvf-derive'), 'a.rvf b.rvf')).toEqual(['rvf', 'derive', 'a.rvf', 'b.rvf'])
    expect(vecArgs(entry('vec-decompile-file'), './dist/x.js')).toEqual(['decompile', './dist/x.js', '--json'])
    expect(vecArgs(entry('vec-decompile-file'), 'lodash')).toBeNull()
    expect(vecArgs(entry('vec-decompile-pkg'), './dist/x.js')).toBeNull()
    expect(vecArgs(entry('vec-hooks-route'), 'fix the login bug')).toEqual(['hooks', 'route', '--', 'fix the login bug'])
    expect(vecArgs(entry('vec-hooks-remember'), '-rf')).toBeNull()
    expect(vecArgs(entry('vec-workers-dispatch'), 'scan auth')).toEqual(['workers', 'dispatch', '--', 'scan auth'])
    expect(vecArgs(entry('vec-rvf-status'), '../x.rvf')).toBeNull()
    expect(vecWhy(entry('vec-rvf-status'), newState({}))).toMatch(/project-relative \.rvf path/)
  })

  it('MCP-only tools and the browser are n/a with the reason, never an argv', () => {
    const state = newState({})

    for (const id of ['vec-rvf-delete', 'vec-sql', 'vec-cypher', 'vec-sparql', 'vec-decompile-witness', 'vec-edge-dashboard']) {
      expect(vecSpec(entry(id), state, 'x'), id).toBeNull()
      expect(vecWhy(entry(id), state), id).toMatch(/^n\/a/)
    }

    expect(rvlitePrompt('sql', 'SELECT * FROM vectors')).toMatch(/rvlite_sql .*\(read-only\): SELECT \* FROM vectors$/)
    expect(rvlitePrompt('cypher', 'MATCH (n) DETACH DELETE n')).toMatch(/CHANGES the database/)
    expect(rvlitePrompt('sparql', '')).toBeNull()
  })

  it('identity generate waits until show has found no key, so --save cannot overwrite one', () => {
    const generate = entry('vec-identity-generate')
    const state = newState({})

    expect(vecSpec(generate, state)).toBeNull()
    expect(vecWhy(generate, state)).toMatch(/overwrites ~\/\.ruvector\/pi-key/)

    state.lab.result = { id: 'vec-identity-show', label: 'show', ok: true, exitCode: 0, lines: ['pseudonym x'], atMs: 1 }
    expect(vecSpec(generate, state)).toBeNull()

    state.lab.result = { id: 'vec-identity-show', label: 'show', ok: false, exitCode: 1, lines: vecLines('vec-identity-show', '', VEC_OUT.identityNone), atMs: 1 }
    expect(isKeyless(state.lab.result.lines)).toBe(true)
    expect(vecSpec(generate, state)?.argv).toEqual([...RV, 'identity', 'generate', '--save', '--json'])
    expect(vecSpec(generate, state)?.isReadOnly).toBeUndefined()
  })
})

describe('readers', () => {
  it('no key material reaches a line: not the key, not its preview, not an export hint', () => {
    const show = vecLines('vec-identity-show', VEC_OUT.identityShow, '')
    const made = generatedLines(VEC_OUT.generated)
    const all = [...show, ...made].join('\n')

    expect(show).toEqual([`pseudonym: ${FAKE_PSEUDONYM}`, 'source: ~/.ruvector/pi-key'])
    expect(made).toEqual([`pseudonym ${FAKE_PSEUDONYM}`, 'key saved to /home/dev/.ruvector/pi-key (not shown: it is the secret)'])
    expect(all).not.toContain(FAKE_KEY)
    expect(all).not.toContain(FAKE_KEY.slice(0, 8))
    expect(redact([`token ${FAKE_KEY}`, `export PI=${FAKE_KEY}`])).toEqual(['token ‹redacted›'])
    // The generic reader would print `key: <hex>`; the spec for generate uses its own reader.
    expect(vecSpec(entry('vec-identity-generate'), Object.assign(newState({}), { lab: { result: { id: 'vec-identity-show', label: '', ok: false, exitCode: 1, lines: ['No pi key found'], atMs: 1 }, running: null } }))?.lines?.(VEC_OUT.generated, '').join('\n')).not.toContain(FAKE_KEY)
  })

  it('text output loses its colour; JSON is read as fields; a missing add-on reads as the CLI says', () => {
    expect(vecLines('vec-hooks-stats', VEC_OUT.hooksStats, '')).toContain('2 Q-learning patterns')
    expect(vecLines('vec-hooks-stats', VEC_OUT.hooksStats, '').some(line => line.includes('\u001b'))).toBe(false)
    expect(vecLines('vec-hooks-route', VEC_OUT.route, '')).toEqual(['task: write tests for login', 'recommended: coder', 'confidence: 0', 'reasoning: default for unknown files'])
    expect(vecLines('vec-rvf-status', VEC_OUT.rvfStatus, '')).toContain('totalVectors: 2')
    expect(vecLines('vec-brain-status', '', VEC_OUT.brainMissing)[0]).toBe('Brain commands require @ruvector/pi-brain')
  })
})

describe('the palette', () => {
  it('every entry is a vec- palette id; typed ones take their text after the id', () => {
    const state = newState({})
    const entries = paletteEntries(state, 0)
    const ids = entries.map(one => one.id)

    expect(ids).toEqual(expect.arrayContaining(VEC.map(one => one.id)))

    const search = entries.find(one => one.id === 'vec-brain-search')

    expect(search?.run.kind).toBe('text')
    expect(search?.run.kind === 'text' ? search.run.make('hnsw recall')?.argv : null).toEqual([...RV, 'brain', 'search', 'hnsw recall', '--limit', '10'])
    // The shared keywords still win their own text: a vector entry never takes route's words.
    expect(filterPalette(entries, 'route fix the login bug', 'all').map(one => one.id)).toEqual(['route'])
  })
})
