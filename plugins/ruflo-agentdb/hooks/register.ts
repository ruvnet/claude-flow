import type { Hook, Register } from 'claude-code'

import { answer } from './command'
import { expandTruncated } from './expand'
import { verdict } from './guard'
import { importPath, importVerdict, isImport, readImport } from './import'
import { readOptions, type ModOptions } from './options'
import { cacheKey, frame, keywords, parse, screen, worthRecalling } from './recall'
import { tidy } from './screen'
import { newStats, noteAttached, STATUS_PATH, statusText, type Stats } from './status'
import { pickReaders, type Reader } from './tools'

const CACHE_MS = 600_000
const CACHE_MAX = 50
const TEXT_CAP = 60_000

type Dollar = Parameters<Hook<'session.start'>>[0]

/** Everything one session of the mod keeps: its settings, counters, the recall cache, the project root and the reader found. */
type Session = {
  readonly opts: ModOptions
  readonly stats: Stats
  readonly cache: Map<string, { atMs: number; block: string }>
  root?: string
  readers?: readonly Reader[]
}

/** What a reader answered: `tool` is its label (agentdb | ruvector), `via` the MCP tool itself. */
type Read = { readonly tool: string; readonly via: string; readonly text: string; readonly unsafe?: number }

/** The connected memory readers, found once per session and looked for again while there are none or after an error (a server may connect late). */
async function find($: Dollar, s: Session): Promise<readonly Reader[]> {
  if (s.readers === undefined || s.readers.length === 0) s.readers = pickReaders(await $.tool.list(), s.opts.source)
  return s.readers
}

async function flush($: Dollar, s: Session): Promise<void> {
  if (s.root === undefined) return
  try {
    await $.fs.write(`${s.root}/${STATUS_PATH}`, statusText(s.stats, s.opts, await $.clock.now()))
  } catch {
    /* the status file is a courtesy */
  }
}

/**
 * Best-effort extra layer for `memory_import`, whose input is only a path: reads the file (bounded, regular, under the project root or home) and screens it.
 * Undefined, so the import proceeds, on any path, stat or read problem.
 */
async function importRefusal($: Dollar, s: Session, input: unknown): Promise<string | undefined> {
  const home = await $.env.get('HOME').catch(() => undefined)
  const path = importPath(input, s.root, home)
  if (path === undefined) return undefined
  const text = await readImport({ stat: p => $.fs.stat(p), read: p => $.fs.read(p) }, path)
  return text === undefined ? undefined : importVerdict(text)
}

