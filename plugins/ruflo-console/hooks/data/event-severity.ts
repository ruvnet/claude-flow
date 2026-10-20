/**
 * How serious an event is (ADR-474): ok, info, warn or bad, decided in one pure place from the kind and the words. A bad word wins over a
 * warn word, which wins over an ok word; an event with none of them is info.
 */
export type Level = 'ok' | 'info' | 'warn' | 'bad'

export const LEVELS: readonly Level[] = ['bad', 'warn', 'ok', 'info']

const BAD = /\b(?:fail(?:ed|ure|s)?|error|blocked|denied|deny|refused|critical|crash(?:ed)?|killed|timed out|stuck|stalled|unhealthy|violation)\b/i
const WARN = /\b(?:parked|degraded|paused|stale|left the (?:store|hive)|released|warn(?:ing)?|idle for|retry|empty|mismatch|cancel(?:l?ed)?|notified|stopped|dropped|slow|unreachable|missing)\b/i
const OK = /\b(?:done|completed?|finished|verified|succe(?:ss|eded)|joined the hive|spawned|appeared|resumed|started|approved|passed|learned|judged)\b/i

/** Words that are not a problem even though they contain one (`0 failed`, `no errors`). */
const CALM = /\b(?:0|no|zero|without)\s+(?:fail(?:ed|ures?)?|errors?|denied|blocked)\b|\b(?:fail(?:ed|ures?)?|errors?|denied|blocked)\s*[:=]\s*0\b/gi

/** A tool event's words are an agent's name and a tool's name (`error-handler: Bash`), which say nothing about how it went: only a deny or an unrun confirm is a problem. */
const TOOL_PROBLEM = /^(?:permission denied|confirm for )/i

export function levelOf(kind: string, text: string): Level {
  const words = text.replace(CALM, '')

  if (kind === 'tools' && !TOOL_PROBLEM.test(text)) return 'info'
  if (kind === 'anatole') return /\bnotified\b/i.test(words) && !BAD.test(words) ? 'warn' : 'bad'
  if (BAD.test(words)) return 'bad'
  if (WARN.test(words)) return 'warn'
  if (OK.test(words)) return 'ok'

  return 'info'
}

export const isLevel = (value: unknown): value is Level => value === 'ok' || value === 'info' || value === 'warn' || value === 'bad'
export const rankOf = (level: Level): number => (level === 'bad' ? 3 : level === 'warn' ? 2 : level === 'info' ? 1 : 0)

const cache = new WeakMap<object, Level>()

/** `levelOf` for an event object, remembered: filtering ten thousand events decides each level once. */
export function levelOfEvent(event: { kind: string; text: string }): Level {
  let found = cache.get(event)

  if (found === undefined) {
    found = levelOf(event.kind, event.text)
    cache.set(event, found)
  }

  return found
}
