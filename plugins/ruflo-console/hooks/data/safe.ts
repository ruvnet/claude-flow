/**
 * Values from files and CLI answers that another process wrote: a time past what `Date` holds, a negative, fractional-hostile or infinite
 * count, a ratio outside 0..1. Each helper answers undefined (or text) for what it will not draw, and none throws (#3817). A leaf: no imports.
 */

/** The edge of what `Date` can hold: a time past it makes `toISOString()` throw, so no reader keeps one (#3817). */
export const MAX_TIME_MS = 8.64e15
/** The largest count any view draws: a hostile 1e300 is clamped, never a display value. */
export const MAX_COUNT = 1e12

/** A time in epoch milliseconds that `Date` can hold, else undefined. */
export const timeOf = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_TIME_MS ? value : undefined)

/** A time as ISO text, clamped to `Date`'s range; 'n/a' for anything that is not a finite number. It never throws. */
export const isoOf = (value: unknown): string => (typeof value === 'number' && Number.isFinite(value) ? new Date(Math.min(MAX_TIME_MS, Math.max(-MAX_TIME_MS, value))).toISOString() : 'n/a')

/** A whole, non-negative count capped at MAX_COUNT, else undefined (a negative, fractional-hostile, NaN or infinite value is not a count). */
export const countOf = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), MAX_COUNT) : undefined)

/** A signed measurement (a score, a lift, a latency, a percentage) that is finite and within ±MAX_COUNT, else undefined: never "Infinity" or "1e+300" on screen (#3822). */
export const measureOf = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COUNT ? value : undefined)

/** A ratio clamped to 0..1, else undefined. */
export const ratioOf = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined)

/** A value keyed by a name a file or the CLI supplied: an OWN key only, so `toString`, `constructor` or `__proto__` read as absent, never as a function. */
export const own = <T>(record: Readonly<Record<string, T>>, key: unknown): T | undefined => (typeof key === 'string' && Object.hasOwn(record, key) ? record[key] : undefined)

/** 2000-01-01T00:00:00Z: no ruflo file was written before it. */
const EARLIEST_MS = 946_684_800_000
/** How far ahead of now a write time may be (a clock a little ahead) before it is not believed. */
const FUTURE_SLACK_MS = 86_400_000

/**
 * A write time fit to say "N ago" about: from 2000 to a day past now, else undefined (shown as n/a). timeOf alone admits ±8.64e15, which read
 * "100020735d ago", and a time in the future, which read "0s ago".
 */
export const sinceOf = (ms: number | null | undefined, nowMs: number): number | undefined =>
  typeof ms === 'number' && Number.isFinite(ms) && ms >= EARLIEST_MS && ms <= nowMs + FUTURE_SLACK_MS ? ms : undefined
