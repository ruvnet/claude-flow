/**
 * The approval pin (security audit of ADR-466): what the person approved, remembered OUTSIDE the project folder (the host's own store and
 * this process), because everything inside it, the envelope, its hash, the journal and the kill flag, is writable by the very steps the
 * autopilot starts. The envelope's hash is not a MAC: whoever can write the file can recompute it. So the loop also holds the envelope hash
 * and the NUMBER of `start` lines the person confirmed; a journal with another count (a forged or replayed `start`) or another hash is
 * tampering, and the loop stops. Pure.
 */
import type { LoopState } from './ap-loop'

export type Pin = { envHash: string; starts: number; /** True once a stop was journaled: a journal that then reads as running had its stop line deleted. */ stopped?: boolean }
export type PinVerdict = { ok: true } | { ok: false; why: string }

export const pinKey = (cwd: string): string => `autopilot-pin:${cwd.slice(0, 200)}`

/** A stored pin, or null when it is not one. */
export function parsePin(value: unknown): Pin | null {
  if (typeof value !== 'object' || value === null) return null

  const r = value as Record<string, unknown>

  return typeof r.envHash === 'string' && /^[0-9a-f]{64}$/.test(r.envHash) && typeof r.starts === 'number' && Number.isInteger(r.starts) && r.starts >= 0 && r.starts < 1_000_000 ? { envHash: r.envHash, starts: r.starts, ...(r.stopped === true && { stopped: true }) } : null
}

/** Does the journal's fold agree with what the person approved? An idle loop (no start) has nothing to compare. */
export function checkPin(pin: Pin | null, loop: LoopState, isPending = false): PinVerdict {
  if (loop.phase === 'idle') return { ok: true }
  if (pin === null) return { ok: false, why: 'no recorded approval for this run: confirm Start again' }
  if (loop.envHash !== pin.envHash) return { ok: false, why: 'the journal names an envelope other than the one you approved: it was changed outside the console' }
  if (pin.stopped === true && loop.phase !== 'stopped' && !isPending) return { ok: false, why: 'the journal reads as running, but a stop was recorded: its stop line was removed outside the console' }
  if (loop.starts !== pin.starts && !isPending) return { ok: false, why: `the journal holds ${loop.starts} start lines, you confirmed ${pin.starts}: one was added or removed outside the console` }

  return { ok: true }
}
