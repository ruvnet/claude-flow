/**
 * The Memory Lab's pure parts under vitest: the catalog's invariants (fixed argv, what asks first and why, no shell),
 * the input validators, the argv each entry builds, the output readers against what the CLI printed, and the recency
 * timeline. Run with
 *   npx vitest run plugins/ruflo-console/tests/memory-lab.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { PROBES, type Namespaces } from '../hooks/data/cli'
import { keyOf, MEM_KEYWORDS, MEM_LAB, memEntry, memSpecOf, namespaceOf, parseInput, textOfFields } from '../hooks/memory-lab'
import { gauge, memLines, recency, sparkline, wrap } from '../hooks/memory-lines'
import { filterPalette, paletteEntries } from '../hooks/palette'
import { newState } from '../hooks/state'
import { MEM_OUT } from './fixtures/memory'

const entry = (id: string) => {
  const found = memEntry(id)

  if (found === undefined) throw new Error(`no entry ${id}`)

  return found
}

/** A plausible input for each takes, so every entry builds its argv. */
const SAMPLE = { text: 'jwt refresh', node: 'beta', pair: 'jwt refresh | token rotation', edge: 'auth-bug causes login-fail', entry: 'auth beta', kv: 'notes alpha the quick brown fox' } as const

describe('the memory lab catalog', () => {
  it('every entry has a unique mem- id, builds one fixed argv, and none reaches a shell', () => {
    const ids = MEM_LAB.map(candidate => candidate.id)
    const state = newState({})

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every(id => id.startsWith('mem-'))).toBe(true)

    for (const candidate of MEM_LAB) {
      const spec = memSpecOf(candidate, candidate.takes === undefined ? '' : SAMPLE[candidate.takes], state)

      expect(spec, candidate.id).not.toBeNull()
      expect(spec?.lab).toBe(candidate.id)
      expect(spec?.args.some(word => /^(sh|bash|rm)$/.test(word)), candidate.id).toBe(false)
      expect(spec?.args[0] === 'memory' || (spec?.args[0] === 'mcp' && spec.args[1] === 'exec'), candidate.id).toBe(true)
    }
  })

  it('reads run at once; writes, deletes and network ask first with a note that says which', () => {
    const state = newState({})

    for (const candidate of MEM_LAB) {
      const spec = memSpecOf(candidate, candidate.takes === undefined ? '' : SAMPLE[candidate.takes], state)

      expect(spec?.isReadOnly === true, candidate.id).toBe(candidate.cost === 'read')
      if (candidate.cost !== 'read') expect(spec?.note, candidate.id).toBeDefined()
      if (candidate.cost === 'deletes') expect(spec?.note, candidate.id).toMatch(/DELETES FOR GOOD/)
      if (candidate.cost === 'net') expect(spec?.note, candidate.id).toMatch(/download.*network/)
    }

    expect(MEM_LAB.filter(candidate => candidate.cost === 'deletes').map(candidate => candidate.id)).toEqual(['mem-delete', 'mem-cleanup'])
  })

  it('builds the argv the CLI source and --help name', () => {
    const state = newState({})
    const args = (id: string, text = '') => memSpecOf(entry(id), text, state)?.args

    expect(args('mem-stats')).toEqual(['memory', 'stats', '--format', 'json'])
    expect(args('mem-list')).toEqual(['memory', 'list', '--limit', '50', '--format', 'json'])
    expect(args('mem-search', 'jwt refresh')).toEqual(['memory', 'search', '--query', 'jwt refresh', '--limit', '10', '--format', 'json'])
    expect(args('mem-retrieve', 'auth jwt/refresh')).toEqual(['memory', 'retrieve', '--key', 'jwt/refresh', '--namespace', 'auth', '--format', 'json'])
    expect(args('mem-store', 'notes alpha the quick  brown fox')).toEqual(['memory', 'store', '--key', 'alpha', '--value', 'the quick brown fox', '--namespace', 'notes'])
    expect(args('mem-delete', 'auth beta')).toEqual(['memory', 'delete', '--key', 'beta', '--namespace', 'auth', '--force'])
    expect(args('mem-export')).toEqual(['memory', 'export', '--output', '.claude-flow/memory-export.json'])
    expect(args('mem-unified', 'token rotation')).toEqual(['mcp', 'exec', '-t', 'memory_search_unified', '-p', '{"query":"token rotation","limit":10}'])
    expect(args('mem-cleanup-plan')).toEqual(['mcp', 'exec', '-t', 'memory_cleanup', '-p', '{"dryRun":true}'])
    expect(args('mem-cleanup')).toEqual(['mcp', 'exec', '-t', 'memory_cleanup', '-p', '{"dryRun":false}'])
    expect(args('mem-import-all')).toEqual(['mcp', 'exec', '-t', 'memory_import_claude', '-p', '{"allProjects":true}'])
    expect(args('mem-synth', 'token rotation')).toEqual(['mcp', 'exec', '-t', 'agentdb_context-synthesize', '-p', '{"query":"token rotation","maxEntries":10}'])
    expect(args('mem-sroute', 'fix the login bug')).toEqual(['mcp', 'exec', '-t', 'agentdb_semantic-route', '-p', '{"input":"fix the login bug"}'])
    expect(args('mem-path', 'entity:auth | why does login fail')).toEqual(['mcp', 'exec', '-t', 'agentdb_graph-pathfinder', '-p', '{"seedNodeId":"entity:auth","query":"why does login fail","depth":3,"topK":10,"algorithm":"personalized-pagerank"}'])
    expect(args('mem-graph', 'beta')).toEqual(['mcp', 'exec', '-t', 'agentdb_graph-query', '-p', '{"nodeId":"beta","mode":"k-hop","depth":2,"topK":10}'])
    expect(args('mem-edge', 'auth-bug causes login-fail')).toEqual(['mcp', 'exec', '-t', 'agentdb_causal-edge', '-p', '{"sourceId":"auth-bug","targetId":"login-fail","relation":"causes"}'])
    expect(args('mem-compare', 'jwt | token')).toEqual(['mcp', 'exec', '-t', 'embeddings_compare', '-p', '{"text1":"jwt","text2":"token","metric":"cosine"}'])
    expect(args('mem-rabitq-search', 'auth')).toEqual(['mcp', 'exec', '-t', 'embeddings_rabitq_search', '-p', '{"query":"auth","k":10}'])
  })

  it('a picked namespace narrows list, search and export', () => {
    const state = newState({})

    state.memoryLab.filter = 'auth'
    expect(memSpecOf(entry('mem-list'), '', state)?.args).toEqual(['memory', 'list', '--namespace', 'auth', '--limit', '50', '--format', 'json'])
    expect(memSpecOf(entry('mem-search'), 'x', state)?.args).toContain('auth')
    expect(memSpecOf(entry('mem-export'), '', state)?.args.slice(-2)).toEqual(['--namespace', 'auth'])
  })
})