/** One memory's full text through `memory_retrieve`; undefined on any failure (the cut text is then kept). */
async function full($: Dollar, server: string, tool: string, key: string, namespace: string | undefined): Promise<string | undefined> {
  const res = await $.mcp.call(server, tool, namespace === undefined ? { key } : { key, namespace })
  if (res.isError) return undefined
  try {
    const value = (JSON.parse((res.content.find(b => b.type === 'text')?.text ?? '').slice(0, TEXT_CAP)) as { value?: unknown }).value
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

/** One reader's first text block, or '' when it errored or said nothing. */
async function ask($: Dollar, r: Reader, query: string, limit: number): Promise<Read> {
  const res = await $.mcp.call(r.server, r.tool, r.args(query.slice(0, 1000), limit))
  const text = res.isError ? '' : (res.content.find(b => b.type === 'text')?.text ?? '').slice(0, TEXT_CAP)
  const retrieve = r.retrieve
  return { tool: r.label, via: r.tool, text: retrieve === undefined ? text : await expandTruncated(text, (key, namespace) => full($, r.server, retrieve, key, namespace)) }
}

/**
 * Reads through the connected tools until one has usable results, all within `ms`: the whole prompt on each reader, then its salient words (a
 * store that matches substrings never matches a sentence). The first answer whose items survive the screen, else the last answer; 'late'
 * past the deadline; undefined when no reader is connected.
 */
async function read($: Dollar, s: Session, query: string, ms: number): Promise<Read | 'late' | undefined> {
  const readers = await find($, s)
  if (readers.length === 0) return undefined
  const work = (async (): Promise<Read> => {
    let last: Read = { tool: readers[0]?.label ?? '', via: readers[0]?.tool ?? '', text: '' }
    let peak = 0 // the most unsafe results any one answer held: the same note comes back for each query, so counts are not summed
    for (const q of [query, ...keywords(query)]) {
      for (const r of readers) {
        if (r.wholeOnly && q !== query) continue
        try {
          last = await ask($, r, q, s.opts.recallLimit)
        } catch (e) {
          // A refused permission or a dead server must show in the status file, not read as "nothing relevant".
          s.stats.errors++
          s.stats.lastError = tidy(String(e instanceof Error ? e.message : e), 200)
          continue
        }
        const seen = screen(parse(last.text, last.tool, 0), s.opts.recallLimit)
        peak = Math.max(peak, seen.unsafe)
        // An answer of only unsafe results does not end the walk: one poisoned note must not hide a clean one behind it.
        if (seen.items.length > 0) return { ...last, unsafe: peak }
      }
    }
    return { ...last, unsafe: peak }
  })()
  const won = await Promise.race([work, $.clock.sleep(ms).then(() => 'late' as const, () => 'late' as const)])
  if (won === 'late') work.catch(() => undefined)
  return won
}

/** The prompt hook's work: returns the block to attach, or undefined (skipped, late, nothing relevant, an error). */
async function recallFor($: Dollar, s: Session, text: string): Promise<string | undefined> {
  const { stats, opts } = s
  if (!worthRecalling(text)) {
    stats.skipped++
    return undefined
  }
  const now = await $.clock.now()
  const key = cacheKey(text)
  const hit = s.cache.get(key)
  if (hit && now - hit.atMs < CACHE_MS) {
    stats.cached++
    return hit.block
  }
  try {
    const got = await read($, s, text, opts.recallDeadlineMs)
    if (got === 'late') {
      stats.timedOut++
      return undefined
    }
    if (!got) {
      stats.skipped++
      return undefined
    }
    stats.lastMs = (await $.clock.now()) - now
    stats.lastTool = got.tool
    stats.lastReader = got.via
    const screened = screen(parse(got.text, got.tool, now), opts.recallLimit)
    stats.dropped += Math.max(got.unsafe ?? 0, screened.unsafe)
    if (screened.items.length === 0) {
      return undefined
    }
    const block = frame(screened.items)
    if (s.cache.size >= CACHE_MAX) s.cache.delete(s.cache.keys().next().value as string)
    s.cache.set(key, { atMs: now, block })
    noteAttached(stats, screened.items, now)
    return block
  } catch {
    stats.errors++
    s.readers = undefined
    return undefined
  }
}

/**
 * AgentDB as a mod (ADR-445): safe recall into the prompt (opt-in, per-prompt context, deadline-bounded, screened as untrusted), a write
 * guard that keeps secrets out of memory, `/agentdb`, and a status file the console reads. No network, no CLI: only tools already connected.
 */
export const register: Register = (on, options) => {
  const s: Session = { opts: readOptions(options), stats: newStats(), cache: new Map() }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    s.root = (await $.session.root()) as string | undefined
    try {
      await $.command.register({ name: 'agentdb-mod', description: 'AgentDB mod: status, recall <text>, scan <text>, recent' })
    } catch {
      /* a name taken by another plugin must not stop the mod */
    }
    await flush($, s)
    return result
  })

  if (s.opts.recall && s.opts.source !== 'none') {
    on('prompt.submit', async ($, e, next) => {
      const block = await recallFor($, s, typeof e.text === 'string' ? e.text : '')
      await flush($, s) // every outcome (skipped, late, cached, error) moves a counter the console reads, not only an attach
      return next(block === undefined ? e : { ...e, context: [...(e.context ?? []), block] })
    })
  }

  if (s.opts.guard) {
    on('tool.call', async ($, e, next) => {
      const reason = verdict(e.tool, e) ?? (isImport(e.tool) ? await importRefusal($, s, e) : undefined)
      if (reason === undefined) return next(e)
      s.stats.blocked++
      await flush($, s)
      return { deny: reason }
    })
  }

  /** `/agentdb-mod` (the plugin's `/agentdb` is a prompt command, which no hook can answer). */
  on('command.run', { command: 'agentdb-mod' }, async ($, e) => {
    const args = typeof e.args === 'string' ? e.args : ''
    const text = await answer(args, {
      opts: s.opts,
      stats: s.stats,
      nowMs: () => $.clock.now(),
      read: async query => {
        const got = await read($, s, query, Math.max(s.opts.recallDeadlineMs, 2000))
        return got === 'late' ? undefined : got
      },
    })
    return { text }
  })
}
