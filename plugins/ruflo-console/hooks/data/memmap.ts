/**
 * What the memory map reads: the entries `memory list` prints (with the access count the Memory Lab's own probe leaves out)
 * and the entries a search named. Pure; the probe is registered by the integrator, never run from here.
 */
import { jsonAfter, type Probe } from './cli'
import { numberOf, recordOf, stringOf } from './parse'

import type { MapEntry } from '../gfx/memmap'

/** Entries the map draws at most: `memory list` is asked for the newest 500, as the Namespaces sample is. */
export const MAP_LIMIT = 500

/** A stored embedding longer than this is ignored (the map then says hash): bounds the work per frame on a corrupt list. */
const MAX_DIMS = 4096

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_INDEX = new Map([...B64].map((char, index) => [char, index] as const))

/** Base64 to bytes by hand (the engine's module host is promised no built-ins); null on any character outside the alphabet. */
function bytesOf(b64: string): Uint8Array | null {
  const clean = b64.replace(/=+$/, '')

  if (clean.length % 4 === 1) return null

  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let acc = 0
  let bits = 0
  let at = 0

  for (const char of clean) {
    const index = B64_INDEX.get(char)

    if (index === undefined) return null

    acc = (acc << 6) | index
    bits += 6

    if (bits >= 8) {
      bits -= 8
      out[at++] = (acc >> bits) & 0xff
    }
  }

  return out
}

/** `embeddingQ8` ({dims, scale, b64}: int8 values, each times scale) as floats; undefined unless the shape, the byte count and the scale all check out. */
export function decodeQ8(value: unknown): number[] | undefined {
  const record = recordOf(value)
  const dims = numberOf(record?.dims)
  const scale = numberOf(record?.scale)

  if (record === null || typeof record.b64 !== 'string' || dims === undefined || scale === undefined || !Number.isInteger(dims) || dims < 2 || dims > MAX_DIMS || !(scale > 0) || !Number.isFinite(scale)) return undefined

  const bytes = bytesOf(record.b64)

  if (bytes === null || bytes.length !== dims) return undefined

  const out = new Array<number>(dims)

  for (let i = 0; i < dims; i++) out[i] = ((bytes[i] as number) << 24 >> 24) * scale

  return out
}

/**
 * `memory list` JSON as map entries. `vector` is set only if a row carries what the CLI printed for it: an `embeddingQ8`
 * (`memory list --embeddings`, ADR-472: int8 values times a scale, base64) or a plain `embedding` array. An older CLI ignores the
 * flag and prints neither, so the map says 'hash layout'; a vector is never invented.
 */
export function mapEntriesOf(stdout: string): MapEntry[] | null {
  const value = jsonAfter(stdout)

  if (!Array.isArray(value)) return null

  return value.slice(0, MAP_LIMIT).flatMap((row): MapEntry[] => {
    const record = recordOf(row)
    const key = stringOf(record?.key, 128)

    if (key === undefined) return []

    const accessCount = numberOf(record?.accessCount)
    const raw = Array.isArray(record?.embedding) ? record.embedding : null
    const vector = raw !== null && raw.length > 1 && raw.length <= MAX_DIMS && raw.every(item => typeof item === 'number' && Number.isFinite(item)) ? (raw as number[]) : decodeQ8(record?.embeddingQ8)

    return [{ key, namespace: stringOf(record?.namespace, 40) ?? '(none)', hasVector: record?.hasEmbedding === true, ...(accessCount !== undefined && { accessCount }), ...(vector !== undefined && { vector }) }]
  })
}

/** The Namespaces probe's call plus the access count that probe drops and, with `--embeddings` (ADR-472), each entry's vector as int8 + scale: about 0.2 MB at 500 x 384, under the 1 MB `jsonAfter` reads. */
export const memmapProbe: Probe<MapEntry[]> = {
  id: 'memmap',
  args: ['memory', 'list', '--format', 'json', '--limit', String(MAP_LIMIT), '--embeddings'],
  views: ['memory'],
  everyMs: 60_000,
  timeoutMs: 30_000,
  parse: mapEntriesOf,
}

/**
 * The `namespace/key` of each hit in a search run's printed lines (`0.684  auth/beta [agentdb]  text`; the lab prints
 * a key at most 60 characters, so a key that long matches by prefix in `isHit`). Lines that are not hits yield nothing.
 */
export function hitsOf(lines: readonly string[]): Set<string> {
  const hits = new Set<string>()

  for (const line of lines) {
    const found = /^\s*(?:\d+\.\d+|n\/a)\s+([^\s/]+)\/(\S+)/.exec(line)

    if (found !== null) hits.add(`${found[1]}/${found[2]}`)
  }

  return hits
}

/** Whether a listed entry is among the hits, allowing for the lab's 60-character key cut. */
export function isHit(hits: ReadonlySet<string>, entry: { namespace: string; key: string }): boolean {
  const id = `${entry.namespace}/${entry.key}`

  return hits.has(id) || (entry.key.length > 60 && hits.has(`${entry.namespace}/${entry.key.slice(0, 60)}`))
}