describe('the input validators', () => {
  it('keys and namespaces: no leading -, no spaces, capped; keys may hold / and :', () => {
    expect(keyOf('api/auth')).toBe('api/auth')
    expect(keyOf('notes:alpha@v2')).toBe('notes:alpha@v2')
    expect(keyOf('--force')).toBeNull()
    expect(keyOf('a b')).toBeNull()
    expect(keyOf('k'.repeat(129))).toBeNull()
    expect(namespaceOf('claude-memories')).toBe('claude-memories')
    expect(namespaceOf('a/b')).toBeNull()
    expect(namespaceOf('-n')).toBeNull()
    expect(namespaceOf('.hidden')).toBeNull()
  })

  it('each takes reads its shape and refuses the rest', () => {
    expect(parseInput('text', '-rf /')).toBeNull()
    expect(parseInput('text', '  ')).toBeNull()
    expect(parseInput('text', 'a\u001b[31mred\u0007bell')?.text).toBe('ared bell')
    expect(parseInput('node', 'two words')).toBeNull()
    expect(parseInput('pair', 'only one')).toBeNull()
    expect(parseInput('pair', 'a | b | c')).toBeNull()
    expect(parseInput('edge', 'a causes')).toBeNull()
    expect(parseInput('edge', 'a "causes" b')).toBeNull()
    expect(parseInput('entry', 'auth')).toBeNull()
    expect(parseInput('entry', 'auth beta extra')).toBeNull()
    expect(parseInput('kv', 'notes alpha')).toBeNull()
    expect(parseInput('kv', 'notes alpha --upsert')).toBeNull()
    expect(parseInput('kv', 'notes alpha x'.padEnd(8100, 'y'))).toBeNull()
  })

  it('a button builds the same text from the fields that a headless run would type', () => {
    const lab = { ...newState({}).memoryLab, query: 'q', key: 'beta', value: 'v v', namespace: 'auth', text: 't' }

    expect(textOfFields(entry('mem-store'), lab)).toBe('auth beta v v')
    expect(textOfFields(entry('mem-delete'), lab)).toBe('auth beta')
    expect(textOfFields(entry('mem-search'), lab)).toBe('q')
    expect(textOfFields(entry('mem-recall'), lab)).toBe('t')
    expect(textOfFields(entry('mem-stats'), lab)).toBe('')
  })
})

