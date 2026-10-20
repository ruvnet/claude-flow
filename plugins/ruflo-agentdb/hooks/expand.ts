import { MIN_SCORE } from './recall'

/** Fetches one memory's full text by key (and namespace), or undefined when it cannot. */
export type FetchFull = (key: string, namespace: string | undefined) => Promise<string | undefined>

const MAX_FETCHES = 5

/**
 * `memory_search` cuts every value to 60 characters plus "..." (measured), so an attached memory read as half a sentence and the screen never saw
 * the rest of it. Each truncated hit that scores at least MIN_SCORE is replaced by its full text from `fetchFull`; a failed fetch keeps the cut text.
 */
export async function expandTruncated(text: string, fetchFull: FetchFull): Promise<string> {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return text
  }
  const list = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as { results?: unknown }).results : undefined
  if (!Array.isArray(list)) return text
  let changed = false
  await Promise.all(
    list.slice(0, MAX_FETCHES).map(async (item: unknown) => {
      if (typeof item !== 'object' || item === null) return
      const hit = item as Record<string, unknown>
      if (typeof hit.value !== 'string' || !hit.value.endsWith('...') || typeof hit.key !== 'string') return
      if (typeof hit.similarity === 'number' && hit.similarity < MIN_SCORE) return
      const full = await fetchFull(hit.key, typeof hit.namespace === 'string' ? hit.namespace : undefined).catch(() => undefined)
      if (full !== undefined && full.length > hit.value.length - 3) {
        hit.value = full
        changed = true
      }
    }),
  )
  return changed ? JSON.stringify(data) : text
}