describe('the palette and headless runs', () => {
  it('every lab entry is a palette id; a text entry takes the words after its id', () => {
    const state = newState({})
    const entries = paletteEntries(state, 0)

    for (const candidate of MEM_LAB) expect(entries.some(found => found.id === candidate.id), candidate.id).toBe(true)

    const [best] = filterPalette(entries, 'mem-search jwt refresh', 'all')

    expect(best?.id).toBe('mem-search')
    expect(best?.run.kind === 'text' ? best.run.make('jwt refresh')?.args : null).toContain('jwt refresh')
    expect(MEM_KEYWORDS).toContain('mem-delete')
    expect(MEM_KEYWORDS).not.toContain('mem-stats')
  })
})

describe('the output readers', () => {
  it('retrieve: the CLI warning about the other store first, then the whole value', () => {
    const lines = memLines('mem-retrieve', MEM_OUT.retrieve ?? '')

    expect(lines[0]).toMatch(/^⚠ Partial result: .*agentdb-memory\.db/)
    expect(lines[1]).toContain('auth/beta · 25 chars · read 1× · has a vector')
    expect(lines).toContain('jwt refresh tokens rotate')
    expect(lines.join('\n')).not.toMatch(/\u001b/)
  })

  it('search and unified search: hits by score, where each lives', () => {
    expect(memLines('mem-search', MEM_OUT.search ?? '')).toEqual(['1 hit · semantic · 9ms', '0.684  auth/beta  jwt refresh tokens rotate'])
    expect(memLines('mem-unified', MEM_OUT.unified ?? '')[1]).toBe('0.684  auth/beta [agentdb]  jwt refresh tokens rotate')
  })

  it('list, health, and the text answers of store and delete', () => {
    expect(memLines('mem-list', MEM_OUT.list ?? '')[0]).toBe('2 entries')
    expect(memLines('mem-list', MEM_OUT.list ?? '')[1]).toMatch(/^◆ auth\/beta · 25 B · 2026-10-02/)
    expect(memLines('mem-health', MEM_OUT.health ?? '')).toEqual(['AgentDB available · 2/3 controllers on', '✓ hierarchicalMemory  L1', '✓ reasoningBank  L1', '· mutationGuard  L2'])
    expect(memLines('mem-delete', MEM_OUT.deleteMissing ?? '')).toEqual(['⚠ Key not found: "nonexist" in namespace "notes"'])
    expect(memLines('mem-store', MEM_OUT.stored ?? '')).toEqual(['[INFO] Storing in notes/alpha...', '[OK] Data stored successfully'])
  })

  it('wraps long values at the panel width without losing a character', () => {
    const long = `${'word '.repeat(50)}${'x'.repeat(250)}`
    const lines = wrap(long, 40)

    expect(lines.every(line => line.length <= 40)).toBe(true)
    expect(lines.join('').replace(/\s/g, '')).toBe(long.replace(/\s/g, ''))
  })
})

describe('the probes and the pictures', () => {
  it('memory list keeps each entry newest first; memory stats counts the unread store', () => {
    const spaces = PROBES.find(probe => probe.id === 'namespaces')?.parse(MEM_OUT.list ?? '') as Namespaces | null
    const stats = PROBES.find(probe => probe.id === 'memory')?.parse(MEM_OUT.stats ?? '') as { unread?: number } | null

    expect(spaces?.entries?.map(item => `${item.namespace}/${item.key}:${item.hasVector}`)).toEqual(['auth/beta:true', 'notes/alpha:false'])
    expect(stats?.unread).toBe(2)
  })

  it('recency bins from the oldest write to now; the sparkline and gauge scale to their max', () => {
    const hour = 3_600_000
    const binned = recency([0, hour, hour, 4 * hour], 4 * hour, 4)

    expect(binned).toEqual({ counts: [1, 2, 0, 1], fromMs: 0 })
    expect(sparkline(binned?.counts ?? [])).toBe('▄█·▄')
    expect(recency([], 1)).toBeNull()
    expect(gauge(1, 2, 10)).toBe('█████░░░░░')
    expect(gauge(0, 0, 4)).toBe('░░░░')
  })
})
